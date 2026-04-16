# Opt-In Agent Streaming Implementation Plan

## Goal

Add opt-in model streaming at the agent level while preserving the existing
non-streaming `generate()` path as the default behavior.

The first implementation should make streaming a drop-in runtime choice that
still returns the same final `ModelResponse` shape used today. Live token
delivery through the gateway can be layered on after the runtime path is stable.

## Current State

- `AdaptiveAgent.generateModelResponse()` always calls `model.generate()`.
- `ModelAdapter` already defines an optional `stream()` method.
- OpenRouter, Mistral, Mesh, and Ollama adapters declare
  `capabilities.streaming: true`.
- `BaseOpenAIChatAdapter` does not currently implement `stream()`.
- `modelTimeoutMs` is a hard wall-clock timeout for a model turn.
- Gateway agent config already supports `defaults.modelTimeoutMs`.
- Gateway agent config currently requires positive integers for timeout fields,
  so `modelTimeoutMs: 0` is not accepted through gateway config.

## Non-Goals

- Do not replace the existing `generate()` path.
- Do not require every adapter to implement streaming immediately.
- Do not change tool execution, plan execution, delegation semantics, snapshots,
  or replay behavior.
- Do not stream chain-of-thought or provider-private reasoning.
- Do not make streaming mandatory for gateway clients in the first phase.

## Public Configuration

Extend agent defaults with streaming controls:

```ts
interface AgentDefaults {
  maxSteps?: number;
  toolTimeoutMs?: number;
  modelTimeoutMs?: number;
  modelStreaming?: boolean;
  modelIdleTimeoutMs?: number;
  maxRetriesPerStep?: number;
  requireApprovalForWriteTools?: boolean;
  autoApproveAll?: boolean;
  capture?: CaptureMode;
}
```

Recommended defaults:

- `modelStreaming`: `false`
- `modelIdleTimeoutMs`: unset, meaning no separate idle timeout
- `modelTimeoutMs`: keep current behavior

Gateway agent config example:

```json
{
  "defaults": {
    "modelTimeoutMs": 600000,
    "modelStreaming": true,
    "modelIdleTimeoutMs": 120000
  }
}
```

## Runtime Behavior

Update `AdaptiveAgent.generateModelResponse()` to choose the model call path:

```ts
const canStream =
  this.defaults.modelStreaming === true &&
  this.options.model.capabilities.streaming &&
  typeof this.options.model.stream === 'function';

response = canStream
  ? await this.options.model.stream(modelRequest, onStreamEvent)
  : await this.options.model.generate(modelRequest);
```

The streaming path must return a complete `ModelResponse` compatible with the
current execution loop:

```ts
interface ModelResponse {
  text?: string;
  structuredOutput?: JsonValue;
  toolCalls?: ModelToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
  usage?: UsageSummary;
  providerResponseId?: string;
  summary?: string;
}
```

If streaming is enabled but the adapter does not support it, fall back to
`generate()` and emit a debug log such as `model.streaming_unavailable`.

## Timeout Semantics

Keep `modelTimeoutMs` as the total wall-clock timeout for a model turn.

Add `modelIdleTimeoutMs` for the streaming path:

- If no stream event is received within `modelIdleTimeoutMs`, abort the model
  turn with a timeout failure.
- Reset the idle timer after every accepted stream event.
- If both total and idle timeouts are configured, either can abort the turn.
- If `modelIdleTimeoutMs` is unset, only the total timeout applies.

Do not remove the existing `modelTimeoutMs` guard. Long-running streaming calls
should set a larger `modelTimeoutMs` plus a smaller `modelIdleTimeoutMs`.

Example:

```json
{
  "defaults": {
    "modelTimeoutMs": 900000,
    "modelStreaming": true,
    "modelIdleTimeoutMs": 120000
  }
}
```

## Stream Events

Use the existing `ModelStreamEvent` interface initially:

```ts
interface ModelStreamEvent {
  type: 'status' | 'summary' | 'usage';
  payload: JsonValue;
}
```

For the first phase, stream events should be consumed internally for logging,
idle timeout refresh, and optional downstream event emission. The final response
remains the canonical value used by the agent loop.

Recommended lifecycle logs:

- `model.stream.started`
- `model.stream.event`
- `model.stream.completed`
- `model.stream.failed`
- `model.streaming_unavailable`

Avoid logging raw token deltas by default. If raw chunks are needed later, gate
them behind `capture: 'full'` or a separate debug option.

## Adapter Implementation

Implement `stream()` in `BaseOpenAIChatAdapter`.

Request behavior:

- Reuse `buildRequestBody(request)`.
- Add `stream: true`.
- For providers that support it, request usage in the final stream event.
- Reuse existing headers, request gate, retry, cooldown, and abort signal
  behavior where practical.

Parsing behavior:

- Parse server-sent events from `response.body`.
- Ignore empty lines and comments.
- Stop on `[DONE]`.
- Accumulate `content` deltas into final `text`.
- Accumulate tool call deltas by index and id.
- Reconstruct tool call function names and argument strings.
- Parse accumulated tool arguments using the existing argument parser.
- Map final provider finish reason using the existing finish reason mapper.
- Return the same `ModelResponse` shape as `generate()`.

