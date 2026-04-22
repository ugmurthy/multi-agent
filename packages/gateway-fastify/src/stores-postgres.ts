/**
 * PostgreSQL-backed gateway stores for sessions, transcript messages,
 * and session-run links.
 *
 * Schema (gateway-owned tables, separate from runtime execution tables):
 *
 *   gateway_sessions (
 *     id            TEXT PRIMARY KEY,
 *     channel_id    TEXT NOT NULL,
 *     agent_id      TEXT,
 *     invocation_mode TEXT,
 *     auth_subject  TEXT NOT NULL,
 *     tenant_id     TEXT,
 *     status        TEXT NOT NULL DEFAULT 'idle',
 *     current_run_id TEXT,
 *     current_root_run_id TEXT,
 *     last_completed_root_run_id TEXT,
 *     transcript_version INTEGER NOT NULL DEFAULT 0,
 *     transcript_summary TEXT,
 *     metadata      JSONB,
 *     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *
 *   gateway_transcript_messages (
 *     id            TEXT PRIMARY KEY,
 *     session_id    TEXT NOT NULL REFERENCES gateway_sessions(id) ON DELETE CASCADE,
 *     sequence      INTEGER NOT NULL,
 *     role          TEXT NOT NULL,
 *     content       TEXT NOT NULL,
 *     metadata      JSONB,
 *     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *
 *   gateway_session_run_links (
 *     run_id        TEXT PRIMARY KEY,
 *     session_id    TEXT NOT NULL REFERENCES gateway_sessions(id) ON DELETE CASCADE,
 *     root_run_id   TEXT NOT NULL,
 *     invocation_kind TEXT NOT NULL,
 *     turn_index    INTEGER,
 *     metadata      JSONB,
 *     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 */

import type { JsonObject, JsonValue } from './core.js';
import type { InvocationMode } from './config.js';
import type { SessionStatus } from './protocol.js';
import type {
  GatewaySessionRecord,
  SessionRunLinkRecord,
  SessionRunLinkStore,
  SessionStore,
  TranscriptMessageRecord,
  TranscriptMessageRole,
  TranscriptMessageStore,
  GatewayInvocationKind,
  GatewayRunAdmissionRecord,
  RunAdmissionLimits,
  RunAdmissionStore,
  RunAdmissionStatus,
  TryAcquireRunAdmissionResult,
  TryStartRunResult,
} from './stores.js';

export interface PostgresQueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface PostgresClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<PostgresQueryResult<T>>;
}

interface SessionRow {
  id: string;
  channel_id: string;
  agent_id: string | null;
  invocation_mode: string | null;
  auth_subject: string;
  tenant_id: string | null;
  status: string;
  current_run_id: string | null;
  current_root_run_id: string | null;
  last_completed_root_run_id: string | null;
  transcript_version: number;
  transcript_summary: string | null;
  metadata: JsonObject | null;
  created_at: string;
  updated_at: string;
}

interface TranscriptMessageRow {
  id: string;
  session_id: string;
  sequence: number;
  role: string;
  content: string;
  metadata: JsonObject | null;
  created_at: string;
}

interface SessionRunLinkRow {
  run_id: string;
  session_id: string;
  root_run_id: string;
  invocation_kind: string;
  turn_index: number | null;
  metadata: JsonObject | null;
  created_at: string;
}

interface RunAdmissionRow {
  id: string;
  agent_id: string;
  tenant_id: string | null;
  session_id: string | null;
  root_run_id: string | null;
  status: string;
  lease_owner: string;
  lease_expires_at: string;
  metadata: JsonObject | null;
  created_at: string;
  updated_at: string;
}

