import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAdaptiveAgentLogger, DEFAULT_ADAPTIVE_AGENT_LOG_LEVEL } from './logger.js';

describe('createAdaptiveAgentLogger', () => {
  it('defaults to the silent log level', () => {
    const logger = createAdaptiveAgentLogger({ pretty: false });

    expect(DEFAULT_ADAPTIVE_AGENT_LOG_LEVEL).toBe('silent');
    expect(logger.level).toBe('silent');
  });

  it('writes logs to a file destination', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'adaptive-agent-logger-'));
    const logFilePath = join(tempDir, 'agent.log');

    try {
      const logger = createAdaptiveAgentLogger({
        destination: 'file',
        filePath: logFilePath,
        level: 'info',
        pretty: false,
      });

      logger.info({ runId: 'run-1' }, 'hello file logger');
      logger.flush();

      const lines = readFileSync(logFilePath, 'utf8').trim().split('\n');
      const entry = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;

      expect(entry.msg).toBe('hello file logger');
      expect(entry.runId).toBe('run-1');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
