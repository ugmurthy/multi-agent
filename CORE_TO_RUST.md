# Proposal: Port `@adaptive-agent/core` To Rust

## Recommendation

Yes, `@adaptive-agent/core` can be implemented in Rust while preserving the same consumer-facing JavaScript and TypeScript API surface, but not as a pure Rust-only public API.

The practical shape is:

- keep the published TypeScript package surface stable
- move the execution engine and store implementations into Rust
- expose Rust through a Bun-compatible Node-API native module
- keep a thin TypeScript compatibility layer that preserves the current exports, classes, method names, result shapes, and config objects

This is the only approach that realistically preserves the current API surface because the package today exposes JavaScript-native callbacks and host objects such as:

- `ToolDefinition.execute()`, `summarizeResult()`, and `recoverError()`
- `ModelAdapter.generate()` and optional `stream()`
- `EventSink.emit()` and `EventStore.subscribe()`
- `logger?: pino.Logger`
- dynamic skill handler loading via `import()` from `SKILL.md`

A direct Rust crate API would be a different API, even if the runtime behavior were equivalent.

## Current Surface To Preserve

The current `@adaptive-agent/core` surface is broader than a single agent loop. It includes:

- `AdaptiveAgent` with `run`, `chat`, `plan`, `executePlan`, `interrupt`, `resolveApproval`, `resolveClarification`, `resume`, and `retry`
- helper constructors such as `createAdaptiveAgent()` and `createAdaptiveAgentRuntime()`
- runtime contracts from `types.ts`, including `ToolDefinition`, `ModelAdapter`, `RunStore`, `EventStore`, `SnapshotStore`, `PlanStore`, `ToolExecutionStore`, `RuntimeTransactionStore`, `DelegateDefinition`, and the `RunResult` union
- in-memory stores
- PostgreSQL runtime stores, recovery scanner, and SQL migrations
- built-in model adapters for `openrouter`, `ollama`, `mistral`, and `mesh`
- built-in tools for file I/O, shell execution, web search, and web page reading
- skill loading from Markdown plus optional handler module import
- logging helpers built around `pino`

The implementation is also non-trivial in size today:

- `adaptive-agent.ts`: about 3.3k LOC
- `delegation-executor.ts`: about 1.2k LOC
- `postgres-runtime-stores.ts`: about 1.25k LOC
- `types.ts`: about 600 LOC
- existing tests in `packages/core`: about 5.8k LOC

That matters because the test suite should become the compatibility oracle for any Rust-backed port.

## Feasibility By Area

### Strong Rust Candidates

These parts map naturally to Rust and should benefit from stronger typing, better state-machine discipline, and lower runtime overhead:

- run execution loop and execution state
- run lifecycle transitions and event emission
- delegation and child run orchestration
- approval and clarification state handling
- snapshot serialization and replay compatibility checks
- in-memory stores
- PostgreSQL stores and recovery scanner
- HTTP-based built-in model adapters
- HTTP-based built-in tools
- filesystem and shell built-in tools

### Feasible With A JS Bridge

These are possible, but only if Rust can call back into JavaScript:

- custom tools supplied as `ToolDefinition[]`
- custom model adapters supplied as `ModelAdapter`
- custom stores supplied as `RunStore`, `EventStore`, `SnapshotStore`, `PlanStore`, `ToolExecutionStore`, or `RuntimeTransactionStore`
- event sinks and event subscriptions
- logging through a JS `pino` logger

These are the main reason the compatibility layer must remain in TypeScript.

### Best Kept In TypeScript Initially

These parts are not impossible in Rust, but they are tightly tied to the current JS hosting model and do not provide the same payoff as the runtime engine:

- `loadSkillFromDirectory()` and `loadSkillFromFile()`
- `parseSkillMarkdown()` as currently shaped around JS skill loading
- dynamic `import()` of handler modules referenced by `SKILL.md`
- direct exposure of `pino` logger instances

The Rust proposal should treat these as host concerns first, not core-engine concerns.

## Main Constraints

### 1. The API Surface Is Callback-Heavy

The runtime accepts executable host objects, not only data:

- tools are JS functions
- model adapters are JS functions
- stores may be JS objects with async methods
- event listeners are JS callbacks

Rust can drive these only through a callback bridge. That bridge must support:

- async request/response calls from Rust to JS
- cancellation via `AbortSignal`
- structured JSON payloads
- error propagation with stable codes and messages

### 2. Bun Runtime Compatibility Must Be Treated As A Spike, Not An Assumption

