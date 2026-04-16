#!/usr/bin/env bun

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import readline from 'node:readline/promises';

import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

import { loadGatewayConfig, type GatewayStoreConfig } from './config.js';
import { createGatewayPostgresPool, resolveGatewayPostgresConnectionString, type GatewayPostgresPool } from './postgres.js';
import type { PostgresClient } from './stores-postgres.js';

interface CliOptions {
  sessionId?: string;
  rootRunId?: string;
  json: boolean;
  listSessions: boolean;
  includePlans: boolean;
  onlyDelegates: boolean;
  configPath?: string;
  help: boolean;
}

interface SessionOverview {
  sessionId: string;
  channelId: string | null;
  agentId: string | null;
  invocationMode: string | null;
  status: string;
  currentRunId: string | null;
  currentRootRunId: string | null;
  lastCompletedRootRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RootRun {
  rootRunId: string;
  runId: string;
  invocationKind: string;
  turnIndex: number | null;
  linkedAt: string;
  status: string | null;
  goal: string | null;
  result: unknown;
}

export interface SessionListItem {
  sessionId: string;
  startedAt: string;
  goals: Array<{
    rootRunId: string;
    goal: string;
    linkedAt: string;
  }>;
}

interface TraceRow {
  session_id: string;
  root_run_id: string;
  run_id: string;
  parent_run_id: string | null;
  parent_step_id: string | null;
  run_delegate_name: string | null;
  delegation_depth: number | null;
  run_status: string | null;
  current_step_id: string | null;
  current_child_run_id: string | null;
  goal: unknown;
  run_error_code: string | null;
  run_error_message: string | null;
  run_created_at: string | null;
  run_updated_at: string | null;
  run_completed_at: string | null;
  event_id: string | null;
  event_seq: number | null;
  event_created_at: string | null;
  event_type: string | null;
  event_step_id: string | null;
  tool_call_id: string | null;
  payload: unknown;
  event_tool_name: string | null;
  resolved_input: unknown;
  ledger_tool_name: string | null;
  tool_execution_status: string | null;
  tool_started_at: string | null;
  tool_completed_at: string | null;
  tool_output: unknown;
  tool_error_code: string | null;
  tool_error_message: string | null;
  child_run_id: string | null;
  child_run_status: string | null;
  child_error_code: string | null;
  child_error_message: string | null;
  child_run_result: unknown;
}

interface TimelineEntry {
  rootRunId: string;
  runId: string;
  depth: number;
  stepId: string | null;
  toolCallId: string | null;
  eventType: string | null;
  toolName: string | null;
  params: unknown;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  outcome: string;
  childRunId: string | null;
  eventSeq: number | null;
}

interface DelegateRow {
  root_run_id: string;
  parent_run_id: string;
  parent_step_id: string | null;
  parent_status: string;
  child_run_id: string | null;
  snapshot_delegate_name: string | null;
  snapshot_child_run_id: string | null;
  child_delegate_name: string | null;
  child_status: string | null;
  child_parent_run_id: string | null;
  child_parent_step_id: string | null;
  child_heartbeat_at: string | null;
  child_lease_owner: string | null;
  child_lease_expires_at: string | null;
  child_updated_at: string | null;
  child_completed_at: string | null;
  child_error_code: string | null;
  child_error_message: string | null;
  child_result: unknown;
  delegate_reason: string;
  parent_last_event_type: string | null;
  parent_last_event_at: string | null;
  parent_last_event_payload: unknown;
  child_last_event_type: string | null;
  child_last_event_at: string | null;
  child_last_event_payload: unknown;
}

interface PlanRow {
  root_run_id: string;
  run_id: string;
  plan_execution_id: string | null;
  plan_execution_status: string | null;
  attempt: number | null;
  current_step_id: string | null;
  current_step_index: number | null;
  replan_reason: string | null;
  plan_id: string | null;
  plan_goal: string | null;
  plan_summary: string | null;
  step_index: number | null;
  step_key: string | null;
  title: string | null;
  tool_name: string | null;
  failure_policy: string | null;
  requires_approval: boolean | null;
}

interface TraceReport {
  session: SessionOverview | null;
  rootRuns: RootRun[];
  timeline: TimelineEntry[];
  delegates: DelegateRow[];
  plans: PlanRow[];
  summary: {
    status: 'succeeded' | 'failed' | 'blocked' | 'unknown';
    reason: string;
  };
  warnings: string[];
}

const DEFAULT_TRACE_CONFIG_PATH = '~/.adaptiveAgent/config/gateway.json';

const USAGE = `Usage:
  bun run trace-session <sessionId> [options]
  bun run trace-session --ls [options]
  bun run ./src/trace-session.ts trace-session <sessionId> [options]

Options:
  --ls                   List sessions and associated goals, newest first.
  --json                 Print the trace report as JSON.
  --root-run <id>        Restrict the trace to one root run.
  --include-plans        Include plan execution and step details.
  --only-delegates       Print only delegate diagnostics in the human report.
  --config <path>        Gateway config path. Default: ${DEFAULT_TRACE_CONFIG_PATH}
  --help                 Show this help.`;

marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.gray,
    codespan: chalk.cyan,
    heading: chalk.bold,
  }) as never,
});

