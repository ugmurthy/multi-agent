import { randomUUID } from 'node:crypto';

import type { AgentRegistry } from './agent-registry.js';
import type { GatewayAuthContext } from './auth.js';
import type { GatewayConfig } from './config.js';
import type { JsonObject, RunResult } from './core.js';
import { executeGatewayChatTurn } from './chat.js';
import { executeGatewayRunStart } from './run.js';
import type {
  CronTargetKind,
  GatewayCronJobRecord,
  GatewayCronRunRecord,
  GatewayStores,
} from './stores.js';

export interface SchedulerLoopOptions {
  gatewayConfig: GatewayConfig;
  agentRegistry: AgentRegistry;
  stores: GatewayStores;
  leaseOwner?: string;
  leaseDurationMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  idFactory?: () => string;
  onError?: (error: unknown, job: GatewayCronJobRecord) => void;
}

export interface SchedulerHandle {
  stop(): void;
  tick(): Promise<number>;
}

export interface CronDispatchResult {
  cronRunId: string;
  jobId: string;
  status: 'succeeded' | 'failed' | 'needs_review';
  runId?: string;
  rootRunId?: string;
  sessionId?: string;
  error?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_LEASE_DURATION_MS = 60_000;

export function createSchedulerLoop(options: SchedulerLoopOptions): SchedulerHandle {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const handle: SchedulerHandle = {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      running = false;
    },
    async tick(): Promise<number> {
      return executeTick(options);
    },
  };

  running = true;
  timer = setInterval(async () => {
    if (!running) return;
    try {
      await executeTick(options);
    } catch {
      // poll loop swallows top-level errors; per-job errors go to onError
    }
  }, pollIntervalMs);

  return handle;
}

async function executeTick(options: SchedulerLoopOptions): Promise<number> {
  const nowFn = options.now ?? (() => new Date());
  const nowIso = nowFn().toISOString();
  const leaseOwner = options.leaseOwner ?? `scheduler-${randomUUID()}`;
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const leaseExpiresAt = new Date(nowFn().getTime() + leaseDurationMs).toISOString();
  const idFactory = options.idFactory ?? randomUUID;

  const dueJobs = await options.stores.cronJobs.listDue(nowIso);
  let dispatched = 0;

  for (const job of dueJobs) {
    try {
      const result = await dispatchCronJob(job, {
        gatewayConfig: options.gatewayConfig,
        agentRegistry: options.agentRegistry,
        stores: options.stores,
        leaseOwner,
        leaseExpiresAt,
        now: nowFn,
        idFactory,
      });

      if (result) {
        dispatched += 1;
      }
    } catch (error) {
      options.onError?.(error, job);
    }
  }

  return dispatched;
}

interface DispatchCronJobOptions {
  gatewayConfig: GatewayConfig;
  agentRegistry: AgentRegistry;
  stores: GatewayStores;
  leaseOwner: string;
  leaseExpiresAt: string;
  now: () => Date;
  idFactory: () => string;
}

async function dispatchCronJob(
  job: GatewayCronJobRecord,
  options: DispatchCronJobOptions,
): Promise<CronDispatchResult | undefined> {
  const nowIso = options.now().toISOString();

  const existing = await options.stores.cronRuns.findByFireTime(job.id, job.nextFireAt);
  if (existing) {
    return undefined;
  }

  const cronRun: GatewayCronRunRecord = {
    id: options.idFactory(),
    jobId: job.id,
    fireTime: job.nextFireAt,
    status: 'running',
    leaseOwner: options.leaseOwner,
    startedAt: nowIso,
  };

  await options.stores.cronRuns.create(cronRun);

  try {
    const result = await executeCronTarget(job, {
      gatewayConfig: options.gatewayConfig,
      agentRegistry: options.agentRegistry,
      stores: options.stores,
      now: options.now,
      idFactory: options.idFactory,
    });

    const finishedAt = options.now().toISOString();
    await options.stores.cronRuns.update({
      ...cronRun,
      status: result.status,
      runId: result.runId,
      rootRunId: result.rootRunId,
      sessionId: result.sessionId,
      finishedAt,
      error: result.error,
    });

    return {
      cronRunId: cronRun.id,
      jobId: job.id,
      status: result.status,
      runId: result.runId,
      rootRunId: result.rootRunId,
      sessionId: result.sessionId,
      error: result.error,
    };
  } catch (error) {
    const finishedAt = options.now().toISOString();
    const errorMessage = error instanceof Error ? error.message : 'Cron dispatch failed unexpectedly.';

    await options.stores.cronRuns.update({
      ...cronRun,
      status: 'failed',
      finishedAt,
      error: errorMessage,
    });

    return {
      cronRunId: cronRun.id,
      jobId: job.id,
      status: 'failed',
      error: errorMessage,
    };
  }
}

interface ExecuteCronTargetOptions {
  gatewayConfig: GatewayConfig;
  agentRegistry: AgentRegistry;
  stores: GatewayStores;
  now: () => Date;
  idFactory: () => string;
}

interface CronTargetResult {
  status: 'succeeded' | 'failed' | 'needs_review';
  runId?: string;
  rootRunId?: string;
  sessionId?: string;
  error?: string;
}

export async function executeCronTarget(
  job: GatewayCronJobRecord,
  options: ExecuteCronTargetOptions,
): Promise<CronTargetResult> {
  switch (job.targetKind) {
    case 'session_event':
      return executeCronSessionEvent(job, options);
    case 'isolated_run':
      return executeCronIsolatedRun(job, options);
    case 'isolated_chat':
      return executeCronIsolatedChat(job, options);
    default:
      return {
        status: 'failed',
        error: `Unknown cron target kind "${job.targetKind}".`,
      };
  }
}

