
import { executeHookSlot, createEmptyResolvedHooks } from './packages/gateway-fastify/src/hooks.ts';

const hooks = createEmptyResolvedHooks('warn');

hooks.beforeInboundMessage = [
  {
    id: 'manual-audit',
    beforeInboundMessage(context) {
      console.log('hook saw:', context);
      return { metadata: { audited: true } };
    },
  },
];

const result = await executeHookSlot(hooks, 'beforeInboundMessage', {
  slot: 'beforeInboundMessage',
  sessionId: 'manual-session',
  message: 'hello from manual test',
});

console.log(result);


