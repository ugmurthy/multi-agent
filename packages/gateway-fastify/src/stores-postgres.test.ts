import { describe, expect, it, vi } from 'vitest';

import {
  PostgresSessionStore,
  PostgresTranscriptMessageStore,
  PostgresSessionRunLinkStore,
  PostgresRunAdmissionStore,
  POSTGRES_SESSION_QUERIES,
  POSTGRES_TRANSCRIPT_QUERIES,
  POSTGRES_SESSION_RUN_LINK_QUERIES,
  POSTGRES_RUN_ADMISSION_QUERIES,
  createPostgresSessionStores,
  type PostgresClient,
  type PostgresQueryResult,
} from './stores-postgres.js';

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

describe('PostgresSessionStore', () => {
  it('issues a CREATE INSERT with all session fields', async () => {
    const client = createMockClientWithRows([{
      id: 'session-1',
      channel_id: 'webchat',
      agent_id: 'support-agent',
      invocation_mode: 'chat',
      auth_subject: 'user-123',
      tenant_id: 'acme',
      status: 'idle',
      current_run_id: null,
      current_root_run_id: null,
      last_completed_root_run_id: null,
      transcript_version: 0,
      transcript_summary: null,
      metadata: null,
      created_at: '2026-04-08T10:00:00.000Z',
      updated_at: '2026-04-08T10:00:00.000Z',
    }]);
    const store = new PostgresSessionStore(client);

    const result = await store.create({
      id: 'session-1',
      channelId: 'webchat',
      agentId: 'support-agent',
      invocationMode: 'chat',
      authSubject: 'user-123',
      tenantId: 'acme',
      status: 'idle',
      transcriptVersion: 0,
      createdAt: '2026-04-08T10:00:00.000Z',
      updatedAt: '2026-04-08T10:00:00.000Z',
    });

    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_SESSION_QUERIES.create,
      expect.arrayContaining(['session-1', 'webchat', 'support-agent']),
    );
    expect(result.id).toBe('session-1');
    expect(result.channelId).toBe('webchat');
    expect(result.agentId).toBe('support-agent');
  });

  it('maps a GET result row to a session record', async () => {
    const client = createMockClientWithRows([{
      id: 'session-1',
      channel_id: 'webchat',
      agent_id: null,
      invocation_mode: null,
      auth_subject: 'user-123',
      tenant_id: null,
      status: 'running',
      current_run_id: 'run-1',
      current_root_run_id: 'root-1',
      last_completed_root_run_id: null,
      transcript_version: 5,
      transcript_summary: 'Summary text',
      metadata: { locale: 'en-US' },
      created_at: '2026-04-08T10:00:00.000Z',
      updated_at: '2026-04-08T10:05:00.000Z',
    }]);
    const store = new PostgresSessionStore(client);

    const result = await store.get('session-1');

    expect(result).toEqual({
      id: 'session-1',
      channelId: 'webchat',
      agentId: undefined,
      invocationMode: undefined,
      authSubject: 'user-123',
      tenantId: undefined,
      status: 'running',
      currentRunId: 'run-1',
      currentRootRunId: 'root-1',
      lastCompletedRootRunId: undefined,
      transcriptVersion: 5,
      transcriptSummary: 'Summary text',
      metadata: { locale: 'en-US' },
      createdAt: '2026-04-08T10:00:00.000Z',
      updatedAt: '2026-04-08T10:05:00.000Z',
    });
  });

  it('returns undefined when GET finds no rows', async () => {
    const client = createMockClient();
    const store = new PostgresSessionStore(client);

    expect(await store.get('nonexistent')).toBeUndefined();
  });

  it('issues an UPDATE with the correct parameter mapping', async () => {
    const client = createMockClientWithRows([{
      id: 'session-1',
      channel_id: 'webchat',
      agent_id: 'support-agent',
      invocation_mode: 'run',
      auth_subject: 'user-123',
      tenant_id: 'acme',
      status: 'idle',
      current_run_id: null,
      current_root_run_id: null,
      last_completed_root_run_id: 'root-prev',
      transcript_version: 10,
      transcript_summary: null,
      metadata: null,
      created_at: '2026-04-08T10:00:00.000Z',
      updated_at: '2026-04-08T10:10:00.000Z',
    }]);
    const store = new PostgresSessionStore(client);

    const result = await store.update({
      id: 'session-1',
      channelId: 'webchat',
      agentId: 'support-agent',
      invocationMode: 'run',
      authSubject: 'user-123',
      tenantId: 'acme',
      status: 'idle',
      transcriptVersion: 10,
      lastCompletedRootRunId: 'root-prev',
      createdAt: '2026-04-08T10:00:00.000Z',
      updatedAt: '2026-04-08T10:10:00.000Z',
    });

    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_SESSION_QUERIES.update,
      expect.arrayContaining(['session-1']),
    );
    expect(result.lastCompletedRootRunId).toBe('root-prev');
  });

  it('throws when UPDATE returns no rows', async () => {
    const client = createMockClient();
    const store = new PostgresSessionStore(client);

    await expect(
      store.update({
        id: 'nonexistent',
        channelId: 'webchat',
        authSubject: 'user-123',
        status: 'idle',
        transcriptVersion: 0,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      }),
    ).rejects.toThrow('does not exist');
  });

  it('conditionally starts a session only from allowed statuses', async () => {
    const rows = [
      {
        id: 'session-1',
        channel_id: 'webchat',
        agent_id: null,
        invocation_mode: null,
        auth_subject: 'user-123',
        tenant_id: null,
        status: 'idle',
        current_run_id: null,
        current_root_run_id: null,
        last_completed_root_run_id: null,
        transcript_version: 0,
        transcript_summary: null,
        metadata: null,
        created_at: '2026-04-08T10:00:00.000Z',
        updated_at: '2026-04-08T10:00:00.000Z',
      },
      {
        id: 'session-1',
        channel_id: 'webchat',
        agent_id: 'support-agent',
        invocation_mode: 'run',
        auth_subject: 'user-123',
        tenant_id: null,
        status: 'running',
        current_run_id: 'run-1',
        current_root_run_id: 'run-1',
        last_completed_root_run_id: null,
        transcript_version: 0,
        transcript_summary: null,
        metadata: null,
        created_at: '2026-04-08T10:00:00.000Z',
        updated_at: '2026-04-08T10:00:01.000Z',
      },
    ];
    const client: PostgresClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === POSTGRES_SESSION_QUERIES.get) {
          return { rows: [rows[0]], rowCount: 1 } as PostgresQueryResult<Record<string, unknown>>;
        }
        return { rows: [rows[1]], rowCount: 1 } as PostgresQueryResult<Record<string, unknown>>;
      }) as PostgresClient['query'],
    };
    const store = new PostgresSessionStore(client);

    const result = await store.tryStartRun(
      'session-1',
      {
        agentId: 'support-agent',
        invocationMode: 'run',
        status: 'running',
        currentRunId: 'run-1',
        currentRootRunId: 'run-1',
        updatedAt: '2026-04-08T10:00:01.000Z',
      },
      ['idle'],
    );

    expect(result).toMatchObject({ acquired: true, session: { status: 'running', currentRunId: 'run-1' } });
    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_SESSION_QUERIES.tryStartRun,
      expect.arrayContaining(['session-1', 'webchat', 'support-agent', 'run']),
    );
  });

  it('issues a DELETE with the session id', async () => {
    const client = createMockClient();
    const store = new PostgresSessionStore(client);

    await store.delete('session-1');

    expect(client.query).toHaveBeenCalledWith(POSTGRES_SESSION_QUERIES.delete, ['session-1']);
  });

  it('lists sessions by auth subject', async () => {
    const client = createMockClientWithRows([
      {
        id: 'session-1',
        channel_id: 'webchat',
        agent_id: null,
        invocation_mode: null,
        auth_subject: 'user-123',
        tenant_id: null,
        status: 'idle',
        current_run_id: null,
        current_root_run_id: null,
        last_completed_root_run_id: null,
        transcript_version: 0,
        transcript_summary: null,
        metadata: null,
        created_at: '2026-04-08T10:00:00.000Z',
        updated_at: '2026-04-08T10:00:00.000Z',
      },
    ]);
    const store = new PostgresSessionStore(client);

    const sessions = await store.listByAuthSubject('user-123');

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.authSubject).toBe('user-123');
    expect(client.query).toHaveBeenCalledWith(POSTGRES_SESSION_QUERIES.listByAuthSubject, ['user-123']);
  });
});

