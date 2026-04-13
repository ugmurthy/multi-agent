import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import websocket from '@fastify/websocket';

import type { AgentRegistry } from './agent-registry.js';
import {
  GatewayAuthError,
  authenticateGatewayUpgrade,
  createAuthErrorFrame,
  type GatewayAuthContext,
  type GatewayUpgradeQuery,
} from './auth.js';
import {
  createChannelSubscriptionManager,
  validateChannelSubscribeFrame,
  type ChannelSubscriptionManager,
} from './channels.js';
import { executeGatewayChatTurn } from './chat.js';
import type { GatewayConfig } from './config.js';
import type { JsonObject } from './core.js';
import {
  ProtocolValidationError,
  type InboundFrame,
  type OutboundFrame,
  createPongFrame,
  createProtocolErrorFrame,
  createUnsupportedFrameError,
  parseInboundFrame,
  serializeOutboundFrame,
} from './protocol.js';
import type { ResolvedGatewayAuthProvider } from './registries.js';
import { executeGatewayApprovalResolution, executeGatewayClarificationResolution, executeGatewayRunStart } from './run.js';
import { createGatewayLogger, type GatewayLogger } from './observability.js';
import { openGatewaySession } from './session.js';
import { createInMemoryGatewayStores, type GatewayStores } from './stores.js';

export interface CreateGatewayServerOptions {
  fastify?: FastifyServerOptions;
  auth?: ResolvedGatewayAuthProvider;
  agentRegistry?: AgentRegistry;
  stores?: GatewayStores;
  requestLogger?: GatewayLogger;
  now?: () => Date;
  sessionIdFactory?: () => string;
  transcriptMessageIdFactory?: () => string;
}

export interface GatewaySocketMessageContext {
  gatewayConfig?: GatewayConfig;
  agentRegistry?: AgentRegistry;
  authContext?: GatewayAuthContext;
  requestedChannelId?: string;
  stores?: GatewayStores;
  channelManager?: ChannelSubscriptionManager;
  emitFrame?: (frame: OutboundFrame) => void;
  now?: () => Date;
  sessionIdFactory?: () => string;
  transcriptMessageIdFactory?: () => string;
}

export async function createGatewayServer(
  config: GatewayConfig,
  options: CreateGatewayServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify(options.fastify);
  const stores = options.stores ?? createInMemoryGatewayStores();
  const requestLogger = options.requestLogger
    ?? (config.server.requestLogging
      ? createGatewayLogger({
          destination: config.server.requestLoggingDestination,
        })
      : undefined);
  const shouldCloseRequestLogger = options.requestLogger === undefined && requestLogger !== undefined;

  if (requestLogger) {
    const requestStartTimes = new WeakMap<object, bigint>();

    if (shouldCloseRequestLogger) {
      app.addHook('onClose', async () => {
        await requestLogger.close();
      });
    }

    app.addHook('onRequest', async (request) => {
      requestStartTimes.set(request.raw, process.hrtime.bigint());

      requestLogger.info('http.request.started', 'HTTP request started', {
        requestId: request.id,
        method: request.method,
        url: sanitizeLoggedUrl(request.url),
        remoteAddress: request.ip,
      });
    });

    app.addHook('onResponse', async (request, reply) => {
      const startedAt = requestStartTimes.get(request.raw);
      const durationMs = startedAt ? Number(process.hrtime.bigint() - startedAt) / 1_000_000 : undefined;

      requestLogger.info('http.request.completed', 'HTTP request completed', {
        requestId: request.id,
        method: request.method,
        url: sanitizeLoggedUrl(request.url),
        statusCode: reply.statusCode,
        remoteAddress: request.ip,
        ...(durationMs === undefined
          ? {}
          : {
              durationMs: Math.round(durationMs * 1000) / 1000,
            }),
      });

      requestStartTimes.delete(request.raw);
    });
  }

  await app.register(websocket);

  app.get<{ Querystring: GatewayUpgradeQuery }>(
    config.server.websocketPath,
    {
      websocket: true,
      preValidation: async (request, reply) => {
        try {
          const authResult = await authenticateGatewayUpgrade({
            config,
            auth: options.auth,
            headers: request.headers,
            url: request.raw.url ?? request.url,
          });

          request.gatewayAuthContext = authResult.authContext;
          request.gatewayRequestedChannelId = authResult.requestedChannelId;
          request.gatewayIsPublicChannel = authResult.isPublicChannel;
        } catch (error) {
          if (error instanceof GatewayAuthError) {
            return reply.code(error.statusCode).send(createAuthErrorFrame(error));
          }

          throw error;
        }
      },
    },
    (socket, request) => {
      const channelManager = createChannelSubscriptionManager();
      const sendFrame = (frame: OutboundFrame, source: 'response' | 'realtime') => {
        if (requestLogger) {
          requestLogger.info('ws.frame.sent', 'WebSocket frame sent', {
            requestId: request.id,
            remoteAddress: request.ip,
            source,
            ...summarizeOutboundFrameForLogging(frame),
          });
        }

        socket.send(serializeOutboundFrame(frame));
      };
      const emitFrame = (frame: OutboundFrame) => {
        sendFrame(frame, 'realtime');
      };

      socket.on('message', async (message: unknown) => {
        if (requestLogger) {
          logInboundWebSocketFrame(requestLogger, request.id, request.ip, message);
        }

        const frame = await handleGatewaySocketMessage(message, {
          gatewayConfig: config,
          agentRegistry: options.agentRegistry,
          authContext: request.gatewayAuthContext,
          requestedChannelId: request.gatewayRequestedChannelId,
          stores,
          channelManager,
          emitFrame,
          now: options.now,
          sessionIdFactory: options.sessionIdFactory,
          transcriptMessageIdFactory: options.transcriptMessageIdFactory,
        });

        sendFrame(frame, 'response');
      });
    },
  );

  if (config.server.healthPath) {
    app.get(config.server.healthPath, async () => ({
      status: 'ok',
      websocketPath: config.server.websocketPath,
    }));
  }

  return app;
}

