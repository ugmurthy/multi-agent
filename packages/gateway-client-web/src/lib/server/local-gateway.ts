import { loadLocalGatewayConnectionConfig } from '@adaptive-agent/gateway-fastify/src/local-dev.js';
import { mintLocalDevJwt } from '@adaptive-agent/gateway-fastify/src/local-dev-jwt.js';

export interface LocalGatewayDefaults {
  socketUrl: string;
  channel: string;
  subject: string;
  tenantId: string;
  roles: string[];
}

export async function loadLocalGatewayDefaults(): Promise<LocalGatewayDefaults> {
  const connection = await loadLocalGatewayConnectionConfig().catch(() => undefined);
  const host = normalizeHost(connection?.host);
  const port = connection?.port ?? 8959;
  const websocketPath = connection?.websocketPath ?? '/ws';

  return {
    socketUrl: `ws://${host}:${port}${websocketPath}`,
    channel: 'web',
    subject: 'local-dev-user',
    tenantId: '',
    roles: [],
  };
}

export async function mintGatewayBrowserToken(input: {
  subject: string;
  tenantId?: string;
  roles?: string[];
}): Promise<string> {
  const { token } = await mintLocalDevJwt({
    subject: input.subject,
    tenantId: input.tenantId,
    roles: input.roles,
  });

  return token;
}

function normalizeHost(host: string | undefined): string {
  if (!host || host === '0.0.0.0' || host === '::') {
    return '127.0.0.1';
  }

  return host;
}