describe('PostgresTranscriptMessageStore', () => {
  it('issues an INSERT and maps the result row', async () => {
    const client = createMockClientWithRows([{
      id: 'msg-1',
      session_id: 'session-1',
      sequence: 1,
      role: 'user',
      content: 'Hello',
      metadata: null,
      created_at: '2026-04-08T10:00:00.000Z',
    }]);
    const store = new PostgresTranscriptMessageStore(client);

    const result = await store.append({
      id: 'msg-1',
      sessionId: 'session-1',
      sequence: 1,
      role: 'user',
      content: 'Hello',
      createdAt: '2026-04-08T10:00:00.000Z',
    });

    expect(result.sessionId).toBe('session-1');
    expect(result.role).toBe('user');
    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_TRANSCRIPT_QUERIES.append,
      expect.arrayContaining(['msg-1', 'session-1', 1, 'user', 'Hello']),
    );
  });

  it('lists messages by session with sequence ordering', async () => {
    const client = createMockClientWithRows([
      {
        id: 'msg-1',
        session_id: 'session-1',
        sequence: 1,
        role: 'user',
        content: 'Hello',
        metadata: null,
        created_at: '2026-04-08T10:00:00.000Z',
      },
      {
        id: 'msg-2',
        session_id: 'session-1',
        sequence: 2,
        role: 'assistant',
        content: 'Hi',
        metadata: null,
        created_at: '2026-04-08T10:00:01.000Z',
      },
    ]);
    const store = new PostgresTranscriptMessageStore(client);

    const messages = await store.listBySession('session-1');

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[1]!.role).toBe('assistant');
  });

  it('issues a DELETE for a session', async () => {
    const client = createMockClient();
    const store = new PostgresTranscriptMessageStore(client);

    await store.deleteBySession('session-1');

    expect(client.query).toHaveBeenCalledWith(POSTGRES_TRANSCRIPT_QUERIES.deleteBySession, ['session-1']);
  });
});

