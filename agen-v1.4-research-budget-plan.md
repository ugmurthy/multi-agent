# v1.4 Research Budget And Partial Evidence Plan

## Purpose

This plan describes a non-breaking path to make web research more goal-directed across model choices, while avoiding a broad `RunResult` or event contract change.

The core idea is:

- meter search-like tools through model-independent runtime policy
- guide the model with budget-aware checkpoint messages
- preserve existing `success` and `failure` run semantics for now
- let search and research delegates report partial evidence inside normal tool outputs before introducing first-class partial run states

This is intentionally staged so a coding agent can implement and verify one layer at a time.

## Current Context

Primary spec and contract files:

- `agen-spec-v1.4.md`
- `agen-contracts-v1.4.md`
- `agen-runtime-v1.4-algorithms.md`

Primary implementation files:

- `packages/core/src/types.ts`
- `packages/core/src/adaptive-agent.ts`
- `packages/core/src/delegation-executor.ts`
- `packages/core/src/tools/web-search.ts`
- `packages/core/src/tools/read-web-page.ts`
- `packages/core/src/tools/tools.test.ts`
- `packages/core/src/adaptive-agent.test.ts`
- `packages/gateway-fastify/src/core.ts`
- `packages/gateway-fastify/src/config.ts`
- `packages/gateway-fastify/src/config.test.ts`
- `examples/aa-config.ts`
- `examples/aa.ts`
- `examples/run-agent.ts`
- `examples/skills/researcher/SKILL.md`

Relevant existing behavior:

- `AgentDefaults` currently includes `maxSteps`, tool and model timeouts, retry count, approval defaults, and capture mode.
- `ToolDefinition` already supports `retryPolicy`, `summarizeResult`, and `recoverError`.
- `web_search` and `read_web_page` are normal tools and already have retry/recover behavior.
- `AdaptiveAgent.executionLoop()` currently fails the run with `MAX_STEPS` when `state.stepsUsed >= defaults.maxSteps`.
- Delegation is modeled as synthetic `delegate.*` tools and child runs.
- Child `MAX_STEPS` failure is currently treated as failure and can be retried by raising step budget.

Design boundaries to preserve:

- `Tool` remains the only first-class executable primitive.
- Plans remain separate artifacts.
- Persisted plans must not contain `delegate.*` steps.
- Do not introduce DAG execution, parallel child runs, child messaging, skills runtime changes, or chain-of-thought persistence.
- Do not add a top-level `partial` `RunResult` in the first implementation pass.

## Target Behavior

For web research, different models should operate inside the same runtime policy:

- search should be used only when the goal needs external, current, or unknown facts
- each search call should have an explicit purpose
- repeated search should be bounded by a per-tool-group budget
- near budget exhaustion, the model should decide whether current evidence is enough
- when budget is exhausted, the default behavior should be configurable

For partial evidence:

- read-only research tools may return structured partial evidence as ordinary successful tool output
- runtime terminal states remain unchanged in the first pass
- child research delegates may later map `MAX_STEPS` into a structured delegate output instead of immediate parent failure, but that should be a later opt-in stage

## Public API Shape

Add these types to `packages/core/src/types.ts` and mirror them in `packages/gateway-fastify/src/core.ts`.

```ts
export type ToolBudgetExhaustedAction = 'fail' | 'continue_with_warning' | 'ask_model';

export interface ToolBudget {
  maxCalls?: number;
  maxConsecutiveCalls?: number;
  checkpointAfter?: number;
  onExhausted?: ToolBudgetExhaustedAction;
}

export type ResearchPolicyName = 'none' | 'light' | 'standard' | 'deep';

export interface ResearchPolicy {
  mode: ResearchPolicyName;
  maxSearches?: number;
  maxPagesRead?: number;
  checkpointAfter?: number;
  requirePurpose?: boolean;
}
```

Extend `AgentDefaults`:

```ts
export interface AgentDefaults {
  maxSteps?: number;
  toolTimeoutMs?: number;
  modelTimeoutMs?: number;
  maxRetriesPerStep?: number;
  requireApprovalForWriteTools?: boolean;
  autoApproveAll?: boolean;
  capture?: CaptureMode;
  toolBudgets?: Record<string, ToolBudget>;
  researchPolicy?: ResearchPolicyName | ResearchPolicy;
}
```

Extend `ToolDefinition` additively:

