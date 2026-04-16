import type { JsonObject, JsonValue } from '../core.js';

import type {
  CountItem,
  EntityIds,
  FailureObservation,
  LogAnalysisOptions,
  LogAnalysisReport,
  LogLineIssue,
  NormalizedLogEntry,
  ServerLifecycleSummary,
  SessionLifecycleSummary,
  SessionOutcome,
  TimelineEvent,
} from './types.js';

const FAILURE_EVENT_PARTS = ['failed', 'failure', 'rejected', 'error'];
const SUCCESS_EVENTS = new Set(['run.completed', 'tool.completed', 'cron.completed']);
const FAILURE_EVENTS = new Set(['run.failed', 'tool.failed', 'cron.failed']);

export function analyzeLogEntries(
  entries: NormalizedLogEntry[],
  issues: LogLineIssue[] = [],
  options: LogAnalysisOptions = {},
): LogAnalysisReport {
  const filteredEntries = entries
    .filter((entry) => matchesTimeFilter(entry, options))
    .filter((entry) => matchesEntityFilter(entry, options))
    .sort(compareEntries);

  const files = [...new Set(filteredEntries.map((entry) => entry.filePath))].sort();
  const sessions = new Set<string>();
  const runs = new Set<string>();
  const runStarts = new Set<string>();
  const runSuccesses = new Set<string>();
  const runFailures = new Set<string>();
  const eventCounts = new Map<string, number>();
  const completedTools = new Map<string, number>();
  const failureCodes = new Map<string, number>();
  const failureRequestTypes = new Map<string, number>();
  const failingAgents = new Map<string, number>();
  const failingTools = new Map<string, number>();
  const failureSessions = new Map<string, number>();
  const remoteFailureAddresses = new Map<string, number>();
  const failures: FailureObservation[] = [];
  const timeline: TimelineEvent[] = [];

  let sessionsOpened = 0;
  let sessionReattachRequests = 0;
  let runsStarted = 0;
  let runsSucceededWithoutId = 0;
  let runsFailedWithoutId = 0;
  let toolsStarted = 0;
  let toolsCompleted = 0;
  let toolsFailed = 0;
  let approvalsRequested = 0;
  let approvalsResolved = 0;
  let replansRequired = 0;
  let cronCompleted = 0;
  let cronFailed = 0;
  let protocolErrors = 0;
  let authFailures = 0;

  for (const entry of filteredEntries) {
    const ids = extractEntityIds(entry);
    addIfPresent(sessions, ids.sessionId);
    addIfPresent(runs, ids.runId);
    addIfPresent(runs, ids.rootRunId);

    if (entry.event) {
      increment(eventCounts, entry.event);
    }

    const frameType = getString(entry.data, 'frameType');
    const eventType = getString(entry.data, 'eventType');
    const status = getString(entry.data, 'status');
    const code = getString(entry.data, 'code') ?? getStringPath(entry.data, ['details', 'code']);
    const requestType = getString(entry.data, 'requestType');
    const observedEvent = eventType ?? entry.event;
    const runKey = ids.runId ?? ids.rootRunId;

    if (frameType === 'session.opened') {
      sessionsOpened += 1;
    }
    if (frameType === 'session.open' && ids.sessionId) {
      sessionReattachRequests += 1;
    }

    if (frameType === 'run.start' || observedEvent === 'run.created') {
      runsStarted += 1;
      if (runKey) {
        runStarts.add(runKey);
      }
    }

    if (isRunSuccess(entry, observedEvent, frameType, status)) {
      if (runKey) {
        runSuccesses.add(runKey);
      } else {
        runsSucceededWithoutId += 1;
      }
    }

    if (isRunFailure(entry, observedEvent, frameType, status, code)) {
      if (runKey) {
        runFailures.add(runKey);
      } else {
        runsFailedWithoutId += 1;
      }
    }

    if (observedEvent === 'tool.started') {
      toolsStarted += 1;
    }
    if (observedEvent === 'tool.completed') {
      toolsCompleted += 1;
      if (ids.toolName) {
        increment(completedTools, ids.toolName);
      }
    }
    if (observedEvent === 'tool.failed') {
      toolsFailed += 1;
    }
    if (observedEvent === 'approval.requested' || frameType === 'approval.requested') {
      approvalsRequested += 1;
    }
    if (observedEvent === 'approval.resolved' || frameType === 'approval.resolve') {
      approvalsResolved += 1;
    }
    if (observedEvent === 'replan.required') {
      replansRequired += 1;
    }
    if (entry.event === 'cron.completed') {
      cronCompleted += 1;
    }
    if (entry.event === 'cron.failed') {
      cronFailed += 1;
    }
    if (entry.event === 'ws.frame.rejected' || entry.event === 'protocol.error' || frameType === 'error') {
      protocolErrors += 1;
    }
    if (entry.event === 'auth.failure' || code === 'auth_required' || code === 'invalid_token' || code === 'token_expired') {
      authFailures += 1;
    }

    const failure = classifyFailure(entry, ids);
    if (failure) {
      failures.push(failure);
      incrementIfPresent(failureCodes, failure.code);
      incrementIfPresent(failureRequestTypes, failure.requestType);
      incrementIfPresent(failingAgents, failure.agentId);
      incrementIfPresent(failingTools, failure.toolName);
      incrementIfPresent(failureSessions, failure.sessionId);
      incrementIfPresent(remoteFailureAddresses, failure.remoteAddress);
    }

    if (shouldIncludeInTimeline(entry, options)) {
      timeline.push({
        entry,
        label: formatTimelineLabel(entry),
        ids,
        code,
        status,
      });
    }
  }

  const start = firstTimestamp(filteredEntries);
  const end = lastTimestamp(filteredEntries);
  const serverLifecycles = buildServerLifecycles(filteredEntries);

  return {
    generatedAt: new Date().toISOString(),
    window: { start, end },
    files,
    lineCount: entries.length + issues.length,
    parsedCount: filteredEntries.length,
    issueCount: issues.length,
    issues,
    counters: {
      sessionsObserved: sessions.size,
      sessionsOpened,
      sessionReattachRequests,
      runsObserved: runs.size,
      runsStarted: runStarts.size + Math.max(0, runsStarted - runStarts.size),
      runsSucceeded: runSuccesses.size + runsSucceededWithoutId,
      runsFailed: runFailures.size + runsFailedWithoutId,
      toolsStarted,
      toolsCompleted,
      toolsFailed,
      approvalsRequested,
      approvalsResolved,
      replansRequired,
      cronCompleted,
      cronFailed,
      protocolErrors,
      authFailures,
    },
    top: {
      events: topCounts(eventCounts, 8),
      failureCodes: topCounts(failureCodes, 8),
      failureRequestTypes: topCounts(failureRequestTypes, 8),
      failingAgents: topCounts(failingAgents, 8),
      failingTools: topCounts(failingTools, 8),
      failureSessions: topCounts(failureSessions, 8),
      remoteFailureAddresses: topCounts(remoteFailureAddresses, 8),
      completedTools: topCounts(completedTools, 8),
    },
    failures,
    serverLifecycles,
    timeline,
    insights: buildInsights({
      filteredEntries,
      serverLifecycles,
      failures,
      runSuccessCount: runSuccesses.size + runsSucceededWithoutId,
      runFailureCount: runFailures.size + runsFailedWithoutId,
      completedTools,
      failureCodes,
      failureRequestTypes,
      failingAgents,
      failingTools,
      failureSessions,
      remoteFailureAddresses,
      cronCompleted,
      cronFailed,
      replansRequired,
      issueCount: issues.length,
    }),
  };
}