export const POSTGRES_SESSION_QUERIES = {
  create: `
    INSERT INTO gateway_sessions (
      id, channel_id, agent_id, invocation_mode, auth_subject, tenant_id,
      status, current_run_id, current_root_run_id, last_completed_root_run_id,
      transcript_version, transcript_summary, metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `,
  get: `SELECT * FROM gateway_sessions WHERE id = $1`,
  update: `
    UPDATE gateway_sessions SET
      channel_id = $2, agent_id = $3, invocation_mode = $4, auth_subject = $5,
      tenant_id = $6, status = $7, current_run_id = $8, current_root_run_id = $9,
      last_completed_root_run_id = $10, transcript_version = $11,
      transcript_summary = $12, metadata = $13, updated_at = $14
    WHERE id = $1
    RETURNING *
  `,
  tryStartRun: `
    UPDATE gateway_sessions SET
      channel_id = $2, agent_id = $3, invocation_mode = $4, auth_subject = $5,
      tenant_id = $6, status = $7, current_run_id = $8, current_root_run_id = $9,
      last_completed_root_run_id = $10, transcript_version = $11,
      transcript_summary = $12, metadata = $13, updated_at = $14
    WHERE id = $1 AND status = ANY($15::text[])
    RETURNING *
  `,
  delete: `DELETE FROM gateway_sessions WHERE id = $1`,
  listByAuthSubject: `
    SELECT * FROM gateway_sessions WHERE auth_subject = $1
    ORDER BY created_at ASC, id ASC
  `,
  listAll: `
    SELECT * FROM gateway_sessions
    ORDER BY created_at ASC, id ASC
  `,
} as const;

