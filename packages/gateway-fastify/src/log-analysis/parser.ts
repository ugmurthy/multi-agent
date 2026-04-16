import type { JsonObject, JsonValue } from '../core.js';

import type { LogLineIssue, NormalizedLogEntry } from './types.js';

export interface ParseLogLineResult {
  entry?: NormalizedLogEntry;
  issue?: LogLineIssue;
}

const PINO_LEVELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export function parseLogLine(line: string, filePath: string, lineNumber: number): ParseLogLineResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      issue: {
        filePath,
        lineNumber,
        reason: 'Line is not valid JSON.',
        raw: line,
      },
    };
  }

  if (!isRecord(parsed)) {
    return {
      issue: {
        filePath,
        lineNumber,
        reason: 'Line JSON is not an object.',
        raw: line,
      },
    };
  }

  const entry = normalizeLogObject(parsed, filePath, lineNumber, line);
  if (!entry.event && !entry.message) {
    return {
      issue: {
        filePath,
        lineNumber,
        reason: 'Log object does not include an event or message.',
        raw: line,
      },
    };
  }

  return { entry };
}

function normalizeLogObject(
  value: Record<string, unknown>,
  filePath: string,
  lineNumber: number,
  raw: string,
): NormalizedLogEntry {
  if (typeof value.timestamp === 'string' && typeof value.event === 'string') {
    return {
      source: 'gateway',
      filePath,
      lineNumber,
      raw,
      timestamp: value.timestamp,
      timeMs: parseTimestampMs(value.timestamp),
      level: typeof value.level === 'string' ? value.level : undefined,
      event: value.event,
      message: typeof value.message === 'string' ? value.message : undefined,
      data: isJsonObject(value.data) ? value.data : {},
    };
  }

  const runtimeTimestamp = normalizeRuntimeTimestamp(value.time);
  const runtimeLevel = normalizeRuntimeLevel(value.level);
  const runtimeData = copyJsonFields(value, new Set(['level', 'time', 'msg', 'pid', 'hostname', 'name']));
  const event = typeof value.event === 'string' ? value.event : undefined;

  return {
    source: event || runtimeTimestamp !== undefined ? 'runtime' : 'unknown',
    filePath,
    lineNumber,
    raw,
    timestamp: runtimeTimestamp,
    timeMs: runtimeTimestamp ? parseTimestampMs(runtimeTimestamp) : undefined,
    level: runtimeLevel,
    event,
    message: typeof value.msg === 'string' ? value.msg : typeof value.message === 'string' ? value.message : undefined,
    data: runtimeData,
  };
}

function normalizeRuntimeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  }

  return undefined;
}

function normalizeRuntimeLevel(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return PINO_LEVELS[value] ?? String(value);
  }

  return undefined;
}

function parseTimestampMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function copyJsonFields(value: Record<string, unknown>, omitted: Set<string>): JsonObject {
  const output: JsonObject = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    if (omitted.has(key)) {
      continue;
    }

    const normalized = normalizeJsonValue(fieldValue);
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }

  return output;
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const normalized = normalizeJsonValue(item);
      if (normalized !== undefined) {
        items.push(normalized);
      }
    }
    return items;
  }

  if (isRecord(value)) {
    return copyJsonFields(value, new Set());
  }

  return undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