export async function handleGatewaySocketMessage(
  message: unknown,
  context: GatewaySocketMessageContext = {},
): Promise<OutboundFrame> {
  try {
    const frame = parseInboundFrame(message);
    const realtimeRequestId = context.emitFrame ? randomUUID() : undefined;

    if (frame.type === 'ping') {
      return createPongFrame(frame);
    }

    if (frame.type === 'session.open' && context.stores) {
      return await openGatewaySession(frame, {
        authContext: context.authContext,
        stores: context.stores,
        now: context.now,
        sessionIdFactory: context.sessionIdFactory,
      });
    }

    if (frame.type === 'message.send' && context.stores && context.gatewayConfig && context.agentRegistry) {
      return await executeGatewayChatTurn(frame, {
        gatewayConfig: context.gatewayConfig,
        agentRegistry: context.agentRegistry,
        stores: context.stores,
        authContext: context.authContext,
        now: context.now,
        transcriptMessageIdFactory: context.transcriptMessageIdFactory,
        realtimeEvents:
          realtimeRequestId && context.emitFrame
            ? {
                requestId: realtimeRequestId,
                emitFrame: context.emitFrame,
              }
            : undefined,
      });
    }

    if (frame.type === 'run.start' && context.stores && context.gatewayConfig && context.agentRegistry) {
      return await executeGatewayRunStart(frame, {
        gatewayConfig: context.gatewayConfig,
        agentRegistry: context.agentRegistry,
        stores: context.stores,
        authContext: context.authContext,
        requestedChannelId: context.requestedChannelId,
        now: context.now,
        realtimeEvents:
          realtimeRequestId && context.emitFrame
            ? {
                requestId: realtimeRequestId,
                emitFrame: context.emitFrame,
              }
            : undefined,
      });
    }

    if (frame.type === 'approval.resolve' && context.stores && context.agentRegistry) {
      return await executeGatewayApprovalResolution(frame, {
        agentRegistry: context.agentRegistry,
        stores: context.stores,
        authContext: context.authContext,
        now: context.now,
        realtimeEvents: context.emitFrame
          ? {
              rootRunId: frame.runId,
              emitFrame: context.emitFrame,
            }
          : undefined,
      });
    }

    if (frame.type === 'clarification.resolve' && context.stores && context.agentRegistry) {
      return await executeGatewayClarificationResolution(frame, {
        agentRegistry: context.agentRegistry,
        stores: context.stores,
        authContext: context.authContext,
        now: context.now,
        realtimeEvents: context.emitFrame
          ? {
              rootRunId: frame.runId,
              emitFrame: context.emitFrame,
            }
          : undefined,
      });
    }

    if (frame.type === 'channel.subscribe') {
      const manager = context.channelManager ?? createChannelSubscriptionManager();
      const { valid, invalid } = validateChannelSubscribeFrame(frame);

      if (invalid.length > 0 && valid.length === 0) {
        return createProtocolErrorFrame(
          new ProtocolValidationError(
            'invalid_frame',
            `No valid channel subscriptions in request. Invalid channels: ${invalid.join(', ')}.`,
            { requestType: frame.type, details: { invalid } },
          ),
        );
      }

      manager.subscribe(frame.channels);

      return {
        type: 'session.updated',
        sessionId: '',
        status: 'idle',
        transcriptVersion: 0,
        activeRunId: undefined,
        activeRootRunId: undefined,
      };
    }

    return createProtocolErrorFrame(createUnsupportedFrameError(frame.type));
  } catch (error) {
    const protocolError = normalizeProtocolValidationError(error);

    return createProtocolErrorFrame(protocolError);
  }
}

function logInboundWebSocketFrame(logger: GatewayLogger, requestId: string, remoteAddress: string, message: unknown): void {
  try {
    const frame = parseInboundFrame(message);

    logger.info('ws.frame.received', 'WebSocket frame received', {
      requestId,
      remoteAddress,
      ...summarizeInboundFrameForLogging(frame),
    });
  } catch (error) {
    const protocolError = normalizeProtocolValidationError(error);

    logger.warn('ws.frame.rejected', 'WebSocket frame rejected', {
      requestId,
      remoteAddress,
      code: protocolError.code,
      ...(protocolError.requestType ? { requestType: protocolError.requestType } : {}),
      ...(protocolError.details ? { details: protocolError.details } : {}),
    });
  }
}

