import type {
  AgentEventFrame,
  ApprovalRequestedFrame,
  OutboundFrame,
  RunOutputFrame,
  SessionOpenedFrame,
} from '@adaptive-agent/gateway-fastify';

export type SocketState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export interface SessionIds {
  sessionId?: string;
  runSessionId?: string;
}

export interface ClarificationRequestOutput {
  status: 'clarification_requested';
  message: string;
  suggestedQuestions: string[];
}

export interface LiveAgentEventSummary {
  eventType: string;
  compactText: string;
  runId?: string;
  seq?: number;
  status?: string;
  toolName?: string;
  detail?: string;
  timestamp: Date;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  isSettled: () => boolean;
}

export interface GatewayClientOptions {
  socketUrl: string;
  channel: string;
  token: string;
  onFrame: (frame: OutboundFrame) => void;
  onSocketStateChange?: (state: SocketState, detail?: string) => void;
  onSessionIdsChange?: (sessionIds: SessionIds) => void;
}

export class GatewayWebClient {
  private readonly socketUrl: string;
  private readonly channel: string;
  private readonly token: string;
  private readonly onFrame: (frame: OutboundFrame) => void;
  private readonly onSocketStateChange?: (state: SocketState, detail?: string) => void;
  private readonly onSessionIdsChange?: (sessionIds: SessionIds) => void;
  private readonly approvalSessionIds = new Map<string, string>();
  private readonly clarificationSessionIds = new Map<string, string>();
  private socket?: WebSocket;
  private sessionId?: string;
  private runSessionId?: string;
  private sessionOpened = createDeferred<SessionOpenedFrame>();
  private pendingSessionOpen?: Deferred<SessionOpenedFrame>;

  constructor(options: GatewayClientOptions) {
    this.socketUrl = options.socketUrl;
    this.channel = options.channel;
    this.token = options.token;
    this.onFrame = options.onFrame;
    this.onSocketStateChange = options.onSocketStateChange;
    this.onSessionIdsChange = options.onSessionIdsChange;
  }

  async connect(): Promise<SessionOpenedFrame> {
    this.socket = new WebSocket(buildUpgradeUrl(this.socketUrl, this.channel, this.token));
    this.sessionOpened = createDeferred<SessionOpenedFrame>();
    this.notifySocketState('connecting');

    this.socket.addEventListener('open', () => {
      this.notifySocketState('connected');
      this.sendFrame({
        type: 'session.open',
        channelId: this.channel,
      });
    });

    this.socket.addEventListener('message', (event) => {
      const frame = parseFrame(event.data);
      this.handleFrame(frame);
    });

    this.socket.addEventListener('error', () => {
      this.notifySocketState('error', 'WebSocket error encountered.');
    });

    this.socket.addEventListener('close', (event) => {
      const detail = event.reason ? `${event.code}: ${event.reason}` : `${event.code}`;
      this.notifySocketState('closed', detail);
      rejectIfPending(this.sessionOpened, new Error('Socket closed before session.opened was received.'));
      if (this.pendingSessionOpen) {
        rejectIfPending(this.pendingSessionOpen, new Error('Socket closed before the additional session was opened.'));
        this.pendingSessionOpen = undefined;
      }
    });

    return this.sessionOpened.promise;
  }

  disconnect(code?: number, reason?: string): void {
    this.socket?.close(code, reason);
  }

  sendChat(content: string): void {
    if (!this.sessionId) {
      throw new Error('No chat session is available yet.');
    }

    this.sendFrame({
      type: 'message.send',
      sessionId: this.sessionId,
      content,
    });
  }

  async startRun(goal: string): Promise<void> {
    const runSessionId = await this.ensureRunSessionId();
    this.sendFrame({
      type: 'run.start',
      sessionId: runSessionId,
      goal,
    });
  }

  resolveApproval(runId: string, approved: boolean): void {
    const sessionId = this.approvalSessionIds.get(runId);
    if (!sessionId) {
      throw new Error(`No approval session is tracked for run "${runId}".`);
    }

    this.sendFrame({
      type: 'approval.resolve',
      sessionId,
      runId,
      approved,
    });

    this.approvalSessionIds.delete(runId);
  }

  resolveClarification(runId: string, message: string): void {
    const sessionId = this.clarificationSessionIds.get(runId);
    if (!sessionId) {
      throw new Error(`No clarification session is tracked for run "${runId}".`);
    }

    this.sendFrame({
      type: 'clarification.resolve',
      sessionId,
      runId,
      message,
    });

    this.clarificationSessionIds.delete(runId);
  }

  private async ensureRunSessionId(): Promise<string> {
    if (this.runSessionId) {
      return this.runSessionId;
    }

    if (this.pendingSessionOpen) {
      const frame = await this.pendingSessionOpen.promise;
      this.runSessionId = frame.sessionId;
      this.notifySessionIds();
      return frame.sessionId;
    }

    this.pendingSessionOpen = createDeferred<SessionOpenedFrame>();
    this.sendFrame({
      type: 'session.open',
      channelId: this.channel,
    });

    try {
      const frame = await this.pendingSessionOpen.promise;
      this.runSessionId = frame.sessionId;
      this.notifySessionIds();
      return frame.sessionId;
    } finally {
      this.pendingSessionOpen = undefined;
    }
  }

  private handleFrame(frame: OutboundFrame): void {
    switch (frame.type) {
      case 'session.opened':
        if (!this.sessionOpened.isSettled()) {
          this.sessionId = frame.sessionId;
          this.notifySessionIds();
          this.sessionOpened.resolve(frame);
        } else if (this.pendingSessionOpen && !this.pendingSessionOpen.isSettled()) {
          this.pendingSessionOpen.resolve(frame);
        }
        break;
      case 'approval.requested':
        this.trackApproval(frame);
        break;
      case 'run.output':
        this.trackClarification(frame);
        break;
      default:
        break;
    }

    this.onFrame(frame);
  }