```ts
export interface ToolDefinition<I extends JsonValue = JsonValue, O extends JsonValue = JsonValue> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  timeoutMs?: number;
  requiresApproval?: boolean;
  capture?: CaptureMode;
  redact?: ToolRedactionPolicy;
  retryPolicy?: ToolRetryPolicy;
  budgetGroup?: string;
  summarizeResult?: (output: O) => JsonValue;
  recoverError?: (error: unknown, input: I) => O | undefined;
  execute(input: I, context: ToolContext): Promise<O>;
}
```

Default budget group assignments:

- `web_search`: `budgetGroup: 'web_research.search'`
- `read_web_page`: `budgetGroup: 'web_research.read'`

The implementation may also support a parent group `web_research` for combined counting, but keep the first pass simple unless tests need combined behavior.

## Policy Presets

Implement a small resolver, preferably in a new file such as `packages/core/src/tool-budget-policy.ts`.

Suggested preset mapping:

```ts
const RESEARCH_POLICY_PRESETS: Record<ResearchPolicyName, ResolvedResearchPolicy> = {
  none: {
    maxSearches: 0,
    maxPagesRead: 0,
    checkpointAfter: 0,
    requirePurpose: true,
  },
  light: {
    maxSearches: 2,
    maxPagesRead: 4,
    checkpointAfter: 1,
    requirePurpose: true,
  },
  standard: {
    maxSearches: 4,
    maxPagesRead: 8,
    checkpointAfter: 3,
    requirePurpose: true,
  },
  deep: {
    maxSearches: 8,
    maxPagesRead: 20,
    checkpointAfter: 5,
    requirePurpose: true,
  },
};
```

Default behavior:

- if `researchPolicy` is undefined, preserve current behavior
- if `toolBudgets` is undefined, preserve current behavior
- if both are provided, explicit `toolBudgets` override preset-derived budgets

Recommended derived budgets:

```ts
{
  'web_research.search': {
    maxCalls: policy.maxSearches,
    checkpointAfter: policy.checkpointAfter,
    maxConsecutiveCalls: 2,
    onExhausted: 'ask_model',
  },
  'web_research.read': {
    maxCalls: policy.maxPagesRead,
    checkpointAfter: Math.max(1, Math.floor(policy.maxPagesRead * 0.75)),
    maxConsecutiveCalls: 4,
    onExhausted: 'ask_model',
  },
}
```

## Configuration Precedence

Use one precedence rule everywhere:

```text
run options override delegate defaults
delegate defaults override agent defaults
agent defaults override tool defaults
runtime hard limits override everything
```

First pass can implement only agent defaults plus delegate defaults because `RunRequest` does not currently expose defaults. Do not add per-run default overrides unless a later task explicitly asks for it.

When merging child delegate defaults, update the existing `mergeDefaults` behavior to merge `toolBudgets` and `researchPolicy` without weakening parent safety limits:

- lower explicit budget wins for max calls unless delegate explicitly raises budget and host policy allows it
- if unclear, preserve existing behavior and only apply delegate budgets when parent has no budget for that group
- document the chosen behavior in tests

## Tool Input Changes

Update `web_search` input schema additively:

```ts
export interface WebSearchInput {
  query: string;
  maxResults?: number;
  purpose?: string;
  expectedUse?: 'verify' | 'discover' | 'compare' | 'current_status';
  freshnessRequired?: boolean;
}
```

Do not require `purpose` at the JSON schema level in the first pass, because existing models, prompts, and tests may rely on `{ query }` only.

Instead:

- update the tool description to ask for a purpose
- include `purpose` in logs and summaries when present
- if `requirePurpose` is true and purpose is missing, add a runtime warning event or checkpoint message, but do not fail the first pass

Keep `read_web_page` input unchanged for now.

## Runtime Enforcement

Add a lightweight budget counter to execution state.

Suggested internal shape:

```ts
interface ToolBudgetUsage {
  calls: number;
  consecutiveCalls: number;
  checkpointEmitted: boolean;
}
```

Track by `budgetGroup` if present, otherwise by tool name only when a budget exists.

Before executing a pending tool call:

1. Resolve the tool.
2. Resolve its budget group.
3. If no budget applies, execute as today.
4. If `maxCalls` would be exceeded, apply `onExhausted`.
5. If `maxConsecutiveCalls` would be exceeded, apply `onExhausted`.
6. If `checkpointAfter` is reached and no checkpoint has been emitted, inject a model-visible warning before the next model call.
7. Execute the tool and increment counters only after the tool is admitted.

