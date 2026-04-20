import { describe, expect, it } from 'vitest';

import {
  type FailedRunTrackingState,
  formatCompactAgentEventFrame,
  getInteractiveSessionMode,
  parseClarifyCommand,
  parseEventsCommand,
  parseRetryCommand,
  recordFailedRunFromAgentEvent,
  recordInteractiveSession,
  selectInteractiveSession,
} from './local-ws-client.js';

describe('selectInteractiveSession', () => {
  it('waits to open a chat session until chat traffic actually starts', () => {
    expect(selectInteractiveSession('chat', {})).toEqual({
      shouldOpenSession: true,
    });
  });

  it('keeps chat traffic on the primary session', () => {
    expect(selectInteractiveSession('chat', { sessionId: 'chat-1' })).toEqual({
      sessionId: 'chat-1',
      shouldOpenSession: false,
    });
  });

  it('opens a dedicated run session instead of reusing the chat session', () => {
    expect(selectInteractiveSession('run', { sessionId: 'chat-1' })).toEqual({
      shouldOpenSession: true,
    });
  });

  it('reuses the dedicated run session once it exists', () => {
    expect(selectInteractiveSession('run', { sessionId: 'chat-1', runSessionId: 'run-1' })).toEqual({
      sessionId: 'run-1',
      shouldOpenSession: false,
    });
  });
});

describe('recordInteractiveSession', () => {
  it('stores the primary chat session without affecting run session state', () => {
    const state = {} as { sessionId?: string; runSessionId?: string };

    recordInteractiveSession(state, 'chat', 'chat-1');

    expect(state).toEqual({ sessionId: 'chat-1' });
  });

  it('stores a dedicated run session without overwriting the chat session', () => {
    const state = { sessionId: 'chat-1' } as { sessionId?: string; runSessionId?: string };

    recordInteractiveSession(state, 'run', 'run-1');

    expect(state).toEqual({
      sessionId: 'chat-1',
      runSessionId: 'run-1',
    });
  });

  it('moves the same id out of chat state when it is later classified as run', () => {
    const state = { sessionId: 'shared-1' } as { sessionId?: string; runSessionId?: string };

    recordInteractiveSession(state, 'run', 'shared-1');

    expect(state).toEqual({
      sessionId: undefined,
      runSessionId: 'shared-1',
    });
  });
});

describe('getInteractiveSessionMode', () => {
  it('classifies reattached run sessions from the opened frame', () => {
    expect(getInteractiveSessionMode({ invocationMode: 'run' })).toBe('run');
  });

  it('defaults opened sessions without a pinned invocation mode to chat', () => {
    expect(getInteractiveSessionMode({})).toBe('chat');
  });
});

describe('recordFailedRunFromAgentEvent', () => {
  it('tracks replayed run.failed events for retry without an explicit runId', () => {
    const state: FailedRunTrackingState = {
      failedRunSessionIds: new Map<string, string>(),
    };

    recordFailedRunFromAgentEvent(state, {
      eventType: 'run.failed',
      runId: 'run-failed',
      sessionId: 'session-1',
    });

    expect(parseRetryCommand('/retry', state.lastFailedRunId)).toBe('run-failed');
    expect(state.failedRunSessionIds.get('run-failed')).toBe('session-1');
  });

  it('ignores non-failure events', () => {
    const state: FailedRunTrackingState = {
      failedRunSessionIds: new Map<string, string>(),
    };

    recordFailedRunFromAgentEvent(state, {
      eventType: 'run.completed',
      runId: 'run-ok',
      sessionId: 'session-1',
    });

    expect(state.lastFailedRunId).toBeUndefined();
    expect(state.failedRunSessionIds.size).toBe(0);
  });
});

describe('parseClarifyCommand', () => {
  it('uses the pending clarification run when no runId is supplied', () => {
    expect(parseClarifyCommand('/clarify I want the markdown version', 'run-1')).toEqual({
      runId: 'run-1',
      message: 'I want the markdown version',
    });
  });

  it('accepts an explicit tracked runId', () => {
    expect(parseClarifyCommand('/clarify run-2 Use csv output', 'run-1', new Set(['run-2']))).toEqual({
      runId: 'run-2',
      message: 'Use csv output',
    });
  });
});

describe('parseEventsCommand', () => {
  it('reports the current realtime event mode when no explicit mode is supplied', () => {
    expect(parseEventsCommand('/event', 'compact')).toEqual({
      eventMode: 'compact',
      message: 'Realtime events are on (one-line).',
    });
  });

  it('turns realtime events on in one-line mode explicitly', () => {
    expect(parseEventsCommand('/events on', 'verbose')).toEqual({
      eventMode: 'compact',
      message: 'Realtime events enabled (one-line).',
    });
  });

  it('turns realtime events on in verbose mode explicitly', () => {
    expect(parseEventsCommand('/event on verbose', 'compact')).toEqual({
      eventMode: 'verbose',
      message: 'Realtime events enabled (verbose).',
    });
  });

  it('turns realtime events off explicitly', () => {
    expect(parseEventsCommand('/events off', 'compact')).toEqual({
      eventMode: 'off',
      message: 'Realtime events disabled.',
    });
  });

  it('rejects invalid realtime event arguments', () => {
    expect(() => parseEventsCommand('/events maybe', 'compact')).toThrow('Usage: /event [on [verbose]|off]');
  });
});

