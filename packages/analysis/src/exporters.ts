import type { AnalysisBundle, AnomalyFinding, CohortComparison, CohortReport, ExtendedRunReport } from './compare.js'
import type { FailureClusterReport, RetrySignalReport, RunDrillDownReport, RunDrillDownTimelineEvent } from './report.js'

export type ReportView = 'overview' | 'failures' | 'bottlenecks' | 'compare'
export type ReportOutputFormat =
  | 'terminal'
  | 'json'
  | 'markdown'
  | 'html'
  | 'csv:runs'
  | 'csv:tools'
  | 'csv:failures'
  | 'csv:cohorts'

export interface RenderedOutput {
  format: ReportOutputFormat
  content: string
  defaultFileName: string
}

const CSV_OUTPUT_FORMATS: ReportOutputFormat[] = ['csv:runs', 'csv:tools', 'csv:failures', 'csv:cohorts']

export function parseOutputFormats(specs: string[]): ReportOutputFormat[] {
  const formats: ReportOutputFormat[] = []

  for (const spec of specs) {
    for (const rawToken of spec.split(',')) {
      const token = rawToken.trim().toLowerCase()
      if (!token) {
        continue
      }

      if (token === 'terminal' || token === 'json' || token === 'markdown' || token === 'html') {
        pushUnique(formats, token)
        continue
      }

      if (token === 'md') {
        pushUnique(formats, 'markdown')
        continue
      }

      if (token === 'csv') {
        for (const csvFormat of CSV_OUTPUT_FORMATS) {
          pushUnique(formats, csvFormat)
        }
        continue
      }

      if (CSV_OUTPUT_FORMATS.includes(token as ReportOutputFormat)) {
        pushUnique(formats, token as ReportOutputFormat)
        continue
      }

      throw new Error(`Unsupported format: ${rawToken}.`)
    }
  }

  return formats
}

export function renderAnalysisOutputs(
  bundle: AnalysisBundle,
  options: { formats: ReportOutputFormat[]; view: ReportView; drillDownReport?: RunDrillDownReport },
): RenderedOutput[] {
  return options.formats.map((format) => ({
    format,
    content: options.drillDownReport
      ? renderDrillDownOutput(format, options.drillDownReport)
      : renderBundleOutput(format, bundle, options.view),
    defaultFileName: getDefaultOutputFileName(format),
  }))
}

export function getDefaultOutputFileName(format: ReportOutputFormat): string {
  switch (format) {
    case 'terminal':
      return 'analysis.txt'
    case 'json':
      return 'analysis.json'
    case 'markdown':
      return 'analysis.md'
    case 'html':
      return 'analysis.html'
    case 'csv:runs':
      return 'runs.csv'
    case 'csv:tools':
      return 'tools.csv'
    case 'csv:failures':
      return 'failures.csv'
    case 'csv:cohorts':
      return 'cohorts.csv'
  }
}

function renderBundleOutput(format: ReportOutputFormat, bundle: AnalysisBundle, view: ReportView): string {
  switch (format) {
    case 'terminal':
      return formatTerminalBundle(bundle, view)
    case 'json':
      return JSON.stringify(bundle, null, 2)
    case 'markdown':
      return formatMarkdownBundle(bundle, view)
    case 'html':
      return formatHtmlBundle(bundle, view)
    case 'csv:runs':
      return formatRunsCsv(bundle.runs)
    case 'csv:tools':
      return formatToolsCsv(bundle)
    case 'csv:failures':
      return formatFailuresCsv(bundle.failures.clusters)
    case 'csv:cohorts':
      return formatCohortsCsv(bundle.cohorts)
  }
}

function renderDrillDownOutput(format: ReportOutputFormat, report: RunDrillDownReport): string {
  switch (format) {
    case 'terminal':
      return formatDrillDownTerminal(report)
    case 'json':
      return JSON.stringify(report, null, 2)
    case 'markdown':
      return formatDrillDownMarkdown(report)
    case 'html':
      return formatDrillDownHtml(report)
    default:
      throw new Error(`Format ${format} is not supported for drill-down output.`)
  }
}

