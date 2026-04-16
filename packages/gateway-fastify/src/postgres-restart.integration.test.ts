import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { PostgresRuntimeStoreBundle } from '@adaptive-agent/core';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AgentFactory, AgentRegistryEntry } from './agent-registry.js';
import type { GatewayAuthContext } from './auth.js';
import { bootstrapGateway, type BootstrappedGateway } from './bootstrap.js';
import { createChannelSubscriptionManager } from './channels.js';
import type { RunResult } from './core.js';
import type { OutboundFrame } from './protocol.js';
import { handleGatewaySocketMessage } from './server.js';

const execFile = promisify(execFileCallback);
const runDockerIntegration = process.env.RUN_DOCKER_INTEGRATION_TESTS === '1';
const describeDocker = runDockerIntegration ? describe.sequential : describe.skip;

interface DockerPostgresContainer {
  name: string;
  adminConnectionString: string;
}

interface TestDatabase {
  connectionString: string;
  drop(): Promise<void>;
}

interface TestWorkspace {
  path: string;
  gatewayConfigPath: string;
  agentConfigDir: string;
}

const authContext = createAuthContext('user-123');

describeDocker('Postgres restart integration', () => {
  let container: DockerPostgresContainer | undefined;
  const databases: TestDatabase[] = [];
  const workspaces: string[] = [];

  beforeAll(async () => {
    container = await startDockerPostgresContainer();
  }, 300_000);

  afterEach(async () => {
    await Promise.all(databases.splice(0).reverse().map((database) => database.drop()));
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await Promise.all(databases.splice(0).reverse().map((database) => database.drop()));
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
    if (container) {
      await stopDockerPostgresContainer(container.name);
    }
  });

  it('replays a completed run output after a gateway restart', async () => {
    const database = await createTestDatabase(container!);
    databases.push(database);
    const workspace = await createGatewayWorkspace(database.connectionString);
    workspaces.push(workspace.path);

    const gatewayA = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({
        run: async ({ goal }, runtime) => {
          const runId = '00000000-0000-4000-8000-000000000001';
          await persistRun(runtime, {
            runId,
            goal,
            status: 'succeeded',
            result: { report: 'replayed from postgres' },
          });

          return successResult(runId, { report: 'replayed from postgres' });
        },
      }),
    });

    try {
      const sessionId = await openRunSession(gatewayA, 'session-complete-1');
      const runResponse = await startRun(gatewayA, sessionId, 'complete me');

      expect(runResponse).toEqual({
        type: 'run.output',
        runId: '00000000-0000-4000-8000-000000000001',
        rootRunId: '00000000-0000-4000-8000-000000000001',
        sessionId,
        status: 'succeeded',
        output: { report: 'replayed from postgres' },
      });
    } finally {
      await gatewayA.app.close();
    }

    const gatewayB = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({}),
    });

    try {
      const reconnect = await reopenSession(gatewayB, 'session-complete-1');

      expect(reconnect.response).toEqual({
        type: 'session.opened',
        sessionId: 'session-complete-1',
        channelId: 'webchat',
        agentId: 'support-agent',
        invocationMode: 'run',
        status: 'idle',
      });
      expect(reconnect.emittedFrames).toEqual([
        {
          type: 'session.updated',
          sessionId: 'session-complete-1',
          status: 'idle',
          invocationMode: 'run',
          transcriptVersion: 0,
          activeRunId: undefined,
          activeRootRunId: undefined,
        },
        {
          type: 'run.output',
          runId: '00000000-0000-4000-8000-000000000001',
          rootRunId: '00000000-0000-4000-8000-000000000001',
          sessionId: 'session-complete-1',
          status: 'succeeded',
          output: { report: 'replayed from postgres' },
        },
      ]);
    } finally {
      await gatewayB.app.close();
    }
  });

  it('retries a failed run after restart using the durable session-run link', async () => {
    const database = await createTestDatabase(container!);
    databases.push(database);
    const workspace = await createGatewayWorkspace(database.connectionString);
    workspaces.push(workspace.path);

    const gatewayA = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({
        run: async ({ goal }, runtime) => {
          const runId = '00000000-0000-4000-8000-000000000002';
          await persistRun(runtime, {
            runId,
            goal,
            status: 'failed',
            errorMessage: 'postgres-backed failure',
          });

          return failureResult(runId, 'postgres-backed failure');
        },
      }),
    });

    try {
      const sessionId = await openRunSession(gatewayA, 'session-failed-1');
      const runResponse = await startRun(gatewayA, sessionId, 'fail me');

      expect(runResponse).toEqual({
        type: 'run.output',
        runId: '00000000-0000-4000-8000-000000000002',
        rootRunId: '00000000-0000-4000-8000-000000000002',
        sessionId,
        status: 'failed',
        error: 'postgres-backed failure',
      });
    } finally {
      await gatewayA.app.close();
    }

    const gatewayB = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({
        retry: async (runId, runtime) => {
          const existing = await runtime.runStore.getRun(runId);
          if (!existing) {
            throw new Error(`Missing durable run ${runId}`);
          }

          await persistTerminalUpdate(runtime, existing.id, existing.version, {
            status: 'succeeded',
            result: { recovered: true },
          });

          return successResult(runId, { recovered: true });
        },
      }),
    });

    try {
      const reconnect = await reopenSession(gatewayB, 'session-failed-1');
      expect(reconnect.emittedFrames).toContainEqual({
        type: 'run.output',
        runId: '00000000-0000-4000-8000-000000000002',
        rootRunId: '00000000-0000-4000-8000-000000000002',
        sessionId: 'session-failed-1',
        status: 'failed',
        error: 'postgres-backed failure',
      });

      const retryResponse = await retryRun(gatewayB, 'session-failed-1', '00000000-0000-4000-8000-000000000002');
      expect(retryResponse).toEqual({
        type: 'run.output',
        runId: '00000000-0000-4000-8000-000000000002',
        rootRunId: '00000000-0000-4000-8000-000000000002',
        sessionId: 'session-failed-1',
        status: 'succeeded',
        output: { recovered: true },
      });

      const durableRun = await gatewayB.runtimeStores!.runStore.getRun('00000000-0000-4000-8000-000000000002');
      expect(durableRun?.rootRunId).toBe('00000000-0000-4000-8000-000000000002');
      expect(durableRun?.status).toBe('succeeded');
      expect(durableRun?.result).toEqual({ recovered: true });
    } finally {
      await gatewayB.app.close();
    }
  });

  it('resumes an expired active run after restart', async () => {
    const database = await createTestDatabase(container!);
    databases.push(database);
    const workspace = await createGatewayWorkspace(database.connectionString);
    workspaces.push(workspace.path);

    const gatewayA = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({}),
    });

    try {
      await seedSessionAndRun(gatewayA, {
        sessionId: 'session-running-1',
        runId: '00000000-0000-4000-8000-000000000003',
        status: 'running',
        leaseOwner: 'worker-old',
        leaseExpiresAt: '2026-01-01T00:00:00.000Z',
        heartbeatAt: '2026-01-01T00:00:00.000Z',
      });
    } finally {
      await gatewayA.app.close();
    }

    const gatewayB = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({
        resume: async (runId, runtime) => {
          const existing = await runtime.runStore.getRun(runId);
          if (!existing) {
            throw new Error(`Missing durable run ${runId}`);
          }

          await persistTerminalUpdate(runtime, existing.id, existing.version, {
            status: 'succeeded',
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            heartbeatAt: undefined,
            result: { resumed: true },
          });

          return successResult(runId, { resumed: true });
        },
      }),
    });

    try {
      const reconnect = await reopenSession(gatewayB, 'session-running-1');

      expect(reconnect.response).toEqual({
        type: 'session.opened',
        sessionId: 'session-running-1',
        channelId: 'webchat',
        agentId: 'support-agent',
        invocationMode: 'run',
        status: 'idle',
      });
      expect(reconnect.emittedFrames).toEqual([
        {
          type: 'session.updated',
          sessionId: 'session-running-1',
          status: 'idle',
          invocationMode: 'run',
          transcriptVersion: 0,
          activeRunId: undefined,
          activeRootRunId: undefined,
        },
        {
          type: 'run.output',
          runId: '00000000-0000-4000-8000-000000000003',
          rootRunId: '00000000-0000-4000-8000-000000000003',
          sessionId: 'session-running-1',
          status: 'succeeded',
          output: { resumed: true },
        },
      ]);
    } finally {
      await gatewayB.app.close();
    }
  });

  it('re-presents pending approval after restart', async () => {
    const database = await createTestDatabase(container!);
    databases.push(database);
    const workspace = await createGatewayWorkspace(database.connectionString);
    workspaces.push(workspace.path);

    const gatewayA = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({
        run: async ({ goal }, runtime) => {
          const runId = '00000000-0000-4000-8000-000000000004';
          await persistRun(runtime, {
            runId,
            goal,
            status: 'awaiting_approval',
          });

          return {
            status: 'approval_requested',
            runId,
            message: 'Awaiting approval',
            toolName: 'dangerous_tool',
          } satisfies Extract<RunResult, { status: 'approval_requested' }>;
        },
      }),
    });

    try {
      const sessionId = await openRunSession(gatewayA, 'session-approval-1');
      const runResponse = await startRun(gatewayA, sessionId, 'needs approval');

      expect(runResponse).toEqual({
        type: 'approval.requested',
        runId: '00000000-0000-4000-8000-000000000004',
        rootRunId: '00000000-0000-4000-8000-000000000004',
        sessionId,
        toolName: 'dangerous_tool',
        reason: 'Awaiting approval',
      });
    } finally {
      await gatewayA.app.close();
    }

    const gatewayB = await bootstrapGateway({
      gatewayConfigPath: workspace.gatewayConfigPath,
      agentConfigDir: workspace.agentConfigDir,
      agentFactory: createDurableAgentFactory({}),
    });

    try {
      const reconnect = await reopenSession(gatewayB, 'session-approval-1');

      expect(reconnect.response).toEqual({
        type: 'session.opened',
        sessionId: 'session-approval-1',
        channelId: 'webchat',
        agentId: 'support-agent',
        invocationMode: 'run',
        status: 'awaiting_approval',
      });
      expect(reconnect.emittedFrames).toEqual([
        {
          type: 'session.updated',
          sessionId: 'session-approval-1',
          status: 'awaiting_approval',
          invocationMode: 'run',
          transcriptVersion: 0,
          activeRunId: '00000000-0000-4000-8000-000000000004',
          activeRootRunId: '00000000-0000-4000-8000-000000000004',
        },
        {
          type: 'approval.requested',
          runId: '00000000-0000-4000-8000-000000000004',
          rootRunId: '00000000-0000-4000-8000-000000000004',
          sessionId: 'session-approval-1',
        },
      ]);
    } finally {
      await gatewayB.app.close();
    }
  });
});

