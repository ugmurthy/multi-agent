import { POSTGRES_RUNTIME_MIGRATIONS, type PostgresMigrationDefinition, type PostgresPoolClient } from '@adaptive-agent/core';

import type { GatewayStoreConfig } from './config.js';
import { runWithPostgresTransaction } from './postgres.js';
import type { PostgresClient } from './stores-postgres.js';

export const POSTGRES_GATEWAY_MIGRATIONS: PostgresMigrationDefinition[] = [
  {
    name: 'gateway-fastify:001_gateway_postgres',
    sql: `
create table if not exists gateway_sessions (
  id text primary key,
  channel_id text not null,
  agent_id text,
  invocation_mode text,
  auth_subject text not null,
  tenant_id text,
  status text not null default 'idle',
  current_run_id text,
  current_root_run_id text,
  last_completed_root_run_id text,
  transcript_version integer not null default 0,
  transcript_summary text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gateway_sessions_auth_subject_idx
  on gateway_sessions (auth_subject, created_at asc, id asc);

create table if not exists gateway_transcript_messages (
  id text primary key,
  session_id text not null references gateway_sessions(id) on delete cascade,
  sequence integer not null,
  role text not null,
  content text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gateway_transcript_messages_session_idx
  on gateway_transcript_messages (session_id, sequence asc, created_at asc, id asc);

create table if not exists gateway_session_run_links (
  run_id text primary key,
  session_id text not null references gateway_sessions(id) on delete cascade,
  root_run_id text not null,
  invocation_kind text not null,
  turn_index integer,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gateway_session_run_links_session_idx
  on gateway_session_run_links (session_id, created_at asc, run_id asc);

create table if not exists gateway_cron_jobs (
  id text primary key,
  schedule text not null,
  target_kind text not null,
  target jsonb not null,
  delivery_mode text not null default 'none',
  delivery jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  next_fire_at timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gateway_cron_jobs_due_idx
  on gateway_cron_jobs (enabled, next_fire_at asc, id asc);

create table if not exists gateway_cron_runs (
  id text primary key,
  job_id text not null references gateway_cron_jobs(id) on delete cascade,
  fire_time timestamptz not null,
  status text not null default 'queued',
  session_id text,
  run_id text,
  root_run_id text,
  lease_owner text,
  started_at timestamptz not null,
  finished_at timestamptz,
  error text,
  output jsonb,
  metadata jsonb
);

create index if not exists gateway_cron_runs_job_idx
  on gateway_cron_runs (job_id, fire_time asc, id asc);
`,
  },
];

const CREATE_MIGRATION_TABLE_SQL = `
create table if not exists adaptive_agent_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)
`;

export async function runGatewayPostgresMigrations(
  client: PostgresClient | PostgresPoolClient,
  options: { storesConfig?: GatewayStoreConfig } = {},
): Promise<void> {
  if (options.storesConfig?.kind === 'postgres' && options.storesConfig.autoMigrate === false) {
    return;
  }

  await runWithPostgresTransaction(client, async (transactionClient) => {
    await transactionClient.query(CREATE_MIGRATION_TABLE_SQL);
    for (const migration of [...POSTGRES_GATEWAY_MIGRATIONS, ...POSTGRES_RUNTIME_MIGRATIONS]) {
      const existing = await transactionClient.query<{ name: string }>(
        'SELECT name FROM adaptive_agent_migrations WHERE name = $1',
        [migration.name],
      );
      if (existing.rowCount > 0) {
        continue;
      }

      await transactionClient.query(migration.sql);
      await transactionClient.query('INSERT INTO adaptive_agent_migrations (name) VALUES ($1)', [migration.name]);
    }
  });
}

export function canAutoMigrateStores(config: GatewayStoreConfig | undefined): boolean {
  return config?.kind !== 'postgres' || config.autoMigrate !== false;
}