export const POSTGRES_TRANSCRIPT_QUERIES = {
  append: `
    INSERT INTO gateway_transcript_messages (
      id, session_id, sequence, role, content, metadata, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
  listBySession: `
    SELECT * FROM gateway_transcript_messages WHERE session_id = $1
    ORDER BY sequence ASC, created_at ASC, id ASC
  `,
  deleteBySession: `DELETE FROM gateway_transcript_messages WHERE session_id = $1`,
} as const;

export const POSTGRES_SESSION_RUN_LINK_QUERIES = {
  append: `
    INSERT INTO gateway_session_run_links (
      run_id, session_id, root_run_id, invocation_kind, turn_index, metadata, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
  getByRunId: `SELECT * FROM gateway_session_run_links WHERE run_id = $1`,
  listByRootRunId: `
    SELECT * FROM gateway_session_run_links WHERE root_run_id = $1
    ORDER BY created_at ASC, run_id ASC
  `,
  listBySession: `
    SELECT * FROM gateway_session_run_links WHERE session_id = $1
    ORDER BY created_at ASC, run_id ASC
  `,
  deleteBySession: `DELETE FROM gateway_session_run_links WHERE session_id = $1`,
} as const;

export const POSTGRES_RUN_ADMISSION_QUERIES = {
  createIfUnderLimits: `
    WITH admission_lock AS (
      SELECT pg_advisory_xact_lock(hashtext('gateway_run_admissions'))
    ),
    active_counts AS (
      SELECT
        count(*)::int AS total_count,
        count(*) FILTER (WHERE tenant_id = $3)::int AS tenant_count,
        count(*) FILTER (WHERE agent_id = $2)::int AS agent_count
      FROM gateway_run_admissions, admission_lock
      WHERE status = 'running' AND lease_expires_at > $11
    ),
    inserted AS (
      INSERT INTO gateway_run_admissions (
        id, agent_id, tenant_id, session_id, root_run_id, status,
        lease_owner, lease_expires_at, metadata, created_at, updated_at
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      FROM active_counts
      WHERE total_count < $12
        AND ($3::text IS NULL OR tenant_count < $13)
        AND agent_count < $14
      RETURNING *
    )
    SELECT * FROM inserted
  `,
  activeCounts: `
    SELECT
      count(*)::int AS total_count,
      count(*) FILTER (WHERE tenant_id = $1)::int AS tenant_count,
      count(*) FILTER (WHERE agent_id = $2)::int AS agent_count
    FROM gateway_run_admissions
    WHERE status = 'running' AND lease_expires_at > $3
  `,
  release: `
    UPDATE gateway_run_admissions SET status = 'released', updated_at = $2
    WHERE id = $1
  `,
  listActive: `
    SELECT * FROM gateway_run_admissions
    WHERE status = 'running' AND lease_expires_at > $1
    ORDER BY created_at ASC, id ASC
  `,
} as const;

function sessionRowToRecord(row: SessionRow): GatewaySessionRecord {
  return {
    id: row.id,
    channelId: row.channel_id,
    agentId: row.agent_id ?? undefined,
    invocationMode: (row.invocation_mode as InvocationMode) ?? undefined,
    authSubject: row.auth_subject,
    tenantId: row.tenant_id ?? undefined,
    status: row.status as SessionStatus,
    currentRunId: row.current_run_id ?? undefined,
    currentRootRunId: row.current_root_run_id ?? undefined,
    lastCompletedRootRunId: row.last_completed_root_run_id ?? undefined,
    transcriptVersion: row.transcript_version,
    transcriptSummary: row.transcript_summary ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionRecordToParams(session: GatewaySessionRecord): unknown[] {
  return [
    session.id,
    session.channelId,
    session.agentId ?? null,
    session.invocationMode ?? null,
    session.authSubject,
    session.tenantId ?? null,
    session.status,
    session.currentRunId ?? null,
    session.currentRootRunId ?? null,
    session.lastCompletedRootRunId ?? null,
    session.transcriptVersion,
    session.transcriptSummary ?? null,
    jsonbParam(session.metadata),
    session.createdAt,
    session.updatedAt,
  ];
}

function sessionUpdateParams(session: GatewaySessionRecord): unknown[] {
  return [
    session.id,
    session.channelId,
    session.agentId ?? null,
    session.invocationMode ?? null,
    session.authSubject,
    session.tenantId ?? null,
    session.status,
    session.currentRunId ?? null,
    session.currentRootRunId ?? null,
    session.lastCompletedRootRunId ?? null,
    session.transcriptVersion,
    session.transcriptSummary ?? null,
    jsonbParam(session.metadata),
    session.updatedAt,
  ];
}

function transcriptRowToRecord(row: TranscriptMessageRow): TranscriptMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    role: row.role as TranscriptMessageRole,
    content: row.content,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
  };
}

function transcriptRecordToParams(message: TranscriptMessageRecord): unknown[] {
  return [
    message.id,
    message.sessionId,
    message.sequence,
    message.role,
    message.content,
    jsonbParam(message.metadata),
    message.createdAt,
  ];
}

function linkRowToRecord(row: SessionRunLinkRow): SessionRunLinkRecord {
  return {
    sessionId: row.session_id,
    runId: row.run_id,
    rootRunId: row.root_run_id,
    invocationKind: row.invocation_kind as GatewayInvocationKind,
    turnIndex: row.turn_index ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
  };
}

function linkRecordToParams(link: SessionRunLinkRecord): unknown[] {
  return [
    link.runId,
    link.sessionId,
    link.rootRunId,
    link.invocationKind,
    link.turnIndex ?? null,
    jsonbParam(link.metadata),
    link.createdAt,
  ];
}

function runAdmissionRowToRecord(row: RunAdmissionRow): GatewayRunAdmissionRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    tenantId: row.tenant_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    rootRunId: row.root_run_id ?? undefined,
    status: row.status as RunAdmissionStatus,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runAdmissionRecordToParams(admission: GatewayRunAdmissionRecord): unknown[] {
  return [
    admission.id,
    admission.agentId,
    admission.tenantId ?? null,
    admission.sessionId ?? null,
    admission.rootRunId ?? null,
    admission.status,
    admission.leaseOwner,
    admission.leaseExpiresAt,
    jsonbParam(admission.metadata),
    admission.createdAt,
    admission.updatedAt,
  ];
}

function jsonbParam(value: JsonValue | undefined | null): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly client: PostgresClient) {}

  async create(session: GatewaySessionRecord): Promise<GatewaySessionRecord> {
    const result = await this.client.query<SessionRow>(
      POSTGRES_SESSION_QUERIES.create,
      sessionRecordToParams(session),
    );
    return sessionRowToRecord(result.rows[0]!);
  }

  async get(sessionId: string): Promise<GatewaySessionRecord | undefined> {
    const result = await this.client.query<SessionRow>(POSTGRES_SESSION_QUERIES.get, [sessionId]);
    return result.rows[0] ? sessionRowToRecord(result.rows[0]) : undefined;
  }

  async update(session: GatewaySessionRecord): Promise<GatewaySessionRecord> {
    const result = await this.client.query<SessionRow>(
      POSTGRES_SESSION_QUERIES.update,
      sessionUpdateParams(session),
    );
    if (result.rowCount === 0) {
      throw new Error(`Session "${session.id}" does not exist.`);
    }
    return sessionRowToRecord(result.rows[0]!);
  }

  async tryStartRun(
    sessionId: string,
    patch: Partial<GatewaySessionRecord>,
    expectedAllowedStatuses: SessionStatus[],
  ): Promise<TryStartRunResult> {
    const current = await this.get(sessionId);
    if (!current) {
      return { acquired: false, reason: 'invalid_state' };
    }

    const nextSession: GatewaySessionRecord = {
      ...current,
      ...patch,
      id: current.id,
    };
    const result = await this.client.query<SessionRow>(
      POSTGRES_SESSION_QUERIES.tryStartRun,
      [...sessionUpdateParams(nextSession), expectedAllowedStatuses],
    );
    if (result.rows[0]) {
      return { acquired: true, session: sessionRowToRecord(result.rows[0]) };
    }

    const latest = await this.get(sessionId);
    return {
      acquired: false,
      reason: latest?.status === 'running' ? 'session_busy' : 'invalid_state',
      session: latest,
    };
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.query(POSTGRES_SESSION_QUERIES.delete, [sessionId]);
  }

  async listByAuthSubject(authSubject: string): Promise<GatewaySessionRecord[]> {
    const result = await this.client.query<SessionRow>(POSTGRES_SESSION_QUERIES.listByAuthSubject, [authSubject]);
    return result.rows.map(sessionRowToRecord);
  }

  async listAll(): Promise<GatewaySessionRecord[]> {
    const result = await this.client.query<SessionRow>(POSTGRES_SESSION_QUERIES.listAll);
    return result.rows.map(sessionRowToRecord);
  }
}

