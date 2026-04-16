import { Pool, types } from 'pg';

import type { PostgresPoolClient, PostgresTransactionClient } from '@adaptive-agent/core';
import type { GatewayStoreConfig } from './config.js';
import type { PostgresClient } from './stores-postgres.js';

const TIMESTAMP_OIDS = [1082, 1114, 1184] as const;

let pgTypeParsersConfigured = false;

export type GatewayPostgresPool = PostgresPoolClient & {
  end(): Promise<void>;
};

export interface CreateGatewayPostgresPoolOptions {
  password?: string;
}

export function resolveGatewayPostgresConnectionString(
  config: Extract<GatewayStoreConfig, { kind: 'postgres' }>,
): string {
  if (config.connectionString) {
    return config.connectionString;
  }

  const envName = config.urlEnv ?? 'DATABASE_URL';
  const connectionString = process.env[envName];
  if (!connectionString) {
    throw new Error(
      `Gateway Postgres stores require a connection string. Set stores.connectionString or the ${envName} environment variable.`,
    );
  }

  return connectionString;
}

export function createGatewayPostgresPool(
  config: Extract<GatewayStoreConfig, { kind: 'postgres' }>,
  options: CreateGatewayPostgresPoolOptions = {},
): GatewayPostgresPool {
  configurePgTypeParsers();

  const connectionString = resolveGatewayPostgresConnectionString(config);
  const pool = new Pool({
    connectionString: options.password ? connectionStringWithPassword(connectionString, options.password) : connectionString,
    password: options.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });

  return pool as unknown as GatewayPostgresPool;
}

function connectionStringWithPassword(connectionString: string, password: string): string {
  try {
    const url = new URL(connectionString);
    url.password = password;
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function isPostgresPoolClient(client: PostgresClient | PostgresPoolClient): client is PostgresPoolClient {
  return typeof (client as PostgresPoolClient).connect === 'function';
}

export function isPostgresTransactionClient(client: PostgresClient): client is PostgresTransactionClient {
  return typeof (client as PostgresTransactionClient).release === 'function';
}

export async function runWithPostgresTransaction<T>(
  client: PostgresClient | PostgresPoolClient,
  operation: (client: PostgresClient) => Promise<T>,
): Promise<T> {
  const transactionClient = isPostgresPoolClient(client) ? await client.connect() : client;
  const shouldRelease = isPostgresTransactionClient(transactionClient);

  try {
    await transactionClient.query('BEGIN');
    const result = await operation(transactionClient);
    await transactionClient.query('COMMIT');
    return result;
  } catch (error) {
    await transactionClient.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      transactionClient.release();
    }
  }
}

function configurePgTypeParsers(): void {
  if (pgTypeParsersConfigured) {
    return;
  }

  for (const oid of TIMESTAMP_OIDS) {
    types.setTypeParser(oid, (value) => value);
  }

  pgTypeParsersConfigured = true;
}