Important: do not increment budget usage for model-only steps.

Suggested behavior for `onExhausted`:

- `fail`: fail the run with existing `TOOL_ERROR` or a new additive failure code only if all callers are updated
- `continue_with_warning`: do not execute the tool; inject a tool result or assistant-visible context saying the budget is exhausted and the model must answer from current evidence
- `ask_model`: same as `continue_with_warning` in the first pass, but wording asks the model to either answer or explain why the goal cannot be satisfied

Prefer not to add new event types initially. Put budget metadata into existing `tool.failed`, `tool.completed`, or `usage.updated` payloads if needed. If event types are added later, update `EventType`, gateway channels, analysis normalization, and docs together.

## Checkpoint Message

When the checkpoint triggers, add a system/developer-style message to the model history before the next model call:

```text
You are near the web research budget. Use current evidence if it is sufficient. Only call another web research tool if you can name the specific missing fact needed for the user's goal. If evidence is incomplete, say what is uncertain instead of continuing to search broadly.
```

Keep this message runtime-authored and deterministic. Do not persist hidden reasoning; persist the message only if model message history is already snapshotted for replay.

## Partial Evidence Without Contract Breakage

Do not add `status: 'partial'` to top-level `RunResult` in this pass.

For `web_search`, keep normal successful output shape and add optional metadata:

```ts
export interface WebResearchStatus {
  status: 'complete' | 'partial';
  reason?: 'budget_exhausted' | 'timeout' | 'provider_error';
  unresolvedQuestions?: string[];
}
```

For the first pass, `web_search` can return:

```ts
{
  query,
  results,
  researchStatus: {
    status: 'complete'
  }
}
```

When a recoverable error occurs, existing `recoverError` can return:

```ts
{
  query,
  results: [],
  error: { ... },
  researchStatus: {
    status: 'partial',
    reason: 'provider_error',
    unresolvedQuestions: []
  }
}
```

For budget exhaustion, prefer runtime checkpoint behavior over fabricating a `web_search` output unless the current model/tool loop already has a clean way to inject a tool result for a skipped call.

## Delegation Follow-Up

Do not change child run terminal mapping in the first pass.

After budgets and structured search outputs are stable, implement an opt-in delegate behavior:

```ts
export interface DelegateDefinition {
  name: string;
  description: string;
  instructions?: string;
  allowedTools: string[];
  defaults?: Partial<AgentDefaults>;
  partialOnMaxSteps?: boolean;
}
```

If `partialOnMaxSteps` is true and a child run fails with `MAX_STEPS`, the delegate tool may complete with a structured output:

```ts
{
  status: 'partial',
  reason: 'max_steps_exceeded',
  childRunId,
  output: childRun.result ?? null,
  message: 'The delegate reached its step limit. Use the available evidence with caveats.'
}
```

This must remain opt-in because write-oriented delegates should not silently convert incomplete work into success.

## Documentation Updates

Update `agen-contracts-v1.4.md`:

- add `ToolBudget`, `ResearchPolicy`, `toolBudgets`, `researchPolicy`, and `budgetGroup`
- state that defaults are additive and disabled unless configured
- state that first-class `partial` run results are deferred

Update `agen-runtime-v1.4-algorithms.md`:

- add a section after tool execution or before tool ledger resume describing budget admission
- add checkpoint message behavior
- clarify that budget exhaustion is not automatically equivalent to semantic task failure for read-only research

Update `agen-spec-v1.4.md` only if product-facing language is needed:

- add a short subsection under tool model or runtime behavior describing goal-directed external research budgets

Update `examples/skills/researcher/SKILL.md`:

- tell the researcher to stop when evidence is sufficient
- ask it to include unresolved questions and confidence caveats
- tell it not to continue searching just to marginally improve source quality after the budget warning

## Gateway And Example Configuration

Update gateway config parsing in `packages/gateway-fastify/src/config.ts`:

- accept optional `defaults.researchPolicy`
- accept optional `defaults.toolBudgets`
- validate positive integers for `maxCalls`, `maxConsecutiveCalls`, and `checkpointAfter`
- validate `onExhausted`

Update example config parsing in `examples/aa-config.ts` similarly.

