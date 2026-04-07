import { describe, expect, it } from 'vitest'

import { buildAnalysisBundle } from './compare.js'
import { parseOutputFormats, renderAnalysisOutputs } from './exporters.js'
import { normalizeParsedEvents } from './normalize.js'
import { buildRunDrillDownReport } from './report.js'
import { reconstructRunGraph } from './runs.js'

describe('exporters', () => {
  it('renders markdown html and csv outputs from the shared analysis bundle', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: {
          time: 1000,
          event: 'run.created',
          runId: 'run-1',
          rootRunId: 'run-1',
          provider: 'openrouter',
          model: 'qwen',
          goal: 'Produce the exporter regression report.',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: { time: 1100, event: 'tool.started', runId: 'run-1', rootRunId: 'run-1', stepId: 'step-1', toolName: 'write_file' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: { time: 1200, event: 'tool.completed', runId: 'run-1', rootRunId: 'run-1', stepId: 'step-1', toolName: 'write_file', durationMs: 100 },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 4,
        data: {
          time: 2000,
          event: 'run.completed',
          runId: 'run-1',
          rootRunId: 'run-1',
          durationMs: 1000,
          usage: { totalTokens: 42, estimatedCostUSD: 0.99, provider: 'openrouter', model: 'qwen' },
        },
      },
    ])

    const bundle = buildAnalysisBundle({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [],
      runGraph: reconstructRunGraph(events),
    })

    const outputs = renderAnalysisOutputs(bundle, {
      formats: parseOutputFormats(['markdown,html,csv:runs,csv:cohorts']),
      view: 'compare',
    })

    expect(outputs.find((output) => output.format === 'markdown')?.content).toContain('# Analysis Report')
    expect(outputs.find((output) => output.format === 'markdown')?.content).toContain('## Run Usage')
    expect(outputs.find((output) => output.format === 'markdown')?.content).toContain('## Tool Statistics')
    expect(outputs.find((output) => output.format === 'markdown')?.content).toContain('run-1 - Produce the exporter regression report.')
    expect(outputs.find((output) => output.format === 'markdown')?.content).toContain('| write_file | direct | 1 | 1 | 0 | 0 | 100% | 1 | 100ms | 100ms | 100ms |')
    expect(outputs.find((output) => output.format === 'markdown')?.content).toContain('Estimated cost: $0.99 total, avg $0.99 per run')
    expect(outputs.find((output) => output.format === 'markdown')?.content).toContain('## Cohorts')
    const html = outputs.find((output) => output.format === 'html')?.content ?? ''
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<div class="report-accordion">')
    expect(html).toContain('<details class="report-section" open><summary>Summary</summary>')
    expect(html).toContain('<summary>Tool Statistics</summary>')
    expect(html).toContain('document.querySelectorAll(".report-accordion .report-section")')
    expect(outputs.find((output) => output.format === 'csv:runs')?.content).toContain('runId,rootRunId,goalText,parentRunId')
    expect(outputs.find((output) => output.format === 'csv:cohorts')?.content).toContain('cohortId,provider,model')
  })

  it('sorts run usage by status then descending duration and keeps cohorts ordered by provider then model', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: { time: 1000, event: 'run.created', runId: 'run-slow-failed', rootRunId: 'run-slow-failed', provider: 'beta', model: 'zeta' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: { time: 2000, event: 'run.failed', runId: 'run-slow-failed', rootRunId: 'run-slow-failed', durationMs: 1000, error: 'failed' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: { time: 3000, event: 'run.created', runId: 'run-fast-failed', rootRunId: 'run-fast-failed', provider: 'alpha', model: 'omega' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 4,
        data: { time: 3300, event: 'run.failed', runId: 'run-fast-failed', rootRunId: 'run-fast-failed', durationMs: 300, error: 'failed' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 5,
        data: { time: 4000, event: 'run.created', runId: 'run-succeeded', rootRunId: 'run-succeeded', provider: 'alpha', model: 'beta' },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 6,
        data: { time: 4600, event: 'run.completed', runId: 'run-succeeded', rootRunId: 'run-succeeded', durationMs: 600, output: { status: 'success' } },
      },
    ])

    const bundle = buildAnalysisBundle({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [],
      runGraph: reconstructRunGraph(events),
    })

    const markdown = renderAnalysisOutputs(bundle, {
      formats: parseOutputFormats(['markdown']),
      view: 'compare',
    })[0]?.content ?? ''

    const slowFailedIndex = markdown.indexOf('run-slow-failed')
    const fastFailedIndex = markdown.indexOf('run-fast-failed')
    const succeededIndex = markdown.indexOf('run-succeeded')

    expect(slowFailedIndex).toBeGreaterThan(-1)
    expect(fastFailedIndex).toBeGreaterThan(-1)
    expect(succeededIndex).toBeGreaterThan(-1)
    expect(slowFailedIndex).toBeLessThan(fastFailedIndex)
    expect(fastFailedIndex).toBeLessThan(succeededIndex)

    const alphaBetaIndex = markdown.indexOf('| alpha | beta |')
    const alphaOmegaIndex = markdown.indexOf('| alpha | omega |')
    const betaZetaIndex = markdown.indexOf('| beta | zeta |')

    expect(alphaBetaIndex).toBeGreaterThan(-1)
    expect(alphaOmegaIndex).toBeGreaterThan(-1)
    expect(betaZetaIndex).toBeGreaterThan(-1)
    expect(alphaBetaIndex).toBeLessThan(alphaOmegaIndex)
    expect(alphaOmegaIndex).toBeLessThan(betaZetaIndex)
  })

  it('renders drill-down html with token breakdown and expandable raw timeline items', () => {
    const events = normalizeParsedEvents([
      {
        sourceFile: '/tmp/events.log',
        line: 1,
        data: {
          time: 1000,
          event: 'run.created',
          runId: 'run-1',
          rootRunId: 'run-1',
          provider: 'openrouter',
          model: 'qwen',
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 2,
        data: {
          time: 1100,
          event: 'tool.completed',
          runId: 'run-1',
          rootRunId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
          output: { status: 'success', path: '/tmp/report.md' },
        },
      },
      {
        sourceFile: '/tmp/events.log',
        line: 3,
        data: {
          time: 1300,
          event: 'run.completed',
          runId: 'run-1',
          rootRunId: 'run-1',
          durationMs: 300,
          usage: {
            promptTokens: 11,
            completionTokens: 7,
            totalTokens: 18,
          },
        },
      },
    ])

    const runGraph = reconstructRunGraph(events)
    const bundle = buildAnalysisBundle({
      inputCount: 1,
      fileCount: 1,
      eventCount: events.length,
      malformedLineCount: 0,
      diagnostics: [],
      runGraph,
    })
    const drillDownReport = buildRunDrillDownReport(runGraph, { mode: 'rootRunId', value: 'run-1', requestedVia: '--last' })

    expect(drillDownReport).toBeDefined()

    const outputs = renderAnalysisOutputs(bundle, {
      formats: parseOutputFormats(['html']),
      view: 'overview',
      drillDownReport,
    })

    const html = outputs[0]?.content ?? ''
    expect(html).toContain('<details class="timeline-event">')
    expect(html).toContain('<strong>Requested via:</strong> --last')
    expect(html).toContain('<strong>Token usage:</strong> 18 total (input 11, completion 7)')
    expect(html).toContain('&quot;time&quot;: 1100')
    expect(html).toContain('&quot;path&quot;: &quot;/tmp/report.md&quot;')
    expect(html).toContain('/tmp/events.log:2')
  })
})
