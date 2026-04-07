# AdaptiveAgent v2 Design: Parallel Child Runs

**Status**: Draft proposal
**Date**: April 2026
**Prerequisite**: Stable v1.4 runtime with serial delegation

This document designs the contract, runtime, persistence, and implementation changes
needed to support true parallel child runs within the AdaptiveAgent runtime.

---

## 1. Motivation

In v1.4 a parent run may delegate to only **one child at a time**. The parent enters
`awaiting_subagent`, blocks, and resumes only after that child terminates. When a
supervisor must fan out to multiple specialists (e.g. research + analysis + writing),
total latency is the **sum** of all child durations.

With parallel child runs, the supervisor can spawn N children concurrently and wait for
all (or some) to complete. Total latency becomes the **max** of child durations instead
of the sum, which can be a 2–5× improvement for multi-delegate goals.

---

## 2. Design Goals And Constraints

1. `Tool` remains the only first-class executable primitive.
2. Persisted plans remain linear and tool-only; `delegate.*` steps are still excluded.
3. The parent's delegation depth budget applies equally to every child.
4. The model decides which delegates to invoke; the runtime decides when to fan out vs.
   serialize based on the tool call batch the model returns.
5. Event ordering within each run stays strictly sequenced; cross-run ordering is
   reconstructed from the run tree, not a global clock.
6. The runtime does not become a general DAG executor or workflow engine.
7. Interrupt and resume remain safe across crash boundaries.

---

## 3. Key Concepts

### 3.1 Parallel Delegation Batch

When the model returns **multiple `delegate.*` tool calls in a single response**, the
runtime may execute them concurrently. This is called a **parallel delegation batch**.

A batch is identified by a stable `batchId` (a UUID generated at spawn time) and
tracked in the parent's execution state and snapshot.

### 3.2 Join Semantics

The parent waits for **all children in a batch** to reach a terminal status before
resuming. This is an **all-join** — the simplest model that avoids partial-result
ambiguity.

If any child fails, the parent still waits for remaining children to terminate (with
a bounded timeout), then applies failure policy per-child.

### 3.3 Mixed Batches

A single model response may contain both `delegate.*` and regular tool calls. The
runtime should:

1. Execute all non-delegate tool calls **first**, serially (preserving v1.4 behavior).
2. Collect all `delegate.*` calls from the same response into a batch.
3. Execute the batch concurrently.
4. Commit results back in the original tool-call order.

This ensures regular tools (which may produce context the delegates need) complete
before the fan-out.

---

## 4. Contract Changes

### 4.1 `RunStatus` (unchanged)

`awaiting_subagent` is reused. Its semantics change from "waiting on one child" to
"waiting on one or more children".

### 4.2 `AgentRun` Changes

```ts
export interface AgentRun {
  // ... all existing v1.4 fields ...

  // v1.4 field — DEPRECATED but kept for backward compat; set to undefined
  // when multiple children are active. Points to the single child when only
  // one is active (the common case).
  currentChildRunId?: UUID;

  // v2 field — the authoritative list of active child runs.
  // Empty array or undefined when no children are active.
  activeChildRunIds?: UUID[];
}
```

**Migration rule**: if `activeChildRunIds` is present and non-empty, it is authoritative.
If absent or empty, fall back to `currentChildRunId` for v1.4 compatibility.

### 4.3 `DelegationPolicy` Changes

```ts
export interface DelegationPolicy {
  maxDepth?: number;
  maxChildrenPerRun?: number;         // existing — total across the run lifetime
  maxConcurrentChildren?: number;     // NEW — max active at one time (default: 1)
  allowRecursiveDelegation?: boolean;
  childRunsMayRequestApproval?: boolean;
  childRunsMayRequestClarification?: boolean;
}
```

When `maxConcurrentChildren` is `1`, the runtime behaves identically to v1.4.

### 4.4 `ExecutionState` Changes

```ts
interface ExecutionState {
  messages: ModelMessage[];
  stepsUsed: number;
  outputSchema?: JsonSchema;
  pendingToolCalls: PendingToolCallState[];
  approvedToolCallIds: string[];

  // v1.4 — kept for single-child compat
  waitingOnChildRunId?: UUID;

  // v2 — parallel batch tracking
  activeBatch?: {
    batchId: string;
    entries: Array<{
      toolCallId: string;
      stepId: string;
      delegateName: string;
      childRunId: UUID;
      status: 'running' | 'succeeded' | 'failed';
      output?: JsonValue;
      error?: string;
      errorCode?: RunFailureCode;
    }>;
  };
}
```

