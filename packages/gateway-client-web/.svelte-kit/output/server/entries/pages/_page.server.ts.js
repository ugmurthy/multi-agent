import { l as loadLocalGatewayDefaults } from "../../chunks/local-gateway.js";
const load = async () => {
  return {
    defaults: await loadLocalGatewayDefaults()
  };
};
export {
  load
};
