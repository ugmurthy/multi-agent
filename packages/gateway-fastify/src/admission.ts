import { randomUUID } from 'node:crypto';

import type { GatewayConcurrencyConfig } from './config.js';
import { ProtocolValidationError } from './protocol.js';
import type { GatewayRunAdmissionRecord, GatewayStores, RunAdmissionLimitName } from './stores.js';

export interface AcquireRunAdmissionOptions {
  stores: GatewayStores;
  concurrency: GatewayConcurrencyConfig;
  agentId: string;
  tenantId?: string;
  sessionId?: string;
  requestType: string;
  now: Date;
  admissionIdFactory?: () => string;
}

export interface AcquiredRunAdmission {
  admissionId: string;
  release(): Promise<void>;
}

export async function acquireRunAdmission(options: AcquireRunAdmissionOptions): Promise<AcquiredRunAdmission> {
  const nowIso = options.now.toISOString();
  const admission: GatewayRunAdmissionRecord = {
    id: (options.admissionIdFactory ?? randomUUID)(),
    agentId: options.agentId,
    tenantId: options.tenantId,
    sessionId: options.sessionId,
    status: 'running',
    leaseOwner: 'gateway',
    leaseExpiresAt: new Date(options.now.getTime() + options.concurrency.runAdmissionLeaseMs).toISOString(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const result = await options.stores.runAdmissions.tryAcquire(
    admission,
    {
      maxActiveRuns: options.concurrency.maxActiveRuns,
      maxActiveRunsPerTenant: options.concurrency.maxActiveRunsPerTenant,
      maxActiveRunsPerAgent: options.concurrency.maxActiveRunsPerAgent,
    },
    nowIso,
  );

  if (!result.acquired) {
    throw createGatewayOverloadedError(result.limit, result.activeCount, options);
  }

  return {
    admissionId: result.admission.id,
    release: async () => {
      await options.stores.runAdmissions.release(result.admission.id, new Date().toISOString());
    },
  };
}

function createGatewayOverloadedError(
  limit: RunAdmissionLimitName,
  activeCount: number,
  options: Pick<AcquireRunAdmissionOptions, 'agentId' | 'tenantId' | 'sessionId' | 'requestType' | 'concurrency'>,
): ProtocolValidationError {
  return new ProtocolValidationError('gateway_overloaded', `Gateway run admission limit "${limit}" is exhausted.`, {
    requestType: options.requestType,
    details: {
      limit,
      activeCount,
      configuredLimit: options.concurrency[limit],
      agentId: options.agentId,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
  });
}
