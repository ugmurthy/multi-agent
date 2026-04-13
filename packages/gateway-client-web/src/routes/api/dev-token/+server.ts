import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { mintGatewayBrowserToken } from '$lib/server/local-gateway';

export const POST: RequestHandler = async ({ request }) => {
  const payload = await request.json().catch(() => null);
  const subject = typeof payload?.subject === 'string' ? payload.subject.trim() : '';
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId.trim() : '';
  const roleCandidates = Array.isArray(payload?.roles) ? payload.roles : [];
  const roles = Array.isArray(payload?.roles)
    ? roleCandidates.filter((role: unknown): role is string => typeof role === 'string' && role.trim().length > 0)
    : [];

  if (!subject) {
    return json({ message: 'subject is required' }, { status: 400 });
  }

  const token = await mintGatewayBrowserToken({
    subject,
    tenantId: tenantId || undefined,
    roles,
  });

  return json({ token });
};
