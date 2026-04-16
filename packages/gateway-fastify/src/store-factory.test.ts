import { describe, expect, it } from 'vitest';

import { PostgresRuntimeStoreBundle } from '@adaptive-agent/core';

import { resolveGatewayStoreBundle } from './store-factory.js';
import { PostgresCronJobStore, PostgresCronRunStore } from './stores-postgres-cron.js';
import { PostgresSessionRunLinkStore, PostgresSessionStore, PostgresTranscriptMessageStore, type PostgresClient } from './stores-postgres.js';
import { InMemoryCronJobStore, InMemoryCronRunStore, InMemorySessionRunLinkStore, InMemorySessionStore, InMemoryTranscriptMessageStore } from './stores.js';

function createMockPostgresClient(): PostgresClient & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('resolveGatewayStoreBundle', () => {
  it('returns in-memory gateway stores by default', async () => {
    const bundle = await resolveGatewayStoreBundle();

    expect(bundle.gatewayStores.sessions).toBeInstanceOf(InMemorySessionStore);
    expect(bundle.gatewayStores.transcriptMessages).toBeInstanceOf(InMemoryTranscriptMessageStore);
    expect(bundle.gatewayStores.sessionRunLinks).toBeInstanceOf(InMemorySessionRunLinkStore);
    expect(bundle.gatewayStores.cronJobs).toBeInstanceOf(InMemoryCronJobStore);
    expect(bundle.gatewayStores.cronRuns).toBeInstanceOf(InMemoryCronRunStore);
    expect(bundle.runtimeStores).toBeUndefined();
    expect(bundle.close).toBeUndefined();
  });

  it('creates gateway Postgres stores and core runtime stores from the same client', async () => {
    const client = createMockPostgresClient();

    const bundle = await resolveGatewayStoreBundle({
      storesConfig: {
        kind: 'postgres',
        connectionString: 'postgres://ignored/test',
      },
      postgresClient: client,
    });

    expect(bundle.gatewayStores.sessions).toBeInstanceOf(PostgresSessionStore);
    expect(bundle.gatewayStores.transcriptMessages).toBeInstanceOf(PostgresTranscriptMessageStore);
    expect(bundle.gatewayStores.sessionRunLinks).toBeInstanceOf(PostgresSessionRunLinkStore);
    expect(bundle.gatewayStores.cronJobs).toBeInstanceOf(PostgresCronJobStore);
    expect(bundle.gatewayStores.cronRuns).toBeInstanceOf(PostgresCronRunStore);
    expect(bundle.runtimeStores).toBeInstanceOf(PostgresRuntimeStoreBundle);
    expect(bundle.close).toBeUndefined();
    expect(client.calls.some(({ sql }) => sql.includes('adaptive_agent_migrations'))).toBe(true);
  });

  it('fails clearly when a configured Postgres connection string is missing', async () => {
    const envName = 'ADAPTIVE_AGENT_TEST_MISSING_DATABASE_URL';
    const previousValue = process.env[envName];
    delete process.env[envName];

    try {
      await expect(
        resolveGatewayStoreBundle({
          storesConfig: {
            kind: 'postgres',
            urlEnv: envName,
          },
        }),
      ).rejects.toThrow(envName);
    } finally {
      if (previousValue === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = previousValue;
      }
    }
  });
});
