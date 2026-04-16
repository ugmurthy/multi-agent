/**
 * PostgreSQL-backed cron stores with lease-based claiming.
 *
 * Schema (gateway-owned tables):
 *
 *   gateway_cron_jobs (
 *     id               TEXT PRIMARY KEY,
 *     schedule         TEXT NOT NULL,
 *     target_kind      TEXT NOT NULL,
 *     target           JSONB NOT NULL,
 *     delivery_mode    TEXT NOT NULL DEFAULT 'none',
 *     delivery         JSONB NOT NULL DEFAULT '{}',
 *     enabled          BOOLEAN NOT NULL DEFAULT true,
 *     next_fire_at     TIMESTAMPTZ NOT NULL,
 *     lease_owner      TEXT,
 *     lease_expires_at TIMESTAMPTZ,
 *     metadata         JSONB,
 *     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *
 *   gateway_cron_runs (
 *     id            TEXT PRIMARY KEY,
 *     job_id        TEXT NOT NULL REFERENCES gateway_cron_jobs(id) ON DELETE CASCADE,
 *     fire_time     TIMESTAMPTZ NOT NULL,
 *     status        TEXT NOT NULL DEFAULT 'queued',
 *     session_id    TEXT,
 *     run_id        TEXT,
 *     root_run_id   TEXT,
 *     lease_owner   TEXT,
 *     started_at    TIMESTAMPTZ NOT NULL,
 *     finished_at   TIMESTAMPTZ,
 *     error         TEXT,
 *     output        JSONB,
 *     metadata      JSONB
 *   );
 */

import type { JsonObject, JsonValue } from './core.js';
import type {
  CronJobStore,
  CronRunStore,
  GatewayCronJobRecord,
  GatewayCronRunRecord,
  CronTargetKind,
  CronDeliveryMode,
  CronRunStatus,
} from './stores.js';
import type { PostgresClient } from './stores-postgres.js';

interface CronJobRow {
  id: string;
  schedule: string;
  target_kind: string;
  target: JsonObject;
  delivery_mode: string;
  delivery: JsonObject;
  enabled: boolean;
  next_fire_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  metadata: JsonObject | null;
  created_at: string;
  updated_at: string;
}

interface CronRunRow {
  id: string;
  job_id: string;
  fire_time: string;
  status: string;
  session_id: string | null;
  run_id: string | null;
  root_run_id: string | null;
  lease_owner: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  output: JsonValue | null;
  metadata: JsonObject | null;
}

export const POSTGRES_CRON_JOB_QUERIES = {
  create: `
    INSERT INTO gateway_cron_jobs (
      id, schedule, target_kind, target, delivery_mode, delivery,
      enabled, next_fire_at, lease_owner, lease_expires_at,
      metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `,
  get: `SELECT * FROM gateway_cron_jobs WHERE id = $1`,
  update: `
    UPDATE gateway_cron_jobs SET
      schedule = $2, target_kind = $3, target = $4, delivery_mode = $5,
      delivery = $6, enabled = $7, next_fire_at = $8, lease_owner = $9,
      lease_expires_at = $10, metadata = $11, updated_at = $12
    WHERE id = $1
    RETURNING *
  `,
  delete: `DELETE FROM gateway_cron_jobs WHERE id = $1`,
  listDue: `
    SELECT * FROM gateway_cron_jobs
    WHERE enabled = true AND next_fire_at <= $1
    ORDER BY next_fire_at ASC, id ASC
  `,
  claimLease: `
    UPDATE gateway_cron_jobs SET
      lease_owner = $2, lease_expires_at = $3, updated_at = $4
    WHERE id = $1
      AND enabled = true
      AND (lease_owner IS NULL OR lease_expires_at < $4)
    RETURNING *
  `,
  releaseLease: `
    UPDATE gateway_cron_jobs SET
      lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
    WHERE id = $1 AND lease_owner = $3
    RETURNING *
  `,
} as const;