Add sample config docs:

```json
{
  "agent": {
    "researchPolicy": "standard"
  }
}
```

Advanced example:

```json
{
  "agent": {
    "toolBudgets": {
      "web_research.search": {
        "maxCalls": 3,
        "maxConsecutiveCalls": 2,
        "checkpointAfter": 2,
        "onExhausted": "ask_model"
      },
      "web_research.read": {
        "maxCalls": 6,
        "maxConsecutiveCalls": 3,
        "checkpointAfter": 4,
        "onExhausted": "ask_model"
      }
    }
  }
}
```

## Test Plan

Core unit tests:

- `AgentDefaults` accepts `researchPolicy` and `toolBudgets`.
- `web_search` has `budgetGroup: 'web_research.search'`.
- `read_web_page` has `budgetGroup: 'web_research.read'`.
- `web_search` accepts legacy `{ query }` input.
- `web_search` accepts `{ query, purpose, expectedUse, freshnessRequired }`.
- research policy presets resolve to expected budgets.
- explicit `toolBudgets` override preset budgets.

Runtime tests:

- with no budget configured, existing tool execution behavior is unchanged.
- when under budget, a budgeted tool executes normally.
- when checkpoint is reached, runtime injects the checkpoint message before the next model call.
- when `maxCalls` is exhausted with `ask_model`, the model is steered to answer from current evidence instead of executing another search.
- when `maxConsecutiveCalls` is exhausted, the model is steered to synthesize or answer rather than chain another search.
- non-budgeted tools are unaffected.
- budget usage is per run and does not leak across runs.
- budget usage survives resume if execution state snapshots include it; if snapshots do not include it yet, explicitly document that budget counters are best-effort until snapshot schema is updated.

Delegation tests:

- delegate defaults can set `researchPolicy`.
- a researcher delegate with a stricter budget cannot accidentally bypass parent tool restrictions.
- child `MAX_STEPS` behavior remains unchanged in the first pass.

Gateway/config tests:

- valid `researchPolicy` parses.
- invalid `researchPolicy` reports a config issue.
- valid `toolBudgets` parse.
- invalid budget integers and `onExhausted` values report config issues.

Suggested commands:

```sh
bunx vitest run packages/core/src/tools/tools.test.ts
bunx vitest run packages/core/src/adaptive-agent.test.ts
bun --cwd packages/gateway-fastify test
```

## Migration And Compatibility Notes

This plan should be non-breaking if implemented as staged:

- existing configs do not change behavior
- existing `RunResult` shape stays unchanged
- existing tool inputs continue to work
- existing event types continue to work
- existing persisted runs and snapshots remain readable

Potential compatibility risks:

- if checkpoint messages are persisted in snapshots, snapshot schema may need a version bump
- if budget counters must survive process crash, snapshot schema needs additive state
- if a new failure code is introduced for budget exhaustion, gateway clients and analysis tools must be updated
- if `purpose` is required in schema immediately, older model prompts may fail tool validation
- if child `MAX_STEPS` is mapped to completed delegate output globally, write-oriented delegates may hide incomplete work

Mitigations:

- keep `purpose` optional in schema
- keep budgets disabled by default
- avoid new event types in first pass
- avoid first-class partial `RunResult` in first pass
- make delegate partial behavior opt-in and later
- document budget counter snapshot semantics clearly

## Implementation Order

1. Add types in `packages/core/src/types.ts` and `packages/gateway-fastify/src/core.ts`.
2. Add resolver for `researchPolicy` to `toolBudgets`.
3. Add `budgetGroup` to `web_search` and `read_web_page`.
4. Extend `web_search` input and descriptions with optional `purpose`.
5. Add budget tracking and checkpoint injection in `AdaptiveAgent`.
6. Add config parsing for `researchPolicy` and `toolBudgets`.
7. Update examples to pass parsed defaults into `createAdaptiveAgent`.
8. Update researcher skill instructions.
9. Update v1.4 docs.
10. Add tests for each stage.

## Out Of Scope For First Pass

- top-level `RunResult.status = 'partial'`
- new `RunStatus = 'partial'`
- schema or database migrations for partial run state
- automatic conversion of child `MAX_STEPS` into successful delegate output
- parallel child runs
- DAG execution
- child messaging
- model-specific search policy
- requiring `purpose` at schema validation time

