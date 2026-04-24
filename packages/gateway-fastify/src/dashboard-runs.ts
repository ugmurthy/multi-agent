import type { PostgresClient } from './stores-postgres.js';
import { runWithPostgresTransaction } from './postgres.js';
import { traceSession } from './trace-session/data.js';
import type { MessageView, TraceReport } from './trace-session/types.js';

export type DashboardSessionFilter = 'any' | 'linked' | 'sessionless';
export type DashboardRunSort = 'created_desc' | 'updated_desc' | 'duration_desc' | 'cost_desc';

export interface DashboardRunListFilters {
  from?: string;
  to?: string;
  status?: string[];
  session?: DashboardSessionFilter;
  sessionId?: string;
  rootRunId?: string;
  runId?: string;
  delegateName?: string;
  requiresApproval?: boolean;
  q?: string;
  sort?: DashboardRunSort;
  limit?: number;
  offset?: number;
}

export interface DashboardRunListItem {
  rootRunId: string;
  sessionId: string | null;
  status: string | null;
  goal: string | null;
  goalPreview: string | null;
  agentId: string | null;
  modelProvider: string | null;
  modelName: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  childRunCount: number;
  toolCallCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number | null;
  estimatedCostUSD: number;
  pendingApproval: DashboardPendingApproval | null;
}

export interface DashboardPendingApproval {
  runId: string;
  rootRunId: string;
  sessionId: string | null;
  toolName?: string;
  reason?: string;
}

export interface DashboardRunListResult {
  items: DashboardRunListItem[];
  limit: number;
  offset: number;
  nextOffset: number | null;
}

export interface DashboardDeleteEmptySessionsResult {
  deletedSessions: number;
  deletedTranscriptMessages: number;
  clearedCronRuns: number;
  clearedRunAdmissions: number;
}

export interface DashboardDeleteSessionResult {
  sessionId: string;
  deletedSessions: number;
  deletedTranscriptMessages: number;
  deletedSessionRunLinks: number;
  clearedCronRuns: number;
  clearedRunAdmissions: number;
}

export interface DashboardDeleteSessionlessRunResult {
  rootRunId: string;
  deletedRuns: number;
  deletedPlans: number;
  deletedCronRuns: number;
  deletedRunAdmissions: number;
}

export class DashboardDeleteConflictError extends Error {
  constructor(
    message: string,
    readonly code: 'session_active' | 'run_linked_to_session' | 'run_not_terminal',
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DashboardDeleteConflictError';
  }
}

