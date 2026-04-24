import type { ReactElement } from 'react';

import { shortId } from '../../gateway/format';
import type { DashboardError, DashboardMessagesView, DashboardPendingApproval, DashboardTab, RunMessageTrace, TraceMessage, TraceReport } from './types';
import { StatusChip } from './DashboardRunList';

const TABS: DashboardTab[] = ['overview', 'output', 'messages', 'timeline', 'plans'];

export function DashboardInspector(props: {
  detail: TraceReport | undefined;
  selectedRootRunId: string;
  tab: DashboardTab;
  messagesView: DashboardMessagesView;
  focusRunId: string;
  isLoading: boolean;
  errorMessage?: string;
  approvalError?: DashboardError;
  deleteError?: DashboardError;
  approvingRunId: string;
  deletingRootRunId: string;
  pendingApproval?: DashboardPendingApproval | null;
  canDeleteRun: boolean;
  onTabChange: (tab: DashboardTab) => void;
  onMessagesViewChange: (view: DashboardMessagesView) => void;
  onFocusRunIdChange: (runId: string) => void;
  onDeleteRun: (rootRunId: string) => void;
  onResolveApproval: (runId: string, approved: boolean) => void;
}): ReactElement {
  const root = props.detail?.rootRuns[0];
  const deleteDisabled = props.deletingRootRunId === props.selectedRootRunId;

  return (
    <section className="dashboard-inspector" aria-label="Run inspector">
      <div className="dashboard-panel-head">
        <div>
          <p className="eyebrow">Inspector Dossier</p>
          <h2>{props.selectedRootRunId ? `root:${shortId(props.selectedRootRunId)}` : 'Select a root run'}</h2>
        </div>
        <div className="dashboard-panel-actions">
          {props.canDeleteRun ? (
            <button
              className="dashboard-delete-icon-button"
              type="button"
              disabled={deleteDisabled}
              title="Delete sessionless run"
              aria-label="Delete sessionless run"
              onClick={() => {
                if (window.confirm(`Delete sessionless run ${props.selectedRootRunId}? This cannot be undone.`)) {
                  props.onDeleteRun(props.selectedRootRunId);
                }
              }}
            >
              <TrashIcon />
            </button>
          ) : null}
          {root ? <StatusChip status={root.status} /> : null}
        </div>
      </div>

      {props.pendingApproval ? (
        <div className="dashboard-approval-callout">
          <div>
            <strong>{props.pendingApproval.toolName ?? 'Approval required'}</strong>
            <span>{props.pendingApproval.reason ?? 'This run is waiting for an admin decision.'}</span>
          </div>
          <button type="button" disabled={props.approvingRunId === props.pendingApproval.runId} onClick={() => props.onResolveApproval(props.pendingApproval?.runId ?? '', true)}>
            Approve
          </button>
          <button className="danger-button" type="button" disabled={props.approvingRunId === props.pendingApproval.runId} onClick={() => props.onResolveApproval(props.pendingApproval?.runId ?? '', false)}>
            Reject
          </button>
        </div>
      ) : null}
      {props.approvalError ? (
        <p className="dashboard-approval-error">
          {props.approvalError.code}: {props.approvalError.message}
        </p>
      ) : null}
      {props.deleteError ? (
        <p className="dashboard-approval-error">
          {props.deleteError.code}: {props.deleteError.message}
        </p>
      ) : null}

      <div className="dashboard-focus-row">
        <label>
          Focus run
          <input value={props.focusRunId} onChange={(event) => props.onFocusRunIdChange(event.target.value)} placeholder="optional child run id" />
        </label>
        <label>
          Messages
          <select value={props.messagesView} onChange={(event) => props.onMessagesViewChange(event.target.value as DashboardMessagesView)}>
            <option value="compact">compact</option>
            <option value="delta">delta</option>
            <option value="full">full</option>
          </select>
        </label>
      </div>

      <div className="dashboard-tabs" role="tablist" aria-label="Trace detail tabs">
        {TABS.map((tab) => (
          <button className={props.tab === tab ? 'selected' : ''} type="button" key={tab} onClick={() => props.onTabChange(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {props.errorMessage ? <p className="dashboard-error">{props.errorMessage}</p> : null}
      {props.isLoading ? <p className="dashboard-empty">Loading persisted trace...</p> : null}
      {!props.isLoading && !props.detail && !props.errorMessage ? <p className="dashboard-empty">Choose a root run to inspect its persisted trace.</p> : null}
      {props.detail ? <DashboardTabContent detail={props.detail} tab={props.tab} messagesView={props.messagesView} /> : null}
    </section>
  );
}

function DashboardTabContent(props: { detail: TraceReport; tab: DashboardTab; messagesView: DashboardMessagesView }): ReactElement {
  const root = props.detail.rootRuns[0];
  const summary = props.detail.summary ?? { status: 'unknown', reason: 'Trace report did not include a summary.' };

  if (props.tab === 'overview') {
    return (
      <div className="dashboard-dossier-grid">
        <Metric label="summary" value={summary.status} />
        <Metric label="session" value={shortId(props.detail.session?.sessionId ?? props.detail.target.sessionId ?? undefined)} />
        <Metric label="model" value={[root?.modelProvider, root?.modelName].filter(Boolean).join('/') || 'unknown'} />
        <Metric label="steps" value={(props.detail.totalSteps ?? props.detail.timeline.length).toString()} />
        <Metric label="delegates" value={props.detail.delegates.length.toString()} />
        <Metric label="plans" value={props.detail.plans.length.toString()} />
        <Metric label="cost" value={formatCost(props.detail.usage.estimatedCostUSD ?? 0)} />
        <Metric label="reason" value={summary.reason} />
        {props.detail.warnings.length > 0 ? <pre>{props.detail.warnings.join('\n')}</pre> : null}
      </div>
    );
  }

  if (props.tab === 'output') {
    return (
      <div className="dashboard-pre-block">
        <h3>Output and failure</h3>
        <pre>{stringifyForDisplay(root?.output ?? root?.error ?? summary)}</pre>
      </div>
    );
  }

  if (props.tab === 'messages') {
    return (
      <div className="dashboard-trace-list">
        {props.detail.llmMessages.map((trace, index) => (
          <MessageTraceCard key={`${trace.runId ?? 'message'}-${index}`} trace={trace} messagesView={props.messagesView} />
        ))}
        {props.detail.llmMessages.length === 0 ? <p className="dashboard-empty">No persisted messages for this view.</p> : null}
      </div>
    );
  }

  if (props.tab === 'timeline') {
    return (
      <div className="dashboard-trace-list">
        {props.detail.timeline.map((entry, index) => (
          <article key={`${entry.runId ?? 'timeline'}-${entry.eventType ?? index}-${index}`}>
            <strong>{entry.eventType ?? entry.toolName ?? 'timeline entry'}</strong>
            <span>{[entry.status, entry.toolName, formatMaybeDate(entry.timestamp ?? entry.startedAt)].filter(Boolean).join(' · ')}</span>
            {entry.error || entry.detail ? <p>{entry.error ?? entry.detail}</p> : null}
          </article>
        ))}
        {props.detail.timeline.length === 0 ? <p className="dashboard-empty">No timeline entries persisted for this run.</p> : null}
      </div>
    );
  }

  return (
    <div className="dashboard-trace-list">
      {props.detail.plans.map((plan, index) => (
        <article key={`${plan.planId ?? plan.runId ?? 'plan'}-${index}`}>
          <strong>{plan.title ?? plan.objective ?? plan.planId ?? 'plan'}</strong>
          <span>{[plan.status, shortId(plan.runId), formatMaybeDate(plan.updatedAt ?? plan.createdAt)].filter(Boolean).join(' · ')}</span>
          {String(plan.status).includes('replan') ? <p>replan.required</p> : null}
        </article>
      ))}
      {props.detail.plans.length === 0 ? <p className="dashboard-empty">No persisted plan rows for this run.</p> : null}
    </div>
  );
}

function Metric(props: { label: string; value: string }): ReactElement {
  return (
    <div className="dashboard-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function TrashIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function MessageTraceCard(props: { trace: RunMessageTrace; messagesView: DashboardMessagesView }): ReactElement {
  const visibleMessages = resolveVisibleMessages(props.trace, props.messagesView);
  const counts = summarizeMessages(visibleMessages.map((row) => row.message));

  return (
    <article>
      <strong>{formatRunMessageHeader(props.trace)}</strong>
      <span>
        initial {props.trace.initialSnapshotSeq ?? '-'} @ {formatMaybeDate(props.trace.initialSnapshotCreatedAt ?? undefined)}
        {' · '}
        latest {props.trace.latestSnapshotSeq ?? '-'} @ {formatMaybeDate(props.trace.latestSnapshotCreatedAt ?? undefined)}
      </span>
      {props.messagesView === 'compact' ? (
        <span>counts: persisted={counts.persisted} pending={counts.pending} system={counts.system} runtime-injected={counts.runtimeInjected} user={counts.user} assistant={counts.assistant} tool={counts.tool}</span>
      ) : null}
      {props.messagesView === 'delta' ? (
        <span>delta: added={visibleMessages.filter((row) => row.kind === 'added').length} changed={visibleMessages.filter((row) => row.kind === 'changed').length} pending={visibleMessages.filter((row) => row.kind === 'pending').length}</span>
      ) : null}
      {visibleMessages.length > 0 ? (
        <div className="dashboard-message-table">
          {visibleMessages.map((row) => (
            <MessageRow key={`${row.kind}-${row.message.position}-${row.message.role}-${row.message.persistence}`} kind={deltaKindForDisplay(row.kind)} message={row.message} full={props.messagesView === 'full'} />
          ))}
        </div>
      ) : (
        <p className="dashboard-empty">No snapshot-backed messages for this run.</p>
      )}
    </article>
  );
}

function MessageRow(props: { kind?: MessageDeltaKind; message: TraceMessage; full: boolean }): ReactElement {
  const roleBadgeClass = `dashboard-message-role-badge ${messageRoleClass(props.message.role)}`;

  return (
    <div className="dashboard-message-row">
      <div className="dashboard-message-meta">
        {props.kind ? <b>{props.kind}</b> : null}
        <b>#{props.message.position + 1}</b>
        <span>{props.message.persistence}</span>
        <span className={roleBadgeClass}>{props.message.role}</span>
        <span className={roleBadgeClass}>{humanMessageCategory(props.message.category)}</span>
      </div>
      {props.full ? (
        <>
          {props.message.name ? <span>name: {props.message.name}</span> : null}
          {props.message.toolCallId ? <span>toolCallId: {props.message.toolCallId}</span> : null}
          {props.message.toolCalls && props.message.toolCalls.length > 0 ? <pre>{stringifyForDisplay(props.message.toolCalls)}</pre> : null}
          <pre>{props.message.content}</pre>
        </>
      ) : (
        <span className="dashboard-message-preview">{formatMessagePreview(props.message, 240)}</span>
      )}
    </div>
  );
}

type MessageDeltaKind = 'added' | 'changed' | 'pending';
type MessageRowKind = MessageDeltaKind | 'current';

function resolveVisibleMessages(trace: RunMessageTrace, messagesView: DashboardMessagesView): Array<{ kind: MessageRowKind; message: TraceMessage }> {
  if (messagesView === 'delta') {
    return buildMessageDeltaRows(trace);
  }
  return trace.effectiveMessages.map((message) => ({ kind: 'current', message }));
}

function deltaKindForDisplay(kind: MessageRowKind): MessageDeltaKind | undefined {
  return kind === 'current' ? undefined : kind;
}

function buildMessageDeltaRows(trace: RunMessageTrace): Array<{ kind: MessageDeltaKind; message: TraceMessage }> {
  const initialMessages = trace.initialMessages ?? [];
  const latestPersistedMessages = trace.effectiveMessages.filter((message) => message.persistence === 'persisted');
  const pendingMessages = trace.effectiveMessages.filter((message) => message.persistence === 'pending');
  const rows: Array<{ kind: MessageDeltaKind; message: TraceMessage }> = [];

  for (let index = 0; index < latestPersistedMessages.length; index += 1) {
    const message = latestPersistedMessages[index]!;
    if (index >= initialMessages.length) {
      rows.push({ kind: 'added', message });
      continue;
    }
    if (!messagesEquivalent(initialMessages[index]!, message)) {
      rows.push({ kind: 'changed', message });
    }
  }

  for (const message of pendingMessages) {
    rows.push({ kind: 'pending', message });
  }

  return rows;
}

function messagesEquivalent(left: TraceMessage, right: TraceMessage): boolean {
  return left.role === right.role
    && left.content === right.content
    && left.name === right.name
    && left.toolCallId === right.toolCallId
    && JSON.stringify(left.toolCalls ?? []) === JSON.stringify(right.toolCalls ?? []);
}

function summarizeMessages(messages: TraceMessage[]): {
  persisted: number;
  pending: number;
  system: number;
  runtimeInjected: number;
  user: number;
  assistant: number;
  tool: number;
} {
  return messages.reduce(
    (counts, message) => {
      if (message.persistence === 'persisted') {
        counts.persisted += 1;
      } else {
        counts.pending += 1;
      }
      if (message.role === 'system') {
        counts.system += 1;
      }
      if (message.category === 'runtime-injected-system') {
        counts.runtimeInjected += 1;
      }
      if (message.role === 'user') {
        counts.user += 1;
      }
      if (message.role === 'assistant') {
        counts.assistant += 1;
      }
      if (message.role === 'tool') {
        counts.tool += 1;
      }
      return counts;
    },
    { persisted: 0, pending: 0, system: 0, runtimeInjected: 0, user: 0, assistant: 0, tool: 0 },
  );
}

function formatRunMessageHeader(trace: RunMessageTrace): string {
  return `${shortId(trace.rootRunId)}/${shortId(trace.runId)} d${trace.depth}${trace.delegateName ? ` ${trace.delegateName}` : ''}`;
}

function humanMessageCategory(category: TraceMessage['category']): string {
  switch (category) {
    case 'initial-runtime-system':
      return 'initial runtime system prompt';
    case 'gateway-chat-system-context':
      return 'gateway/chat system context';
    case 'runtime-injected-system':
      return 'runtime-injected system prompt';
    case 'user':
      return 'user message';
    case 'assistant':
      return 'assistant message';
    case 'tool':
      return 'tool result message';
  }
}

function messageRoleClass(role: TraceMessage['role']): string {
  switch (role) {
    case 'system':
      return 'system';
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
  }
}

function formatMessagePreview(message: TraceMessage, previewChars: number): string {
  const parts: string[] = [];
  if (message.name) {
    parts.push(`name=${message.name}`);
  }
  if (message.toolCallId) {
    parts.push(`toolCallId=${message.toolCallId}`);
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    parts.push(`toolCalls=${message.toolCalls.length} [${message.toolCalls.map((toolCall) => toolCall.name).join(', ')}]`);
  }
  const content = oneLine(message.content).trim();
  if (content.length > 0) {
    parts.push(truncatePlain(content, previewChars));
  }
  return parts.length > 0 ? parts.join(' | ') : '(empty)';
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function truncatePlain(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;
}

function stringifyForDisplay(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function formatCost(value: number): string {
  return value > 0 ? `$${value.toFixed(4)}` : '$0.00';
}

function formatMaybeDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
}