export async function traceSession(client: PostgresClient, options: Required<Pick<CliOptions, 'sessionId'>> & CliOptions): Promise<TraceReport> {
  const [session, rootRuns, migration] = await Promise.all([
    loadSessionOverview(client, options.sessionId),
    loadRootRuns(client, options.sessionId, options.rootRunId),
    detectTraceSupport(client),
  ]);

  const warnings: string[] = [];
  if (!session) {
    warnings.push(`Session "${options.sessionId}" was not found.`);
  }
  if (!migration.hasTraceView) {
    warnings.push('The session_execution_trace view is not installed. Create it from artifacts/postgres-session-trace-view.sql before using precise tracing.');
  }
  if (!migration.hasToolObservabilityColumns) {
    warnings.push('The core:002_tool_observability columns are missing. Precise tracing is not possible for this database until the migration is applied.');
  }

  const [traceRows, delegates, plans] = await Promise.all([
    migration.hasTraceView ? loadTraceRows(client, options.sessionId, options.rootRunId) : Promise.resolve([]),
    loadDelegateDiagnostics(client, options.sessionId, options.rootRunId).catch((error: unknown) => {
      warnings.push(`Delegate diagnostics are unavailable: ${errorMessage(error)}`);
      return [] as DelegateRow[];
    }),
    options.includePlans
      ? loadPlans(client, options.sessionId, options.rootRunId).catch((error: unknown) => {
          warnings.push(`Plan details are unavailable: ${errorMessage(error)}`);
          return [] as PlanRow[];
        })
      : Promise.resolve([]),
  ]);

  const timeline = buildTimeline(traceRows, { onlyDelegates: options.onlyDelegates });
  if (traceRows.length > 0 && isHistoricalTrace(traceRows)) {
    warnings.push(
      'This looks like pre-observability historical data. Precise call tracing by tool_call_id, ledger input, and child_run_id is not possible; shown rows are reconstructed from event payloads where available.',
    );
  }

  return {
    session,
    rootRuns,
    timeline,
    delegates,
    plans,
    summary: summarizeTrace(session, rootRuns, timeline, delegates),
    warnings,
  };
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    listSessions: false,
    includePlans: false,
    onlyDelegates: false,
    help: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case 'trace-session':
        if (positional.length === 0) {
          break;
        }
        positional.push(arg);
        break;
      case '--json':
        options.json = true;
        break;
      case '--ls':
        options.listSessions = true;
        break;
      case '--root-run':
      case '--root-run-id':
        options.rootRunId = requireValue(arg, args[++index]);
        break;
      case '--include-plans':
        options.includePlans = true;
        break;
      case '--only-delegates':
        options.onlyDelegates = true;
        break;
      case '--config':
      case '--config-path':
        options.configPath = requireValue(arg, args[++index]);
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
        }
        positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(`Expected one session id, received: ${positional.join(', ')}\n\n${USAGE}`);
  }
  options.sessionId = positional[0];
  return options;
}

export function buildTimeline(rows: TraceRow[], options: { onlyDelegates?: boolean } = {}): TimelineEntry[] {
  const entries = new Map<string, TimelineEntry>();

  for (const row of rows) {
    const toolName = row.ledger_tool_name ?? row.event_tool_name ?? payloadString(row.payload, 'toolName');
    const childRunId = row.child_run_id ?? payloadString(row.payload, 'childRunId');
    const isToolLike = Boolean(toolName || row.tool_call_id || row.tool_started_at || row.tool_execution_status);
    if (!isToolLike) {
      continue;
    }
    if (options.onlyDelegates && !isDelegateTool(toolName, childRunId)) {
      continue;
    }

    const key = row.tool_call_id
      ? `${row.run_id}:${row.tool_call_id}`
      : `${row.run_id}:${row.event_seq ?? row.event_id ?? row.tool_started_at ?? row.event_created_at ?? entries.size}`;
    const existing = entries.get(key);
    const startedAt = row.tool_started_at ?? eventStartedAt(row) ?? existing?.startedAt ?? null;
    const completedAt = row.tool_completed_at ?? eventCompletedAt(row) ?? existing?.completedAt ?? null;
    const status = row.tool_execution_status ?? payloadString(row.payload, 'status') ?? row.child_run_status ?? row.event_type ?? 'observed';
    const outcome = terminalOutcome({
      status,
      errorCode: row.tool_error_code ?? row.child_error_code ?? row.run_error_code,
      errorMessage: row.tool_error_message ?? row.child_error_message ?? row.run_error_message,
      childStatus: row.child_run_status,
      eventType: row.event_type,
    });

    entries.set(key, {
      rootRunId: row.root_run_id,
      runId: row.run_id,
      depth: row.delegation_depth ?? 0,
      stepId: row.event_step_id ?? row.current_step_id,
      toolCallId: row.tool_call_id,
      eventType: row.event_type,
      toolName,
      params: row.resolved_input ?? payloadValue(row.payload, 'input') ?? null,
      startedAt,
      completedAt,
      durationMs: durationMs(startedAt, completedAt),
      outcome,
      childRunId,
      eventSeq: row.event_seq,
    });
  }

  return [...entries.values()].sort(compareTimelineEntries);
}

