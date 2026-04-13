export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.DTS2CH1d.js",app:"_app/immutable/entry/app.BD-CNn0j.js",imports:["_app/immutable/entry/start.DTS2CH1d.js","_app/immutable/chunks/Dt_nfrqx.js","_app/immutable/chunks/CLzB1TRV.js","_app/immutable/chunks/DBwTDMEb.js","_app/immutable/entry/app.BD-CNn0j.js","_app/immutable/chunks/CLzB1TRV.js","_app/immutable/chunks/D3efUnCk.js","_app/immutable/chunks/BMAFP0vo.js","_app/immutable/chunks/DBwTDMEb.js","_app/immutable/chunks/BTG7YM3_.js","_app/immutable/chunks/CfoXR68e.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/api/dev-token",
				pattern: /^\/api\/dev-token\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/dev-token/_server.ts.js'))
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
