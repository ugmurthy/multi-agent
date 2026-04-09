import { describe, expect, it } from 'vitest';

import {
  bridgeRuntimeEvent,
  createChannelSubscriptionManager,
  isBridgedRuntimeEvent,
  parseChannelId,
  validateChannelSubscribeFrame,
  type RuntimeEventPayload,
} from './channels.js';

describe('parseChannelId', () => {
  it('parses valid session channel ids', () => {
    expect(parseChannelId('session:sess-1')).toEqual({
      scope: 'session',
      id: 'sess-1',
      channel: 'session:sess-1',
    });
  });

  it('parses valid run channel ids', () => {
    expect(parseChannelId('run:run-42')).toEqual({
      scope: 'run',
      id: 'run-42',
      channel: 'run:run-42',
    });
  });

  it('parses valid root-run channel ids', () => {
    expect(parseChannelId('root-run:root-1')).toEqual({
      scope: 'root-run',
      id: 'root-1',
      channel: 'root-run:root-1',
    });
  });

  it('parses valid agent channel ids', () => {
    expect(parseChannelId('agent:support-agent')).toEqual({
      scope: 'agent',
      id: 'support-agent',
      channel: 'agent:support-agent',
    });
  });

  it('returns undefined for unknown scopes', () => {
    expect(parseChannelId('user:u-1')).toBeUndefined();
    expect(parseChannelId('channel:webchat')).toBeUndefined();
  });

  it('returns undefined for missing id after colon', () => {
    expect(parseChannelId('session:')).toBeUndefined();
    expect(parseChannelId('session:   ')).toBeUndefined();
  });

  it('returns undefined when no separator is present', () => {
    expect(parseChannelId('session-123')).toBeUndefined();
    expect(parseChannelId('justAString')).toBeUndefined();
  });
});

describe('createChannelSubscriptionManager', () => {
  it('subscribes to valid channels and returns added subscriptions', () => {
    const manager = createChannelSubscriptionManager();

    const added = manager.subscribe(['session:s-1', 'run:r-1']);

    expect(added).toHaveLength(2);
    expect(added[0]).toEqual({ scope: 'session', id: 's-1', channel: 'session:s-1' });
    expect(added[1]).toEqual({ scope: 'run', id: 'r-1', channel: 'run:r-1' });
  });

  it('skips invalid channel ids during subscription', () => {
    const manager = createChannelSubscriptionManager();

    const added = manager.subscribe(['session:s-1', 'badchannel', 'run:r-1']);

    expect(added).toHaveLength(2);
    expect(manager.getSubscriptions()).toHaveLength(2);
  });

  it('does not duplicate existing subscriptions', () => {
    const manager = createChannelSubscriptionManager();

    manager.subscribe(['session:s-1']);
    const added = manager.subscribe(['session:s-1', 'run:r-1']);

    expect(added).toHaveLength(1);
    expect(added[0]!.channel).toBe('run:r-1');
    expect(manager.getSubscriptions()).toHaveLength(2);
  });

  it('returns all current subscriptions', () => {
    const manager = createChannelSubscriptionManager();
    manager.subscribe(['session:s-1', 'agent:a-1']);

    const subs = manager.getSubscriptions();

    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.channel).sort()).toEqual(['agent:a-1', 'session:s-1']);
  });

  describe('matches', () => {
    it('matches events by session scope', () => {
      const manager = createChannelSubscriptionManager();
      manager.subscribe(['session:s-1']);

      expect(
        manager.matches(createEvent({ sessionId: 's-1' })),
      ).toBe(true);
      expect(
        manager.matches(createEvent({ sessionId: 's-2' })),
      ).toBe(false);
    });

    it('matches events by run scope', () => {
      const manager = createChannelSubscriptionManager();
      manager.subscribe(['run:r-1']);

      expect(
        manager.matches(createEvent({ runId: 'r-1' })),
      ).toBe(true);
      expect(
        manager.matches(createEvent({ runId: 'r-2' })),
      ).toBe(false);
    });

    it('matches events by root-run scope', () => {
      const manager = createChannelSubscriptionManager();
      manager.subscribe(['root-run:root-1']);

      expect(
        manager.matches(createEvent({ rootRunId: 'root-1' })),
      ).toBe(true);
      expect(
        manager.matches(createEvent({ rootRunId: 'root-2' })),
      ).toBe(false);
    });

    it('matches events by agent scope', () => {
      const manager = createChannelSubscriptionManager();
      manager.subscribe(['agent:support-agent']);

      expect(
        manager.matches(createEvent({ agentId: 'support-agent' })),
      ).toBe(true);
      expect(
        manager.matches(createEvent({ agentId: 'other-agent' })),
      ).toBe(false);
    });

    it('matches when any subscription matches the event', () => {
      const manager = createChannelSubscriptionManager();
      manager.subscribe(['session:s-1', 'agent:a-1']);

      expect(
        manager.matches(createEvent({ agentId: 'a-1' })),
      ).toBe(true);
    });

    it('returns false when no subscriptions match', () => {
      const manager = createChannelSubscriptionManager();
      manager.subscribe(['session:s-1']);

      expect(
        manager.matches(createEvent({ agentId: 'a-1' })),
      ).toBe(false);
    });

    it('returns false when there are no subscriptions', () => {
      const manager = createChannelSubscriptionManager();

      expect(
        manager.matches(createEvent({ sessionId: 's-1' })),
      ).toBe(false);
    });
  });
});

