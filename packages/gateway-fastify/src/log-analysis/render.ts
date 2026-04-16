import type { CountItem, FailureObservation, LogAnalysisReport, ServerLifecycleSummary, TimelineEvent } from './types.js';

export interface RenderOptions {
  json?: boolean;
  detailed?: boolean;
  timeZone?: string;
  maxTimeline?: number;
  maxFailures?: number;
}

export function renderReport(report: LogAnalysisReport, options: RenderOptions = {}): string {
  if (options.json) {
    return JSON.stringify(report, null, 2);
  }

  if (!options.detailed) {
    return renderCompactReport(report, options);
  }

  const lines: string[] = [];
  const timeZone = options.timeZone;

  lines.push('Gateway Log Analysis');
  lines.push(`Window: ${formatWindow(report.window.start, report.window.end, timeZone)}`);
  lines.push(`Files: ${report.files.length === 0 ? '(none)' : report.files.map((file) => file.split('/').at(-1)).join(', ')}`);
  lines.push(`Lines: ${report.lineCount} read, ${report.parsedCount} parsed, ${report.issueCount} issues`);
  lines.push('');

  lines.push('Health');
  lines.push(`- Sessions observed: ${report.counters.sessionsObserved}`);
  lines.push(`- Sessions opened: ${report.counters.sessionsOpened}`);
  lines.push(`- Session reattach requests: ${report.counters.sessionReattachRequests}`);
  lines.push(`- Runs observed: ${report.counters.runsObserved}`);
  lines.push(`- Runs started: ${report.counters.runsStarted}`);
  lines.push(`- Runs succeeded: ${report.counters.runsSucceeded}`);
  lines.push(`- Runs failed: ${report.counters.runsFailed}`);
  lines.push(`- Tools completed: ${report.counters.toolsCompleted}`);
  lines.push(`- Tools failed: ${report.counters.toolsFailed}`);
  lines.push(`- Approvals requested/resolved: ${report.counters.approvalsRequested}/${report.counters.approvalsResolved}`);
  lines.push(`- Replans required: ${report.counters.replansRequired}`);
  lines.push(`- Cron completed/failed: ${report.counters.cronCompleted}/${report.counters.cronFailed}`);
  lines.push(`- Protocol errors: ${report.counters.protocolErrors}`);
  lines.push(`- Auth failures: ${report.counters.authFailures}`);
  lines.push('');

  lines.push('What Went Well');
  const wins = renderWins(report);
  lines.push(...(wins.length ? wins : ['- No successful terminal events were observed in this window.']));
  lines.push('');

  lines.push('Failures');
  const failures = renderFailures(report.failures, options.maxFailures ?? 8, timeZone);
  lines.push(...(failures.length ? failures : ['- No failures detected in the selected logs.']));
  lines.push('');

  lines.push('Global Patterns');
  const patterns = renderPatterns(report);
  lines.push(...(patterns.length ? patterns : ['- No repeated failure patterns detected.']));

  lines.push('');
  lines.push('Server Starts');
  const lifecycles = renderServerLifecycles(report.serverLifecycles, timeZone, true);
  lines.push(...(lifecycles.length ? lifecycles : ['- No gateway.server.started events found in the selected logs.']));

  if (report.insights.length > 0) {
    lines.push('');
    lines.push('Insights');
    lines.push(...report.insights.map((insight) => `- ${insight}`));
  }

  if (report.timeline.length > 0) {
    lines.push('');
    lines.push('Timeline');
    lines.push(...renderTimeline(report.timeline, options.maxTimeline ?? 80, timeZone));
  }

  if (report.issues.length > 0) {
    lines.push('');
    lines.push('Parse Issues');
    for (const issue of report.issues.slice(0, 5)) {
      lines.push(`- ${issue.filePath.split('/').at(-1)}:${issue.lineNumber} ${issue.reason}`);
    }
    if (report.issues.length > 5) {
      lines.push(`- ... ${report.issues.length - 5} more`);
    }
  }

  return lines.join('\n');
}

