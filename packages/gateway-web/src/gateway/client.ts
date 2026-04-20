import type {
  ApprovalRequestedFrame,
  OutboundFrame,
  RunOutputFrame,
  SessionOpenedFrame,
} from './protocol';

import { isClarificationRequestOutput } from './format';
import type { GatewayDefaults, GatewayWebClientOptions, SocketState } from './types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  isSettled: () => boolean;
}

export class GatewayWebClient {
  private readonly socketUrl: string;
  private readonly channel: string;
  private readonly token: string;
  private readonly onFrame: GatewayWebClientOptions['onFrame'];
  private readonly onSocketStateChange: GatewayWebClientOptions['onSocketStateChange'];
  private readonly onSessionIdsChange: GatewayWebClientOptions['onSessionIdsChange'];
  private readonly approvalSessionIds = new Map<string, string>();
  private readonly clarificationSessionIds = new Map<string, string>();
  private readonly failedRunSessionIds = new Map<string, string>();
  private socket?: WebSocket;
  private sessionId?: string;
  private runSessionId?: string;
  private pendingSessionOpen?: Deferred<SessionOpenedFrame>;
  private initialSessionOpen = createDeferred<SessionOpenedFrame>();

  constructor(options: GatewayWebClientOptions) {
    this.socketUrl = options.socketUrl;
    this.channel = options.identity.channel;
    this.token = options.token;
    this.onFrame = options.onFrame;
    this.onSocketStateChange = options.onSocketStateChange;
    this.onSessionIdsChange = options.onSessionIdsChange;
  }

  connect(): Promise<SessionOpenedFrame> {
    this.initialSessionOpen = createDeferred<SessionOpenedFrame>();
    this.notifySocketState('connecting');

    const socket = new WebSocket(buildUpgradeUrl(this.socketUrl, this.channel, this.token));
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.notifySocketState('connected');
      this.sendFrame({
        type: 'session.open',
        channelId: this.channel,
      });
    });

    socket.addEventListener('message', (event) => {
      const frame = parseFrame(event.data);
      this.handleFrame(frame);
    });

    socket.addEventListener('error', () => {
      this.notifySocketState('error', 'WebSocket error encountered.');
    });

    socket.addEventListener('close', (event) => {
      const detail = event.reason ? `${event.code}: ${event.reason}` : `${event.code}`;
      this.notifySocketState('closed', detail);
      rejectIfPending(this.initialSessionOpen, new Error('Socket closed before session.opened was received.'));
      if (this.pendingSessionOpen) {
        rejectIfPending(this.pendingSessionOpen, new Error('Socket closed before the additional session was opened.'));
        this.pendingSessionOpen = undefined;
      }
    });

    return this.initialSessionOpen.promise;
  }

  disconnect(code = 1000, reason = 'client disconnected'): void {
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
    const sessionId = await this.ensureRunSessionId();
    this.sendFrame({
      type: 'run.start',
      sessionId,
      goal,
    });
  }

  retryRun(runId: string): void {
    const sessionId = this.failedRunSessionIds.get(runId) ?? this.runSessionId;
    if (!sessionId) {
      throw new Error(`No run session is tracked for run "${runId}".`);
    }

    this.sendFrame({
      type: 'run.retry',
      sessionId,
      runId,
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
        this.trackSession(frame);
        break;
      case 'approval.requested':
        this.trackApproval(frame);
        break;
      case 'run.output':
        this.trackRunOutput(frame);
        break;
      default:
        break;
    }

    this.onFrame(frame);
  }

  private trackSession(frame: SessionOpenedFrame): void {
    if (!this.initialSessionOpen.isSettled()) {
      this.sessionId = frame.sessionId;
      this.initialSessionOpen.resolve(frame);
      this.notifySessionIds();
      return;
    }

    if (this.pendingSessionOpen && !this.pendingSessionOpen.isSettled()) {
      this.runSessionId = frame.sessionId;
      this.pendingSessionOpen.resolve(frame);
      this.notifySessionIds();
    }
  }

  private trackApproval(frame: ApprovalRequestedFrame): void {
    if (frame.sessionId) {
      this.approvalSessionIds.set(frame.runId, frame.sessionId);
    }
  }

  private trackRunOutput(frame: RunOutputFrame): void {
    if (frame.status === 'failed' && frame.sessionId) {
      this.failedRunSessionIds.set(frame.runId, frame.sessionId);
    }

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
    this.onSocketStateChange(state, detail);
  }

  private notifySessionIds(): void {
    this.onSessionIdsChange({
      sessionId: this.sessionId,
      runSessionId: this.runSessionId,
    });
  }
}

export async function loadGatewayDefaults(): Promise<GatewayDefaults> {
  const response = await fetch('/api/gateway-defaults');
  if (!response.ok) {
    throw new Error(`Gateway defaults failed with ${response.status}.`);
  }

  return (await response.json()) as GatewayDefaults;
}

export async function mintDevToken(input: {
  subject: string;
  tenantId: string;
  roles: string[];
}): Promise<string> {
  const response = await fetch('/api/dev-token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as { token?: unknown; message?: unknown };
  if (!response.ok || typeof payload.token !== 'string') {
    throw new Error(typeof payload.message === 'string' ? payload.message : `Token request failed with ${response.status}.`);
  }

  return payload.token;
}

export function buildUpgradeUrl(socketUrl: string, channel: string, token: string): string {
  const url = new URL(socketUrl);
  url.searchParams.set('channelId', channel);
  url.searchParams.set('access_token', token);
  return url.toString();
}

function parseFrame(raw: unknown): OutboundFrame {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as OutboundFrame;
  }

  throw new Error('Unsupported WebSocket payload.');
}

function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

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

function rejectIfPending<T>(deferred: Deferred<T>, reason: Error): void {
  if (!deferred.isSettled()) {
    deferred.reject(reason);
  }
}
