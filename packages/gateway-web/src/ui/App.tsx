import type { FormEvent } from 'react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { GatewayWebClient, loadGatewayDefaults, mintDevToken } from '../gateway/client';
import {
  eventTone,
  formatClockTime,
  formatRunOutput,
  isClarificationRequestOutput,
  shortId,
  summarizeAgentEvent,
} from '../gateway/format';
import type {
  ComposerMode,
  FeedEntry,
  GatewayDefaults,
  GatewayIdentity,
  LiveAgentEventSummary,
  LiveGatewayState,
  PendingApproval,
  PendingClarification,
  RunActivity,
  TraceView,
} from '../gateway/types';
import type { OutboundFrame, SessionStatus } from '../gateway/protocol';

type Action =
  | { type: 'socket'; state: LiveGatewayState['socketState']; detail?: string }
  | { type: 'session.ids'; sessionId?: string; runSessionId?: string }
  | { type: 'feed'; entry: FeedEntry }
  | { type: 'frame'; frame: OutboundFrame }
  | { type: 'reset-live' }
  | { type: 'hydrate'; state: LiveGatewayState }
  | { type: 'clear-attention'; runId: string };

const initialState: LiveGatewayState = {
  socketState: 'idle',
  socketDetail: '',
  session: {
    status: 'idle',
  },
  feed: [
    {
      id: crypto.randomUUID(),
      kind: 'system',
      content: 'Connect to the gateway, start a chat turn or run, and watch live agent events become the progress stream.',
      timestamp: new Date(),
    },
  ],
  events: [],
  runs: [],
};

const defaultIdentity: GatewayIdentity = {
  channel: 'web',
  subject: 'local-dev-user',
  tenantId: 'free',
  roles: ['member'],
};