export class PostgresTranscriptMessageStore implements TranscriptMessageStore {
  constructor(private readonly client: PostgresClient) {}

  async append(message: TranscriptMessageRecord): Promise<TranscriptMessageRecord> {
    const result = await this.client.query<TranscriptMessageRow>(
      POSTGRES_TRANSCRIPT_QUERIES.append,
      transcriptRecordToParams(message),
    );
    return transcriptRowToRecord(result.rows[0]!);
  }

  async listBySession(sessionId: string): Promise<TranscriptMessageRecord[]> {
    const result = await this.client.query<TranscriptMessageRow>(
      POSTGRES_TRANSCRIPT_QUERIES.listBySession,
      [sessionId],
    );
    return result.rows.map(transcriptRowToRecord);
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.client.query(POSTGRES_TRANSCRIPT_QUERIES.deleteBySession, [sessionId]);
  }
}

export class PostgresSessionRunLinkStore implements SessionRunLinkStore {
  constructor(private readonly client: PostgresClient) {}

  async append(link: SessionRunLinkRecord): Promise<SessionRunLinkRecord> {
    const result = await this.client.query<SessionRunLinkRow>(
      POSTGRES_SESSION_RUN_LINK_QUERIES.append,
      linkRecordToParams(link),
    );
    return linkRowToRecord(result.rows[0]!);
  }