export function computeDelegateReason(row: Pick<DelegateRow, 'child_run_id' | 'parent_run_id' | 'child_parent_run_id' | 'child_status'>): string {
  if (!row.child_run_id) {
    return 'missing child row';
  }
  if (row.child_parent_run_id && row.child_parent_run_id !== row.parent_run_id) {
    return 'child linkage mismatch';
  }
  switch (row.child_status) {
    case 'queued':
    case 'planning':
    case 'running':
      return 'still running';
    case 'awaiting_approval':
      return 'awaiting approval';
    case 'awaiting_subagent':
      return 'waiting on its own child';
    case 'interrupted':
      return 'interrupted and needs resume';
    case 'succeeded':
      return 'returned successfully';
    case 'replan_required':
      return 'returned replan.required';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'state requires manual inspection';
  }
}

export function summarizeTrace(
  session: SessionOverview | null,
  rootRuns: RootRun[],
  timeline: TimelineEntry[],
  delegates: DelegateRow[],
): TraceReport['summary'] {
  const failedDelegate = delegates.find((delegate) => delegate.child_status === 'failed');
  if (failedDelegate) {
    return {
      status: 'failed',
      reason: `failed because delegate ${delegateLabel(failedDelegate)} failed: ${failedDelegate.child_error_message ?? failedDelegate.child_error_code ?? 'no error persisted'}`,
    };
  }

  const activeDelegate = delegates.find((delegate) =>
    ['queued', 'planning', 'running', 'awaiting_approval', 'awaiting_subagent', 'interrupted'].includes(delegate.child_status ?? ''),
  );
  if (activeDelegate) {
    return {
      status: 'blocked',
      reason: `blocked because delegate ${delegateLabel(activeDelegate)} is ${computeDelegateReason(activeDelegate)}`,
    };
  }

  const failedRoot = rootRuns.find((run) => run.status === 'failed');
  if (failedRoot || session?.status === 'failed' || timeline.some((entry) => entry.outcome.startsWith('failed'))) {
    return { status: 'failed', reason: 'failed because a root run or tool span reached a failed terminal outcome' };
  }

  if (rootRuns.length > 0 && rootRuns.every((run) => run.status === 'succeeded')) {
    return { status: 'succeeded', reason: 'succeeded because all linked root runs completed successfully' };
  }

  const blockedRun = rootRuns.find((run) => run.status && !['succeeded', 'failed', 'cancelled'].includes(run.status));
  if (blockedRun) {
    return { status: 'blocked', reason: `blocked because root run ${shortId(blockedRun.rootRunId)} is ${blockedRun.status}` };
  }

  return { status: 'unknown', reason: 'not enough persisted trace data to determine the terminal reason' };
}

export function renderTraceReport(report: TraceReport, options: Pick<CliOptions, 'json' | 'includePlans' | 'onlyDelegates'>): string {
  if (options.json) {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];
  lines.push(markdownBlock('# Goal'));
  lines.push(renderGoal(report.rootRuns));
  lines.push('');
  lines.push(renderHeader(report));

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(chalk.yellow.bold('Warnings'));
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (!options.onlyDelegates) {
    lines.push('');
    lines.push(chalk.bold('Timeline'));
    lines.push(renderTimeline(report.timeline));
  }

  lines.push('');
  lines.push(markdownBlock('# Delegate Diagnostics'));
  lines.push(renderDelegates(report.delegates));

  if (options.includePlans) {
    lines.push('');
    lines.push(chalk.bold('Plans'));
    lines.push(renderPlans(report.plans));
  }

  lines.push('');
  lines.push(markdownBlock('# Final Output'));
  lines.push(renderFinalOutput(report.rootRuns));

  lines.push('');
  lines.push(markdownBlock('# Final Summary'));
  lines.push(`${statusColor(report.summary.status)(report.summary.status)}: ${report.summary.reason}`);
  return lines.join('\n');
}

