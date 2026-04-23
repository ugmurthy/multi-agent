# Dashboard Implementation Plan

## Target End State

Reshape `packages/gateway-web/src/ui/App.tsx` into a two-surface app:

1. `/` becomes the current minimal composer experience from `App.tsx`, replacing the legacy `home` and `history` views.
2. `/dashboard` becomes the persisted run-management surface backed by the routes in `DASHBOARD.md`.

The dashboard should visually inherit the stronger design language already present in the minimal shell styles in `packages/gateway-web/src/styles.css`: rounded glassy containers, compact pill controls, strong status color, and a "workbench" feel.

## Proposed File Plan

Keep the change pragmatic, but stop growing the single 58 KB app file.

Split the current `packages/gateway-web/src/ui/App.tsx` into a few focused modules:

- `packages/gateway-web/src/ui/App.tsx`: app shell and route switch only
- `packages/gateway-web/src/ui/routes/ComposerPage.tsx`: current `/new` minimal composer moved here
- `packages/gateway-web/src/ui/routes/DashboardPage.tsx`: new dashboard root
- `packages/gateway-web/src/ui/dashboard/client.ts`: HTTP fetch helpers for `/api/runs`, `/api/runs/:id`, `/messages`, `/timeline`, `/plans`, `/approval`
- `packages/gateway-web/src/ui/dashboard/types.ts`: dashboard response types mirroring `DASHBOARD.md`
- `packages/gateway-web/src/ui/dashboard/useDashboardState.ts`: list/detail/filter/loading state
- `packages/gateway-web/src/ui/dashboard/DashboardRunList.tsx`: left explorer column
- `packages/gateway-web/src/ui/dashboard/DashboardInspector.tsx`: right dossier pane
- `packages/gateway-web/src/ui/shared/GatewayAuth.ts` or similar: shared HTTP/socket auth token resolution

This is still a small app, but this split gives a clean boundary between live socket UX and persisted dashboard UX.

## Routing Plan

Update the route model currently defined by `AppRoute` and `readRoute()` in `packages/gateway-web/src/ui/App.tsx`.

Planned route behavior:

- `/` -> composer page
- `/dashboard` -> dashboard page
- remove `history`
- remove legacy `home`
- no temporary `/new`

Also keep route state in the URL, not just React state, for dashboard filters and selection. At minimum:

- `rootRunId`
- `from`
- `to`
- `status`
- `session`
- `requiresApproval`
- `q`
- `sort`
- `messagesView`
- `focusRunId`
- active detail tab

That makes the dashboard shareable and refresh-safe.

## Auth And HTTP Plan

This is the main architectural addition.

Current socket auth is assembled inside `connect()` in `packages/gateway-web/src/ui/App.tsx`, using `mintDevToken()` and the settings state backed by `packages/gateway-web/src/gateway/client.ts`. The dashboard routes in `DASHBOARD.md` require the same bearer token style over HTTP.

Implementation plan:

- extract token creation and reuse out of `connect()`
- introduce a shared `getGatewayAccessToken()` helper
- if `useDevToken` is enabled, mint a token on demand using current identity and cache it briefly in memory
- if `customToken` is used, return the trimmed token directly
- every dashboard HTTP request sends `Authorization: Bearer <token>`
- do not require the socket to be connected for dashboard usage

This gives the dashboard independent access to persisted inspection while keeping one auth model for the whole app.

## Separate Dashboard Admin Access

Keep two auth contexts:

- `composerAuth`: used by the WebSocket and composer flow
- `dashboardAuth`: used only for dashboard HTTP routes

This allows a user to:

- stay connected to the composer as `member`, `reviewer`, or any other role
- open `/dashboard` with a separate admin bearer token
- avoid reconnecting the socket or editing the composer role every time

Recommended dashboard auth modes:

1. `inherit`
2. `admin dev token`
3. `custom admin jwt`

Behavior:

- `inherit` uses the same token source as composer
- if that token gets `403 session_forbidden`, the page stays on `/dashboard` and prompts for admin unlock
- `admin dev token` mints a separate admin token for HTTP only
- `custom admin jwt` supports real environments where dev minting is not desired

## Dashboard Data Plan

Build the dashboard around two fetch layers.

### List Layer

Backed by `GET /api/runs` in `DASHBOARD.md`.

State to manage:

- `filters`
- `items`
- `limit`
- `offset`
- `nextOffset`
- `isLoading`
- `error`
- `selectedRootRunId`

Default filters:

- last 7 days
- `sort=updated_desc` in UI, even if backend default remains `created_desc`
- no status restriction
- `session=any`
- `requiresApproval` unset
- `limit=50`

Saved quick views:

- All
- Needs approval
- Failed
- Running
- Sessionless

### Detail Layer

Backed first by `GET /api/runs/:rootRunId` in `DASHBOARD.md`, then optionally by the narrower endpoints in `DASHBOARD.md`.

State to manage:

- `selectedRootRunId`
- `detail`
- `detailTab`
- `messagesView`
- `focusRunId`
- `isDetailLoading`
- `isTabRefreshing`
- `detailError`

Fetch strategy:

