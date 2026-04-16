# Postgres-First Restart Survival Plan

## Objective

Move the gateway from pure in-memory stores to Postgres-backed gateway and runtime stores so `run` state survives a server restart.

Target guarantee:

- A client can reconnect with an existing `sessionId` after the gateway process restarts.
- If the linked `run` completed successfully before restart, reconnect emits the stored `run.output`.
- If the linked `run` failed, the session remains retryable according to existing `run.retry` behavior.
- If the linked `run` was active but its lease expired while the server was down, reconnect can call `resume(currentRunId)` and settle from the returned `RunResult`.
- If the linked `run` is awaiting approval or clarification, reconnect re-presents the pending state.
- If the gateway session exists but the runtime `run` is missing, reconnect fails explicitly instead of silently clearing the session.

This requires durable stores at two layers:

- Gateway state: sessions, transcripts, session-run links, cron jobs, cron runs.
- Core runtime state: runs, events, snapshots, plans, plan executions, and tool execution ledger records.

Do not mark the feature complete if only gateway stores are durable. A durable gateway session with an in-memory runtime still loses `run.result`, snapshots, leases, and retry/resume state after restart.

## Current Code Anchors

- Gateway bootstrap: `packages/gateway-fastify/src/bootstrap.ts`
- Gateway store interfaces and in-memory stores: `packages/gateway-fastify/src/stores.ts`
- Gateway Postgres session stores: `packages/gateway-fastify/src/stores-postgres.ts`
- Gateway Postgres cron stores: `packages/gateway-fastify/src/stores-postgres-cron.ts`
- Gateway reconnect policy: `packages/gateway-fastify/src/reconnect.ts`
- Gateway run/session logic: `packages/gateway-fastify/src/run.ts`
- Gateway chat/session logic: `packages/gateway-fastify/src/chat.ts`
- Gateway config schema: `packages/gateway-fastify/src/config.ts`
- Core runtime factory: `packages/core/src/create-adaptive-agent.ts`
- Core Postgres runtime stores: `packages/core/src/postgres-runtime-stores.ts`
- Runtime schema reference: `agen-contracts-v1.4.md`

## Preparation

1. Decide Postgres client ownership.

   The existing Postgres store classes accept a `PostgresClient` shape with `query(sql, params)`. `PostgresRuntimeStoreBundle` also supports a pool-like client with `connect()`. The package manifests do not currently include a Postgres driver dependency.

   Recommended implementation:

   - Add `pg` and `@types/pg` to `packages/gateway-fastify`.
   - Create a small gateway-local Postgres client factory that returns a pool compatible with the existing `PostgresClient`/`PostgresPoolClient` shape.
   - Keep the existing injected-client path for tests and embedding.

2. Define configuration shape.

   Add gateway config support for:

   ```json
   {
     "stores": {
       "kind": "postgres",
       "urlEnv": "DATABASE_URL",
       "ssl": false
     }
   }
   ```

   Suggested TypeScript shape:

   ```ts
   export type GatewayStoreConfig =
     | { kind: 'memory' }
     | { kind: 'file'; baseDir: string }
     | { kind: 'postgres'; urlEnv?: string; connectionString?: string; ssl?: boolean };
   ```

   Keep `memory` as the default to avoid breaking current local tests. Warn or document that `memory` is not restart-safe.

3. Add migrations before wiring.

   Create a migrations directory, for example:

   - `packages/gateway-fastify/migrations/001_gateway_postgres.sql`
   - `packages/core/migrations/001_runtime_postgres.sql`

   If the repo prefers one app-level migration folder later, it can combine these, but separate files are easier for package ownership.

4. Decide migration execution model.

   Minimal first implementation:

   - Add SQL files only.
   - Add a `runPostgresMigrations(client)` helper or a small CLI command later.

   Better first implementation:

   - Add `packages/gateway-fastify/src/postgres-migrations.ts`.
   - It applies known migrations inside a transaction and records them in an `adaptive_agent_migrations` table.
   - `bootstrapGateway` can apply migrations only when `stores.kind === 'postgres'` and `autoMigrate !== false`.

   Avoid silently creating tables in individual store methods.

## Schema Work

1. Gateway schema.

   Base this on the comments and queries in `stores-postgres.ts` and `stores-postgres-cron.ts`.

   Required tables:

   - `gateway_sessions`
   - `gateway_transcript_messages`
   - `gateway_session_run_links`
   - `gateway_cron_jobs`
   - `gateway_cron_runs`

   Add useful indexes:

   ```sql
   create index gateway_sessions_auth_subject_idx
     on gateway_sessions (auth_subject, created_at asc, id asc);

   create index gateway_session_run_links_session_idx
     on gateway_session_run_links (session_id, created_at asc, run_id asc);

   create index gateway_transcript_messages_session_idx
     on gateway_transcript_messages (session_id, sequence asc, created_at asc, id asc);

   create index gateway_cron_jobs_due_idx
     on gateway_cron_jobs (enabled, next_fire_at asc, id asc);

   create index gateway_cron_runs_job_idx
     on gateway_cron_runs (job_id, fire_time asc, id asc);
   ```

