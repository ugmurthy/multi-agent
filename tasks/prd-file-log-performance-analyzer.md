# PRD: File-Based Run Log Performance Analyzer

## Introduction

Build an independent log analytics program in TypeScript using Bun that reads file-based adaptive-agent logs and produces performance insights for individual runs and cross-run trends.

The program will analyze newline-delimited JSON log files emitted by the agent runtime and turn them into actionable diagnostics such as run timelines, bottlenecks, failures, retries, tool usage frequency, delegation behavior, token usage, provider/model comparisons, and anomaly signals. It must work as a standalone Bun CLI, not as a dashboard-first feature and not as a direct dependency on the agent runtime.

The current sample log format already contains the core fields needed for this analyzer, including `time`, `event`, `runId`, `rootRunId`, `parentRunId`, `delegationDepth`, `stepId`, `toolName`, `durationMs`, `fromStatus`, `toStatus`, `provider`, `model`, `usage`, `output`, and structured error previews.

## Goals

- Provide a single standalone Bun CLI that can analyze one log file, many log files, or a live-growing log directory.
- Generate both per-run and overall summaries from the same input set.
- Surface performance bottlenecks, waiting time, slow tools, retry loops, and failure patterns without requiring log format changes.
- Support multiple output formats for different consumers: terminal, JSON, Markdown, HTML, and CSV.
- Make cross-run comparison easy across providers, models, delegates, and tool types.
- Detect regressions and anomalies relative to recent runs or a chosen baseline cohort.
- Keep implementation independent from the agent runtime so it can analyze archived logs offline.

## User Stories

### US-001: Ingest logs from files, directories, globs, and watch mode
**Description:** As an engineer, I want to point the analyzer at a file, directory, or glob and optionally keep watching for new log lines so that I can analyze both historical and live runs.

**Acceptance Criteria:**
- [ ] The CLI accepts a single file path, directory path, or glob pattern as input.
- [ ] The CLI can recursively discover matching log files inside directories.
- [ ] The CLI supports a watch mode that re-processes appended lines or newly created files.
- [ ] The CLI reports unreadable files without aborting the entire analysis unless `--fail-fast` is set.
- [ ] `bun test` passes.
- [ ] `bun run <cli> --help` documents the supported input modes.

### US-002: Parse and normalize raw log events safely
**Description:** As an engineer, I want raw NDJSON log lines normalized into typed events so that downstream analytics are deterministic and resilient to malformed data.

**Acceptance Criteria:**
- [ ] The parser reads newline-delimited JSON logs in a streaming manner.
- [ ] Invalid JSON lines are counted and surfaced in diagnostics without crashing the run by default.
- [ ] Unknown event types are preserved as generic events instead of being dropped.
- [ ] Parsed events are normalized into typed records with common fields such as timestamp, event name, run identifiers, tool identifiers, and durations when present.
- [ ] `bun test` passes.

### US-003: Reconstruct run trees and execution timelines
**Description:** As an engineer, I want the analyzer to rebuild root runs, child runs, and ordered event timelines so that I can understand execution flow end to end.

**Acceptance Criteria:**
- [ ] Events are grouped into runs using `runId` and linked using `rootRunId` and `parentRunId`.
- [ ] The analyzer reconstructs parent-child delegation relationships.
- [ ] Each run summary includes start time, end time, wall-clock duration, step count, tool count, and status transitions.
- [ ] The analyzer can render an ordered timeline for a chosen run, including tool activity and delegation boundaries.
- [ ] `bun test` passes.

### US-004: Identify bottlenecks and waiting time
**Description:** As an engineer, I want to see where time was spent inside a run so that I can diagnose the longest phases, idle periods, and tool-level bottlenecks.

**Acceptance Criteria:**
- [ ] Per-run summaries show total duration broken down by tool execution, delegation wait, status wait, and uncategorized gaps where possible.
- [ ] The analyzer identifies the slowest tools, slowest steps, and longest child runs in each run.
- [ ] The analyzer highlights long gaps between adjacent events above a configurable threshold.
- [ ] The analyzer calculates a critical-path-style view for nested child runs using observed timestamps.
- [ ] `bun test` passes.

### US-005: Measure tool usage frequency and efficiency
**Description:** As an engineer, I want usage and latency summaries by tool so that I can find overused, slow, or failure-prone tools.

