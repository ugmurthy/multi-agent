import { describe, expect, it } from 'vitest'

import { formatHelp, runCli } from './cli.js'

describe('analysis cli scaffold', () => {
  it('renders help text', () => {
    expect(formatHelp()).toContain('analysis analyze <file|directory|glob>')
  })

  it('accepts analyze inputs', () => {
    const result = runCli(['analyze', 'logs/', 'logs/**/*.log'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Inputs received: 2')
  })
})