### 4.5 `EventType` Changes

```ts
// Add:
| 'delegate.batch_started'   // emitted once when a parallel batch begins
| 'delegate.batch_completed' // emitted once when all children in a batch terminate
```

### 4.6 New Event Payloads

```ts
export interface DelegateBatchStartedPayload {
  batchId: string;
  parentRunId: UUID;
  childRunIds: UUID[];
  delegateNames: string[];
}

export interface DelegateBatchCompletedPayload {
  batchId: string;
  parentRunId: UUID;
  childResults: Array<{
    childRunId: UUID;
    delegateName: string;
    status: 'succeeded' | 'failed';
    output?: JsonValue;
    error?: string;
  }>;
}
```

### 4.7 `RunStore` Changes

```ts
export interface RunStore {
  // ... all existing methods ...

  // v2 addition — atomic multi-child linkage
  setActiveChildren(
    parentRunId: UUID,
    childRunIds: UUID[],
    expectedVersion?: number,
  ): Promise<AgentRun>;
}
```

### 4.8 `SnapshotStore` — No Interface Changes

The `state: JsonValue` field already accommodates the extended `ExecutionState` shape.
The `activeBatch` field is serialized/deserialized alongside existing state.

---

## 5. Postgres Schema Changes

### 5.1 `agent_runs` Migration

```sql
-- Add array column for multi-child tracking
alter table agent_runs
  add column active_child_run_ids uuid[] not null default '{}';

-- Index for finding parents of a given child
create index agent_runs_active_children_idx
  on agent_runs using gin (active_child_run_ids);
```

**Backfill**: for existing rows where `current_child_run_id` is not null:

```sql
update agent_runs
set active_child_run_ids = array[current_child_run_id]
where current_child_run_id is not null
  and active_child_run_ids = '{}';
```

### 5.2 Other Tables — No Changes

`agent_events`, `run_snapshots`, `plans`, `plan_steps`, `plan_executions` are
unchanged. Delegation linkage is stored in event payloads and the run tree.

---

## 6. Runtime Algorithms

### 6.1 Parallel Delegation Spawn

When `executionLoop()` encounters multiple `delegate.*` tool calls from the same model
response and `maxConcurrentChildren > 1`:

```
function spawnParallelBatch(run, delegateToolCalls, state):
  1. Validate total children (existing + batch) ≤ maxChildrenPerRun
  2. Validate batch size ≤ maxConcurrentChildren
  3. Validate delegationDepth + 1 ≤ maxDepth for each

  4. batchId = generateUUID()
  5. childRunIds = []
  6. batchEntries = []

  7. for each delegateToolCall in delegateToolCalls:
       a. childRunId = generateUUID()
       b. create child run in store (status: 'queued')
       c. emit 'tool.started' on parent
       d. emit 'delegate.spawned' on parent
       e. emit 'run.created' on child
       f. childRunIds.push(childRunId)
       g. batchEntries.push({ toolCallId, stepId, delegateName, childRunId, status: 'running' })

  8. runStore.setActiveChildren(run.id, childRunIds)
  9. transition parent to 'awaiting_subagent'
 10. state.activeBatch = { batchId, entries: batchEntries }
 11. save parent snapshot
 12. emit 'delegate.batch_started'

 13. results = await Promise.allSettled(
       batchEntries.map(entry => executeChildRun(entry))
     )

 14. for each (entry, result) in zip(batchEntries, results):
       materialize child terminal state
       update entry.status, entry.output or entry.error

 15. emit 'delegate.batch_completed'
 16. runStore.setActiveChildren(run.id, [])
 17. transition parent back to 'running'
 18. commit tool results in original tool-call order
 19. clear state.activeBatch
 20. save parent snapshot
```

### 6.2 All-Join Wait

The parent does **not** resume until every child in the batch reaches a terminal
status (`succeeded`, `failed`, `cancelled`, `clarification_requested`,
`replan_required`).

If any child is stuck (non-terminal for longer than a configurable
`batchTimeoutMs`), the runtime should:

1. Best-effort interrupt the stuck child.
2. Mark that child entry as failed with `INTERRUPTED`.
3. Continue the join.

### 6.3 Result Mapping

After the join, results are committed back in the **original tool-call order** from
the model response:

```
for each entry in state.activeBatch.entries (in order):
  if entry.status === 'succeeded':
    push tool result message with entry.output
    emit 'tool.completed' on parent
  else:
    push tool error message
    emit 'tool.failed' on parent
  emit 'step.completed' on parent
  stepsUsed += 1
```

