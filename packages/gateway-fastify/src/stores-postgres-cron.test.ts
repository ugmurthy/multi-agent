import { describe, expect, it, vi } from 'vitest';

import {
  PostgresCronJobStore,
  PostgresCronRunStore,
  POSTGRES_CRON_JOB_QUERIES,
  POSTGRES_CRON_RUN_QUERIES,
  createPostgresCronStores,
} from './stores-postgres-cron.js';
import type { PostgresClient } from './stores-postgres.js';

function createMockClient(): PostgresClient & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  };
}

function createMockClientWithRows(rows: Record<string, unknown>[]): PostgresClient {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })) as PostgresClient['query'],
  };
}

const sampleJobRow = {
  id: 'job-1',
  schedule: '*/5 * * * *',
  target_kind: 'session_event',
  target: { sessionId: 'session-1' },
  delivery_mode: 'session',
  delivery: { sessionId: 'session-1' },
  enabled: true,
  next_fire_at: '2026-04-08T10:00:00.000Z',
  lease_owner: null,
  lease_expires_at: null,
  metadata: null,
  created_at: '2026-04-08T09:00:00.000Z',
  updated_at: '2026-04-08T09:00:00.000Z',
};

const sampleRunRow = {
  id: 'cron-run-1',
  job_id: 'job-1',
  fire_time: '2026-04-08T10:00:00.000Z',
  status: 'running',
  session_id: null,
  run_id: 'run-1',
  root_run_id: 'root-1',
  lease_owner: 'worker-1',
  started_at: '2026-04-08T10:00:01.000Z',
  finished_at: null,
  error: null,
  output: null,
  metadata: null,
};

describe('PostgresCronJobStore', () => {
  it('creates a cron job and maps the result row', async () => {
    const client = createMockClientWithRows([sampleJobRow]);
    const store = new PostgresCronJobStore(client);

    const result = await store.create({
      id: 'job-1',
      schedule: '*/5 * * * *',
      targetKind: 'session_event',
      target: { sessionId: 'session-1' },
      deliveryMode: 'session',
      delivery: { sessionId: 'session-1' },
      enabled: true,
      nextFireAt: '2026-04-08T10:00:00.000Z',
      createdAt: '2026-04-08T09:00:00.000Z',
      updatedAt: '2026-04-08T09:00:00.000Z',
    });

    expect(result.id).toBe('job-1');
    expect(result.targetKind).toBe('session_event');
    expect(result.leaseOwner).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_CRON_JOB_QUERIES.create,
      expect.arrayContaining(['job-1']),
    );
  });

  it('returns undefined when GET finds no rows', async () => {
    const client = createMockClient();
    const store = new PostgresCronJobStore(client);

    expect(await store.get('nonexistent')).toBeUndefined();
  });

  it('maps a GET result row to a cron job record', async () => {
    const client = createMockClientWithRows([sampleJobRow]);
    const store = new PostgresCronJobStore(client);

    const result = await store.get('job-1');

    expect(result).toEqual({
      id: 'job-1',
      schedule: '*/5 * * * *',
      targetKind: 'session_event',
      target: { sessionId: 'session-1' },
      deliveryMode: 'session',
      delivery: { sessionId: 'session-1' },
      enabled: true,
      nextFireAt: '2026-04-08T10:00:00.000Z',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      metadata: undefined,
      createdAt: '2026-04-08T09:00:00.000Z',
      updatedAt: '2026-04-08T09:00:00.000Z',
    });
  });

  it('throws when UPDATE returns no rows', async () => {
    const client = createMockClient();
    const store = new PostgresCronJobStore(client);

    await expect(
      store.update({
        id: 'nonexistent',
        schedule: '0 * * * *',
        targetKind: 'isolated_run',
        target: {},
        deliveryMode: 'none',
        delivery: {},
        enabled: true,
        nextFireAt: '2026-04-08T10:00:00.000Z',
        createdAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      }),
    ).rejects.toThrow('does not exist');
  });

  it('issues a DELETE with the job id', async () => {
    const client = createMockClient();
    const store = new PostgresCronJobStore(client);

    await store.delete('job-1');

    expect(client.query).toHaveBeenCalledWith(POSTGRES_CRON_JOB_QUERIES.delete, ['job-1']);
  });

  it('lists due jobs', async () => {
    const client = createMockClientWithRows([sampleJobRow]);
    const store = new PostgresCronJobStore(client);

    const due = await store.listDue('2026-04-08T10:00:00.000Z');

    expect(due).toHaveLength(1);
    expect(client.query).toHaveBeenCalledWith(POSTGRES_CRON_JOB_QUERIES.listDue, ['2026-04-08T10:00:00.000Z']);
  });

  describe('lease claiming', () => {
    it('claims a lease on an unclaimed job', async () => {
      const client = createMockClientWithRows([{
        ...sampleJobRow,
        lease_owner: 'worker-1',
        lease_expires_at: '2026-04-08T10:05:00.000Z',
      }]);
      const store = new PostgresCronJobStore(client);

      const result = await store.claimLease({
        jobId: 'job-1',
        leaseOwner: 'worker-1',
        leaseExpiresAt: '2026-04-08T10:05:00.000Z',
        now: '2026-04-08T10:00:00.000Z',
      });

      expect(result).toBeDefined();
      expect(result!.leaseOwner).toBe('worker-1');
      expect(client.query).toHaveBeenCalledWith(
        POSTGRES_CRON_JOB_QUERIES.claimLease,
        ['job-1', 'worker-1', '2026-04-08T10:05:00.000Z', '2026-04-08T10:00:00.000Z'],
      );
    });

    it('returns undefined when the lease is already held', async () => {
      const client = createMockClient();
      const store = new PostgresCronJobStore(client);

      const result = await store.claimLease({
        jobId: 'job-1',
        leaseOwner: 'worker-2',
        leaseExpiresAt: '2026-04-08T10:05:00.000Z',
        now: '2026-04-08T10:00:00.000Z',
      });

      expect(result).toBeUndefined();
    });

    it('releases a lease held by the specified owner', async () => {
      const client = createMockClientWithRows([{
        ...sampleJobRow,
        lease_owner: null,
        lease_expires_at: null,
      }]);
      const store = new PostgresCronJobStore(client);

      const result = await store.releaseLease({
        jobId: 'job-1',
        leaseOwner: 'worker-1',
        now: '2026-04-08T10:03:00.000Z',
      });

      expect(result).toBeDefined();
      expect(result!.leaseOwner).toBeUndefined();
      expect(client.query).toHaveBeenCalledWith(
        POSTGRES_CRON_JOB_QUERIES.releaseLease,
        ['job-1', '2026-04-08T10:03:00.000Z', 'worker-1'],
      );
    });

    it('returns undefined when releasing a lease not held by the specified owner', async () => {
      const client = createMockClient();
      const store = new PostgresCronJobStore(client);

      const result = await store.releaseLease({
        jobId: 'job-1',
        leaseOwner: 'worker-wrong',
        now: '2026-04-08T10:03:00.000Z',
      });

      expect(result).toBeUndefined();
    });
  });
});