**Acceptance Criteria:**
- [ ] The analyzer reports tool invocation count, success count, failure count, and success rate by `toolName`.
- [ ] The analyzer reports latency statistics per tool including min, median, p95, max, and total time where durations exist.
- [ ] The analyzer distinguishes direct tool calls from synthetic delegation tools such as `delegate.*`.
- [ ] The analyzer can filter tool summaries by provider, model, delegate, and date range.
- [ ] `bun test` passes.

### US-006: Classify failures, retries, and instability
**Description:** As an engineer, I want failed steps and repeated attempts grouped into useful categories so that I can prioritize reliability work.

**Acceptance Criteria:**
- [ ] Failed `tool.completed` and `run.completed` events are detected from structured output fields when available.
- [ ] Error summaries group failures by tool name, exception name, error value snippet, provider, model, and delegate.
- [ ] The analyzer flags likely retry loops when the same tool or step is attempted repeatedly within a run.
- [ ] The analyzer reports partial-success cases where a tool fails after producing logs or artifacts.
- [ ] `bun test` passes.

### US-007: Analyze delegation behavior and child-run performance
**Description:** As an engineer, I want to understand how delegation affects runtime so that I can evaluate whether sub-agents help or hurt throughput and reliability.

**Acceptance Criteria:**
- [ ] The analyzer reports number of delegated child runs per root run.
- [ ] The analyzer reports time spent waiting on child runs and time spent inside child runs.
- [ ] The analyzer summarizes child-run success rate, average duration, average steps used, and tool mix by delegate profile.
- [ ] The analyzer highlights delegates that frequently fail, retry, or dominate wall-clock time.
- [ ] `bun test` passes.

### US-008: Compare providers, models, and run cohorts
**Description:** As an engineer, I want to compare runs across providers, models, and time windows so that I can detect regressions and choose better configurations.

**Acceptance Criteria:**
- [ ] The analyzer can aggregate runs by provider, model, delegate, and root goal label when available.
- [ ] The analyzer reports comparative metrics including median duration, success rate, token usage, and tool counts by cohort.
- [ ] The analyzer supports selecting a baseline cohort and comparing another cohort against it.
- [ ] The analyzer computes simple anomaly signals such as unusually slow duration, elevated failure rate, or abnormal tool count relative to a baseline.
- [ ] `bun test` passes.

### US-009: Export reports in terminal, JSON, Markdown, HTML, and CSV
**Description:** As an engineer or analyst, I want multiple report formats so that I can use the analyzer in the terminal, CI, documentation, and spreadsheets.

**Acceptance Criteria:**
- [ ] The CLI produces a readable terminal summary by default.
- [ ] The CLI can emit a machine-readable JSON report with stable keys.
- [ ] The CLI can generate Markdown and HTML reports for sharing.
- [ ] The CLI can export CSV tables for runs, tools, failures, and cohorts.
- [ ] The user can select one or more output formats in a single invocation.
- [ ] `bun test` passes.

### US-010: Support targeted drill-down for a single run
**Description:** As an engineer, I want a focused run investigation mode so that I can debug one problematic run in depth.

**Acceptance Criteria:**
- [ ] The CLI can select a single run by `runId` or `rootRunId`.
- [ ] Single-run mode shows event timeline, tool table, failures, retries, status changes, and child-run tree.
- [ ] Single-run mode can include relevant log previews such as stdout, stderr, output previews, and error previews when present.
- [ ] Single-run mode can emit a Markdown or HTML incident-style report.
- [ ] `bun test` passes.

### US-011: Provide configuration and reusable analysis profiles
**Description:** As an engineer, I want config files and named profiles so that repeated analyses are reproducible in local development and CI.

**Acceptance Criteria:**
- [ ] The analyzer supports a config file for default paths, thresholds, and output preferences.
- [ ] The analyzer supports named analysis profiles such as `overview`, `failures`, `bottlenecks`, and `compare`.
- [ ] CLI flags override config defaults.
- [ ] The effective config can be printed for debugging.
- [ ] `bun test` passes.

## Functional Requirements

