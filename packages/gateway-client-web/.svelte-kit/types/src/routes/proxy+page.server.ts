// @ts-nocheck
import type { PageServerLoad } from './$types';

import { loadLocalGatewayDefaults } from '$lib/server/local-gateway';

export const load = async () => {
  return {
    defaults: await loadLocalGatewayDefaults(),
  };
};
;null as any as PageServerLoad;