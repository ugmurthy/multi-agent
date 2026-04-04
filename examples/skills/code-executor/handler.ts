import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Sandbox } from '@e2b/code-interpreter';

import type { JsonValue } from '../../../packages/core/src/types.js';

// ── Input / Output contracts ────────────────────────────────────────────────

interface CodeExecInput {
  code: string;
  language: 'bash' | 'javascript' | 'js' | 'typescript' | 'ts' | 'python';
  saveArtifacts?: SavedArtifactRequest[];
}

interface SavedArtifactRequest {
  sandboxPath: string;
  path: string;
}

interface ResultEntry {
  text?: string;
  json?: string;
  html?: string;
  svg?: string;
  latex?: string;
  markdown?: string;
  javascript?: string;
  formats: string[];
  isMainResult: boolean;
  omittedFormats?: string[];
}

interface SavedArtifact {
  sandboxPath: string;
  path: string;
  sizeBytes: number;
}

interface CodeExecOutput {
  success: boolean;
  language: string;
  text?: string;
  results: ResultEntry[];
  savedArtifacts?: SavedArtifact[];
  logs: { stdout: string[]; stderr: string[] };
  error?: { name: string; value: string; traceback: string };
}

// ── Exported tool metadata ──────────────────────────────────────────────────

export const name = 'e2b_run_code';

export const description =
  'Execute code in a secure E2B cloud sandbox. Supports bash, javascript, typescript, and python. Returns structured results with stdout, stderr, errors, and rich outputs.';

export const inputSchema = {
  type: 'object',
  required: ['code', 'language'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', description: 'The source code to execute.' },
    language: {
      type: 'string',
      enum: ['bash', 'javascript', 'js', 'typescript', 'ts', 'python'],
      description: 'The language of the code.',
    },
    saveArtifacts: {
      type: 'array',
      description:
        'Optional list of sandbox files to download into the local artifacts directory after execution succeeds.',
      items: {
        type: 'object',
        required: ['sandboxPath', 'path'],
        additionalProperties: false,
        properties: {
          sandboxPath: {
            type: 'string',
            description: 'Path of the file inside the E2B sandbox, for example /tmp/graph.png.',
          },
          path: {
            type: 'string',
            description: 'Relative path under the local artifacts directory where the file should be saved.',
          },
        },
      },
    },
  },
};

export const outputSchema = {
  type: 'object',
  required: ['success', 'language', 'results', 'logs'],
  properties: {
    success: { type: 'boolean', description: 'True when no execution error occurred.' },
    language: { type: 'string', description: 'The language that was executed.' },
    text: { type: 'string', description: 'Convenience text of the main result, if any.' },
    results: {
      type: 'array',
      description: 'Rich result objects from the execution (last expression, display calls).',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          json: { type: 'string' },
          html: { type: 'string' },
          svg: { type: 'string' },
          latex: { type: 'string' },
          markdown: { type: 'string' },
          javascript: { type: 'string' },
          formats: { type: 'array', items: { type: 'string' } },
          isMainResult: { type: 'boolean' },
          omittedFormats: {
            type: 'array',
            description: 'Binary formats omitted from the JSON response to avoid returning large inline payloads.',
            items: { type: 'string' },
          },
        },
      },
    },
    savedArtifacts: {
      type: 'array',
      description: 'Files copied from the sandbox into the local artifacts directory.',
      items: {
        type: 'object',
        required: ['sandboxPath', 'path', 'sizeBytes'],
        properties: {
          sandboxPath: { type: 'string' },
          path: { type: 'string' },
          sizeBytes: { type: 'number' },
        },
      },
    },
    logs: {
      type: 'object',
      properties: {
        stdout: { type: 'array', items: { type: 'string' } },
        stderr: { type: 'array', items: { type: 'string' } },
      },
    },
    error: {
      type: 'object',
      description: 'Present only when execution failed.',
      properties: {
        name: { type: 'string', description: 'Error class / type name.' },
        value: { type: 'string', description: 'Error message.' },
        traceback: { type: 'string', description: 'Full traceback / stack trace.' },
      },
    },
  },
};

// ── Execution ───────────────────────────────────────────────────────────────

const SANDBOX_TIMEOUT_MS = 60_000;
const BINARY_RESULT_FORMATS = ['png', 'jpeg', 'pdf'] as const;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCAL_ARTIFACT_ROOT = resolve(MODULE_DIR, '..', '..', '..', 'artifacts');