1. FR-1: The system must run as an independent Bun + TypeScript CLI application.
2. FR-2: The system must ingest newline-delimited JSON log files without requiring access to the live runtime.
3. FR-3: The system must accept file paths, directories, and glob patterns as inputs.
4. FR-4: The system must support a watch mode for appended log lines and newly discovered matching files.
5. FR-5: The system must parse logs using a streaming approach so large files do not require full in-memory loading.
6. FR-6: The system must tolerate malformed lines and continue analysis unless explicitly configured to fail fast.
7. FR-7: The system must normalize observed event types including at minimum `run.created`, `run.status_changed`, `tool.started`, `tool.completed`, `delegate.spawned`, `delegate.child_result`, and `run.completed`.
8. FR-8: The system must preserve unknown event types in the normalized model for forward compatibility.
9. FR-9: The system must reconstruct root runs, child runs, and delegation relationships from `runId`, `rootRunId`, and `parentRunId`.
10. FR-10: The system must produce per-run summaries including duration, steps used, tool counts, status transitions, provider, model, and outcome.
11. FR-11: The system must produce an event timeline for a selected run ordered by timestamp.
12. FR-12: The system must compute tool usage counts and success/failure rates by `toolName`.
13. FR-13: The system must compute duration statistics by tool and by run cohort when `durationMs` is available.
14. FR-14: The system must identify slowest tools, slowest steps, slowest child runs, and longest inter-event gaps.
15. FR-15: The system must estimate waiting time attributable to child-run delegation and status transitions when timestamps make that possible.
16. FR-16: The system must detect failed tools and failed runs using structured result fields and output metadata when present.
17. FR-17: The system must group failures by error name, error value snippet, tool, provider, model, and delegate.
18. FR-18: The system must detect likely retry patterns such as repeated tool executions in the same run.
19. FR-19: The system must identify partial-success situations where artifacts or stdout are produced alongside an eventual failure.
20. FR-20: The system must summarize delegation behavior including child-run counts, delegate success rate, child duration, and time share.
21. FR-21: The system must summarize token usage and estimated cost when usage metadata exists.
22. FR-22: The system must aggregate runs into comparison cohorts by provider, model, delegate, time window, and optionally goal fingerprint.
23. FR-23: The system must support baseline comparison for cohorts and report deltas for duration, success rate, token usage, and tool counts.
24. FR-24: The system must compute anomaly signals using configurable threshold or baseline-based rules.
25. FR-25: The system must output results in terminal, JSON, Markdown, HTML, and CSV formats.
26. FR-26: The system must support generating more than one output format from a single invocation.
27. FR-27: The system must provide stable JSON and CSV schemas suitable for downstream automation.
28. FR-28: The system must support single-run drill-down by `runId` or `rootRunId`.
29. FR-29: The system must support configurable thresholds for slow duration, long gaps, anomaly sensitivity, and retry detection.
30. FR-30: The system must support reusable config files and named analysis profiles.
31. FR-31: The system must return non-zero exit codes for clearly defined failure modes, including parse failure under strict mode and regression/anomaly gates when requested.
32. FR-32: The system must produce human-readable explanations for why a run or cohort was flagged as anomalous.

## Non-Goals

- Building a web dashboard in the first version.
- Changing the existing runtime logger format as a prerequisite for analysis.
- Storing analytics in a database in the first version.
- Implementing predictive forecasting or long-term capacity planning in the first version.
- Correlating file logs with external tracing systems, metrics backends, or APM tools in the first version.
- Requiring network access; the tool should work fully offline on local log files.
- Mutating source logs or rewriting them into a new canonical archive format during analysis.

## Design Considerations

- The default user experience should be CLI-first and optimized for engineering diagnosis.
- The terminal report should emphasize a short executive summary first, followed by bottlenecks, failures, tool tables, and comparison highlights.
- Markdown and HTML reports should be suitable for attaching to investigations, eval runs, or CI artifacts.
- CSV exports should be split into focused tables rather than one wide spreadsheet with sparse fields.
- Single-run drill-down should resemble an incident report, while cohort mode should resemble a benchmark report.

## Technical Considerations

- The implementation must be independent from the adaptive-agent runtime package boundaries. It may reuse shared types later, but the first design should assume it can analyze logs without importing runtime internals.
- Bun should be the default runtime for execution, testing, and packaging.
- The parser should use streaming IO and incremental aggregation to support large log files.
- The normalized internal model should separate raw event ingestion from derived analytics so future log format changes are isolated.
- Proposed internal modules:
  - `cli/`: argument parsing, config loading, profile selection
  - `ingest/`: file discovery, watch mode, streaming NDJSON parser
  - `normalize/`: typed event normalization and validation
  - `model/`: run graph, event timeline, cohort indexing
  - `analyze/`: bottlenecks, failures, retries, usage, anomaly rules
  - `report/`: terminal, JSON, Markdown, HTML, CSV emitters
  - `fixtures/`: representative sample logs for regression tests
