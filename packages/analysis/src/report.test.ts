import { describe, expect, it } from 'vitest'

import { normalizeParsedEvents } from './normalize.js'
import { buildAnalysisReport, buildRunDrillDownReport, formatOverviewReport } from './report.js'
import { reconstructRunGraph } from './runs.js'

describe('reporting', () => {
  it('prints run counts duration summary and top tools', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: {
          time: 1_000,
          event: 'run.created',
          runId: 'run-1',
          rootRunId: 'run-1',
          goal: 'Draft the initial implementation plan for run one.',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: {
          time: 1_100,
          event: 'tool.started',
          runId: 'run-1',
          rootRunId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: {
          time: 1_400,
          event: 'tool.completed',
          runId: 'run-1',
          rootRunId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
          durationMs: 300,
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 4,
        data: {
          time: 2_000,
          event: 'run.completed',
          runId: 'run-1',
          rootRunId: 'run-1',
          durationMs: 1000,
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            estimatedCostUSD: 0.12,
          },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 5,
        data: {
          time: 3_000,
          event: 'run.created',
          runId: 'run-2',
          rootRunId: 'run-2',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 6,
        data: {
          time: 3_050,
          event: 'tool.failed',
          runId: 'run-2',
          rootRunId: 'run-2',
          stepId: 'step-1',
          toolName: 'read_file',
          durationMs: 50,
          error: 'file missing',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 7,
        data: {
          time: 3_500,
          event: 'run.failed',
          runId: 'run-2',
          rootRunId: 'run-2',
          durationMs: 500,
          error: 'tool failed',
          code: 'TOOL_ERROR',
        },
      },
    ])

    const output = formatOverviewReport({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [],
      runGraph: reconstructRunGraph(events),
    })

    expect(output).toContain('Runs discovered: 2')
    expect(output).toContain('Successful runs: 1')
    expect(output).toContain('Failed runs: 1')
    expect(output).toContain('Duration summary: avg 750ms, min 500ms, max 1s')
    expect(output).toContain('Token usage: 15 total (prompt 10, completion 5), avg 15 per run')
    expect(output).toContain('Estimated cost: $0.12 total, avg $0.12 per run')
    expect(output).toContain('Run usage:')
    expect(output).toContain('run-1 - Draft the initial implementation plan for run one.')
    expect(output).toContain('Top tools:')
    expect(output).toContain('Tool statistics:')
    expect(output).toContain('read_file (kind=direct, count=1, success=0, failure=1, unknown=0, success-rate=0%, samples=1, avg-duration=50ms, min-duration=50ms, max-duration=50ms)')
    expect(output).toContain('- read_file: 1')
    expect(output).toContain('- write_file: 1')
    expect(output).toContain('Failure clusters:')

    const failedRunIndex = output.indexOf('run-2 (status=failed')
    const succeededRunIndex = output.indexOf('run-1 - Draft the initial implementation plan for run one. (status=succeeded')
    expect(failedRunIndex).toBeGreaterThan(-1)
    expect(succeededRunIndex).toBeGreaterThan(-1)
    expect(failedRunIndex).toBeLessThan(succeededRunIndex)
  })

  it('sorts failure clusters by subject and then by error', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: { time: 1_000, event: 'run.created', runId: 'run-1', rootRunId: 'run-1' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: {
          time: 1_100,
          event: 'tool.failed',
          runId: 'run-1',
          rootRunId: 'run-1',
          stepId: 'step-1',
          toolName: 'alpha_tool',
          error: 'boom',
          code: 'Z_ERROR',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: {
          time: 1_200,
          event: 'tool.failed',
          runId: 'run-1',
          rootRunId: 'run-1',
          stepId: 'step-2',
          toolName: 'alpha_tool',
          error: 'boom',
          code: 'A_ERROR',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 4,
        data: {
          time: 1_300,
          event: 'run.failed',
          runId: 'run-1',
          rootRunId: 'run-1',
          error: 'run failed',
          code: 'RUN_ERROR',
        },
      },
    ])

    const report = buildAnalysisReport({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [],
      runGraph: reconstructRunGraph(events),
    })

    expect(report.failures.clusters.map((cluster) => `${cluster.toolName ?? 'run'}:${cluster.errorName}`)).toEqual([
      'alpha_tool:A_ERROR',
      'alpha_tool:Z_ERROR',
      'run:RUN_ERROR',
    ])
  })

  it('builds analysis reports with failure clusters retry signals bottlenecks and structured run failures', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: { time: 1_000, event: 'run.created', runId: 'root', rootRunId: 'root' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: {
          time: 1_200,
          event: 'tool.started',
          runId: 'root',
          rootRunId: 'root',
          stepId: 'step-1',
          toolName: 'delegate.code-executor',
          childRunId: 'child',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: {
          time: 1_250,
          event: 'run.created',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          delegateName: 'code-executor',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 4,
        data: {
          time: 1_300,
          event: 'tool.started',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          stepId: 'step-1',
          toolName: 'e2b_run_code',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 5,
        data: {
          time: 1_800,
          event: 'tool.completed',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          stepId: 'step-1',
          toolName: 'e2b_run_code',
          durationMs: 500,
          output: {
            success: false,
            error: {
              name: 'ValueError',
              value: 'probabilities do not sum to 1',
            },
          },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 6,
        data: {
          time: 1_900,
          event: 'tool.started',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          stepId: 'step-2',
          toolName: 'e2b_run_code',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 7,
        data: {
          time: 2_600,
          event: 'tool.completed',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          stepId: 'step-2',
          toolName: 'e2b_run_code',
          durationMs: 700,
          output: {
            success: false,
            error: {
              name: 'ValueError',
              value: 'probabilities do not sum to 1',
            },
          },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 8,
        data: {
          time: 2_700,
          event: 'tool.started',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          stepId: 'step-3',
          toolName: 'e2b_run_code',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 9,
        data: {
          time: 3_300,
          event: 'tool.completed',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          stepId: 'step-3',
          toolName: 'e2b_run_code',
          durationMs: 600,
          output: { success: true },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 10,
        data: {
          time: 3_400,
          event: 'run.completed',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          durationMs: 2_150,
          output: { status: 'success' },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 11,
        data: {
          time: 3_500,
          event: 'tool.completed',
          runId: 'root',
          rootRunId: 'root',
          stepId: 'step-1',
          toolName: 'delegate.code-executor',
          childRunId: 'child',
          output: { status: 'success' },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 12,
        data: {
          time: 4_000,
          event: 'run.completed',
          runId: 'root',
          rootRunId: 'root',
          durationMs: 3_000,
          output: {
            status: 'failure',
            error: 'Budget exceeded',
            code: 'MAX_STEPS',
          },
        },
      },
    ])

    const report = buildAnalysisReport({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [{ input: 'missing.log', message: 'Path does not exist.' }],
      runGraph: reconstructRunGraph(events),
    })

    expect(Object.keys(report)).toEqual(['summary', 'runs', 'tools', 'failures', 'bottlenecks', 'diagnostics'])
    expect(report.summary).toMatchObject({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      runCount: 2,
      successCount: 1,
      failedCount: 1,
      unfinishedCount: 0,
    })
    expect(report.diagnostics).toEqual([
      {
        kind: 'discovery',
        input: 'missing.log',
        message: 'Path does not exist.',
      },
    ])
    expect(report.runs).toEqual([
      expect.objectContaining({ runId: 'child', status: 'succeeded', parentRunId: 'root' }),
      expect.objectContaining({ runId: 'root', status: 'failed', childRunIds: ['child'] }),
    ])
    expect(report.tools).toEqual([
      expect.objectContaining({
        toolName: 'e2b_run_code',
        invocationCount: 3,
        successCount: 1,
        failureCount: 2,
        successRate: 1 / 3,
        latencySampleCount: 3,
        averageDurationMs: 600,
        minimumDurationMs: 500,
        maximumDurationMs: 700,
      }),
      expect.objectContaining({
        toolName: 'delegate.code-executor',
        toolKind: 'delegate',
        invocationCount: 1,
        successCount: 1,
        failureCount: 0,
        latencySampleCount: 1,
        averageDurationMs: 2300,
      }),
    ])
    expect(report.failures.clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool',
          toolName: 'e2b_run_code',
          errorName: 'ValueError',
          errorValueSnippet: 'probabilities do not sum to 1',
          count: 2,
        }),
        expect.objectContaining({
          kind: 'run',
          errorName: 'MAX_STEPS',
          errorValueSnippet: 'Budget exceeded',
          count: 1,
        }),
      ]),
    )
    expect(report.failures.retrySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalType: 'tool',
          runId: 'child',
          toolName: 'e2b_run_code',
          attemptCount: 3,
          failureCount: 2,
          successCount: 1,
          outcome: 'recovered',
          latestErrorValueSnippet: 'probabilities do not sum to 1',
        }),
      ]),
    )
    expect(report.bottlenecks.slowestRuns[0]).toEqual(expect.objectContaining({ runId: 'root', durationMs: 3_000 }))
    expect(report.bottlenecks.slowestSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: 'root', stepId: 'step-1', durationMs: 2_300 }),
        expect.objectContaining({ runId: 'child', stepId: 'step-2', durationMs: 700 }),
      ]),
    )
    expect(report.bottlenecks.longestInterEventGaps[0]).toEqual(
      expect.objectContaining({ runId: 'root', fromEvent: 'tool.started', toEvent: 'tool.completed', gapMs: 2_300 }),
    )
    expect(report.bottlenecks.waitingTime).toMatchObject({
      delegationWaitMs: 2_300,
      totalEstimatedWaitMs: 2_300,
    })
  })

  it('threads goal text and usage into run reports and drill-down output', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: {
          time: 1_000,
          event: 'run.created',
          runId: 'root',
          rootRunId: 'root',
          goal: {
            type: 'string',
            preview: 'Coordinate the root workflow and delegate code generation.',
          },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: {
          time: 1_100,
          event: 'tool.started',
          runId: 'root',
          rootRunId: 'root',
          stepId: 'step-1',
          toolName: 'delegate.code-executor',
          childRunId: 'child',
          input: {
            type: 'object',
            preview: {
              goal: {
                type: 'string',
                preview: 'Generate the child implementation artifact.',
              },
            },
          },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: {
          time: 1_200,
          event: 'run.completed',
          runId: 'root',
          rootRunId: 'root',
          durationMs: 200,
          usage: {
            promptTokens: 20,
            completionTokens: 8,
            totalTokens: 28,
            estimatedCostUSD: 0.4,
            provider: 'openrouter',
            model: 'qwen',
          },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 4,
        data: {
          time: 1_300,
          event: 'run.completed',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          durationMs: 100,
          usage: {
            totalTokens: 12,
            estimatedCostUSD: 0.05,
          },
        },
      },
    ])

    const runGraph = reconstructRunGraph(events)
    const report = buildAnalysisReport({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [],
      runGraph,
    })
    const drillDown = buildRunDrillDownReport(runGraph, { mode: 'rootRunId', value: 'root' })

    expect(report.summary).toMatchObject({
      usageRunCount: 2,
      totalTokens: 40,
      estimatedCostUsd: 0.45,
    })
    expect(report.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: 'root',
          goalText: 'Coordinate the root workflow and delegate code generation.',
          totalTokens: 28,
          estimatedCostUsd: 0.4,
          provider: 'openrouter',
          model: 'qwen',
        }),
        expect.objectContaining({
          runId: 'child',
          goalText: 'Generate the child implementation artifact.',
          totalTokens: 12,
          estimatedCostUsd: 0.05,
        }),
      ]),
    )
    expect(drillDown?.run).toEqual(
      expect.objectContaining({
        runId: 'root',
        goalText: 'Coordinate the root workflow and delegate code generation.',
        totalTokens: 28,
      }),
    )
    expect(formatOverviewReport({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [],
      runGraph,
    })).toContain('child - Generate the child implementation artifact.')
  })

  it('builds a single-run drill-down with the focus timeline failure clusters and child relationships', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: { time: 1_000, event: 'run.created', runId: 'root', rootRunId: 'root' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: {
          time: 1_200,
          event: 'tool.started',
          runId: 'root',
          rootRunId: 'root',
          stepId: 'step-1',
          toolName: 'delegate.code-executor',
          childRunId: 'child',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: {
          time: 1_250,
          event: 'run.created',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 4,
        data: {
          time: 1_500,
          event: 'tool.completed',
          runId: 'child',
          rootRunId: 'root',
          parentRunId: 'root',
          stepId: 'step-1',
          toolName: 'e2b_run_code',
          output: {
            success: false,
            error: {
              name: 'ValueError',
              value: 'probabilities do not sum to 1',
            },
          },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 5,
        data: {
          time: 1_800,
          event: 'tool.completed',
          runId: 'root',
          rootRunId: 'root',
          stepId: 'step-1',
          toolName: 'delegate.code-executor',
          childRunId: 'child',
          output: { status: 'success' },
        },
      },
    ])

    const drillDown = buildRunDrillDownReport(reconstructRunGraph(events), { mode: 'rootRunId', value: 'root' })

    expect(drillDown).toBeDefined()
    expect(drillDown).toMatchObject({
      selection: {
        mode: 'rootRunId',
        requestedId: 'root',
        requestedVia: 'rootRunId=root',
        resolvedRunId: 'root',
      },
      run: {
        runId: 'root',
        childRunIds: ['child'],
      },
    })
    expect(drillDown?.relatedRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: 'root', childRunIds: ['child'] }),
        expect.objectContaining({ runId: 'child', parentRunId: 'root' }),
      ]),
    )
    expect(drillDown?.timeline.map((event) => event.event)).toEqual(['run.created', 'tool.started', 'tool.completed'])
    expect(drillDown?.timeline[1]).toMatchObject({
      sourceFile: '/tmp/events.log',
      line: 2,
      raw: {
        event: 'tool.started',
        runId: 'root',
        rootRunId: 'root',
        stepId: 'step-1',
        toolName: 'delegate.code-executor',
        childRunId: 'child',
      },
    })
    expect(drillDown?.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'e2b_run_code', count: 1 }),
      ]),
    )
  })
})
