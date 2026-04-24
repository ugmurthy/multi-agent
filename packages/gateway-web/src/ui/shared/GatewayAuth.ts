import { mintDevToken } from '../../gateway/client';
import type { GatewayIdentity } from '../../gateway/types';

export type TokenMode = 'dev' | 'custom';

export interface GatewayTokenSource {
  identity: GatewayIdentity;
  mode: TokenMode;
  customToken: string;
}

interface CachedToken {
  cacheKey: string;
  token: string;
  expiresAt: number;
}

let cachedDevToken: CachedToken | undefined;

export async function getGatewayAccessToken(source: GatewayTokenSource): Promise<string> {
  if (source.mode === 'custom') {
    const token = source.customToken.trim();
    if (!token) {
      throw new Error('Paste an admin JWT or use a local dev token.');
    }
    return token;
  }

  const cacheKey = JSON.stringify({
    subject: source.identity.subject,
    tenantId: source.identity.tenantId,
    roles: source.identity.roles,
  });
  const now = Date.now();
  if (cachedDevToken?.cacheKey === cacheKey && cachedDevToken.expiresAt > now) {
    return cachedDevToken.token;
  }

  const token = await mintDevToken({
    subject: source.identity.subject,
    tenantId: source.identity.tenantId,
    roles: source.identity.roles,
  });
  cachedDevToken = {
    cacheKey,
    token,
    expiresAt: now + 45_000,
  };
  return token;
}