- Proposed output artifacts:
  - `summary.json`
  - `summary.md`
  - `summary.html`
  - `runs.csv`
  - `tools.csv`
  - `failures.csv`
  - `cohorts.csv`
- Potential derived entities:
  - `NormalizedEvent`
  - `RunRecord`
  - `RootRunSummary`
  - `ToolStats`
  - `FailureCluster`
  - `DelegateStats`
  - `CohortComparison`
  - `AnomalyFinding`
- Suggested analysis techniques for v1:
  - timeline reconstruction from timestamps
  - parent-child run graph traversal
  - tool latency distributions from `durationMs`
  - inter-event gap analysis for idle time
  - retry heuristics from repeated tool or step patterns
  - simple baseline comparison using median and percentage deltas
  - rule-based anomaly detection rather than ML
- Suggested CLI examples:

```bash
bun run log-analyzer analyze logs/adaptive-agent-example.log
bun run log-analyzer analyze logs/**/*.log --format terminal,json,md,html,csv
bun run log-analyzer analyze logs/ --watch --profile overview
bun run log-analyzer run --root-run-id a6d9e997-e7e3-4feb-b003-ac0a660df3f1 logs/**/*.log
bun run log-analyzer compare logs/day4/*.log --group-by provider,model --baseline provider=openrouter
```

- Repo placement is intentionally left open for now. The proposal should remain valid whether the implementation ships as a new package, a standalone app directory, or an examples-adjacent tool.

## Success Metrics

- Engineers can obtain a useful terminal overview from a representative log set in one command.
- Engineers can generate a run-level incident report in Markdown or HTML in one command.
- The analyzer surfaces the top slow tools and top failure clusters correctly on the existing day-4 sample logs.
- The analyzer can compare at least two providers or model cohorts from file logs and report meaningful deltas.
- The analyzer can process large log files without loading the entire file into memory at once.
- CI or local scripts can consume stable JSON and CSV outputs without custom parsing of human-readable text.

## Open Questions

- Where should the tool live in the repository: reusable package, standalone app directory, or examples-adjacent CLI?
- Should goal text be fingerprinted or redacted by default when generating shareable reports?
- Should anomaly thresholds be purely rule-based in v1, or should there be optional percentile-based auto-thresholding from the start?
- How should estimated cost be handled when logs contain token usage but `estimatedCostUSD` is absent or zero?
- Should watch mode maintain incremental state on disk for very long-running sessions, or is in-memory state enough for v1?
- Should HTML reports include interactive charts in v1, or remain static and lightweight?

## Phased Delivery Plan

### Phase 1: Core ingestion and summaries
- Streaming parser for NDJSON logs.
- Run reconstruction and basic per-run summaries.
- Terminal and JSON outputs.
- Tool frequency and duration tables.
- Failure detection and error clustering.

### Phase 2: Drill-down and reporting
- Single-run timeline mode.
- Markdown and HTML report generation.
- CSV exports for runs, tools, and failures.
- Config files and analysis profiles.

### Phase 3: Comparative analytics
- Cohort aggregation by provider, model, and delegate.
- Baseline comparison and delta reporting.
- Anomaly rules and regression-friendly exit codes.
- Watch mode for live log directories.

## Recommended Initial Insight Catalog

- Run count, success rate, failure rate, and incomplete run count.
- Median, p95, and max run duration.
- Top 10 slowest runs.
- Timeline for a selected run.
- Time spent in direct tools versus delegated child runs.
- Slowest tools by total time and p95 time.
- Most frequently used tools.
- Most failure-prone tools.
- Status transition counts and time spent awaiting sub-agents.
- Child-run count by delegate profile.
- Delegate success rate and mean child-run duration.
- Retry loop candidates.
- Partial-success runs that produced artifacts before failing.
- Top error names and error message clusters.
- Provider/model comparison for duration, success rate, and tokens.
- Outlier runs relative to baseline duration and tool count.
