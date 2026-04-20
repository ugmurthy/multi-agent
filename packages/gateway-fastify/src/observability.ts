import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join, resolve } from 'node:path';

import type { GatewayRequestLogLevel } from './config.js';
import type { JsonObject } from './core.js';

export type GatewayHealthState = 'healthy' | 'startup_failed' | 'degraded';

export interface GatewayHealthReport {
  state: GatewayHealthState;
  startedAt: string;
  checkedAt: string;
  websocketPath: string;
  agents: number;
  stores: StorageBackendStatus;
  scheduler: SchedulerStatus;
  errors: string[];
}

export interface StorageBackendStatus {
  kind: 'memory' | 'file' | 'postgres';
  available: boolean;
}

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
}

export interface GatewayCounters {
  sessionsCreated: number;
  sessionsReattached: number;
  activeRuns: number;
  chatTurns: number;
  structuredRuns: number;
  approvalResolutions: number;
  authFailures: number;
  routingMisses: number;
  cronClaims: number;
  cronFailures: number;
  hookFailures: number;
  protocolErrors: number;
}

export type GatewayLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type GatewayLogDestination = 'console' | 'file' | 'both';

export const DEFAULT_GATEWAY_REQUEST_LOG_DIR = join('data', 'gateway', 'logs');

export interface GatewayLogEntry {
  level: GatewayLogLevel;
  event: string;
  message: string;
  timestamp: string;
  data?: JsonObject;
}

export type GatewayLogSink = (entry: GatewayLogEntry) => void;

export interface CreateGatewayLoggerOptions {
  sink?: GatewayLogSink;
  destination?: GatewayLogDestination;
  level?: GatewayRequestLogLevel;
  logDir?: string;
  now?: () => Date;
}

export interface GatewayHealthManager {
  getHealth(): GatewayHealthReport;
  setState(state: GatewayHealthState, error?: string): void;
  setStores(status: StorageBackendStatus): void;
  setScheduler(status: SchedulerStatus): void;
  setAgentCount(count: number): void;
}

export interface GatewayMetrics {
  counters: Readonly<GatewayCounters>;
  increment(counter: keyof GatewayCounters, amount?: number): void;
  decrement(counter: keyof GatewayCounters, amount?: number): void;
  reset(): void;
}

export interface GatewayLogger {
  debug(event: string, message: string, data?: JsonObject): void;
  info(event: string, message: string, data?: JsonObject): void;
  warn(event: string, message: string, data?: JsonObject): void;
  error(event: string, message: string, data?: JsonObject): void;
  close(): Promise<void>;
}

export function createGatewayHealthManager(options: {
  websocketPath: string;
  now?: () => Date;
}): GatewayHealthManager {
  const startedAt = (options.now ?? (() => new Date()))().toISOString();
  let state: GatewayHealthState = 'healthy';
  let agents = 0;
  let stores: StorageBackendStatus = { kind: 'memory', available: true };
  let scheduler: SchedulerStatus = { enabled: false, running: false };
  const errors: string[] = [];

  return {
    getHealth(): GatewayHealthReport {
      return {
        state,
        startedAt,
        checkedAt: (options.now ?? (() => new Date()))().toISOString(),
        websocketPath: options.websocketPath,
        agents,
        stores: { ...stores },
        scheduler: { ...scheduler },
        errors: [...errors],
      };
    },

    setState(newState: GatewayHealthState, error?: string): void {
      state = newState;
      if (error) {
        errors.push(error);
      }
    },

    setStores(status: StorageBackendStatus): void {
      stores = { ...status };
      if (!status.available && state === 'healthy') {
        state = 'degraded';
      }
    },

    setScheduler(status: SchedulerStatus): void {
      scheduler = { ...status };
    },

    setAgentCount(count: number): void {
      agents = count;
    },
  };
}

export function createGatewayMetrics(): GatewayMetrics {
  const counters: GatewayCounters = {
    sessionsCreated: 0,
    sessionsReattached: 0,
    activeRuns: 0,
    chatTurns: 0,
    structuredRuns: 0,
    approvalResolutions: 0,
    authFailures: 0,
    routingMisses: 0,
    cronClaims: 0,
    cronFailures: 0,
    hookFailures: 0,
    protocolErrors: 0,
  };

  return {
    get counters(): Readonly<GatewayCounters> {
      return { ...counters };
    },

    increment(counter: keyof GatewayCounters, amount = 1): void {
      counters[counter] += amount;
    },

    decrement(counter: keyof GatewayCounters, amount = 1): void {
      counters[counter] = Math.max(0, counters[counter] - amount);
    },

    reset(): void {
      for (const key of Object.keys(counters) as Array<keyof GatewayCounters>) {
        counters[key] = 0;
      }
    },
  };
}