function createDurableAgentFactory(options: {
  run?: (request: { goal: string }, runtime: PostgresRuntimeStoreBundle) => Promise<RunResult>;
  retry?: (runId: string, runtime: PostgresRuntimeStoreBundle) => Promise<RunResult>;
  resume?: (runId: string, runtime: PostgresRuntimeStoreBundle) => Promise<RunResult>;
}): AgentFactory {
  return async (entry: AgentRegistryEntry) => {
    const runtime = requirePostgresRuntime(entry);

    return {
      agent: {
        chat: async () => successResult('chat-run-unused', 'ok'),
        run: options.run ? (request) => options.run!(request, runtime) : undefined,
        retry: options.retry ? (runId) => options.retry!(runId, runtime) : undefined,
        resume: options.resume ? (runId) => options.resume!(runId, runtime) : undefined,
      },
      runtime,
    };
  };
}

function requirePostgresRuntime(entry: AgentRegistryEntry): PostgresRuntimeStoreBundle {
  const runtime = entry.runtime as PostgresRuntimeStoreBundle | undefined;
  if (!runtime?.runStore || !runtime.eventStore || !runtime.snapshotStore || !runtime.runInTransaction) {
    throw new Error(`Agent ${entry.definition.agentId} did not receive a Postgres runtime bundle.`);
  }

  return runtime;
}