describe('bridgeRuntimeEvent', () => {
  it('creates an agent.event frame with full correlation metadata', () => {
    const event: RuntimeEventPayload = {
      eventType: 'run.created',
      data: { status: 'running' },
      sessionId: 's-1',
      agentId: 'support-agent',
      runId: 'r-1',
      rootRunId: 'root-1',
      parentRunId: 'parent-1',
    };

    expect(bridgeRuntimeEvent(event)).toEqual({
      type: 'agent.event',
      eventType: 'run.created',
      data: { status: 'running' },
      sessionId: 's-1',
      agentId: 'support-agent',
      runId: 'r-1',
      rootRunId: 'root-1',
      parentRunId: 'parent-1',
    });
  });

  it('creates an agent.event frame with partial correlation metadata', () => {
    const event: RuntimeEventPayload = {
      eventType: 'tool.started',
      data: { toolName: 'read_file' },
      runId: 'r-2',
    };

    expect(bridgeRuntimeEvent(event)).toEqual({
      type: 'agent.event',
      eventType: 'tool.started',
      data: { toolName: 'read_file' },
      sessionId: undefined,
      agentId: undefined,
      runId: 'r-2',
      rootRunId: undefined,
      parentRunId: undefined,
    });
  });

  it('preserves all bridged runtime event types', () => {
    const eventTypes = [
      'run.created',
      'run.status_changed',
      'tool.started',
      'tool.completed',
      'delegate.spawned',
      'approval.requested',
      'approval.resolved',
      'run.completed',
      'run.failed',
      'snapshot.created',
    ];

    for (const eventType of eventTypes) {
      const frame = bridgeRuntimeEvent({ eventType, data: {} });
      expect(frame.type).toBe('agent.event');
      expect(frame.eventType).toBe(eventType);
    }
  });
});

describe('validateChannelSubscribeFrame', () => {
  it('separates valid and invalid channels', () => {
    const result = validateChannelSubscribeFrame({
      type: 'channel.subscribe',
      channels: ['session:s-1', 'bad', 'run:r-1', 'unknown:x'],
    });

    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]!.channel).toBe('session:s-1');
    expect(result.valid[1]!.channel).toBe('run:r-1');
    expect(result.invalid).toEqual(['bad', 'unknown:x']);
  });

  it('returns all valid when all channels parse correctly', () => {
    const result = validateChannelSubscribeFrame({
      type: 'channel.subscribe',
      channels: ['session:s-1', 'agent:a-1'],
    });

    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(0);
  });

  it('returns all invalid when no channels parse correctly', () => {
    const result = validateChannelSubscribeFrame({
      type: 'channel.subscribe',
      channels: ['nope', 'also-nope'],
    });

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toEqual(['nope', 'also-nope']);
  });
});

describe('isBridgedRuntimeEvent', () => {
  it('returns true for known bridged event types', () => {
    expect(isBridgedRuntimeEvent('run.created')).toBe(true);
    expect(isBridgedRuntimeEvent('tool.completed')).toBe(true);
    expect(isBridgedRuntimeEvent('snapshot.created')).toBe(true);
  });

  it('returns false for unknown event types', () => {
    expect(isBridgedRuntimeEvent('custom.event')).toBe(false);
    expect(isBridgedRuntimeEvent('')).toBe(false);
  });
});

function createEvent(overrides: Partial<RuntimeEventPayload> = {}): RuntimeEventPayload {
  return {
    eventType: 'run.status_changed',
    data: { status: 'running' },
    ...overrides,
  };
}
