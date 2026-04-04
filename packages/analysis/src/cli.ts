#!/usr/bin/env bun

export interface CliResult {
  exitCode: number
  output: string
}

export function formatHelp(): string {
  return [
    'analysis',
    '',
    'Standalone Bun + TypeScript log analysis workspace for adaptive-agent logs.',
    '',
    'Usage:',
    '  analysis analyze <file|directory|glob> [more inputs...]',
    '  analysis --help',
    '',
    'Commands:',
    '  analyze   Analyze one or more file, directory, or glob inputs',
  ].join('\n')
}

export function runCli(args: string[]): CliResult {
  const [command, ...inputs] = args

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    return { exitCode: 0, output: formatHelp() }
  }

  if (command === 'analyze') {
    return {
      exitCode: 0,
      output: [
        'analysis analyze',
        '',
        `Inputs received: ${inputs.length}`,
        'Analysis implementation starts in later stories.',
      ].join('\n'),
    }
  }

  return {
    exitCode: 1,
    output: `Unknown command: ${command}\n\n${formatHelp()}`,
  }
}

if (import.meta.main) {
  const result = runCli(process.argv.slice(2))
  if (result.output) {
    console.log(result.output)
  }
  process.exit(result.exitCode)
}
