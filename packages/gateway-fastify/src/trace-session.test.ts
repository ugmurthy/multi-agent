import { describe, expect, it } from 'vitest';

import { buildTimeline, computeDelegateReason, parseArgs, renderSessionList, renderTraceReport, summarizeTrace } from './trace-session.js';

describe('trace-session CLI helpers', () => {
  it('parses the primary trace-session command and flags', () => {
    expect(parseArgs(['trace-session', 'sess-1', '--json', '--root-run', 'root-1', '--include-plans', '--only-delegates'])).toEqual({
      sessionId: 'sess-1',
      json: true,
      listSessions: false,
      rootRunId: 'root-1',
      includePlans: true,
      onlyDelegates: true,
      help: false,
    });
  });

  it('parses the session list flag without a session id', () => {
    expect(parseArgs(['trace-session', '--ls', '--json'])).toEqual({
      sessionId: undefined,
      json: true,
      listSessions: true,
      includePlans: false,
      onlyDelegates: false,
      help: false,
    });
  });

  it('renders listed sessions with full ids, start time, and goals', () => {
    const output = renderSessionList(
      [
        {
          sessionId: 'session-newest-full-id',
          startedAt: '2026-04-16T10:00:00.000Z',
          goals: [
            {
              rootRunId: 'root-2',
              goal: 'Summarize the incident timeline',
              linkedAt: '2026-04-16T10:00:01.000Z',
            },
          ],
        },
        {
          sessionId: 'session-older-full-id',
          startedAt: '2026-04-16T09:00:00.000Z',
          goals: [],
        },
      ],
      { json: false },
    );

    expect(output).toContain('session-newest-full-id : 2026-04-16T10:00:00.000Z');
    expect(output).toContain('Goal : Summarize the incident timeline');
    expect(output).toContain('-----');
    expect(output).toContain('session-older-full-id : 2026-04-16T09:00:00.000Z');
    expect(output).toContain('Goal : (none)');
  });

  it('renders listed sessions as JSON', () => {
    const output = renderSessionList(
      [{
        sessionId: 'session-1',
        startedAt: now(),
        goals: [{ rootRunId: 'root-1', goal: 'Finish the task', linkedAt: now() }],
      }],
      { json: true },
    );

    expect(JSON.parse(output)).toEqual([
      {
        sessionId: 'session-1',
        startedAt: now(),
        goals: [{ rootRunId: 'root-1', goal: 'Finish the task', linkedAt: now() }],
      },
    ]);
  });

  it('renders a succeeded session summary', () => {
    const summary = summarizeTrace(
      session('succeeded'),
      [{
        rootRunId: 'root-succeeded',
        runId: 'root-succeeded',
        invocationKind: 'run',
        turnIndex: 0,
        linkedAt: now(),
        status: 'succeeded',
        goal: 'Finish the task',
        result: 'Done',
      }],
      [],
      [],
    );

    expect(summary).toEqual({
      status: 'succeeded',
      reason: 'succeeded because all linked root runs completed successfully',
    });
  });

  it('renders a failed session summary from a failed delegate', () => {
    const summary = summarizeTrace(session('failed'), [], [], [
      delegate({
        child_status: 'failed',
        child_error_message: 'tool exploded',
      }),
    ]);

    expect(summary.status).toBe('failed');
    expect(summary.reason).toContain('tool exploded');
  });

  it('explains a delegate stuck in awaiting_subagent', () => {
    const stuck = delegate({ child_status: 'awaiting_subagent' });
    expect(computeDelegateReason(stuck)).toBe('waiting on its own child');

    const summary = summarizeTrace(session('running'), [], [], [stuck]);
    expect(summary).toEqual({
      status: 'blocked',
      reason: 'blocked because delegate analyst (child-run) is waiting on its own child',
    });
  });

  it('keeps pre-migration historical spans readable without precise ids', () => {
    const timeline = buildTimeline([
      {
        session_id: 'sess-old',
        root_run_id: 'root-old',
        run_id: 'root-old',
        parent_run_id: null,
        parent_step_id: null,
        run_delegate_name: null,
        delegation_depth: 0,
        run_status: 'succeeded',
        current_step_id: 'step-1',
        current_child_run_id: null,
        goal: null,
        run_error_code: null,
        run_error_message: null,
        run_created_at: now(),
        run_updated_at: now(),
        run_completed_at: now(),
        event_id: 'event-1',
        event_seq: 1,
        event_created_at: '2026-04-16T10:00:00.000Z',
        event_type: 'tool.completed',
        event_step_id: 'step-1',
        tool_call_id: null,
        payload: { toolName: 'read_file', input: { path: 'README.md' } },
        event_tool_name: 'read_file',
        resolved_input: { path: 'README.md' },
        ledger_tool_name: null,
        tool_execution_status: null,
        tool_started_at: null,
        tool_completed_at: null,
        tool_output: null,
        tool_error_code: null,
        tool_error_message: null,
        child_run_id: null,
        child_run_status: null,
        child_error_code: null,
        child_error_message: null,
        child_run_result: null,
      },
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.toolName).toBe('read_file');
    expect(timeline[0]?.toolCallId).toBeNull();
    expect(timeline[0]?.params).toEqual({ path: 'README.md' });
  });

  it('prints JSON as machine-readable report output', () => {
    const output = renderTraceReport(
      {
        session: session('succeeded'),
        rootRuns: [],
        timeline: [],
        delegates: [],
        plans: [],
        warnings: ['historical data'],
        summary: { status: 'unknown', reason: 'not enough data' },
      },
      { json: true, includePlans: false, onlyDelegates: false },
    );

    expect(JSON.parse(output).warnings).toEqual(['historical data']);
  });
});

function now(): string {
  return '2026-04-16T10:00:00.000Z';
}

function session(status: string) {
  return {
    sessionId: 'sess-1',
    channelId: 'chan-1',
    agentId: 'agent-1',
    invocationMode: 'run',
    status,
    currentRunId: null,
    currentRootRunId: null,
    lastCompletedRootRunId: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

function delegate(overrides: Partial<Parameters<typeof computeDelegateReason>[0]> & Record<string, unknown> = {}) {
  return {
    root_run_id: 'root-1',
    parent_run_id: 'parent-run',
    parent_step_id: 'step-1',
    parent_status: 'awaiting_subagent',
    child_run_id: 'child-run',
    snapshot_delegate_name: null,
    snapshot_child_run_id: null,
    child_delegate_name: 'analyst',
    child_status: 'running',
    child_parent_run_id: 'parent-run',
    child_parent_step_id: 'step-1',
    child_heartbeat_at: now(),
    child_lease_owner: 'worker-1',
    child_lease_expires_at: now(),
    child_updated_at: now(),
    child_completed_at: null,
    child_error_code: null,
    child_error_message: null,
    child_result: null,
    delegate_reason: 'still running',
    parent_last_event_type: 'run.status.changed',
    parent_last_event_at: now(),
    parent_last_event_payload: null,
    child_last_event_type: 'run.status.changed',
    child_last_event_at: now(),
    child_last_event_payload: null,
    ...overrides,
  };
}
