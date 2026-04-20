#!/usr/bin/env bun

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import readline from 'node:readline/promises';

import type { EventType } from '@adaptive-agent/core';
import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

import { loadGatewayConfig, type GatewayStoreConfig } from './config.js';
import { formatCompactAgentEventFrame } from './local-event-format.js';
import { createGatewayPostgresPool, resolveGatewayPostgresConnectionString, type GatewayPostgresPool } from './postgres.js';
import type { AgentEventFrame } from './protocol.js';
import type { PostgresClient } from './stores-postgres.js';

type ReportView = 'overview' | 'milestones' | 'timeline' | 'delegates' | 'messages' | 'plans' | 'all';
type MessageView = 'compact' | 'delta' | 'full';

interface CliOptions {
  sessionId?: string;
  rootRunId?: string;
  runId?: string;
  json: boolean;
  listSessions: boolean;
  listSessionless: boolean;
  deleteEmptyGoalSessions: boolean;
  usageOnly: boolean;
  includePlans: boolean;
  onlyDelegates: boolean;
  messages: boolean;
  systemOnly: boolean;
  view?: ReportView;
  messagesView?: MessageView;
  focusRunId?: string;
  previewChars?: number;
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
  modelProvider?: string | null;
  modelName?: string | null;
}

interface UsageSummary {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  estimatedCostUSD: number;
}

interface SessionUsageSummary {
  total: UsageSummary;
  byRootRun: Array<{
    rootRunId: string;
    usage: UsageSummary;
  }>;
}

export interface SessionListItem {
  sessionId: string;
  startedAt: string;
  status?: string;
  goals: Array<{
    rootRunId: string;
    goal: string | null;
    linkedAt: string;
  }>;
}

export interface SessionlessRunListItem {
  rootRunId: string;
  startedAt: string;
  status?: string | null;
  goal: string | null;
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
  output: unknown;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  outcome: string;
  childRunId: string | null;
  eventSeq: number | null;
}

interface MilestoneEntry {
  rootRunId: string;
  runId: string;
  depth: number;
  eventType: EventType;
  stepId: string | null;
  createdAt: string | null;
  eventSeq: number | null;
  text: string;
}

interface RunTreeEntry {
  rootRunId: string;
  runId: string;
  parentRunId: string | null;
  delegateName: string | null;
  depth: number;
}

