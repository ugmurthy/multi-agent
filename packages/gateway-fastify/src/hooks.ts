import type { GatewayHookSlot, HookFailurePolicy } from './config.js';
import type { JsonObject } from './core.js';
import type { GatewayHookDefinition, ResolvedGatewayHooks } from './registries.js';

export interface HookContext {
  slot: GatewayHookSlot;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface HookExecutionResult {
  executed: number;
  rejected: boolean;
  rejectionReason?: string;
  enrichedMetadata?: JsonObject;
  warnings: string[];
}

export async function executeHookSlot(
  hooks: ResolvedGatewayHooks,
  slot: GatewayHookSlot,
  context: HookContext,
): Promise<HookExecutionResult> {
  const hookDefinitions = hooks[slot];
  const result: HookExecutionResult = {
    executed: 0,
    rejected: false,
    warnings: [],
  };

  if (hookDefinitions.length === 0) {
    return result;
  }

  let enrichedMetadata: JsonObject | undefined = context.metadata ? { ...context.metadata } : undefined;

  for (const hookDef of hookDefinitions) {
    const handler = hookDef[slot];
    if (!handler) {
      continue;
    }

    try {
      const hookResult = await handler({
        ...context,
        metadata: enrichedMetadata,
      });

      result.executed += 1;

      if (isHookRejection(hookResult)) {
        result.rejected = true;
        result.rejectionReason = hookResult.rejectionReason ?? `Hook "${hookDef.id}" rejected the request.`;
        return result;
      }

      if (isHookEnrichment(hookResult) && hookResult.metadata) {
        enrichedMetadata = { ...(enrichedMetadata ?? {}), ...hookResult.metadata };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const hookLabel = `Hook "${hookDef.id}" on slot "${slot}"`;

      switch (hooks.failurePolicy) {
        case 'fail':
          throw new HookExecutionError(`${hookLabel} failed: ${errorMessage}`, {
            hookId: hookDef.id,
            slot,
            cause: error instanceof Error ? error : undefined,
          });
        case 'warn':
          result.warnings.push(`${hookLabel} failed: ${errorMessage}`);
          result.executed += 1;
          break;
        case 'ignore':
          result.executed += 1;
          break;
      }
    }
  }

  if (enrichedMetadata) {
    result.enrichedMetadata = enrichedMetadata;
  }

  return result;
}

export function isBeforeHookSlot(slot: GatewayHookSlot): boolean {
  return slot.startsWith('before');
}

interface HookRejection {
  rejected: true;
  rejectionReason?: string;
}

interface HookEnrichment {
  metadata?: JsonObject;
}

function isHookRejection(value: unknown): value is HookRejection {
  return typeof value === 'object' && value !== null && 'rejected' in value && (value as HookRejection).rejected === true;
}

function isHookEnrichment(value: unknown): value is HookEnrichment {
  return typeof value === 'object' && value !== null && 'metadata' in value;
}

export class HookExecutionError extends Error {
  readonly hookId: string;
  readonly slot: GatewayHookSlot;

  constructor(
    message: string,
    options: { hookId: string; slot: GatewayHookSlot; cause?: Error },
  ) {
    super(message);
    this.name = 'HookExecutionError';
    this.hookId = options.hookId;
    this.slot = options.slot;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export function createEmptyResolvedHooks(failurePolicy: HookFailurePolicy = 'fail'): ResolvedGatewayHooks {
  return {
    failurePolicy,
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
  };
}
