#!/usr/bin/env bun

import { analyzeLogEntries } from './log-analysis/analyzer.js';
import {
  DEFAULT_LOCAL_GATEWAY_LOG_DIR,
  createLogTailStates,
  discoverLogFiles,
  readAppendedLogLines,
  readLogFiles,
  type LogTailState,
} from './log-analysis/files.js';
import { renderReport, renderWatchEntries } from './log-analysis/render.js';
import type { LogAnalysisFilter } from './log-analysis/types.js';

interface CliOptions {
  dir?: string;
  files: string[];
  date?: string;
  since?: string;
  until?: string;
  sessionId?: string;
  runId?: string;
  rootRunId?: string;
  watch: boolean;
  json: boolean;
  details: boolean;
  timeZone?: string;
  help: boolean;
}

const USAGE = `Usage:
  bun run logs:analyze [options]

Options:
  --dir <path>            Log directory. Default: ${DEFAULT_LOCAL_GATEWAY_LOG_DIR}
  --file <path>           Read one file. May be repeated.
  --date <YYYY-MM-DD>     Read log files for a date.
  --since <duration|iso>  Include entries after a duration like 1h, 30m, 2d, or an ISO time.
  --until <iso>           Include entries up to an ISO time.
  --session-id <id>       Focus report on one gateway session.
  --run-id <id>           Focus report on one run or root run.
  --root-run-id <id>      Focus report on one root run.
  --watch                 Keep watching current log files and print new events.
  --json                  Print JSON instead of the text report.
  --details, --verbose    Print full sections and timelines instead of the compact default.
  --timezone <tz>         IANA timezone for display, e.g. Asia/Kolkata. Defaults to local timezone.
  --help                  Show this help.

Examples:
  bun run logs:analyze
  bun run logs:analyze --since 1h
  bun run logs:analyze --session-id sess-123
  bun run logs:analyze --watch --session-id sess-123`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  validateTimeZone(options.timeZone);
  const filter = buildFilter(options);
  const files = await discoverLogFiles({
    dir: options.dir,
    files: options.files,
    date: options.date,
  });

  if (files.length === 0) {
    console.error(`No gateway log files found. Checked: ${options.dir ?? DEFAULT_LOCAL_GATEWAY_LOG_DIR}`);
    process.exitCode = 1;
    return;
  }

  if (options.watch) {
    await runWatchMode(files, options, filter);
    return;
  }

  const { entries, issues } = await readLogFiles(files);
  const report = analyzeLogEntries(entries, issues, { filter });
  console.log(
    renderReport(report, {
      json: options.json,
      detailed: options.details || hasEntityFilter(filter),
      timeZone: options.timeZone,
    }),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    watch: false,
    json: false,
    details: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case '--dir':
        options.dir = requireValue(arg, args[++index]);
        break;
      case '--file':
        options.files.push(requireValue(arg, args[++index]));
        break;
      case '--date':
        options.date = requireValue(arg, args[++index]);
        break;
      case '--since':
        options.since = requireValue(arg, args[++index]);
        break;
      case '--until':
        options.until = requireValue(arg, args[++index]);
        break;
      case '--session-id':
        options.sessionId = requireValue(arg, args[++index]);
        break;
      case '--run-id':
        options.runId = requireValue(arg, args[++index]);
        break;
      case '--root-run-id':
        options.rootRunId = requireValue(arg, args[++index]);
        break;
      case '--watch':
        options.watch = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--details':
      case '--verbose':
        options.details = true;
        break;
      case '--timezone':
      case '--time-zone':
      case '--tz':
        options.timeZone = requireValue(arg, args[++index]);
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }

  return options;
}

function buildFilter(options: CliOptions): LogAnalysisFilter {
  return {
    sinceMs: options.since ? parseTimeBoundary(options.since, 'since') : undefined,
    untilMs: options.until ? parseTimeBoundary(options.until, 'until') : undefined,
    sessionId: options.sessionId,
    runId: options.runId,
    rootRunId: options.rootRunId,
  };
}

function hasEntityFilter(filter: LogAnalysisFilter): boolean {
  return Boolean(filter.sessionId || filter.runId || filter.rootRunId);
}

async function runWatchMode(files: string[], options: CliOptions, filter: LogAnalysisFilter): Promise<void> {
  let knownFiles = new Set(files);
  let states = createLogTailStates(files);

  console.log(`Watching ${files.length} log file${files.length === 1 ? '' : 's'} for new events.`);
  console.log(`Times are displayed in ${options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local timezone'}.`);

  const interval = setInterval(() => {
    void pollWatchFiles(options, filter, knownFiles, states).catch((error) => {
      console.error(`Watch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 1000);

  const shutdown = () => {
    clearInterval(interval);
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function pollWatchFiles(
  options: CliOptions,
  filter: LogAnalysisFilter,
  knownFiles: Set<string>,
  states: LogTailState[],
): Promise<void> {
  const currentFiles = await discoverLogFiles({
    dir: options.dir,
    files: options.files,
    date: options.date,
  });
  const newFiles = currentFiles.filter((file) => !knownFiles.has(file));
  if (newFiles.length > 0) {
    for (const file of newFiles) {
      knownFiles.add(file);
    }
    states.push(...createLogTailStates(newFiles));
  }

  const { entries, issues } = await readAppendedLogLines(states);
  if (entries.length === 0 && issues.length === 0) {
    return;
  }

  const report = analyzeLogEntries(entries, issues, { filter });

  for (const line of renderWatchEntries(report, { timeZone: options.timeZone })) {
    console.log(line);
  }

  if (issues.length > 0) {
    console.warn(`- ${issues.length} appended log line${issues.length === 1 ? '' : 's'} could not be parsed.`);
  }
}

function parseTimeBoundary(value: string, label: string): number {
  const durationMs = parseDurationMs(value);
  if (durationMs !== undefined) {
    return Date.now() - durationMs;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid --${label} value "${value}". Use a duration like 1h or an ISO timestamp.`);
  }
  return parsed;
}

function parseDurationMs(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
  }
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function validateTimeZone(timeZone: string | undefined): void {
  if (!timeZone) {
    return;
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone "${timeZone}". Use an IANA timezone such as Asia/Kolkata.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