interface RunSnapshotSummary {
  rootRunId: string;
  runId: string;
  delegateName: string | null;
  depth: number;
  latestSnapshotSeq: number | null;
  latestSnapshotCreatedAt: string | null;
  latestStepsUsed: number | null;
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

type TraceMessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface TraceToolCall {
  id: string;
  name: string;
  input: unknown;
}

interface TraceMessage {
  position: number;
  persistence: 'persisted' | 'pending';
  role: TraceMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: TraceToolCall[];
  category:
    | 'initial-runtime-system'
    | 'gateway-chat-system-context'
    | 'runtime-injected-system'
    | 'user'
    | 'assistant'
    | 'tool';
}

interface RunMessageTrace {
  rootRunId: string;
  runId: string;
  delegateName: string | null;
  depth: number;
  initialSnapshotSeq: number | null;
  initialSnapshotCreatedAt: string | null;
  latestSnapshotSeq: number | null;
  latestSnapshotCreatedAt: string | null;
  initialMessages?: TraceMessage[];
  latestStepsUsed?: number | null;
  effectiveMessages: TraceMessage[];
}

interface SnapshotMessageRow {
  root_run_id: string;
  run_id: string;
  run_delegate_name: string | null;
  delegation_depth: number | null;
  initial_snapshot_seq: number | null;
  initial_snapshot_created_at: string | null;
  initial_snapshot_state: unknown;
  latest_snapshot_seq: number | null;
  latest_snapshot_created_at: string | null;
  latest_snapshot_state: unknown;
}

interface TraceReport {
  target: TraceTarget;
  session: SessionOverview | null;
  rootRuns: RootRun[];
  usage: SessionUsageSummary;
  timeline: TimelineEntry[];
  milestones?: MilestoneEntry[];
  llmMessages: RunMessageTrace[];
  runTree?: RunTreeEntry[];
  snapshotSummaries?: RunSnapshotSummary[];
  totalSteps?: number | null;
  delegates: DelegateRow[];
  plans: PlanRow[];
  summary: {
    status: 'succeeded' | 'failed' | 'blocked' | 'unknown';
    reason: string;
  };
  warnings: string[];
}

interface TraceTarget {
  kind: 'session' | 'root-run' | 'run';
  requestedId: string;
  resolvedRootRunId?: string;
}

const CORE_EVENT_TYPES: EventType[] = [
  'run.created',
  'run.status_changed',
  'run.interrupted',
  'run.resumed',
  'run.retry_started',
  'run.completed',
  'run.failed',
  'plan.created',
  'plan.execution_started',
  'step.started',
  'step.completed',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'delegate.spawned',
  'approval.requested',
  'approval.resolved',
  'clarification.requested',
  'usage.updated',
  'snapshot.created',
  'replan.required',
];

const CORE_EVENT_TYPE_SET = new Set<string>(CORE_EVENT_TYPES);
const DEFAULT_MESSAGE_PREVIEW_CHARS = 160;

const DEFAULT_TRACE_CONFIG_PATH = '~/.adaptiveAgent/config/gateway.json';

const USAGE = `Usage:
  bun run trace-session <sessionId> [options]
  bun run trace-session --root-run <rootRunId> [options]
  bun run trace-session --run <runId> [options]
  bun run trace-session --ls [options]
  bun run trace-session --ls-sessionless [options]
  bun run trace-session --delete [options]
  bun run trace-session <sessionId> --usage [options]
  bun run ./src/trace-session.ts trace-session <sessionId> [options]

Options:
  --ls                   List sessions and associated goals, newest first.
  --ls-sessionless       List root runs that are not linked to any gateway session.
  --delete               Print SQL to delete sessions whose goals are empty or null.
  --usage                Print usage totals for the session and all linked root runs.
  --messages             Include the current snapshot-backed LLM message context.
  --messages-view <mode> Message view: compact, delta, or full. Default: compact.
  --system-only          Include only system messages in the LLM message view.
  --view <name>          Report view: overview, milestones, timeline, delegates, messages, plans, or all.
  --focus-run <id>       Limit the rendered report to a run subtree within the traced tree.
  --preview-chars <n>    Preview length for compact and delta message views. Default: ${DEFAULT_MESSAGE_PREVIEW_CHARS}
  --json                 Print the trace report as JSON.
  --root-run <id>        Restrict a session trace to one root run, or trace that root run directly.
  --run <id>             Trace the root run tree that contains this run id.
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

export async function traceSession(client: PostgresClient, options: CliOptions): Promise<TraceReport> {
  const [resolvedTarget, migration] = await Promise.all([
    resolveTraceTarget(client, options),
    detectTraceSupport(client),
  ]);
  const { target, session, rootRunIds } = resolvedTarget;
  const [rootRuns, usage] = await Promise.all([
    loadRootRuns(client, rootRunIds, options.sessionId, migration.hasRunModelColumns),
    loadSessionUsage(client, rootRunIds),
  ]);

  const warnings: string[] = [];
  if (target.kind === 'session' && !session) {
    warnings.push(`Session "${options.sessionId}" was not found.`);
  }
  if (target.kind === 'run' && !target.resolvedRootRunId) {
    warnings.push(`Run "${target.requestedId}" was not found.`);
  }
  if ((target.kind === 'root-run' || (target.kind === 'run' && target.resolvedRootRunId)) && rootRuns.length === 0) {
    warnings.push(`Root run "${target.resolvedRootRunId ?? target.requestedId}" was not found.`);
  }
  if (!migration.hasToolObservabilityColumns) {
    warnings.push('The core:002_tool_observability columns are missing. Precise tracing is not possible for this database until the migration is applied.');
  }

  const shouldLoadMessages = options.messages || options.systemOnly || options.view === 'messages';
  const llmMessagesPromise = shouldLoadMessages
    ? loadRunMessageTraces(client, rootRunIds).catch((error: unknown) => {
        warnings.push(`LLM messages are unavailable: ${errorMessage(error)}`);
        return [] as RunMessageTrace[];
      })
    : Promise.resolve([] as RunMessageTrace[]);
  const snapshotSummariesPromise = loadRunSnapshotSummaries(client, rootRunIds).catch((error: unknown) => {
    warnings.push(`Step counts are unavailable: ${errorMessage(error)}`);
    return [] as RunSnapshotSummary[];
  });

  const [traceRows, llmMessages, snapshotSummaries, delegates, plans] = await Promise.all([
    migration.hasToolObservabilityColumns ? loadTraceRows(client, options.sessionId ?? target.requestedId, rootRunIds) : Promise.resolve([]),
    llmMessagesPromise,
    snapshotSummariesPromise,
    loadDelegateDiagnostics(client, rootRunIds).catch((error: unknown) => {
      warnings.push(`Delegate diagnostics are unavailable: ${errorMessage(error)}`);
      return [] as DelegateRow[];
    }),
    options.includePlans
      ? loadPlans(client, rootRunIds).catch((error: unknown) => {
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

  let report: TraceReport = {
    target,
    session,
    rootRuns,
    usage,
    timeline,
    milestones: buildMilestones(traceRows),
    llmMessages,
    runTree: buildRunTreeEntries(traceRows),
    snapshotSummaries,
    totalSteps: totalStepsFromSnapshotSummaries(snapshotSummaries),
    delegates,
    plans,
    summary: summarizeTrace(session, rootRuns, timeline, delegates),
    warnings,
  };

  if (options.focusRunId) {
    const focusedRunIds = collectFocusedRunIds(report.runTree ?? [], options.focusRunId);
    if (focusedRunIds.size === 0) {
      warnings.push(`Run "${options.focusRunId}" was not found in the traced run tree.`);
    } else {
      report = filterReportForFocusedRun(report, focusedRunIds);
      report.summary = summarizeTrace(report.session, report.rootRuns, report.timeline, report.delegates);
      report.totalSteps = totalStepsFromSnapshotSummaries(report.snapshotSummaries ?? []);
    }
  }

  return report;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    listSessions: false,
    listSessionless: false,
    deleteEmptyGoalSessions: false,
    usageOnly: false,
    includePlans: false,
    onlyDelegates: false,
    messages: false,
    systemOnly: false,
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
      case '--ls-sessionless':
        options.listSessionless = true;
        break;
      case '--delete':
        options.deleteEmptyGoalSessions = true;
        break;
      case '--usage':
        options.usageOnly = true;
        break;
      case '--messages':
        options.messages = true;
        break;
      case '--messages-view':
        options.messagesView = parseMessageView(requireValue(arg, args[++index]));
        options.messages = true;
        break;
      case '--system-only':
        options.systemOnly = true;
        options.messages = true;
        break;
      case '--view':
        options.view = parseReportView(requireValue(arg, args[++index]));
        if (options.view === 'messages') {
          options.messages = true;
        }
        break;
      case '--focus-run':
        options.focusRunId = requireValue(arg, args[++index]);
        break;
      case '--preview-chars':
        options.previewChars = parsePositiveInteger(requireValue(arg, args[++index]), arg);
        break;
      case '--root-run':
      case '--root-run-id':
        options.rootRunId = requireValue(arg, args[++index]);
        break;
      case '--run':
      case '--run-id':
        options.runId = requireValue(arg, args[++index]);
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
  const latestOutputsByStep = new Map<string, unknown>();

  for (const row of rows) {
    const toolName = row.ledger_tool_name ?? row.event_tool_name ?? payloadString(row.payload, 'toolName');
    const childRunId = row.child_run_id ?? payloadString(row.payload, 'childRunId');
    const stepId = row.event_step_id ?? row.current_step_id;
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
    const directOutput = row.tool_output ?? payloadValue(row.payload, 'output') ?? payloadValue(row.payload, 'result') ?? row.child_run_result;
    const carriedOutput = latestOutputsByStep.get(timelineStepKey(row.run_id, stepId, toolName));
    const output = directOutput ?? existing?.output ?? carriedOutput ?? null;
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
      stepId,
      toolCallId: row.tool_call_id,
      eventType: row.event_type,
      toolName,
      params: row.resolved_input ?? payloadValue(row.payload, 'input') ?? existing?.params ?? null,
      output,
      startedAt,
      completedAt,
      durationMs: durationMs(startedAt, completedAt),
      outcome,
      childRunId,
      eventSeq: row.event_seq,
    });

    if (output !== null && output !== undefined) {
      latestOutputsByStep.set(timelineStepKey(row.run_id, stepId, toolName), output);
    }
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
  if (failedRoot || timeline.some((entry) => entry.outcome.startsWith('failed'))) {
    return { status: 'failed', reason: 'failed because a root run or tool span reached a failed terminal outcome' };
  }

  if (rootRuns.length > 0 && rootRuns.every((run) => run.status === 'succeeded')) {
    return { status: 'succeeded', reason: 'succeeded because all linked root runs completed successfully' };
  }

  const blockedRun = rootRuns.find((run) => run.status && !['succeeded', 'failed', 'cancelled'].includes(run.status));
  if (blockedRun) {
    return { status: 'blocked', reason: `blocked because root run ${shortId(blockedRun.rootRunId)} is ${blockedRun.status}` };
  }

  if (session?.status === 'failed') {
    return { status: 'failed', reason: 'failed because the persisted session reached a failed terminal outcome' };
  }

  return { status: 'unknown', reason: 'not enough persisted trace data to determine the terminal reason' };
}

export function renderTraceReport(
  report: TraceReport,
  options: Pick<CliOptions, 'json' | 'includePlans' | 'onlyDelegates' | 'messages' | 'systemOnly'>
    & Partial<Pick<CliOptions, 'view' | 'messagesView' | 'previewChars'>>,
): string {
  if (options.json) {
    return JSON.stringify(report, null, 2);
  }

  const effectiveView = resolveReportView(options);
  const messageView = options.messagesView ?? 'compact';
  const previewChars = options.previewChars ?? DEFAULT_MESSAGE_PREVIEW_CHARS;
  const milestones = report.milestones ?? [];

  const lines: string[] = [];
  lines.push(markdownBlock('# Goal'));
  lines.push(renderGoal(report.rootRuns));
  lines.push('');
  lines.push(renderTraceSummary(report));

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(chalk.yellow.bold('Warnings'));
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (shouldRenderSection(effectiveView, 'milestones')) {
    lines.push('');
    lines.push(markdownBlock('# Milestones'));
    lines.push(renderMilestones(milestones));
  }

  if (shouldRenderSection(effectiveView, 'timeline')) {
    lines.push('');
    lines.push(markdownBlock(`# ${formatTimelineTitle(report.timeline, report.session)}`));
    lines.push(renderTimeline(report.timeline));
  }

  if ((options.messages || options.systemOnly || effectiveView === 'messages') && shouldRenderSection(effectiveView, 'messages')) {
    lines.push('');
    lines.push(markdownBlock(options.systemOnly ? '# LLM System Messages' : '# LLM Message Context'));
    lines.push(renderLlmMessages(report.llmMessages, {
      systemOnly: options.systemOnly,
      messagesView: messageView,
      previewChars,
    }));
  }

  if (shouldRenderSection(effectiveView, 'delegates')) {
    lines.push('');
    lines.push(markdownBlock('# Delegate Diagnostics'));
    lines.push(renderDelegates(report.delegates));
  }

  if (options.includePlans && shouldRenderSection(effectiveView, 'plans')) {
    lines.push('');
    lines.push(chalk.bold('Plans'));
    lines.push(renderPlans(report.plans));
  }

  if (shouldRenderFinalOutput(effectiveView)) {
    lines.push('');
    lines.push(markdownBlock('# Final Output'));
    lines.push(renderFinalOutput(report.rootRuns));
  }

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
      const startedAt = session.status === 'succeeded' ? chalk.green(session.startedAt) : chalk.red(session.startedAt);
      const lines = [`${session.sessionId} : ${startedAt}`];
      const visibleGoals = session.goals.filter((goal) => normalizeGoal(goal.goal) !== null);
      if (visibleGoals.length === 0) {
        lines.push('Goal : (none)');
      } else {
        for (const goal of visibleGoals) {
          lines.push(`Goal : ${goal.goal}`);
        }
      }
      return lines.join('\n');
    })
    .join('\n\n-----\n\n');
}

export function renderSessionlessRunList(runs: SessionlessRunListItem[], options: Pick<CliOptions, 'json'>): string {
  if (options.json) {
    return JSON.stringify(runs, null, 2);
  }
  if (runs.length === 0) {
    return chalk.gray('No session-less root runs were found.');
  }

  return runs
    .map((run) => {
      const startedAt = run.status === 'succeeded' ? chalk.green(run.startedAt) : chalk.red(run.startedAt);
      return `${run.rootRunId} : ${startedAt}\nGoal : ${normalizeGoal(run.goal) ?? '(none)'}`;
    })
    .join('\n\n-----\n\n');
}

export function renderDeleteEmptyGoalSessionsSql(sessions: SessionListItem[], options: Pick<CliOptions, 'json'>): string {
  const deletableSessions = sessions.filter((session) => session.goals.length === 0 || session.goals.every((goal) => normalizeGoal(goal.goal) === null));

  if (options.json) {
    return JSON.stringify({
      sessionIds: deletableSessions.map((session) => session.sessionId),
      sql: deletableSessions.map((session) => `delete from gateway_sessions where id = '${escapeSqlString(session.sessionId)}';`),
    }, null, 2);
  }

  if (deletableSessions.length === 0) {
    return '-- No sessions found with empty or null goals.';
  }

  const lines = [
    '-- Sessions with only empty or null goals.',
    '-- Review before running.',
    'begin;',
    ...deletableSessions.map((session) => `delete from gateway_sessions where id = '${escapeSqlString(session.sessionId)}';`),
    'commit;',
  ];
  return lines.join('\n');
}

