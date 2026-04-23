# Dashboard Implementation Tasks

## 1. Simplify App Routing

- Remove legacy `home` and `history` route behavior from `packages/gateway-web/src/ui/App.tsx`.
- Make `/` the composer home using the current minimal composer experience.
- Add `/dashboard` as the persisted run-management route.
- Remove `/new` as a public route.
- Update `readRoute()` and route navigation helpers accordingly.

Acceptance criteria:

- loading `/` opens the composer experience directly
- loading `/dashboard` opens the dashboard experience
- `history` UI is no longer reachable

## 2. Extract The Composer Into Its Own Route Component

- Move the current minimal composer page out of the monolithic `packages/gateway-web/src/ui/App.tsx` into a focused route component.
- Keep existing composer behavior unchanged unless needed for route cleanup.
- Preserve current live session behavior, approvals, clarification, and connection controls.

Acceptance criteria:

- composer UX remains functionally equivalent after extraction
- `App.tsx` becomes mostly route shell and shared state wiring

## 3. Add Shared Auth For Socket And Dashboard HTTP

- Extract token resolution currently embedded in `connect()` in `packages/gateway-web/src/ui/App.tsx`.
- Support separate dashboard auth from composer auth.
- Allow dashboard to use:
  - inherited token
  - admin dev token
  - custom admin JWT
- Do not require reconnecting the composer socket to use admin-only dashboard routes.

Acceptance criteria:

- a non-admin composer session can still use composer
- `/dashboard` can independently authenticate as admin
- dashboard requests send `Authorization: Bearer <token>`

## 4. Add Dashboard API Client And Types

- Create a small dashboard HTTP client layer for:
  - `GET /api/runs`
  - `GET /api/runs/:rootRunId`
  - `GET /api/runs/:rootRunId/messages`
  - `GET /api/runs/:rootRunId/timeline`
  - `GET /api/runs/:rootRunId/plans`
  - `POST /api/runs/:runId/approval`
- Mirror the response types from `DASHBOARD.md`.
- Normalize gateway error envelopes for UI use.

Acceptance criteria:

- all dashboard API calls are isolated from route components
- error codes like `session_forbidden`, `trace_store_unavailable`, and `approval_session_unavailable` are exposed cleanly

## 5. Build Dashboard Page State

- Add dashboard state for:
  - filters
  - list loading and error
  - selected root run
  - detail loading and error
  - active tab
  - messages view
  - explorer mode: cards or table
- Keep one data model for the run list and render it in two modes.

Acceptance criteria:

- changing filters refreshes the run list
- selecting a run loads inspector detail
- cards and table views show the same underlying data

## 6. Implement Dashboard Explorer

- Build the left-side run explorer using `GET /api/runs`.
- Default to card mode.
- Add a `Cards | Table` toggle.
- Show quick visual metadata on each run:
  - status
  - goal preview
  - session state
  - timestamps
  - child runs
  - tool calls
  - tokens and cost
  - approval badge
  - failure cue when relevant

Acceptance criteria:

- default explorer is cards
- table mode is available without changing data flow
- selected run is visually obvious in both modes

## 7. Implement Dashboard Filters And Saved Views

- Add top-level saved views:
  - All
  - Needs approval
  - Failed
  - Running
  - Sessionless
- Add filters for:
  - date range
  - status
  - session mode
  - text search
  - sort
- Set sensible default UI filters for initial load.

Acceptance criteria:

- saved views map to the API contract in `DASHBOARD.md`
- defaults load useful recent runs rather than an empty screen

## 8. Implement Dashboard Inspector

- Build the right-side inspector using `GET /api/runs/:rootRunId`.
- Add tabs for:
  - Overview
  - Output
  - Messages
  - Timeline
  - Plans
- Use the narrower endpoints for lazy refresh or tab-specific loading where helpful.
- Surface warnings, failures, outputs, and persisted trace information prominently.

Acceptance criteria:

- selecting a root run opens a readable persisted dossier
- failures and outputs are easy to find
- message rendering supports the documented `messagesView`

## 9. Implement Approval Actions

- Surface approval controls in both:
  - run explorer rows and cards
  - inspector action area
- Use `POST /api/runs/:runId/approval` with dashboard metadata source.
- Refresh list and detail state after approval resolution.
- Handle unsupported sessionless approval resolution gracefully.

Acceptance criteria:

- approvals can be resolved from the dashboard
- `approval_session_unavailable` is shown as an explained limitation, not a broken flow

## 10. Add Dashboard Auth Gate UX

- If dashboard auth is missing or not admin, show a locked admin-access screen instead of a broken empty page.
- Let the user unlock dashboard access with an admin dev token or pasted admin JWT.
- Keep composer usable regardless of dashboard auth state.

Acceptance criteria:

- `/dashboard` never forces the whole app to become admin
- a `403` state is understandable and recoverable in dev

## 11. Add URL State For Dashboard

- Sync URL state for:
  - selected `rootRunId`
  - filters
  - sort
  - tab
  - `messagesView`
  - `focusRunId`
- Ensure reload and shareable links restore the same dashboard context.

Acceptance criteria:

- refreshing `/dashboard` preserves current investigation state
- copying the URL is sufficient to revisit the same filtered view

## 12. Extend Styling For Dashboard

- Add dashboard-specific styles in `packages/gateway-web/src/styles.css`.
- Reuse the stronger minimal-composer visual language rather than the older basic panels.
- Keep cards as the default explorer style and make the inspector feel more like a run dossier than a debug dump.

Acceptance criteria:

- dashboard feels visually consistent with the composer
- the layout works on desktop and mobile
- cards and table both remain readable and deliberate

## 13. Remove Dead Legacy UI

- Delete obsolete history components, route logic, and unused styles once dashboard replacement is stable.
- Keep only the shared pieces that still matter.

Acceptance criteria:

- no dead `history` path or stale UI fragments remain
- the app structure is simpler after the refactor, not more complex

## 14. Verify End To End

- Run `bun run build` in `packages/gateway-web`.
- Manually test:
  - `/`
  - `/dashboard`
  - non-admin dashboard access
  - admin dashboard access
  - cards and table toggle
  - run selection
  - message, timeline, and plans tabs
  - approval resolution
  - `503 trace_store_unavailable`
- Fix any regressions introduced by route cleanup.

Acceptance criteria:

- build passes
- the two-route model works end to end
- dashboard failure states are intentional and readable