describe('PostgresCronRunStore', () => {
  it('creates a cron run and maps the result row', async () => {
    const client = createMockClientWithRows([sampleRunRow]);
    const store = new PostgresCronRunStore(client);

    const result = await store.create({
      id: 'cron-run-1',
      jobId: 'job-1',
      fireTime: '2026-04-08T10:00:00.000Z',
      status: 'running',
      runId: 'run-1',
      rootRunId: 'root-1',
      leaseOwner: 'worker-1',
      startedAt: '2026-04-08T10:00:01.000Z',
    });

    expect(result.id).toBe('cron-run-1');
    expect(result.status).toBe('running');
    expect(result.leaseOwner).toBe('worker-1');
  });

  it('returns undefined when GET finds no rows', async () => {
    const client = createMockClient();
    const store = new PostgresCronRunStore(client);

    expect(await store.get('nonexistent')).toBeUndefined();
  });

  it('throws when UPDATE returns no rows', async () => {
    const client = createMockClient();
    const store = new PostgresCronRunStore(client);

    await expect(
      store.update({
        id: 'nonexistent',
        jobId: 'job-1',
        fireTime: '2026-04-08T10:00:00.000Z',
        status: 'failed',
        startedAt: '2026-04-08T10:00:01.000Z',
      }),
    ).rejects.toThrow('does not exist');
  });

  it('lists cron runs by job', async () => {
    const client = createMockClientWithRows([sampleRunRow]);
    const store = new PostgresCronRunStore(client);

    const runs = await store.listByJob('job-1');

    expect(runs).toHaveLength(1);
    expect(client.query).toHaveBeenCalledWith(POSTGRES_CRON_RUN_QUERIES.listByJob, ['job-1']);
  });

  it('finds a cron run by fire time', async () => {
    const client = createMockClientWithRows([sampleRunRow]);
    const store = new PostgresCronRunStore(client);

    const result = await store.findByFireTime('job-1', '2026-04-08T10:00:00.000Z');

    expect(result).toBeDefined();
    expect(result!.id).toBe('cron-run-1');
    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_CRON_RUN_QUERIES.findByFireTime,
      ['job-1', '2026-04-08T10:00:00.000Z'],
    );
  });

  it('maps null optional fields to undefined', async () => {
    const client = createMockClientWithRows([sampleRunRow]);
    const store = new PostgresCronRunStore(client);

    const result = await store.get('cron-run-1');

    expect(result!.sessionId).toBeUndefined();
    expect(result!.finishedAt).toBeUndefined();
    expect(result!.error).toBeUndefined();
    expect(result!.output).toBeUndefined();
    expect(result!.metadata).toBeUndefined();
  });
});

describe('createPostgresCronStores', () => {
  it('creates both cron store instances from a single client', () => {
    const client = createMockClient();
    const stores = createPostgresCronStores({ client });

    expect(stores.cronJobs).toBeInstanceOf(PostgresCronJobStore);
    expect(stores.cronRuns).toBeInstanceOf(PostgresCronRunStore);
  });
});
