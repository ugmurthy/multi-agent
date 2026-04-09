import { describe, expect, it } from 'vitest';

import type { AgentRegistryEntry } from './agent-registry.js';
import { AgentRegistry } from './agent-registry.js';
import type { GatewayConfig } from './config.js';
import type { CreatedAdaptiveAgent, RunResult } from './core.js';
import { createModuleRegistry } from './registries.js';
import { createInMemoryGatewayStores, type GatewayCronJobRecord, type GatewayStores } from './stores.js';
import { createSchedulerLoop, executeCronTarget } from './scheduler.js';

function createStubAgent(overrides: {
  chatResult?: RunResult;
  runResult?: RunResult;
} = {}): CreatedAdaptiveAgent {
  const defaultSuccess: RunResult = {
    status: 'success',
    runId: 'run-1',
    output: 'done',
    stepsUsed: 1,
    usage: { promptTokens: 10, completionTokens: 5, estimatedCostUSD: 0 },
  };

  return {
    agent: {
      chat: async () => overrides.chatResult ?? defaultSuccess,
      run: async () => overrides.runResult ?? defaultSuccess,
    },
    runtime: {
      runStore: { getRun: async () => ({ id: 'run-1', rootRunId: 'run-1', status: 'completed' }) },
      eventStore: {},
      snapshotStore: {},
      planStore: {},
    },
  };
}

function createTestAgentRegistry(
  stubAgent: CreatedAdaptiveAgent = createStubAgent(),
): AgentRegistry {
  const moduleRegistry = createModuleRegistry({});
  return new AgentRegistry({
    agents: [
      {
        path: '/test/agent.json',
        config: {
          id: 'test-agent',
          name: 'Test Agent',
          invocationModes: ['chat', 'run'],
          defaultInvocationMode: 'chat',
          model: { provider: 'openrouter', model: 'test' },
          tools: [],
          delegates: [],
        },
      },
    ],
    moduleRegistry,
    agentFactory: () => stubAgent,
  });
}

function createTestGatewayConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    server: { host: '0.0.0.0', port: 3000, websocketPath: '/ws' },
    bindings: [],
    defaultAgentId: 'test-agent',
    hooks: {
      failurePolicy: 'fail',
      modules: [],
      onAuthenticate: [],
      onSessionResolve: [],
      beforeRoute: [],
      beforeInboundMessage: [],
      beforeRunStart: [],
      afterRunResult: [],
      onAgentEvent: [],
      beforeOutboundFrame: [],
      onDisconnect: [],
      onError: [],
    },
    ...overrides,
  };
}