async function executeCronSessionEvent(
  job: GatewayCronJobRecord,
  options: ExecuteCronTargetOptions,
): Promise<CronTargetResult> {
  const sessionId = job.target.sessionId as string | undefined;
  const channelId = job.target.channelId as string | undefined;
  const content = (job.target.content as string) ?? `Scheduled event for cron job ${job.id}.`;

  if (!sessionId) {
    return {
      status: 'failed',
      error: `Cron job "${job.id}" target kind "session_event" requires target.sessionId.`,
    };
  }

  const session = await options.stores.sessions.get(sessionId);
  if (!session) {
    return {
      status: 'failed',
      error: `Cron job "${job.id}" references session "${sessionId}" which does not exist.`,
    };
  }

  const cronAuthContext = buildCronAuthContext(job, session.authSubject);

  try {
    const frame = await executeGatewayChatTurn(
      {
        type: 'message.send',
        sessionId: session.id,
        content,
        metadata: buildCronMetadata(job),
      },
      {
        gatewayConfig: options.gatewayConfig,
        agentRegistry: options.agentRegistry,
        stores: options.stores,
        authContext: cronAuthContext,
        now: options.now,
        transcriptMessageIdFactory: options.idFactory,
      },
    );

    if (frame.type === 'approval.requested') {
      return {
        status: 'needs_review',
        runId: frame.runId,
        rootRunId: frame.rootRunId,
        sessionId: session.id,
        error: `Cron execution paused at approval: ${frame.reason ?? 'approval required'}`,
      };
    }

    return {
      status: 'succeeded',
      runId: frame.runId,
      rootRunId: frame.rootRunId,
      sessionId: session.id,
    };
  } catch (error) {
    return {
      status: 'failed',
      sessionId: session.id,
      error: error instanceof Error ? error.message : 'Session event cron dispatch failed.',
    };
  }
}

async function executeCronIsolatedRun(
  job: GatewayCronJobRecord,
  options: ExecuteCronTargetOptions,
): Promise<CronTargetResult> {
  const agentId = job.target.agentId as string | undefined;
  const goal = (job.target.goal as string) ?? `Scheduled run for cron job ${job.id}.`;
  const input = job.target.input;
  const context = (job.target.context as JsonObject) ?? {};
  const cronAuthContext = buildCronAuthContext(job);

  try {
    const frame = await executeGatewayRunStart(
      {
        type: 'run.start',
        agentId,
        goal,
        input,
        context,
        metadata: buildCronMetadata(job),
      },
      {
        gatewayConfig: options.gatewayConfig,
        agentRegistry: options.agentRegistry,
        stores: options.stores,
        authContext: cronAuthContext,
        now: options.now,
      },
    );

    if (frame.type === 'approval.requested') {
      return {
        status: 'needs_review',
        runId: frame.runId,
        rootRunId: frame.rootRunId,
        error: `Cron execution paused at approval: ${frame.reason ?? 'approval required'}`,
      };
    }

    return {
      status: frame.status === 'succeeded' ? 'succeeded' : 'failed',
      runId: frame.runId,
      rootRunId: frame.rootRunId,
      error: frame.status === 'failed' ? frame.error : undefined,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Isolated run cron dispatch failed.',
    };
  }
}

async function executeCronIsolatedChat(
  job: GatewayCronJobRecord,
  options: ExecuteCronTargetOptions,
): Promise<CronTargetResult> {
  const agentId = job.target.agentId as string | undefined;
  const channelId = (job.target.channelId as string) ?? '__cron__';
  const content = (job.target.content as string) ?? `Scheduled chat for cron job ${job.id}.`;
  const cronAuthContext = buildCronAuthContext(job);

  const session = await options.stores.sessions.create({
    id: options.idFactory(),
    channelId,
    agentId,
    authSubject: cronAuthContext.subject,
    tenantId: cronAuthContext.tenantId,
    status: 'idle',
    transcriptVersion: 0,
    createdAt: options.now().toISOString(),
    updatedAt: options.now().toISOString(),
  });

  try {
    const frame = await executeGatewayChatTurn(
      {
        type: 'message.send',
        sessionId: session.id,
        content,
        metadata: buildCronMetadata(job),
      },
      {
        gatewayConfig: options.gatewayConfig,
        agentRegistry: options.agentRegistry,
        stores: options.stores,
        authContext: cronAuthContext,
        now: options.now,
        transcriptMessageIdFactory: options.idFactory,
      },
    );

    if (frame.type === 'approval.requested') {
      return {
        status: 'needs_review',
        runId: frame.runId,
        rootRunId: frame.rootRunId,
        sessionId: session.id,
        error: `Cron execution paused at approval: ${frame.reason ?? 'approval required'}`,
      };
    }

    return {
      status: 'succeeded',
      runId: frame.runId,
      rootRunId: frame.rootRunId,
      sessionId: session.id,
    };
  } catch (error) {
    return {
      status: 'failed',
      sessionId: session.id,
      error: error instanceof Error ? error.message : 'Isolated chat cron dispatch failed.',
    };
  }
}

function buildCronAuthContext(
  job: GatewayCronJobRecord,
  fallbackSubject?: string,
): GatewayAuthContext {
  const subject = (job.target.authSubject as string) ?? fallbackSubject ?? `cron:${job.id}`;
  const tenantId = job.target.tenantId as string | undefined;
  const roles = (job.target.roles as string[]) ?? [];

  return {
    subject,
    tenantId,
    roles,
    claims: { cronJobId: job.id, cronFireTime: job.nextFireAt },
  };
}

function buildCronMetadata(job: GatewayCronJobRecord): JsonObject {
  return {
    cron: {
      jobId: job.id,
      fireTime: job.nextFireAt,
      targetKind: job.targetKind,
    },
  };
}