async function persistRun(
  runtime: PostgresRuntimeStoreBundle,
  options: {
    runId: string;
    goal: string;
    status: 'running' | 'succeeded' | 'failed' | 'awaiting_approval';
    result?: Record<string, unknown>;
    errorMessage?: string;
    leaseOwner?: string;
    leaseExpiresAt?: string;
    heartbeatAt?: string;
  },
): Promise<void> {
  await runtime.runInTransaction(async (stores) => {
    const createdRun = await stores.runStore.createRun({
      id: options.runId,
      goal: options.goal,
      status: 'running',
      metadata: {
        source: 'docker-integration-test',
      },
    });

    await stores.eventStore?.append({
      runId: options.runId,
      type: 'run.created',
      schemaVersion: 1,
      payload: {
        goal: options.goal,
      },
    });

    let currentRun = createdRun;
    if (options.leaseOwner || options.leaseExpiresAt || options.heartbeatAt) {
      currentRun = await stores.runStore.updateRun(
        options.runId,
        {
          leaseOwner: options.leaseOwner,
          leaseExpiresAt: options.leaseExpiresAt,
          heartbeatAt: options.heartbeatAt,
        },
        currentRun.version,
      );
    }

    if (
      options.status !== 'running' ||
      options.result !== undefined ||
      options.errorMessage !== undefined
    ) {
      currentRun = await stores.runStore.updateRun(
        options.runId,
        {
          status: options.status,
          result: options.result,
          errorMessage: options.errorMessage,
        },
        currentRun.version,
      );
      await stores.eventStore?.append({
        runId: options.runId,
        type: options.status === 'failed' ? 'run.failed' : 'run.completed',
        schemaVersion: 1,
        payload:
          options.status === 'failed'
            ? { errorMessage: options.errorMessage ?? 'failed' }
            : { status: options.status },
      });
    }

    await stores.snapshotStore?.save({
      runId: options.runId,
      snapshotSeq: 1,
      status: currentRun.status,
      summary: {
        status: currentRun.status,
      },
      state: {
        schemaVersion: 1,
        goal: options.goal,
        status: currentRun.status,
        result: options.result ?? null,
        errorMessage: options.errorMessage ?? null,
      },
    });
  });
}

