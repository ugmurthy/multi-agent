# AdaptiveAgent Gateway Diagrams

These diagrams are derived from [adaptive-agent-gateway-proposal.md](file:///Users/ugmurthy/riding-amp/AgentSmith/adaptive-agent-gateway-proposal.md) and are intentionally presentation-oriented.

## 0. Executive View: Thin Gateway, Tool-Centric Core

**Caption:** The gateway only routes and admits work; the core runs the selected root agent; delegates and skills are folded into the same tool interface.

```mermaid
flowchart TD
    A([Clients and Channels])
    B[Thin Gateway]
    C[Routing and Admission<br>channel + tenant + role<br>configurable parallel run caps]
    D[Core Root Agent<br>provider + model + defaults<br>system prompt]
    E{{Everything Becomes a Tool}}
    G[Regular Tools]
    F[Delegates and Skills<br>agent workers exposed as tools]

    A -->|messages| B
    B -->|route inbound| C
    C -->|select root agent| D
    D -->|calls tools| E
    E -->|standard tool calls| G
    E -->|delegate dot star tool calls| F
    F -->|child run result| D
    D -->|responses and events| B
    B -->|outbound| A

    %% Light Professional Theme
    classDef edge      fill:#f8fafc, stroke:#64748b, color:#1e2937, stroke-width:3px, rx:10px, ry:10px
    classDef gateway   fill:#f1f5f9, stroke:#0ea5e9, color:#0c4a6e, stroke-width:3.5px
    classDef policy    fill:#f8fafc, stroke:#f59e0b, color:#78350f, stroke-width:3.5px
    classDef core      fill:#f8fafc, stroke:#10b981, color:#064e3b, stroke-width:3.5px
    classDef concept   fill:#f8fafc, stroke:#8b5cf6, color:#4c1d95, stroke-width:4px, font-weight:bold
    classDef tool      fill:#f8fafc, stroke:#7c3aed, color:#4c1d95, stroke-width:3px
    classDef delegate  fill:#f8fafc, stroke:#ec4899, color:#831843, stroke-width:3.5px

    %% Thicker professional arrows
    linkStyle default stroke:#475569, stroke-width:4.5px, stroke-opacity:0.95

    class A edge
    class B gateway
    class C policy
    class D core
    class E concept
    class G tool
    class F delegate
```

### Core Idea

The central idea in `@adaptive-agent/core` is that the root agent works through a single execution model: it calls tools. Some of those tools are ordinary tools. Some of those tools are synthetic `delegate.*` tools that spawn child runs. Skills are first converted into delegates, so they also enter the runtime through the same tool path.

### Why This Matters

- The gateway stays thin. It mainly accepts messages, routes by channel, tenant, and role, and enforces configurable parallel run limits.
- The core stays simple. The root agent does not need separate orchestration logic for tools, delegates, and skills.
- Control stays uniform. Logging, events, approvals, snapshots, and run tracking can all flow through the same tool execution machinery.
- Composition stays easy. A new delegate or skill can be added without inventing a new runtime primitive.

## 1. High-Level Architecture

```mermaid
flowchart LR
    Client[Authenticated WebSocket Clients]

    subgraph Gateway[AdaptiveAgent Gateway]
        WS[Fastify WebSocket Server]
        Auth[Auth and Session Layer]
        Route[Deterministic Router]
        Orchestrator[Run Orchestrator]
        Fanout[Event Fanout]
    end

    subgraph Config[Configuration and Extensions]
        GatewayConfig[gateway.json]
        AgentConfig[agent configs]
        Modules[hooks, tools, auth modules]
    end

    subgraph Runtime[@adaptive-agent/core]
        Agent[AdaptiveAgent]
        Runs[Root Runs and Child Runs]
        Events[EventStore]
    end

    subgraph Storage[Persistence]
        SessionStore[Gateway session and transcript store]
        RunStore[Runtime run store]
    end

    Client -->|connect and send frames| WS
    WS --> Auth
    Auth -->|resolve or create session| Route
    Route -->|select configured agent| Orchestrator
    GatewayConfig --> Route
    AgentConfig --> Orchestrator
    Modules --> Orchestrator
    Orchestrator -->|chat(), run(), resume()| Agent
    Agent --> Runs
    Agent --> Events
    Auth --> SessionStore
    Orchestrator --> SessionStore
    Runs --> RunStore
    Events --> Fanout
    Fanout -->|session, run, root-run, agent channels| Client
```

## 2. Runtime Sequence

```mermaid
sequenceDiagram
    participant C as Client
    participant G as Fastify Gateway
    participant A as Auth and Session Layer
    participant R as Router
    participant O as Run Orchestrator
    participant AG as AdaptiveAgent
    participant E as EventStore and Fanout

    C->>G: WebSocket connect with JWT
    G->>A: Validate token and normalize authContext
    A-->>G: Principal is authorized

    C->>G: session.open or message.send
    G->>A: Resolve or create session
    A-->>G: sessionId and session state

    G->>R: Match bindings and select agent
    R-->>G: agentId and invocation mode

    G->>O: Dispatch request with session context
    O->>AG: chat() or run()
    AG-->>O: runId and rootRunId

    AG->>E: Emit lifecycle events
    E-->>C: agent.event frames on subscribed channels

    AG-->>O: Final output or approval requested
    O-->>G: Persist session and run linkage

    alt Run completed
        G-->>C: message.output or run.output
        G-->>C: session.updated
    else Approval required
        G-->>C: approval.requested
        C->>G: approval.resolve
        G->>O: Resume pending run
        O->>AG: resume(runId)
        AG->>E: Emit resumed lifecycle events
        E-->>C: Updated agent.event frames
        AG-->>G: Final result
        G-->>C: message.output or run.output
    end
```