export function extractEntityIds(entry: NormalizedLogEntry): EntityIds {
  return {
    sessionId: firstString(entry.data, ['sessionId'], ['details', 'sessionId']),
    runId: firstString(entry.data, ['runId'], ['activeRunId'], ['details', 'runId']),
    rootRunId: firstString(entry.data, ['rootRunId'], ['activeRootRunId'], ['details', 'rootRunId']),
    parentRunId: firstString(entry.data, ['parentRunId'], ['details', 'parentRunId']),
    agentId: firstString(entry.data, ['agentId'], ['details', 'agentId']),
    toolName: firstString(entry.data, ['toolName'], ['data', 'toolName'], ['details', 'toolName']),
  };
}

function buildServerLifecycles(entries: NormalizedLogEntry[]): ServerLifecycleSummary[] {
  const starts = entries
    .filter((entry) => entry.event === 'gateway.server.started' && entry.timestamp)
    .sort(compareEntries);
  const stops = entries
    .filter((entry) => (entry.event === 'gateway.server.stopped' || entry.event === 'gateway.server.stopping') && entry.timestamp)
    .sort(compareEntries);

  return starts.map((start, index) => {
    const bootId = getString(start.data, 'bootId') ?? `unknown-${index + 1}`;
    const nextStart = starts[index + 1];
    const stopped = stops.find((entry) => getString(entry.data, 'bootId') === bootId && entry.event === 'gateway.server.stopped');
    const windowEndMs = stopped?.timeMs ?? nextStart?.timeMs;
    const windowEntries = entries.filter((entry) => {
      if (entry.timeMs === undefined || start.timeMs === undefined) {
        return false;
      }
      return entry.timeMs >= start.timeMs && (windowEndMs === undefined || entry.timeMs < windowEndMs || entry === stopped);
    });
    const sessionItems = buildSessionSummaries(windowEntries);
    const status = stopped ? 'stopped' : nextStart ? 'restarted_without_stop' : 'running';

    return {
      bootId,
      pid: getNumber(start.data, 'pid'),
      startedAt: start.timestamp!,
      stoppedAt: stopped?.timestamp,
      status,
      host: getString(start.data, 'host'),
      port: getNumber(start.data, 'port'),
      storesKind: getString(start.data, 'storesKind'),
      agentCount: getNumber(start.data, 'agentCount'),
      sessions: {
        observed: sessionItems.length,
        succeeded: sessionItems.filter((session) => session.outcome === 'succeeded').length,
        failed: sessionItems.filter((session) => session.outcome === 'failed').length,
        pending: sessionItems.filter((session) => session.outcome === 'pending').length,
        items: sessionItems,
      },
    };
  });
}

