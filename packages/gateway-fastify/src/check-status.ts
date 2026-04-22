#!/usr/bin/env bun

import { GATEWAY_CONFIG_PATH, loadLocalGatewayConnectionConfig } from './local-dev.js';
import { mintLocalDevJwt } from './local-dev-jwt.js';

interface StatusOptions {
  url?: string;
  host?: string;
  port?: number;
  path: string;
  subject: string;
  tenantId?: string;
  roles: string[];
  token?: string;
}

const USAGE = `Usage:
  bun run ./packages/gateway-fastify/src/check-status.ts [options]

Options:
  --url <value>                Full status URL (default: derived from local gateway config)
  --host <value>               Gateway host (default: local config or 127.0.0.1)
  --port <value>               Gateway port (default: local config or 8959)
  --path <value>               Status path (default: /status)
  --sub, --subject <value>     JWT subject claim (default: local-admin)
  --tenant <value>             JWT tenant claim
  --role <value>               Add a JWT role claim; can be repeated
  --roles <a,b,c>              Add multiple comma-separated JWT roles
  --token <jwt>                Use this JWT instead of minting one
  --help                       Show this help text

Examples:
  bun run ./packages/gateway-fastify/src/check-status.ts
  bun run ./packages/gateway-fastify/src/check-status.ts --host 127.0.0.1 --port 8959`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const localConnection = await loadLocalGatewayConnectionConfig();
  const options = parseArgs(args, localConnection);
  const token =
    options.token ??
    (
      await mintLocalDevJwt({
        subject: options.subject,
        tenantId: options.tenantId,
        roles: options.roles,
      })
    ).token;
  const response = await fetch(resolveStatusUrl(options), {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  let body: unknown;

  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    console.error(`Gateway status request failed: HTTP ${response.status} ${response.statusText}`);
    console.error(formatJson(body));
    process.exit(1);
  }

  process.stdout.write(`${formatJson(body)}\n`);
}

function parseArgs(args: string[], localConnection?: Awaited<ReturnType<typeof loadLocalGatewayConnectionConfig>>): StatusOptions {
  const options: StatusOptions = {
    url: undefined,
    host: normalizeHost(localConnection?.host),
    port: localConnection?.port ?? 8959,
    path: '/status',
    subject: 'local-admin',
    tenantId: undefined,
    roles: ['admin'],
    token: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--url':
        options.url = requireValue(arg, args[index + 1]);
        index += 1;
        break;
      case '--host':
        options.host = normalizeHost(requireValue(arg, args[index + 1]));
        index += 1;
        break;
      case '--port':
        options.port = parsePort(requireValue(arg, args[index + 1]));
        index += 1;
        break;
      case '--path':
        options.path = normalizePath(requireValue(arg, args[index + 1]));
        index += 1;
        break;
      case '--sub':
      case '--subject':
        options.subject = requireValue(arg, args[index + 1]);
        index += 1;
        break;
      case '--tenant':
        options.tenantId = requireValue(arg, args[index + 1]);
        index += 1;
        break;
      case '--role':
        options.roles.push(requireValue(arg, args[index + 1]));
        options.roles = dedupe(options.roles);
        index += 1;
        break;
      case '--roles':
        options.roles = dedupe([...options.roles, ...parseCsv(requireValue(arg, args[index + 1]))]);
        index += 1;
        break;
      case '--token':
        options.token = requireValue(arg, args[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }

  return options;
}

function resolveStatusUrl(options: StatusOptions): string {
  if (options.url) {
    return options.url;
  }

  return `http://${options.host ?? '127.0.0.1'}:${options.port ?? 8959}${options.path}`;
}

function normalizeHost(host: string | undefined): string {
  if (!host || host === '0.0.0.0' || host === '::') {
    return '127.0.0.1';
  }

  return host;
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (Number.isInteger(port) && port > 0) {
    return port;
  }

  throw new Error(`Invalid port: ${value}`);
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function requireValue(flag: string, value: string | undefined): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  throw new Error(`Missing value for ${flag}.`);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to check gateway status: ${message}`);
  console.error(`- gateway config: ${GATEWAY_CONFIG_PATH}`);
  process.exit(1);
});