2. Runtime schema.

   Base this on `agen-contracts-v1.4.md` and the query expectations in `postgres-runtime-stores.ts`.

   Required tables:

   - `agent_runs`
   - `agent_events`
   - `run_snapshots`
   - `plans`
   - `plan_steps`
   - `plan_executions`
   - `tool_executions`

   Preserve these semantics:

   - `agent_runs.root_run_id` links every child to the root.
   - `agent_runs.parent_run_id`, `parent_step_id`, `delegate_name`, `delegation_depth`, and `current_child_run_id` support v1.4 delegation.
   - `agent_runs.version` supports optimistic concurrency.
   - `agent_runs.lease_owner`, `lease_expires_at`, and `heartbeat_at` support restart recovery.
   - `agent_runs.result` and `error_message` support reconnect output replay and failed-run display.
   - `run_snapshots.schema_version` supports compatibility checks during `resume(runId)`.
   - `tool_executions.idempotency_key` is unique and stores completed tool outputs to avoid re-executing side-effecting tools after a crash.

3. Type alignment check.

   Before running migrations against a real DB, compare every column used by these query constants:

   - `POSTGRES_SESSION_QUERIES`
   - `POSTGRES_TRANSCRIPT_QUERIES`
   - `POSTGRES_SESSION_RUN_LINK_QUERIES`
   - `POSTGRES_CRON_JOB_QUERIES`
   - `POSTGRES_CRON_RUN_QUERIES`
   - `POSTGRES_RUNTIME_RUN_QUERIES`
   - `POSTGRES_RUNTIME_EVENT_QUERIES`
   - `POSTGRES_RUNTIME_SNAPSHOT_QUERIES`
   - `POSTGRES_RUNTIME_PLAN_QUERIES`
   - `POSTGRES_RUNTIME_TOOL_EXECUTION_QUERIES`
   - `POSTGRES_RUNTIME_RECOVERY_QUERIES`

   The fastest way to avoid drift is to make migration column names match the query constants exactly.

## Wiring Path

1. Add a Postgres connection module.

   Suggested file:

   - `packages/gateway-fastify/src/postgres.ts`

   Responsibilities:

   - Read `connectionString` from config, or `process.env[urlEnv ?? 'DATABASE_URL']`.
   - Create a `pg.Pool`.
   - Return a client compatible with `PostgresClient` and `PostgresPoolClient`.
   - Register shutdown on gateway close so the pool ends cleanly.

2. Add store construction.

   Suggested file:

   - `packages/gateway-fastify/src/store-factory.ts`

   Suggested API:

   ```ts
   export interface ResolvedStoreBundle {
     gatewayStores: GatewayStores;
     runtimeStores?: PostgresRuntimeStoreBundle;
     close?: () => Promise<void>;
   }
   ```

   Behavior:

   - `memory`: return `createInMemoryGatewayStores()` and let agents use default in-memory runtime stores.
   - `file`: return `createFileGatewayStores({ baseDir })` and still warn/document that core runtime is in-memory unless file runtime stores are implemented later.
   - `postgres`: return a merged `GatewayStores`:

     ```ts
     const sessionStores = createPostgresSessionStores({ client });
     const cronStores = createPostgresCronStores({ client });
     const gatewayStores = { ...sessionStores, ...cronStores };
     const runtimeStores = createPostgresRuntimeStores({ client });
     ```

3. Thread runtime stores into agent creation.

   `bootstrapGateway` currently creates the `agentRegistry` before stores are selected for Postgres runtime injection. Refactor ordering so store/runtime construction happens before `createAgentRegistry(...)`.

   Then inject runtime stores into every agent created by the default factory.

   Preferred approach:

   - Extend `createAgentRegistry` or its default `agentFactory` options to accept `runtime`.
   - When `stores.kind === 'postgres'`, pass:

     ```ts
     runtime: runtimeStores
     ```

     into `createAdaptiveAgent(...)`.

   Important: all agents should share the same Postgres runtime store bundle/pool so a session linked to `agentId` can load the same `run` after restart.

4. Preserve custom `agentFactory`.

   If `BootstrapGatewayOptions.agentFactory` is provided by the caller, do not silently override it.

   Recommended behavior:

   - If config asks for `postgres` and a custom `agentFactory` is supplied, expose the `runtimeStores` to that factory or document that the custom factory must use durable runtime stores.
   - Add a test to ensure the default bootstrap path injects Postgres runtime stores.
   - Add a warning or thrown error if the implementation cannot guarantee durable runtime stores with a custom factory.

