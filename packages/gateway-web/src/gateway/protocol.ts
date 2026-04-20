export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SessionStatus = 'idle' | 'running' | 'awaiting_approval' | 'closed' | 'failed';

export interface SessionOpenedFrame {
  type: 'session.opened';
  sessionId: string;
  channelId: string;
  agentId?: string;
  invocationMode?: 'chat' | 'run';
  status: SessionStatus;
}

export interface SessionUpdatedFrame {
  type: 'session.updated';
  sessionId: string;
  status: SessionStatus;
  invocationMode?: 'chat' | 'run';
  transcriptVersion: number;
  activeRunId?: string;
  activeRootRunId?: string;
}

export interface AgentEventFrame {
  type: 'agent.event';
  eventType: string;
  data: JsonValue;
  seq?: number;
  stepId?: string;
  createdAt?: string;
  sessionId?: string;
  agentId?: string;
  runId?: string;
  rootRunId?: string;
  parentRunId?: string;
}

export interface MessageOutputFrame {
  type: 'message.output';
  sessionId: string;
  runId?: string;
  rootRunId?: string;
  message: {
    role: 'assistant';
    content: string;
  };
}

export interface RunOutputFrame {
  type: 'run.output';
  runId: string;
  rootRunId?: string;
  sessionId?: string;
  status: 'succeeded' | 'failed';
  output?: JsonValue;
  error?: string;
}

export interface ApprovalRequestedFrame {
  type: 'approval.requested';
  runId: string;
  rootRunId: string;
  sessionId?: string;
  toolName?: string;
  reason?: string;
}

export interface ErrorFrame {
  type: 'error';
  code: string;
  message: string;
  requestType?: string;
  details?: { [key: string]: JsonValue };
}

export interface PongFrame {
  type: 'pong';
  id?: string;
}

export type OutboundFrame =
  | SessionOpenedFrame
  | SessionUpdatedFrame
  | AgentEventFrame
  | MessageOutputFrame
  | RunOutputFrame
  | ApprovalRequestedFrame
  | ErrorFrame
  | PongFrame;
