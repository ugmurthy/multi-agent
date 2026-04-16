import type { JsonObject, JsonValue } from '../core.js';

export type LogSource = 'gateway' | 'runtime' | 'unknown';

export interface LogLineIssue {
  filePath: string;
  lineNumber: number;
  reason: string;
  raw: string;
}

export interface NormalizedLogEntry {
  source: LogSource;
  filePath: string;
  lineNumber: number;
  raw: string;
  timestamp?: string;
  timeMs?: number;
  level?: string;
  event?: string;
  message?: string;
  data: JsonObject;
}

export interface LogAnalysisFilter {
  sinceMs?: number;
  untilMs?: number;
  sessionId?: string;
  runId?: string;
  rootRunId?: string;
}

export interface LogAnalysisOptions {
  filter?: LogAnalysisFilter;
}

export interface EntityIds {
  sessionId?: string;
  runId?: string;
  rootRunId?: string;
  parentRunId?: string;
  agentId?: string;
  toolName?: string;
}

export interface FailureObservation {
  entry: NormalizedLogEntry;
  reason: string;
  code?: string;
  requestType?: string;
  event?: string;
  sessionId?: string;
  runId?: string;
  rootRunId?: string;
  agentId?: string;
  toolName?: string;
  remoteAddress?: string;
}

export interface TimelineEvent {
  entry: NormalizedLogEntry;
  label: string;
  ids: EntityIds;
  code?: string;
  status?: string;
}

export interface CountItem {
  key: string;
  count: number;
}

export type ServerLifecycleStatus = 'running' | 'stopped' | 'restarted_without_stop';
export type SessionOutcome = 'succeeded' | 'failed' | 'pending';

export interface SessionLifecycleSummary {
  sessionId: string;
  outcome: SessionOutcome;
  openedAt?: string;
  lastEventAt?: string;
  runIds: string[];
  rootRunIds: string[];
  agentId?: string;
  failureCount: number;
  successCount: number;
}

export interface ServerLifecycleSummary {
  bootId: string;
  pid?: number;
  startedAt: string;
  stoppedAt?: string;
  status: ServerLifecycleStatus;
  host?: string;
  port?: number;
  storesKind?: string;
  agentCount?: number;
  sessions: {
    observed: number;
    succeeded: number;
    failed: number;
    pending: number;
    items: SessionLifecycleSummary[];
  };
}

export interface LogAnalysisReport {
  generatedAt: string;
  window: {
    start?: string;
    end?: string;
  };
  files: string[];
  lineCount: number;
  parsedCount: number;
  issueCount: number;
  issues: LogLineIssue[];
  counters: {
    sessionsObserved: number;
    sessionsOpened: number;
    sessionReattachRequests: number;
    runsObserved: number;
    runsStarted: number;
    runsSucceeded: number;
    runsFailed: number;
    toolsStarted: number;
    toolsCompleted: number;
    toolsFailed: number;
    approvalsRequested: number;
    approvalsResolved: number;
    replansRequired: number;
    cronCompleted: number;
    cronFailed: number;
    protocolErrors: number;
    authFailures: number;
  };
  top: {
    events: CountItem[];
    failureCodes: CountItem[];
    failureRequestTypes: CountItem[];
    failingAgents: CountItem[];
    failingTools: CountItem[];
    failureSessions: CountItem[];
    remoteFailureAddresses: CountItem[];
    completedTools: CountItem[];
  };
  failures: FailureObservation[];
  serverLifecycles: ServerLifecycleSummary[];
  timeline: TimelineEvent[];
  insights: string[];
}

export type JsonRecord = Record<string, JsonValue>;
