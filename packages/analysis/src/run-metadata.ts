import type { NormalizedLogEvent } from './normalize.js'

export interface UsageSummary {
  provider?: string
  model?: string
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  estimatedCostUsd?: number
}

const GOAL_TEXT_MAX_LENGTH = 160

export function resolveUsageSummary(timeline: NormalizedLogEvent[]): UsageSummary {
  const usageSummary: UsageSummary = {}

  for (const event of [...timeline].reverse()) {
    const usage = extractUsageSummaryFromEvent(event)

    if (!usageSummary.provider) {
      usageSummary.provider = usage.provider ?? event.provider
    }
    if (!usageSummary.model) {
      usageSummary.model = usage.model ?? event.model
    }
    if (usageSummary.promptTokens === undefined) {
      usageSummary.promptTokens = usage.promptTokens
    }
    if (usageSummary.completionTokens === undefined) {
      usageSummary.completionTokens = usage.completionTokens
    }
    if (usageSummary.reasoningTokens === undefined) {
      usageSummary.reasoningTokens = usage.reasoningTokens
    }
    if (usageSummary.totalTokens === undefined) {
      usageSummary.totalTokens = usage.totalTokens
    }
    if (usageSummary.estimatedCostUsd === undefined) {
      usageSummary.estimatedCostUsd = usage.estimatedCostUsd
    }
  }

  if (usageSummary.totalTokens === undefined) {
    const derivedTotal = [usageSummary.promptTokens, usageSummary.completionTokens, usageSummary.reasoningTokens]
      .filter((value): value is number => value !== undefined)
      .reduce((sum, value) => sum + value, 0)

    if (derivedTotal > 0) {
      usageSummary.totalTokens = derivedTotal
    }
  }

  return usageSummary
}

export function resolveRunGoalText(timeline: NormalizedLogEvent[]): string | undefined {
  for (const event of timeline) {
    const goalText = extractRunGoalText(event.raw)
    if (goalText) {
      return goalText
    }
  }

  return undefined
}

export function extractRunGoalText(raw: Record<string, unknown>): string | undefined {
  return extractGoalTextCandidate(raw.goal)
}

export function extractChildGoalText(raw: Record<string, unknown>): string | undefined {
  return (
    extractGoalTextCandidate(raw.goal) ??
    extractGoalTextCandidate(readRecord(raw.input)?.goal) ??
    extractGoalTextCandidate(readRecord(readRecord(raw.input)?.preview)?.goal) ??
    extractGoalTextCandidate(readRecord(raw.preview)?.goal)
  )
}

function extractUsageSummaryFromEvent(event: NormalizedLogEvent): UsageSummary {
  const usageCandidates = [
    readRecord(event.raw.usage),
    readRecord(readRecord(event.raw.result)?.usage),
    readRecord(readRecord(event.raw.output)?.usage),
  ].filter((value): value is Record<string, unknown> => value !== undefined)

  for (const usage of usageCandidates) {
    const promptTokens = readNumber(usage.promptTokens)
    const completionTokens = readNumber(usage.completionTokens)
    const reasoningTokens = readNumber(usage.reasoningTokens)
    const totalTokens = readNumber(usage.totalTokens)
    const estimatedCostUsd = readNumber(usage.estimatedCostUSD) ?? readNumber(usage.estimatedCostUsd)

    if (
      promptTokens !== undefined ||
      completionTokens !== undefined ||
      reasoningTokens !== undefined ||
      totalTokens !== undefined ||
      estimatedCostUsd !== undefined ||
      readString(usage.provider) ||
      readString(usage.model)
    ) {
      return {
        provider: readString(usage.provider),
        model: readString(usage.model),
        promptTokens,
        completionTokens,
        reasoningTokens,
        totalTokens,
        estimatedCostUsd,
      }
    }
  }

  return {}
}

function extractGoalTextCandidate(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || value === undefined || value === null) {
    return undefined
  }

  const text = readString(value)
  if (text) {
    return normalizeGoalText(text)
  }

  const record = readRecord(value)
  if (!record) {
    return undefined
  }

  return (
    normalizeGoalText(readString(record.preview)) ??
    extractGoalTextCandidate(record.goal, depth + 1) ??
    extractGoalTextCandidate(record.value, depth + 1) ??
    extractGoalTextCandidate(record.text, depth + 1)
  )
}

function normalizeGoalText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (!collapsed) {
    return undefined
  }

  if (collapsed.length <= GOAL_TEXT_MAX_LENGTH) {
    return collapsed
  }

  return `${collapsed.slice(0, GOAL_TEXT_MAX_LENGTH - 3).trimEnd()}...`
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