This preserves the message-history contract that the model expects.

### 6.4 Resume Algorithm

When `resume(parentRunId)` finds a parent in `awaiting_subagent` with an
`activeBatch`:

```
function resumeParallelParent(parent, state):
  1. Load activeBatch from snapshot state
  2. For each entry where status is 'running':
       a. Load child run from store
       b. If child is terminal → update entry status/output/error
       c. If child is interrupted → resume child, then recheck
       d. If child is still running → re-await (or drive child)
  3. If all entries are terminal → commit results, transition to 'running'
  4. If some entries are still running → re-enter wait
```

### 6.5 Interrupt Cascade

When `interrupt(parentRunId)` is called and the parent has an active batch:

```
function interruptParallelParent(parent, state):
  1. Mark parent as interrupted
  2. For each entry in activeBatch where status is 'running':
       best-effort interrupt(entry.childRunId)
  3. Save parent snapshot
```

This is the natural extension of v1.4's single-child cascade.

### 6.6 Idempotent Resolution

Multiple `resume()` calls racing on the same parent must not double-commit
results. The guard is:

- Each batch entry has a `status` field in the snapshot.
- Once an entry is marked `succeeded` or `failed` in the snapshot, it is never
  re-processed.
- The parent's `activeChildRunIds` is cleared atomically via optimistic
  versioning (`setActiveChildren` with `expectedVersion`).

---

## 7. Failure Modes

| Scenario | Behavior |
|----------|----------|
| One child fails, others succeed | Parent receives per-child results; failed child maps to `tool.failed` |
| All children fail | Parent receives all failures; model may retry or terminate |
| Child requests approval | Treated as child failure (v1.4 rule preserved) |
| Child requests clarification | Treated as child failure (v1.4 rule preserved) |
| Crash during batch execution | Resume loads `activeBatch` from snapshot, re-checks each child |
| Crash after some children complete | Completed children have results in store; resume skips them |
| `maxConcurrentChildren` exceeded | Excess `delegate.*` calls queued and executed in next batch |
| Delegate profile removed mid-batch | Child creation fails → that entry is marked failed immediately |
| Recursive delegation in parallel child | Governed by existing `allowRecursiveDelegation` + `maxDepth` |

---

## 8. Event Sequence Example

A parent spawning two parallel children:

```
 1. parent step.started
 2. parent tool.started  (delegate.researcher, childRunId=A)
 3. parent delegate.spawned (childRunId=A)
 4. parent tool.started  (delegate.analyst, childRunId=B)
 5. parent delegate.spawned (childRunId=B)
 6. parent delegate.batch_started (batchId=X, children=[A,B])
 7. parent run.status_changed → awaiting_subagent
     ── children execute concurrently ──
 8. child-A run.created
 9. child-A step.started / tool.started / tool.completed / step.completed
10. child-A run.completed
11. child-B run.created
12. child-B step.started / tool.started / tool.completed / step.completed
13. child-B run.completed
     ── parent join ──
14. parent delegate.batch_completed (batchId=X)
15. parent tool.completed (delegate.researcher)
16. parent step.completed (step for delegate.researcher)
17. parent tool.completed (delegate.analyst)
18. parent step.completed (step for delegate.analyst)
19. parent run.status_changed → running
20. parent continues next model turn
```

---

## 9. Implementation Plan

### Phase 1: Contract & Types (no runtime changes)

| Task | File(s) | Notes |
|------|---------|-------|
| Add `activeChildRunIds` to `AgentRun` | `types.ts` | Optional field, default `[]` |
| Add `maxConcurrentChildren` to `DelegationPolicy` | `types.ts` | Default `1` |
| Add `activeBatch` to `ExecutionState` (internal) | `adaptive-agent.ts` | Not exported |
| Add `delegate.batch_started` and `delegate.batch_completed` to `EventType` | `types.ts` | |
| Add `DelegateBatchStartedPayload`, `DelegateBatchCompletedPayload` | `types.ts` | |
| Add `setActiveChildren` to `RunStore` | `types.ts` | |
| Implement `setActiveChildren` in `InMemoryRunStore` | `in-memory-run-store.ts` | |
| Update snapshot serialization/deserialization for `activeBatch` | `adaptive-agent.ts` | |
| **Verify**: `bun test` passes, all existing behavior unchanged | | `maxConcurrentChildren` defaults to `1` |

### Phase 2: Schema Migration