export const POSTGRES_CRON_RUN_QUERIES = {
  create: `
    INSERT INTO gateway_cron_runs (
      id, job_id, fire_time, status, session_id, run_id, root_run_id,
      lease_owner, started_at, finished_at, error, output, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `,
  get: `SELECT * FROM gateway_cron_runs WHERE id = $1`,
  update: `
    UPDATE gateway_cron_runs SET
      status = $2, session_id = $3, run_id = $4, root_run_id = $5,
      lease_owner = $6, finished_at = $7, error = $8, output = $9, metadata = $10
    WHERE id = $1
    RETURNING *
  `,
  listByJob: `
    SELECT * FROM gateway_cron_runs WHERE job_id = $1
    ORDER BY fire_time ASC, id ASC
  `,
  findByFireTime: `
    SELECT * FROM gateway_cron_runs
    WHERE job_id = $1 AND fire_time = $2
    LIMIT 1
  `,
} as const;

function cronJobRowToRecord(row: CronJobRow): GatewayCronJobRecord {
  return {
    id: row.id,
    schedule: row.schedule,
    targetKind: row.target_kind as CronTargetKind,
    target: row.target,
    deliveryMode: row.delivery_mode as CronDeliveryMode,
    delivery: row.delivery,
    enabled: row.enabled,
    nextFireAt: row.next_fire_at,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cronJobCreateParams(job: GatewayCronJobRecord): unknown[] {
  return [
    job.id,
    job.schedule,
    job.targetKind,
    jsonbParam(job.target),
    job.deliveryMode,
    jsonbParam(job.delivery),
    job.enabled,
    job.nextFireAt,
    job.leaseOwner ?? null,
    job.leaseExpiresAt ?? null,
    jsonbParam(job.metadata),
    job.createdAt,
    job.updatedAt,
  ];
}

function cronJobUpdateParams(job: GatewayCronJobRecord): unknown[] {
  return [
    job.id,
    job.schedule,
    job.targetKind,
    jsonbParam(job.target),
    job.deliveryMode,
    jsonbParam(job.delivery),
    job.enabled,
    job.nextFireAt,
    job.leaseOwner ?? null,
    job.leaseExpiresAt ?? null,
    jsonbParam(job.metadata),
    job.updatedAt,
  ];
}

function cronRunRowToRecord(row: CronRunRow): GatewayCronRunRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    fireTime: row.fire_time,
    status: row.status as CronRunStatus,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    rootRunId: row.root_run_id ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    error: row.error ?? undefined,
    output: row.output ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

function cronRunCreateParams(run: GatewayCronRunRecord): unknown[] {
  return [
    run.id,
    run.jobId,
    run.fireTime,
    run.status,
    run.sessionId ?? null,
    run.runId ?? null,
    run.rootRunId ?? null,
    run.leaseOwner ?? null,
    run.startedAt,
    run.finishedAt ?? null,
    run.error ?? null,
    jsonbParam(run.output),
    jsonbParam(run.metadata),
  ];
}

function cronRunUpdateParams(run: GatewayCronRunRecord): unknown[] {
  return [
    run.id,
    run.status,
    run.sessionId ?? null,
    run.runId ?? null,
    run.rootRunId ?? null,
    run.leaseOwner ?? null,
    run.finishedAt ?? null,
    run.error ?? null,
    jsonbParam(run.output),
    jsonbParam(run.metadata),
  ];
}

function jsonbParam(value: JsonValue | undefined | null): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export interface ClaimLeaseOptions {
  jobId: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  now: string;
}

export interface ReleaseLeaseOptions {
  jobId: string;
  leaseOwner: string;
  now: string;
}

export class PostgresCronJobStore implements CronJobStore {
  constructor(private readonly client: PostgresClient) {}

  async create(job: GatewayCronJobRecord): Promise<GatewayCronJobRecord> {
    const result = await this.client.query<CronJobRow>(
      POSTGRES_CRON_JOB_QUERIES.create,
      cronJobCreateParams(job),
    );
    return cronJobRowToRecord(result.rows[0]!);
  }

  async get(jobId: string): Promise<GatewayCronJobRecord | undefined> {
    const result = await this.client.query<CronJobRow>(POSTGRES_CRON_JOB_QUERIES.get, [jobId]);
    return result.rows[0] ? cronJobRowToRecord(result.rows[0]) : undefined;
  }

  async update(job: GatewayCronJobRecord): Promise<GatewayCronJobRecord> {
    const result = await this.client.query<CronJobRow>(
      POSTGRES_CRON_JOB_QUERIES.update,
      cronJobUpdateParams(job),
    );
    if (result.rowCount === 0) {
      throw new Error(`Cron job "${job.id}" does not exist.`);
    }
    return cronJobRowToRecord(result.rows[0]!);
  }

  async delete(jobId: string): Promise<void> {
    await this.client.query(POSTGRES_CRON_JOB_QUERIES.delete, [jobId]);
  }

  async listDue(now: string): Promise<GatewayCronJobRecord[]> {
    const result = await this.client.query<CronJobRow>(POSTGRES_CRON_JOB_QUERIES.listDue, [now]);
    return result.rows.map(cronJobRowToRecord);
  }

  async claimLease(options: ClaimLeaseOptions): Promise<GatewayCronJobRecord | undefined> {
    const result = await this.client.query<CronJobRow>(
      POSTGRES_CRON_JOB_QUERIES.claimLease,
      [options.jobId, options.leaseOwner, options.leaseExpiresAt, options.now],
    );
    return result.rows[0] ? cronJobRowToRecord(result.rows[0]) : undefined;
  }

  async releaseLease(options: ReleaseLeaseOptions): Promise<GatewayCronJobRecord | undefined> {
    const result = await this.client.query<CronJobRow>(
      POSTGRES_CRON_JOB_QUERIES.releaseLease,
      [options.jobId, options.now, options.leaseOwner],
    );
    return result.rows[0] ? cronJobRowToRecord(result.rows[0]) : undefined;
  }
}

export class PostgresCronRunStore implements CronRunStore {
  constructor(private readonly client: PostgresClient) {}

  async create(run: GatewayCronRunRecord): Promise<GatewayCronRunRecord> {
    const result = await this.client.query<CronRunRow>(
      POSTGRES_CRON_RUN_QUERIES.create,
      cronRunCreateParams(run),
    );
    return cronRunRowToRecord(result.rows[0]!);
  }

  async get(runId: string): Promise<GatewayCronRunRecord | undefined> {
    const result = await this.client.query<CronRunRow>(POSTGRES_CRON_RUN_QUERIES.get, [runId]);
    return result.rows[0] ? cronRunRowToRecord(result.rows[0]) : undefined;
  }

  async update(run: GatewayCronRunRecord): Promise<GatewayCronRunRecord> {
    const result = await this.client.query<CronRunRow>(
      POSTGRES_CRON_RUN_QUERIES.update,
      cronRunUpdateParams(run),
    );
    if (result.rowCount === 0) {
      throw new Error(`Cron run "${run.id}" does not exist.`);
    }
    return cronRunRowToRecord(result.rows[0]!);
  }

  async listByJob(jobId: string): Promise<GatewayCronRunRecord[]> {
    const result = await this.client.query<CronRunRow>(POSTGRES_CRON_RUN_QUERIES.listByJob, [jobId]);
    return result.rows.map(cronRunRowToRecord);
  }

  async findByFireTime(jobId: string, fireTime: string): Promise<GatewayCronRunRecord | undefined> {
    const result = await this.client.query<CronRunRow>(
      POSTGRES_CRON_RUN_QUERIES.findByFireTime,
      [jobId, fireTime],
    );
    return result.rows[0] ? cronRunRowToRecord(result.rows[0]) : undefined;
  }
}

export interface CreatePostgresCronStoresOptions {
  client: PostgresClient;
}

export function createPostgresCronStores(options: CreatePostgresCronStoresOptions): {
  cronJobs: PostgresCronJobStore;
  cronRuns: PostgresCronRunStore;
} {
  return {
    cronJobs: new PostgresCronJobStore(options.client),
    cronRuns: new PostgresCronRunStore(options.client),
  };
}