export function renderUsageReport(usage: SessionUsageSummary, options: Pick<CliOptions, 'json'>): string {
  if (options.json) {
    return JSON.stringify(usage, null, 2);
  }

  const lines = [formatUsageSummary(usage.total)];
  if (usage.byRootRun.length > 0) {
    lines.push('');
    for (const item of usage.byRootRun) {
      lines.push(`${item.rootRunId} : ${formatUsageSummary(item.usage)}`);
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    if (!options.listSessions && !options.listSessionless && !options.deleteEmptyGoalSessions && !options.sessionId && !options.rootRunId && !options.runId) {
      throw new Error(`Missing session id, --root-run, or --run.\n\n${USAGE}`);
    }
    if ((options.listSessions || options.listSessionless || options.deleteEmptyGoalSessions) && options.sessionId) {
      throw new Error(`--ls, --ls-sessionless, and --delete do not accept a session id.\n\n${USAGE}`);
    }
    if ((options.listSessions || options.listSessionless || options.deleteEmptyGoalSessions) && (options.rootRunId || options.runId)) {
      throw new Error(`--ls, --ls-sessionless, and --delete do not accept --root-run or --run.\n\n${USAGE}`);
    }
    if ([options.listSessions, options.listSessionless, options.deleteEmptyGoalSessions].filter(Boolean).length > 1) {
      throw new Error(`Choose only one of --ls, --ls-sessionless, or --delete.\n\n${USAGE}`);
    }
    if (options.sessionId && options.runId) {
      throw new Error(`--run cannot be combined with a session id. Use --root-run to restrict a session trace.\n\n${USAGE}`);
    }
    if (options.rootRunId && options.runId) {
      throw new Error(`Choose either --root-run or --run, not both.\n\n${USAGE}`);
    }
    if ((options.listSessions || options.listSessionless || options.deleteEmptyGoalSessions || options.usageOnly) && (options.messages || options.systemOnly)) {
      throw new Error(`--messages and --system-only can only be used when rendering a full trace.\n\n${USAGE}`);
    }
    if ((options.listSessions || options.listSessionless || options.deleteEmptyGoalSessions || options.usageOnly) && (options.view || options.messagesView || options.focusRunId || options.previewChars)) {
      throw new Error(`--view, --messages-view, --focus-run, and --preview-chars can only be used when rendering a full trace.\n\n${USAGE}`);
    }
    if (options.usageOnly && options.sessionId && options.rootRunId) {
      throw new Error(`--usage prints all linked root runs for a session and does not accept --root-run.\n\n${USAGE}`);
    }

    const loaded = await loadGatewayConfig({ configPath: expandConfigPath(options.configPath ?? DEFAULT_TRACE_CONFIG_PATH) });
    const storeConfig = loaded.config.stores;
    if (!storeConfig || storeConfig.kind !== 'postgres') {
      throw new Error(`trace-session requires gateway stores.kind = "postgres" in ${loaded.path}.`);
    }

    if (options.listSessions || options.listSessionless || options.deleteEmptyGoalSessions) {
      if (options.listSessionless) {
        const runs = await runListSessionlessRunsWithPasswordRetry(storeConfig);
        console.log(renderSessionlessRunList(runs, options));
        return;
      }

      const sessions = await runListSessionsWithPasswordRetry(storeConfig);
      console.log(options.deleteEmptyGoalSessions ? renderDeleteEmptyGoalSessionsSql(sessions, options) : renderSessionList(sessions, options));
      return;
    }

    if (options.usageOnly) {
      const usage = await runUsageWithPasswordRetry(storeConfig, options);
      console.log(renderUsageReport(usage, options));
      return;
    }

    const report = await runTraceSessionWithPasswordRetry(storeConfig, options);
    console.log(renderTraceReport(report, options));
  } catch (error) {
    console.error(chalk.red(errorMessage(error)));
    process.exitCode = 1;
  }
}

async function runTraceSessionWithPasswordRetry(
  config: Extract<GatewayStoreConfig, { kind: 'postgres' }>,
  options: CliOptions,
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

async function runListSessionlessRunsWithPasswordRetry(
  config: Extract<GatewayStoreConfig, { kind: 'postgres' }>,
): Promise<SessionlessRunListItem[]> {
  let pool = await createTraceSessionPostgresPool(config);
  let shouldEndPool = true;

  try {
    return await listSessionlessRuns(pool);
  } catch (error) {
    if (!isPostgresPasswordAuthFailure(error)) {
      throw error;
    }

    await pool.end();
    shouldEndPool = false;
    const password = await promptHidden('Postgres password: ');
    pool = createGatewayPostgresPool(config, { password });
    try {
      return await listSessionlessRuns(pool);
    } finally {
      await pool.end();
    }
  } finally {
    if (shouldEndPool) {
      await pool.end();
    }
  }
}

async function runUsageWithPasswordRetry(
  config: Extract<GatewayStoreConfig, { kind: 'postgres' }>,
  options: CliOptions,
): Promise<SessionUsageSummary> {
  let pool = await createTraceSessionPostgresPool(config);
  let shouldEndPool = true;

  try {
    return await loadUsageForTraceTarget(pool, options);
  } catch (error) {
    if (!isPostgresPasswordAuthFailure(error)) {
      throw error;
    }

    await pool.end();
    shouldEndPool = false;
    const password = await promptHidden('Postgres password: ');
    pool = createGatewayPostgresPool(config, { password });
    try {
      return await loadUsageForTraceTarget(pool, options);
    } finally {
      await pool.end();
    }
  } finally {
    if (shouldEndPool) {
      await pool.end();
    }
  }
}

async function loadUsageForTraceTarget(client: PostgresClient, options: CliOptions): Promise<SessionUsageSummary> {
  const { rootRunIds } = await resolveTraceTarget(client, options);
  return loadSessionUsage(client, rootRunIds);
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
      process.stdin.pause();
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
      process.stdin.pause();
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
    status: string;
    goals: unknown;
  }>(`
    select
      s.id as session_id,
      s.created_at as started_at,
      coalesce(
        case
          when count(l.run_id) filter (where l.run_id is not null) = 0 then s.status
          when count(*) filter (where r.status is distinct from 'succeeded') = 0 then 'succeeded'
          else 'failed'
        end,
        s.status
      ) as status,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rootRunId', l.root_run_id,
            'goal', r.goal,
            'linkedAt', l.created_at
          )
          order by l.created_at asc, l.run_id asc
        ) filter (where l.run_id is not null),
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
    status: row.status,
    goals: parseSessionGoals(row.goals),
  }));
}

export async function listSessionlessRuns(client: PostgresClient): Promise<SessionlessRunListItem[]> {
  const result = await client.query<{
    root_run_id: string;
    started_at: string;
    status: string | null;
    goal: string | null;
  }>(`
    select
      r.id::text as root_run_id,
      r.created_at as started_at,
      r.status,
      r.goal
    from agent_runs r
    left join gateway_session_run_links l
      on l.root_run_id = r.id::text
     and l.invocation_kind = 'run'
    where r.id = r.root_run_id
      and l.root_run_id is null
    order by r.created_at desc, r.id desc
  `);

  return result.rows.map((row) => ({
    rootRunId: row.root_run_id,
    startedAt: row.started_at,
    status: row.status,
    goal: row.goal,
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
    if (typeof record.rootRunId !== 'string' || (record.goal !== null && typeof record.goal !== 'string') || typeof record.linkedAt !== 'string') {
      return [];
    }
    return [{
      rootRunId: record.rootRunId,
      goal: record.goal,
      linkedAt: record.linkedAt,
    }];
  });
}

function usageSummaryFromRow(row: {
  total_prompt_tokens: string | number;
  total_completion_tokens: string | number;
  total_reasoning_tokens: string | number | null;
  estimated_cost_usd: string | number;
}): UsageSummary {
  const promptTokens = Number(row.total_prompt_tokens ?? 0);
  const completionTokens = Number(row.total_completion_tokens ?? 0);
  const reasoningTokens = Number(row.total_reasoning_tokens ?? 0);
  return {
    promptTokens,
    completionTokens,
    reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
    totalTokens: promptTokens + completionTokens + reasoningTokens,
    estimatedCostUSD: Number(row.estimated_cost_usd ?? 0),
  };
}

function normalizeGoal(goal: string | null): string | null {
  if (typeof goal !== 'string') {
    return null;
  }
  const trimmed = goal.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

async function detectTraceSupport(client: PostgresClient): Promise<{ hasTraceView: boolean; hasToolObservabilityColumns: boolean; hasRunModelColumns: boolean }> {
  const [viewResult, columnResult, runModelColumnResult] = await Promise.all([
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
    client.query<{ count: string }>(`
      select count(*)::text as count
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_runs'
        and column_name in ('model_provider', 'model_name')
    `),
  ]);
  return {
    hasTraceView: viewResult.rows[0]?.exists === true,
    hasToolObservabilityColumns: Number(columnResult.rows[0]?.count ?? 0) >= 3,
    hasRunModelColumns: Number(runModelColumnResult.rows[0]?.count ?? 0) >= 2,
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

async function loadTraceSessionRootRunIds(
  client: PostgresClient,
  sessionId: string,
  session: SessionOverview | null,
  rootRunId?: string,
): Promise<string[]> {
  if (rootRunId) {
    return [rootRunId];
  }

  const result = await client.query<{
    root_run_id: string;
  }>(
    `
      select l.root_run_id
      from gateway_session_run_links l
      where l.session_id = $1
        and l.invocation_kind = 'run'
      group by l.root_run_id
      order by min(l.created_at) asc, min(l.run_id) asc
    `,
    [sessionId],
  );

  const ordered = result.rows.map((row) => row.root_run_id);
  const runtimeRoots = await client.query<{
    root_run_id: string;
  }>(
    `
      select r.id::text as root_run_id
      from agent_runs r
      where r.id = r.root_run_id
        and (
          r.context ->> 'sessionId' = $1
          or r.metadata -> 'gateway' ->> 'sessionId' = $1
        )
      order by r.created_at asc, r.id asc
    `,
    [sessionId],
  );
  for (const row of runtimeRoots.rows) {
    if (!ordered.includes(row.root_run_id)) {
      ordered.push(row.root_run_id);
    }
  }
  for (const candidate of [session?.currentRootRunId, session?.lastCompletedRootRunId]) {
    if (candidate && !ordered.includes(candidate)) {
      ordered.push(candidate);
    }
  }
  return ordered;
}

async function resolveTraceTarget(
  client: PostgresClient,
  options: CliOptions,
): Promise<{ target: TraceTarget; session: SessionOverview | null; rootRunIds: string[] }> {
  if (options.sessionId) {
    const session = await loadSessionOverview(client, options.sessionId);
    const rootRunIds = await loadTraceSessionRootRunIds(client, options.sessionId, session, options.rootRunId);
    return {
      target: {
        kind: 'session',
        requestedId: options.sessionId,
        resolvedRootRunId: options.rootRunId,
      },
      session,
      rootRunIds,
    };
  }

  if (options.runId) {
    const rootRunId = await loadRootRunIdForRun(client, options.runId);
    return {
      target: {
        kind: 'run',
        requestedId: options.runId,
        resolvedRootRunId: rootRunId ?? undefined,
      },
      session: null,
      rootRunIds: rootRunId ? [rootRunId] : [],
    };
  }

  return {
    target: {
      kind: 'root-run',
      requestedId: options.rootRunId!,
      resolvedRootRunId: options.rootRunId!,
    },
    session: null,
    rootRunIds: options.rootRunId ? [options.rootRunId] : [],
  };
}

async function loadRootRunIdForRun(client: PostgresClient, runId: string): Promise<string | null> {
  const result = await client.query<{ root_run_id: string }>(
    `
      select root_run_id::text as root_run_id
      from agent_runs
      where id = $1
    `,
    [runId],
  );
  return result.rows[0]?.root_run_id ?? null;
}

async function loadRootRuns(client: PostgresClient, rootRunIds: string[], sessionId?: string, hasRunModelColumns = true): Promise<RootRun[]> {
  if (rootRunIds.length === 0) {
    return [];
  }

  const modelColumns = hasRunModelColumns
    ? 'r.model_provider, r.model_name'
    : 'null::text as model_provider, null::text as model_name';
  const result = await client.query<{
    root_run_id: string;
    run_id: string;
    invocation_kind: string;
    turn_index: number | null;
    linked_at: string;
    status: string | null;
    goal: string | null;
    result: unknown;
    model_provider: string | null;
    model_name: string | null;
  }>(
    `
      with requested_roots as (
        select root_run_id::uuid as root_run_id, ordinality
        from unnest($2::text[]) with ordinality as roots(root_run_id, ordinality)
      )
      select
        rr.root_run_id::text as root_run_id,
        coalesce(link.run_id, rr.root_run_id::text) as run_id,
        coalesce(link.invocation_kind, 'run') as invocation_kind,
        link.turn_index,
        coalesce(link.created_at, r.created_at) as linked_at,
        r.status,
        r.goal,
        r.result,
        ${modelColumns}
      from requested_roots rr
      join agent_runs r on r.id = rr.root_run_id
      left join lateral (
        select l.run_id, l.invocation_kind, l.turn_index, l.created_at
        from gateway_session_run_links l
        where $1::text is not null
          and l.session_id = $1
          and l.invocation_kind = 'run'
          and l.root_run_id = rr.root_run_id::text
        order by l.created_at asc, l.run_id asc
        limit 1
      ) link on true
      order by rr.ordinality asc
    `,
    [sessionId, rootRunIds],
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
    modelProvider: row.model_provider,
    modelName: row.model_name,
  }));
}

async function loadSessionUsage(client: PostgresClient, rootRunIds: string[]): Promise<SessionUsageSummary> {
  if (rootRunIds.length === 0) {
    return {
      total: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
      byRootRun: [],
    };
  }

  const result = await client.query<{
    root_run_id: string;
    total_prompt_tokens: string | number;
    total_completion_tokens: string | number;
    total_reasoning_tokens: string | number | null;
    estimated_cost_usd: string | number;
  }>(
    `
      with recursive root_runs as (
        select root_run_id::uuid as root_run_id, ordinality
        from unnest($1::text[]) with ordinality as roots(root_run_id, ordinality)
      ), run_tree as (
        select r.id, r.root_run_id, r.created_at
        from agent_runs r
        join root_runs rr on rr.root_run_id = r.id

        union all

        select c.id, c.root_run_id, c.created_at
        from agent_runs c
        join run_tree rt on c.parent_run_id = rt.id
      )
      select
        rt.root_run_id::text as root_run_id,
        coalesce(sum(r.total_prompt_tokens), 0)::text as total_prompt_tokens,
        coalesce(sum(r.total_completion_tokens), 0)::text as total_completion_tokens,
        coalesce(sum(r.total_reasoning_tokens), 0)::text as total_reasoning_tokens,
        coalesce(sum(r.estimated_cost_usd), 0)::text as estimated_cost_usd
      from run_tree rt
      join agent_runs r on r.id = rt.id
      join root_runs rr on rr.root_run_id = rt.root_run_id
      group by rt.root_run_id, rr.ordinality
      order by rr.ordinality asc, rt.root_run_id asc
    `,
    [rootRunIds],
  );

  const byRootRun = result.rows.map((row) => ({
    rootRunId: row.root_run_id,
    usage: usageSummaryFromRow(row),
  }));

  const total = byRootRun.reduce<UsageSummary>(
    (acc, item) => {
      const reasoningTokens = (acc.reasoningTokens ?? 0) + (item.usage.reasoningTokens ?? 0);
      return {
        promptTokens: acc.promptTokens + item.usage.promptTokens,
        completionTokens: acc.completionTokens + item.usage.completionTokens,
        reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
        totalTokens: acc.totalTokens + item.usage.totalTokens,
        estimatedCostUSD: acc.estimatedCostUSD + item.usage.estimatedCostUSD,
      };
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
  );

  return { total, byRootRun };
}

async function loadRunMessageTraces(client: PostgresClient, rootRunIds: string[]): Promise<RunMessageTrace[]> {
  if (rootRunIds.length === 0) {
    return [];
  }

  const result = await client.query<SnapshotMessageRow>(
    `
      with recursive root_runs as (
        select root_run_id::uuid as root_run_id, ordinality
        from unnest($1::text[]) with ordinality as roots(root_run_id, ordinality)
      ), run_tree as (
        select
          rr.root_run_id,
          rr.ordinality,
          r.id as run_id,
          r.delegate_name,
          r.delegation_depth,
          r.created_at as run_created_at
        from root_runs rr
        join agent_runs r on r.id = rr.root_run_id

        union all

        select
          rt.root_run_id,
          rt.ordinality,
          c.id as run_id,
          c.delegate_name,
          c.delegation_depth,
          c.created_at as run_created_at
        from run_tree rt
        join agent_runs c on c.parent_run_id = rt.run_id
      )
      select
        rt.root_run_id::text as root_run_id,
        rt.run_id::text as run_id,
        rt.delegate_name as run_delegate_name,
        rt.delegation_depth,
        initial_snapshot.snapshot_seq as initial_snapshot_seq,
        initial_snapshot.created_at as initial_snapshot_created_at,
        initial_snapshot.state as initial_snapshot_state,
        latest_snapshot.snapshot_seq as latest_snapshot_seq,
        latest_snapshot.created_at as latest_snapshot_created_at,
        latest_snapshot.state as latest_snapshot_state
      from run_tree rt
      left join lateral (
        select rs.snapshot_seq, rs.created_at, rs.state
        from run_snapshots rs
        where rs.run_id = rt.run_id
        order by rs.snapshot_seq asc
        limit 1
      ) initial_snapshot on true
      left join lateral (
        select rs.snapshot_seq, rs.created_at, rs.state
        from run_snapshots rs
        where rs.run_id = rt.run_id
        order by rs.snapshot_seq desc
        limit 1
      ) latest_snapshot on true
      order by rt.ordinality asc, rt.run_created_at asc, rt.run_id asc
    `,
    [rootRunIds],
  );

  return result.rows
    .map(runMessageTraceFromRow)
    .filter((trace): trace is RunMessageTrace => trace !== null);
}

async function loadRunSnapshotSummaries(client: PostgresClient, rootRunIds: string[]): Promise<RunSnapshotSummary[]> {
  if (rootRunIds.length === 0) {
    return [];
  }

  const result = await client.query<SnapshotMessageRow>(
    `
      with recursive root_runs as (
        select root_run_id::uuid as root_run_id, ordinality
        from unnest($1::text[]) with ordinality as roots(root_run_id, ordinality)
      ), run_tree as (
        select
          rr.root_run_id,
          rr.ordinality,
          r.id as run_id,
          r.delegate_name,
          r.delegation_depth,
          r.created_at as run_created_at
        from root_runs rr
        join agent_runs r on r.id = rr.root_run_id

        union all

        select
          rt.root_run_id,
          rt.ordinality,
          c.id as run_id,
          c.delegate_name,
          c.delegation_depth,
          c.created_at as run_created_at
        from run_tree rt
        join agent_runs c on c.parent_run_id = rt.run_id
      )
      select
        rt.root_run_id::text as root_run_id,
        rt.run_id::text as run_id,
        rt.delegate_name as run_delegate_name,
        rt.delegation_depth,
        null::bigint as initial_snapshot_seq,
        null::timestamptz as initial_snapshot_created_at,
        null::jsonb as initial_snapshot_state,
        latest_snapshot.snapshot_seq as latest_snapshot_seq,
        latest_snapshot.created_at as latest_snapshot_created_at,
        latest_snapshot.state as latest_snapshot_state
      from run_tree rt
      left join lateral (
        select rs.snapshot_seq, rs.created_at, rs.state
        from run_snapshots rs
        where rs.run_id = rt.run_id
        order by rs.snapshot_seq desc
        limit 1
      ) latest_snapshot on true
      order by rt.ordinality asc, rt.run_created_at asc, rt.run_id asc
    `,
    [rootRunIds],
  );

  return result.rows.map((row) => {
    const latestState = parseSnapshotState(row.latest_snapshot_state);
    return {
      rootRunId: row.root_run_id,
      runId: row.run_id,
      delegateName: row.run_delegate_name,
      depth: row.delegation_depth ?? 0,
      latestSnapshotSeq: row.latest_snapshot_seq,
      latestSnapshotCreatedAt: row.latest_snapshot_created_at,
      latestStepsUsed: latestState?.stepsUsed ?? null,
    };
  });
}

async function loadTraceRows(client: PostgresClient, sessionId: string, rootRunIds: string[]): Promise<TraceRow[]> {
  if (rootRunIds.length === 0) {
    return [];
  }

  const result = await client.query<TraceRow>(
    `
      with recursive root_runs as (
        select root_run_id::uuid as root_run_id, ordinality
        from unnest($1::text[]) with ordinality as roots(root_run_id, ordinality)
      ), run_tree as (
        select
          rr.root_run_id,
          rr.ordinality,
          r.id as run_id,
          r.parent_run_id,
          r.parent_step_id,
          r.delegate_name,
          r.delegation_depth,
          r.status as run_status,
          r.current_step_id,
          r.current_child_run_id,
          r.goal,
          r.error_code as run_error_code,
          r.error_message as run_error_message,
          r.created_at as run_created_at,
          r.updated_at as run_updated_at,
          r.completed_at as run_completed_at
        from root_runs rr
        join agent_runs r on r.id = rr.root_run_id

        union all

        select
          rt.root_run_id,
          rt.ordinality,
          c.id as run_id,
          c.parent_run_id,
          c.parent_step_id,
          c.delegate_name,
          c.delegation_depth,
          c.status as run_status,
          c.current_step_id,
          c.current_child_run_id,
          c.goal,
          c.error_code as run_error_code,
          c.error_message as run_error_message,
          c.created_at as run_created_at,
          c.updated_at as run_updated_at,
          c.completed_at as run_completed_at
        from run_tree rt
        join agent_runs c on c.parent_run_id = rt.run_id
      )
      select
        $2::text as session_id,
        rt.root_run_id::text as root_run_id,
        rt.run_id::text as run_id,
        rt.parent_run_id::text as parent_run_id,
        rt.parent_step_id,
        rt.delegate_name as run_delegate_name,
        rt.delegation_depth,
        rt.run_status,
        rt.current_step_id,
        rt.current_child_run_id::text as current_child_run_id,
        rt.goal,
        rt.run_error_code,
        rt.run_error_message,
        rt.run_created_at,
        rt.run_updated_at,
        rt.run_completed_at,
        e.id::text as event_id,
        e.seq as event_seq,
        e.created_at as event_created_at,
        e.event_type,
        e.step_id as event_step_id,
        e.tool_call_id,
        e.payload,
        e.payload ->> 'toolName' as event_tool_name,
        coalesce(te.input, e.payload -> 'input', child.input) as resolved_input,
        te.tool_name as ledger_tool_name,
        te.status as tool_execution_status,
        te.started_at as tool_started_at,
        te.completed_at as tool_completed_at,
        te.output as tool_output,
        te.error_code as tool_error_code,
        te.error_message as tool_error_message,
        coalesce(te.child_run_id, nullif(e.payload ->> 'childRunId', '')::uuid)::text as child_run_id,
        child.status as child_run_status,
        child.error_code as child_error_code,
        child.error_message as child_error_message,
        child.result as child_run_result
      from run_tree rt
      left join agent_events e on e.run_id = rt.run_id
      left join tool_executions te
        on te.run_id = e.run_id
       and te.tool_call_id = e.tool_call_id
      left join agent_runs child
        on child.id = coalesce(te.child_run_id, nullif(e.payload ->> 'childRunId', '')::uuid)
      order by event_created_at asc nulls last, event_seq asc nulls last, run_created_at asc nulls last
    `,
    [rootRunIds, sessionId],
  );
  return result.rows;
}

async function loadDelegateDiagnostics(client: PostgresClient, rootRunIds: string[]): Promise<DelegateRow[]> {
  if (rootRunIds.length === 0) {
    return [];
  }

  const result = await client.query<DelegateRow>(
    `
      with recursive root_runs as (
        select root_run_id::uuid as root_run_id
        from unnest($1::text[]) as roots(root_run_id)
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
    [rootRunIds],
  );
  return result.rows;
}

async function loadPlans(client: PostgresClient, rootRunIds: string[]): Promise<PlanRow[]> {
  if (rootRunIds.length === 0) {
    return [];
  }

  const result = await client.query<PlanRow>(
    `
      with recursive root_runs as (
        select root_run_id::uuid as root_run_id, ordinality
        from unnest($1::text[]) with ordinality as roots(root_run_id, ordinality)
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
      join root_runs rr on rr.root_run_id = rt.root_run_id
      left join plan_executions pe on pe.id = rt.current_plan_execution_id or pe.run_id = rt.id
      left join plans p on p.id = pe.plan_id
      left join plan_steps ps on ps.plan_id = p.id
      order by rr.ordinality asc, rt.root_run_id asc, rt.id asc, pe.attempt asc nulls last, ps.step_index asc nulls last
    `,
    [rootRunIds],
  );
  return result.rows;
}

function renderTraceSummary(report: TraceReport): string {
  const session = report.session;
  const lines: string[] = [];
  lines.push(markdownBlock('# Trace Summary'));
  lines.push(`${chalk.cyan('status')} ${statusColor(report.summary.status)(report.summary.status)}`);
  lines.push(`${chalk.cyan('reason')} ${report.summary.reason}`);
  if (report.target.kind === 'session') {
    if (!session) {
      lines.push(`${chalk.magenta('session')} ${chalk.red('not found')}`);
    } else {
      lines.push(`${chalk.magenta('session')} ${session.sessionId}`);
      lines.push(`${chalk.cyan('agent')} ${session.agentId ?? 'unknown'}  ${chalk.cyan('channel')} ${session.channelId ?? 'unknown'}`);
      lines.push(renderModelSummary(report.rootRuns));
      lines.push(`${chalk.cyan('status')} ${statusColor(session.status)(session.status)}  ${chalk.cyan('current')} ${session.currentRunId ?? 'none'}`);
      lines.push(`${chalk.cyan('session duration')} ${formatDuration(durationMs(session.createdAt, session.updatedAt))}`);
    }
  } else {
    lines.push(`${chalk.magenta('target')} ${report.target.kind} ${report.target.requestedId}`);
    if (report.target.resolvedRootRunId && report.target.resolvedRootRunId !== report.target.requestedId) {
      lines.push(`${chalk.cyan('root')} ${report.target.resolvedRootRunId}`);
    }
    lines.push(renderModelSummary(report.rootRuns));
  }
  lines.push(`${chalk.cyan('total steps')} ${report.totalSteps ?? 'unknown'}`);
  lines.push(renderUsage(report.usage));
  lines.push('');
  lines.push(markdownBlock('# Root Runs'));
  if (report.rootRuns.length === 0) {
    lines.push(chalk.gray('No root runs were found.'));
  } else {
    for (const run of report.rootRuns) {
      const parts = [run.rootRunId, statusColor(run.status ?? 'unknown')(run.status ?? 'unknown')];
      if (run.runId !== run.rootRunId) {
        parts.push(`linkedRun=${run.runId}`);
      }
      lines.push(`- ${parts.join('  ')}`);
    }
  }
  return lines.join('\n');
}

function renderModelSummary(rootRuns: RootRun[]): string {
  const labels = [...new Set(rootRuns.map(formatRunModel).filter((label) => label !== null))];
  if (labels.length === 0) {
    return `${chalk.cyan('provider')} unknown  ${chalk.cyan('model')} unknown`;
  }
  if (labels.length === 1) {
    const run = rootRuns.find((candidate) => formatRunModel(candidate) === labels[0]);
    return `${chalk.cyan('provider')} ${run?.modelProvider ?? 'unknown'}  ${chalk.cyan('model')} ${run?.modelName ?? 'unknown'}`;
  }
  return `${chalk.cyan('provider/model')} ${labels.join(', ')}`;
}

function formatRunModel(run: RootRun): string | null {
  if (!run.modelProvider && !run.modelName) {
    return null;
  }
  return `${run.modelProvider ?? 'unknown'}/${run.modelName ?? 'unknown'}`;
}

function renderUsage(usage: SessionUsageSummary): string {
  const lines = [`${chalk.cyan('usage')} ${formatUsageSummary(usage.total)}`];
  if (usage.byRootRun.length > 1) {
    for (const item of usage.byRootRun) {
      lines.push(`  ${chalk.green(item.rootRunId)} ${formatUsageSummary(item.usage)}`);
    }
  }
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

function formatUsageSummary(usage: UsageSummary): string {
  const parts = [
    `prompt=${formatNumber(usage.promptTokens)}`,
    `completion=${formatNumber(usage.completionTokens)}`,
  ];
  if (usage.reasoningTokens !== undefined) {
    parts.push(`reasoning=${formatNumber(usage.reasoningTokens)}`);
  }
  parts.push(`total=${formatNumber(usage.totalTokens)}`);
  parts.push(`cost=$${usage.estimatedCostUSD.toFixed(6)}`);
  return parts.join('  ');
}

function renderTimeline(entries: TimelineEntry[]): string {
  if (entries.length === 0) {
    return chalk.gray('No migrated tool timeline rows were found.');
  }

  const rows = entries.map((entry) => [
    formatTimeOfDay(entry.startedAt),
    formatDuration(entry.durationMs),
    `${shortId(entry.rootRunId)}/${shortId(entry.runId)} d${entry.depth}`,
    entry.stepId ?? '-',
    toolColor(entry.toolName)(entry.toolName ?? entry.eventType ?? 'tool'),
    compactValue(entry.params ?? entry.output),
    statusColor(entry.outcome)(entry.outcome),
  ]);
  return renderTable(['started-time', 'duration', 'run/depth', 'step', 'tool', 'params', 'outcome'], rows);
}

function formatTimelineTitle(entries: TimelineEntry[], session: SessionOverview | null): string {
  const startedAt = earliestTimelineStart(entries) ?? session?.createdAt ?? null;
  return startedAt ? `Tool Timeline: ${formatTime(startedAt)}` : 'Tool Timeline';
}

function renderMilestones(entries: MilestoneEntry[]): string {
  if (entries.length === 0) {
    return chalk.gray('No persisted milestone events were found.');
  }
  return entries.map((entry) => entry.text).join('\n');
}

function renderLlmMessages(
  traces: RunMessageTrace[],
  options: Pick<CliOptions, 'systemOnly'> & { messagesView: MessageView; previewChars: number },
): string {
  switch (options.messagesView) {
    case 'delta':
      return renderLlmMessageDelta(traces, options);
    case 'full':
      return renderLlmMessageFull(traces, options);
    case 'compact':
      return renderLlmMessageCompact(traces, options);
  }
}

function renderLlmMessageCompact(
  traces: RunMessageTrace[],
  options: Pick<CliOptions, 'systemOnly'> & { previewChars: number },
): string {
  const sections = traces
    .map((trace) => {
      const visibleMessages = trace.effectiveMessages.filter((message) => !options.systemOnly || message.role === 'system');
      if (visibleMessages.length === 0) {
        return null;
      }

      const runHeader = `${chalk.green(shortId(trace.rootRunId))}/${shortId(trace.runId)} d${trace.depth}${trace.delegateName ? ` ${chalk.magenta(trace.delegateName)}` : ''}`;
      const snapshotSummary = `${chalk.cyan('initial')} ${trace.initialSnapshotSeq ?? '-'} @ ${formatTime(trace.initialSnapshotCreatedAt)}  ${chalk.cyan('latest')} ${trace.latestSnapshotSeq ?? '-'} @ ${formatTime(trace.latestSnapshotCreatedAt)}`;
      const counts = summarizeMessages(visibleMessages);
      const lines = [
        runHeader,
        snapshotSummary,
        `counts: persisted=${counts.persisted} pending=${counts.pending} system=${counts.system} runtime-injected=${counts.runtimeInjected} user=${counts.user} assistant=${counts.assistant} tool=${counts.tool}`,
        renderTable(
          ['#', 'state', 'role', 'category', 'preview'],
          visibleMessages.map((message) => {
            const color = messageRoleColor(message.role);
            return [
              color(String(message.position + 1)),
              color(message.persistence),
              color(message.role),
              color(humanMessageCategoryPlain(message.category)),
              color(formatMessagePreview(message, options.previewChars)),
            ];
          }),
          { maxWidths: [36, 36, 36, 36, options.previewChars] },
        ),
      ];

      return lines.join('\n');
    })
    .filter((section): section is string => section !== null);

  if (sections.length === 0) {
    return chalk.gray('No snapshot-backed LLM messages were found.');
  }

  return sections.join('\n\n');
}

function renderLlmMessageDelta(
  traces: RunMessageTrace[],
  options: Pick<CliOptions, 'systemOnly'> & { previewChars: number },
): string {
  const sections = traces
    .map((trace) => {
      const deltaRows = buildMessageDeltaRows(trace)
        .filter((row) => !options.systemOnly || row.message.role === 'system');
      if (deltaRows.length === 0) {
        return null;
      }

      const runHeader = `${chalk.green(shortId(trace.rootRunId))}/${shortId(trace.runId)} d${trace.depth}${trace.delegateName ? ` ${chalk.magenta(trace.delegateName)}` : ''}`;
      const snapshotSummary = `${chalk.cyan('initial')} ${trace.initialSnapshotSeq ?? '-'} @ ${formatTime(trace.initialSnapshotCreatedAt)}  ${chalk.cyan('latest')} ${trace.latestSnapshotSeq ?? '-'} @ ${formatTime(trace.latestSnapshotCreatedAt)}`;
      const counts = {
        added: deltaRows.filter((row) => row.kind === 'added').length,
        changed: deltaRows.filter((row) => row.kind === 'changed').length,
        pending: deltaRows.filter((row) => row.kind === 'pending').length,
      };
      const rows = deltaRows.map((row) => [
        messageRoleColor(row.message.role)(row.kind),
        messageRoleColor(row.message.role)(String(row.message.position + 1)),
        messageRoleColor(row.message.role)(row.message.persistence),
        messageRoleColor(row.message.role)(row.message.role),
        messageRoleColor(row.message.role)(humanMessageCategoryPlain(row.message.category)),
        messageRoleColor(row.message.role)(formatMessagePreview(row.message, options.previewChars)),
      ]);

      return [
        runHeader,
        snapshotSummary,
        `delta: added=${counts.added} changed=${counts.changed} pending=${counts.pending}`,
        renderTable(['delta', '#', 'state', 'role', 'category', 'preview'], rows, {
          maxWidths: [36, 36, 36, 36, 36, options.previewChars],
        }),
      ].join('\n');
    })
    .filter((section): section is string => section !== null);

  if (sections.length === 0) {
    return chalk.gray('No message deltas were found for the traced runs.');
  }

  return sections.join('\n\n');
}

function renderLlmMessageFull(
  traces: RunMessageTrace[],
  options: Pick<CliOptions, 'systemOnly'>,
): string {
  const sections = traces
    .map((trace) => {
      const visibleMessages = trace.effectiveMessages.filter((message) => !options.systemOnly || message.role === 'system');
      if (visibleMessages.length === 0) {
        return null;
      }

      const runHeader = `${chalk.green(shortId(trace.rootRunId))}/${shortId(trace.runId)} d${trace.depth}${trace.delegateName ? ` ${chalk.magenta(trace.delegateName)}` : ''}`;
      const snapshotSummary = `${chalk.cyan('initial')} ${trace.initialSnapshotSeq ?? '-'} @ ${formatTime(trace.initialSnapshotCreatedAt)}  ${chalk.cyan('latest')} ${trace.latestSnapshotSeq ?? '-'} @ ${formatTime(trace.latestSnapshotCreatedAt)}`;
      const lines = [runHeader, snapshotSummary];

      for (const message of visibleMessages) {
        const color = messageRoleColor(message.role);
        lines.push('');
        lines.push(color(`${message.position + 1}. ${message.persistence === 'pending' ? '[pending]' : '[persisted]'} ${message.role} ${humanMessageCategoryPlain(message.category)}`));
        if (message.name) {
          lines.push(`name: ${message.name}`);
        }
        if (message.toolCallId) {
          lines.push(`toolCallId: ${message.toolCallId}`);
        }
        if (message.toolCalls && message.toolCalls.length > 0) {
          lines.push(markdownBlock(`\`\`\`json\n${JSON.stringify(message.toolCalls, null, 2)}\n\`\`\``));
        }
        lines.push(markdownBlock(`\`\`\`text\n${message.content}\n\`\`\``));
      }

      return lines.join('\n');
    })
    .filter((section): section is string => section !== null);

  if (sections.length === 0) {
    return chalk.gray('No snapshot-backed LLM messages were found.');
  }

  return sections.join('\n\n');
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

function runMessageTraceFromRow(row: SnapshotMessageRow): RunMessageTrace | null {
  const initialState = parseSnapshotState(row.initial_snapshot_state);
  const latestState = parseSnapshotState(row.latest_snapshot_state ?? row.initial_snapshot_state);
  if (!initialState || !latestState) {
    return null;
  }

  const initialMessageCount = initialState.messages.length;
  let initialSystemMessagesSeen = 0;
  const initialMessages: TraceMessage[] = initialState.messages.map((message, index) => {
    const category = classifyPersistedMessage(message, index, initialMessageCount, initialSystemMessagesSeen);
    if (message.role === 'system' && index < initialMessageCount) {
      initialSystemMessagesSeen += 1;
    }
    return {
      position: index,
      persistence: 'persisted',
      role: message.role,
      content: message.content,
      name: message.name,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls,
      category,
    };
  });

  initialSystemMessagesSeen = 0;
  const effectiveMessages: TraceMessage[] = latestState.messages.map((message, index) => {
    const category = classifyPersistedMessage(message, index, initialMessageCount, initialSystemMessagesSeen);
    if (message.role === 'system' && index < initialMessageCount) {
      initialSystemMessagesSeen += 1;
    }
    return {
      position: index,
      persistence: 'persisted',
      role: message.role,
      content: message.content,
      name: message.name,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls,
      category,
    };
  });

  for (const [offset, message] of latestState.pendingRuntimeMessages.entries()) {
    effectiveMessages.push({
      position: latestState.messages.length + offset,
      persistence: 'pending',
      role: message.role,
      content: message.content,
      name: message.name,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls,
      category: classifyPendingMessage(message),
    });
  }

  return {
    rootRunId: row.root_run_id,
    runId: row.run_id,
    delegateName: row.run_delegate_name,
    depth: row.delegation_depth ?? 0,
    initialSnapshotSeq: row.initial_snapshot_seq,
    initialSnapshotCreatedAt: row.initial_snapshot_created_at,
    latestSnapshotSeq: row.latest_snapshot_seq,
    latestSnapshotCreatedAt: row.latest_snapshot_created_at,
    initialMessages,
    latestStepsUsed: latestState.stepsUsed,
    effectiveMessages,
  };
}

function snapshotSummaryFromMessageTrace(trace: RunMessageTrace): RunSnapshotSummary {
  return {
    rootRunId: trace.rootRunId,
    runId: trace.runId,
    delegateName: trace.delegateName,
    depth: trace.depth,
    latestSnapshotSeq: trace.latestSnapshotSeq,
    latestSnapshotCreatedAt: trace.latestSnapshotCreatedAt,
    latestStepsUsed: trace.latestStepsUsed ?? null,
  };
}

function parseSnapshotState(value: unknown): { messages: ParsedTraceMessage[]; pendingRuntimeMessages: ParsedTraceMessage[]; stepsUsed: number | null } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    messages: parseTraceMessages(record.messages),
    pendingRuntimeMessages: parseTraceMessages(record.pendingRuntimeMessages),
    stepsUsed: typeof record.stepsUsed === 'number' ? record.stepsUsed : null,
  };
}

interface ParsedTraceMessage {
  role: TraceMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: TraceToolCall[];
}

function parseTraceMessages(value: unknown): ParsedTraceMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const parsed = parseTraceMessage(entry);
    return parsed ? [parsed] : [];
  });
}