export function renderSessionList(sessions: SessionListItem[], options: Pick<CliOptions, 'json'>): string {
  if (options.json) {
    return JSON.stringify(sessions, null, 2);
  }
  if (sessions.length === 0) {
    return chalk.gray('No sessions were found.');
  }

  return sessions
    .map((session) => {
      const lines = [`${session.sessionId} : ${session.startedAt}`];
      if (session.goals.length === 0) {
        lines.push('Goal : (none)');
      } else {
        for (const goal of session.goals) {
          lines.push(`Goal : ${goal.goal}`);
        }
      }
      return lines.join('\n');
    })
    .join('\n\n-----\n\n');
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    if (!options.listSessions && !options.sessionId) {
      throw new Error(`Missing session id.\n\n${USAGE}`);
    }
    if (options.listSessions && options.sessionId) {
      throw new Error(`--ls does not accept a session id.\n\n${USAGE}`);
    }
    if (options.listSessions && options.rootRunId) {
      throw new Error(`--root-run can only be used when tracing a session.\n\n${USAGE}`);
    }

    const loaded = await loadGatewayConfig({ configPath: expandConfigPath(options.configPath ?? DEFAULT_TRACE_CONFIG_PATH) });
    const storeConfig = loaded.config.stores;
    if (!storeConfig || storeConfig.kind !== 'postgres') {
      throw new Error(`trace-session requires gateway stores.kind = "postgres" in ${loaded.path}.`);
    }

    if (options.listSessions) {
      const sessions = await runListSessionsWithPasswordRetry(storeConfig);
      console.log(renderSessionList(sessions, options));
      return;
    }

    const report = await runTraceSessionWithPasswordRetry(storeConfig, options as Required<Pick<CliOptions, 'sessionId'>> & CliOptions);
    console.log(renderTraceReport(report, options));
  } catch (error) {
    console.error(chalk.red(errorMessage(error)));
    process.exitCode = 1;
  }
}

async function runTraceSessionWithPasswordRetry(
  config: Extract<GatewayStoreConfig, { kind: 'postgres' }>,
  options: Required<Pick<CliOptions, 'sessionId'>> & CliOptions,
): Promise<TraceReport> {
  let pool = await createTraceSessionPostgresPool(config);
  let shouldEndPool = true;

  try {
    return await traceSession(pool, options);
  } catch (error) {
    if (!isPostgresPasswordAuthFailure(error)) {
      throw error;
    }

    await pool.end();
    shouldEndPool = false;
    const password = await promptHidden('Postgres password: ');
    pool = createGatewayPostgresPool(config, { password });
    try {
      return await traceSession(pool, options);
    } finally {
      await pool.end();
    }
  } finally {
    if (shouldEndPool) {
      await pool.end();
    }
  }
}

async function runListSessionsWithPasswordRetry(config: Extract<GatewayStoreConfig, { kind: 'postgres' }>): Promise<SessionListItem[]> {
  let pool = await createTraceSessionPostgresPool(config);
  let shouldEndPool = true;

  try {
    return await listSessions(pool);
  } catch (error) {
    if (!isPostgresPasswordAuthFailure(error)) {
      throw error;
    }

    await pool.end();
    shouldEndPool = false;
    const password = await promptHidden('Postgres password: ');
    pool = createGatewayPostgresPool(config, { password });
    try {
      return await listSessions(pool);
    } finally {
      await pool.end();
    }
  } finally {
    if (shouldEndPool) {
      await pool.end();
    }
  }
}

async function createTraceSessionPostgresPool(config: Extract<GatewayStoreConfig, { kind: 'postgres' }>): Promise<GatewayPostgresPool> {
  const connectionString = resolveGatewayPostgresConnectionString(config);
  const password = shouldPromptForPostgresPassword(connectionString) ? await promptHidden('Postgres password: ') : undefined;
  return createGatewayPostgresPool(config, { password });
}

function isPostgresPasswordAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: unknown; message?: unknown };
  return maybeError.code === '28P01'
    || (typeof maybeError.message === 'string' && maybeError.message.includes('password authentication failed'));
}

function shouldPromptForPostgresPassword(connectionString: string): boolean {
  if (process.env.PGPASSWORD) {
    return false;
  }

  try {
    const url = new URL(connectionString);
    return Boolean(url.username) && !url.password && process.stdin.isTTY;
  } catch {
    return false;
  }
}

async function promptHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<string>((resolvePassword, reject) => {
    let password = '';

    const cleanup = (): void => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stderr.write('\n');
    };

    const onData = (chunk: Buffer): void => {
      const value = chunk.toString('utf8');
      for (const char of value) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Password prompt cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolvePassword(password);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          password = password.slice(0, -1);
          continue;
        }
        password += char;
      }
    };

    process.stdin.on('data', onData);
  });
}

function expandConfigPath(configPath: string): string {
  if (configPath === '~') {
    return homedir();
  }
  if (configPath.startsWith('~/')) {
    return resolve(homedir(), configPath.slice(2));
  }
  return configPath;
}

