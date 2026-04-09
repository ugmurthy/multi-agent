import { describe, expect, it, vi } from 'vitest';

import type { GatewayHookDefinition, ResolvedGatewayHooks } from './registries.js';
import { createEmptyResolvedHooks, executeHookSlot, HookExecutionError } from './hooks.js';

describe('executeHookSlot', () => {
  it('returns a no-op result when no hooks are registered for the slot', async () => {
    const hooks = createEmptyResolvedHooks();

    const result = await executeHookSlot(hooks, 'beforeRoute', { slot: 'beforeRoute' });

    expect(result).toEqual({
      executed: 0,
      rejected: false,
      warnings: [],
    });
  });

  it('executes hooks in order and tracks execution count', async () => {
    const callOrder: string[] = [];
    const hooks = createHooksWithSlot('beforeRunStart', [
      createHookDef('hook-a', 'beforeRunStart', async () => {
        callOrder.push('a');
      }),
      createHookDef('hook-b', 'beforeRunStart', async () => {
        callOrder.push('b');
      }),
    ]);

    const result = await executeHookSlot(hooks, 'beforeRunStart', { slot: 'beforeRunStart' });

    expect(result.executed).toBe(2);
    expect(result.rejected).toBe(false);
    expect(callOrder).toEqual(['a', 'b']);
  });

  it('stops execution and reports rejection when a before hook rejects', async () => {
    const callOrder: string[] = [];
    const hooks = createHooksWithSlot('beforeInboundMessage', [
      createHookDef('rate-limit', 'beforeInboundMessage', async () => {
        callOrder.push('rate-limit');
        return { rejected: true, rejectionReason: 'Rate limit exceeded' };
      }),
      createHookDef('audit', 'beforeInboundMessage', async () => {
        callOrder.push('audit');
      }),
    ]);

    const result = await executeHookSlot(hooks, 'beforeInboundMessage', { slot: 'beforeInboundMessage' });

    expect(result.rejected).toBe(true);
    expect(result.rejectionReason).toBe('Rate limit exceeded');
    expect(callOrder).toEqual(['rate-limit']);
  });

  it('uses a default rejection reason when hook does not provide one', async () => {
    const hooks = createHooksWithSlot('beforeRoute', [
      createHookDef('gate', 'beforeRoute', async () => {
        return { rejected: true };
      }),
    ]);

    const result = await executeHookSlot(hooks, 'beforeRoute', { slot: 'beforeRoute' });

    expect(result.rejected).toBe(true);
    expect(result.rejectionReason).toBe('Hook "gate" rejected the request.');
  });

  it('enriches metadata from hooks that return metadata objects', async () => {
    const hooks = createHooksWithSlot('beforeRunStart', [
      createHookDef('enricher', 'beforeRunStart', async () => {
        return { metadata: { priority: 'high', region: 'us-east' } };
      }),
    ]);

    const result = await executeHookSlot(hooks, 'beforeRunStart', {
      slot: 'beforeRunStart',
      metadata: { existing: 'value' },
    });

    expect(result.enrichedMetadata).toEqual({
      existing: 'value',
      priority: 'high',
      region: 'us-east',
    });
  });

  it('merges metadata from multiple enriching hooks', async () => {
    const hooks = createHooksWithSlot('beforeRunStart', [
      createHookDef('enrich-a', 'beforeRunStart', async () => {
        return { metadata: { a: 1 } };
      }),
      createHookDef('enrich-b', 'beforeRunStart', async () => {
        return { metadata: { b: 2 } };
      }),
    ]);

    const result = await executeHookSlot(hooks, 'beforeRunStart', { slot: 'beforeRunStart' });

    expect(result.enrichedMetadata).toEqual({ a: 1, b: 2 });
  });

  describe('failure policy: fail', () => {
    it('throws a HookExecutionError when a hook throws', async () => {
      const hooks = createHooksWithSlot('onError', [
        createHookDef('crasher', 'onError', async () => {
          throw new Error('kaboom');
        }),
      ], 'fail');

      await expect(
        executeHookSlot(hooks, 'onError', { slot: 'onError' }),
      ).rejects.toThrow(HookExecutionError);

      try {
        await executeHookSlot(hooks, 'onError', { slot: 'onError' });
      } catch (error) {
        expect(error).toBeInstanceOf(HookExecutionError);
        expect((error as HookExecutionError).hookId).toBe('crasher');
        expect((error as HookExecutionError).slot).toBe('onError');
        expect((error as HookExecutionError).message).toContain('kaboom');
      }
    });
  });

  describe('failure policy: warn', () => {
    it('records a warning and continues when a hook throws', async () => {
      const callOrder: string[] = [];
      const hooks = createHooksWithSlot('afterRunResult', [
        createHookDef('crasher', 'afterRunResult', async () => {
          callOrder.push('crasher');
          throw new Error('oops');
        }),
        createHookDef('logger', 'afterRunResult', async () => {
          callOrder.push('logger');
        }),
      ], 'warn');

      const result = await executeHookSlot(hooks, 'afterRunResult', { slot: 'afterRunResult' });

      expect(result.executed).toBe(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('crasher');
      expect(result.warnings[0]).toContain('oops');
      expect(callOrder).toEqual(['crasher', 'logger']);
    });
  });

  describe('failure policy: ignore', () => {
    it('silently continues when a hook throws', async () => {
      const callOrder: string[] = [];
      const hooks = createHooksWithSlot('onDisconnect', [
        createHookDef('crasher', 'onDisconnect', async () => {
          callOrder.push('crasher');
          throw new Error('silent fail');
        }),
        createHookDef('cleanup', 'onDisconnect', async () => {
          callOrder.push('cleanup');
        }),
      ], 'ignore');

      const result = await executeHookSlot(hooks, 'onDisconnect', { slot: 'onDisconnect' });

      expect(result.executed).toBe(2);
      expect(result.warnings).toHaveLength(0);
      expect(callOrder).toEqual(['crasher', 'cleanup']);
    });
  });

  it('skips hook definitions that do not implement the requested slot', async () => {
    const hooks = createHooksWithSlot('onAgentEvent', [
      {
        id: 'no-handler',
      },
    ]);

    const result = await executeHookSlot(hooks, 'onAgentEvent', { slot: 'onAgentEvent' });

    expect(result.executed).toBe(0);
    expect(result.rejected).toBe(false);
  });

  it('passes enriched metadata from earlier hooks to later hooks', async () => {
    const receivedMetadata: unknown[] = [];
    const hooks = createHooksWithSlot('beforeOutboundFrame', [
      createHookDef('enrich', 'beforeOutboundFrame', async (ctx: unknown) => {
        receivedMetadata.push((ctx as { metadata?: unknown }).metadata);
        return { metadata: { enriched: true } };
      }),
      createHookDef('inspect', 'beforeOutboundFrame', async (ctx: unknown) => {
        receivedMetadata.push((ctx as { metadata?: unknown }).metadata);
      }),
    ]);

    await executeHookSlot(hooks, 'beforeOutboundFrame', {
      slot: 'beforeOutboundFrame',
      metadata: { original: true },
    });

    expect(receivedMetadata[0]).toEqual({ original: true });
    expect(receivedMetadata[1]).toEqual({ original: true, enriched: true });
  });
});

describe('createEmptyResolvedHooks', () => {
  it('creates hooks with the specified failure policy', () => {
    const hooks = createEmptyResolvedHooks('warn');
    expect(hooks.failurePolicy).toBe('warn');
    expect(hooks.modules).toEqual([]);
    expect(hooks.beforeRoute).toEqual([]);
  });

  it('defaults to fail policy', () => {
    const hooks = createEmptyResolvedHooks();
    expect(hooks.failurePolicy).toBe('fail');
  });
});

function createHookDef(
  id: string,
  slot: string,
  handler: (context: unknown) => Promise<void | { rejected?: boolean; rejectionReason?: string; metadata?: Record<string, unknown> }>,
): GatewayHookDefinition {
  return {
    id,
    [slot]: handler,
  } as GatewayHookDefinition;
}

function createHooksWithSlot(
  slot: keyof ResolvedGatewayHooks,
  hookDefs: GatewayHookDefinition[],
  failurePolicy: ResolvedGatewayHooks['failurePolicy'] = 'fail',
): ResolvedGatewayHooks {
  const hooks = createEmptyResolvedHooks(failurePolicy);
  if (slot !== 'failurePolicy' && slot !== 'modules') {
    (hooks[slot] as GatewayHookDefinition[]) = hookDefs;
  }
  return hooks;
}
