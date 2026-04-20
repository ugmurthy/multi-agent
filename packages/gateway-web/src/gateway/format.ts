import type { AgentEventFrame } from './protocol';

import type { ClarificationRequestOutput, LiveAgentEventSummary } from './types';

export function summarizeAgentEvent(frame: AgentEventFrame): LiveAgentEventSummary {
  const payload = asRecord(frame.data);
  const status = readString(payload, 'toStatus') ?? readString(payload, 'status');
  const toolName = readString(payload, 'toolName') ?? readString(payload, 'name');
  const detail = readString(payload, 'message') ?? readString(payload, 'reason') ?? readString(payload, 'error');

  return {
    eventType: frame.eventType,
    compactText: formatCompactAgentEventFrame(frame),
    runId: frame.runId,
    rootRunId: frame.rootRunId,
    seq: frame.seq,
    status,
    toolName,
    detail,
    timestamp: frame.createdAt ? new Date(frame.createdAt) : new Date(),
  };
}

export function formatCompactAgentEventFrame(frame: AgentEventFrame): string {
  const payload = asRecord(frame.data);
  const pieces = [frame.eventType];
  const status = readString(payload, 'toStatus') ?? readString(payload, 'status');
  const toolName = readString(payload, 'toolName') ?? readString(payload, 'name');
  const durationMs = readNumber(payload, 'durationMs');

  if (frame.seq !== undefined) {
    pieces.push(`#${frame.seq}`);
  }
  if (frame.runId) {
    pieces.push(`run:${shortId(frame.runId)}`);
  }
  if (status) {
    pieces.push(status);
  }
  if (toolName) {
    pieces.push(toolName);
  }
  if (durationMs !== undefined) {
    pieces.push(formatDuration(durationMs));
  }

  return pieces.join(' · ');
}

export function formatRunOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  if (output === undefined || output === null) {
    return '';
  }

  return JSON.stringify(output, null, 2);
}

export function isClarificationRequestOutput(value: unknown): value is ClarificationRequestOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { status?: unknown; message?: unknown; suggestedQuestions?: unknown };
  return (
    candidate.status === 'clarification_requested' &&
    typeof candidate.message === 'string' &&
    Array.isArray(candidate.suggestedQuestions) &&
    candidate.suggestedQuestions.every((entry) => typeof entry === 'string')
  );
}

export function shortId(value: string | undefined): string {
  if (!value) {
    return 'none';
  }

  return value.length <= 10 ? value : value.slice(0, 8);
}

export function formatClockTime(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function eventTone(eventType: string): 'good' | 'warn' | 'bad' | 'work' {
  if (eventType.includes('failed') || eventType.includes('error')) {
    return 'bad';
  }
  if (eventType === 'replan.required' || eventType.includes('approval') || eventType.includes('clarification')) {
    return 'warn';
  }
  if (eventType.includes('completed') || eventType.includes('succeeded') || eventType.includes('resolved')) {
    return 'good';
  }
  return 'work';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
