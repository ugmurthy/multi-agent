import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createFileGatewayStores, type FileStoreOptions } from './stores-file.js';
import type { GatewayStores } from './stores.js';

describe('file-backed gateway stores', () => {
  let testDir: string;
  let stores: GatewayStores;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'gateway-file-store-'));
    stores = createFileGatewayStores({ baseDir: testDir });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('sessions', () => {
    it('creates, reads, and updates a session', async () => {
      const session = await stores.sessions.create({
        id: 'session-1',
        channelId: 'webchat',
        authSubject: 'user-123',
        status: 'idle',
        transcriptVersion: 0,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      });

      expect(session.id).toBe('session-1');

      const fetched = await stores.sessions.get('session-1');
      expect(fetched).toEqual(session);

      const updated = await stores.sessions.update({
        ...session,
        status: 'running',
        updatedAt: '2026-04-08T10:01:00.000Z',
      });

      expect(updated.status).toBe('running');
      expect(await stores.sessions.get('session-1')).toMatchObject({ status: 'running' });
    });

    it('rejects duplicate session creation', async () => {
      await stores.sessions.create({
        id: 'session-1',
        channelId: 'webchat',
        authSubject: 'user-123',
        status: 'idle',
        transcriptVersion: 0,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      });

      await expect(
        stores.sessions.create({
          id: 'session-1',
          channelId: 'webchat',
          authSubject: 'user-456',
          status: 'idle',
          transcriptVersion: 0,
          createdAt: '2026-04-08T10:00:00.000Z',
          updatedAt: '2026-04-08T10:00:00.000Z',
        }),
      ).rejects.toThrow('already exists');
    });

    it('deletes a session', async () => {
      await stores.sessions.create({
        id: 'session-1',
        channelId: 'webchat',
        authSubject: 'user-123',
        status: 'idle',
        transcriptVersion: 0,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      });

      await stores.sessions.delete('session-1');
      expect(await stores.sessions.get('session-1')).toBeUndefined();
    });

    it('lists sessions by auth subject', async () => {
      await stores.sessions.create({
        id: 'session-2',
        channelId: 'webchat',
        authSubject: 'user-123',
        status: 'idle',
        transcriptVersion: 0,
        createdAt: '2026-04-08T10:01:00.000Z',
        updatedAt: '2026-04-08T10:01:00.000Z',
      });
      await stores.sessions.create({
        id: 'session-1',
        channelId: 'webchat',
        authSubject: 'user-123',
        status: 'idle',
        transcriptVersion: 0,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      });
      await stores.sessions.create({
        id: 'session-3',
        channelId: 'webchat',
        authSubject: 'user-other',
        status: 'idle',
        transcriptVersion: 0,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      });

      const sessions = await stores.sessions.listByAuthSubject('user-123');
      expect(sessions.map((s) => s.id)).toEqual(['session-1', 'session-2']);
    });

    it('survives reload from disk', async () => {
      await stores.sessions.create({
        id: 'session-1',
        channelId: 'webchat',
        authSubject: 'user-123',
        status: 'running',
        transcriptVersion: 3,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:05:00.000Z',
      });

      const freshStores = createFileGatewayStores({ baseDir: testDir });
      const reloaded = await freshStores.sessions.get('session-1');
      expect(reloaded).toMatchObject({
        id: 'session-1',
        status: 'running',
        transcriptVersion: 3,
      });
    });
  });

  describe('transcript messages', () => {
    it('appends and lists messages by session in sequence order', async () => {
      await stores.transcriptMessages.append({
        id: 'msg-2',
        sessionId: 'session-1',
        sequence: 2,
        role: 'assistant',
        content: 'Reply',
        createdAt: '2026-04-08T10:00:02.000Z',
      });
      await stores.transcriptMessages.append({
        id: 'msg-1',
        sessionId: 'session-1',
        sequence: 1,
        role: 'user',
        content: 'Hello',
        createdAt: '2026-04-08T10:00:01.000Z',
      });

      const messages = await stores.transcriptMessages.listBySession('session-1');
      expect(messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
    });

    it('deletes all messages for a session', async () => {
      await stores.transcriptMessages.append({
        id: 'msg-1',
        sessionId: 'session-1',
        sequence: 1,
        role: 'user',
        content: 'Hello',
        createdAt: '2026-04-08T10:00:01.000Z',
      });

      await stores.transcriptMessages.deleteBySession('session-1');
      expect(await stores.transcriptMessages.listBySession('session-1')).toEqual([]);
    });

    it('survives reload from disk', async () => {
      await stores.transcriptMessages.append({
        id: 'msg-1',
        sessionId: 'session-1',
        sequence: 1,
        role: 'user',
        content: 'Persistent message',
        createdAt: '2026-04-08T10:00:01.000Z',
      });

      const freshStores = createFileGatewayStores({ baseDir: testDir });
      const messages = await freshStores.transcriptMessages.listBySession('session-1');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('Persistent message');
    });
  });

  describe('session-run links', () => {
    it('appends and retrieves links by run id', async () => {
      await stores.sessionRunLinks.append({
        sessionId: 'session-1',
        runId: 'run-1',
        rootRunId: 'run-1',
        invocationKind: 'chat',
        turnIndex: 1,
        createdAt: '2026-04-08T10:00:00.000Z',
      });

      expect(await stores.sessionRunLinks.getByRunId('run-1')).toMatchObject({
        sessionId: 'session-1',
        runId: 'run-1',
      });
    });

    it('lists links by session', async () => {
      await stores.sessionRunLinks.append({
        sessionId: 'session-1',
        runId: 'run-1',
        rootRunId: 'run-1',
        invocationKind: 'chat',
        createdAt: '2026-04-08T10:00:00.000Z',
      });
      await stores.sessionRunLinks.append({
        sessionId: 'session-1',
        runId: 'run-2',
        rootRunId: 'run-2',
        invocationKind: 'run',
        createdAt: '2026-04-08T10:01:00.000Z',
      });

      const links = await stores.sessionRunLinks.listBySession('session-1');
      expect(links).toHaveLength(2);
    });

    it('deletes links by session', async () => {
      await stores.sessionRunLinks.append({
        sessionId: 'session-1',
        runId: 'run-1',
        rootRunId: 'run-1',
        invocationKind: 'chat',
        createdAt: '2026-04-08T10:00:00.000Z',
      });

      await stores.sessionRunLinks.deleteBySession('session-1');
      expect(await stores.sessionRunLinks.getByRunId('run-1')).toBeUndefined();
    });
  });

  describe('cron jobs', () => {
    it('creates, reads, and lists due jobs', async () => {
      await stores.cronJobs.create({
        id: 'job-1',
        schedule: '*/5 * * * *',
        targetKind: 'session_event',
        target: { sessionId: 'session-1' },
        deliveryMode: 'session',
        delivery: { sessionId: 'session-1' },
        enabled: true,
        nextFireAt: '2026-04-08T10:00:00.000Z',
        createdAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      });

      const job = await stores.cronJobs.get('job-1');
      expect(job).toMatchObject({ id: 'job-1', enabled: true });

      const due = await stores.cronJobs.listDue('2026-04-08T10:00:00.000Z');
      expect(due).toHaveLength(1);
    });

    it('survives reload from disk', async () => {
      await stores.cronJobs.create({
        id: 'job-1',
        schedule: '0 * * * *',
        targetKind: 'isolated_run',
        target: { agentId: 'support-agent' },
        deliveryMode: 'none',
        delivery: {},
        enabled: true,
        nextFireAt: '2026-04-08T10:00:00.000Z',
        createdAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      });

      const freshStores = createFileGatewayStores({ baseDir: testDir });
      const reloaded = await freshStores.cronJobs.get('job-1');
      expect(reloaded).toMatchObject({ id: 'job-1', schedule: '0 * * * *' });
    });
  });

  describe('cron runs', () => {
    it('creates and looks up cron runs by fire time', async () => {
      await stores.cronRuns.create({
        id: 'cron-run-1',
        jobId: 'job-1',
        fireTime: '2026-04-08T10:00:00.000Z',
        status: 'running',
        startedAt: '2026-04-08T10:00:01.000Z',
      });

      const found = await stores.cronRuns.findByFireTime('job-1', '2026-04-08T10:00:00.000Z');
      expect(found).toMatchObject({ id: 'cron-run-1' });

      const byJob = await stores.cronRuns.listByJob('job-1');
      expect(byJob).toHaveLength(1);
    });

    it('survives reload from disk', async () => {
      await stores.cronRuns.create({
        id: 'cron-run-1',
        jobId: 'job-1',
        fireTime: '2026-04-08T10:00:00.000Z',
        status: 'succeeded',
        startedAt: '2026-04-08T10:00:01.000Z',
        finishedAt: '2026-04-08T10:00:05.000Z',
      });

      const freshStores = createFileGatewayStores({ baseDir: testDir });
      const reloaded = await freshStores.cronRuns.get('cron-run-1');
      expect(reloaded).toMatchObject({
        id: 'cron-run-1',
        status: 'succeeded',
        finishedAt: '2026-04-08T10:00:05.000Z',
      });
    });
  });
});