export function createGatewayLogger(options: GatewayLogSink | CreateGatewayLoggerOptions = {}): GatewayLogger {
  const resolvedOptions = typeof options === 'function' ? { sink: options } : options;
  const minimumLevel = resolvedOptions.level ?? 'info';
  const { sink: logSink, close } = resolvedOptions.sink
    ? {
        sink: resolvedOptions.sink,
        close: async () => {},
      }
    : createGatewayLogSink(resolvedOptions);

  function log(level: GatewayLogLevel, event: string, message: string, data?: JsonObject): void {
    if (!shouldEmitGatewayLog(level, minimumLevel)) {
      return;
    }

    logSink({
      level,
      event,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  return {
    debug: (event, message, data) => log('debug', event, message, data),
    info: (event, message, data) => log('info', event, message, data),
    warn: (event, message, data) => log('warn', event, message, data),
    error: (event, message, data) => log('error', event, message, data),
    close,
  };
}

function shouldEmitGatewayLog(level: GatewayLogLevel, minimumLevel: GatewayRequestLogLevel): boolean {
  const severity: Record<GatewayLogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  const threshold: Record<GatewayRequestLogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    silent: Number.POSITIVE_INFINITY,
  };

  return severity[level] >= threshold[minimumLevel];
}

function createGatewayLogSink(options: CreateGatewayLoggerOptions): {
  sink: GatewayLogSink;
  close: () => Promise<void>;
} {
  const destination = options.destination ?? 'console';

  if (destination === 'console') {
    return {
      sink: defaultLogSink,
      close: async () => {},
    };
  }

  const fileSink = createGatewayFileLogSink({
    logDir: options.logDir ?? DEFAULT_GATEWAY_REQUEST_LOG_DIR,
    now: options.now,
  });

  if (destination === 'file') {
    return fileSink;
  }

  return {
    sink: (entry) => {
      defaultLogSink(entry);
      fileSink.sink(entry);
    },
    close: fileSink.close,
  };
}

function createGatewayFileLogSink(options: {
  logDir: string;
  now?: () => Date;
}): {
  sink: GatewayLogSink;
  close: () => Promise<void>;
} {
  const logDir = resolve(options.logDir);
  const filePath = join(logDir, `gateway-${formatLogDate((options.now ?? (() => new Date()))())}.log`);

  mkdirSync(logDir, { recursive: true });

  const stream = createWriteStream(filePath, {
    flags: 'a',
  });

  // Keep request logging best-effort instead of crashing the gateway if the log file becomes unavailable.
  stream.on('error', (error) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'gateway.request_log_sink.failed',
        message: 'Gateway request log sink failed',
        timestamp: new Date().toISOString(),
        data: {
          filePath,
          error: error.message,
        },
      }),
    );
  });

  return {
    sink: (entry) => {
      stream.write(`${JSON.stringify(entry)}\n`);
    },
    close: async () => {
      await closeWriteStream(stream);
    },
  };
}

function formatLogDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function closeWriteStream(stream: WriteStream): Promise<void> {
  if (stream.closed || stream.destroyed) {
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const handleError = (error: Error) => {
      stream.off('finish', handleFinish);
      rejectPromise(error);
    };

    const handleFinish = () => {
      stream.off('error', handleError);
      resolvePromise();
    };

    stream.once('error', handleError);
    stream.once('finish', handleFinish);
    stream.end();
  });
}

function defaultLogSink(entry: GatewayLogEntry): void {
  const line = JSON.stringify(entry);

  switch (entry.level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
      break;
  }
}

export const GATEWAY_LOG_EVENTS = {
  auth_failure: 'auth.failure',
  auth_success: 'auth.success',
  session_created: 'session.created',
  session_reattached: 'session.reattached',
  session_closed: 'session.closed',
  route_resolved: 'route.resolved',
  route_miss: 'route.miss',
  chat_started: 'chat.started',
  chat_completed: 'chat.completed',
  chat_failed: 'chat.failed',
  run_started: 'run.started',
  run_completed: 'run.completed',
  run_failed: 'run.failed',
  approval_requested: 'approval.requested',
  approval_resolved: 'approval.resolved',
  hook_failure: 'hook.failure',
  cron_claimed: 'cron.claimed',
  cron_dispatched: 'cron.dispatched',
  cron_completed: 'cron.completed',
  cron_failed: 'cron.failed',
  cron_file_imported: 'cron.file.imported',
  cron_file_updated: 'cron.file.updated',
  cron_file_sync_completed: 'cron.file_sync.completed',
  cron_file_sync_failed: 'cron.file_sync.failed',
  protocol_error: 'protocol.error',
  health_changed: 'health.changed',
  gateway_started: 'gateway.server.started',
  gateway_stopping: 'gateway.server.stopping',
  gateway_stopped: 'gateway.server.stopped',
} as const;

export type GatewayLogEvent = (typeof GATEWAY_LOG_EVENTS)[keyof typeof GATEWAY_LOG_EVENTS];