export function App(): ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [route, setRoute] = useState(readRoute());
  const [defaults, setDefaults] = useState<GatewayDefaults>({
    socketUrl: 'ws://127.0.0.1:8959/ws',
    ...defaultIdentity,
  });
  const [socketUrl, setSocketUrl] = useState(defaults.socketUrl);
  const [identity, setIdentity] = useState<GatewayIdentity>(defaultIdentity);
  const [customToken, setCustomToken] = useState('');
  const [useDevToken, setUseDevToken] = useState(true);
  const [showConnect, setShowConnect] = useState(true);
  const [composerMode, setComposerMode] = useState<ComposerMode>('chat');
  const [composerText, setComposerText] = useState('');
  const [clarificationText, setClarificationText] = useState('');
  const [traceView, setTraceView] = useState<TraceView>('overview');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const clientRef = useRef<GatewayWebClient | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    loadGatewayDefaults()
      .then((loaded) => {
        if (!active) {
          return;
        }
        setDefaults(loaded);
        setSocketUrl(loaded.socketUrl);
        setIdentity({
          channel: loaded.channel,
          subject: loaded.subject,
          tenantId: loaded.tenantId,
          roles: loaded.roles,
        });
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    const saved = loadSavedLiveState();
    if (saved) {
      dispatch({ type: 'hydrate', state: saved });
    }
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    saveLiveState(state);
  }, [state]);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [state.feed.length]);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect(1000, 'page teardown');
    };
  }, []);

  const activeRun = useMemo(() => {
    if (state.session.activeRootRunId) {
      return state.runs.find((run) => run.rootRunId === state.session.activeRootRunId) ?? state.runs[0];
    }
    if (state.session.activeRunId) {
      return state.runs.find((run) => run.runId === state.session.activeRunId) ?? state.runs[0];
    }
    return state.runs[0];
  }, [state.runs, state.session.activeRootRunId, state.session.activeRunId]);

  async function connect(): Promise<void> {
    setIsConnecting(true);
    setError('');
    dispatch({ type: 'reset-live' });

    try {
      clientRef.current?.disconnect(1000, 'reconnecting');
      const token = useDevToken
        ? await mintDevToken({
            subject: identity.subject,
            tenantId: identity.tenantId,
            roles: identity.roles,
          })
        : customToken.trim();

      if (!token) {
        throw new Error('Paste a JWT or use the local dev token.');
      }

      const client = new GatewayWebClient({
        socketUrl,
        identity,
        token,
        onFrame: (frame) => dispatch({ type: 'frame', frame }),
        onSocketStateChange: (socketState, detail) => dispatch({ type: 'socket', state: socketState, detail }),
        onSessionIdsChange: (sessionIds) => dispatch({ type: 'session.ids', ...sessionIds }),
      });
      clientRef.current = client;
      await client.connect();
      setShowConnect(false);
      addFeed('system', `Connected as ${identity.subject} on ${identity.channel} (${identity.tenantId}, ${identity.roles.join(', ')}).`);
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : String(connectError);
      setError(message);
      dispatch({ type: 'socket', state: 'error', detail: message });
      addFeed('system', `Connect failed: ${message}`);
    } finally {
      setIsConnecting(false);
    }
  }

  function disconnect(): void {
    clientRef.current?.disconnect(1000, 'user disconnected');
    clientRef.current = null;
    dispatch({ type: 'socket', state: 'closed', detail: 'user disconnected' });
    addFeed('system', 'Disconnected from the gateway.');
  }

  async function submitComposer(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = composerText.trim();
    if (!text) {
      return;
    }
    if (!clientRef.current) {
      addFeed('system', 'Connect before sending a message.');
      return;
    }

    try {
      if (composerMode === 'chat') {
        clientRef.current.sendChat(text);
        addFeed('user', text);
      } else {
        await clientRef.current.startRun(text);
        addFeed('user', `Run: ${text}`);
      }
      setComposerText('');
    } catch (sendError) {
      addFeed('system', `Send failed: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
    }
  }

  function resolveApproval(approval: PendingApproval, approved: boolean): void {
    try {
      clientRef.current?.resolveApproval(approval.runId, approved);
      dispatch({ type: 'clear-attention', runId: approval.runId });
      addFeed('system', `${approved ? 'Approved' : 'Rejected'} ${shortId(approval.runId)}.`);
    } catch (approvalError) {
      addFeed('system', `Approval failed: ${approvalError instanceof Error ? approvalError.message : String(approvalError)}`);
    }
  }

  function submitClarification(event: FormEvent, clarification: PendingClarification): void {
    event.preventDefault();
    const message = clarificationText.trim();
    if (!message) {
      return;
    }

    try {
      clientRef.current?.resolveClarification(clarification.runId, message);
      dispatch({ type: 'clear-attention', runId: clarification.runId });
      addFeed('user', `Clarification: ${message}`);
      setClarificationText('');
    } catch (clarificationError) {
      addFeed('system', `Clarification failed: ${clarificationError instanceof Error ? clarificationError.message : String(clarificationError)}`);
    }
  }

  function retryRun(run: RunActivity): void {
    try {
      clientRef.current?.retryRun(run.runId);
      addFeed('system', `Retry requested for ${shortId(run.runId)}.`);
    } catch (retryError) {
      addFeed('system', `Retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
    }
  }

  function addFeed(kind: FeedEntry['kind'], content: string, runId?: string): void {
    dispatch({
      type: 'feed',
      entry: {
        id: crypto.randomUUID(),
        kind,
        content,
        timestamp: new Date(),
        runId,
      },
    });
  }

  function navigate(nextRoute: AppRoute): void {
    const path = nextRoute === 'history' ? '/history' : '/';
    window.history.pushState({}, '', path);
    setRoute(nextRoute);
  }

  if (route === 'history') {
    return (
      <HistoryPage
        state={state}
        traceView={traceView}
        setTraceView={setTraceView}
        onBack={() => navigate('home')}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            AS
          </div>
          <div>
            <p className="eyebrow">AgentSmith Gateway</p>
            <h1>Conversation with live run radar</h1>
          </div>
        </div>
        <div className="top-actions">
          <StatusPill state={state.socketState} label={state.socketState} />
          <span className="identity-pill">{identity.channel} · {identity.roles.join(', ') || 'member'} · {identity.tenantId || 'free'}</span>
          <button className="ghost-button" type="button" onClick={() => setShowConnect((value) => !value)}>
            Connection
          </button>
          <button className="ghost-button" type="button" onClick={() => navigate('history')}>
            History
          </button>
        </div>
      </header>

      {showConnect ? (
        <section className="connection-panel" aria-label="Connection settings">
          <label>
            Gateway socket
            <input value={socketUrl} onChange={(event) => setSocketUrl(event.target.value)} />
          </label>
          <label>
            Channel
            <input value={identity.channel} onChange={(event) => setIdentity({ ...identity, channel: event.target.value })} />
          </label>
          <label>
            Subject
            <input value={identity.subject} onChange={(event) => setIdentity({ ...identity, subject: event.target.value })} />
          </label>
          <label>
            Tenant
            <input value={identity.tenantId} onChange={(event) => setIdentity({ ...identity, tenantId: event.target.value })} />
          </label>
          <label>
            Roles
            <input
              value={identity.roles.join(', ')}
              onChange={(event) => setIdentity({ ...identity, roles: parseRoles(event.target.value) })}
            />
          </label>
          <label className="token-toggle">
            <input type="checkbox" checked={useDevToken} onChange={(event) => setUseDevToken(event.target.checked)} />
            Use local dev token
          </label>
          {!useDevToken ? (
            <label className="wide-field">
              JWT
              <textarea value={customToken} onChange={(event) => setCustomToken(event.target.value)} rows={3} />
            </label>
          ) : null}
          <div className="connection-actions">
            <button type="button" onClick={() => void connect()} disabled={isConnecting}>
              {isConnecting ? 'Connecting' : 'Connect'}
            </button>
            <button className="ghost-button" type="button" onClick={disconnect}>
              Disconnect
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setSocketUrl(defaults.socketUrl);
                setIdentity({
                  channel: defaults.channel,
                  subject: defaults.subject,
                  tenantId: defaults.tenantId,
                  roles: defaults.roles,
                });
              }}
            >
              Reset defaults
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </section>
      ) : null}

      <section className="workspace">
        <section className="conversation-panel" aria-label="Conversation">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Conversation</p>
              <h2>Live session</h2>
            </div>
            <span className="muted">session {shortId(state.session.sessionId)}</span>
          </div>

          <div ref={feedRef} className="feed">
            {state.feed.map((entry) => (
              <article className={`feed-entry ${entry.kind}`} key={entry.id}>
                <div className="feed-meta">
                  <span>{entry.kind}</span>
                  <time>{formatClockTime(entry.timestamp)}</time>
                </div>
                <p>{entry.content}</p>
              </article>
            ))}
          </div>

          {state.pendingApproval ? (
            <section className="attention-card">
              <p className="eyebrow">Approval needed</p>
              <h3>{state.pendingApproval.toolName ?? 'Tool request'}</h3>
              <p>{state.pendingApproval.reason ?? 'The run is waiting for a decision.'}</p>
              <div className="button-row">
                <button type="button" onClick={() => resolveApproval(state.pendingApproval as PendingApproval, true)}>
                  Approve
                </button>
                <button className="danger-button" type="button" onClick={() => resolveApproval(state.pendingApproval as PendingApproval, false)}>
                  Reject
                </button>
              </div>
            </section>
          ) : null}

          {state.pendingClarification ? (
            <form className="attention-card" onSubmit={(event) => submitClarification(event, state.pendingClarification as PendingClarification)}>
              <p className="eyebrow">Clarification requested</p>
              <h3>{state.pendingClarification.message}</h3>
              {state.pendingClarification.suggestedQuestions.length > 0 ? (
                <div className="suggestions">
                  {state.pendingClarification.suggestedQuestions.map((question) => (
                    <button type="button" key={question} onClick={() => setClarificationText(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="clarify-row">
                <input value={clarificationText} onChange={(event) => setClarificationText(event.target.value)} placeholder="Reply with the missing detail" />
                <button type="submit">Send</button>
              </div>
            </form>
          ) : null}

          <form className="composer" onSubmit={(event) => void submitComposer(event)}>
            <div className="mode-toggle" role="group" aria-label="Composer mode">
              <button className={composerMode === 'chat' ? 'selected' : ''} type="button" onClick={() => setComposerMode('chat')}>
                Chat
              </button>
              <button className={composerMode === 'run' ? 'selected' : ''} type="button" onClick={() => setComposerMode('run')}>
                Run
              </button>
            </div>
            <textarea
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              placeholder={composerMode === 'chat' ? 'Ask AgentSmith...' : 'Start a dedicated run...'}
              rows={3}
            />
            <button type="submit">{composerMode === 'chat' ? 'Send' : 'Start run'}</button>
          </form>
        </section>

        <aside className="radar-panel" aria-label="Run radar">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Run Radar</p>
              <h2>{activeRun ? `run:${shortId(activeRun.runId)}` : 'No active run'}</h2>
            </div>
            <StatusPill state={state.socketState} label={state.session.status} />
          </div>

          <div className="run-summary-grid">
            <Metric label="events" value={state.events.length.toString()} />
            <Metric label="runs" value={state.runs.length.toString()} />
            <Metric label="active" value={shortId(state.session.activeRunId)} />
          </div>

          <section className="run-list">
            {state.runs.length === 0 ? (
              <p className="empty-copy">Run activity will appear here as `agent.event` frames arrive.</p>
            ) : (
              state.runs.map((run) => (
                <article className="run-card" key={run.runId}>
                  <div className="run-card-top">
                    <span className={`run-status ${run.status}`}>{run.status}</span>
                    <span>{run.eventCount} events</span>
                  </div>
                  <h3>{run.goal ?? `run:${shortId(run.runId)}`}</h3>
                  <p>{run.latestEvent?.compactText ?? run.output ?? run.error ?? 'Waiting for the first event.'}</p>
                  {run.status === 'failed' ? (
                    <button className="ghost-button" type="button" onClick={() => retryRun(run)}>
                      Retry
                    </button>
                  ) : null}
                </article>
              ))
            )}
          </section>

          <section className="event-stream">
            <div className="section-heading">
              <h3>Live trace</h3>
              <span>{state.events.length} frames</span>
            </div>
            {state.events.slice(0, 12).map((event) => (
              <article className="event-row" key={`${event.runId ?? 'run'}-${event.seq ?? event.timestamp.getTime()}-${event.eventType}`}>
                <span className={`event-dot ${eventTone(event.eventType)}`} />
                <div>
                  <strong>{event.eventType}</strong>
                  <p>{event.compactText}</p>
                </div>
                <time>{formatClockTime(event.timestamp)}</time>
              </article>
            ))}
          </section>
        </aside>
      </section>
    </main>
  );
}

function reducer(state: LiveGatewayState, action: Action): LiveGatewayState {
  switch (action.type) {
    case 'socket':
      return {
        ...state,
        socketState: action.state,
        socketDetail: action.detail ?? '',
      };
    case 'session.ids':
      return {
        ...state,
        session: {
          ...state.session,
          sessionId: action.sessionId ?? state.session.sessionId,
          runSessionId: action.runSessionId ?? state.session.runSessionId,
        },
      };
    case 'feed':
      return {
        ...state,
        feed: [...state.feed, action.entry],
      };
    case 'frame':
      return applyFrame(state, action.frame);
    case 'reset-live':
      return {
        ...initialState,
        feed: [
          ...initialState.feed,
          {
            id: crypto.randomUUID(),
            kind: 'system',
            content: 'Preparing a fresh gateway session.',
            timestamp: new Date(),
          },
        ],
      };
    case 'hydrate':
      return {
        ...action.state,
        socketState: 'idle',
        socketDetail: '',
      };
    case 'clear-attention':
      return {
        ...state,
        pendingApproval: state.pendingApproval?.runId === action.runId ? undefined : state.pendingApproval,
        pendingClarification: state.pendingClarification?.runId === action.runId ? undefined : state.pendingClarification,
      };
    default:
      return state;
  }
}

function applyFrame(state: LiveGatewayState, frame: OutboundFrame): LiveGatewayState {
  switch (frame.type) {
    case 'session.opened':
      return appendFeed({
        ...state,
        session: {
          ...state.session,
          sessionId: state.session.sessionId ?? frame.sessionId,
          status: frame.status,
        },
      }, 'system', `Session opened: ${shortId(frame.sessionId)} (${frame.status})`);
    case 'session.updated':
      return appendFeed({
        ...state,
        session: {
          ...state.session,
          status: frame.status,
          activeRunId: frame.activeRunId,
          activeRootRunId: frame.activeRootRunId,
        },
      }, 'system', `Session updated: ${frame.status}${frame.activeRunId ? ` · run:${shortId(frame.activeRunId)}` : ''}`);
    case 'message.output':
      return appendFeed(state, 'assistant', frame.message.content, frame.runId);
    case 'run.output': {
      if (frame.status === 'failed') {
        return appendFeed({
          ...state,
          runs: upsertRun(state.runs, {
            runId: frame.runId,
            rootRunId: frame.rootRunId,
            sessionId: frame.sessionId,
            status: 'failed',
            error: frame.error ?? 'Run failed.',
          }),
        }, 'system', `Run failed: ${frame.error ?? 'unknown error'}`, frame.runId);
      }

      if (isClarificationRequestOutput(frame.output)) {
        return appendFeed({
          ...state,
          pendingClarification: {
            runId: frame.runId,
            sessionId: frame.sessionId,
            message: frame.output.message,
            suggestedQuestions: frame.output.suggestedQuestions,
          },
          runs: upsertRun(state.runs, {
            runId: frame.runId,
            rootRunId: frame.rootRunId,
            sessionId: frame.sessionId,
            status: 'awaiting_approval',
          }),
        }, 'system', `Clarification requested for run:${shortId(frame.runId)}.`, frame.runId);
      }

      const output = formatRunOutput(frame.output);
      return appendFeed({
        ...state,
        runs: upsertRun(state.runs, {
          runId: frame.runId,
          rootRunId: frame.rootRunId,
          sessionId: frame.sessionId,
          status: 'succeeded',
          output,
        }),
      }, 'run', output || `Run ${shortId(frame.runId)} succeeded.`, frame.runId);
    }
    case 'approval.requested':
      return appendFeed({
        ...state,
        pendingApproval: {
          runId: frame.runId,
          rootRunId: frame.rootRunId,
          sessionId: frame.sessionId,
          toolName: frame.toolName,
          reason: frame.reason,
        },
        runs: upsertRun(state.runs, {
          runId: frame.runId,
          rootRunId: frame.rootRunId,
          sessionId: frame.sessionId,
          status: 'awaiting_approval',
        }),
      }, 'system', `Approval requested${frame.toolName ? ` for ${frame.toolName}` : ''}.`, frame.runId);
    case 'agent.event': {
      const summary = summarizeAgentEvent(frame);
      return {
        ...state,
        events: [summary, ...state.events].slice(0, 250),
        runs: upsertRun(state.runs, {
          runId: frame.runId ?? frame.rootRunId ?? 'unknown',
          rootRunId: frame.rootRunId,
          status: inferRunStatus(summary, state.session.status),
          latestEvent: summary,
        }),
      };
    }
    case 'error':
      return appendFeed(state, 'system', `error[${frame.code}]: ${frame.message}`);
    case 'pong':
      return appendFeed(state, 'system', `pong${frame.id ? ` (${frame.id})` : ''}`);
    default:
      return state;
  }
}

function appendFeed(state: LiveGatewayState, kind: FeedEntry['kind'], content: string, runId?: string): LiveGatewayState {
  return {
    ...state,
    feed: [
      ...state.feed,
      {
        id: crypto.randomUUID(),
        kind,
        content,
        timestamp: new Date(),
        runId,
      },
    ],
  };
}

function upsertRun(runs: RunActivity[], patch: Partial<RunActivity> & { runId: string }): RunActivity[] {
  const now = new Date();
  const existing = runs.find((run) => run.runId === patch.runId);
  if (!existing) {
    return [
      {
        runId: patch.runId,
        rootRunId: patch.rootRunId,
        sessionId: patch.sessionId,
        status: patch.status ?? 'unknown',
        goal: patch.goal,
        latestEvent: patch.latestEvent,
        eventCount: patch.latestEvent ? 1 : 0,
        startedAt: now,
        updatedAt: now,
        output: patch.output,
        error: patch.error,
      },
      ...runs,
    ];
  }

  return runs.map((run) =>
    run.runId === patch.runId
      ? {
          ...run,
          ...patch,
          eventCount: patch.latestEvent ? run.eventCount + 1 : run.eventCount,
          updatedAt: now,
        }
      : run,
  );
}

function inferRunStatus(event: LiveAgentEventSummary, sessionStatus: SessionStatus): RunActivity['status'] {
  if (event.eventType.includes('failed')) {
    return 'failed';
  }
  if (event.eventType.includes('completed') || event.eventType.includes('succeeded')) {
    return 'succeeded';
  }
  if (sessionStatus === 'awaiting_approval') {
    return 'awaiting_approval';
  }
  return 'running';
}

function parseRoles(value: string): string[] {
  const roles = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return roles.length > 0 ? roles : ['member'];
}

function StatusPill(props: { state: LiveGatewayState['socketState']; label: string }): ReactElement {
  return <span className={`status-pill ${props.state}`}>{props.label}</span>;
}

function Metric(props: { label: string; value: string }): ReactElement {
  return (
    <div className="metric">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

type AppRoute = 'home' | 'history';

function HistoryPage(props: {
  state: LiveGatewayState;
  traceView: TraceView;
  setTraceView: (view: TraceView) => void;
  onBack: () => void;
}): ReactElement {
  const [sessionQuery, setSessionQuery] = useState(props.state.session.sessionId ?? '');
  const [rootRunQuery, setRootRunQuery] = useState(props.state.session.activeRootRunId ?? '');
  const [runQuery, setRunQuery] = useState(props.state.session.activeRunId ?? '');
  const selectedRun = props.state.runs.find((run) => run.runId === runQuery || run.rootRunId === rootRunQuery) ?? props.state.runs[0];
  const filteredEvents = props.state.events.filter((event) => {
    if (runQuery && event.runId !== runQuery) {
      return false;
    }
    if (rootRunQuery && event.rootRunId !== rootRunQuery) {
      return false;
    }
    return true;
  });

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            AS
          </div>
          <div>
            <p className="eyebrow">AgentSmith Gateway</p>
            <h1>History and trace</h1>
          </div>
        </div>
        <div className="top-actions">
          <span className="identity-pill">front-end trace cache</span>
          <button className="ghost-button" type="button" onClick={props.onBack}>
            Conversation
          </button>
        </div>
      </header>

      <section className="history-page">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Hydrated from this browser</p>
            <h2>Sessions, events, runs, outputs</h2>
          </div>
          <span className="muted">{props.state.events.length} events · {props.state.runs.length} runs</span>
        </div>

        <div className="trace-controls">
          <label>
            Session ID
            <input value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} placeholder={props.state.session.sessionId ?? 'session id'} />
          </label>
          <label>
            Root run ID
            <input value={rootRunQuery} onChange={(event) => setRootRunQuery(event.target.value)} placeholder={props.state.session.activeRootRunId ?? 'root run id'} />
          </label>
          <label>
            Focus run ID
            <input value={runQuery} onChange={(event) => setRunQuery(event.target.value)} placeholder={props.state.session.activeRunId ?? 'run id'} />
          </label>
        </div>

        <div className="trace-tabs">
          {(['overview', 'timeline', 'delegates', 'messages', 'plans'] satisfies TraceView[]).map((view) => (
            <button className={props.traceView === view ? 'selected' : ''} key={view} type="button" onClick={() => props.setTraceView(view)}>
              {view}
            </button>
          ))}
        </div>

        <div className="trace-page-grid">
          <TraceContent view={props.traceView} state={props.state} events={filteredEvents} selectedRun={selectedRun} sessionQuery={sessionQuery} rootRunQuery={rootRunQuery} runQuery={runQuery} />
          <aside className="trace-run-index">
            <h3>Runs</h3>
            {props.state.runs.length === 0 ? <p className="empty-copy">No runs captured yet.</p> : null}
            {props.state.runs.map((run) => (
              <button
                className="trace-run-button"
                key={run.runId}
                type="button"
                onClick={() => {
                  setRunQuery(run.runId);
                  setRootRunQuery(run.rootRunId ?? '');
                }}
              >
                <span>{run.goal ?? `run:${shortId(run.runId)}`}</span>
                <small>{run.status} · {run.eventCount} events</small>
              </button>
            ))}
          </aside>
        </div>
      </section>
    </main>
  );
}

function TraceContent(props: {
  view: TraceView;
  state: LiveGatewayState;
  events: LiveAgentEventSummary[];
  selectedRun?: RunActivity;
  sessionQuery: string;
  rootRunQuery: string;
  runQuery: string;
}): ReactElement {
  if (props.view === 'overview') {
    return (
      <section className="trace-preview">
        <div>
          <h3>Overview</h3>
          <p>Current browser cache for the selected session and run. This page survives reloads through local storage and stays front-end only.</p>
        </div>
        <div className="overview-grid">
          <Metric label="session" value={shortId(props.sessionQuery || props.state.session.sessionId)} />
          <Metric label="root run" value={shortId(props.rootRunQuery || props.selectedRun?.rootRunId)} />
          <Metric label="focus run" value={shortId(props.runQuery || props.selectedRun?.runId)} />
          <Metric label="status" value={props.selectedRun?.status ?? props.state.session.status} />
        </div>
        {props.selectedRun?.output ? <pre>{props.selectedRun.output}</pre> : null}
        {props.selectedRun?.error ? <pre>{props.selectedRun.error}</pre> : null}
      </section>
    );
  }

  if (props.view === 'timeline') {
    return (
      <section className="trace-preview">
        <div>
          <h3>Timeline</h3>
          <p>Live `agent.event` frames captured by the web client, newest first.</p>
        </div>
        <div className="trace-sample">
          {props.events.map((event) => (
            <span key={`${event.eventType}-${event.seq ?? event.timestamp.getTime()}`}>
              {formatClockTime(event.timestamp)} · {event.compactText}
            </span>
          ))}
          {props.events.length === 0 ? <span>No matching events captured yet.</span> : null}
        </div>
      </section>
    );
  }

  if (props.view === 'messages') {
    return (
      <section className="trace-preview">
        <div>
          <h3>Messages</h3>
          <p>Conversation and run outputs captured during browser use.</p>
        </div>
        <div className="trace-sample">
          {props.state.feed.map((entry) => (
            <span key={entry.id}>{entry.kind} · {formatClockTime(entry.timestamp)} · {entry.content}</span>
          ))}
        </div>
      </section>
    );
  }

  if (props.view === 'delegates') {
    const delegateEvents = props.events.filter((event) => event.toolName?.startsWith('delegate.') || event.eventType.includes('delegate'));
    return (
      <section className="trace-preview">
        <div>
          <h3>Delegates</h3>
          <p>Delegate activity inferred from live event names and tool names.</p>
        </div>
        <div className="trace-sample">
          {delegateEvents.map((event) => (
            <span key={`${event.eventType}-${event.seq ?? event.timestamp.getTime()}`}>{event.compactText}</span>
          ))}
          {delegateEvents.length === 0 ? <span>No delegate events captured for this run.</span> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="trace-preview">
      <div>
        <h3>Plans</h3>
        <p>Plan events inferred from live event names until persisted plan APIs are added.</p>
      </div>
      <div className="trace-sample">
        {props.events.filter((event) => event.eventType.includes('plan') || event.eventType === 'replan.required').map((event) => (
          <span key={`${event.eventType}-${event.seq ?? event.timestamp.getTime()}`}>{event.compactText}</span>
        ))}
        {props.events.filter((event) => event.eventType.includes('plan') || event.eventType === 'replan.required').length === 0 ? <span>No plan events captured for this run.</span> : null}
      </div>
    </section>
  );
}

function readRoute(): AppRoute {
  return window.location.pathname === '/history' ? 'history' : 'home';
}

const LIVE_STATE_STORAGE_KEY = 'agent-smith.gateway-web.live-state.v1';

function saveLiveState(state: LiveGatewayState): void {
  const snapshot: LiveGatewayState = {
    ...state,
    socketState: 'idle',
    socketDetail: '',
  };
  localStorage.setItem(LIVE_STATE_STORAGE_KEY, JSON.stringify(snapshot));
}

function loadSavedLiveState(): LiveGatewayState | undefined {
  const raw = localStorage.getItem(LIVE_STATE_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    return reviveLiveState(JSON.parse(raw) as LiveGatewayState);
  } catch {
    return undefined;
  }
}

function reviveLiveState(state: LiveGatewayState): LiveGatewayState {
  return {
    ...state,
    feed: state.feed.map((entry) => ({ ...entry, timestamp: new Date(entry.timestamp) })),
    events: state.events.map((event) => ({ ...event, timestamp: new Date(event.timestamp) })),
    runs: state.runs.map((run) => ({
      ...run,
      startedAt: new Date(run.startedAt),
      updatedAt: new Date(run.updatedAt),
      latestEvent: run.latestEvent ? { ...run.latestEvent, timestamp: new Date(run.latestEvent.timestamp) } : undefined,
    })),
  };
}
