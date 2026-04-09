/**
 * File-backed gateway stores for durable single-node persistence.
 *
 * On-disk layout (under the configured `baseDir`):
 *
 *   <baseDir>/
 *     sessions/
 *       <sessionId>.json          – GatewaySessionRecord
 *     transcripts/
 *       <sessionId>/
 *         <messageId>.json        – TranscriptMessageRecord
 *     session-run-links/
 *       <runId>.json              – SessionRunLinkRecord
 *     cron-jobs/
 *       <jobId>.json              – GatewayCronJobRecord
 *     cron-runs/
 *       <cronRunId>.json          – GatewayCronRunRecord
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  CronJobStore,
  CronRunStore,
  GatewayCronJobRecord,
  GatewayCronRunRecord,
  GatewaySessionRecord,
  GatewayStores,
  SessionRunLinkRecord,
  SessionRunLinkStore,
  SessionStore,
  TranscriptMessageRecord,
  TranscriptMessageStore,
} from './stores.js';

export interface FileStoreOptions {
  baseDir: string;
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function removeFile(filePath: string): Promise<void> {
  try {
    await rm(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath);
    return entries.filter((entry) => entry.endsWith('.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readAllJson<T>(dirPath: string): Promise<T[]> {
  const files = await listJsonFiles(dirPath);
  const results: T[] = [];

  for (const file of files) {
    const data = await readJson<T>(join(dirPath, file));
    if (data) {
      results.push(data);
    }
  }

  return results;
}

export class FileSessionStore implements SessionStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'sessions');
  }

  async create(session: GatewaySessionRecord): Promise<GatewaySessionRecord> {
    await ensureDir(this.dir);
    const filePath = join(this.dir, `${session.id}.json`);
    const existing = await readJson<GatewaySessionRecord>(filePath);
    if (existing) {
      throw new Error(`Session "${session.id}" already exists.`);
    }
    await writeJson(filePath, session);
    return structuredClone(session);
  }

  async get(sessionId: string): Promise<GatewaySessionRecord | undefined> {
    return readJson<GatewaySessionRecord>(join(this.dir, `${sessionId}.json`));
  }

  async update(session: GatewaySessionRecord): Promise<GatewaySessionRecord> {
    const filePath = join(this.dir, `${session.id}.json`);
    const existing = await readJson<GatewaySessionRecord>(filePath);
    if (!existing) {
      throw new Error(`Session "${session.id}" does not exist.`);
    }
    await writeJson(filePath, session);
    return structuredClone(session);
  }

  async delete(sessionId: string): Promise<void> {
    await removeFile(join(this.dir, `${sessionId}.json`));
  }

  async listByAuthSubject(authSubject: string): Promise<GatewaySessionRecord[]> {
    const allSessions = await readAllJson<GatewaySessionRecord>(this.dir);
    return allSessions
      .filter((session) => session.authSubject === authSubject)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }
}

export class FileTranscriptMessageStore implements TranscriptMessageStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'transcripts');
  }

  async append(message: TranscriptMessageRecord): Promise<TranscriptMessageRecord> {
    const sessionDir = join(this.dir, message.sessionId);
    await ensureDir(sessionDir);
    const filePath = join(sessionDir, `${message.id}.json`);
    const existing = await readJson<TranscriptMessageRecord>(filePath);
    if (existing) {
      throw new Error(`Transcript message "${message.id}" already exists.`);
    }
    await writeJson(filePath, message);
    return structuredClone(message);
  }

  async listBySession(sessionId: string): Promise<TranscriptMessageRecord[]> {
    const sessionDir = join(this.dir, sessionId);
    const messages = await readAllJson<TranscriptMessageRecord>(sessionDir);
    return messages.sort(
      (left, right) =>
        left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  }

  async deleteBySession(sessionId: string): Promise<void> {
    const sessionDir = join(this.dir, sessionId);
    try {
      await rm(sessionDir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export class FileSessionRunLinkStore implements SessionRunLinkStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'session-run-links');
  }

  async append(link: SessionRunLinkRecord): Promise<SessionRunLinkRecord> {
    await ensureDir(this.dir);
    const filePath = join(this.dir, `${link.runId}.json`);
    const existing = await readJson<SessionRunLinkRecord>(filePath);
    if (existing) {
      throw new Error(`Run linkage for run "${link.runId}" already exists.`);
    }
    await writeJson(filePath, link);
    return structuredClone(link);
  }

  async getByRunId(runId: string): Promise<SessionRunLinkRecord | undefined> {
    return readJson<SessionRunLinkRecord>(join(this.dir, `${runId}.json`));
  }

  async listBySession(sessionId: string): Promise<SessionRunLinkRecord[]> {
    const allLinks = await readAllJson<SessionRunLinkRecord>(this.dir);
    return allLinks
      .filter((link) => link.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId));
  }

  async deleteBySession(sessionId: string): Promise<void> {
    const allLinks = await readAllJson<SessionRunLinkRecord>(this.dir);
    for (const link of allLinks) {
      if (link.sessionId === sessionId) {
        await removeFile(join(this.dir, `${link.runId}.json`));
      }
    }
  }
}

export class FileCronJobStore implements CronJobStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'cron-jobs');
  }

  async create(job: GatewayCronJobRecord): Promise<GatewayCronJobRecord> {
    await ensureDir(this.dir);
    const filePath = join(this.dir, `${job.id}.json`);
    const existing = await readJson<GatewayCronJobRecord>(filePath);
    if (existing) {
      throw new Error(`Cron job "${job.id}" already exists.`);
    }
    await writeJson(filePath, job);
    return structuredClone(job);
  }

  async get(jobId: string): Promise<GatewayCronJobRecord | undefined> {
    return readJson<GatewayCronJobRecord>(join(this.dir, `${jobId}.json`));
  }

  async update(job: GatewayCronJobRecord): Promise<GatewayCronJobRecord> {
    const filePath = join(this.dir, `${job.id}.json`);
    const existing = await readJson<GatewayCronJobRecord>(filePath);
    if (!existing) {
      throw new Error(`Cron job "${job.id}" does not exist.`);
    }
    await writeJson(filePath, job);
    return structuredClone(job);
  }

  async delete(jobId: string): Promise<void> {
    await removeFile(join(this.dir, `${jobId}.json`));
  }

  async listDue(now: string): Promise<GatewayCronJobRecord[]> {
    const allJobs = await readAllJson<GatewayCronJobRecord>(this.dir);
    return allJobs
      .filter((job) => job.enabled && job.nextFireAt <= now)
      .sort((left, right) => left.nextFireAt.localeCompare(right.nextFireAt) || left.id.localeCompare(right.id));
  }
}

export class FileCronRunStore implements CronRunStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'cron-runs');
  }

  async create(run: GatewayCronRunRecord): Promise<GatewayCronRunRecord> {
    await ensureDir(this.dir);
    const filePath = join(this.dir, `${run.id}.json`);
    const existing = await readJson<GatewayCronRunRecord>(filePath);
    if (existing) {
      throw new Error(`Cron run "${run.id}" already exists.`);
    }
    await writeJson(filePath, run);
    return structuredClone(run);
  }

  async get(runId: string): Promise<GatewayCronRunRecord | undefined> {
    return readJson<GatewayCronRunRecord>(join(this.dir, `${runId}.json`));
  }

  async update(run: GatewayCronRunRecord): Promise<GatewayCronRunRecord> {
    const filePath = join(this.dir, `${run.id}.json`);
    const existing = await readJson<GatewayCronRunRecord>(filePath);
    if (!existing) {
      throw new Error(`Cron run "${run.id}" does not exist.`);
    }
    await writeJson(filePath, run);
    return structuredClone(run);
  }

  async listByJob(jobId: string): Promise<GatewayCronRunRecord[]> {
    const allRuns = await readAllJson<GatewayCronRunRecord>(this.dir);
    return allRuns
      .filter((run) => run.jobId === jobId)
      .sort((left, right) => left.fireTime.localeCompare(right.fireTime) || left.id.localeCompare(right.id));
  }

  async findByFireTime(jobId: string, fireTime: string): Promise<GatewayCronRunRecord | undefined> {
    const allRuns = await readAllJson<GatewayCronRunRecord>(this.dir);
    return allRuns.find((run) => run.jobId === jobId && run.fireTime === fireTime);
  }
}

export function createFileGatewayStores(options: FileStoreOptions): GatewayStores {
  return {
    sessions: new FileSessionStore(options.baseDir),
    transcriptMessages: new FileTranscriptMessageStore(options.baseDir),
    sessionRunLinks: new FileSessionRunLinkStore(options.baseDir),
    cronJobs: new FileCronJobStore(options.baseDir),
    cronRuns: new FileCronRunStore(options.baseDir),
  };
}
