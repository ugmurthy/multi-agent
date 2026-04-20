# Manual Testing

## Feature Explainer

This feature adds policy-based runtime control for web research without changing the top-level run result model.

In practice, that means:

- `web_search` and `read_web_page` can be assigned to research budget groups
- the runtime can enforce limits on total calls and consecutive calls
- the runtime can inject a checkpoint warning before the next model turn when research is getting expensive
- when the configured research budget is exhausted, the run does not automatically fail
- instead, the model is nudged to answer from current evidence, state uncertainty clearly, or explain what specific fact is still missing

The main goal is to reduce wasteful search loops while preserving useful research behavior. It is especially helpful for prompts that invite the model to keep searching "just a little more" even when the available evidence is already sufficient for a good answer.

What to look for while testing:

- the model uses search only when current or unknown facts are actually needed
- once enough evidence is gathered, it shifts into synthesis instead of continuing broad search
- after the checkpoint warning, tool use becomes more selective
- after budget exhaustion, the model answers with caveats instead of spiraling into more search calls

This guide covers manual testing for the v1.4 research budget and partial evidence behavior implemented in the core runtime, example runner, gateway config parser, and researcher delegate skill.

Primary files involved:

- `packages/core/src/adaptive-agent.ts`
- `packages/core/src/tool-budget-policy.ts`
- `packages/core/src/tools/web-search.ts`
- `packages/core/src/tools/read-web-page.ts`
- `packages/gateway-fastify/src/config.ts`
- `examples/aa.ts`
- `examples/aa-config.ts`
- `examples/skills/researcher/SKILL.md`

## 1. Local Example Runner

The fastest way to exercise the behavior is the example runner:

- `examples/aa.ts`
- `examples/aa-config.ts`

Create a config at `~/.config/.aa/config.json`, or set `AA_CONFIG_PATH` to point at a local file.

### Starter config

This config enables web tools and uses the new `researchPolicy` field.

```json
{
  "provider": "ollama",
  "providers": {
    "ollama": {
      "model": "qwen3.5"
    }
  },
  "paths": {
    "projectRoot": "/Users/ugmurthy/riding-amp/AgentSmith",
    "skillsDir": "/Users/ugmurthy/riding-amp/AgentSmith/examples/skills",
    "writeRoot": "/Users/ugmurthy/riding-amp/AgentSmith/artifacts",
    "shellCwd": "/Users/ugmurthy/riding-amp/AgentSmith",
    "logDir": "/Users/ugmurthy/riding-amp/AgentSmith/logs"
  },
  "tools": {
    "webSearch": {
      "enabled": true,
      "provider": "duckduckgo",
      "timeoutMs": 30000
    }
  },
  "agent": {
    "verbose": true,
    "autoApprove": true,
    "maxSteps": 20,
    "toolTimeoutMs": 30000,
    "modelTimeoutMs": 60000,
    "capture": "summary",
    "researchPolicy": "standard"
  }
}
```

Run:

```sh
bun run examples/aa.ts "Find the latest Bun release notes and summarize the main changes."
```

Expected:

- the agent can call `web_search` and `read_web_page`
- the run completes normally
- no config parsing errors occur

## 1A. Prompt Design For Observing Budget Behavior

The best prompts for this feature are prompts that naturally tempt the model to over-reach. You want prompts that make broad search feel attractive, so you can watch the runtime gently push the model back toward focused evidence gathering and synthesis.

Good prompt shapes:

- compare multiple recent sources about the same current topic
- investigate a fast-moving topic and distinguish confirmed facts from uncertainty
- ask for latest status, recent developments, or current consensus
- ask for disagreements across sources, which often tempts extra search

Good example prompts:

```text
Compare several recent sources about the same current event and explain where the evidence agrees or conflicts.
```

```text
Research the latest status of a recent release and summarize what is confirmed, what is unclear, and what would require further verification.
```

```text
Investigate a current topic using recent web sources, but stop once the evidence is sufficient for a careful answer.
```

```text
Find the latest public information on a fast-moving topic and give me the best answer you can, clearly separating confirmed facts from unresolved questions.
```

```text
Use current web research to check whether multiple sources are saying the same thing about a recent development, then summarize only the evidence that materially changes the answer.
```

These prompts are useful because they create exactly the tension this feature is designed to handle: the model feels invited to keep researching, but the runtime pushes it toward disciplined stopping.

## 2. Checkpoint Warning Behavior

Use a smaller preset so the checkpoint is easier to trigger.

```json
{
  "provider": "ollama",
  "providers": {
    "ollama": {
      "model": "qwen3.5"
    }
  },
  "paths": {
    "projectRoot": "/Users/ugmurthy/riding-amp/AgentSmith",
    "skillsDir": "/Users/ugmurthy/riding-amp/AgentSmith/examples/skills",
    "writeRoot": "/Users/ugmurthy/riding-amp/AgentSmith/artifacts",
    "shellCwd": "/Users/ugmurthy/riding-amp/AgentSmith",
    "logDir": "/Users/ugmurthy/riding-amp/AgentSmith/logs"
  },
  "tools": {
    "webSearch": {
      "enabled": true,
      "provider": "duckduckgo"
    }
  },
  "agent": {
    "verbose": true,
    "autoApprove": true,
    "maxSteps": 20,
    "researchPolicy": "light"
  }
}
```

