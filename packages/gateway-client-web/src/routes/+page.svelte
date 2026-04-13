<svelte:options runes={true} />

<script lang="ts">
  import '@fontsource-variable/fraunces';
  import '@fontsource/ibm-plex-sans/400.css';
  import '@fontsource/ibm-plex-sans/500.css';
  import '@fontsource/ibm-plex-sans/600.css';
  import '@fontsource/ibm-plex-mono/500.css';

  import { onDestroy, tick } from 'svelte';

  import type { OutboundFrame } from '@adaptive-agent/gateway-fastify';

  import {
    formatClockTime,
    formatCompactAgentEventFrame,
    formatRunOutput,
    GatewayWebClient,
    isClarificationRequestOutput,
    summarizeAgentEvent,
    truncateId,
    type LiveAgentEventSummary,
    type SocketState,
  } from '$lib/gateway';

  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type ComposerMode = 'chat' | 'run';
  type FeedKind = 'assistant' | 'user' | 'run' | 'system' | 'event';

  interface FeedEntry {
    id: string;
    kind: FeedKind;
    content: string;
    timestamp: Date;
  }

  interface PendingApproval {
    runId: string;
    toolName?: string;
    reason?: string;
  }

  interface PendingClarification {
    runId: string;
    message: string;
    suggestedQuestions: string[];
  }

  let client: GatewayWebClient | null = null;
  let feedElement: HTMLDivElement | undefined;

  let socketState = $state<SocketState>('idle');
  let socketDetail = $state('');
  let sessionStatus = $state<'idle' | 'running' | 'awaiting_approval' | 'closed' | 'failed'>('idle');
  let showConnectionPanel = $state(true);
  let showEvents = $state(true);
  let isConnecting = $state(false);
  let composerMode = $state<ComposerMode>('chat');
  let composerText = $state('');
  let clarifyDraft = $state('');
  let latestEvent = $state<LiveAgentEventSummary | null>(null);
  let chatSessionId = $state<string | null>(null);
  let runSessionId = $state<string | null>(null);
  let pendingApproval = $state<PendingApproval | null>(null);
  let pendingClarification = $state<PendingClarification | null>(null);
  let seededDefaults = false;
  let connectionForm = $state({
    socketUrl: '',
    channel: '',
    subject: '',
    tenantId: '',
    roles: '',
    token: '',
    useLocalDevToken: true,
  });
  let feed = $state<FeedEntry[]>([
    {
      id: crypto.randomUUID(),
      kind: 'system',
      content:
        'Pocket Gateway mirrors the TUI flow in a mobile-first shell: chat turns, dedicated runs, live agent events, approvals, and clarification loops.',
      timestamp: new Date(),
    },
  ]);

  const pendingChip = $derived(
    pendingApproval
      ? 'approval needed'
      : pendingClarification
        ? 'clarification needed'
        : socketState === 'connected'
          ? 'ready'
          : 'offline',
  );

  $effect(() => {
    if (seededDefaults) {
      return;
    }

    const defaults = data.defaults;
    connectionForm = {
      ...connectionForm,
      socketUrl: defaults.socketUrl,
      channel: defaults.channel,
      subject: defaults.subject,
      tenantId: defaults.tenantId,
      roles: defaults.roles.join(', '),
    };
    seededDefaults = true;
  });

  $effect(() => {
    feed.length;

    void tick().then(() => {
      feedElement?.scrollTo({
        top: feedElement.scrollHeight,
        behavior: 'smooth',
      });
    });
  });

  onDestroy(() => {
    client?.disconnect(1000, 'page teardown');
  });

  function addFeedEntry(kind: FeedKind, content: string): void {
    feed = [
      ...feed,
      {
        id: crypto.randomUUID(),
        kind,
        content,
        timestamp: new Date(),
      },
    ];
  }

  function parseRoles(value: string): string[] {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  async function connect(): Promise<void> {
    isConnecting = true;
    socketDetail = '';

    try {
      client?.disconnect(1000, 'reconnecting');
      pendingApproval = null;
      pendingClarification = null;
      latestEvent = null;
      sessionStatus = 'idle';
      chatSessionId = null;
      runSessionId = null;

      const roles = parseRoles(connectionForm.roles);
      const token = connectionForm.useLocalDevToken
        ? await requestLocalToken({
            subject: connectionForm.subject,
            tenantId: connectionForm.tenantId,
            roles,
          })
        : connectionForm.token.trim();

      if (!token) {
        throw new Error('A JWT is required. Keep local token minting enabled or paste a custom token.');
      }

      client = new GatewayWebClient({
        socketUrl: connectionForm.socketUrl.trim(),
        channel: connectionForm.channel.trim(),
        token,
        onFrame: handleFrame,
        onSocketStateChange: (state, detail) => {
          socketState = state;
          socketDetail = detail ?? '';

          if (state === 'closed' && detail) {
            addFeedEntry('system', `Socket closed (${detail}).`);
          }

          if (state === 'error' && detail) {
            addFeedEntry('system', detail);
          }
        },
        onSessionIdsChange: (sessionIds) => {
          chatSessionId = sessionIds.sessionId ?? null;
          runSessionId = sessionIds.runSessionId ?? null;
        },
      });

      await client.connect();
      showConnectionPanel = false;
      addFeedEntry('system', `Connected to ${connectionForm.socketUrl.trim()} on channel ${connectionForm.channel.trim()}.`);
    } catch (error) {
      addFeedEntry('system', `Connect failed: ${error instanceof Error ? error.message : String(error)}`);
      socketState = 'error';
    } finally {
      isConnecting = false;
    }
  }

  function disconnect(): void {
    client?.disconnect(1000, 'user disconnected');
    client = null;
    socketState = 'closed';
    addFeedEntry('system', 'Disconnected from the gateway.');
  }

  async function submitComposer(): Promise<void> {
    const trimmed = composerText.trim();
    if (!trimmed) {
      return;
    }

    if (!client) {
      addFeedEntry('system', 'Connect to the gateway before sending anything.');
      return;
    }

    try {
      if (composerMode === 'chat') {
        client.sendChat(trimmed);
        addFeedEntry('user', trimmed);
      } else {
        await client.startRun(trimmed);
        addFeedEntry('user', `Run: ${trimmed}`);
      }

      composerText = '';
    } catch (error) {
      addFeedEntry('system', `Send failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function handleFrame(frame: OutboundFrame): void {
    switch (frame.type) {
      case 'session.opened':
        addFeedEntry('system', `Session opened: ${frame.sessionId} (${frame.status})`);
        sessionStatus = frame.status;
        break;
      case 'session.updated':
        sessionStatus = frame.status;
        addFeedEntry('system', `Session updated: ${frame.status} (activeRunId=${frame.activeRunId ?? 'none'})`);
        break;
      case 'message.output':
        addFeedEntry('assistant', frame.message.content);
        break;
      case 'run.output':
        if (frame.status === 'failed') {
          sessionStatus = 'failed';
          addFeedEntry('system', `Run failed: ${frame.error ?? 'unknown error'}`);
          pendingClarification = null;
          clarifyDraft = '';
          break;
        }

        if (isClarificationRequestOutput(frame.output)) {
          pendingClarification = {
            runId: frame.runId,
            message: frame.output.message,
            suggestedQuestions: frame.output.suggestedQuestions,
          };
          clarifyDraft = frame.output.suggestedQuestions[0] ?? '';
          addFeedEntry('system', `Clarification requested for ${frame.runId}: ${frame.output.message}`);
          break;
        }

        pendingClarification = null;
        clarifyDraft = '';
        addFeedEntry('run', formatRunOutput(frame.output));
        break;
      case 'approval.requested':
        sessionStatus = 'awaiting_approval';
        pendingApproval = {
          runId: frame.runId,
          toolName: frame.toolName,
          reason: frame.reason,
        };
        addFeedEntry(
          'system',
          `Approval requested for ${frame.runId}${frame.toolName ? ` (${frame.toolName})` : ''}${frame.reason ? `\n${frame.reason}` : ''}`,
        );
        break;
      case 'agent.event': {
        latestEvent = summarizeAgentEvent(frame);
        if (showEvents) {
          addFeedEntry('event', formatCompactAgentEventFrame(frame));
        }
        break;
      }
      case 'error':
        addFeedEntry('system', `Error [${frame.code}]: ${frame.message}`);
        break;
      case 'pong':
        addFeedEntry('system', `Pong${frame.id ? ` (${frame.id})` : ''}`);
        break;
    }
  }

  async function approve(approved: boolean): Promise<void> {
    if (!client || !pendingApproval) {
      return;
    }

    try {
      client.resolveApproval(pendingApproval.runId, approved);
      addFeedEntry('system', `${approved ? 'Approved' : 'Rejected'} ${pendingApproval.runId}.`);
      pendingApproval = null;
    } catch (error) {
      addFeedEntry('system', `Approval failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function applySuggestion(question: string): void {
    clarifyDraft = question;
  }

  function closeClarificationSheet(): void {
    pendingClarification = null;
    clarifyDraft = '';
  }

  async function submitClarification(): Promise<void> {
    if (!client || !pendingClarification) {
      return;
    }

    const trimmed = clarifyDraft.trim();
    if (!trimmed) {
      return;
    }

    try {
      client.resolveClarification(pendingClarification.runId, trimmed);
      addFeedEntry('user', `Clarification: ${trimmed}`);
      pendingClarification = null;
      clarifyDraft = '';
    } catch (error) {
      addFeedEntry('system', `Clarification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function requestLocalToken(payload: { subject: string; tenantId: string; roles: string[] }): Promise<string> {
    const response = await fetch('/api/dev-token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({ message: 'Unable to mint a local token.' }));
    if (!response.ok || typeof result?.token !== 'string') {
      throw new Error(typeof result?.message === 'string' ? result.message : 'Unable to mint a local token.');
    }

    return result.token;
  }
</script>

<svelte:head>
  <title>Pocket Gateway</title>
  <meta
    name="description"
    content="Mobile-first Svelte gateway client with chat, runs, live agent events, approvals, and clarification flows."
  />
</svelte:head>

<div class="page-shell">
  <div class="backdrop aura-left"></div>
  <div class="backdrop aura-right"></div>

  <section class="hero-card">
    <div>
      <p class="eyebrow">Adaptive Agent Gateway</p>
      <h1>Pocket Gateway</h1>
      <p class="lede">
        A mobile-first control surface for live gateway sessions, shaped like an operations notebook instead of a terminal.
      </p>
    </div>

    <div class="hero-status">
      <span class={`status-pill state-${socketState}`}>{socketState}</span>
      <span class="status-pill secondary">{pendingChip}</span>
      <span class="status-pill secondary">session {sessionStatus}</span>
    </div>
  </section>

  <div class="workspace-grid">
    <section class="conversation-panel">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Connection</p>
          <h2>Gateway socket</h2>
        </div>

        <button class="ghost-button" type="button" onclick={() => (showConnectionPanel = !showConnectionPanel)}>
          {showConnectionPanel ? 'Collapse' : 'Edit'}
        </button>
      </div>

      {#if showConnectionPanel}
        <div class="connection-card">
          <label>
            <span>Socket URL</span>
            <input bind:value={connectionForm.socketUrl} placeholder="ws://127.0.0.1:8959/ws" />
          </label>

          <div class="two-up">
            <label>
              <span>Channel</span>
              <input bind:value={connectionForm.channel} placeholder="web" />
            </label>

            <label>
              <span>Subject</span>
              <input bind:value={connectionForm.subject} placeholder="local-dev-user" />
            </label>
          </div>

          <div class="two-up">
            <label>
              <span>Tenant</span>
              <input bind:value={connectionForm.tenantId} placeholder="Optional tenant" />
            </label>

            <label>
              <span>Roles</span>
              <input bind:value={connectionForm.roles} placeholder="operator, reviewer" />
            </label>
          </div>

          <label class="toggle-row">
            <input type="checkbox" bind:checked={connectionForm.useLocalDevToken} />
            <span>Mint a local dev JWT on the SvelteKit server</span>
          </label>

          {#if !connectionForm.useLocalDevToken}
            <label>
              <span>Custom token</span>
              <textarea bind:value={connectionForm.token} rows="3" placeholder="Paste a bearer JWT"></textarea>
            </label>
          {/if}

          <div class="button-row">
            <button class="primary-button" type="button" onclick={connect} disabled={isConnecting}>
              {isConnecting ? 'Connecting…' : 'Connect'}
            </button>
            <button class="ghost-button" type="button" onclick={disconnect} disabled={socketState !== 'connected'}>
              Disconnect
            </button>
          </div>

          {#if socketDetail}
            <p class="detail-note">{socketDetail}</p>
          {/if}
        </div>
      {/if}

      <div class="feed-card" bind:this={feedElement}>
        {#each feed as entry (entry.id)}
          <article class={`feed-entry ${entry.kind}`}>
            <header>
              <span class="entry-kind">{entry.kind}</span>
              <span class="entry-time">{formatClockTime(entry.timestamp)}</span>
            </header>
            <p>{entry.content}</p>
          </article>
        {/each}
      </div>

      <div class="composer-card">
        <div class="composer-toggle">
          <button
            type="button"
            class:active={composerMode === 'chat'}
            onclick={() => (composerMode = 'chat')}
          >
            Chat
          </button>
          <button
            type="button"
            class:active={composerMode === 'run'}
            onclick={() => (composerMode = 'run')}
          >
            Run
          </button>
        </div>

        <label>
          <span>{composerMode === 'chat' ? 'Send a message' : 'Start a structured run'}</span>
          <textarea
            bind:value={composerText}
            rows="4"
            placeholder={composerMode === 'chat'
              ? 'Ask the agent something useful'
              : 'Describe a goal for a dedicated run'}
          ></textarea>
        </label>

        <div class="button-row compact">
          <label class="toggle-row inline-toggle">
            <input type="checkbox" bind:checked={showEvents} />
            <span>show live events in the feed</span>
          </label>

          <button class="primary-button" type="button" onclick={submitComposer}>
            {composerMode === 'chat' ? 'Send' : 'Launch run'}
          </button>
        </div>
      </div>
    </section>

    <aside class="activity-panel">
      <section class="activity-card">
        <p class="panel-kicker">Live state</p>
        <h2>Session stack</h2>
        <dl>
          <div>
            <dt>Chat session</dt>
            <dd>{truncateId(chatSessionId ?? undefined)}</dd>
          </div>
          <div>
            <dt>Run session</dt>
            <dd>{truncateId(runSessionId ?? undefined)}</dd>
          </div>
          <div>
            <dt>Channel</dt>
            <dd>{connectionForm.channel}</dd>
          </div>
        </dl>
      </section>

      <section class="activity-card emphasis">
        <p class="panel-kicker">Realtime</p>
        <h2>Latest agent event</h2>
        {#if latestEvent}
          <p class="event-line">{latestEvent.compactText}</p>
          <dl>
            <div>
              <dt>Event</dt>
              <dd>{latestEvent.eventType}</dd>
            </div>
            <div>
              <dt>Run</dt>
              <dd>{truncateId(latestEvent.runId)}</dd>
            </div>
            <div>
              <dt>Seq</dt>
              <dd>{latestEvent.seq ?? 'n/a'}</dd>
            </div>
          </dl>
        {:else}
          <p class="placeholder-copy">No realtime events yet. Connect and start a chat or run to watch the stream.</p>
        {/if}
      </section>

      <section class="activity-card">
        <p class="panel-kicker">Pending work</p>
        <h2>Interruptions</h2>
        {#if pendingApproval}
          <div class="interruption-card">
            <strong>Approval</strong>
            <p>{pendingApproval.toolName ?? 'Tool'} needs a decision.</p>
          </div>
        {/if}
        {#if pendingClarification}
          <div class="interruption-card">
            <strong>Clarification</strong>
            <p>{pendingClarification.message}</p>
          </div>
        {/if}
        {#if !pendingApproval && !pendingClarification}
          <p class="placeholder-copy">No pending approvals or clarification prompts.</p>
        {/if}
      </section>
    </aside>
  </div>

  {#if pendingApproval}
    <div class="sheet-backdrop" role="presentation" onclick={() => (pendingApproval = null)}></div>
    <section class="sheet" aria-label="Approval request">
      <p class="panel-kicker">Approval required</p>
      <h2>{pendingApproval.toolName ?? 'Tool invocation'}</h2>
      <p class="sheet-copy">{pendingApproval.reason ?? 'The gateway is waiting for a yes or no decision.'}</p>
      <div class="button-row">
        <button class="ghost-button" type="button" onclick={() => approve(false)}>Reject</button>
        <button class="primary-button" type="button" onclick={() => approve(true)}>Approve</button>
      </div>
    </section>
  {/if}

  {#if pendingClarification}
    <div class="sheet-backdrop" role="presentation" onclick={closeClarificationSheet}></div>
    <section class="sheet" aria-label="Clarification request">
      <p class="panel-kicker">Clarification required</p>
      <h2>Answer the follow-up</h2>
      <p class="sheet-copy">{pendingClarification.message}</p>

      {#if pendingClarification.suggestedQuestions.length > 0}
        <div class="suggestion-row">
          {#each pendingClarification.suggestedQuestions as question}
            <button class="suggestion-chip" type="button" onclick={() => applySuggestion(question)}>{question}</button>
          {/each}
        </div>
      {/if}

      <label>
        <span>Your answer</span>
        <textarea bind:value={clarifyDraft} rows="4" placeholder="Tell the agent what it needs to know"></textarea>
      </label>

      <div class="button-row">
        <button class="ghost-button" type="button" onclick={closeClarificationSheet}>Dismiss</button>
        <button class="primary-button" type="button" onclick={submitClarification}>Send answer</button>
      </div>
    </section>
  {/if}
</div>

<style>
  :global(html) {
    color-scheme: dark;
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(242, 186, 92, 0.16), transparent 28%),
      radial-gradient(circle at top right, rgba(197, 221, 255, 0.14), transparent 32%),
      linear-gradient(180deg, #16120d 0%, #0b0d11 100%);
    color: #f5efe5;
    font-family: 'IBM Plex Sans', sans-serif;
  }

  .page-shell {
    --paper: rgba(245, 233, 214, 0.08);
    --paper-strong: rgba(245, 233, 214, 0.12);
    --line: rgba(255, 239, 215, 0.14);
    --ink-soft: rgba(245, 239, 229, 0.72);
    --ember: #f2ba5c;
    --mint: #92ffd8;
    --danger: #ff8579;
    position: relative;
    min-height: 100vh;
    padding: 1rem;
    overflow-x: hidden;
  }

  .backdrop {
    position: fixed;
    inset: auto;
    width: 20rem;
    height: 20rem;
    border-radius: 999px;
    filter: blur(70px);
    opacity: 0.55;
    pointer-events: none;
  }

  .aura-left {
    top: -4rem;
    left: -4rem;
    background: rgba(242, 186, 92, 0.3);
  }

  .aura-right {
    top: 10rem;
    right: -5rem;
    background: rgba(112, 180, 255, 0.24);
  }

  .hero-card,
  .connection-card,
  .feed-card,
  .composer-card,
  .activity-card,
  .sheet {
    position: relative;
    background: linear-gradient(180deg, rgba(255, 248, 237, 0.08), rgba(255, 248, 237, 0.04));
    border: 1px solid var(--line);
    border-radius: 1.5rem;
    backdrop-filter: blur(18px);
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.28);
  }

  .hero-card {
    display: grid;
    gap: 1rem;
    padding: 1.35rem;
    margin-bottom: 1rem;
  }

  .eyebrow,
  .panel-kicker {
    margin: 0 0 0.45rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.68rem;
    color: var(--ember);
  }

  h1,
  h2 {
    margin: 0;
    font-family: 'Fraunces Variable', serif;
    font-weight: 600;
    line-height: 0.98;
  }

  h1 {
    font-size: clamp(2.3rem, 12vw, 4.5rem);
  }

  h2 {
    font-size: clamp(1.55rem, 5vw, 2.1rem);
  }

  .lede,
  .placeholder-copy,
  .detail-note,
  .sheet-copy {
    margin: 0;
    color: var(--ink-soft);
    line-height: 1.5;
  }

  .hero-status,
  .button-row,
  .composer-toggle,
  .suggestion-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.6rem 0.9rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 245, 228, 0.12);
    background: rgba(255, 245, 228, 0.08);
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .secondary {
    color: var(--ink-soft);
  }

  .state-connected {
    color: var(--mint);
  }

  .state-error,
  .state-closed {
    color: var(--danger);
  }

  .workspace-grid {
    display: grid;
    gap: 1rem;
  }

  .conversation-panel,
  .activity-panel {
    display: grid;
    gap: 1rem;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 1rem;
  }

  .connection-card,
  .composer-card,
  .activity-card,
  .sheet {
    padding: 1rem;
  }

  .feed-card {
    display: grid;
    gap: 0.8rem;
    min-height: 24rem;
    max-height: 46rem;
    overflow-y: auto;
    padding: 0.9rem;
  }

  .feed-entry {
    display: grid;
    gap: 0.5rem;
    padding: 0.9rem 0.95rem;
    border-radius: 1.15rem;
    border: 1px solid rgba(255, 245, 228, 0.08);
    background: rgba(10, 10, 12, 0.28);
  }

  .feed-entry header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
  }

  .feed-entry p {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.58;
  }

  .feed-entry.user {
    background: linear-gradient(135deg, rgba(242, 186, 92, 0.16), rgba(242, 186, 92, 0.08));
  }

  .feed-entry.assistant {
    background: linear-gradient(135deg, rgba(102, 175, 255, 0.14), rgba(102, 175, 255, 0.06));
  }

  .feed-entry.event {
    background: rgba(255, 255, 255, 0.04);
    border-style: dashed;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.92rem;
  }

  .feed-entry.run {
    background: rgba(146, 255, 216, 0.08);
  }

  label {
    display: grid;
    gap: 0.45rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  label span {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  input,
  textarea,
  button {
    font: inherit;
  }

  input,
  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(255, 245, 228, 0.12);
    border-radius: 1rem;
    background: rgba(8, 8, 10, 0.42);
    color: #f6efe2;
    padding: 0.92rem 1rem;
    resize: vertical;
  }

  input:focus,
  textarea:focus {
    outline: 2px solid rgba(242, 186, 92, 0.32);
    outline-offset: 2px;
  }

  .two-up {
    display: grid;
    gap: 0.75rem;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .toggle-row span {
    font-size: 0.83rem;
    letter-spacing: 0.05em;
  }

  .toggle-row input {
    width: auto;
    accent-color: var(--ember);
  }

  .inline-toggle {
    margin-right: auto;
  }

  button {
    cursor: pointer;
    border: 0;
    border-radius: 999px;
    padding: 0.82rem 1.15rem;
    transition:
      transform 150ms ease,
      background 150ms ease,
      border-color 150ms ease;
  }

  button:hover {
    transform: translateY(-1px);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .primary-button {
    background: linear-gradient(135deg, #f2ba5c, #f08d64);
    color: #1e1308;
    font-weight: 600;
  }

  .ghost-button,
  .composer-toggle button,
  .suggestion-chip {
    background: rgba(255, 245, 228, 0.07);
    color: #f6efe2;
    border: 1px solid rgba(255, 245, 228, 0.1);
  }

  .composer-toggle button.active {
    background: rgba(242, 186, 92, 0.18);
    border-color: rgba(242, 186, 92, 0.34);
    color: #fff3dd;
  }

  .activity-card dl {
    display: grid;
    gap: 0.7rem;
    margin: 1rem 0 0;
  }

  .activity-card dl div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid rgba(255, 245, 228, 0.08);
  }

  .activity-card dt {
    color: var(--ink-soft);
  }

  .activity-card dd {
    margin: 0;
    font-family: 'IBM Plex Mono', monospace;
    text-align: right;
  }

  .event-line {
    margin: 0.9rem 0 0;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.96rem;
    line-height: 1.6;
  }

  .emphasis {
    background: linear-gradient(180deg, rgba(146, 255, 216, 0.08), rgba(255, 248, 237, 0.04));
  }

  .interruption-card {
    padding: 0.8rem 0.9rem;
    border-radius: 1rem;
    background: rgba(242, 186, 92, 0.09);
    border: 1px solid rgba(242, 186, 92, 0.16);
  }

  .interruption-card p {
    margin: 0.35rem 0 0;
    color: var(--ink-soft);
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 4, 5, 0.62);
    backdrop-filter: blur(12px);
  }

  .sheet {
    position: fixed;
    left: 1rem;
    right: 1rem;
    bottom: 1rem;
    z-index: 10;
    animation: slide-up 180ms ease;
  }

  @keyframes slide-up {
    from {
      transform: translateY(2rem);
      opacity: 0;
    }

    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @media (min-width: 700px) {
    .page-shell {
      padding: 1.4rem;
    }

    .two-up {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 1060px) {
    .workspace-grid {
      grid-template-columns: minmax(0, 1.65fr) minmax(18rem, 0.92fr);
      align-items: start;
    }

    .activity-panel {
      position: sticky;
      top: 1rem;
    }

    .sheet {
      left: auto;
      right: 1.4rem;
      width: min(32rem, calc(100vw - 2.8rem));
    }
  }
</style>