| Task | File(s) | Notes |
|------|---------|-------|
| Add `active_child_run_ids uuid[]` to `agent_runs` | migration SQL | |
| Add GIN index | migration SQL | |
| Backfill from `current_child_run_id` | migration SQL | |
| Update Postgres `RunStore` if it exists | `store-postgres` | Must implement `setActiveChildren` |
| **Verify**: migration is idempotent, v1.4 data intact | | |

### Phase 3: Parallel Spawn Path in DelegationExecutor

| Task | File(s) | Notes |
|------|---------|-------|
| Add `spawnParallelBatch()` method | `delegation-executor.ts` | Core new code |
| Add batch-aware `assertDelegationAllowed()` | `delegation-executor.ts` | Check `maxConcurrentChildren` |
| Emit `delegate.batch_started` | `delegation-executor.ts` | |
| Execute children via `Promise.allSettled` | `delegation-executor.ts` | |
| Emit `delegate.batch_completed` | `delegation-executor.ts` | |
| Add `resolveParallelBatch()` for result mapping | `delegation-executor.ts` | |
| **Verify**: unit test with mock model returning 2 delegate calls | | |

### Phase 4: Execution Loop Integration

| Task | File(s) | Notes |
|------|---------|-------|
| Detect multiple `delegate.*` calls in pending queue | `adaptive-agent.ts` | In `executionLoop()` |
| Route to parallel path when `maxConcurrentChildren > 1` | `adaptive-agent.ts` | |
| Commit results in original order after join | `adaptive-agent.ts` | |
| Handle mixed batches (regular tools first, then delegates) | `adaptive-agent.ts` | |
| **Verify**: end-to-end test with 2 parallel delegates | | |

### Phase 5: Resume & Interrupt

| Task | File(s) | Notes |
|------|---------|-------|
| Extend `resumeAwaitingParent()` for `activeBatch` | `adaptive-agent.ts` | |
| Add `resumeParallelBatch()` | `delegation-executor.ts` | |
| Extend `interrupt()` to cascade to all active children | `adaptive-agent.ts` | |
| Add idempotent batch resolution guard | `delegation-executor.ts` | |
| **Verify**: crash-resume test — kill after 1/2 children done | | |

### Phase 6: Tests & Documentation

| Task | Notes |
|------|-------|
| Unit: 2 parallel children both succeed | |
| Unit: 1 succeeds, 1 fails → parent gets both results | |
| Unit: crash after `delegate.batch_started`, resume completes | |
| Unit: interrupt cascades to all children | |
| Unit: `maxConcurrentChildren=1` behaves identically to v1.4 | |
| Unit: `maxConcurrentChildren` exceeded → excess queued | |
| Unit: mixed batch (regular tool + 2 delegates) | |
| Unit: repeated resume is idempotent | |
| Update `agen-spec-v2.md` | Move parallel children from non-goals to supported |
| Update `agen-contracts-v2.md` | New types, schema, store methods |
| Update `agen-runtime-v2-algorithms.md` | Parallel spawn, join, resume, interrupt |

---

## 10. Effort Estimates

| Phase | Estimate |
|-------|----------|
| Phase 1: Contract & Types | 1 day |
| Phase 2: Schema Migration | 0.5 day |
| Phase 3: Parallel Spawn | 2–3 days |
| Phase 4: Execution Loop | 1–2 days |
| Phase 5: Resume & Interrupt | 2–3 days |
| Phase 6: Tests & Docs | 2–3 days |
| **Total** | **~9–13 days** |

---

## 11. Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Increased complexity in resume/snapshot | `activeBatch` is a single serializable structure; entry-level status tracking keeps it manageable |
| Race conditions on parent state | Optimistic versioning via `expectedVersion` on all parent updates |
| Child-to-child interference | Children share no mutable state; each has its own run, lease, and event sequence |
| Backward compatibility | `maxConcurrentChildren=1` preserves v1.4 serial behavior exactly |
| Event ordering confusion | Each run keeps its own `seq`; batch events provide the cross-run correlation |
| Postgres array column perf | GIN index; `activeChildRunIds` is small (bounded by `maxConcurrentChildren`) |

---

## 12. What This Design Does NOT Include

These remain out of scope for v2 and would require separate designs:

- **Child-to-child messaging** — children cannot communicate with siblings
- **Partial join / any-join** — parent waits for all, not first-to-finish
- **DAG execution** — plans remain linear; parallel fan-out is model-driven only
- **Delegate steps in persisted plans** — still excluded
- **Parallel non-delegate tool execution** — can be added independently as a separate optimization
- **Nested parallel batches** — a child run may not itself spawn a parallel batch (governed by `maxConcurrentChildren` at each level)
