import type { AgentDefaults, JsonSchema, ModelAdapter, ToolDefinition } from '../types.js';

export interface SkillDefinition {
  /** Stable skill name, e.g. `"researcher"`. Used as the delegate profile name. */
  name: string;
  /** Short description surfaced to the planner as the delegate tool description. */
  description: string;
  /** Full instructions injected into the child run's system prompt. */
  instructions: string;
  /** Subset of host tool names this skill is allowed to use. */
  allowedTools: string[];
  /** Optional trigger phrases for skill matching. */
  triggers?: string[];
  /** Optional model override for this skill's child runs. */
  model?: ModelAdapter;
  /** Optional agent default overrides for this skill's child runs. */
  defaults?: Partial<AgentDefaults>;
  /** Optional structured input schema for the skill. */
  inputSchema?: JsonSchema;
  /** Optional structured output schema for the skill. */
  outputSchema?: JsonSchema;
  /**
   * Optional handler module path relative to the skill directory.
   * When set, the module is dynamically imported and exposed as a
   * scoped tool (`skill.<name>.handler`) inside the child run.
   */
  handler?: string;
  /**
   * Populated at load time when `handler` is set. Contains the
   * dynamically imported handler tool definition(s).
   */
  handlerTools?: ToolDefinition[];
}