async function persistTerminalUpdate(
  runtime: PostgresRuntimeStoreBundle,
  runId: string,
  expectedVersion: number,
  patch: {
    status: 'succeeded' | 'failed';
    result?: Record<string, unknown>;
    errorMessage?: string;
    leaseOwner?: string;
    leaseExpiresAt?: string;
    heartbeatAt?: string;
  },
): Promise<void> {
  await runtime.runInTransaction(async (stores) => {
    const updatedRun = await stores.runStore.updateRun(
      runId,
      {
        status: patch.status,
        result: patch.result,
        errorMessage: patch.errorMessage,
        leaseOwner: patch.leaseOwner,
        leaseExpiresAt: patch.leaseExpiresAt,
        heartbeatAt: patch.heartbeatAt,
      },
      expectedVersion,
    );

    await stores.eventStore?.append({
      runId,
      type: patch.status === 'failed' ? 'run.failed' : 'run.completed',
      schemaVersion: 1,
      payload:
        patch.status === 'failed'
          ? { errorMessage: patch.errorMessage ?? 'failed' }
          : { status: patch.status },
    });

    const latestSnapshot = await stores.snapshotStore?.getLatest(runId);
    await stores.snapshotStore?.save({
      runId,
      snapshotSeq: (latestSnapshot?.snapshotSeq ?? 1) + 1,
      status: updatedRun.status,
      summary: {
        status: updatedRun.status,
      },
      state: {
        schemaVersion: 1,
        status: updatedRun.status,
        result: patch.result ?? null,
        errorMessage: patch.errorMessage ?? null,
      },
    });
  });
}