function parseTraceMessage(value: unknown): ParsedTraceMessage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!isTraceMessageRole(record.role) || typeof record.content !== 'string') {
    return null;
  }

  const toolCalls = parseTraceToolCalls(record.toolCalls);
  return {
    role: record.role,
    content: record.content,
    name: typeof record.name === 'string' ? record.name : undefined,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function parseTraceToolCalls(value: unknown): TraceToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || !('input' in record)) {
      return [];
    }

    return [{
      id: record.id,
      name: record.name,
      input: record.input,
    }];
  });
}

function isTraceMessageRole(value: unknown): value is TraceMessageRole {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool';
}

function classifyPersistedMessage(
  message: ParsedTraceMessage,
  index: number,
  initialMessageCount: number,
  initialSystemMessagesSeen: number,
): TraceMessage['category'] {
  switch (message.role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
    case 'system':
      if (index >= initialMessageCount) {
        return 'runtime-injected-system';
      }
      return initialSystemMessagesSeen === 0 ? 'initial-runtime-system' : 'gateway-chat-system-context';
  }
}

function classifyPendingMessage(message: ParsedTraceMessage): TraceMessage['category'] {
  switch (message.role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
    case 'system':
      return 'runtime-injected-system';
  }
}

function humanMessageCategory(category: TraceMessage['category']): string {
  switch (category) {
    case 'initial-runtime-system':
      return chalk.cyan('initial runtime system prompt');
    case 'gateway-chat-system-context':
      return chalk.cyan('gateway/chat system context');
    case 'runtime-injected-system':
      return chalk.yellow('runtime-injected system prompt');
    case 'user':
      return chalk.white('user message');
    case 'assistant':
      return chalk.white('assistant message');
    case 'tool':
      return chalk.white('tool message');
  }
}

