import type { CreatedAdaptiveAgent, DelegateDefinition, ToolDefinition } from './core.js';
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig, LoadedConfig } from './config.js';
import { createAgentRegistry, resolveWorkspaceRootForAgentConfig } from './agent-registry.js';
import { createModuleRegistry } from './registries.js';

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', additionalProperties: true },
    execute: async () => ({ ok: true }),
  };
}

function createDelegate(name: string): DelegateDefinition {
  return {
    name,
    description: `${name} delegate`,
    allowedTools: [],
  };
}

function createAgentConfig(): LoadedConfig<AgentConfig> {
  return {
    path: '/tmp/support-agent.json',
    config: {
      id: 'support-agent',
      name: 'Support Agent',
      invocationModes: ['chat', 'run'],
      defaultInvocationMode: 'chat',
      model: {
        provider: 'ollama',
        model: 'qwen3.5',
      },
      systemInstructions:
        'You are the support manager. Use delegate.researcher for focused evidence gathering and write the final response yourself.',
      tools: ['read_file'],
      delegates: ['researcher'],
      routing: {
        allowedChannels: ['webchat'],
      },
    },
  };
}

function createCreatedAgent(agentId: string): CreatedAdaptiveAgent {
  return {
    agent: { id: agentId } as never,
    runtime: {
      runStore: {} as never,
      eventStore: {} as never,
      snapshotStore: {} as never,
      planStore: undefined,
    },
  };
}

describe('AgentRegistry', () => {
  it('loads metadata without instantiating agents and caches materialized agents by id', async () => {
    const agentLogger = {
      child: vi.fn(() => ({ child: vi.fn() })),
    };
    const agentFactory = vi.fn((entry) => createCreatedAgent(entry.definition.agentId));
    const registry = createAgentRegistry({
      agents: [createAgentConfig()],
      moduleRegistry: createModuleRegistry({
        tools: [createTool('read_file')],
        delegates: [createDelegate('researcher')],
      }),
      agentFactory,
      logger: agentLogger,
    });

    expect(agentFactory).not.toHaveBeenCalled();
    expect(registry.listAgentIds()).toEqual(['support-agent']);
    expect(registry.getMetadata('support-agent')).toEqual({
      agentId: 'support-agent',
      name: 'Support Agent',
      invocationModes: ['chat', 'run'],
      defaultInvocationMode: 'chat',
      routing: {
        allowedChannels: ['webchat'],
      },
    });
    expect(agentFactory).not.toHaveBeenCalled();

    const firstMaterializedAgent = await registry.getAgent('support-agent');
    const secondMaterializedAgent = await registry.getAgent('support-agent');

    expect(firstMaterializedAgent).toBe(secondMaterializedAgent);
    expect(agentFactory).toHaveBeenCalledTimes(1);
    expect(agentLogger.child).toHaveBeenCalledWith({ agentId: 'support-agent' });
    expect(agentFactory.mock.calls[0]?.[0].logger).toBe(agentLogger.child.mock.results[0]?.value);
    expect(registry.getDefinition('support-agent')).toMatchObject({
      agentId: 'support-agent',
      toolNames: ['read_file'],
      delegateNames: ['researcher'],
      config: {
        systemInstructions:
          'You are the support manager. Use delegate.researcher for focused evidence gathering and write the final response yourself.',
        delegates: ['researcher'],
      },
    });
  });

  it('materializes routed manager agents with resolved delegate profiles', async () => {
    const agentFactory = vi.fn((entry) => {
      expect(entry.definition.config.systemInstructions).toContain('delegate.researcher');
      expect(entry.definition.delegateNames).toEqual(['researcher', 'writer']);
      expect(entry.modules.delegates.map((delegate) => delegate.name)).toEqual(['researcher', 'writer']);
      return createCreatedAgent(entry.definition.agentId);
    });
    const managerConfig = createAgentConfig();
    managerConfig.config.id = 'strategy-manager';
    managerConfig.config.name = 'Strategy Manager';
    managerConfig.config.delegates = ['researcher', 'writer'];
    managerConfig.config.systemInstructions =
      'You are the strategy manager. Use delegate.researcher for evidence, delegate.writer for drafting, and own the final answer.';

    const registry = createAgentRegistry({
      agents: [managerConfig],
      moduleRegistry: createModuleRegistry({
        tools: [createTool('read_file')],
        delegates: [createDelegate('researcher'), createDelegate('writer')],
      }),
      agentFactory,
    });

    await registry.getAgent('strategy-manager');

    expect(agentFactory).toHaveBeenCalledTimes(1);
  });

  it('surfaces unknown agent ids with loaded agent context', () => {
    const registry = createAgentRegistry({
      agents: [createAgentConfig()],
      moduleRegistry: createModuleRegistry({
        tools: [createTool('read_file')],
        delegates: [createDelegate('researcher')],
      }),
    });

    expect(() => registry.getMetadata('missing-agent')).toThrowError(
      'Unknown agent id "missing-agent". Loaded agents: support-agent.',
    );
  });

  it('expands environment variables in agent workspace roots', () => {
    const previousHome = process.env.HOME;
    process.env.HOME = '/tmp/adaptive-home';

    try {
      expect(resolveWorkspaceRootForAgentConfig('$HOME/.adaptiveAgent')).toBe('/tmp/adaptive-home/.adaptiveAgent');
      expect(resolveWorkspaceRootForAgentConfig('${HOME}/logs')).toBe('/tmp/adaptive-home/logs');
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });
});