function renderCompactReport(report: LogAnalysisReport, options: RenderOptions): string {
  const lines: string[] = [];
  const timeZone = options.timeZone;
  const terminalRuns = report.counters.runsSucceeded + report.counters.runsFailed;
  const successRate = terminalRuns > 0 ? Math.round((report.counters.runsSucceeded / terminalRuns) * 100) : undefined;
  const failureSummary = renderCompactFailureSummary(report);

  lines.push('Gateway Logs');
  lines.push(`Window: ${formatWindow(report.window.start, report.window.end, timeZone)}`);
  lines.push(`Files: ${report.files.length} | Lines: ${report.lineCount} read, ${report.parsedCount} parsed, ${report.issueCount} issues`);
  lines.push(
    `Activity: sessions ${report.counters.sessionsObserved} observed/${report.counters.sessionsOpened} opened, runs ${report.counters.runsStarted} started/${report.counters.runsSucceeded} ok/${report.counters.runsFailed} failed${
      successRate === undefined ? '' : ` (${successRate}% success)`
    }`,
  );
  lines.push(
    `Events: tools ${report.counters.toolsCompleted} ok/${report.counters.toolsFailed} failed, approvals ${report.counters.approvalsRequested}/${report.counters.approvalsResolved}, cron ${report.counters.cronCompleted} ok/${report.counters.cronFailed} failed`,
  );
  lines.push(`Failures: ${failureSummary}`);
  lines.push(`Server starts: ${renderCompactServerLifecycleSummary(report.serverLifecycles)}`);

  const compactPatterns = renderCompactPatterns(report);
  if (compactPatterns.length > 0) {
    lines.push(...compactPatterns);
  }

  const compactInsights = report.insights.slice(0, 3);
  if (compactInsights.length > 0) {
    lines.push(`Insights: ${compactInsights.join(' ')}`);
  }

  lines.push('Details: rerun with --details, --session-id, --run-id, or --root-run-id for timelines.');
  return lines.join('\n');
}

export function renderWatchEntries(report: LogAnalysisReport, options: RenderOptions = {}): string[] {
  const timeZone = options.timeZone;
  return report.timeline.map((event) => renderTimelineEvent(event, timeZone));
}

function renderWins(report: LogAnalysisReport): string[] {
  const lines: string[] = [];
  if (report.counters.runsSucceeded > 0) {
    const total = report.counters.runsSucceeded + report.counters.runsFailed;
    const successRate = Math.round((report.counters.runsSucceeded / total) * 100);
    lines.push(`- ${successRate}% of observed terminal runs succeeded (${report.counters.runsSucceeded}/${total}).`);
  }
  if (report.counters.toolsCompleted > 0) {
    lines.push(`- ${report.counters.toolsCompleted} tool completion${report.counters.toolsCompleted === 1 ? '' : 's'} observed.`);
  }
  if (report.top.completedTools.length > 0) {
    lines.push(`- Top completed tools: ${formatCounts(report.top.completedTools)}.`);
  }
  if (report.counters.cronCompleted > 0) {
    lines.push(`- ${report.counters.cronCompleted} cron job${report.counters.cronCompleted === 1 ? '' : 's'} completed.`);
  }
  if (report.counters.approvalsResolved > 0) {
    lines.push(`- ${report.counters.approvalsResolved} approval resolution${report.counters.approvalsResolved === 1 ? '' : 's'} observed.`);
  }
  return lines;
}

function renderFailures(failures: FailureObservation[], maxFailures: number, timeZone: string | undefined): string[] {
  return failures.slice(0, maxFailures).map((failure) => {
    const ids = [
      failure.sessionId ? `session=${failure.sessionId}` : undefined,
      failure.runId ? `run=${failure.runId}` : undefined,
      failure.rootRunId ? `root=${failure.rootRunId}` : undefined,
      failure.agentId ? `agent=${failure.agentId}` : undefined,
      failure.toolName ? `tool=${failure.toolName}` : undefined,
      failure.code ? `code=${failure.code}` : undefined,
      failure.requestType ? `request=${failure.requestType}` : undefined,
    ].filter(Boolean);
    return `- ${formatClockTime(failure.entry.timestamp, timeZone)} ${failure.event ?? failure.entry.event ?? 'failure'}${ids.length ? ` ${ids.join(' ')}` : ''}: ${failure.reason}`;
  });
}

function renderPatterns(report: LogAnalysisReport): string[] {
  const lines: string[] = [];
  pushCounts(lines, 'Failure codes', report.top.failureCodes);
  pushCounts(lines, 'Failure request types', report.top.failureRequestTypes);
  pushCounts(lines, 'Failing agents', report.top.failingAgents);
  pushCounts(lines, 'Failing tools', report.top.failingTools);
  pushCounts(lines, 'Sessions with failures', report.top.failureSessions);
  pushCounts(lines, 'Remote failure addresses', report.top.remoteFailureAddresses);
  return lines;
}

function renderCompactServerLifecycleSummary(lifecycles: ServerLifecycleSummary[]): string {
  if (lifecycles.length === 0) {
    return 'none found';
  }

  const stopped = lifecycles.filter((lifecycle) => lifecycle.status === 'stopped').length;
  const succeeded = lifecycles.reduce((count, lifecycle) => count + lifecycle.sessions.succeeded, 0);
  const failed = lifecycles.reduce((count, lifecycle) => count + lifecycle.sessions.failed, 0);
  const pending = lifecycles.reduce((count, lifecycle) => count + lifecycle.sessions.pending, 0);
  return `${lifecycles.length} observed/${stopped} stopped; sessions ${succeeded} ok/${failed} failed/${pending} pending`;
}