function humanMessageCategoryPlain(category: TraceMessage['category']): string {
  switch (category) {
    case 'initial-runtime-system':
      return 'initial-runtime-system';
    case 'gateway-chat-system-context':
      return 'gateway-chat-system-context';
    case 'runtime-injected-system':
      return 'runtime-injected-system';
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
  }
}

function summarizeMessages(messages: TraceMessage[]): {
  persisted: number;
  pending: number;
  system: number;
  runtimeInjected: number;
  user: number;
  assistant: number;
  tool: number;
} {
  return messages.reduce(
    (counts, message) => {
      if (message.persistence === 'persisted') {
        counts.persisted += 1;
      } else {
        counts.pending += 1;
      }
      if (message.role === 'system') {
        counts.system += 1;
      }
      if (message.category === 'runtime-injected-system') {
        counts.runtimeInjected += 1;
      }
      if (message.role === 'user') {
        counts.user += 1;
      }
      if (message.role === 'assistant') {
        counts.assistant += 1;
      }
      if (message.role === 'tool') {
        counts.tool += 1;
      }
      return counts;
    },
    { persisted: 0, pending: 0, system: 0, runtimeInjected: 0, user: 0, assistant: 0, tool: 0 },
  );
}

function formatMessagePreview(message: TraceMessage, previewChars: number): string {
  const parts: string[] = [];
  if (message.name) {
    parts.push(`name=${message.name}`);
  }
  if (message.toolCallId) {
    parts.push(`toolCallId=${message.toolCallId}`);
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    parts.push(`toolCalls=${message.toolCalls.length} [${message.toolCalls.map((toolCall) => toolCall.name).join(', ')}]`);
  }
  const content = oneLine(message.content).trim();
  if (content.length > 0) {
    parts.push(truncatePlain(content, previewChars));
  }
  return parts.length > 0 ? parts.join(' | ') : '(empty)';
}