- selecting a run loads the full trace report first
- switching tabs can continue using already-hydrated data
- if a tab needs refresh, call the narrow endpoint for that panel only
- approval action success should refresh list item and active detail pane

## Dashboard UI Plan

Use a three-part layout inspired by the minimal composer shell in `packages/gateway-web/src/styles.css`, but optimized for inspection instead of typing.

### 1. Top Command Rail

A sticky top rail with:

- page title and environment identity
- admin and auth status
- quick search `q`
- saved view chips
- time range picker
- approval count badge
- refresh button

This should look like a companion to `.minimal-toolbar`, not the older plain top bar.

### 2. Left Run Explorer

A scrollable list of root-run cards driven by `DashboardRunListItem`.

Each card should show:

- status chip
- goal preview
- session state
- created or updated time
- child run count
- tool call count
- token and cost summary
- approval badge if `pendingApproval` exists
- failure snippet or warning when relevant

Recommended interaction:

- single click selects the root run
- selected row gets a strong active outline
- top of list contains compact filters
- mobile collapses into stacked cards above the inspector

### 3. Right Inspector Dossier

A persistent detail workspace with tabs:

- `Overview`
- `Output`
- `Messages`
- `Timeline`
- `Plans`

Content by tab:

- `Overview`: status, goal, session, model, run counts, warnings, duration, cost
- `Output`: final result JSON or text, failure reason, warnings, completion status
- `Messages`: compact or full message render using `messagesView`
- `Timeline`: tool timeline rows and milestones
- `Plans`: plan rows, delegates, `replan.required` visibility

If `focusRunId` is present, the inspector should visually show that the view is narrowed to a child run subtree.

## Cards And Table Toggle

Keep cards as the default explorer mode and add a simple `Cards | Table` toggle backed by the same list data from `GET /api/runs`.

Recommended behavior:

- `Cards` is default and visually richer
- `Table` is denser for scanning many runs
- same filters, selection, pagination, and approval indicators in both modes
- mode can be remembered in `localStorage`

Important implementation constraint:

- do not create two separate data flows; maintain one list state with two renderers

## Approval Handling Plan

Use `POST /api/runs/:runId/approval` from `DASHBOARD.md` as a first-class workflow.

Behavior:

- show approval CTA in both the run list and the inspector
- when clicked, send `{ approved, metadata: { source: 'dashboard' } }`
- optimistic UI should be limited to `action in progress`; do not remove the approval badge until the server confirms
- on success, refresh the selected root run detail and the current list page
- on `approval_session_unavailable`, show a clear disabled or explainer state because sessionless approval is intentionally unsupported
- on `agent_registry_unavailable`, show a retryable inline error

This should feel like an operations workflow, not a generic toast-only action.

## Styling Plan

Extend `packages/gateway-web/src/styles.css` instead of replacing it.

Visual direction:

- keep current green and ink palette family
- use the darker minimal-composer treatment for dashboard chrome
- keep IBM Plex Sans and IBM Plex Mono
- introduce dashboard-specific classes rather than overloading old `.history-*` styles
- use a dossier-style inspector panel with stronger hierarchy than the current trace preview cards

Suggested new style groups:

- `.dashboard-page`
- `.dashboard-toolbar`
- `.dashboard-filters`
- `.dashboard-layout`
- `.dashboard-run-list`
- `.dashboard-run-card`
- `.dashboard-inspector`
- `.dashboard-tabbar`
- `.dashboard-output-panel`
- `.dashboard-empty-state`
- `.dashboard-error-state`

## Implementation Sequence

1. Simplify routing in `packages/gateway-web/src/ui/App.tsx`: make composer the default home, remove `history`, add `/dashboard`.
2. Extract the current minimal composer view into its own page component.
3. Extract token resolution from `connect()` into shared auth helpers based on `packages/gateway-web/src/gateway/client.ts`.
4. Add dashboard HTTP client helpers and response types from `DASHBOARD.md`.
5. Build list state and run explorer UI using `GET /api/runs`.
6. Build inspector UI using `GET /api/runs/:rootRunId`.
7. Add approval actions and post-action refresh behavior.
8. Add URL-sync for filters, selected run, and tab state.
9. Add responsive layout and empty, error, and forbidden states.
10. Remove dead `history` code and styles after dashboard is stable.

## Improvements Over A Straightforward CRUD Dashboard

A few choices will make this meaningfully better:

- treat `rootRunId` as the primary unit everywhere
- make `Needs approval` and `Sessionless` first-class queues
- use URL state so operators can share exact investigation views
- make the inspector feel like opening a run dossier, not just swapping tabs
- keep live composer and persisted dashboard as cleanly separate surfaces with shared auth, not shared UI state

## Verification Plan

When implementation starts, verify with:

- `bun run build` in `packages/gateway-web`
- manual route checks for `/` and `/dashboard`
- manual auth checks with admin and non-admin roles
- dashboard empty and error states by simulating `403` and `503`
- approval flow against a run with `pendingApproval`

## Key Open Decisions Resolved

- no temporary `/new`
- keep admin-only backend enforcement for `/dashboard`
- support separate dashboard auth to avoid composer role churn
- default explorer mode is cards
- table view is available via a toggle