describe('formatCompactAgentEventFrame', () => {
  it('formats tool lifecycle events in the one-line run-agent style', () => {
    expect(
      formatCompactAgentEventFrame({
        type: 'agent.event',
        eventType: 'tool.started',
        data: { toolName: 'read_file' },
        runId: '12345678-aaaa-bbbb-cccc-1234567890ab',
        seq: 7,
        createdAt: '2026-04-10T12:34:56.000Z',
      }),
    ).toBe('[12:34:56] run:12345678 #7 tool read_file started');
  });

  it('formats known tool input summaries without multiline content', () => {
    const baseFrame = {
      type: 'agent.event' as const,
      runId: '12345678-aaaa-bbbb-cccc-1234567890ab',
      seq: 7,
      createdAt: '2026-04-10T12:34:56.000Z',
    };

    expect(
      formatCompactAgentEventFrame({
        ...baseFrame,
        eventType: 'read_web_page',
        data: {},
      }),
    ).toBe('[12:34:56] run:12345678 #7 read_web_page');

    expect(
      formatCompactAgentEventFrame({
        ...baseFrame,
        eventType: 'tool.started',
        data: { toolName: 'read_web_page', input: { url: 'https://docs.example.com/api/agents?view=latest' } },
      }),
    ).toBe('[12:34:56] run:12345678 #7 tool read_web_page url=https://docs.example.com/api/agents?view=latest started');

    expect(
      formatCompactAgentEventFrame({
        ...baseFrame,
        eventType: 'tool.started',
        data: { toolName: 'web_search', input: { query: 'OpenAI GPT-5.4 API docs', maxResults: 5 } },
      }),
    ).toBe('[12:34:56] run:12345678 #7 tool web_search q="OpenAI GPT-5.4 API docs" max=5 started');

    expect(
      formatCompactAgentEventFrame({
        ...baseFrame,
        eventType: 'tool.started',
        data: { toolName: 'shell_exec', input: { command: 'bunx vitest run packages/core/src/tools/tools.test.ts', cwd: '.' } },
      }),
    ).toBe('[12:34:56] run:12345678 #7 tool shell_exec cmd="bunx vitest run packages/core/src/tools/tools.test.ts" cwd=. started');
  });

  it('summarizes write_file content by size', () => {
    expect(
      formatCompactAgentEventFrame({
        type: 'agent.event',
        eventType: 'tool.started',
        data: {
          toolName: 'write_file',
          input: {
            path: 'packages/core/src/foo.ts',
            content: 'hello\nworld',
          },
        },
        runId: '12345678-aaaa-bbbb-cccc-1234567890ab',
        seq: 8,
        createdAt: '2026-04-10T12:34:57.000Z',
      }),
    ).toBe('[12:34:57] run:12345678 #8 tool write_file path=packages/core/src/foo.ts content=11B started');
  });

  it('reads summarized event input and keeps compact output on one line', () => {
    const output = formatCompactAgentEventFrame({
      type: 'agent.event',
      eventType: 'tool.started',
      data: {
        toolName: 'web_search',
        input: {
          type: 'object',
          keyCount: 1,
          preview: {
            query: 'first line\nsecond line',
          },
        },
      },
      runId: '12345678-aaaa-bbbb-cccc-1234567890ab',
      seq: 9,
      createdAt: '2026-04-10T12:34:58.000Z',
    });

    expect(output).toBe('[12:34:58] run:12345678 #9 tool web_search q="first line second line" started');
    expect(output).not.toContain('\n');
  });

  it('can use the TUI sequence-only compact prefix', () => {
    expect(
      formatCompactAgentEventFrame(
        {
          type: 'agent.event',
          eventType: 'tool.started',
          data: { toolName: 'read_file', input: { path: 'packages/core/src/index.ts' } },
          runId: '12345678-aaaa-bbbb-cccc-1234567890ab',
          seq: 10,
          createdAt: '2026-04-10T12:34:59.000Z',
        },
        { prefixStyle: 'seq' },
      ),
    ).toBe('[10] run:12345678 tool read_file path=packages/core/src/index.ts started');
  });

  it('formats status transitions using payload details', () => {
    expect(
      formatCompactAgentEventFrame({
        type: 'agent.event',
        eventType: 'run.status_changed',
        data: { fromStatus: 'queued', toStatus: 'running' },
        runId: '12345678-aaaa-bbbb-cccc-1234567890ab',
        seq: 2,
        createdAt: '2026-04-10T12:35:01.000Z',
      }),
    ).toBe('[12:35:01] run:12345678 #2 status queued -> running');
  });
});