export async function listSessions(client: PostgresClient): Promise<SessionListItem[]> {
  const result = await client.query<{
    session_id: string;
    started_at: string;
    goals: unknown;
  }>(`
    select
      s.id as session_id,
      s.created_at as started_at,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rootRunId', l.root_run_id,
            'goal', r.goal,
            'linkedAt', l.created_at
          )
          order by l.created_at asc, l.run_id asc
        ) filter (where l.run_id is not null and r.goal is not null),
        '[]'::jsonb
      ) as goals
    from gateway_sessions s
    left join gateway_session_run_links l
      on l.session_id = s.id
      and l.invocation_kind = 'run'
    left join agent_runs r on r.id::text = l.root_run_id
    group by s.id, s.created_at
    order by s.created_at desc, s.id desc
  `);

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    startedAt: row.started_at,
    goals: parseSessionGoals(row.goals),
  }));
}

function parseSessionGoals(value: unknown): SessionListItem['goals'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.rootRunId !== 'string' || typeof record.goal !== 'string' || typeof record.linkedAt !== 'string') {
      return [];
    }
    return [{
      rootRunId: record.rootRunId,
      goal: record.goal,
      linkedAt: record.linkedAt,
    }];
  });
}

async function detectTraceSupport(client: PostgresClient): Promise<{ hasTraceView: boolean; hasToolObservabilityColumns: boolean }> {
  const [viewResult, columnResult] = await Promise.all([
    client.query<{ exists: boolean }>(`select to_regclass('public.session_execution_trace') is not null as exists`),
    client.query<{ count: string }>(`
      select count(*)::text as count
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'agent_events' and column_name = 'tool_call_id')
          or (table_name = 'tool_executions' and column_name in ('input', 'child_run_id'))
        )
    `),
  ]);
  return {
    hasTraceView: viewResult.rows[0]?.exists === true,
    hasToolObservabilityColumns: Number(columnResult.rows[0]?.count ?? 0) >= 3,
  };
}