function buildSessionSummaries(entries: NormalizedLogEntry[]): SessionLifecycleSummary[] {
  const summaries = new Map<string, MutableSessionSummary>();

  for (const entry of entries) {
    const ids = extractEntityIds(entry);
    if (!ids.sessionId) {
      continue;
    }

    const summary = getOrCreateSessionSummary(summaries, ids.sessionId);
    const frameType = getString(entry.data, 'frameType');
    const eventType = getString(entry.data, 'eventType');
    const status = getString(entry.data, 'status');
    const code = getString(entry.data, 'code') ?? getStringPath(entry.data, ['details', 'code']);
    const observedEvent = eventType ?? entry.event;

    if (!summary.openedAt && (frameType === 'session.opened' || frameType === 'session.open')) {
      summary.openedAt = entry.timestamp;
    }
    summary.lastEventAt = entry.timestamp ?? summary.lastEventAt;

    addIfPresent(summary.runIds, ids.runId);
    addIfPresent(summary.rootRunIds, ids.rootRunId);
    if (ids.agentId) {
      summary.agentId = ids.agentId;
    }

    if (isRunSuccess(entry, observedEvent, frameType, status)) {
      summary.successCount += 1;
    }
    if (isRunFailure(entry, observedEvent, frameType, status, code) || classifyFailure(entry, ids)) {
      summary.failureCount += 1;
    }
  }

  return [...summaries.values()]
    .map((summary) => ({
      sessionId: summary.sessionId,
      outcome: resolveSessionOutcome(summary),
      openedAt: summary.openedAt,
      lastEventAt: summary.lastEventAt,
      runIds: [...summary.runIds].sort(),
      rootRunIds: [...summary.rootRunIds].sort(),
      agentId: summary.agentId,
      failureCount: summary.failureCount,
      successCount: summary.successCount,
    }))
    .sort((left, right) => (left.openedAt ?? left.lastEventAt ?? '').localeCompare(right.openedAt ?? right.lastEventAt ?? ''));
}

interface MutableSessionSummary {
  sessionId: string;
  openedAt?: string;
  lastEventAt?: string;
  runIds: Set<string>;
  rootRunIds: Set<string>;
  agentId?: string;
  failureCount: number;
  successCount: number;
}

function getOrCreateSessionSummary(summaries: Map<string, MutableSessionSummary>, sessionId: string): MutableSessionSummary {
  const existing = summaries.get(sessionId);
  if (existing) {
    return existing;
  }

  const created: MutableSessionSummary = {
    sessionId,
    runIds: new Set(),
    rootRunIds: new Set(),
    failureCount: 0,
    successCount: 0,
  };
  summaries.set(sessionId, created);
  return created;
}

function resolveSessionOutcome(summary: MutableSessionSummary): SessionOutcome {
  if (summary.failureCount > 0) {
    return 'failed';
  }
  if (summary.successCount > 0) {
    return 'succeeded';
  }
  return 'pending';
}