Run:

```sh
bun run examples/aa.ts "Research a current topic that likely needs multiple searches, then summarize what is known and what remains uncertain."
```

Expected:

- the agent uses `web_search`
- after enough research calls, the runtime pushes the model toward synthesis
- the final answer should prefer "what is known" plus caveats over broad continued searching

## 3. Explicit Tool Budget Override

This verifies that explicit `toolBudgets` override the preset-derived defaults.

```json
{
  "provider": "ollama",
  "providers": {
    "ollama": {
      "model": "qwen3.5"
    }
  },
  "paths": {
    "projectRoot": "/Users/ugmurthy/riding-amp/AgentSmith",
    "skillsDir": "/Users/ugmurthy/riding-amp/AgentSmith/examples/skills",
    "writeRoot": "/Users/ugmurthy/riding-amp/AgentSmith/artifacts",
    "shellCwd": "/Users/ugmurthy/riding-amp/AgentSmith",
    "logDir": "/Users/ugmurthy/riding-amp/AgentSmith/logs"
  },
  "tools": {
    "webSearch": {
      "enabled": true,
      "provider": "duckduckgo"
    }
  },
  "agent": {
    "verbose": true,
    "autoApprove": true,
    "maxSteps": 20,
    "researchPolicy": "standard",
    "toolBudgets": {
      "web_research.search": {
        "maxCalls": 2,
        "maxConsecutiveCalls": 2,
        "checkpointAfter": 1,
        "onExhausted": "ask_model"
      },
      "web_research.read": {
        "maxCalls": 3,
        "maxConsecutiveCalls": 2,
        "checkpointAfter": 2,
        "onExhausted": "ask_model"
      }
    }
  }
}
```

Run:

```sh
bun run examples/aa.ts "Compare several recent sources about the same current event and explain where the evidence agrees or conflicts."
```

Expected:

- search stops after the configured search budget
- the run does not fail just because the research budget is exhausted
- the model answers from current evidence and calls out unresolved questions

## 4. Purpose Metadata On `web_search`

The `web_search` tool now accepts:

- `purpose`
- `expectedUse`
- `freshnessRequired`

Manual goal:

```sh
bun run examples/aa.ts "Check the current status of a recent release and cite sources."
```

Expected:

- legacy `web_search` behavior still works
- no schema regression for `{ query }`
- when the model supplies richer search input, the tool accepts it without error

## 5. Researcher Delegate Behavior

The researcher skill was updated to stop when evidence is sufficient and include caveats when incomplete.

Run:

```sh
bun run examples/aa.ts "Use the researcher delegate to investigate a current topic and return findings with caveats."
```

Expected:

- delegate research uses web tools normally
- it should stop when the evidence is good enough
- it should include unresolved questions or confidence caveats when needed
- after a budget warning, it should not keep searching just to marginally improve source quality

## 6. Gateway Agent Config

Use this in an agent JSON file parsed by `packages/gateway-fastify/src/config.ts`.

```json
{
  "id": "support-agent",
  "name": "Support Agent",
  "invocationModes": ["chat", "run"],
  "defaultInvocationMode": "chat",
  "model": {
    "provider": "ollama",
    "model": "qwen3.5"
  },
  "tools": ["read_file", "web_search", "read_web_page"],
  "delegates": ["researcher"],
  "defaults": {
    "maxSteps": 20,
    "toolTimeoutMs": 30000,
    "modelTimeoutMs": 60000,
    "researchPolicy": "standard",
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
  },
  "routing": {
    "allowedChannels": ["web", "api"]
  }
}
```

Expected:

- the config parser accepts `defaults.researchPolicy`
- the config parser accepts `defaults.toolBudgets`
- the resulting loaded config contains the new fields unchanged

## 7. Config Validation Failures

Use this intentionally invalid config fragment:

```json
{
  "defaults": {
    "researchPolicy": "wild",
    "toolBudgets": {
      "web_research.search": {
        "maxCalls": -1,
        "onExhausted": "explode"
      }
    }
  }
}
```

Expected:

- config loading fails
- the error mentions:
  - invalid `researchPolicy`
  - non-negative integer requirement for `maxCalls`
  - invalid `onExhausted` enum value

## 8. What To Watch For

Success indicators:

- web research works normally when under budget
- the model shifts into synthesis mode after checkpoint pressure
- budget exhaustion does not automatically produce a failed run
- the answer becomes explicit about uncertainty instead of continuing broad search
- stricter delegate defaults do not bypass parent restrictions

Regression indicators:

- legacy `web_search` calls with only `{ query }` fail validation
- budget exhaustion crashes the run instead of returning a normal tool result
- research counters leak across runs
- `researchPolicy` or `toolBudgets` are ignored by config parsing
- researcher delegate continues broad searching after the warning point

## 9. Verified Automated Checks

These focused tests pass for the implementation:

```sh
bunx vitest run packages/core/src/tool-budget-policy.test.ts packages/core/src/tools/tools.test.ts packages/core/src/adaptive-agent.test.ts
bunx vitest run packages/gateway-fastify/src/config.test.ts
```

Note: a broader repo typecheck still has unrelated pre-existing issues outside this feature slice, so the manual checks above are the best end-to-end validation path for this change set.
