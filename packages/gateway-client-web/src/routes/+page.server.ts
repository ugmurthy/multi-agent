import type { PageServerLoad } from './$types';

import { loadLocalGatewayDefaults } from '$lib/server/local-gateway';

export const load: PageServerLoad = async () => {
  return {
    defaults: await loadLocalGatewayDefaults(),
  };
};
