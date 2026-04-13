

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/layout.svelte.js')).default;
export const imports = ["_app/immutable/nodes/0.3fTTeFsN.js","_app/immutable/chunks/BMAFP0vo.js","_app/immutable/chunks/CLzB1TRV.js","_app/immutable/chunks/CfoXR68e.js"];
export const stylesheets = [];
export const fonts = [];