5. Close resources.

   Extend the `app.addHook('onClose', ...)` path in `bootstrapGateway` to:

   - stop scheduler
   - flush runtime logger
   - close request logger
   - close Postgres pool

## Reconnect and Recovery Behavior

1. Completed run replay.

   The reconnect path should continue to handle this:

   - Client sends `session.open` with old `sessionId`.
   - Gateway loads `gateway_sessions`.
   - Gateway finds the latest `gateway_session_run_links` record for that session.
   - Gateway loads the linked `agent_runs` record.
   - If runtime status is `succeeded`, emit `run.output` with `agent_runs.result`.

2. Active run recovery.

   For active runs after restart:

   - If lease is expired or missing, call `resume(currentRunId)` when available.
   - If lease is still valid and owned elsewhere, reattach as observer.
   - If the run is `awaiting_approval`, emit `approval.requested`.
   - If the run is `clarification_requested`, emit a clarification output frame.

3. Retry from failure.

   For failed runs:

   - `run.retry` should use `gateway_session_run_links.getByRunId(runId)` to verify the run belongs to the session.
   - `agent.retry(runId)` should use the durable `agent_runs`, `run_snapshots`, `agent_events`, and `tool_executions` records.
   - The retry must not create a new unrelated root run.

4. Recovery scanner.

   After Postgres wiring is stable, consider a startup scanner:

   - Use `PostgresRecoveryScanner` from `packages/core/src/postgres-runtime-stores.ts`.
   - Scan for expired leases, stale running runs, awaiting-subagent anomalies, and pending interactions.
   - Do not auto-resume everything blindly at startup; reconnect-triggered recovery is simpler and safer for the first pass.

## Tests

1. Unit tests for store factory.

   Add tests that:

   - `memory` returns in-memory gateway stores.
   - `postgres` creates gateway session stores, cron stores, and runtime stores from the same client.
   - missing `DATABASE_URL` fails with a clear message.
   - a custom `agentFactory` with `postgres` is either given runtime stores or rejected with a clear error.

2. Migration/query alignment tests.

   Keep current mocked-client tests:

   - `packages/gateway-fastify/src/stores-postgres.test.ts`
   - `packages/gateway-fastify/src/stores-postgres-cron.test.ts`
   - `packages/core/src/postgres-runtime-stores.test.ts`

   Add a test that loads the SQL migration text and verifies expected table names are present. If an ephemeral Postgres test harness is available, prefer running migrations and basic CRUD tests against a real database.

3. Restart simulation tests.

   Add integration tests that use the same Postgres database/client across two gateway instances:

   - Boot gateway instance A.
   - Start a `run` session and complete it.
   - Close gateway instance A.
   - Boot gateway instance B with the same Postgres connection.
   - Send `session.open` with the original `sessionId`.
   - Expect `session.opened`, `session.updated`, then replayed `run.output`.

   Add similar restart tests for:

   - failed run, then `run.retry`
   - active run with expired lease, then reconnect-triggered `resume`
   - awaiting approval, then reconnect-triggered `approval.requested`

4. Focused commands.

   Use Bun-native commands:

   ```sh
   bun run --cwd packages/gateway-fastify typecheck
   bun --cwd packages/gateway-fastify test src/stores-postgres.test.ts src/stores-postgres-cron.test.ts src/reconnect.test.ts src/server.test.ts
   bun --cwd packages/core test src/postgres-runtime-stores.test.ts src/adaptive-agent.test.ts
   bun run --cwd packages/gateway-fastify build
   ```

## Rollout Steps

1. Land migrations and config schema.
2. Add Postgres connection factory and store factory.
3. Wire gateway stores through `bootstrapGateway`.
4. Wire Postgres runtime stores through the default agent factory.
5. Add restart simulation tests.
6. Update `packages/gateway-fastify/README.md` with:

   - `stores.kind: "postgres"` example
   - required `DATABASE_URL`
   - migration instructions
   - explicit note that `memory` is not restart-safe
   - explicit note that file-backed gateway stores alone are not full run recovery

## Acceptance Criteria

- `session.open` after server restart can replay a completed run output from Postgres.
- `run.retry` after server restart uses the original durable run and session-run link.
- expired active runs can be resumed after restart.
- pending approval and clarification states survive restart.
- no path uses in-memory runtime stores when config says `stores.kind: "postgres"` and the default agent factory is used.
- resource cleanup closes the Postgres pool on gateway shutdown.
- focused gateway and core tests pass.
- documentation explains the difference between gateway durability and full runtime durability.

## Non-Goals For This Pass

- File-backed core runtime stores.
- Multi-node runtime worker orchestration beyond Postgres leases.
- Automatic startup resume of every stale run.
- DAG execution or parallel child runs.
- Chain-of-thought persistence.