This repo is Bun-first. For native interop, the safest path is Bun's Node-API support, not `bun:ffi`.

Relevant current signals:

- Bun documents Node-API support and says it implements most of the interface and can load `.node` addons directly
- Bun documents `bun:ffi` as experimental and says Node-API is the more stable production path
- the broader ecosystem still has enough historical async caveats that this project should validate callback-heavy async behavior early

For this codebase, that means a mandatory proof-of-concept before any major rewrite:

- load a Rust Node-API addon from Bun
- call async Rust methods from Bun
- have Rust call async JS tool callbacks
- verify that cancellation and process lifetime behave correctly under Bun

### 3. Same API Surface Does Not Mean Same Internal Object Model

To preserve compatibility, the following must stay stable from a caller's point of view:

- exported names
- constructor and factory function names
- request and result JSON shapes
- event types and event payload semantics
- store method contracts
- approval, clarification, retry, resume, and child run behavior

Internally, Rust can use enums, traits, channels, and typed state machines, but those must be hidden behind the compatibility layer.

## Recommended Architecture

### Overview

Use a hybrid architecture:

- Rust owns the runtime engine and native store implementations
- TypeScript owns the public package boundary and JS-native host integrations
- JS wrappers preserve the exact exported API shape

### Proposed Layers

#### 1. Rust Engine Crate

Create a Rust crate that owns the portable runtime logic:

- run state machine
- execution loop
- delegation executor
- snapshot state format
- result unions and failure codes
- deterministic event generation
- native in-memory stores
- native PostgreSQL stores and recovery logic

Suggested crate names:

- `crates/adaptive-agent-core-rs`
- `crates/adaptive-agent-core-napi`

#### 2. Node-API Native Addon

Expose the Rust engine to Bun through Node-API.

This layer should expose a small, internal native API such as:

```ts
type NativeAgentHandle = {
  run(requestJson: string): Promise<string>;
  chat(requestJson: string): Promise<string>;
  plan(requestJson: string): Promise<string>;
  executePlan(requestJson: string): Promise<string>;
  interrupt(runId: string): Promise<void>;
  resolveApproval(runId: string, approved: boolean): Promise<void>;
  resolveClarification(runId: string, message: string): Promise<string>;
  resume(runId: string): Promise<string>;
  retry(runId: string): Promise<string>;
};
```

The native boundary should prefer serialized JSON payloads and opaque handles over trying to mirror every TypeScript generic directly.

#### 3. TypeScript Compatibility Layer

Keep `packages/core/src/index.ts` as the public entrypoint.

This layer should:

- preserve the current exports
- preserve the `AdaptiveAgent` class shape
- preserve `createAdaptiveAgent()` and `createAdaptiveAgentRuntime()`
- preserve the current type exports
- translate JS tools, models, stores, and sinks into callback handles that Rust can invoke
- translate native results and errors back into the current JS shapes

The compatibility layer is where same-surface compatibility is actually enforced.

## API Preservation Strategy

### `AdaptiveAgent`

Keep the current class name and public methods exactly as they are.

The TypeScript class becomes a thin wrapper around a native handle.

### `ToolDefinition`

Preserve the current shape for callers.

Internally:

- built-in tools can be recognized and executed natively in Rust
- custom tools should be registered into a JS callback registry
- Rust invokes them by callback ID

This keeps the public API stable while allowing native fast paths for built-ins.

### `ModelAdapter`

Support two modes:

- built-in adapters created from config run natively in Rust
- custom JS adapters remain supported through a callback bridge

This is important because custom adapters are part of the current contract.

### Stores

Support two modes:

- native Rust implementations for `InMemory*` and PostgreSQL stores
- callback adapters for custom user-supplied stores

This gives performance where the runtime actually spends time, without breaking extensibility.

### Skills

Phase 1 should keep skill loading in TypeScript.

The compatibility layer should:

- parse and load skills exactly as today
- keep handler `import()` in JS
- convert loaded skills into delegate profiles passed into Rust

This avoids forcing Rust to become a JS module loader.

### Logging

Keep `createAdaptiveAgentLogger()` and the `pino`-based helpers in TypeScript.

Rust should emit structured log records to JS, and JS should hand them to `pino` when a logger is configured.

## What Should Not Be Done

These options are technically possible but are not a good fit if the goal is to keep the same API surface.