function buildMessageDeltaRows(trace: RunMessageTrace): Array<{ kind: 'added' | 'changed' | 'pending'; message: TraceMessage }> {
  const initialMessages = trace.initialMessages ?? [];
  const latestPersistedMessages = trace.effectiveMessages.filter((message) => message.persistence === 'persisted');
  const pendingMessages = trace.effectiveMessages.filter((message) => message.persistence === 'pending');
  const rows: Array<{ kind: 'added' | 'changed' | 'pending'; message: TraceMessage }> = [];

  for (let index = 0; index < latestPersistedMessages.length; index += 1) {
    const message = latestPersistedMessages[index]!;
    if (index >= initialMessages.length) {
      rows.push({ kind: 'added', message });
      continue;
    }
    if (!messagesEquivalent(initialMessages[index]!, message)) {
      rows.push({ kind: 'changed', message });
    }
  }

  for (const message of pendingMessages) {
    rows.push({ kind: 'pending', message });
  }

  return rows;
}

function messagesEquivalent(left: TraceMessage, right: TraceMessage): boolean {
  return left.role === right.role
    && left.content === right.content
    && left.name === right.name
    && left.toolCallId === right.toolCallId
    && JSON.stringify(left.toolCalls ?? []) === JSON.stringify(right.toolCalls ?? []);
}