async function seedSessionAndRun(
  gateway: BootstrappedGateway,
  options: {
    sessionId: string;
    runId: string;
    status: 'running';
    leaseOwner: string;
    leaseExpiresAt: string;
    heartbeatAt: string;
  },
): Promise<void> {
  await gateway.stores.sessions.create({
    id: options.sessionId,
    channelId: 'webchat',
    agentId: 'support-agent',
    invocationMode: 'run',
    authSubject: authContext.subject,
    tenantId: authContext.tenantId,
    status: 'running',
    currentRunId: options.runId,
    currentRootRunId: options.runId,
    transcriptVersion: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await gateway.stores.sessionRunLinks.append({
    sessionId: options.sessionId,
    runId: options.runId,
    rootRunId: options.runId,
    invocationKind: 'run',
    metadata: {
      seeded: true,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await persistRun(gateway.runtimeStores!, {
    runId: options.runId,
    goal: 'resume me',
    status: 'running',
    leaseOwner: options.leaseOwner,
    leaseExpiresAt: options.leaseExpiresAt,
    heartbeatAt: options.heartbeatAt,
  });
}

function successResult(runId: string, output: unknown): Extract<RunResult, { status: 'success' }> {
  return {
    status: 'success',
    runId,
    output: output as never,
    stepsUsed: 1,
    usage: { promptTokens: 0, completionTokens: 0, estimatedCostUSD: 0 },
  };
}

function failureResult(runId: string, error: string): Extract<RunResult, { status: 'failure' }> {
  return {
    status: 'failure',
    runId,
    error,
    code: 'MODEL_ERROR',
    stepsUsed: 1,
    usage: { promptTokens: 0, completionTokens: 0, estimatedCostUSD: 0 },
  };
}

async function openRunSession(gateway: BootstrappedGateway, sessionId: string): Promise<string> {
  const response = await handleGatewaySocketMessage(
    JSON.stringify({
      type: 'session.open',
      channelId: 'webchat',
    }),
    {
      authContext,
      stores: gateway.stores,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      sessionIdFactory: () => sessionId,
    },
  );

  expect(response).toEqual({
    type: 'session.opened',
    sessionId,
    channelId: 'webchat',
    agentId: undefined,
    status: 'idle',
  });

  return sessionId;
}

async function startRun(gateway: BootstrappedGateway, sessionId: string, goal: string): Promise<OutboundFrame> {
  return handleGatewaySocketMessage(
    JSON.stringify({
      type: 'run.start',
      sessionId,
      goal,
    }),
    {
      gatewayConfig: gateway.gatewayConfig,
      agentRegistry: gateway.agentRegistry,
      stores: gateway.stores,
      authContext,
      now: () => new Date('2026-01-01T00:00:01.000Z'),
    },
  );
}

async function retryRun(gateway: BootstrappedGateway, sessionId: string, runId: string): Promise<OutboundFrame> {
  return handleGatewaySocketMessage(
    JSON.stringify({
      type: 'run.retry',
      sessionId,
      runId,
    }),
    {
      gatewayConfig: gateway.gatewayConfig,
      agentRegistry: gateway.agentRegistry,
      stores: gateway.stores,
      authContext,
      now: () => new Date('2026-01-01T00:00:02.000Z'),
    },
  );
}

async function reopenSession(
  gateway: BootstrappedGateway,
  sessionId: string,
): Promise<{ response: OutboundFrame; emittedFrames: OutboundFrame[] }> {
  const channelManager = createChannelSubscriptionManager();
  const emittedFrames: OutboundFrame[] = [];
  const postResponseTasks: Array<() => Promise<void>> = [];

  const response = await handleGatewaySocketMessage(
    JSON.stringify({
      type: 'session.open',
      sessionId,
      channelId: 'webchat',
    }),
    {
      gatewayConfig: gateway.gatewayConfig,
      agentRegistry: gateway.agentRegistry,
      stores: gateway.stores,
      authContext,
      channelManager,
      emitFrame: async (frame) => {
        emittedFrames.push(frame);
      },
      postResponseTasks,
      now: () => new Date('2026-01-01T00:00:03.000Z'),
    },
  );

  for (const task of postResponseTasks) {
    await task();
  }

  return {
    response,
    emittedFrames,
  };
}

function createAuthContext(subject: string): GatewayAuthContext {
  return {
    subject,
    tenantId: 'acme',
    roles: ['member'],
    claims: { sub: subject, tenantId: 'acme', roles: ['member'] },
  };
}

async function createGatewayWorkspace(connectionString: string): Promise<TestWorkspace> {
  const workspace = await mkdtemp(join(tmpdir(), 'gateway-postgres-restart-'));
  const gatewayConfigPath = join(workspace, 'gateway.json');
  const agentConfigDir = join(workspace, 'agents');
  await mkdir(agentConfigDir, { recursive: true });

  await writeFile(
    gatewayConfigPath,
    JSON.stringify(
      {
        server: {
          host: '127.0.0.1',
          port: 3000,
          websocketPath: '/ws',
        },
        stores: {
          kind: 'postgres',
          connectionString,
          ssl: false,
        },
        bindings: [
          {
            match: {
              channelId: 'webchat',
            },
            agentId: 'support-agent',
          },
        ],
        defaultAgentId: 'support-agent',
        hooks: {
          failurePolicy: 'fail',
          modules: [],
          onAuthenticate: [],
          onSessionResolve: [],
          beforeRoute: [],
          beforeInboundMessage: [],
          beforeRunStart: [],
          afterRunResult: [],
          onAgentEvent: [],
          beforeOutboundFrame: [],
          onDisconnect: [],
          onError: [],
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(agentConfigDir, 'support-agent.json'),
    JSON.stringify(
      {
        id: 'support-agent',
        name: 'Support Agent',
        invocationModes: ['chat', 'run'],
        defaultInvocationMode: 'chat',
        model: {
          provider: 'ollama',
          model: 'test-model',
        },
        tools: [],
        delegates: [],
      },
      null,
      2,
    ),
  );

  return {
    path: workspace,
    gatewayConfigPath,
    agentConfigDir,
  };
}

async function startDockerPostgresContainer(): Promise<DockerPostgresContainer> {
  const containerName = `adaptive-agent-postgres-${randomUUID()}`;
  const user = 'adaptive_agent';
  const password = 'adaptive_agent_pw';

  await execFile('docker', [
    'run',
    '--detach',
    '--publish-all',
    '--name',
    containerName,
    '--env',
    `POSTGRES_USER=${user}`,
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    'postgres:16-alpine',
  ]);

  const { stdout } = await execFile('docker', ['port', containerName, '5432/tcp']);
  const port = parseDockerPort(stdout);
  const adminConnectionString = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;
  await waitForPostgres(adminConnectionString);

  return {
    name: containerName,
    adminConnectionString,
  };
}

async function stopDockerPostgresContainer(containerName: string): Promise<void> {
  try {
    await execFile('docker', ['rm', '--force', containerName]);
  } catch {
    // Best effort cleanup for local Docker test containers.
  }
}

function parseDockerPort(stdout: string): number {
  const match = stdout
    .trim()
    .split('\n')
    .map((line) => line.match(/:(\d+)$/))
    .find((entry): entry is RegExpMatchArray => entry !== null);
  if (!match) {
    throw new Error(`Could not parse Docker port mapping from: ${stdout}`);
  }

  return Number(match[1]);
}

async function waitForPostgres(connectionString: string): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 60_000) {
    const pool = new Pool({ connectionString });
    try {
      await pool.query('select 1');
      await pool.end();
      return;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Timed out waiting for Postgres to become ready: ${String(lastError)}`);
}

async function createTestDatabase(container: DockerPostgresContainer): Promise<TestDatabase> {
  const databaseName = `adaptive_agent_${randomUUID().replace(/-/g, '')}`;
  const adminPool = new Pool({ connectionString: container.adminConnectionString });
  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await adminPool.end();
  }

  const connectionUrl = new URL(container.adminConnectionString);
  connectionUrl.pathname = `/${databaseName}`;

  return {
    connectionString: connectionUrl.toString(),
    async drop(): Promise<void> {
      const pool = new Pool({ connectionString: container.adminConnectionString });
      try {
        await pool.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [databaseName],
        );
        await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
      } finally {
        await pool.end();
      }
    },
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