Provider notes:

- OpenRouter, Mesh, Mistral, and Ollama are OpenAI-compatible enough to share the
  initial `BaseOpenAIChatAdapter.stream()` path.
- Some providers may emit usage only in the final chunk or not at all.
- Some providers may stream tool call arguments in fragmented JSON strings.
- Some providers may return provider-specific event shapes; keep parsing
  tolerant and preserve fallback to `generate()`.

## Gateway Wiring

Update gateway-facing types and config parsing:

- Add `modelStreaming?: boolean` to `AgentDefaults` in
  `packages/gateway-fastify/src/core.ts`.
- Add `modelIdleTimeoutMs?: number` to the same type.
- Parse `defaults.modelStreaming` as an optional boolean in
  `packages/gateway-fastify/src/config.ts`.
- Parse `defaults.modelIdleTimeoutMs` as an optional positive integer.
- Update config tests to cover both fields.
- Update gateway README agent config docs with the new fields.

The agent registry should not need structural changes because it already passes
`entry.definition.config.defaults` into `createAdaptiveAgent()`.

## Core Type Changes

Update core runtime types:

- Add `modelStreaming?: boolean` to core agent defaults/options.
- Add `modelIdleTimeoutMs?: number`.
- Add defaults to `DEFAULT_AGENT_DEFAULTS` or resolve them explicitly in the
  constructor.
- Keep the default streaming value false.

Avoid changing `ModelAdapter.generate()` or the required adapter surface.
`stream()` remains optional.

## Event Store and Replay

Do not persist token deltas as durable execution state in the first phase.

Persist the same final model output artifacts as today:

- final assistant text
- final tool calls
- usage, if available
- snapshots after model response/tool-call queueing as currently implemented

This avoids introducing replay instability from partial streamed content.

## Testing Plan

Core tests:

- Default behavior still calls `generate()`.
- `modelStreaming: true` calls `stream()` when capability and method exist.
- `modelStreaming: true` falls back to `generate()` when `stream()` is missing.
- Streamed text returns the same final result shape as generated text.
- Streamed tool call chunks reconstruct a valid `ModelToolCall`.
- `modelIdleTimeoutMs` aborts when no stream events arrive.
- Stream events reset the idle timeout.
- `modelTimeoutMs` still aborts total long-running stream turns.
- Streaming model failure maps to the same run failure path as generate failure.

Adapter tests:

- Parses SSE text deltas.
- Parses fragmented tool call arguments.
- Handles `[DONE]`.
- Handles final usage chunks when present.
- Aborts cleanly when `AbortSignal` is triggered.
- Keeps request gate release behavior correct on success, failure, and abort.
- Preserves existing retry behavior for retryable HTTP responses before stream
  body consumption begins.

Gateway tests:

- Agent config accepts `defaults.modelStreaming`.
- Agent config accepts `defaults.modelIdleTimeoutMs`.
- Invalid non-boolean `modelStreaming` is rejected.
- Invalid non-positive `modelIdleTimeoutMs` is rejected.
- Registry passes parsed defaults through unchanged.

Manual verification:

```bash
bunx vitest run packages/core/src/adaptive-agent.test.ts
bunx vitest run packages/core/src/adapters/adapters.test.ts
bun --cwd packages/gateway-fastify test
```

Then run a gateway agent with:

```json
{
  "agentRuntimeLogging": {
    "enabled": true,
    "level": "debug",
    "destination": "file"
  }
}
```

and an agent config containing:

```json
{
  "defaults": {
    "modelTimeoutMs": 600000,
    "modelStreaming": true,
    "modelIdleTimeoutMs": 120000
  }
}
```

Confirm logs include `model.stream.started` and `model.stream.completed`.

## Rollout Plan

1. Add config and type fields with defaults off.
2. Add runtime branch with fallback to `generate()`.
3. Add stream idle timeout helper.
4. Implement `BaseOpenAIChatAdapter.stream()`.
5. Add unit tests for runtime selection and adapter parsing.
6. Add gateway config tests and README docs.
7. Test with Ollama locally.
8. Test with one hosted OpenAI-compatible provider.
9. Keep `modelStreaming` off in examples until manual provider testing is
   complete.
10. Add live gateway token forwarding in a later phase if needed.

## Risks and Edge Cases

- Tool call streaming is provider-fragmented and can arrive as partial JSON.
- Some providers advertise streaming but omit final usage data.
- Some providers may not support streaming with structured output or tools in
  every model.
- Streaming can keep a request alive but does not remove total runtime limits.
- Request queue wait time can still consume `modelTimeoutMs` before streaming
  begins.
- Gateway clients may confuse runtime streaming with websocket live token
  delivery; document that these are separate phases.
- Persisting partial stream events too early could complicate replay semantics.

## Future Phase: Gateway Live Streaming

After the runtime streaming path is stable, add optional forwarding from model
stream events to gateway websocket clients.

Potential protocol events:

- `run.model_stream.started`
- `run.model_stream.delta`
- `run.model_stream.usage`
- `run.model_stream.completed`
- `run.model_stream.failed`

This should be negotiated by client capability or channel policy so existing
clients continue to receive the current final-result frames unchanged.