function formatTerminalBundle(bundle: AnalysisBundle, view: ReportView): string {
  const sortedRuns = sortRunsForDisplay(bundle.runs)
  const sortedTools = sortToolsForDisplay(bundle.tools)
  const lines = [
    'analysis analyze',
    '',
    `Inputs received: ${bundle.summary.inputCount}`,
    `Files matched: ${bundle.summary.fileCount}`,
    `Events parsed: ${bundle.summary.eventCount}`,
    `Malformed lines: ${bundle.summary.malformedLineCount}`,
    `Runs discovered: ${bundle.summary.runCount}`,
    `Successful runs: ${bundle.summary.successCount}`,
    `Failed runs: ${bundle.summary.failedCount}`,
  ]

  if (bundle.summary.unfinishedCount > 0) {
    lines.push(`Unfinished runs: ${bundle.summary.unfinishedCount}`)
  }

  lines.push(`Duration summary: ${formatDurationSummary(bundle)}`)
  lines.push(...formatUsageSummaryLines(bundle.summary))

  if (sortedRuns.length > 0) {
    lines.push('', 'Run usage:')
    for (const run of sortedRuns) {
      lines.push(`- ${formatRunUsageLine(run)}`)
    }
  }

  if (view !== 'compare' && bundle.summary.topTools.length > 0) {
    lines.push('', 'Top tools:')
    for (const tool of bundle.summary.topTools) {
      lines.push(`- ${tool.toolName}: ${tool.invocationCount}`)
    }
  }

  if (sortedTools.length > 0) {
    lines.push('', 'Tool statistics:')
    for (const tool of sortedTools) {
      lines.push(`- ${formatToolStatisticsLine(tool)}`)
    }
  }

  if (view === 'overview' || view === 'failures') {
    lines.push('', 'Failure clusters:')
    if (bundle.failures.clusters.length === 0) {
      lines.push('- none')
    } else {
      for (const cluster of bundle.failures.clusters.slice(0, 8)) {
        lines.push(`- ${formatFailureCluster(cluster)}`)
      }
    }

    lines.push('', 'Retry signals:')
    if (bundle.failures.retrySignals.length === 0) {
      lines.push('- none')
    } else {
      for (const signal of bundle.failures.retrySignals.slice(0, 8)) {
        lines.push(`- ${formatRetrySignal(signal)}`)
      }
    }
  }

  if (view === 'overview' || view === 'bottlenecks') {
    lines.push('', 'Bottlenecks:')
    const bottlenecks = bundle.bottlenecks
    if (
      bottlenecks.slowestRuns.length === 0 &&
      bottlenecks.slowestSteps.length === 0 &&
      bottlenecks.longestInterEventGaps.length === 0 &&
      bottlenecks.waitingTime.totalEstimatedWaitMs === 0
    ) {
      lines.push('- none')
    } else {
      const slowestRun = bottlenecks.slowestRuns[0]
      if (slowestRun?.durationMs !== undefined) {
        lines.push(`- Slowest run: ${formatRunReference(slowestRun)} (${formatDuration(slowestRun.durationMs)})`)
      }
      const slowestStep = bottlenecks.slowestSteps[0]
      if (slowestStep) {
        lines.push(`- Slowest step: ${formatRunReference(slowestStep)}/${slowestStep.stepId} (${formatDuration(slowestStep.durationMs)})`)
      }
      const longestGap = bottlenecks.longestInterEventGaps[0]
      if (longestGap) {
        lines.push(
          `- Longest gap: ${formatRunReference(longestGap)} ${longestGap.fromEvent} -> ${longestGap.toEvent} (${formatDuration(longestGap.gapMs)})`,
        )
      }
      if (bottlenecks.waitingTime.totalEstimatedWaitMs > 0) {
        lines.push(
          `- Estimated waiting: ${formatDuration(bottlenecks.waitingTime.totalEstimatedWaitMs)} total (${formatDuration(
            bottlenecks.waitingTime.delegationWaitMs,
          )} delegation, ${formatDuration(bottlenecks.waitingTime.statusWaitMs)} status)`,
        )
      }
    }
  }

  if (view === 'overview' || view === 'compare') {
    lines.push('', 'Cohorts:')
    if (bundle.cohorts.length === 0) {
      lines.push('- none')
    } else {
      for (const cohort of bundle.cohorts.slice(0, 8)) {
        lines.push(`- ${formatCohortLine(cohort)}`)
      }
    }

    lines.push('', 'Anomalies:')
    if (bundle.anomalies.length === 0) {
      lines.push('- none')
    } else {
      for (const anomaly of bundle.anomalies.slice(0, 8)) {
        lines.push(`- [${anomaly.severity}] ${anomaly.message}`)
      }
    }
  }

  if (bundle.summary.unassignedEventCount > 0) {
    lines.push('', `Unassigned events: ${bundle.summary.unassignedEventCount}`)
  }

  if (bundle.diagnostics.length > 0) {
    lines.push('', 'Diagnostics:')
    for (const diagnostic of bundle.diagnostics) {
      lines.push(`- ${formatDiagnostic(diagnostic)}`)
    }
  }

  return lines.join('\n')
}