  async getByRunId(runId: string): Promise<SessionRunLinkRecord | undefined> {
    const result = await this.client.query<SessionRunLinkRow>(
      POSTGRES_SESSION_RUN_LINK_QUERIES.getByRunId,
      [runId],
    );
    return result.rows[0] ? linkRowToRecord(result.rows[0]) : undefined;
  }

  async listByRootRunId(rootRunId: string): Promise<SessionRunLinkRecord[]> {
    const result = await this.client.query<SessionRunLinkRow>(
      POSTGRES_SESSION_RUN_LINK_QUERIES.listByRootRunId,
      [rootRunId],
    );
    return result.rows.map(linkRowToRecord);
  }

  async listBySession(sessionId: string): Promise<SessionRunLinkRecord[]> {
    const result = await this.client.query<SessionRunLinkRow>(
      POSTGRES_SESSION_RUN_LINK_QUERIES.listBySession,
      [sessionId],
    );
    return result.rows.map(linkRowToRecord);
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.client.query(POSTGRES_SESSION_RUN_LINK_QUERIES.deleteBySession, [sessionId]);
  }
}

interface ActiveCountsRow {
  total_count: number;
  tenant_count: number;
  agent_count: number;
}

export class PostgresRunAdmissionStore implements RunAdmissionStore {
  constructor(private readonly client: PostgresClient) {}

  async tryAcquire(
    admission: GatewayRunAdmissionRecord,
    limits: RunAdmissionLimits,
    now: string,
  ): Promise<TryAcquireRunAdmissionResult> {
    const result = await this.client.query<RunAdmissionRow>(
      POSTGRES_RUN_ADMISSION_QUERIES.createIfUnderLimits,
      [...runAdmissionRecordToParams(admission), limits.maxActiveRuns, limits.maxActiveRunsPerTenant, limits.maxActiveRunsPerAgent],
    );
    if (result.rows[0]) {
      return { acquired: true, admission: runAdmissionRowToRecord(result.rows[0]) };
    }

    const countsResult = await this.client.query<ActiveCountsRow>(POSTGRES_RUN_ADMISSION_QUERIES.activeCounts, [
      admission.tenantId ?? null,
      admission.agentId,
      now,
    ]);
    const counts = countsResult.rows[0] ?? { total_count: 0, tenant_count: 0, agent_count: 0 };
    if (counts.total_count >= limits.maxActiveRuns) {
      return { acquired: false, limit: 'maxActiveRuns', activeCount: counts.total_count };
    }
    if (admission.tenantId && counts.tenant_count >= limits.maxActiveRunsPerTenant) {
      return { acquired: false, limit: 'maxActiveRunsPerTenant', activeCount: counts.tenant_count };
    }
    return { acquired: false, limit: 'maxActiveRunsPerAgent', activeCount: counts.agent_count };
  }

  async release(admissionId: string, now: string): Promise<void> {
    await this.client.query(POSTGRES_RUN_ADMISSION_QUERIES.release, [admissionId, now]);
  }

  async listActive(now: string): Promise<GatewayRunAdmissionRecord[]> {
    const result = await this.client.query<RunAdmissionRow>(POSTGRES_RUN_ADMISSION_QUERIES.listActive, [now]);
    return result.rows.map(runAdmissionRowToRecord);
  }
}

export interface CreatePostgresGatewaySessionStoresOptions {
  client: PostgresClient;
}

export function createPostgresSessionStores(options: CreatePostgresGatewaySessionStoresOptions): {
  sessions: PostgresSessionStore;
  transcriptMessages: PostgresTranscriptMessageStore;
  sessionRunLinks: PostgresSessionRunLinkStore;
  runAdmissions: PostgresRunAdmissionStore;
} {
  return {
    sessions: new PostgresSessionStore(options.client),
    transcriptMessages: new PostgresTranscriptMessageStore(options.client),
    sessionRunLinks: new PostgresSessionRunLinkStore(options.client),
    runAdmissions: new PostgresRunAdmissionStore(options.client),
  };
}