describe('PostgresSessionRunLinkStore', () => {
  it('issues an INSERT and maps the result row', async () => {
    const client = createMockClientWithRows([{
      run_id: 'run-1',
      session_id: 'session-1',
      root_run_id: 'root-1',
      invocation_kind: 'chat',
      turn_index: 1,
      metadata: null,
      created_at: '2026-04-08T10:00:00.000Z',
    }]);
    const store = new PostgresSessionRunLinkStore(client);

    const result = await store.append({
      sessionId: 'session-1',
      runId: 'run-1',
      rootRunId: 'root-1',
      invocationKind: 'chat',
      turnIndex: 1,
      createdAt: '2026-04-08T10:00:00.000Z',
    });

    expect(result.runId).toBe('run-1');
    expect(result.invocationKind).toBe('chat');
    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_SESSION_RUN_LINK_QUERIES.append,
      expect.arrayContaining(['run-1', 'session-1', 'root-1', 'chat']),
    );
  });

  it('returns undefined when getByRunId finds no rows', async () => {
    const client = createMockClient();
    const store = new PostgresSessionRunLinkStore(client);

    expect(await store.getByRunId('nonexistent')).toBeUndefined();
  });

  it('maps null turnIndex and metadata to undefined', async () => {
    const client = createMockClientWithRows([{
      run_id: 'run-1',
      session_id: 'session-1',
      root_run_id: 'root-1',
      invocation_kind: 'run',
      turn_index: null,
      metadata: null,
      created_at: '2026-04-08T10:00:00.000Z',
    }]);
    const store = new PostgresSessionRunLinkStore(client);

    const result = await store.getByRunId('run-1');

    expect(result?.turnIndex).toBeUndefined();
    expect(result?.metadata).toBeUndefined();
  });

  it('lists links by root run id', async () => {
    const client = createMockClientWithRows([{
      run_id: 'run-1',
      session_id: 'session-1',
      root_run_id: 'root-1',
      invocation_kind: 'run',
      turn_index: null,
      metadata: null,
      created_at: '2026-04-08T10:00:00.000Z',
    }]);
    const store = new PostgresSessionRunLinkStore(client);

    const result = await store.listByRootRunId('root-1');

    expect(result.map((link) => link.runId)).toEqual(['run-1']);
    expect(client.query).toHaveBeenCalledWith(POSTGRES_SESSION_RUN_LINK_QUERIES.listByRootRunId, ['root-1']);
  });

  it('issues a DELETE for a session', async () => {
    const client = createMockClient();
    const store = new PostgresSessionRunLinkStore(client);

    await store.deleteBySession('session-1');

    expect(client.query).toHaveBeenCalledWith(POSTGRES_SESSION_RUN_LINK_QUERIES.deleteBySession, ['session-1']);
  });
});