function resolveReportView(options: Pick<CliOptions, 'onlyDelegates'> & Partial<Pick<CliOptions, 'view'>>): ReportView {
  if (options.view) {
    return options.view;
  }
  if (options.onlyDelegates) {
    return 'delegates';
  }
  return 'all';
}

function shouldRenderSection(view: ReportView, section: Exclude<ReportView, 'overview' | 'all'>): boolean {
  return view === 'all' || view === section;
}

function shouldRenderFinalOutput(view: ReportView): boolean {
  return view === 'all' || view === 'overview';
}

function buildMilestones(rows: TraceRow[]): MilestoneEntry[] {
  const entries = new Map<string, MilestoneEntry>();

  for (const row of rows) {
    if (!row.event_type || !CORE_EVENT_TYPE_SET.has(row.event_type)) {
      continue;
    }

    const key = row.event_id ?? `${row.run_id}:${row.event_seq ?? row.event_created_at ?? entries.size}`;
    if (entries.has(key)) {
      continue;
    }

    const frame: AgentEventFrame = {
      type: 'agent.event',
      eventType: row.event_type as EventType,
      data: toEventData(row.payload),
      seq: row.event_seq ?? undefined,
      stepId: row.event_step_id ?? undefined,
      createdAt: row.event_created_at ?? undefined,
      runId: row.run_id,
      rootRunId: row.root_run_id,
      parentRunId: row.parent_run_id ?? undefined,
    };

    entries.set(key, {
      rootRunId: row.root_run_id,
      runId: row.run_id,
      depth: row.delegation_depth ?? 0,
      eventType: row.event_type as EventType,
      stepId: row.event_step_id,
      createdAt: row.event_created_at,
      eventSeq: row.event_seq,
      text: formatCompactAgentEventFrame(frame),
    });
  }

  return [...entries.values()].sort((left, right) =>
    compareTime(left.createdAt, right.createdAt)
    || left.rootRunId.localeCompare(right.rootRunId)
    || left.runId.localeCompare(right.runId)
    || (left.eventSeq ?? 0) - (right.eventSeq ?? 0),
  );
}

