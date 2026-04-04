import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createSandbox } = vi.hoisted(() => ({
  createSandbox: vi.fn(),
}));

vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: {
    create: createSandbox,
  },
}));

import { execute } from './handler.js';

describe('code-executor handler', () => {
  let artifactRoot: string;

  beforeEach(async () => {
    artifactRoot = await mkdtemp(join(tmpdir(), 'code-executor-artifacts-'));
    process.env.ADAPTIVE_AGENT_ARTIFACTS_DIR = artifactRoot;
  });

  afterEach(async () => {
    delete process.env.ADAPTIVE_AGENT_ARTIFACTS_DIR;
    createSandbox.mockReset();
    await rm(artifactRoot, { recursive: true, force: true });
  });

  it('downloads requested sandbox artifacts and omits inline binary payloads', async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    const runCode = vi.fn().mockResolvedValue({
      text: undefined,
      error: undefined,
      logs: { stdout: ['saved\n'], stderr: [] },
      results: [
        {
          text: '<Figure size 1000x600 with 1 Axes>',
          png: 'iVBORw0KGgoAAAANSUhEUgAA',
          formats: () => ['text/plain', 'image/png'],
          isMainResult: true,
        },
      ],
    });
    const files = {
      read: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
    };

    createSandbox.mockResolvedValue({ runCode, files, kill });

    const result = (await execute({
      code: 'print("saved")',
      language: 'python',
      saveArtifacts: [{ sandboxPath: '/tmp/graph.png', path: 'plots/graph.png' }],
    } as any)) as any;

    expect(result.success).toBe(true);
    expect(result.savedArtifacts).toEqual([
      {
        sandboxPath: '/tmp/graph.png',
        path: join(artifactRoot, 'plots', 'graph.png'),
        sizeBytes: 4,
      },
    ]);
    expect(result.results).toEqual([
      {
        text: '<Figure size 1000x600 with 1 Axes>',
        formats: ['text/plain', 'image/png'],
        isMainResult: true,
        omittedFormats: ['png'],
      },
    ]);
    expect(files.read).toHaveBeenCalledWith('/tmp/graph.png', { format: 'bytes' });
    expect(await readFile(join(artifactRoot, 'plots', 'graph.png'))).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(kill).toHaveBeenCalledOnce();
  });
});