function createDueJob(overrides: Partial<GatewayCronJobRecord> = {}): GatewayCronJobRecord {
  return {
    id: 'job-1',
    schedule: '*/5 * * * *',
    targetKind: 'isolated_run',
    target: {
      agentId: 'test-agent',
      goal: 'run the scheduled task',
    },
    deliveryMode: 'none',
    delivery: {},
    enabled: true,
    nextFireAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const fixedNow = () => new Date('2026-01-01T00:05:00.000Z');
let idCounter = 0;
const idFactory = () => `gen-${++idCounter}`;

describe('executeCronTarget', () => {
  it('dispatches isolated_run target kind through agent.run', async () => {
    const stores = createInMemoryGatewayStores();
    const job = createDueJob();
    await stores.cronJobs.create(job);

    const result = await executeCronTarget(job, {
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      now: fixedNow,
      idFactory,
    });

    expect(result.status).toBe('succeeded');
    expect(result.runId).toBe('run-1');
  });

  it('dispatches isolated_chat target kind through a fresh session', async () => {
    const stores = createInMemoryGatewayStores();
    const job = createDueJob({
      targetKind: 'isolated_chat',
      target: {
        agentId: 'test-agent',
        content: 'hello from cron',
        channelId: 'cron-chan',
      },
    });
    await stores.cronJobs.create(job);

    const result = await executeCronTarget(job, {
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      now: fixedNow,
      idFactory,
    });

    expect(result.status).toBe('succeeded');
    expect(result.sessionId).toBeDefined();
  });

  it('dispatches session_event target kind through an existing session', async () => {
    const stores = createInMemoryGatewayStores();
    const session = await stores.sessions.create({
      id: 'sess-1',
      channelId: 'main',
      authSubject: 'user-1',
      status: 'idle',
      transcriptVersion: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const job = createDueJob({
      targetKind: 'session_event',
      target: {
        sessionId: session.id,
        content: 'scheduled check-in',
      },
    });
    await stores.cronJobs.create(job);

    const result = await executeCronTarget(job, {
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      now: fixedNow,
      idFactory,
    });

    expect(result.status).toBe('succeeded');
    expect(result.sessionId).toBe('sess-1');
  });

  it('returns failed when session_event references a missing session', async () => {
    const stores = createInMemoryGatewayStores();
    const job = createDueJob({
      targetKind: 'session_event',
      target: { sessionId: 'no-such-session' },
    });

    const result = await executeCronTarget(job, {
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      now: fixedNow,
      idFactory,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('does not exist');
  });

  it('returns failed when session_event is missing sessionId', async () => {
    const stores = createInMemoryGatewayStores();
    const job = createDueJob({
      targetKind: 'session_event',
      target: {},
    });

    const result = await executeCronTarget(job, {
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      now: fixedNow,
      idFactory,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('requires target.sessionId');
  });

  it('marks approval-requested cron runs as needs_review', async () => {
    const approvalResult: RunResult = {
      status: 'approval_requested',
      runId: 'run-2',
      message: 'need approval',
      toolName: 'dangerousTool',
    };

    const stores = createInMemoryGatewayStores();
    const job = createDueJob({
      targetKind: 'isolated_run',
      target: { goal: 'do something risky' },
    });

    const result = await executeCronTarget(job, {
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(createStubAgent({ runResult: approvalResult })),
      stores,
      now: fixedNow,
      idFactory,
    });

    expect(result.status).toBe('needs_review');
    expect(result.error).toContain('approval');
  });

  it('returns failed for unknown target kind', async () => {
    const stores = createInMemoryGatewayStores();
    const job = createDueJob({
      targetKind: 'unknown_kind' as any,
      target: {},
    });

    const result = await executeCronTarget(job, {
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      now: fixedNow,
      idFactory,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Unknown cron target kind');
  });
});

describe('createSchedulerLoop', () => {
  it('tick() claims due jobs and dispatches them', async () => {
    const stores = createInMemoryGatewayStores();
    const job = createDueJob();
    await stores.cronJobs.create(job);

    const scheduler = createSchedulerLoop({
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      leaseOwner: 'test-worker',
      now: fixedNow,
      idFactory,
      pollIntervalMs: 999_999,
    });

    try {
      const dispatched = await scheduler.tick();
      expect(dispatched).toBe(1);

      const cronRuns = await stores.cronRuns.listByJob(job.id);
      expect(cronRuns).toHaveLength(1);
      expect(cronRuns[0]!.status).toBe('succeeded');
    } finally {
      scheduler.stop();
    }
  });

  it('tick() skips jobs that already have a cron run for that fire time', async () => {
    const stores = createInMemoryGatewayStores();
    const job = createDueJob();
    await stores.cronJobs.create(job);

    await stores.cronRuns.create({
      id: 'existing-run',
      jobId: job.id,
      fireTime: job.nextFireAt,
      status: 'succeeded',
      startedAt: '2026-01-01T00:01:00.000Z',
      finishedAt: '2026-01-01T00:02:00.000Z',
    });

    const scheduler = createSchedulerLoop({
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      leaseOwner: 'test-worker',
      now: fixedNow,
      idFactory,
      pollIntervalMs: 999_999,
    });

    try {
      const dispatched = await scheduler.tick();
      expect(dispatched).toBe(0);
    } finally {
      scheduler.stop();
    }
  });

  it('tick() records failed cron runs on dispatch errors', async () => {
    const failingAgent = createStubAgent({
      runResult: {
        status: 'failure',
        runId: 'fail-run',
        error: 'something broke',
        code: 'TOOL_ERROR',
        stepsUsed: 1,
        usage: { promptTokens: 0, completionTokens: 0, estimatedCostUSD: 0 },
      },
    });

    const stores = createInMemoryGatewayStores();
    const job = createDueJob();
    await stores.cronJobs.create(job);

    const scheduler = createSchedulerLoop({
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(failingAgent),
      stores,
      leaseOwner: 'test-worker',
      now: fixedNow,
      idFactory,
      pollIntervalMs: 999_999,
    });

    try {
      const dispatched = await scheduler.tick();
      expect(dispatched).toBe(1);

      const cronRuns = await stores.cronRuns.listByJob(job.id);
      expect(cronRuns).toHaveLength(1);
      expect(cronRuns[0]!.status).toBe('failed');
    } finally {
      scheduler.stop();
    }
  });

  it('stop() prevents further tick execution', async () => {
    const stores = createInMemoryGatewayStores();
    const scheduler = createSchedulerLoop({
      gatewayConfig: createTestGatewayConfig(),
      agentRegistry: createTestAgentRegistry(),
      stores,
      pollIntervalMs: 999_999,
    });

    scheduler.stop();

    const dispatched = await scheduler.tick();
    expect(dispatched).toBe(0);
  });
});
