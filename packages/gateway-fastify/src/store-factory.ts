import {
  createPostgresRuntimeStores,
  type PostgresPoolClient,
  type PostgresRuntimeStoreBundle,
} from '@adaptive-agent/core';

import type { GatewayStoreConfig } from './config.js';
import { createFileGatewayStores } from './stores-file.js';
import { createPostgresCronStores } from './stores-postgres-cron.js';
import { runGatewayPostgresMigrations } from './postgres-migrations.js';
import { createGatewayPostgresPool } from './postgres.js';
import { createPostgresSessionStores, type PostgresClient } from './stores-postgres.js';
import { createInMemoryGatewayStores, type GatewayStores } from './stores.js';

export interface ResolvedStoreBundle {
  gatewayStores: GatewayStores;
  runtimeStores?: PostgresRuntimeStoreBundle;
  postgresClient?: PostgresClient | PostgresPoolClient;
  close?: () => Promise<void>;
}

export interface ResolveGatewayStoreBundleOptions {
  storesConfig?: GatewayStoreConfig;
  gatewayStoresOverride?: GatewayStores;
  postgresClient?: PostgresClient | PostgresPoolClient;
}

export async function resolveGatewayStoreBundle(
  options: ResolveGatewayStoreBundleOptions = {},
): Promise<ResolvedStoreBundle> {
  const storesConfig = options.storesConfig;

  if (storesConfig?.kind === 'postgres') {
    const ownedPool = options.postgresClient ? undefined : createGatewayPostgresPool(storesConfig);
    const client = (options.postgresClient ?? ownedPool)!;
    await runGatewayPostgresMigrations(client, { storesConfig });

    const gatewayStores =
      options.gatewayStoresOverride ??
      {
        ...createPostgresSessionStores({ client }),
        ...createPostgresCronStores({ client }),
      };

    return {
      gatewayStores,
      runtimeStores: createPostgresRuntimeStores({ client }),
      postgresClient: client,
      close: ownedPool ? async () => ownedPool.end() : undefined,
    };
  }

  if (options.gatewayStoresOverride) {
    return {
      gatewayStores: options.gatewayStoresOverride,
    };
  }

  if (storesConfig?.kind === 'file') {
    return {
      gatewayStores: createFileGatewayStores({ baseDir: storesConfig.baseDir }),
    };
  }

  return {
    gatewayStores: createInMemoryGatewayStores(),
  };
}