describe('PostgresRunAdmissionStore', () => {
  it('inserts an active admission when limits allow it', async () => {
    const client = createMockClientWithRows([{
      id: 'admission-1',
      agent_id: 'support-agent',
      tenant_id: 'acme',
      session_id: 'session-1',
      root_run_id: null,
      status: 'running',
      lease_owner: 'gateway',
      lease_expires_at: '2026-04-08T10:10:00.000Z',
      metadata: null,
      created_at: '2026-04-08T10:00:00.000Z',
      updated_at: '2026-04-08T10:00:00.000Z',
    }]);
    const store = new PostgresRunAdmissionStore(client);

    const result = await store.tryAcquire(
      {
        id: 'admission-1',
        agentId: 'support-agent',
        tenantId: 'acme',
        sessionId: 'session-1',
        status: 'running',
        leaseOwner: 'gateway',
        leaseExpiresAt: '2026-04-08T10:10:00.000Z',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      },
      { maxActiveRuns: 16, maxActiveRunsPerTenant: 8, maxActiveRunsPerAgent: 8 },
      '2026-04-08T10:00:00.000Z',
    );

    expect(result).toMatchObject({ acquired: true, admission: { id: 'admission-1', agentId: 'support-agent' } });
    expect(client.query).toHaveBeenCalledWith(
      POSTGRES_RUN_ADMISSION_QUERIES.createIfUnderLimits,
      expect.arrayContaining(['admission-1', 'support-agent', 'acme', 'session-1']),
    );
  });

  it('returns the exhausted limit when admission insert is skipped', async () => {
    const client = createMockClient();
    client.query = vi.fn(async (sql: string) => {
      if (sql === POSTGRES_RUN_ADMISSION_QUERIES.activeCounts) {
        return {
          rows: [{ total_count: 16, tenant_count: 1, agent_count: 1 }],
          rowCount: 1,
        } as PostgresQueryResult<Record<string, unknown>>;
      }
      return { rows: [], rowCount: 0 } as PostgresQueryResult<Record<string, unknown>>;
    }) as PostgresClient['query'];
    const store = new PostgresRunAdmissionStore(client);

    const result = await store.tryAcquire(
      {
        id: 'admission-1',
        agentId: 'support-agent',
        status: 'running',
        leaseOwner: 'gateway',
        leaseExpiresAt: '2026-04-08T10:10:00.000Z',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      },
      { maxActiveRuns: 16, maxActiveRunsPerTenant: 8, maxActiveRunsPerAgent: 8 },
      '2026-04-08T10:00:00.000Z',
    );

    expect(result).toEqual({ acquired: false, limit: 'maxActiveRuns', activeCount: 16 });
  });
});

describe('createPostgresSessionStores', () => {
  it('creates all gateway session store instances from a single client', () => {
    const client = createMockClient();
    const stores = createPostgresSessionStores({ client });

    expect(stores.sessions).toBeInstanceOf(PostgresSessionStore);
    expect(stores.transcriptMessages).toBeInstanceOf(PostgresTranscriptMessageStore);
    expect(stores.sessionRunLinks).toBeInstanceOf(PostgresSessionRunLinkStore);
    expect(stores.runAdmissions).toBeInstanceOf(PostgresRunAdmissionStore);
  });
});
