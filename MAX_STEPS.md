# MAX_STEPS Recovery

`maxSteps` is the runtime step budget for an agent run. When the budget is exhausted, the run fails with:

```text
Maximum steps exceeded
```

The persisted failure code is `MAX_STEPS`.

## Changing `maxSteps`

Set `maxSteps` in the agent config under `defaults`:

```json
{
  "id": "default-agent",
  "name": "Default Agent",
  "invocationModes": ["chat", "run"],
  "defaultInvocationMode": "chat",
  "model": {
    "provider": "mesh",
    "model": "qwen/qwen3.5-27b"
  },
  "tools": ["read_file", "list_directory", "write_file", "shell_exec"],
  "delegates": [],
  "defaults": {
    "maxSteps": 80,
    "modelTimeoutMs": 300000
  }
}
```

For the local gateway launcher, agent configs live in:

```text
~/.adaptiveAgent/agents/<agent-id>.json
```

For repository or custom gateway deployments, agent configs normally live in:

```text
config/agents/<agent-id>.json
```

After changing `maxSteps`, restart the gateway so the agent is recreated with the new default.

If `maxSteps` is omitted, the core default is `30`.

## Recovering a `MAX_STEPS` Run

`MAX_STEPS` is recoverable through `run.retry` when the new configured `maxSteps` is greater than the run's persisted `stepsUsed`.

For example:

1. A run fails with `MAX_STEPS` at `stepsUsed: 30`.
2. Increase that agent's `defaults.maxSteps` to `31` or higher.
3. Restart the gateway.
4. Send `run.retry` for the failed run.
5. The run resumes from the stored execution snapshot.

Retry is rejected if the configured limit is still less than or equal to the persisted `stepsUsed`. This makes the operator's explicit budget increase the guardrail against blindly continuing loops.

If the run hits `MAX_STEPS` again, repeat the same process: inspect the run, decide whether it is making progress, increase `maxSteps` above the latest `stepsUsed`, restart, and retry.

## What Counts as a Step

`maxSteps` is a budget over completed execution actions. It is not exactly the same thing as model calls.

A completed tool call counts as one step.

```text
tool completes = +1 step
```

A final model answer counts as one step.

```text
model returns final text or structured output = +1 step
```

A model response that only queues tool calls does not count as a step by itself.

```text
model asks for tool = 0 steps
```

Multiple tool calls from one model response count separately.

```text
model asks for 3 tools = 0 steps
tool 1 completes      = +1 step
tool 2 completes      = +1 step
tool 3 completes      = +1 step
```

Approval waits do not count as steps until the approved tool actually runs.

Failed model calls generally do not increment the step count; they fail the run before a step is completed.

Failed tool calls generally do not increment the step count unless the tool has a recovery handler that returns a recovered output. In that case, the recovered tool result is treated as a completed tool step.

## Example

This run uses three steps:

```text
LLM -> read_file request       = 0 steps
read_file completes           = 1 step
LLM -> shell_exec request     = 1 step
shell_exec completes          = 2 steps
LLM -> final answer           = 3 steps
```

With `maxSteps: 1`, the run can complete `read_file` and then fail with `MAX_STEPS` before the model gets a chance to summarize the tool result. Raising `maxSteps` and retrying lets the run continue from the stored snapshot.

## Operator Checklist

- Check whether the run is making progress or repeating the same action.
- Increase `defaults.maxSteps` only when continuing is intentional.
- Restart the gateway after changing the agent config.
- Retry the failed run with `run.retry`.
- If the run fails again with `MAX_STEPS`, inspect the latest transcript/events before raising the limit again.