async function loadSessionOverview(client: PostgresClient, sessionId: string): Promise<SessionOverview | null> {
  const result = await client.query<{
    id: string;
    channel_id: string | null;
    agent_id: string | null;
    invocation_mode: string | null;
    status: string;
    current_run_id: string | null;
    current_root_run_id: string | null;
    last_completed_root_run_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      select id, channel_id, agent_id, invocation_mode, status, current_run_id,
             current_root_run_id, last_completed_root_run_id, created_at, updated_at
      from gateway_sessions
      where id = $1
    `,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    sessionId: row.id,
    channelId: row.channel_id,
    agentId: row.agent_id,
    invocationMode: row.invocation_mode,
    status: row.status,
    currentRunId: row.current_run_id,
    currentRootRunId: row.current_root_run_id,
    lastCompletedRootRunId: row.last_completed_root_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadRootRuns(client: PostgresClient, sessionId: string, rootRunId?: string): Promise<RootRun[]> {
  const params: unknown[] = [sessionId];
  const rootFilter = rootRunId ? 'and l.root_run_id = $2' : '';
  if (rootRunId) {
    params.push(rootRunId);
  }
  const result = await client.query<{
    root_run_id: string;
    run_id: string;
    invocation_kind: string;
    turn_index: number | null;
    linked_at: string;
    status: string | null;
    goal: string | null;
    result: unknown;
  }>(
    `
      select distinct l.root_run_id, l.run_id, l.invocation_kind, l.turn_index,
             l.created_at as linked_at, r.status, r.goal, r.result
      from gateway_session_run_links l
      left join agent_runs r on r.id = l.root_run_id::uuid
      where l.session_id = $1
        and l.invocation_kind = 'run'
        ${rootFilter}
      order by l.created_at asc, l.run_id asc
    `,
    params,
  );
  return result.rows.map((row) => ({
    rootRunId: row.root_run_id,
    runId: row.run_id,
    invocationKind: row.invocation_kind,
    turnIndex: row.turn_index,
    linkedAt: row.linked_at,
    status: row.status,
    goal: row.goal,
    result: row.result,
  }));
}

async function loadTraceRows(client: PostgresClient, sessionId: string, rootRunId?: string): Promise<TraceRow[]> {
  const params: unknown[] = [sessionId];
  const rootFilter = rootRunId ? 'and root_run_id = $2::uuid' : '';
  if (rootRunId) {
    params.push(rootRunId);
  }
  const result = await client.query<TraceRow>(
    `
      select *
      from session_execution_trace
      where session_id = $1
        ${rootFilter}
      order by event_created_at asc nulls last, event_seq asc nulls last, run_created_at asc nulls last
    `,
    params,
  );
  return result.rows;
}

async function loadDelegateDiagnostics(client: PostgresClient, sessionId: string, rootRunId?: string): Promise<DelegateRow[]> {
  const params: unknown[] = [sessionId];
  const rootFilter = rootRunId ? 'and l.root_run_id = $2' : '';
  if (rootRunId) {
    params.push(rootRunId);
  }
  const result = await client.query<DelegateRow>(
    `
      with recursive root_runs as (
        select distinct l.root_run_id::uuid as root_run_id
        from gateway_session_run_links l
        where l.session_id = $1
          and l.invocation_kind = 'run'
          ${rootFilter}
      ), run_tree as (
        select r.id, r.root_run_id, r.parent_run_id, r.parent_step_id, r.delegate_name, r.status,
               r.current_step_id, r.current_child_run_id, r.lease_owner, r.lease_expires_at,
               r.heartbeat_at, r.error_code, r.error_message, r.result, r.created_at, r.updated_at,
               r.completed_at
        from agent_runs r
        join root_runs rr on rr.root_run_id = r.id

        union all

        select c.id, c.root_run_id, c.parent_run_id, c.parent_step_id, c.delegate_name, c.status,
               c.current_step_id, c.current_child_run_id, c.lease_owner, c.lease_expires_at,
               c.heartbeat_at, c.error_code, c.error_message, c.result, c.created_at, c.updated_at,
               c.completed_at
        from agent_runs c
        join run_tree rt on c.parent_run_id = rt.id
      )
      select
        parent.root_run_id,
        parent.id as parent_run_id,
        parent.current_step_id as parent_step_id,
        parent.status as parent_status,
        coalesce(parent_tool.child_run_id, parent.current_child_run_id) as child_run_id,
        snap.state ->> 'waitingOnDelegateName' as snapshot_delegate_name,
        snap.state ->> 'waitingOnChildRunId' as snapshot_child_run_id,
        child.delegate_name as child_delegate_name,
        child.status as child_status,
        child.parent_run_id as child_parent_run_id,
        child.parent_step_id as child_parent_step_id,
        child.heartbeat_at as child_heartbeat_at,
        child.lease_owner as child_lease_owner,
        child.lease_expires_at as child_lease_expires_at,
        child.updated_at as child_updated_at,
        child.completed_at as child_completed_at,
        child.error_code as child_error_code,
        child.error_message as child_error_message,
        child.result as child_result,
        case
          when child.id is null then 'missing child row'
          when child.parent_run_id is distinct from parent.id then 'child linkage mismatch'
          when child.status in ('queued', 'planning', 'running') then 'still running'
          when child.status = 'awaiting_approval' then 'awaiting approval'
          when child.status = 'awaiting_subagent' then 'waiting on its own child'
          when child.status = 'interrupted' then 'interrupted and needs resume'
          when child.status = 'succeeded' then 'returned successfully'
          when child.status = 'replan_required' then 'returned replan.required'
          when child.status = 'failed' then 'failed'
          when child.status = 'cancelled' then 'cancelled'
          else 'state requires manual inspection'
        end as delegate_reason,
        parent_last_event.event_type as parent_last_event_type,
        parent_last_event.created_at as parent_last_event_at,
        parent_last_event.payload as parent_last_event_payload,
        child_last_event.event_type as child_last_event_type,
        child_last_event.created_at as child_last_event_at,
        child_last_event.payload as child_last_event_payload
      from run_tree parent
      left join lateral (
        select te.child_run_id
        from tool_executions te
        where te.run_id = parent.id
          and te.step_id = parent.current_step_id
          and te.child_run_id is not null
        order by te.started_at desc, te.tool_call_id desc
        limit 1
      ) parent_tool on true
      left join agent_runs child on child.id = coalesce(parent_tool.child_run_id, parent.current_child_run_id)
      left join lateral (
        select rs.state
        from run_snapshots rs
        where rs.run_id = parent.id
        order by rs.snapshot_seq desc
        limit 1
      ) snap on true
      left join lateral (
        select e.event_type, e.created_at, e.payload
        from agent_events e
        where e.run_id = parent.id
        order by e.seq desc
        limit 1
      ) parent_last_event on true
      left join lateral (
        select e.event_type, e.created_at, e.payload
        from agent_events e
        where e.run_id = child.id
        order by e.seq desc
        limit 1
      ) child_last_event on true
      where parent.status = 'awaiting_subagent'
         or parent.current_child_run_id is not null
         or parent_tool.child_run_id is not null
      order by parent.updated_at asc, parent.id asc
    `,
    params,
  );
  return result.rows;
}

async function loadPlans(client: PostgresClient, sessionId: string, rootRunId?: string): Promise<PlanRow[]> {
  const params: unknown[] = [sessionId];
  const rootFilter = rootRunId ? 'and l.root_run_id = $2' : '';
  if (rootRunId) {
    params.push(rootRunId);
  }
  const result = await client.query<PlanRow>(
    `
      with recursive root_runs as (
        select distinct l.root_run_id::uuid as root_run_id
        from gateway_session_run_links l
        where l.session_id = $1
          and l.invocation_kind = 'run'
          ${rootFilter}
      ), run_tree as (
        select r.id, r.root_run_id, r.current_plan_id, r.current_plan_execution_id
        from agent_runs r
        join root_runs rr on rr.root_run_id = r.id

        union all

        select c.id, c.root_run_id, c.current_plan_id, c.current_plan_execution_id
        from agent_runs c
        join run_tree rt on c.parent_run_id = rt.id
      )
      select
        rt.root_run_id,
        rt.id as run_id,
        pe.id as plan_execution_id,
        pe.status as plan_execution_status,
        pe.attempt,
        pe.current_step_id,
        pe.current_step_index,
        pe.replan_reason,
        p.id as plan_id,
        p.goal as plan_goal,
        p.summary as plan_summary,
        ps.step_index,
        ps.step_key,
        ps.title,
        ps.tool_name,
        ps.failure_policy,
        ps.requires_approval,
        ps.input_template
      from run_tree rt
      left join plan_executions pe on pe.id = rt.current_plan_execution_id or pe.run_id = rt.id
      left join plans p on p.id = pe.plan_id
      left join plan_steps ps on ps.plan_id = p.id
      order by rt.root_run_id asc, rt.id asc, pe.attempt asc nulls last, ps.step_index asc nulls last
    `,
    params,
  );
  return result.rows;
}

function renderHeader(report: TraceReport): string {
  const session = report.session;
  const lines: string[] = [];
  lines.push(markdownBlock('# Session Trace'));
  if (!session) {
    lines.push(chalk.red('Session not found'));
  } else {
    lines.push(`${chalk.magenta('session')} ${session.sessionId}`);
    lines.push(`${chalk.cyan('agent')} ${session.agentId ?? 'unknown'}  ${chalk.cyan('channel')} ${session.channelId ?? 'unknown'}`);
    lines.push(`${chalk.cyan('status')} ${statusColor(session.status)(session.status)}  ${chalk.cyan('current')} ${session.currentRunId ?? 'none'}`);
  }
  lines.push(`${chalk.green('root runs')} ${report.rootRuns.map((run) => `${shortId(run.rootRunId)}:${statusColor(run.status ?? 'unknown')(run.status ?? 'unknown')}`).join(', ') || 'none'}`);
  return lines.join('\n');
}

function renderGoal(rootRuns: RootRun[]): string {
  const rootsWithGoals = rootRuns.filter((run) => run.goal);
  if (rootsWithGoals.length === 0) {
    return chalk.gray('No root run goal was found.');
  }
  if (rootsWithGoals.length === 1) {
    return markdownInline(rootsWithGoals[0]!.goal!);
  }
  return rootsWithGoals.map((run) => `${chalk.green(shortId(run.rootRunId))}: ${markdownInline(run.goal!)}`).join('\n');
}

function renderFinalOutput(rootRuns: RootRun[]): string {
  const rootsWithOutput = rootRuns.filter((run) => run.result !== null && run.result !== undefined);
  if (rootsWithOutput.length === 0) {
    return chalk.gray('No final output was found for the linked root runs.');
  }
  if (rootsWithOutput.length === 1) {
    return renderOutputValue(rootsWithOutput[0]!.result);
  }
  return rootsWithOutput.map((run) => `${chalk.green(shortId(run.rootRunId))}\n${renderOutputValue(run.result)}`).join('\n\n');
}

function renderOutputValue(value: unknown): string {
  if (typeof value === 'string') {
    return markdownBlock(value);
  }
  return markdownBlock(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
}

function renderTimeline(entries: TimelineEntry[]): string {
  if (entries.length === 0) {
    return chalk.gray('No migrated tool timeline rows were found.');
  }

  const rows = entries.map((entry) => [
    formatTime(entry.startedAt),
    formatDuration(entry.durationMs),
    `${shortId(entry.rootRunId)}/${shortId(entry.runId)} d${entry.depth}`,
    entry.stepId ?? '-',
    toolColor(entry.toolName)(entry.toolName ?? entry.eventType ?? 'tool'),
    compactValue(entry.params),
    statusColor(entry.outcome)(entry.outcome),
  ]);
  return renderTable(['started', 'duration', 'run/depth', 'step', 'tool', 'params', 'outcome'], rows);
}

function renderDelegates(delegates: DelegateRow[]): string {
  const activeOrSuspicious = delegates.filter((delegate) => delegate.delegate_reason !== 'returned successfully');
  const rowsToShow = activeOrSuspicious.length > 0 ? activeOrSuspicious : delegates;
  if (rowsToShow.length === 0) {
    return chalk.gray('No active or suspicious delegate chains were found.');
  }

  const rows = rowsToShow.map((delegate) => [
    shortId(delegate.parent_run_id),
    delegate.child_delegate_name ?? delegate.snapshot_delegate_name ?? 'delegate',
    delegate.child_run_id ? shortId(delegate.child_run_id) : '-',
    statusColor(delegate.child_status ?? 'missing')(delegate.child_status ?? 'missing'),
    formatTime(delegate.child_heartbeat_at),
    formatTime(delegate.child_lease_expires_at),
    delegate.child_last_event_type ?? '-',
    statusColor(delegate.delegate_reason)(delegate.delegate_reason),
  ]);
  return renderTable(['parent', 'delegate', 'child', 'child status', 'heartbeat', 'lease expiry', 'last event', 'reason'], rows);
}

function renderPlans(plans: PlanRow[]): string {
  if (plans.length === 0) {
    return chalk.gray('No plan rows were found.');
  }
  const rows = plans.map((plan) => [
    shortId(plan.run_id),
    plan.plan_execution_id ? shortId(plan.plan_execution_id) : '-',
    statusColor(plan.plan_execution_status ?? 'unknown')(plan.plan_execution_status ?? 'unknown'),
    plan.step_index === null ? '-' : String(plan.step_index),
    plan.title ?? plan.step_key ?? '-',
    plan.tool_name ?? '-',
    plan.replan_reason ?? '-',
  ]);
  return renderTable(['run', 'execution', 'status', 'step', 'title', 'tool', 'replan'], rows);
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.min(
      Math.max(
        header.length,
        ...rows.map((row) => stripAnsi(row[index] ?? '').length),
      ),
      index === headers.length - 1 ? 80 : 36,
    ),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => padAnsi(truncateAnsi(cell, widths[index]!), widths[index]!))
      .join('  ');

  return [line(headers.map((header) => chalk.bold(header))), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

function statusColor(status: string): (value: string) => string {
  if (['succeeded', 'returned successfully'].includes(status)) {
    return chalk.green;
  }
  if (status.includes('failed') || status === 'failed') {
    return chalk.red;
  }
  if (status.includes('blocked') || status.includes('waiting') || status.includes('awaiting') || status === 'running') {
    return chalk.yellow;
  }
  return chalk.white;
}

function toolColor(toolName: string | null): (value: string) => string {
  if (!toolName) {
    return chalk.white;
  }
  if (toolName.startsWith('delegate.')) {
    return chalk.magenta;
  }
  return chalk.blue;
}

function terminalOutcome(input: {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  childStatus: string | null;
  eventType: string | null;
}): string {
  if (input.errorCode || input.errorMessage) {
    return `failed: ${input.errorCode ?? input.errorMessage}`;
  }
  if (input.childStatus) {
    return `child ${input.childStatus}`;
  }
  if (input.status) {
    return input.status;
  }
  return input.eventType ?? 'observed';
}

function isHistoricalTrace(rows: TraceRow[]): boolean {
  const toolRows = rows.filter((row) => row.ledger_tool_name || row.event_tool_name || payloadString(row.payload, 'toolName'));
  return toolRows.length > 0 && toolRows.every((row) => !row.tool_call_id && row.child_run_id === null);
}

function eventStartedAt(row: TraceRow): string | null {
  if (row.event_type?.includes('started') || row.event_type?.includes('requested')) {
    return row.event_created_at;
  }
  return row.tool_started_at ?? row.event_created_at;
}

function eventCompletedAt(row: TraceRow): string | null {
  if (row.event_type?.includes('completed') || row.event_type?.includes('failed')) {
    return row.event_created_at;
  }
  return row.tool_completed_at;
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  return (
    compareTime(left.startedAt, right.startedAt) ||
    left.rootRunId.localeCompare(right.rootRunId) ||
    left.runId.localeCompare(right.runId) ||
    (left.eventSeq ?? 0) - (right.eventSeq ?? 0)
  );
}

function compareTime(left: string | null, right: string | null): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return Date.parse(left) - Date.parse(right);
}

function durationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) {
    return null;
  }
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '-';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'string') {
    return markdownInline(value);
  }
  return markdownInline(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``).replace(/\s+/g, ' ').trim();
}

function markdownInline(source: string): string {
  return marked(source, { async: false }).trim();
}

function markdownBlock(source: string): string {
  return marked(`${source}\n`, { async: false }).trimEnd();
}

function payloadValue(payload: unknown, key: string): unknown {
  if (payload && typeof payload === 'object' && key in payload) {
    return (payload as Record<string, unknown>)[key];
  }
  return undefined;
}

function payloadString(payload: unknown, key: string): string | null {
  const value = payloadValue(payload, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isDelegateTool(toolName: string | null, childRunId: string | null): boolean {
  return Boolean(childRunId || toolName?.startsWith('delegate.'));
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 8) : value;
}

function delegateLabel(delegate: DelegateRow): string {
  return `${delegate.child_delegate_name ?? delegate.snapshot_delegate_name ?? 'delegate'} (${delegate.child_run_id ? shortId(delegate.child_run_id) : 'missing child'})`;
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function truncateAnsi(value: string, width: number): string {
  return stripAnsi(value).length > width ? `${stripAnsi(value).slice(0, Math.max(0, width - 1))}…` : value;
}

function padAnsi(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - stripAnsi(value).length));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return inspect(error);
}

if (import.meta.main) {
  await main();
}
