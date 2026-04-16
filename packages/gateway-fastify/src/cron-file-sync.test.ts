import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { syncCronFiles } from './cron-file-sync.js';
import { createInMemoryGatewayStores, type GatewayCronJobRecord } from './stores.js';

const tempDirectories: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cron-file-sync-test-'));
  tempDirectories.push(dir);
  return dir;
}

function createCronJob(overrides: Partial<GatewayCronJobRecord> = {}): GatewayCronJobRecord {
  return {
    id: 'ipl',
    schedule: '30 21 * * *',
    targetKind: 'isolated_run',
    target: {
      agentId: 'ipl-agent',
      goal: 'run examples/ipl2.sh',
    },
    deliveryMode: 'webhook',
    delivery: {
      url: 'http://127.0.0.1:3999/cron',
    },
    enabled: true,
    nextFireAt: '2026-04-15T21:30:00.000Z',
    createdAt: '2026-04-11T18:00:00.000Z',
    updatedAt: '2026-04-11T18:00:00.000Z',
    ...overrides,
  };
}

async function writeCronJob(dir: string, job: GatewayCronJobRecord): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${job.id}.json`);
  await writeFile(filePath, `${JSON.stringify(job, null, 2)}\n`, 'utf-8');
  return filePath;
}

describe('cron file sync', () => {
  afterEach(async () => {
    await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    tempDirectories.length = 0;
  });

  it('imports cron jobs from json files into the target store', async () => {
    const dir = await createTempDir();
    const stores = createInMemoryGatewayStores();
    await writeCronJob(dir, createCronJob());

    const summary = await syncCronFiles({ dir, stores });
    const imported = await stores.cronJobs.get('ipl');

    expect(summary).toMatchObject({ scanned: 1, imported: 1, updated: 0, skipped: 0, failed: 0 });
    expect(imported).toMatchObject({
      id: 'ipl',
      schedule: '30 21 * * *',
      deliveryMode: 'webhook',
      nextFireAt: '2026-04-15T21:30:00.000Z',
    });
    expect(imported?.metadata?.source).toMatchObject({
      kind: 'file',
      path: join(dir, 'ipl.json'),
    });
  });

  it('does not overwrite a postgres-newer cron job with an older file', async () => {
    const dir = await createTempDir();
    const stores = createInMemoryGatewayStores();
    await writeCronJob(dir, createCronJob({ schedule: '30 21 * * *' }));
    await stores.cronJobs.create(createCronJob({
      schedule: '0 22 * * *',
      updatedAt: '2999-01-01T00:00:00.000Z',
    }));

    const summary = await syncCronFiles({ dir, stores });
    const job = await stores.cronJobs.get('ipl');

    expect(summary).toMatchObject({ scanned: 1, imported: 0, updated: 0, skipped: 1, failed: 0 });
    expect(job?.schedule).toBe('0 22 * * *');
  });

  it('updates a cron job when the file is newer than the store row', async () => {
    const dir = await createTempDir();
    const stores = createInMemoryGatewayStores();
    await stores.cronJobs.create(createCronJob({
      schedule: '0 22 * * *',
      updatedAt: '2000-01-01T00:00:00.000Z',
    }));
    await writeCronJob(dir, createCronJob({ schedule: '30 21 * * *' }));

    const summary = await syncCronFiles({ dir, stores });
    const job = await stores.cronJobs.get('ipl');

    expect(summary).toMatchObject({ scanned: 1, imported: 0, updated: 1, skipped: 0, failed: 0 });
    expect(job?.schedule).toBe('30 21 * * *');
    expect(job?.metadata?.source).toMatchObject({
      kind: 'file',
      path: join(dir, 'ipl.json'),
    });
  });
});
