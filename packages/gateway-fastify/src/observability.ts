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

export interface GatewayLogEntry {
  level: GatewayLogLevel;
  event: string;
  message: string;
  timestamp: string;
  data?: JsonObject;
}

export type GatewayLogSink = (entry: GatewayLogEntry) => void;

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

export function createGatewayLogger(sink?: GatewayLogSink): GatewayLogger {
  const logSink: GatewayLogSink = sink ?? defaultLogSink;

  function log(level: GatewayLogLevel, event: string, message: string, data?: JsonObject): void {
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
  };
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
  cron_failed: 'cron.failed',
  protocol_error: 'protocol.error',
  health_changed: 'health.changed',
} as const;

export type GatewayLogEvent = (typeof GATEWAY_LOG_EVENTS)[keyof typeof GATEWAY_LOG_EVENTS];