function classifyFailure(entry: NormalizedLogEntry, ids: EntityIds): FailureObservation | undefined {
  const frameType = getString(entry.data, 'frameType');
  const eventType = getString(entry.data, 'eventType');
  const code = getString(entry.data, 'code') ?? getStringPath(entry.data, ['details', 'code']);
  const requestType = getString(entry.data, 'requestType');
  const event = eventType ?? entry.event;
  const message = getStringPath(entry.data, ['err', 'message']) ?? entry.message;
  const failedByEvent = event ? FAILURE_EVENTS.has(event) || FAILURE_EVENT_PARTS.some((part) => event.includes(part)) : false;
  const failedByLevel = entry.level === 'error' || entry.level === 'fatal';
  const failedByFrame = frameType === 'error' || frameType === 'run.output' && getString(entry.data, 'hasError') === 'true';

  if (!failedByEvent && !failedByLevel && !failedByFrame && code === undefined) {
    return undefined;
  }

  return {
    entry,
    reason: message ?? event ?? code ?? 'Failure observed',
    code,
    requestType,
    event,
    sessionId: ids.sessionId,
    runId: ids.runId,
    rootRunId: ids.rootRunId,
    agentId: ids.agentId,
    toolName: ids.toolName,
    remoteAddress: getString(entry.data, 'remoteAddress'),
  };
}

function isRunSuccess(
  entry: NormalizedLogEntry,
  observedEvent: string | undefined,
  frameType: string | undefined,
  status: string | undefined,
): boolean {
  return (
    observedEvent === 'run.completed' ||
    entry.event === 'run.completed' ||
    SUCCESS_EVENTS.has(observedEvent ?? '') && (observedEvent ?? '').startsWith('run.') ||
    (frameType === 'run.output' && (status === 'succeeded' || status === 'success'))
  );
}

function isRunFailure(
  entry: NormalizedLogEntry,
  observedEvent: string | undefined,
  frameType: string | undefined,
  status: string | undefined,
  code: string | undefined,
): boolean {
  return (
    observedEvent === 'run.failed' ||
    entry.event === 'run.failed' ||
    (frameType === 'run.output' && (status === 'failed' || code === 'run_failed')) ||
    (frameType === 'error' && code === 'run_failed')
  );
}

function shouldIncludeInTimeline(entry: NormalizedLogEntry, options: LogAnalysisOptions): boolean {
  const filter = options.filter;
  if (filter?.sessionId || filter?.runId || filter?.rootRunId) {
    return true;
  }

  return Boolean(
    entry.event?.startsWith('cron.') ||
      entry.event?.startsWith('ws.frame.') ||
      getString(entry.data, 'eventType') ||
      getString(entry.data, 'frameType') === 'error',
  );
}

function formatTimelineLabel(entry: NormalizedLogEntry): string {
  const frameType = getString(entry.data, 'frameType');
  const eventType = getString(entry.data, 'eventType');
  const status = getString(entry.data, 'status');
  const code = getString(entry.data, 'code');
  const event = eventType ?? entry.event ?? frameType ?? 'log';
  const parts = [event];

  if (frameType && frameType !== event) {
    parts.push(`frame=${frameType}`);
  }
  if (status) {
    parts.push(`status=${status}`);
  }
  if (code) {
    parts.push(`code=${code}`);
  }

  return parts.join(' ');
}

