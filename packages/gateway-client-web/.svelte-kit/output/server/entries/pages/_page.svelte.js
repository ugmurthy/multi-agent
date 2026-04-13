import { a0 as ssr_context, a1 as head, a2 as attr_class, e as escape_html, a3 as attr, a4 as ensure_array_like, $ as derived } from "../../chunks/renderer.js";
function onDestroy(fn) {
  /** @type {SSRContext} */
  ssr_context.r.on_destroy(fn);
}
function formatClockTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}
function truncateId(value, length = 8) {
  {
    return "none";
  }
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    let socketState = "idle";
    let sessionStatus = "idle";
    let showEvents = true;
    let isConnecting = false;
    let composerMode = "chat";
    let composerText = "";
    let connectionForm = {
      socketUrl: "",
      channel: "",
      subject: "",
      tenantId: "",
      roles: "",
      useLocalDevToken: true
    };
    let feed = [
      {
        id: crypto.randomUUID(),
        kind: "system",
        content: "Pocket Gateway mirrors the TUI flow in a mobile-first shell: chat turns, dedicated runs, live agent events, approvals, and clarification loops.",
        timestamp: /* @__PURE__ */ new Date()
      }
    ];
    const pendingChip = derived(() => "offline");
    onDestroy(() => {
    });
    head("1uha8ag", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>Pocket Gateway</title>`);
      });
      $$renderer3.push(`<meta name="description" content="Mobile-first Svelte gateway client with chat, runs, live agent events, approvals, and clarification flows."/>`);
    });
    $$renderer2.push(`<div class="page-shell svelte-1uha8ag"><div class="backdrop aura-left svelte-1uha8ag"></div> <div class="backdrop aura-right svelte-1uha8ag"></div> <section class="hero-card svelte-1uha8ag"><div><p class="eyebrow svelte-1uha8ag">Adaptive Agent Gateway</p> <h1 class="svelte-1uha8ag">Pocket Gateway</h1> <p class="lede svelte-1uha8ag">A mobile-first control surface for live gateway sessions, shaped like an operations notebook instead of a terminal.</p></div> <div class="hero-status svelte-1uha8ag"><span${attr_class(`status-pill state-${socketState}`, "svelte-1uha8ag")}>${escape_html(socketState)}</span> <span class="status-pill secondary svelte-1uha8ag">${escape_html(pendingChip())}</span> <span class="status-pill secondary svelte-1uha8ag">session ${escape_html(sessionStatus)}</span></div></section> <div class="workspace-grid svelte-1uha8ag"><section class="conversation-panel svelte-1uha8ag"><div class="panel-header svelte-1uha8ag"><div><p class="panel-kicker svelte-1uha8ag">Connection</p> <h2 class="svelte-1uha8ag">Gateway socket</h2></div> <button class="ghost-button svelte-1uha8ag" type="button">${escape_html("Collapse")}</button></div> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="connection-card svelte-1uha8ag"><label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Socket URL</span> <input${attr("value", connectionForm.socketUrl)} placeholder="ws://127.0.0.1:8959/ws" class="svelte-1uha8ag"/></label> <div class="two-up svelte-1uha8ag"><label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Channel</span> <input${attr("value", connectionForm.channel)} placeholder="web" class="svelte-1uha8ag"/></label> <label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Subject</span> <input${attr("value", connectionForm.subject)} placeholder="local-dev-user" class="svelte-1uha8ag"/></label></div> <div class="two-up svelte-1uha8ag"><label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Tenant</span> <input${attr("value", connectionForm.tenantId)} placeholder="Optional tenant" class="svelte-1uha8ag"/></label> <label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Roles</span> <input${attr("value", connectionForm.roles)} placeholder="operator, reviewer" class="svelte-1uha8ag"/></label></div> <label class="toggle-row svelte-1uha8ag"><input type="checkbox"${attr("checked", connectionForm.useLocalDevToken, true)} class="svelte-1uha8ag"/> <span class="svelte-1uha8ag">Mint a local dev JWT on the SvelteKit server</span></label> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <div class="button-row svelte-1uha8ag"><button class="primary-button svelte-1uha8ag" type="button"${attr("disabled", isConnecting, true)}>${escape_html("Connect")}</button> <button class="ghost-button svelte-1uha8ag" type="button"${attr("disabled", socketState !== "connected", true)}>Disconnect</button></div> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]--> <div class="feed-card svelte-1uha8ag"><!--[-->`);
    const each_array = ensure_array_like(feed);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let entry = each_array[$$index];
      $$renderer2.push(`<article${attr_class(`feed-entry ${entry.kind}`, "svelte-1uha8ag")}><header class="svelte-1uha8ag"><span class="entry-kind svelte-1uha8ag">${escape_html(entry.kind)}</span> <span class="entry-time svelte-1uha8ag">${escape_html(formatClockTime(entry.timestamp))}</span></header> <p class="svelte-1uha8ag">${escape_html(entry.content)}</p></article>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="composer-card svelte-1uha8ag"><div class="composer-toggle svelte-1uha8ag"><button type="button"${attr_class("svelte-1uha8ag", void 0, { "active": composerMode === "chat" })}>Chat</button> <button type="button"${attr_class("svelte-1uha8ag", void 0, { "active": composerMode === "run" })}>Run</button></div> <label class="svelte-1uha8ag"><span class="svelte-1uha8ag">${escape_html("Send a message")}</span> <textarea rows="4"${attr(
      "placeholder",
      "Ask the agent something useful"
    )} class="svelte-1uha8ag">`);
    const $$body_1 = escape_html(composerText);
    if ($$body_1) {
      $$renderer2.push(`${$$body_1}`);
    }
    $$renderer2.push(`</textarea></label> <div class="button-row compact svelte-1uha8ag"><label class="toggle-row inline-toggle svelte-1uha8ag"><input type="checkbox"${attr("checked", showEvents, true)} class="svelte-1uha8ag"/> <span class="svelte-1uha8ag">show live events in the feed</span></label> <button class="primary-button svelte-1uha8ag" type="button">${escape_html("Send")}</button></div></div></section> <aside class="activity-panel svelte-1uha8ag"><section class="activity-card svelte-1uha8ag"><p class="panel-kicker svelte-1uha8ag">Live state</p> <h2 class="svelte-1uha8ag">Session stack</h2> <dl class="svelte-1uha8ag"><div class="svelte-1uha8ag"><dt class="svelte-1uha8ag">Chat session</dt> <dd class="svelte-1uha8ag">${escape_html(truncateId())}</dd></div> <div class="svelte-1uha8ag"><dt class="svelte-1uha8ag">Run session</dt> <dd class="svelte-1uha8ag">${escape_html(truncateId())}</dd></div> <div class="svelte-1uha8ag"><dt class="svelte-1uha8ag">Channel</dt> <dd class="svelte-1uha8ag">${escape_html(connectionForm.channel)}</dd></div></dl></section> <section class="activity-card emphasis svelte-1uha8ag"><p class="panel-kicker svelte-1uha8ag">Realtime</p> <h2 class="svelte-1uha8ag">Latest agent event</h2> `);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<p class="placeholder-copy svelte-1uha8ag">No realtime events yet. Connect and start a chat or run to watch the stream.</p>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="activity-card svelte-1uha8ag"><p class="panel-kicker svelte-1uha8ag">Pending work</p> <h2 class="svelte-1uha8ag">Interruptions</h2> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="placeholder-copy svelte-1uha8ag">No pending approvals or clarification prompts.</p>`);
    }
    $$renderer2.push(`<!--]--></section></aside></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