function formatMarkdownBundle(bundle: AnalysisBundle, view: ReportView): string {
  const sortedRuns = sortRunsForDisplay(bundle.runs)
  const sortedTools = sortToolsForDisplay(bundle.tools)
  const lines = ['# Analysis Report', '']

  lines.push('## Summary', '')
  lines.push(`- Inputs received: ${bundle.summary.inputCount}`)
  lines.push(`- Files matched: ${bundle.summary.fileCount}`)
  lines.push(`- Events parsed: ${bundle.summary.eventCount}`)
  lines.push(`- Malformed lines: ${bundle.summary.malformedLineCount}`)
  lines.push(`- Runs discovered: ${bundle.summary.runCount}`)
  lines.push(`- Successful runs: ${bundle.summary.successCount}`)
  lines.push(`- Failed runs: ${bundle.summary.failedCount}`)
  if (bundle.summary.unfinishedCount > 0) {
    lines.push(`- Unfinished runs: ${bundle.summary.unfinishedCount}`)
  }
  lines.push(`- Duration summary: ${formatDurationSummary(bundle)}`)
  for (const line of formatUsageSummaryLines(bundle.summary)) {
    lines.push(`- ${line}`)
  }
  lines.push('')

  if (sortedRuns.length > 0) {
    lines.push('## Run Usage', '')
    lines.push('| Run | Status | Tokens | Cost | Duration |', '| --- | --- | ---: | ---: | --- |')
    for (const run of sortedRuns) {
      lines.push(
        `| ${escapeMarkdown(formatRunReference(run))} | ${run.status} | ${formatNumberOrUnavailable(run.totalTokens)} | ${formatUsdOrUnavailable(
          run.estimatedCostUsd,
        )} | ${formatDurationOrUnavailable(run.durationMs)} |`,
      )
    }
    lines.push('')
  }

  if (sortedTools.length > 0) {
    lines.push('## Tool Statistics', '')
    lines.push(
      '| Tool | Kind | Invocations | Success | Failure | Unknown | Success Rate | Samples | Avg Duration | Min Duration | Max Duration |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |',
    )
    for (const tool of sortedTools) {
      lines.push(
        `| ${escapeMarkdown(tool.toolName)} | ${tool.toolKind} | ${tool.invocationCount} | ${tool.successCount} | ${tool.failureCount} | ${tool.unknownCount} | ${formatPercentOrUnavailable(
          tool.successRate,
        )} | ${tool.latencySampleCount} | ${formatDurationOrUnavailable(tool.averageDurationMs)} | ${formatDurationOrUnavailable(
          tool.minimumDurationMs,
        )} | ${formatDurationOrUnavailable(tool.maximumDurationMs)} |`,
      )
    }
    lines.push('')
  }

  if ((view === 'overview' || view === 'failures') && bundle.failures.clusters.length > 0) {
    lines.push('## Failure Clusters', '')
    lines.push('| Kind | Subject | Count | Error | Snippet |', '| --- | --- | ---: | --- | --- |')
    for (const cluster of bundle.failures.clusters) {
      lines.push(
        `| ${cluster.kind} | ${cluster.toolName ?? 'run'} | ${cluster.count} | ${escapeMarkdown(cluster.errorName)} | ${escapeMarkdown(
          cluster.errorValueSnippet,
        )} |`,
      )
    }
    lines.push('')
  }

  if ((view === 'overview' || view === 'bottlenecks') && bundle.bottlenecks.slowestRuns.length > 0) {
    lines.push('## Bottlenecks', '')
    lines.push('| Type | Subject | Detail |', '| --- | --- | --- |')
    const slowestRun = bundle.bottlenecks.slowestRuns[0]
    lines.push(`| Slowest run | ${escapeMarkdown(formatRunReference(slowestRun))} | ${formatDurationOrUnavailable(slowestRun.durationMs)} |`)
    const slowestStep = bundle.bottlenecks.slowestSteps[0]
    if (slowestStep) {
      lines.push(`| Slowest step | ${escapeMarkdown(`${formatRunReference(slowestStep)}/${slowestStep.stepId}`)} | ${formatDuration(slowestStep.durationMs)} |`)
    }
    const longestGap = bundle.bottlenecks.longestInterEventGaps[0]
    if (longestGap) {
      lines.push(
        `| Longest gap | ${escapeMarkdown(formatRunReference(longestGap))} | ${escapeMarkdown(`${longestGap.fromEvent} -> ${longestGap.toEvent} (${formatDuration(longestGap.gapMs)})`)} |`,
      )
    }
    lines.push('')
  }

  if (view === 'overview' || view === 'compare') {
    lines.push('## Cohorts', '')
    lines.push(
      '| Provider | Model | Delegate | Window Start | Runs | Success Rate | Avg Duration | Avg Tokens | Avg Tools |',
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    )
    for (const cohort of bundle.cohorts) {
      lines.push(
        `| ${escapeMarkdown(cohort.provider)} | ${escapeMarkdown(cohort.model)} | ${escapeMarkdown(
          cohort.delegateName,
        )} | ${cohort.timeWindowStart ?? 'unknown'} | ${cohort.runCount} | ${formatPercentOrUnavailable(
          cohort.successRate,
        )} | ${formatNumberOrUnavailable(cohort.averageDurationMs)} | ${formatNumberOrUnavailable(
          cohort.averageTotalTokens,
        )} | ${formatNumberOrUnavailable(cohort.averageToolInvocationCount)} |`,
      )
    }
    lines.push('')

    lines.push('## Anomalies', '')
    if (bundle.anomalies.length === 0) {
      lines.push('No anomalies detected.', '')
    } else {
      for (const anomaly of bundle.anomalies) {
        lines.push(`- **${anomaly.severity}**: ${escapeMarkdown(anomaly.message)}`)
      }
      lines.push('')
    }
  }

  if (bundle.diagnostics.length > 0) {
    lines.push('## Diagnostics', '')
    for (const diagnostic of bundle.diagnostics) {
      lines.push(`- ${escapeMarkdown(formatDiagnostic(diagnostic))}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function formatHtmlBundle(bundle: AnalysisBundle, view: ReportView): string {
  const sortedRuns = sortRunsForDisplay(bundle.runs)
  const sortedTools = sortToolsForDisplay(bundle.tools)
  const sections = [
    {
      title: 'Summary',
      content: `<ul>${[
      `Inputs received: ${bundle.summary.inputCount}`,
      `Files matched: ${bundle.summary.fileCount}`,
      `Events parsed: ${bundle.summary.eventCount}`,
      `Malformed lines: ${bundle.summary.malformedLineCount}`,
      `Runs discovered: ${bundle.summary.runCount}`,
      `Successful runs: ${bundle.summary.successCount}`,
      `Failed runs: ${bundle.summary.failedCount}`,
      `Duration summary: ${formatDurationSummary(bundle)}`,
      ...formatUsageSummaryLines(bundle.summary),
    ]
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('')}</ul>`,
    },
  ]

  if (sortedRuns.length > 0) {
    sections.push({
      title: 'Run Usage',
      content: renderHtmlTable(
        ['Run', 'Status', 'Tokens', 'Cost', 'Duration'],
        sortedRuns.map((run) => [
          formatRunReference(run),
          run.status,
          formatNumberOrUnavailable(run.totalTokens),
          formatUsdOrUnavailable(run.estimatedCostUsd),
          formatDurationOrUnavailable(run.durationMs),
        ]),
      ),
    })
  }

  if (sortedTools.length > 0) {
    sections.push({
      title: 'Tool Statistics',
      content: renderHtmlTable(
        ['Tool', 'Kind', 'Invocations', 'Success', 'Failure', 'Unknown', 'Success Rate', 'Samples', 'Avg Duration', 'Min Duration', 'Max Duration'],
        sortedTools.map((tool) => [
          tool.toolName,
          tool.toolKind,
          String(tool.invocationCount),
          String(tool.successCount),
          String(tool.failureCount),
          String(tool.unknownCount),
          formatPercentOrUnavailable(tool.successRate),
          String(tool.latencySampleCount),
          formatDurationOrUnavailable(tool.averageDurationMs),
          formatDurationOrUnavailable(tool.minimumDurationMs),
          formatDurationOrUnavailable(tool.maximumDurationMs),
        ]),
      ),
    })
  }

  if (view === 'overview' || view === 'failures') {
    sections.push({
      title: 'Failure Clusters',
      content: renderHtmlTable(
        ['Kind', 'Subject', 'Count', 'Error', 'Snippet'],
        bundle.failures.clusters.map((cluster) => [
          cluster.kind,
          cluster.toolName ?? 'run',
          String(cluster.count),
          cluster.errorName,
          cluster.errorValueSnippet,
        ]),
      ),
    })
  }

  if (view === 'overview' || view === 'bottlenecks') {
    sections.push({
      title: 'Bottlenecks',
      content: renderHtmlTable(
        ['Type', 'Subject', 'Detail'],
        [
          bundle.bottlenecks.slowestRuns[0]
            ? ['Slowest run', formatRunReference(bundle.bottlenecks.slowestRuns[0]), formatDurationOrUnavailable(bundle.bottlenecks.slowestRuns[0].durationMs)]
            : undefined,
          bundle.bottlenecks.slowestSteps[0]
            ? [
                'Slowest step',
                `${formatRunReference(bundle.bottlenecks.slowestSteps[0])}/${bundle.bottlenecks.slowestSteps[0].stepId}`,
                formatDuration(bundle.bottlenecks.slowestSteps[0].durationMs),
              ]
            : undefined,
          bundle.bottlenecks.longestInterEventGaps[0]
            ? [
                'Longest gap',
                formatRunReference(bundle.bottlenecks.longestInterEventGaps[0]),
                `${bundle.bottlenecks.longestInterEventGaps[0].fromEvent} -> ${bundle.bottlenecks.longestInterEventGaps[0].toEvent} (${formatDuration(
                  bundle.bottlenecks.longestInterEventGaps[0].gapMs,
                )})`,
              ]
            : undefined,
        ].filter((row): row is string[] => row !== undefined),
      ),
    })
  }

  if (view === 'overview' || view === 'compare') {
    sections.push({
      title: 'Cohorts',
      content: renderHtmlTable(
        ['Provider', 'Model', 'Delegate', 'Window Start', 'Runs', 'Success Rate', 'Avg Duration', 'Avg Tokens', 'Avg Tools'],
        bundle.cohorts.map((cohort) => [
          cohort.provider,
          cohort.model,
          cohort.delegateName,
          cohort.timeWindowStart ?? 'unknown',
          String(cohort.runCount),
          formatPercentOrUnavailable(cohort.successRate),
          formatNumberOrUnavailable(cohort.averageDurationMs),
          formatNumberOrUnavailable(cohort.averageTotalTokens),
          formatNumberOrUnavailable(cohort.averageToolInvocationCount),
        ]),
      ),
    })

    sections.push({
      title: 'Anomalies',
      content:
        bundle.anomalies.length === 0
          ? '<p>No anomalies detected.</p>'
          : `<ul>${bundle.anomalies.map((anomaly) => `<li><strong>${escapeHtml(anomaly.severity)}</strong>: ${escapeHtml(anomaly.message)}</li>`).join('')}</ul>`,
    })
  }

  if (bundle.diagnostics.length > 0) {
    sections.push({
      title: 'Diagnostics',
      content: `<ul>${bundle.diagnostics.map((diagnostic) => `<li>${escapeHtml(formatDiagnostic(diagnostic))}</li>`).join('')}</ul>`,
    })
  }

  const accordionSections = sections.map((section, index) => renderHtmlAccordionSection(section.title, section.content, index === 0))

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>Analysis Report</title>',
    '  <style>',
    '    :root { color-scheme: light; --report-bg: #f7f7f2; --panel-bg: #ffffff; --panel-border: #bfd3d9; --panel-shadow: rgba(11, 60, 73, 0.08); --heading: #0b3c49; --text: #14213d; --accent: #d9ead3; --summary-bg: linear-gradient(135deg, #eef7f0 0%, #edf3f8 100%); }',
    '    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: var(--text); background: var(--report-bg); }',
    '    h1 { color: var(--heading); margin-bottom: 20px; }',
    '    table { border-collapse: collapse; width: 100%; margin: 0; }',
    '    th, td { border: 1px solid #cfd8dc; padding: 8px 10px; text-align: left; vertical-align: top; }',
    '    th { background: var(--accent); }',
    '    ul { padding-left: 20px; margin: 0; }',
    '    p { margin: 0; }',
    '    .report-accordion { display: grid; gap: 16px; }',
    '    .report-section { border: 1px solid var(--panel-border); border-radius: 14px; background: var(--panel-bg); box-shadow: 0 10px 28px var(--panel-shadow); overflow: hidden; }',
    '    .report-section > summary { cursor: pointer; list-style: none; padding: 16px 20px; font-weight: 700; color: var(--heading); background: var(--summary-bg); }',
    '    .report-section > summary::-webkit-details-marker { display: none; }',
    '    .report-section > summary::after { content: "+"; float: right; font-size: 20px; line-height: 1; }',
    '    .report-section[open] > summary::after { content: "-"; }',
    '    .report-section-body { padding: 18px 20px 20px; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <h1>Analysis Report</h1>',
    '  <div class="report-accordion">',
    ...accordionSections.map((section) => `    ${section}`),
    '  </div>',
    '  <script>',
    '    for (const section of document.querySelectorAll(".report-accordion .report-section")) {',
    '      section.addEventListener("toggle", () => {',
    '        if (!section.open) {',
    '          return;',
    '        }',
    '        for (const sibling of document.querySelectorAll(".report-accordion .report-section")) {',
    '          if (sibling !== section) {',
    '            sibling.open = false;',
    '          }',
    '        }',
    '      });',
    '    }',
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n')
}

function renderHtmlAccordionSection(title: string, content: string, open: boolean): string {
  return `<details class="report-section"${open ? ' open' : ''}><summary>${escapeHtml(title)}</summary><div class="report-section-body">${content}</div></details>`
}

function formatRunsCsv(runs: ExtendedRunReport[]): string {
  return toCsv(
    [
      'runId',
      'rootRunId',
      'goalText',
      'parentRunId',
      'delegateName',
      'status',
      'eventCount',
      'startTime',
      'endTime',
      'durationMs',
      'provider',
      'model',
      'promptTokens',
      'completionTokens',
      'reasoningTokens',
      'totalTokens',
      'estimatedCostUsd',
      'toolInvocationCount',
      'childRunIds',
    ],
    runs.map((run) => [
      run.runId,
      run.rootRunId,
      run.goalText ?? '',
      run.parentRunId ?? '',
      run.delegateName ?? '',
      run.status,
      String(run.eventCount),
      run.startTime ?? '',
      run.endTime ?? '',
      numberField(run.durationMs),
      run.provider,
      run.model,
      numberField(run.promptTokens),
      numberField(run.completionTokens),
      numberField(run.reasoningTokens),
      numberField(run.totalTokens),
      numberField(run.estimatedCostUsd),
      String(run.toolInvocationCount),
      run.childRunIds.join('|'),
    ]),
  )
}

function formatToolsCsv(bundle: AnalysisBundle): string {
  return toCsv(
    [
      'toolName',
      'toolKind',
      'invocationCount',
      'successCount',
      'failureCount',
      'unknownCount',
      'successRate',
      'latencySampleCount',
      'averageDurationMs',
      'minimumDurationMs',
      'maximumDurationMs',
    ],
    sortToolsForDisplay(bundle.tools).map((tool) => [
      tool.toolName,
      tool.toolKind,
      String(tool.invocationCount),
      String(tool.successCount),
      String(tool.failureCount),
      String(tool.unknownCount),
      numberField(tool.successRate),
      String(tool.latencySampleCount),
      numberField(tool.averageDurationMs),
      numberField(tool.minimumDurationMs),
      numberField(tool.maximumDurationMs),
    ]),
  )
}

function formatFailuresCsv(clusters: FailureClusterReport[]): string {
  return toCsv(
    [
      'kind',
      'toolName',
      'errorName',
      'errorValueSnippet',
      'count',
      'runIds',
      'rootRunIds',
      'latestTime',
      'exampleRunId',
      'exampleStepId',
      'exampleChildRunId',
      'exampleSourceFile',
      'exampleLine',
    ],
    clusters.map((cluster) => [
      cluster.kind,
      cluster.toolName ?? '',
      cluster.errorName,
      cluster.errorValueSnippet,
      String(cluster.count),
      cluster.runIds.join('|'),
      cluster.rootRunIds.join('|'),
      cluster.latestTime ?? '',
      cluster.example.runId,
      cluster.example.stepId ?? '',
      cluster.example.childRunId ?? '',
      cluster.example.sourceFile,
      String(cluster.example.line),
    ]),
  )
}

function formatCohortsCsv(cohorts: CohortReport[]): string {
  return toCsv(
    [
      'cohortId',
      'provider',
      'model',
      'delegateName',
      'timeWindow',
      'timeWindowStart',
      'timeWindowEnd',
      'runCount',
      'successCount',
      'failureCount',
      'successRate',
      'averageDurationMs',
      'totalTokens',
      'averageTotalTokens',
      'averageToolInvocationCount',
      'overallDurationDeltaRatio',
      'overallSuccessRateDelta',
      'overallTokenDeltaRatio',
      'overallToolDeltaRatio',
      'previousWindowDurationDeltaRatio',
      'previousWindowSuccessRateDelta',
      'previousWindowTokenDeltaRatio',
      'previousWindowToolDeltaRatio',
    ],
    cohorts.map((cohort) => {
      const overall = findComparison(cohort, 'overall')
      const previousWindow = findComparison(cohort, 'previous_window')

      return [
        cohort.cohortId,
        cohort.provider,
        cohort.model,
        cohort.delegateName,
        cohort.timeWindow,
        cohort.timeWindowStart ?? '',
        cohort.timeWindowEnd ?? '',
        String(cohort.runCount),
        String(cohort.successCount),
        String(cohort.failureCount),
        numberField(cohort.successRate),
        numberField(cohort.averageDurationMs),
        numberField(cohort.totalTokens),
        numberField(cohort.averageTotalTokens),
        numberField(cohort.averageToolInvocationCount),
        numberField(overall?.averageDurationMsDeltaRatio),
        numberField(overall?.successRateDelta),
        numberField(overall?.averageTotalTokensDeltaRatio),
        numberField(overall?.averageToolInvocationCountDeltaRatio),
        numberField(previousWindow?.averageDurationMsDeltaRatio),
        numberField(previousWindow?.successRateDelta),
        numberField(previousWindow?.averageTotalTokensDeltaRatio),
        numberField(previousWindow?.averageToolInvocationCountDeltaRatio),
      ]
    }),
  )
}

function formatDrillDownTerminal(report: RunDrillDownReport): string {
  const rootRun = report.relatedRuns.find((run) => run.runId === report.run.rootRunId) ?? report.run
  const lines = [
    'analysis analyze',
    '',
    `Selected run: ${formatRunReference(report.run)}`,
    `Requested via: ${report.selection.requestedVia}`,
    `Root run: ${formatRunReference(rootRun)}`,
    `Status: ${report.run.status}`,
    `Duration: ${formatDurationOrUnavailable(report.run.durationMs)}`,
    '',
    'Timeline:',
  ]

  if (report.run.provider || report.run.model) {
    lines.splice(7, 0, `Model: ${[report.run.provider, report.run.model].filter(Boolean).join('/')}`)
  }
  const tokenUsage = formatDrillDownTokenUsage(report.run)
  if (tokenUsage) {
    lines.splice(lines.length - 2, 0, `Token usage: ${tokenUsage}`)
  }
  if (report.run.estimatedCostUsd !== undefined) {
    lines.splice(lines.length - 2, 0, `Estimated cost: ${formatUsdOrUnavailable(report.run.estimatedCostUsd)}`)
  }

  for (const event of report.timeline) {
    lines.push(`- ${formatTimelineEvent(event)}`)
  }

  lines.push('', 'Failures:')
  if (report.failures.length === 0) {
    lines.push('- none')
  } else {
    for (const cluster of report.failures) {
      lines.push(`- ${formatFailureCluster(cluster)}`)
    }
  }

  return lines.join('\n')
}

function formatDrillDownMarkdown(report: RunDrillDownReport): string {
  const rootRun = report.relatedRuns.find((run) => run.runId === report.run.rootRunId) ?? report.run
  const tokenUsage = formatDrillDownTokenUsage(report.run)
  return [
    '# Run Drill-Down',
    '',
    `- Selected run: ${formatRunReference(report.run)}`,
    `- Requested via: ${report.selection.requestedVia}`,
    `- Root run: ${formatRunReference(rootRun)}`,
    `- Status: ${report.run.status}`,
    `- Duration: ${formatDurationOrUnavailable(report.run.durationMs)}`,
    ...(report.run.provider || report.run.model ? [`- Model: ${[report.run.provider, report.run.model].filter(Boolean).join('/')}`] : []),
    ...(tokenUsage ? [`- Token usage: ${tokenUsage}`] : []),
    ...(report.run.estimatedCostUsd !== undefined ? [`- Estimated cost: ${formatUsdOrUnavailable(report.run.estimatedCostUsd)}`] : []),
    '',
    '## Timeline',
    '',
    ...report.timeline.map((event) => `- ${escapeMarkdown(formatTimelineEvent(event))}`),
    '',
    '## Failures',
    '',
    ...(report.failures.length === 0 ? ['- none'] : report.failures.map((cluster) => `- ${escapeMarkdown(formatFailureCluster(cluster))}`)),
  ].join('\n')
}

function formatDrillDownHtml(report: RunDrillDownReport): string {
  const rootRun = report.relatedRuns.find((run) => run.runId === report.run.rootRunId) ?? report.run
  const tokenUsage = formatDrillDownTokenUsage(report.run)
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>Run Drill-Down</title>',
    '  <style>',
    '    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #14213d; background: #f7f7f2; }',
    '    h1, h2 { color: #0b3c49; }',
    '    .timeline-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }',
    '    .timeline-event { border: 1px solid #cfd8dc; border-radius: 10px; background: #ffffff; overflow: hidden; }',
    '    .timeline-event summary { cursor: pointer; padding: 12px 14px; font-family: ui-monospace, SFMono-Regular, monospace; }',
    '    .timeline-event summary:hover { background: #eef7f0; }',
    '    .timeline-event pre { margin: 0; padding: 14px; overflow-x: auto; background: #f3f6f8; border-top: 1px solid #d9e2e8; }',
    '    .timeline-source { margin: 0 0 6px; color: #52606d; font-size: 0.9rem; }',
    '    ul { padding-left: 20px; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <h1>Run Drill-Down</h1>',
    `  <p><strong>Selected run:</strong> ${escapeHtml(formatRunReference(report.run))}</p>`,
    `  <p><strong>Requested via:</strong> ${escapeHtml(report.selection.requestedVia)}</p>`,
    `  <p><strong>Root run:</strong> ${escapeHtml(formatRunReference(rootRun))}</p>`,
    `  <p><strong>Status:</strong> ${escapeHtml(report.run.status)}</p>`,
    ...(report.run.provider || report.run.model
      ? [`  <p><strong>Model:</strong> ${escapeHtml([report.run.provider, report.run.model].filter(Boolean).join('/'))}</p>`]
      : []),
    ...(tokenUsage ? [`  <p><strong>Token usage:</strong> ${escapeHtml(tokenUsage)}</p>`] : []),
    ...(report.run.estimatedCostUsd !== undefined
      ? [`  <p><strong>Estimated cost:</strong> ${escapeHtml(formatUsdOrUnavailable(report.run.estimatedCostUsd))}</p>`]
      : []),
    '  <h2>Timeline</h2>',
    '  <ul class="timeline-list">',
    ...report.timeline.map((event) => `    <li>${renderDrillDownTimelineItem(event)}</li>`),
    '  </ul>',
    '  <h2>Failures</h2>',
    report.failures.length === 0
      ? '  <p>none</p>'
      : `  <ul>${report.failures.map((cluster) => `<li>${escapeHtml(formatFailureCluster(cluster))}</li>`).join('')}</ul>`,
    '</body>',
    '</html>',
  ].join('\n')
}

function formatCohortLine(cohort: CohortReport): string {
  return [
    `${cohort.provider}/${cohort.model}`,
    `delegate=${cohort.delegateName}`,
    `window=${cohort.timeWindowStart ?? 'unknown'}`,
    `runs=${cohort.runCount}`,
    `success=${formatPercentOrUnavailable(cohort.successRate)}`,
    `avg-duration=${formatNumberOrUnavailable(cohort.averageDurationMs)}ms`,
    `avg-tokens=${formatNumberOrUnavailable(cohort.averageTotalTokens)}`,
    `avg-tools=${formatNumberOrUnavailable(cohort.averageToolInvocationCount)}`,
  ].join(', ')
}

function formatFailureCluster(cluster: FailureClusterReport): string {
  const subject = cluster.kind === 'tool' ? cluster.toolName ?? 'unknown tool' : 'run'
  return `${subject} x${cluster.count}: ${cluster.errorName} (${cluster.errorValueSnippet})`
}

function formatRetrySignal(signal: RetrySignalReport): string {
  const base =
    signal.signalType === 'step' && signal.stepId
      ? `${formatRunReference(signal)} ${signal.toolName} retried ${signal.attemptCount} times in ${signal.stepId}`
      : `${formatRunReference(signal)} ${signal.toolName} retried ${signal.attemptCount} times`

  const details = [`${signal.failureCount} failures`, `outcome=${signal.outcome}`]
  if (signal.latestErrorValueSnippet) {
    details.push(`latest=${signal.latestErrorValueSnippet}`)
  }

  return `${base} (${details.join(', ')})`
}

function formatTimelineEvent(event: RunDrillDownTimelineEvent): string {
  const parts = [event.time ?? 'unknown-time', event.event]

  if (event.stepId) {
    parts.push(`step=${event.stepId}`)
  }
  if (event.toolName) {
    parts.push(`tool=${event.toolName}`)
  }
  if (event.delegateName) {
    parts.push(`delegate=${event.delegateName}`)
  }
  if (event.childRunId) {
    parts.push(`child=${event.childRunId}`)
  }
  if (event.outcome) {
    parts.push(`outcome=${event.outcome}`)
  }
  if (event.durationMs !== undefined) {
    parts.push(`duration=${formatDuration(event.durationMs)}`)
  }
  if (event.errorName || event.errorValue) {
    parts.push(`error=${[event.errorName, event.errorValue].filter(Boolean).join(': ')}`)
  }

  return parts.join(' | ')
}

function formatDrillDownTokenUsage(run: {
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}): string | undefined {
  const details = [
    run.promptTokens !== undefined ? `input ${formatNumberOrUnavailable(run.promptTokens)}` : undefined,
    run.completionTokens !== undefined ? `completion ${formatNumberOrUnavailable(run.completionTokens)}` : undefined,
    run.reasoningTokens !== undefined ? `reasoning ${formatNumberOrUnavailable(run.reasoningTokens)}` : undefined,
  ].filter((value): value is string => value !== undefined)

  if (run.totalTokens === undefined && details.length === 0) {
    return undefined
  }

  if (run.totalTokens === undefined) {
    return details.join(', ')
  }

  return details.length > 0 ? `${formatNumberOrUnavailable(run.totalTokens)} total (${details.join(', ')})` : formatNumberOrUnavailable(run.totalTokens)
}

function renderDrillDownTimelineItem(event: RunDrillDownTimelineEvent): string {
  return [
    '<details class="timeline-event">',
    `  <summary>${escapeHtml(formatTimelineEvent(event))}</summary>`,
    `  <p class="timeline-source">${escapeHtml(`${event.sourceFile}:${event.line}`)}</p>`,
    `  <pre>${escapeHtml(JSON.stringify(event.raw, null, 2))}</pre>`,
    '</details>',
  ].join('')
}

function findComparison(
  cohort: CohortReport,
  baselineKind: CohortComparison['baselineKind'],
): CohortComparison | undefined {
  return cohort.comparisons.find((comparison) => comparison.baselineKind === baselineKind)
}

function renderHtmlTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return '<p>none</p>'
  }

  return [
    '<table>',
    `  <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>`,
    `  <tbody>${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('')}</tbody>`,
    '</table>',
  ].join('\n')
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(','))
    .join('\n')
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }

  return value
}

function pushUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) {
    values.push(value)
  }
}

function sortRunsForDisplay(runs: ExtendedRunReport[]): ExtendedRunReport[] {
  return [...runs].sort((left, right) => {
    const statusComparison = left.status.localeCompare(right.status)
    if (statusComparison !== 0) {
      return statusComparison
    }

    const durationComparison = compareNumbersDescending(left.durationMs, right.durationMs, left.runId.localeCompare(right.runId))
    if (durationComparison !== 0) {
      return durationComparison
    }

    return left.runId.localeCompare(right.runId)
  })
}

function sortToolsForDisplay(tools: AnalysisBundle['tools']): AnalysisBundle['tools'] {
  return [...tools].sort((left, right) => left.toolName.localeCompare(right.toolName))
}

function formatRunReference(run: { runId: string; goalText?: string }): string {
  return run.goalText ? `${run.runId} - ${run.goalText}` : run.runId
}

function formatRunUsageLine(run: ExtendedRunReport): string {
  const details = [
    `status=${run.status}`,
    run.totalTokens !== undefined ? `tokens=${formatNumberOrUnavailable(run.totalTokens)}` : undefined,
    run.estimatedCostUsd !== undefined ? `cost=${formatUsdOrUnavailable(run.estimatedCostUsd)}` : undefined,
    run.durationMs !== undefined ? `duration=${formatDuration(run.durationMs)}` : undefined,
  ].filter((value): value is string => value !== undefined)

  return `${formatRunReference(run)} (${details.join(', ')})`
}

function formatToolStatisticsLine(tool: AnalysisBundle['tools'][number]): string {
  const details = [
    `kind=${tool.toolKind}`,
    `count=${tool.invocationCount}`,
    `success=${tool.successCount}`,
    `failure=${tool.failureCount}`,
    `unknown=${tool.unknownCount}`,
    `success-rate=${formatPercentOrUnavailable(tool.successRate)}`,
    `samples=${tool.latencySampleCount}`,
    `avg-duration=${formatDurationOrUnavailable(tool.averageDurationMs)}`,
    `min-duration=${formatDurationOrUnavailable(tool.minimumDurationMs)}`,
    `max-duration=${formatDurationOrUnavailable(tool.maximumDurationMs)}`,
  ]

  return `${tool.toolName} (${details.join(', ')})`
}

function formatUsageSummaryLines(summary: AnalysisBundle['summary']): string[] {
  if (summary.usageRunCount === 0) {
    return []
  }

  const tokenDetails = [
    summary.promptTokens !== undefined ? `prompt ${formatNumberOrUnavailable(summary.promptTokens)}` : undefined,
    summary.completionTokens !== undefined ? `completion ${formatNumberOrUnavailable(summary.completionTokens)}` : undefined,
    summary.reasoningTokens !== undefined ? `reasoning ${formatNumberOrUnavailable(summary.reasoningTokens)}` : undefined,
  ].filter((value): value is string => value !== undefined)

  const lines: string[] = []
  if (summary.totalTokens !== undefined) {
    const details = tokenDetails.length > 0 ? ` (${tokenDetails.join(', ')})` : ''
    const average = summary.averageTotalTokens !== undefined ? `, avg ${formatNumberOrUnavailable(summary.averageTotalTokens)} per run` : ''
    lines.push(`Token usage: ${formatNumberOrUnavailable(summary.totalTokens)} total${details}${average}`)
  }
  if (summary.estimatedCostUsd !== undefined) {
    const average = summary.averageEstimatedCostUsd !== undefined ? `, avg ${formatUsdOrUnavailable(summary.averageEstimatedCostUsd)} per run` : ''
    lines.push(`Estimated cost: ${formatUsdOrUnavailable(summary.estimatedCostUsd)} total${average}`)
  }

  return lines
}

function numberField(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

function formatDurationSummary(bundle: AnalysisBundle): string {
  if (
    bundle.summary.averageDurationMs === undefined ||
    bundle.summary.minimumDurationMs === undefined ||
    bundle.summary.maximumDurationMs === undefined
  ) {
    return 'unavailable'
  }

  return [
    `avg ${formatDuration(bundle.summary.averageDurationMs)}`,
    `min ${formatDuration(bundle.summary.minimumDurationMs)}`,
    `max ${formatDuration(bundle.summary.maximumDurationMs)}`,
  ].join(', ')
}

function formatDurationOrUnavailable(durationMs: number | undefined): string {
  return durationMs === undefined ? 'unavailable' : formatDuration(durationMs)
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }

  if (durationMs < 60_000) {
    return `${trimFixed(durationMs / 1000)}s`
  }

  return `${trimFixed(durationMs / 60_000)}m`
}

function formatPercentOrUnavailable(value: number | undefined): string {
  return value === undefined ? 'unavailable' : `${trimFixed(value * 100)}%`
}

function formatNumberOrUnavailable(value: number | undefined): string {
  return value === undefined ? 'unavailable' : trimFixed(value)
}

function formatUsdOrUnavailable(value: number | undefined): string {
  return value === undefined ? 'unavailable' : `$${value.toFixed(4).replace(/\.00+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}`
}

function trimFixed(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function formatDiagnostic(diagnostic: AnalysisBundle['diagnostics'][number]): string {
  if (diagnostic.kind === 'discovery') {
    return `${diagnostic.input}: ${diagnostic.message}`
  }

  if (diagnostic.line !== undefined) {
    return `${diagnostic.sourceFile}:${diagnostic.line}: ${diagnostic.message}`
  }

  return `${diagnostic.sourceFile}: ${diagnostic.message}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|')
}

function compareNumbersDescending(left: number | undefined, right: number | undefined, fallback: number): number {
  if (left === undefined && right === undefined) {
    return fallback
  }

  if (left === undefined) {
    return 1
  }

  if (right === undefined) {
    return -1
  }

  return right - left || fallback
}