function buildInsights(options: {
  filteredEntries: NormalizedLogEntry[];
  serverLifecycles: ServerLifecycleSummary[];
  failures: FailureObservation[];
  runSuccessCount: number;
  runFailureCount: number;
  completedTools: Map<string, number>;
  failureCodes: Map<string, number>;
  failureRequestTypes: Map<string, number>;
  failingAgents: Map<string, number>;
  failingTools: Map<string, number>;
  failureSessions: Map<string, number>;
  remoteFailureAddresses: Map<string, number>;
  cronCompleted: number;
  cronFailed: number;
  replansRequired: number;
  issueCount: number;
}): string[] {
  const insights: string[] = [];
  const totalTerminalRuns = options.runSuccessCount + options.runFailureCount;

  if (totalTerminalRuns > 0) {
    const successRate = Math.round((options.runSuccessCount / totalTerminalRuns) * 100);
    insights.push(`${successRate}% of observed terminal runs succeeded (${options.runSuccessCount}/${totalTerminalRuns}).`);
  }

  const topTool = topCounts(options.completedTools, 1)[0];
  if (topTool) {
    insights.push(`Most completed tool: ${topTool.key} (${topTool.count}).`);
  }

  if (options.cronCompleted > 0 || options.cronFailed > 0) {
    insights.push(`Cron outcomes observed: ${options.cronCompleted} completed, ${options.cronFailed} failed.`);
  }

  if (options.serverLifecycles.length > 0) {
    const failedSessions = options.serverLifecycles.reduce((count, lifecycle) => count + lifecycle.sessions.failed, 0);
    const succeededSessions = options.serverLifecycles.reduce((count, lifecycle) => count + lifecycle.sessions.succeeded, 0);
    insights.push(
      `Server lifecycle events found: ${options.serverLifecycles.length} start${options.serverLifecycles.length === 1 ? '' : 's'}; sessions ${succeededSessions} succeeded, ${failedSessions} failed.`,
    );
  }

  const topCode = topCounts(options.failureCodes, 1)[0];
  if (topCode) {
    insights.push(`Most common failure code: ${topCode.key} (${topCode.count}).`);
  }

  const topRequestType = topCounts(options.failureRequestTypes, 1)[0];
  if (topRequestType && topRequestType.count > 1) {
    insights.push(`Failures cluster around requestType=${topRequestType.key} (${topRequestType.count}).`);
  }

  const topAgent = topCounts(options.failingAgents, 1)[0];
  if (topAgent && topAgent.count > 1) {
    insights.push(`Failures cluster around agentId=${topAgent.key} (${topAgent.count}).`);
  }

  const topFailingTool = topCounts(options.failingTools, 1)[0];
  if (topFailingTool && topFailingTool.count > 1) {
    insights.push(`Failures cluster around toolName=${topFailingTool.key} (${topFailingTool.count}).`);
  }

  const topSession = topCounts(options.failureSessions, 1)[0];
  if (topSession && topSession.count > 1) {
    insights.push(`Session ${topSession.key} has repeated failures (${topSession.count}).`);
  }

  const topRemote = topCounts(options.remoteFailureAddresses, 1)[0];
  if (topRemote && topRemote.count > 1) {
    insights.push(`Remote address ${topRemote.key} accounts for repeated failures (${topRemote.count}).`);
  }

  if (options.replansRequired > 0) {
    insights.push(`Replanning was required ${options.replansRequired} time${options.replansRequired === 1 ? '' : 's'}.`);
  }

  if (options.issueCount > 0) {
    insights.push(`${options.issueCount} log line${options.issueCount === 1 ? '' : 's'} could not be parsed.`);
  }

  if (insights.length === 0 && options.filteredEntries.length > 0) {
    insights.push('No failures or unusual patterns were detected in the selected logs.');
  }

  return insights;
}

function matchesTimeFilter(entry: NormalizedLogEntry, options: LogAnalysisOptions): boolean {
  const { sinceMs, untilMs } = options.filter ?? {};
  if (entry.timeMs === undefined) {
    return true;
  }
  if (sinceMs !== undefined && entry.timeMs < sinceMs) {
    return false;
  }
  if (untilMs !== undefined && entry.timeMs > untilMs) {
    return false;
  }
  return true;
}

function matchesEntityFilter(entry: NormalizedLogEntry, options: LogAnalysisOptions): boolean {
  const filter = options.filter;
  if (!filter?.sessionId && !filter?.runId && !filter?.rootRunId) {
    return true;
  }

  const ids = extractEntityIds(entry);
  return Boolean(
    (filter.sessionId && ids.sessionId === filter.sessionId) ||
      (filter.runId && (ids.runId === filter.runId || ids.rootRunId === filter.runId || ids.parentRunId === filter.runId)) ||
      (filter.rootRunId && ids.rootRunId === filter.rootRunId),
  );
}

function firstTimestamp(entries: NormalizedLogEntry[]): string | undefined {
  return entries.find((entry) => entry.timestamp)?.timestamp;
}

function lastTimestamp(entries: NormalizedLogEntry[]): string | undefined {
  return entries.findLast((entry) => entry.timestamp)?.timestamp;
}

function compareEntries(left: NormalizedLogEntry, right: NormalizedLogEntry): number {
  return (left.timeMs ?? 0) - (right.timeMs ?? 0) || left.filePath.localeCompare(right.filePath) || left.lineNumber - right.lineNumber;
}

function topCounts(counts: Map<string, number>, limit: number): CountItem[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function incrementIfPresent(counts: Map<string, number>, key: string | undefined): void {
  if (key) {
    increment(counts, key);
  }
}

function addIfPresent(values: Set<string>, value: string | undefined): void {
  if (value) {
    values.add(value);
  }
}

function firstString(data: JsonObject, ...paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = getStringPath(data, path);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function getString(data: JsonObject, key: string): string | undefined {
  const value = data[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function getNumber(data: JsonObject, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' ? value : undefined;
}

function getStringPath(data: JsonObject, path: string[]): string | undefined {
  let current: JsonValue | undefined = data;
  for (const key of path) {
    if (!isJsonObject(current)) {
      return undefined;
    }
    current = current[key];
  }

  if (typeof current === 'string') {
    return current;
  }
  if (typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }
  return undefined;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
