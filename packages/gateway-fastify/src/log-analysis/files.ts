import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { parseLogLine } from './parser.js';
import type { LogLineIssue, NormalizedLogEntry } from './types.js';

export const DEFAULT_LOCAL_GATEWAY_LOG_DIR = join(homedir(), '.adaptiveAgent', 'data', 'gateway', 'logs');

export interface ReadLogFilesResult {
  entries: NormalizedLogEntry[];
  issues: LogLineIssue[];
}

export async function discoverLogFiles(options: {
  dir?: string;
  files?: string[];
  date?: string;
} = {}): Promise<string[]> {
  if (options.files?.length) {
    return options.files.map((filePath) => resolve(expandHome(filePath))).sort();
  }

  const logDir = resolve(expandHome(options.dir ?? DEFAULT_LOCAL_GATEWAY_LOG_DIR));
  if (!existsSync(logDir)) {
    return [];
  }

  const entries = await readdir(logDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(logDir, entry.name))
    .filter((filePath) => isSupportedLogFile(filePath, options.date))
    .sort();
}

export async function readLogFiles(filePaths: string[]): Promise<ReadLogFilesResult> {
  const entries: NormalizedLogEntry[] = [];
  const issues: LogLineIssue[] = [];

  for (const filePath of filePaths) {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const result = parseLogLine(lines[index]!, filePath, index + 1);
      if (result.entry) {
        entries.push(result.entry);
      }
      if (result.issue) {
        issues.push(result.issue);
      }
    }
  }

  return { entries, issues };
}

export interface LogTailState {
  filePath: string;
  offset: number;
  lineNumber: number;
  remainder: string;
}

export function createLogTailStates(filePaths: string[]): LogTailState[] {
  return filePaths.map((filePath) => {
    const stats = statSync(filePath);
    return {
      filePath,
      offset: stats.size,
      lineNumber: countExistingLines(filePath),
      remainder: '',
    };
  });
}

export async function readAppendedLogLines(states: LogTailState[]): Promise<ReadLogFilesResult> {
  const entries: NormalizedLogEntry[] = [];
  const issues: LogLineIssue[] = [];

  for (const state of states) {
    const stats = await stat(state.filePath).catch(() => undefined);
    if (!stats) {
      continue;
    }

    if (stats.size < state.offset) {
      state.offset = 0;
      state.lineNumber = 0;
      state.remainder = '';
    }

    if (stats.size === state.offset) {
      continue;
    }

    const stream = createReadStream(state.filePath, {
      start: state.offset,
      end: stats.size - 1,
      encoding: 'utf8',
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(String(chunk));
    }

    state.offset = stats.size;
    const text = state.remainder + chunks.join('');
    const lines = text.split(/\r?\n/);
    state.remainder = lines.pop() ?? '';

    for (const line of lines) {
      state.lineNumber += 1;
      const result = parseLogLine(line, state.filePath, state.lineNumber);
      if (result.entry) {
        entries.push(result.entry);
      }
      if (result.issue) {
        issues.push(result.issue);
      }
    }
  }

  return { entries, issues };
}

function isSupportedLogFile(filePath: string, date: string | undefined): boolean {
  const name = basename(filePath);
  const supported = /^gateway-\d{4}-\d{2}-\d{2}\.log$/.test(name) || /^agent-runtime-\d{4}-\d{2}-\d{2}(?:-\d+)?\.log$/.test(name);
  return supported && (!date || name.includes(date));
}

function expandHome(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

function countExistingLines(filePath: string): number {
  const content = statSync(filePath).size === 0 ? '' : readFileSync(filePath, 'utf8');
  return content.length === 0 ? 0 : content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0);
}