interface DashboardRunListRow {
  root_run_id: string;
  session_id: string | null;
  status: string | null;
  goal: string | null;
  goal_preview: string | null;
  agent_id: string | null;
  model_provider: string | null;
  model_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  duration_ms: string | number | null;
  child_run_count: string | number;
  tool_call_count: string | number;
  total_prompt_tokens: string | number;
  total_completion_tokens: string | number;
  total_reasoning_tokens: string | number | null;
  estimated_cost_usd: string | number;
  pending_approval: unknown;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listDashboardRootRuns(
  client: PostgresClient,
  filters: DashboardRunListFilters = {},
): Promise<DashboardRunListResult> {
  const limit = clampInteger(filters.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInteger(filters.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const params: unknown[] = [];
  const where: string[] = ['root.parent_run_id is null', 'root.id = root.root_run_id'];

  addDateFilter(where, params, 'root.created_at', '>=', filters.from);
  addDateFilter(where, params, 'root.created_at', '<=', filters.to);

  if (filters.status && filters.status.length > 0) {
    params.push(filters.status);
    where.push(`root.status = any($${params.length}::text[])`);
  }

  if (filters.session === 'linked') {
    where.push('link.session_id is not null');
  } else if (filters.session === 'sessionless') {
    where.push('link.session_id is null');
  }

  if (filters.sessionId) {
    params.push(filters.sessionId);
    where.push(`link.session_id = $${params.length}`);
  }

  if (filters.rootRunId) {
    params.push(filters.rootRunId);
    where.push(`root.id::text = $${params.length}`);
  }

  if (filters.runId) {
    params.push(filters.runId);
    where.push(`exists (
      select 1
      from agent_runs selected_run
      where selected_run.root_run_id = root.id
        and selected_run.id::text = $${params.length}
    )`);
  }

  if (filters.delegateName) {
    params.push(filters.delegateName);
    where.push(`exists (
      select 1
      from agent_runs delegate_run
      where delegate_run.root_run_id = root.id
        and delegate_run.delegate_name = $${params.length}
    )`);
  }

  if (filters.requiresApproval === true) {
    where.push(`root.status = 'awaiting_approval'`);
  } else if (filters.requiresApproval === false) {
    where.push(`root.status is distinct from 'awaiting_approval'`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(
      root.goal ilike $${params.length}
      or coalesce(root.error_message, '') ilike $${params.length}
      or coalesce(root.result::text, '') ilike $${params.length}
    )`);
  }

  const orderBy = dashboardRunOrderBy(filters.sort);
  params.push(limit + 1);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const result = await client.query<DashboardRunListRow>(
    `
      with root_links as (
        select distinct on (l.root_run_id)
          l.root_run_id,
          l.session_id,
          l.created_at
        from gateway_session_run_links l
        where l.invocation_kind = 'run'
        order by l.root_run_id, l.created_at desc, l.run_id desc
      ),
      root_rollups as (
        select
          r.root_run_id,
          greatest(count(*) - 1, 0)::text as child_run_count,
          coalesce(sum(r.total_prompt_tokens), 0)::text as total_prompt_tokens,
          coalesce(sum(r.total_completion_tokens), 0)::text as total_completion_tokens,
          nullif(coalesce(sum(r.total_reasoning_tokens), 0), 0)::text as total_reasoning_tokens,
          coalesce(sum(r.estimated_cost_usd), 0)::text as estimated_cost_usd
        from agent_runs r
        group by r.root_run_id
      ),
      tool_calls as (
        select r.root_run_id, e.tool_call_id
        from agent_runs r
        join agent_events e on e.run_id = r.id
        where e.tool_call_id is not null

        union

        select r.root_run_id, te.tool_call_id
        from agent_runs r
        join tool_executions te on te.run_id = r.id
      ),
      tool_rollups as (
        select
          root_run_id,
          count(distinct tool_call_id)::text as tool_call_count
        from tool_calls
        group by root_run_id
      )
      select
        root.id::text as root_run_id,
        link.session_id,
        root.status,
        root.goal,
        left(regexp_replace(root.goal, '\\s+', ' ', 'g'), 180) as goal_preview,
        root.metadata ->> 'agentId' as agent_id,
        root.model_provider,
        root.model_name,
        root.created_at,
        root.updated_at,
        root.completed_at,
        case
          when root.completed_at is null then null
          else extract(epoch from (root.completed_at - root.created_at)) * 1000
        end::text as duration_ms,
        coalesce(rollup.child_run_count, '0') as child_run_count,
        coalesce(tools.tool_call_count, '0') as tool_call_count,
        coalesce(rollup.total_prompt_tokens, '0') as total_prompt_tokens,
        coalesce(rollup.total_completion_tokens, '0') as total_completion_tokens,
        rollup.total_reasoning_tokens,
        coalesce(rollup.estimated_cost_usd, '0') as estimated_cost_usd,
        case
          when root.status = 'awaiting_approval' then jsonb_build_object(
            'runId', coalesce(root.current_child_run_id::text, root.id::text),
            'rootRunId', root.id::text,
            'sessionId', link.session_id
          )
          else null
        end as pending_approval
      from agent_runs root
      left join root_links link on link.root_run_id = root.id::text
      left join root_rollups rollup on rollup.root_run_id = root.id
      left join tool_rollups tools on tools.root_run_id = root.id
      where ${where.join('\n        and ')}
      order by ${orderBy}, root.id desc
      limit $${limitParam}
      offset $${offsetParam}
    `,
    params,
  );

  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map(dashboardRunListItemFromRow),
    limit,
    offset,
    nextOffset: result.rows.length > limit ? offset + limit : null,
  };
}

export async function loadDashboardRunTrace(
  client: PostgresClient,
  rootRunId: string,
  options: { includePlans?: boolean; messages?: boolean; messagesView?: MessageView; focusRunId?: string } = {},
): Promise<TraceReport> {
  return await traceSession(client, {
    rootRunId,
    json: true,
    listSessions: false,
    listSessionless: false,
    deleteEmptyGoalSessions: false,
    usageOnly: false,
    includePlans: options.includePlans ?? true,
    onlyDelegates: false,
    messages: options.messages ?? true,
    systemOnly: false,
    view: options.messages ? 'messages' : undefined,
    messagesView: options.messagesView ?? 'compact',
    focusRunId: options.focusRunId,
    help: false,
  });
}

export async function deleteDashboardEmptySessions(client: PostgresClient): Promise<DashboardDeleteEmptySessionsResult> {
  return await runWithPostgresTransaction(client, async (transactionClient) => {
    const sessionsResult = await transactionClient.query<{ id: string }>(`
      select s.id
      from gateway_sessions s
      where not exists (
        select 1
        from gateway_session_run_links l
        where l.session_id = s.id
      )
      for update
    `);
    const sessionIds = sessionsResult.rows.map((row) => row.id);
    if (sessionIds.length === 0) {
      return {
        deletedSessions: 0,
        deletedTranscriptMessages: 0,
        clearedCronRuns: 0,
        clearedRunAdmissions: 0,
      };
    }

    const transcriptResult = await transactionClient.query(
      `delete from gateway_transcript_messages where session_id = any($1::text[])`,
      [sessionIds],
    );
    const cronResult = await transactionClient.query(
      `update gateway_cron_runs set session_id = null where session_id = any($1::text[])`,
      [sessionIds],
    );
    const admissionResult = await transactionClient.query(
      `update gateway_run_admissions set session_id = null, updated_at = now() where session_id = any($1::text[])`,
      [sessionIds],
    );
    const sessionResult = await transactionClient.query(
      `delete from gateway_sessions where id = any($1::text[])`,
      [sessionIds],
    );

    return {
      deletedSessions: sessionResult.rowCount,
      deletedTranscriptMessages: transcriptResult.rowCount,
      clearedCronRuns: cronResult.rowCount,
      clearedRunAdmissions: admissionResult.rowCount,
    };
  });
}

export async function deleteDashboardSession(
  client: PostgresClient,
  sessionId: string,
): Promise<DashboardDeleteSessionResult> {
  return await runWithPostgresTransaction(client, async (transactionClient) => {
    const sessionResult = await transactionClient.query<{ status: string }>(
      `select status from gateway_sessions where id = $1 for update`,
      [sessionId],
    );
    const session = sessionResult.rows[0];
    if (session?.status === 'running' || session?.status === 'awaiting_approval') {
      throw new DashboardDeleteConflictError(
        `Session "${sessionId}" is ${session.status}; only idle, failed, closed, or missing sessions can be deleted.`,
        'session_active',
        { sessionId, status: session.status },
      );
    }

    const transcriptResult = await transactionClient.query(
      `delete from gateway_transcript_messages where session_id = $1`,
      [sessionId],
    );
    const linksResult = await transactionClient.query(
      `delete from gateway_session_run_links where session_id = $1`,
      [sessionId],
    );
    const cronResult = await transactionClient.query(
      `update gateway_cron_runs set session_id = null where session_id = $1`,
      [sessionId],
    );
    const admissionResult = await transactionClient.query(
      `update gateway_run_admissions set session_id = null, updated_at = now() where session_id = $1`,
      [sessionId],
    );
    const sessionDeleteResult = await transactionClient.query(
      `delete from gateway_sessions where id = $1`,
      [sessionId],
    );

    return {
      sessionId,
      deletedSessions: sessionDeleteResult.rowCount,
      deletedTranscriptMessages: transcriptResult.rowCount,
      deletedSessionRunLinks: linksResult.rowCount,
      clearedCronRuns: cronResult.rowCount,
      clearedRunAdmissions: admissionResult.rowCount,
    };
  });
}

export async function deleteDashboardSessionlessRun(
  client: PostgresClient,
  rootRunId: string,
): Promise<DashboardDeleteSessionlessRunResult> {
  return await runWithPostgresTransaction(client, async (transactionClient) => {
    const rootResult = await transactionClient.query<{ id: string }>(
      `
        select id::text as id
        from agent_runs
        where id = $1::uuid
          and root_run_id = id
        for update
      `,
      [rootRunId],
    );
    if (!rootResult.rows[0]) {
      return {
        rootRunId,
        deletedRuns: 0,
        deletedPlans: 0,
        deletedCronRuns: 0,
        deletedRunAdmissions: 0,
      };
    }

    const linkResult = await transactionClient.query<{ count: string | number }>(
      `select count(*) as count from gateway_session_run_links where root_run_id = $1`,
      [rootRunId],
    );
    const linkedSessionCount = Number(linkResult.rows[0]?.count ?? 0);
    if (linkedSessionCount > 0) {
      throw new DashboardDeleteConflictError(
        `Root run "${rootRunId}" is linked to a gateway session and cannot be deleted as sessionless.`,
        'run_linked_to_session',
        { rootRunId, linkedSessionCount },
      );
    }

    const activeResult = await transactionClient.query<{ status: string; count: string | number }>(
      `
        select status, count(*) as count
        from agent_runs
        where root_run_id = $1::uuid
          and status <> all($2::text[])
        group by status
        order by status asc
      `,
      [rootRunId, ['succeeded', 'failed', 'clarification_requested', 'replan_required', 'cancelled']],
    );
    if (activeResult.rows.length > 0) {
      throw new DashboardDeleteConflictError(
        `Root run "${rootRunId}" contains non-terminal runs and cannot be deleted.`,
        'run_not_terminal',
        {
          rootRunId,
          statuses: activeResult.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
        },
      );
    }

    const cronResult = await transactionClient.query(
      `delete from gateway_cron_runs where root_run_id = $1`,
      [rootRunId],
    );
    const admissionResult = await transactionClient.query(
      `delete from gateway_run_admissions where root_run_id = $1`,
      [rootRunId],
    );
    const planResult = await transactionClient.query(
      `
        delete from plans
        where created_from_run_id in (
          select id from agent_runs where root_run_id = $1::uuid
        )
      `,
      [rootRunId],
    );

    await transactionClient.query(
      `
        update agent_runs
        set current_child_run_id = null,
            current_plan_id = null,
            current_plan_execution_id = null
        where root_run_id = $1::uuid
      `,
      [rootRunId],
    );
    const childRunResult = await transactionClient.query(
      `delete from agent_runs where root_run_id = $1::uuid and id <> $1::uuid`,
      [rootRunId],
    );
    const rootRunResult = await transactionClient.query(
      `delete from agent_runs where id = $1::uuid`,
      [rootRunId],
    );

    return {
      rootRunId,
      deletedRuns: childRunResult.rowCount + rootRunResult.rowCount,
      deletedPlans: planResult.rowCount,
      deletedCronRuns: cronResult.rowCount,
      deletedRunAdmissions: admissionResult.rowCount,
    };
  });
}

function dashboardRunListItemFromRow(row: DashboardRunListRow): DashboardRunListItem {
  return {
    rootRunId: row.root_run_id,
    sessionId: row.session_id,
    status: row.status,
    goal: row.goal,
    goalPreview: row.goal_preview,
    agentId: row.agent_id,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    durationMs: nullableNumber(row.duration_ms),
    childRunCount: Number(row.child_run_count ?? 0),
    toolCallCount: Number(row.tool_call_count ?? 0),
    totalPromptTokens: Number(row.total_prompt_tokens ?? 0),
    totalCompletionTokens: Number(row.total_completion_tokens ?? 0),
    totalReasoningTokens: nullableNumber(row.total_reasoning_tokens),
    estimatedCostUSD: Number(row.estimated_cost_usd ?? 0),
    pendingApproval: parsePendingApproval(row.pending_approval),
  };
}

function parsePendingApproval(value: unknown): DashboardPendingApproval | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.runId !== 'string' || typeof record.rootRunId !== 'string') {
    return null;
  }
  return {
    runId: record.runId,
    rootRunId: record.rootRunId,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : null,
    ...(typeof record.toolName === 'string' ? { toolName: record.toolName } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  };
}

function addDateFilter(where: string[], params: unknown[], column: string, operator: '>=' | '<=', value: string | undefined): void {
  if (!value) {
    return;
  }
  params.push(value);
  where.push(`${column} ${operator} $${params.length}::timestamptz`);
}

function dashboardRunOrderBy(sort: DashboardRunSort | undefined): string {
  switch (sort) {
    case 'duration_desc':
      return 'duration_ms desc nulls last, root.created_at desc';
    case 'cost_desc':
      return 'estimated_cost_usd desc, root.created_at desc';
    case 'updated_desc':
      return 'root.updated_at desc';
    case 'created_desc':
    default:
      return 'root.created_at desc';
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function nullableNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
