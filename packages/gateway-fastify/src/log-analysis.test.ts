import { describe, expect, it } from 'vitest';

import { analyzeLogEntries } from './log-analysis/analyzer.js';
import { parseLogLine } from './log-analysis/parser.js';
import { renderReport } from './log-analysis/render.js';
import type { NormalizedLogEntry } from './log-analysis/types.js';

describe('gateway log analysis', () => {
  it('normalizes gateway request logs', () => {
    const result = parseLogLine(
      JSON.stringify({
        level: 'info',
        event: 'ws.frame.sent',
        message: 'WebSocket frame sent',
        timestamp: '2026-04-15T00:00:00.000Z',
        data: {
          frameType: 'session.opened',
          sessionId: 'sess-1',
          agentId: 'agent-a',
        },
      }),
      '/logs/gateway-2026-04-15.log',
      1,
    );

    expect(result.issue).toBeUndefined();
    expect(result.entry).toMatchObject({
      source: 'gateway',
      event: 'ws.frame.sent',
      timestamp: '2026-04-15T00:00:00.000Z',
      data: {
        frameType: 'session.opened',
        sessionId: 'sess-1',
        agentId: 'agent-a',
      },
    });
  });

  it('normalizes runtime pino logs', () => {
    const result = parseLogLine(
      JSON.stringify({
        level: 50,
        time: Date.parse('2026-04-15T00:00:05.000Z'),
        name: 'adaptive-agent-gateway-runtime',
        event: 'run.failed',
        runId: 'run-1',
        rootRunId: 'root-1',
        agentId: 'agent-a',
        msg: 'run.failed',
      }),
      '/logs/agent-runtime-2026-04-15.log',
      1,
    );

    expect(result.issue).toBeUndefined();
    expect(result.entry).toMatchObject({
      source: 'runtime',
      level: 'error',
      event: 'run.failed',
      timestamp: '2026-04-15T00:00:05.000Z',
      data: {
        event: 'run.failed',
        runId: 'run-1',
        rootRunId: 'root-1',
        agentId: 'agent-a',
      },
    });
  });

  it('builds summary counters and global failure patterns', () => {
    const entries = parseEntries([
      gateway('2026-04-15T00:00:00.000Z', 'ws.frame.sent', {
        frameType: 'session.opened',
        sessionId: 'sess-1',
        agentId: 'agent-a',
      }),
      runtime('2026-04-15T00:00:01.000Z', 'run.created', {
        runId: 'run-1',
        rootRunId: 'run-1',
        agentId: 'agent-a',
      }),
      runtime('2026-04-15T00:00:02.000Z', 'tool.completed', {
        runId: 'run-1',
        rootRunId: 'run-1',
        toolName: 'read_file',
        agentId: 'agent-a',
      }),
      runtime('2026-04-15T00:00:03.000Z', 'run.completed', {
        runId: 'run-1',
        rootRunId: 'run-1',
        agentId: 'agent-a',
      }),
      gateway('2026-04-15T00:00:04.000Z', 'ws.frame.sent', {
        frameType: 'error',
        code: 'session_busy',
        requestType: 'message.send',
        sessionId: 'sess-1',
      }, 'warn'),
    ]);

    const report = analyzeLogEntries(entries);

    expect(report.counters.sessionsOpened).toBe(1);
    expect(report.counters.runsStarted).toBe(1);
    expect(report.counters.runsSucceeded).toBe(1);
    expect(report.counters.protocolErrors).toBe(1);
    expect(report.top.completedTools).toEqual([{ key: 'read_file', count: 1 }]);
    expect(report.top.failureCodes).toEqual([{ key: 'session_busy', count: 1 }]);
  });

  it('filters and renders session timelines with local timezone clock time', () => {
    const entries = parseEntries([
      gateway('2026-04-15T00:00:00.000Z', 'ws.frame.sent', {
        frameType: 'session.opened',
        sessionId: 'sess-1',
      }),
      gateway('2026-04-15T00:00:10.000Z', 'ws.frame.sent', {
        frameType: 'session.opened',
        sessionId: 'sess-2',
      }),
      runtime('2026-04-15T00:00:20.000Z', 'run.failed', {
        runId: 'run-1',
        rootRunId: 'run-1',
        sessionId: 'sess-1',
        toolName: 'shell_exec',
      }),
    ]);

    const report = analyzeLogEntries(entries, [], { filter: { sessionId: 'sess-1' } });
    const rendered = renderReport(report, { detailed: true, timeZone: 'Asia/Kolkata' });

    expect(report.timeline).toHaveLength(2);
    expect(rendered).toContain('05:30:00');
    expect(rendered).toContain('05:30:20');
    expect(rendered).toContain('session=sess-1');
    expect(rendered).not.toContain('session=sess-2');
  });

  it('renders compact output by default without the timeline section', () => {
    const entries = parseEntries([
      gateway('2026-04-15T00:00:00.000Z', 'ws.frame.sent', {
        frameType: 'session.opened',
        sessionId: 'sess-1',
      }),
      runtime('2026-04-15T00:00:20.000Z', 'run.failed', {
        runId: 'run-1',
        rootRunId: 'run-1',
        sessionId: 'sess-1',
        toolName: 'shell_exec',
      }),
    ]);

    const report = analyzeLogEntries(entries);
    const rendered = renderReport(report, { timeZone: 'Asia/Kolkata' });

    expect(rendered).toContain('Gateway Logs');
    expect(rendered).toContain('Activity:');
    expect(rendered).toContain('Failures:');
    expect(rendered).toContain('05:30:00');
    expect(rendered).not.toContain('Timeline');
  });

  it('reports sessions within explicit server lifecycle events', () => {
    const entries = parseEntries([
      gateway('2026-04-15T00:00:00.000Z', 'gateway.server.started', {
        bootId: 'boot-1',
        pid: 100,
        host: '127.0.0.1',
        port: 8959,
        storesKind: 'file',
      }),
      gateway('2026-04-15T00:00:01.000Z', 'ws.frame.sent', {
        frameType: 'session.opened',
        sessionId: 'sess-ok',
        agentId: 'agent-a',
      }),
      runtime('2026-04-15T00:00:02.000Z', 'run.completed', {
        runId: 'run-ok',
        rootRunId: 'run-ok',
        sessionId: 'sess-ok',
        agentId: 'agent-a',
      }),
      gateway('2026-04-15T00:00:03.000Z', 'ws.frame.sent', {
        frameType: 'session.opened',
        sessionId: 'sess-failed',
        agentId: 'agent-a',
      }),
      runtime('2026-04-15T00:00:04.000Z', 'run.failed', {
        runId: 'run-failed',
        rootRunId: 'run-failed',
        sessionId: 'sess-failed',
        agentId: 'agent-a',
      }),
      gateway('2026-04-15T00:00:05.000Z', 'gateway.server.stopped', {
        bootId: 'boot-1',
        pid: 100,
        durationMs: 5000,
      }),
    ]);

    const report = analyzeLogEntries(entries);
    const rendered = renderReport(report, { detailed: true, timeZone: 'Asia/Kolkata' });

    expect(report.serverLifecycles).toHaveLength(1);
    expect(report.serverLifecycles[0]).toMatchObject({
      bootId: 'boot-1',
      status: 'stopped',
      sessions: {
        observed: 2,
        succeeded: 1,
        failed: 1,
        pending: 0,
      },
    });
    expect(rendered).toContain('Server Starts');
    expect(rendered).toContain('session=sess-ok outcome=succeeded');
    expect(rendered).toContain('session=sess-failed outcome=failed');
  });

  it('records malformed log lines as parse issues', () => {
    const result = parseLogLine('not-json', '/logs/gateway-2026-04-15.log', 9);

    expect(result.entry).toBeUndefined();
    expect(result.issue).toMatchObject({
      lineNumber: 9,
      reason: 'Line is not valid JSON.',
    });
  });
});

function parseEntries(lines: string[]): NormalizedLogEntry[] {
  return lines.map((line, index) => {
    const result = parseLogLine(line, '/logs/test.log', index + 1);
    if (!result.entry) {
      throw new Error(`Failed to parse fixture line ${index + 1}`);
    }
    return result.entry;
  });
}

function gateway(timestamp: string, event: string, data: Record<string, unknown>, level = 'info'): string {
  return JSON.stringify({
    level,
    event,
    message: event,
    timestamp,
    data,
  });
}

function runtime(timestamp: string, event: string, data: Record<string, unknown>): string {
  return JSON.stringify({
    level: event.endsWith('failed') ? 50 : 30,
    time: Date.parse(timestamp),
    event,
    msg: event,
    ...data,
  });
}