  private trackApproval(frame: ApprovalRequestedFrame): void {
    if (frame.sessionId) {
      this.approvalSessionIds.set(frame.runId, frame.sessionId);
    }
  }

  private trackClarification(frame: RunOutputFrame): void {
    if (isClarificationRequestOutput(frame.output) && frame.sessionId) {
      this.clarificationSessionIds.set(frame.runId, frame.sessionId);
      return;
    }

    this.clarificationSessionIds.delete(frame.runId);
  }

  private sendFrame(frame: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('The gateway socket is not connected.');
    }

    this.socket.send(JSON.stringify(frame));
  }

  private notifySocketState(state: SocketState, detail?: string): void {
    this.onSocketStateChange?.(state, detail);
  }

  private notifySessionIds(): void {
    this.onSessionIdsChange?.({
      sessionId: this.sessionId,
      runSessionId: this.runSessionId,
    });
  }
}

export function buildUpgradeUrl(socketUrl: string, channel: string, token: string): string {
  const url = new URL(socketUrl);
  url.searchParams.set('channelId', channel);
  url.searchParams.set('access_token', token);
  return url.toString();
}

export function summarizeAgentEvent(frame: AgentEventFrame): LiveAgentEventSummary {
  const payload = asRecord(frame.data);

  return {
    eventType: frame.eventType,
    compactText: formatCompactAgentEventFrame(frame),
    runId: frame.runId,
    seq: frame.seq,
    status: readString(payload, 'toStatus') ?? readString(payload, 'status'),
    toolName: readString(payload, 'toolName'),
    detail: readString(payload, 'error') ?? readString(payload, 'message'),
    timestamp: new Date(),
  };
}

export function formatCompactAgentEventFrame(frame: AgentEventFrame, options: { includeSeq?: boolean } = {}): string {
  const payload = asRecord(frame.data);
  const runPrefix = frame.runId ? `run:${frame.runId.slice(0, 8)}` : 'run:unknown';
  const seq = frame.seq ?? '?';
  const prefix = options.includeSeq === false ? runPrefix : `[${seq}] ${runPrefix}`;

  switch (frame.eventType) {
    case 'run.created':
      return `${prefix} run created`;
    case 'run.status_changed': {
      const fromStatus = readString(payload, 'fromStatus') ?? 'unknown';
      const toStatus = readString(payload, 'toStatus') ?? 'unknown';
      return `${prefix} status ${fromStatus} -> ${toStatus}`;
    }
    case 'run.interrupted':
      return `${prefix} run interrupted`;
    case 'run.resumed':
      return `${prefix} run resumed`;
    case 'run.completed':
      return `${prefix} run completed`;
    case 'run.failed': {
      const error = readString(payload, 'error');
      return `${prefix} run failed${error ? `: ${error}` : ''}`;
    }
    case 'tool.started':
      return `${prefix} tool ${readString(payload, 'toolName') ?? 'unknown'} started`;
    case 'tool.completed':
      return `${prefix} tool ${readString(payload, 'toolName') ?? 'unknown'} completed`;
    case 'tool.failed': {
      const toolName = readString(payload, 'toolName') ?? 'unknown';
      const error = readString(payload, 'error');
      return `${prefix} tool ${toolName} failed${error ? `: ${error}` : ''}`;
    }
    case 'approval.requested':
      return `${prefix} approval requested for ${readString(payload, 'toolName') ?? 'unknown'}`;
    case 'approval.resolved': {
      const toolName = readString(payload, 'toolName');
      const approved = payload.approved === true ? 'approved' : payload.approved === false ? 'rejected' : 'resolved';
      return `${prefix} approval ${approved}${toolName ? ` for ${toolName}` : ''}`;
    }
    case 'clarification.requested': {
      const message = readString(payload, 'message');
      return `${prefix} clarification requested${message ? `: ${message}` : ''}`;
    }
    default:
      return `${prefix} ${frame.eventType}`;
  }
}

export function isClarificationRequestOutput(value: unknown): value is ClarificationRequestOutput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { status?: unknown; message?: unknown; suggestedQuestions?: unknown };
  return (
    candidate.status === 'clarification_requested'
    && typeof candidate.message === 'string'
    && Array.isArray(candidate.suggestedQuestions)
    && candidate.suggestedQuestions.every((entry) => typeof entry === 'string')
  );
}

export function formatRunOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  const json = JSON.stringify(output, null, 2);
  return json ?? '';
}

export function formatClockTime(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

export function truncateId(value: string | undefined, length = 8): string {
  if (!value) {
    return 'none';
  }

  return value.length <= length ? value : value.slice(0, length);
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let settled = false;

  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      settled = true;
      res(value);
    };
    reject = (reason) => {
      settled = true;
      rej(reason);
    };
  });

  return {
    promise,
    resolve,
    reject,
    isSettled: () => settled,
  };
}

function parseFrame(raw: string | ArrayBuffer | Blob): OutboundFrame {
  const text =
    typeof raw === 'string'
      ? raw
      : raw instanceof ArrayBuffer
        ? new TextDecoder().decode(raw)
        : String(raw);

  return JSON.parse(text) as OutboundFrame;
}

function rejectIfPending<T>(deferred: Deferred<T>, reason: unknown): void {
  if (!deferred.isSettled()) {
    deferred.reject(reason);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