function summarizeInboundFrameForLogging(frame: InboundFrame): JsonObject {
  switch (frame.type) {
    case 'session.open':
      return {
        frameType: frame.type,
        ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
        channelId: frame.channelId,
        hasMetadata: frame.metadata !== undefined,
      };
    case 'message.send':
      return {
        frameType: frame.type,
        sessionId: frame.sessionId,
        contentLength: frame.content.length,
        hasMetadata: frame.metadata !== undefined,
      };
    case 'run.start':
      return {
        frameType: frame.type,
        ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
        ...(frame.agentId ? { agentId: frame.agentId } : {}),
        goalLength: frame.goal.length,
        hasInput: frame.input !== undefined,
        hasContext: frame.context !== undefined,
        hasMetadata: frame.metadata !== undefined,
      };
    case 'approval.resolve':
      return {
        frameType: frame.type,
        sessionId: frame.sessionId,
        runId: frame.runId,
        approved: frame.approved,
        hasMetadata: frame.metadata !== undefined,
      };
    case 'clarification.resolve':
      return {
        frameType: frame.type,
        sessionId: frame.sessionId,
        runId: frame.runId,
        messageLength: frame.message.length,
        hasMetadata: frame.metadata !== undefined,
      };
    case 'channel.subscribe':
      return {
        frameType: frame.type,
        channelCount: frame.channels.length,
        channels: frame.channels,
      };
    case 'session.close':
      return {
        frameType: frame.type,
        sessionId: frame.sessionId,
      };
    case 'ping':
      return {
        frameType: frame.type,
        ...(frame.id ? { pingId: frame.id } : {}),
      };
  }
}

function summarizeOutboundFrameForLogging(frame: OutboundFrame): JsonObject {
  switch (frame.type) {
    case 'session.opened':
      return {
        frameType: frame.type,
        sessionId: frame.sessionId,
        channelId: frame.channelId,
        ...(frame.agentId ? { agentId: frame.agentId } : {}),
        status: frame.status,
      };
    case 'session.updated':
      return {
        frameType: frame.type,
        sessionId: frame.sessionId,
        status: frame.status,
        transcriptVersion: frame.transcriptVersion,
        ...(frame.activeRunId ? { activeRunId: frame.activeRunId } : {}),
        ...(frame.activeRootRunId ? { activeRootRunId: frame.activeRootRunId } : {}),
      };
    case 'agent.event':
      return {
        frameType: frame.type,
        eventType: frame.eventType,
        ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
        ...(frame.agentId ? { agentId: frame.agentId } : {}),
        ...(frame.runId ? { runId: frame.runId } : {}),
        ...(frame.rootRunId ? { rootRunId: frame.rootRunId } : {}),
        ...(frame.parentRunId ? { parentRunId: frame.parentRunId } : {}),
      };
    case 'message.output':
      return {
        frameType: frame.type,
        sessionId: frame.sessionId,
        ...(frame.runId ? { runId: frame.runId } : {}),
        ...(frame.rootRunId ? { rootRunId: frame.rootRunId } : {}),
        contentLength: frame.message.content.length,
      };
    case 'run.output':
      return {
        frameType: frame.type,
        runId: frame.runId,
        ...(frame.rootRunId ? { rootRunId: frame.rootRunId } : {}),
        ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
        status: frame.status,
        hasOutput: frame.output !== undefined,
        hasError: frame.error !== undefined,
      };
    case 'approval.requested':
      return {
        frameType: frame.type,
        runId: frame.runId,
        rootRunId: frame.rootRunId,
        ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
        ...(frame.toolName ? { toolName: frame.toolName } : {}),
        hasReason: frame.reason !== undefined,
      };
    case 'error':
      return {
        frameType: frame.type,
        code: frame.code,
        ...(frame.requestType ? { requestType: frame.requestType } : {}),
        hasDetails: frame.details !== undefined,
      };
    case 'pong':
      return {
        frameType: frame.type,
        ...(frame.id ? { pingId: frame.id } : {}),
      };
  }
}

function normalizeProtocolValidationError(error: unknown): ProtocolValidationError {
  return error instanceof ProtocolValidationError
    ? error
    : error instanceof Error
      ? new ProtocolValidationError('invalid_frame', error.message)
      : new ProtocolValidationError('invalid_frame', 'Unexpected WebSocket protocol error.');
}

function sanitizeLoggedUrl(url: string): string {
  const parsedUrl = new URL(url, 'http://gateway.local');
  if (!parsedUrl.searchParams.has('access_token')) {
    return url;
  }

  parsedUrl.searchParams.set('access_token', '[REDACTED]');
  const sanitizedSearch = parsedUrl.searchParams.toString();
  return `${parsedUrl.pathname}${sanitizedSearch ? `?${sanitizedSearch}` : ''}`;
}