export async function execute(rawInput: JsonValue): Promise<JsonValue> {
  // Some models send tool input as a JSON string instead of an object — normalise.
  const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  const { code, language, saveArtifacts } = input as unknown as CodeExecInput;

  if (typeof code !== 'string' || !code.trim()) {
    return failureResult(language ?? 'unknown', 'InputError', 'code must be a non-empty string', '');
  }

  const validLanguages = ['bash', 'javascript', 'js', 'typescript', 'ts', 'python'];
  if (!validLanguages.includes(language)) {
    return failureResult(
      language ?? 'unknown',
      'InputError',
      `Unsupported language '${language}'. Must be one of: ${validLanguages.join(', ')}`,
      '',
    );
  }

  if (saveArtifacts !== undefined && !Array.isArray(saveArtifacts)) {
    return failureResult(language, 'InputError', 'saveArtifacts must be an array when provided', '');
  }

  let sbx: Sandbox | undefined;

  try {
    sbx = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });

    const execution = await sbx.runCode(code, { language: language as any });

    const results: ResultEntry[] = (execution.results ?? []).map(sanitizeResultEntry);

    const logs = {
      stdout: execution.logs.stdout.map(String),
      stderr: execution.logs.stderr.map(String),
    };

    const savedArtifacts = execution.error
      ? []
      : await saveSandboxArtifacts(sbx, saveArtifacts ?? []);

    const output: CodeExecOutput = {
      success: !execution.error,
      language,
      text: execution.text ?? undefined,
      results,
      savedArtifacts: savedArtifacts.length > 0 ? savedArtifacts : undefined,
      logs,
    };

    if (execution.error) {
      output.error = {
        name: execution.error.name,
        value: execution.error.value,
        traceback: execution.error.traceback,
      };
    }

    return output as unknown as JsonValue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failureResult(language, 'SandboxError', message, '');
  } finally {
    if (sbx) {
      try {
        await sbx.kill();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeResultEntry(result: {
  text?: string;
  json?: string;
  html?: string;
  svg?: string;
  latex?: string;
  markdown?: string;
  javascript?: string;
  formats(): string[];
  isMainResult: boolean;
  png?: string;
  jpeg?: string;
  pdf?: string;
}): ResultEntry {
  const formats = result.formats();
  const omittedFormats = BINARY_RESULT_FORMATS.filter((format) => {
    return typeof result[format] === 'string' && result[format]!.length > 0;
  });

  return {
    text: result.text ?? undefined,
    json: result.json ?? undefined,
    html: result.html ?? undefined,
    svg: result.svg ?? undefined,
    latex: result.latex ?? undefined,
    markdown: result.markdown ?? undefined,
    javascript: result.javascript ?? undefined,
    formats,
    isMainResult: result.isMainResult,
    omittedFormats: omittedFormats.length > 0 ? [...omittedFormats] : undefined,
  };
}

async function saveSandboxArtifacts(sandbox: Sandbox, requests: SavedArtifactRequest[]): Promise<SavedArtifact[]> {
  const savedArtifacts: SavedArtifact[] = [];

  for (const request of requests) {
    if (typeof request?.sandboxPath !== 'string' || !request.sandboxPath.trim()) {
      throw new Error('Each saveArtifacts entry requires a non-empty "sandboxPath" string');
    }
    if (typeof request?.path !== 'string' || !request.path.trim()) {
      throw new Error('Each saveArtifacts entry requires a non-empty "path" string');
    }

    const resolvedPath = resolveLocalArtifactPath(request.path);
    const content = await sandbox.files.read(request.sandboxPath, { format: 'bytes' });
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, content);

    savedArtifacts.push({
      sandboxPath: request.sandboxPath,
      path: resolvedPath,
      sizeBytes: content.byteLength,
    });
  }

  return savedArtifacts;
}

function resolveLocalArtifactPath(filePath: string): string {
  const root = resolve(process.env.ADAPTIVE_AGENT_ARTIFACTS_DIR ?? DEFAULT_LOCAL_ARTIFACT_ROOT);
  const resolvedPath = resolve(root, filePath);
  const pathFromRoot = relative(root, resolvedPath);

  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error(`Artifact path ${filePath} is outside the allowed root ${root}`);
  }

  return resolvedPath;
}

function failureResult(
  language: string,
  errorName: string,
  errorValue: string,
  traceback: string,
): JsonValue {
  const output: CodeExecOutput = {
    success: false,
    language,
    results: [],
    logs: { stdout: [], stderr: [] },
    error: { name: errorName, value: errorValue, traceback },
  };
  return output as unknown as JsonValue;
}