function buildRunTreeEntries(rows: TraceRow[]): RunTreeEntry[] {
  const entries = new Map<string, RunTreeEntry>();

  for (const row of rows) {
    if (entries.has(row.run_id)) {
      continue;
    }
    entries.set(row.run_id, {
      rootRunId: row.root_run_id,
      runId: row.run_id,
      parentRunId: row.parent_run_id,
      delegateName: row.run_delegate_name,
      depth: row.delegation_depth ?? 0,
    });
  }

  return [...entries.values()].sort((left, right) =>
    left.depth - right.depth
    || left.rootRunId.localeCompare(right.rootRunId)
    || left.runId.localeCompare(right.runId),
  );
}

function totalStepsFromSnapshotSummaries(summaries: RunSnapshotSummary[]): number | null {
  const knownSteps = summaries.filter((summary) => summary.latestStepsUsed !== null);
  if (knownSteps.length === 0) {
    return null;
  }
  return knownSteps.reduce((total, summary) => total + (summary.latestStepsUsed ?? 0), 0);
}

function collectFocusedRunIds(runTree: RunTreeEntry[], focusRunId: string): Set<string> {
  if (!runTree.some((entry) => entry.runId === focusRunId)) {
    return new Set();
  }

  const childrenByParent = new Map<string, string[]>();
  for (const entry of runTree) {
    if (!entry.parentRunId) {
      continue;
    }
    const children = childrenByParent.get(entry.parentRunId) ?? [];
    children.push(entry.runId);
    childrenByParent.set(entry.parentRunId, children);
  }

  const focused = new Set<string>();
  const queue = [focusRunId];
  while (queue.length > 0) {
    const runId = queue.shift()!;
    if (focused.has(runId)) {
      continue;
    }
    focused.add(runId);
    for (const childRunId of childrenByParent.get(runId) ?? []) {
      queue.push(childRunId);
    }
  }
  return focused;
}

function filterReportForFocusedRun(report: TraceReport, focusedRunIds: Set<string>): TraceReport {
  const focusedRootRunIds = new Set((report.runTree ?? [])
    .filter((entry) => focusedRunIds.has(entry.runId))
    .map((entry) => entry.rootRunId));

  return {
    ...report,
    rootRuns: report.rootRuns.filter((run) => focusedRootRunIds.has(run.rootRunId)),
    timeline: report.timeline.filter((entry) => focusedRunIds.has(entry.runId)),
    milestones: (report.milestones ?? []).filter((entry) => focusedRunIds.has(entry.runId)),
    llmMessages: report.llmMessages.filter((trace) => focusedRunIds.has(trace.runId)),
    runTree: (report.runTree ?? []).filter((entry) => focusedRunIds.has(entry.runId)),
    snapshotSummaries: (report.snapshotSummaries ?? []).filter((summary) => focusedRunIds.has(summary.runId)),
    delegates: report.delegates.filter((delegate) => focusedRunIds.has(delegate.parent_run_id) || (delegate.child_run_id !== null && focusedRunIds.has(delegate.child_run_id))),
    plans: report.plans.filter((plan) => focusedRunIds.has(plan.run_id)),
  };
}

function toEventData(value: unknown): AgentEventFrame['data'] {
  return value as AgentEventFrame['data'];
}

function renderTable(headers: string[], rows: string[][], options?: { maxWidths?: number[] }): string {
  const widths = headers.map((header, index) =>
    Math.min(
      Math.max(
        header.length,
        ...rows.map((row) => stripAnsi(row[index] ?? '').length),
      ),
      options?.maxWidths?.[index] ?? (index === headers.length - 1 ? 80 : 36),
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

function messageRoleColor(role: TraceMessageRole): (value: string) => string {
  switch (role) {
    case 'user':
      return chalk.blueBright;
    case 'assistant':
      return chalk.cyanBright;
    case 'tool':
      return chalk.greenBright;
    case 'system':
      return chalk.yellowBright;
  }
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

function earliestTimelineStart(entries: TimelineEntry[]): string | null {
  let earliest: string | null = null;
  for (const entry of entries) {
    if (compareTime(entry.startedAt, earliest) < 0) {
      earliest = entry.startedAt;
    }
  }
  return earliest;
}

function timelineStepKey(runId: string, stepId: string | null, toolName: string | null): string {
  return `${runId}:${stepId ?? '-'}:${toolName ?? '-'}`;
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

function formatTimeOfDay(value: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(11, -1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
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

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncatePlain(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
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

function parseReportView(value: string): ReportView {
  if (value === 'overview' || value === 'milestones' || value === 'timeline' || value === 'delegates' || value === 'messages' || value === 'plans' || value === 'all') {
    return value;
  }
  throw new Error(`Invalid --view value: ${value}. Expected one of overview, milestones, timeline, delegates, messages, plans, or all.`);
}

function parseMessageView(value: string): MessageView {
  if (value === 'compact' || value === 'delta' || value === 'full') {
    return value;
  }
  throw new Error(`Invalid --messages-view value: ${value}. Expected one of compact, delta, or full.`);
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive integer.`);
  }
  return parsed;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function truncateAnsi(value: string, width: number): string {
  const plain = stripAnsi(value);
  if (plain.length <= width) {
    return value;
  }
  const prefix = value.match(/^(?:\u001b\[[0-9;]*m)+/)?.[0] ?? '';
  const truncated = `${plain.slice(0, Math.max(0, width - 1))}…`;
  return prefix ? `${prefix}${truncated}\u001b[0m` : truncated;
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
