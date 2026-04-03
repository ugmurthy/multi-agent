import { Sandbox } from '@e2b/code-interpreter';
import type { JsonValue } from '../../../packages/core/src/types.js';

interface ExecuteCodeInput {
  code: string;
  language?: 'python' | 'javascript' | 'js' | 'typescript' | 'ts';
  timeoutMs?: number;
  downloadPaths?: string[];
}

interface ExecuteCodeOutput {
  stdout: string[];
  stderr: string[];
  results: JsonValue[];
  error?: string;
  executionCount: number;
  downloadedFiles?: Record<string, string>;
}

let sandbox: Sandbox | null = null;

async function getSandbox(): Promise<Sandbox> {
  if (!sandbox) {
    sandbox = await Sandbox.create({
      metadata: { name: 'adaptive-agent-code-executor' },
    });
  }
  return sandbox;
}

export const name = 'execute_code';

export const description =
  'Execute Python, JavaScript, or TypeScript code in a secure E2B sandbox with internet access.';

export const inputSchema = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: {
    code: {
      type: 'string',
      description: 'The code to execute. Can include imports and multiple statements.',
    },
    language: {
      type: 'string',
      description: 'Programming language: python, javascript/js, or typescript/ts. Defaults to python.',
      enum: ['python', 'javascript', 'js', 'typescript', 'ts'],
    },
    timeoutMs: {
      type: 'number',
      description: 'Timeout for code execution in milliseconds. Defaults to 60000 (60 seconds).',
    },
    downloadPaths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of absolute paths in the sandbox to download after execution (e.g., ["/home/user/output.png"]). Returns file contents as base64 strings.',
    },
  },
};

export const outputSchema = {
  type: 'object',
  properties: {
    stdout: { type: 'array', items: { type: 'string' } },
    stderr: { type: 'array', items: { type: 'string' } },
    results: { type: 'array' },
    error: { type: 'string' },
    executionCount: { type: 'number' },
    downloadedFiles: {
      type: 'object',
      description: 'Files downloaded from sandbox, keyed by path. Values are base64-encoded content.',
    },
  },
};

const BINARY_FIELDS = ['png', 'jpeg', 'pdf', 'svg', 'html'] as const;
const MAX_TEXT_LENGTH = 2000;

function summarizeResult(r: Record<string, unknown>): JsonValue {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(r)) {
    if (BINARY_FIELDS.includes(key as (typeof BINARY_FIELDS)[number]) && typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
      summary[key] = `[base64 data, ${value.length} chars]`;
    } else if (key === 'text' && typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
      summary[key] = value.slice(0, MAX_TEXT_LENGTH) + `... [truncated, ${value.length} total chars]`;
    } else {
      summary[key] = value;
    }
  }
  return summary as unknown as JsonValue;
}

export async function execute(input: JsonValue): Promise<JsonValue> {
  const { code, language = 'python', timeoutMs = 60000, downloadPaths } = input as unknown as ExecuteCodeInput;

  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('code must be a non-empty string');
  }

  const e2bLanguage = language === 'js' ? 'javascript' : language === 'ts' ? 'typescript' : language;

  try {
    const sbx = await getSandbox();

    const execution = await sbx.runCode(code, {
      language: e2bLanguage as 'python' | 'javascript' | 'typescript',
      timeoutMs,
    });

    const downloadedFiles: Record<string, string> = {};
    if (downloadPaths && downloadPaths.length > 0) {
      for (const path of downloadPaths) {
        try {
          const downloadUrl = sbx.downloadUrl(path, { useSignatureExpiration: 20_000 });
          downloadedFiles[path] = downloadUrl;
        } catch {
          downloadedFiles[path] = `[error generating download url]`;
        }
      }
    }

    const result: ExecuteCodeOutput = {
      stdout: execution.logs.stdout.map((msg) => String(msg)),
      stderr: execution.logs.stderr.map((msg) => String(msg)),
      results: execution.results.map((r) => summarizeResult(r as Record<string, unknown>)),
      error: execution.error ? String(execution.error) : undefined,
      executionCount: execution.executionCount,
      ...(Object.keys(downloadedFiles).length > 0 && { downloadedFiles }),
    };

    return result as unknown as JsonValue;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    const isAuthError =
      /\bunauthorized\b/i.test(errorMessage) ||
      /\bauthentication\b/i.test(errorMessage) ||
      /\bauthorization header\b/i.test(errorMessage) ||
      /\bapi[_ ]?key\b/i.test(errorMessage);

    if (isAuthError) {
      sandbox = null;
      throw new Error(`E2B authorization failed: ${errorMessage}. Check your E2B_API_KEY.`);
    }

    return {
      stdout: [],
      stderr: [],
      results: [],
      error: errorMessage,
      executionCount: 0,
    } as unknown as JsonValue;
  }
}