function renderServerLifecycles(
  lifecycles: ServerLifecycleSummary[],
  timeZone: string | undefined,
  includeSessions: boolean,
): string[] {
  const lines: string[] = [];
  for (const lifecycle of lifecycles) {
    const target = lifecycle.port === undefined ? '' : ` ${lifecycle.host ?? 'host'}:${lifecycle.port}`;
    lines.push(
      `- ${formatClockTime(lifecycle.startedAt, timeZone)} started boot=${shortId(lifecycle.bootId)} pid=${lifecycle.pid ?? '?'}${target} status=${lifecycle.status} sessions=${lifecycle.sessions.succeeded} ok/${lifecycle.sessions.failed} failed/${lifecycle.sessions.pending} pending`,
    );
    if (lifecycle.stoppedAt) {
      lines.push(`  stopped ${formatClockTime(lifecycle.stoppedAt, timeZone)} boot=${shortId(lifecycle.bootId)}`);
    }
    if (includeSessions) {
      for (const session of lifecycle.sessions.items.slice(0, 12)) {
        const runs = session.runIds.length > 0 ? ` runs=${session.runIds.join(',')}` : '';
        const agent = session.agentId ? ` agent=${session.agentId}` : '';
        lines.push(
          `  session=${session.sessionId} outcome=${session.outcome}${agent}${runs} failures=${session.failureCount} successes=${session.successCount}`,
        );
      }
      if (lifecycle.sessions.items.length > 12) {
        lines.push(`  ... ${lifecycle.sessions.items.length - 12} more sessions`);
      }
    }
  }
  return lines;
}

function renderCompactFailureSummary(report: LogAnalysisReport): string {
  if (report.failures.length === 0) {
    return 'none detected';
  }

  const parts = [`${report.failures.length} observed`];
  if (report.top.failureCodes.length > 0) {
    parts.push(`codes ${formatCounts(report.top.failureCodes.slice(0, 3))}`);
  }
  if (report.top.failureRequestTypes.length > 0) {
    parts.push(`requests ${formatCounts(report.top.failureRequestTypes.slice(0, 3))}`);
  }
  return parts.join('; ');
}

function renderCompactPatterns(report: LogAnalysisReport): string[] {
  const lines: string[] = [];
  if (report.top.failingAgents.length > 0) {
    lines.push(`Failure agents: ${formatCounts(report.top.failingAgents.slice(0, 3))}`);
  }
  if (report.top.failingTools.length > 0) {
    lines.push(`Failure tools: ${formatCounts(report.top.failingTools.slice(0, 3))}`);
  }
  if (report.top.failureSessions.length > 0) {
    lines.push(`Failure sessions: ${formatCounts(report.top.failureSessions.slice(0, 3))}`);
  }
  if (report.top.completedTools.length > 0) {
    lines.push(`Top completed tools: ${formatCounts(report.top.completedTools.slice(0, 3))}`);
  }
  return lines;
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function renderTimeline(timeline: TimelineEvent[], maxTimeline: number, timeZone: string | undefined): string[] {
  const visible = timeline.slice(0, maxTimeline).map((event) => renderTimelineEvent(event, timeZone));
  if (timeline.length > maxTimeline) {
    visible.push(`- ... ${timeline.length - maxTimeline} more events`);
  }
  return visible;
}

function renderTimelineEvent(event: TimelineEvent, timeZone: string | undefined): string {
  const ids = [
    event.ids.sessionId ? `session=${event.ids.sessionId}` : undefined,
    event.ids.runId ? `run=${event.ids.runId}` : undefined,
    event.ids.rootRunId ? `root=${event.ids.rootRunId}` : undefined,
    event.ids.agentId ? `agent=${event.ids.agentId}` : undefined,
    event.ids.toolName ? `tool=${event.ids.toolName}` : undefined,
  ].filter(Boolean);
  return `- ${formatClockTime(event.entry.timestamp, timeZone)} ${event.label}${ids.length ? ` ${ids.join(' ')}` : ''}`;
}

function pushCounts(lines: string[], label: string, counts: CountItem[]): void {
  if (counts.length > 0) {
    lines.push(`- ${label}: ${formatCounts(counts)}.`);
  }
}

function formatCounts(counts: CountItem[]): string {
  return counts.map((item) => `${item.key} ${item.count}`).join(', ');
}

function formatWindow(start: string | undefined, end: string | undefined, timeZone: string | undefined): string {
  if (!start && !end) {
    return '(no timestamps)';
  }

  return `${formatDateTime(start, timeZone)} .. ${formatDateTime(end, timeZone)}`;
}

function formatDateTime(value: string | undefined, timeZone: string | undefined): string {
  if (!value) {
    return '?';
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.format(new Date(value));
}

export function formatClockTime(value: string | undefined, timeZone: string | undefined): string {
  if (!value) {
    return '??:??:??';
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.format(new Date(value));
}
