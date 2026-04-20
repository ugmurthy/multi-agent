import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createGatewayHealthManager,
  createGatewayMetrics,
  createGatewayLogger,
  GATEWAY_LOG_EVENTS,
  type GatewayLogEntry,
} from './observability.js';

const fixedNow = () => new Date('2026-01-15T12:00:00.000Z');

describe('createGatewayHealthManager', () => {
  it('starts in healthy state with basic metadata', () => {
    const health = createGatewayHealthManager({
      websocketPath: '/ws',
      now: fixedNow,
    });

    const report = health.getHealth();
    expect(report.state).toBe('healthy');
    expect(report.startedAt).toBe('2026-01-15T12:00:00.000Z');
    expect(report.websocketPath).toBe('/ws');
    expect(report.agents).toBe(0);
    expect(report.stores.kind).toBe('memory');
    expect(report.stores.available).toBe(true);
    expect(report.scheduler.enabled).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it('transitions to startup_failed with an error', () => {
    const health = createGatewayHealthManager({ websocketPath: '/ws', now: fixedNow });
    health.setState('startup_failed', 'Config validation failed');

    const report = health.getHealth();
    expect(report.state).toBe('startup_failed');
    expect(report.errors).toEqual(['Config validation failed']);
  });

  it('transitions to degraded when stores become unavailable', () => {
    const health = createGatewayHealthManager({ websocketPath: '/ws', now: fixedNow });
    health.setStores({ kind: 'postgres', available: false });

    const report = health.getHealth();
    expect(report.state).toBe('degraded');
    expect(report.stores.kind).toBe('postgres');
    expect(report.stores.available).toBe(false);
  });

  it('does not downgrade from startup_failed to degraded on store change', () => {
    const health = createGatewayHealthManager({ websocketPath: '/ws', now: fixedNow });
    health.setState('startup_failed', 'bad config');
    health.setStores({ kind: 'postgres', available: false });

    expect(health.getHealth().state).toBe('startup_failed');
  });

  it('tracks scheduler status', () => {
    const health = createGatewayHealthManager({ websocketPath: '/ws', now: fixedNow });
    health.setScheduler({ enabled: true, running: true });

    const report = health.getHealth();
    expect(report.scheduler.enabled).toBe(true);
    expect(report.scheduler.running).toBe(true);
  });

  it('tracks agent count', () => {
    const health = createGatewayHealthManager({ websocketPath: '/ws', now: fixedNow });
    health.setAgentCount(3);

    expect(health.getHealth().agents).toBe(3);
  });

  it('returns cloned report data', () => {
    const health = createGatewayHealthManager({ websocketPath: '/ws', now: fixedNow });
    const report1 = health.getHealth();
    const report2 = health.getHealth();
    expect(report1).toEqual(report2);
    expect(report1).not.toBe(report2);
    expect(report1.errors).not.toBe(report2.errors);
  });
});

describe('createGatewayMetrics', () => {
  it('starts all counters at zero', () => {
    const metrics = createGatewayMetrics();
    expect(metrics.counters.sessionsCreated).toBe(0);
    expect(metrics.counters.authFailures).toBe(0);
    expect(metrics.counters.activeRuns).toBe(0);
  });

  it('increments counters', () => {
    const metrics = createGatewayMetrics();
    metrics.increment('sessionsCreated');
    metrics.increment('sessionsCreated');
    metrics.increment('chatTurns', 3);

    expect(metrics.counters.sessionsCreated).toBe(2);
    expect(metrics.counters.chatTurns).toBe(3);
  });

  it('decrements counters without going below zero', () => {
    const metrics = createGatewayMetrics();
    metrics.increment('activeRuns', 5);
    metrics.decrement('activeRuns', 2);
    expect(metrics.counters.activeRuns).toBe(3);

    metrics.decrement('activeRuns', 10);
    expect(metrics.counters.activeRuns).toBe(0);
  });

  it('resets all counters to zero', () => {
    const metrics = createGatewayMetrics();
    metrics.increment('sessionsCreated', 10);
    metrics.increment('authFailures', 5);
    metrics.reset();

    expect(metrics.counters.sessionsCreated).toBe(0);
    expect(metrics.counters.authFailures).toBe(0);
  });

  it('returns a snapshot (not a mutable reference)', () => {
    const metrics = createGatewayMetrics();
    metrics.increment('chatTurns');
    const snapshot = metrics.counters;
    metrics.increment('chatTurns');

    expect(snapshot.chatTurns).toBe(1);
    expect(metrics.counters.chatTurns).toBe(2);
  });
});

describe('createGatewayLogger', () => {
  it('emits structured log entries to a custom sink', () => {
    const entries: GatewayLogEntry[] = [];
    const logger = createGatewayLogger((entry) => entries.push(entry));

    logger.info('session.created', 'Session sess-1 created', { sessionId: 'sess-1' });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe('info');
    expect(entries[0]!.event).toBe('session.created');
    expect(entries[0]!.message).toBe('Session sess-1 created');
    expect(entries[0]!.data).toEqual({ sessionId: 'sess-1' });
    expect(entries[0]!.timestamp).toBeDefined();
  });

  it('supports all log levels', () => {
    const entries: GatewayLogEntry[] = [];
    const logger = createGatewayLogger({
      sink: (entry) => entries.push(entry),
      level: 'debug',
    });

    logger.debug('test.debug', 'debug msg');
    logger.info('test.info', 'info msg');
    logger.warn('test.warn', 'warn msg');
    logger.error('test.error', 'error msg');

    expect(entries.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('filters logs below the configured request log level', () => {
    const entries: GatewayLogEntry[] = [];
    const logger = createGatewayLogger({
      sink: (entry) => entries.push(entry),
      level: 'warn',
    });

    logger.debug('test.debug', 'debug msg');
    logger.info('test.info', 'info msg');
    logger.warn('test.warn', 'warn msg');
    logger.error('test.error', 'error msg');

    expect(entries.map((entry) => entry.level)).toEqual(['warn', 'error']);
  });

  it('suppresses all logs when configured as silent', () => {
    const entries: GatewayLogEntry[] = [];
    const logger = createGatewayLogger({
      sink: (entry) => entries.push(entry),
      level: 'silent',
    });

    logger.debug('test.debug', 'debug msg');
    logger.info('test.info', 'info msg');
    logger.warn('test.warn', 'warn msg');
    logger.error('test.error', 'error msg');

    expect(entries).toEqual([]);
  });

  it('logs without data when not provided', () => {
    const entries: GatewayLogEntry[] = [];
    const logger = createGatewayLogger((entry) => entries.push(entry));

    logger.info('session.closed', 'Session closed');

    expect(entries[0]!.data).toBeUndefined();
  });

  it('uses the default console sink when no sink is provided', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const logger = createGatewayLogger();
      logger.info('test', 'info message');
      logger.error('test', 'error message');
      logger.warn('test', 'warn message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const infoLine = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(infoLine.level).toBe('info');
      expect(infoLine.event).toBe('test');
    } finally {
      consoleSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('writes structured log entries to a file destination', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'gateway-request-logs-'));

    try {
      const logger = createGatewayLogger({
        destination: 'file',
        logDir,
        now: fixedNow,
      });

      logger.info('http.request.started', 'HTTP request started', {
        requestId: 'req-1',
      });
      await logger.close();

      const fileContents = await readFile(join(logDir, 'gateway-2026-01-15.log'), 'utf8');
      const entry = JSON.parse(fileContents.trim()) as GatewayLogEntry;

      expect(entry.level).toBe('info');
      expect(entry.event).toBe('http.request.started');
      expect(entry.message).toBe('HTTP request started');
      expect(entry.data).toEqual({ requestId: 'req-1' });
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});

describe('GATEWAY_LOG_EVENTS', () => {
  it('defines events for all tracked operational categories', () => {
    expect(GATEWAY_LOG_EVENTS.auth_failure).toBe('auth.failure');
    expect(GATEWAY_LOG_EVENTS.session_created).toBe('session.created');
    expect(GATEWAY_LOG_EVENTS.route_resolved).toBe('route.resolved');
    expect(GATEWAY_LOG_EVENTS.route_miss).toBe('route.miss');
    expect(GATEWAY_LOG_EVENTS.chat_started).toBe('chat.started');
    expect(GATEWAY_LOG_EVENTS.run_started).toBe('run.started');
    expect(GATEWAY_LOG_EVENTS.hook_failure).toBe('hook.failure');
    expect(GATEWAY_LOG_EVENTS.cron_claimed).toBe('cron.claimed');
    expect(GATEWAY_LOG_EVENTS.cron_completed).toBe('cron.completed');
    expect(GATEWAY_LOG_EVENTS.cron_file_imported).toBe('cron.file.imported');
    expect(GATEWAY_LOG_EVENTS.cron_file_updated).toBe('cron.file.updated');
    expect(GATEWAY_LOG_EVENTS.cron_file_sync_completed).toBe('cron.file_sync.completed');
    expect(GATEWAY_LOG_EVENTS.cron_file_sync_failed).toBe('cron.file_sync.failed');
    expect(GATEWAY_LOG_EVENTS.protocol_error).toBe('protocol.error');
    expect(GATEWAY_LOG_EVENTS.health_changed).toBe('health.changed');
  });
});