- Do not replace the package with a separate Rust service over HTTP or gRPC. That changes the programming model.
- Do not use `bun:ffi` as the primary production bridge. Bun marks it experimental.
- Do not try to port dynamic JS skill handler loading into Rust in the first cut.
- Do not port only the outer `AdaptiveAgent` wrapper while leaving all high-frequency stores in JS. That would add bridge complexity without moving the hot path.

## Migration Plan

### Phase 0: Compatibility Inventory

- freeze the current public exports and request/result shapes
- document all current error types and failure codes
- identify which existing tests are compatibility tests versus implementation tests
- add a small set of golden tests for event order, snapshot state, resume behavior, and child run behavior

### Phase 1: Bun Native Interop Spike

- build a minimal Rust Node-API addon
- load it from Bun in this workspace
- prove async native methods work under Bun
- prove Rust can invoke async JS callbacks for tools and model adapters
- prove cancellation and shutdown semantics are reliable

Exit criterion:

- Bun can host the callback-heavy path that this runtime requires

### Phase 2: Rust Domain And Engine

- port runtime contracts into Rust data structures
- port the execution loop
- port delegation executor logic
- port approval, clarification, interrupt, resume, and retry flows
- keep `plan()` unimplemented if the JS version is still intentionally unimplemented

Exit criterion:

- deterministic fake-model tests match current JS behavior for core run flows

### Phase 3: Native Stores

- port `InMemoryRunStore`, `InMemoryEventStore`, `InMemorySnapshotStore`, `InMemoryPlanStore`, and `InMemoryToolExecutionStore`
- port PostgreSQL runtime stores and recovery scanner
- preserve migration SQL compatibility unless a deliberate migration is proposed

Exit criterion:

- gateway-facing store behavior remains compatible with the current `@adaptive-agent/core` contracts

### Phase 4: Compatibility Wrapper

- implement TypeScript wrappers for `AdaptiveAgent` and helper constructors
- add callback registries for tools, models, stores, event sinks, and loggers
- preserve current exported names and TypeScript types

Exit criterion:

- `packages/gateway-fastify` can consume the Rust-backed package without changing its imports or local type expectations

### Phase 5: Native Fast Paths

- port built-in model adapters to Rust
- port built-in tools to Rust
- keep JS callback fallback for custom tools and custom models

Exit criterion:

- built-in happy paths avoid JS callback overhead

### Phase 6: Rollout

- ship behind an opt-in backend selector such as `backend: 'ts' | 'rust'`
- run the same test suite against both backends
- switch default only after parity is proven

## Risks

### High Risk

- Bun async Node-API behavior under heavy callback traffic
- preserving exact event ordering and snapshot semantics
- callback reentrancy between Rust and JS during tool execution
- cancellation and timeout propagation across the native boundary
- performance regression if stores remain callback-based instead of native

### Medium Risk

- mapping JS `Error` objects to stable Rust error categories and back
- matching current PostgreSQL optimistic concurrency behavior exactly
- preserving logger semantics without leaking Rust internals into the public API
- keeping `EventStore.subscribe()` behavior compatible

### Lower Risk

- porting filesystem tools
- porting HTTP model adapters
- porting HTTP web tools

## Success Criteria

A Rust-backed port should only be considered successful if all of the following are true:

- callers keep using the same package import paths
- `AdaptiveAgent` keeps the same public methods
- `RunResult` and related JSON shapes remain unchanged
- current event names and lifecycle semantics remain unchanged
- custom JS tools and model adapters still work
- `packages/gateway-fastify` runs without API-level changes
- the existing core test suite passes against the Rust backend, with only intentionally updated implementation-detail tests

## Recommended First Cut

The best first implementation is not a full rewrite of every export.

The best first cut is:

- Rust engine
- Rust in-memory stores
- Rust PostgreSQL stores
- TypeScript compatibility wrapper
- JS callback support for custom tools, custom models, skills, logging, and event sinks

That delivers most of the technical benefit while keeping the migration realistic.

## Final Verdict

`@adaptive-agent/core` is a good candidate for a Rust-backed implementation, but the right target is a hybrid architecture, not a pure Rust replacement of the public package boundary.

If the goal is truly "same API surface", the proposal should be:

- keep the TypeScript package surface
- implement the runtime engine and store backends in Rust
- use a Bun-compatible Node-API addon
- keep JS-native extension points at the TypeScript boundary

If that boundary is accepted, the port is feasible.

If the requirement is instead "replace the package with a direct Rust API and no JS compatibility layer", then the answer is no: that would be a new API, not the same one.
