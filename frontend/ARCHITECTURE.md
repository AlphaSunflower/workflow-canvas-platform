# Frontend Architecture

## Overview

Frontend now runs on a real account system instead of placeholder auth state. The core runtime is split into four layers:

1. `components/`, `hooks/`, `App.tsx`
   Responsible for UI rendering, interaction flow, and page composition.
2. `auth/`, `components/context/`, `execution-runtime/`
   Responsible for session state, workflow runtime state, and authenticated action orchestration.
3. `services/`
   Responsible for domain logic such as backend file binding, protected resource loading, file export, and execution payload shaping.
4. `api/`
   Responsible for HTTP and WebSocket transport, auth token injection, refresh retry, and backend endpoint wrappers.

The frontend no longer treats `userId` as trusted client input for file upload, execution creation, or task history access. Protected actions are gated by authenticated session state and backed by bearer token transport.

## Account System

### Session model

- `AuthProvider` is the single source of truth for session state.
- Access token lives in memory via `httpClient`.
- Refresh token is persisted in `localStorage` via `auth/session-storage.ts`.
- App boot enters `restoring` state and attempts `refresh` before exposing authenticated UI.
- On refresh failure, frontend clears session state and returns to `unauthenticated`.

### Session states

- `unauthenticated`
- `restoring`
- `authenticated`
- `refreshing`

### HTTP auth lifecycle

- `httpClient` injects `Authorization: Bearer <accessToken>` automatically.
- 401 responses trigger refresh single-flight logic.
- Concurrent 401 requests share one refresh promise and then retry.
- Refresh failure invokes `AuthProvider` cleanup and clears the access token.

### WebSocket auth lifecycle

- `websocketClient` no longer reads token from `window.location.search`.
- Auth token source is injected by `AuthProvider` through `setAuthTokenProvider()`.
- WebSocket connect/reconnect always reads the latest in-memory access token from the session layer.
- When login/restore succeeds, frontend attempts WebSocket connection.
- When logout or session invalidation happens, frontend disconnects WebSocket.

## Protected Resources

Protected file preview and download paths are handled through `services/protected-resource.ts`.

- Browser-visible `/api/v1/files/...` URLs are converted into authenticated blob fetches when needed.
- Components consume object URLs instead of relying on unauthenticated raw browser requests.
- Object URLs are reference-counted and revoked when no longer used.

## Canvas Image Delivery

Canvas image rendering now consumes backend-provided remote image variants instead of assuming a single preview URL.

### Variant layers

- `thumbnailUrl`
  Small canvas-first resource for default node rendering.
- `previewUrl`
  Larger canvas resource used only when on-screen display demand crosses the upgrade threshold.
- `downloadUrl` / original
  Viewer and export oriented resource, not the default canvas path.

### Frontend selection rules

- Workflow hydrate preserves backend-provided `thumbnailUrl`, `previewUrl`, and `imageAsset` variants.
- Canvas rendering is `thumbnail-first`.
- Canvas upgrades from `thumbnail` to `preview` only when display size reaches the upgrade threshold.
- Canvas downgrades with hysteresis, so stable viewport movement near the threshold does not cause `thumbnail <-> preview` ping-pong.
- Original resources are reserved for viewer mode and export/download paths.

### Cache and eviction rules

- Canvas and original resources are tracked separately inside `ImageManager` / `ImageCache`.
- Visible and near-viewport canvas entries are protected from over-limit release first.
- Recently loaded canvas resources have short protection windows to avoid immediate release after ready.
- Preview entries are budgeted independently from thumbnail entries.
- Thumbnail fallback entries are marked as protected fallback and are not preferred eviction targets.

### Stability instrumentation

Development mode exposes:

- `window.__IMAGE_MANAGER_DEBUG__()`
  Current cache, state, inflight, decoded resource snapshot.
- `window.__CANVAS_IMAGE_PERF_DEBUG__()`
  File-node commit history, lifecycle events, session metrics.
- `window.__CANVAS_IMAGE_FLICKER_DEBUG__()`
  Suspected `ready -> release -> request` loop summary.
- `window.__CANVAS_IMAGE_PERF_RESET__()`
  Clears accumulated debug samples.

Key debug fields:

- `requestKey`
- `requestEventKind`
- `requestEventReason`
- `requestSwitchReason`
- `activeVariantKind`
- `resourcePhase`
- `previewEntryCount`
- `decodedReleaseCount`

### Known constraints

- Current canvas strategy is optimized for stability first, not maximal sharpness at every zoom level.
- Remote protected images should not be mounted directly as raw browser `src` when auth is required.
- If backend omits `thumbnailUrl`, frontend falls back to preview, but that is treated as degraded compatibility mode, not the target contract.

## Workflow Auth Integration

Workflow main-chain behaviors are authenticated:

- workflow save / query
- backend file registration / upload
- execution creation
- task history query
- protected file preview / download

`WorkflowContext` performs pre-checks for authenticated actions. If a user is not logged in, protected execution paths are blocked before backend submission. Task history queries are disabled while unauthenticated and surface explicit login/permission feedback.

## WorkflowContext Responsibility Boundary

`WorkflowContext` is a workflow/session orchestration layer, not a node business-logic owner.

Allowed responsibilities:

- workflow save, load, import, export, and runtime snapshot synchronization
- auth and permission gating for protected workflow actions
- shared execution polling, task-ref persistence, output commit, and notification wiring
- generic `runNodeAction` dispatch through registered node definitions
- thin service injection for node-domain runners while shared execution infrastructure is still context-owned

Not allowed:

- adding new public node-specific actions to `WorkflowContextActions`
- adding new `node.type === ...` feature branches for node behavior
- hosting node-specific drop, resize, persistence, or output reconcile rules
- using `WorkflowContext.tsx` as the first place to implement new node workflows

`aiStoryboard` is the current reference boundary. Its UI dispatches through `runNodeAction`, its arrange/image/video/batch logic lives in `src/nodes/ai-storyboard/**`, and the context layer only provides shared services such as auth, polling, task refs, output commit, and runtime-store patching.

Remaining storyboard follow-up is tracked in [`docs/ai-storyboard-debt-map.md`](./docs/ai-storyboard-debt-map.md). The storyboard application facade and node-action service registry are already in place, and the automated close-out reran green on 2026-04-24; follow-up work is now limited to live manual acceptance and broader non-storyboard `WorkflowContext` decomposition.

## Workflow Backendization Baseline

Frontend is no longer the long-term source of truth for workflow canvas persistence.

- `Workflow` remains the canvas entity name.
- `projectId` stays in the payload for now.
- Backend becomes the source of truth for canvas structure, file bindings, executions, and task history.
- Local import/export stays as a utility path, not the primary save path.
- Legacy frontend residual paths and cleanup targets are tracked in [`docs/LEGACY-FRONTEND-PATH-AUDIT.md`](./docs/LEGACY-FRONTEND-PATH-AUDIT.md).
- Local archive helper boundary is tracked in [`docs/LOCAL-ARCHIVE-BOUNDARY.md`](./docs/LOCAL-ARCHIVE-BOUNDARY.md).

### File scheduling baseline

- Files start upload scheduling immediately after entering the canvas.
- Frontend hashes files before upload registration.
- Registration checks whether the backend already owns the same content.
- Existing backend content is reused instead of re-uploaded.
- If execution is triggered while some files are still pending, files required by that execution are promoted to high-priority upload.
- Local archive file registry is no longer a default upload source.
- Runtime upload reads from node-resolved resource URLs or dedicated runtime file sources created during local import.
- `local-workflow-archive` and `local-workflow-assets` are auxiliary archive utilities only.
- Local archive helpers do not participate in backend workflow persistence, backend file binding, or task history write paths.

### Save-performance baseline

- Canvas save must use debounce, targeting an `800ms-1500ms` window.
- Concurrent saves for the same workflow must be single-flight.
- Saved workflow payload contains full node, connection, viewport, and metadata state.
- Saved node file references point to backend file IDs and metadata, not browser `File` objects.
- Detailed performance guardrails are tracked in [`../backend/docs/PERFORMANCE-GUARDRAILS.md`](../backend/docs/PERFORMANCE-GUARDRAILS.md).

### Task-history baseline

- History is stored on the backend and queried by `workflowId`.
- Each execution task is one primary history record.
- Event streams are queried separately from task summary lists.
- Current frontend data source is:
  - `GET /api/v1/workflows/:workflowId/tasks`
  - `GET /api/v1/workflows/:workflowId/tasks/:taskId`
  - `GET /api/v1/workflows/:workflowId/tasks/:taskId/events`

## Key Directories

### `src/auth`

- `AuthProvider.tsx`
  Owns session restore, refresh, login, logout, WebSocket session sync.
- `auth-context.ts`
  Defines auth context contract and session states.
- `require-auth-action.ts`
  Normalizes auth-required and permission-denied UI feedback.
- `session-storage.ts`
  Persists refresh token only.

### `src/api`

- `client/http-client.ts`
  Token injection, refresh retry, blob access, raw requests.
- `services/auth-api.ts`
  Auth endpoints.
- `services/users-api.ts`
  Current-user and admin-user management endpoints.
- `services/workflow-api.ts`
  Workflow/task subscription endpoints and WebSocket task subscription handoff.
- `websocket/index.ts`
  Session-driven WebSocket transport with reconnect.

### `src/services`

- `backendFileService.ts`
  Resolves backend file IDs from current authenticated session and runtime file sources.
- `backendExecutionService.ts`
  Shapes grouped execution requests without trusting client `userId`.
- `protected-resource.ts`
  Authenticated file blob/object URL access.
- `local-workflow-archive.ts`, `local-workflow-assets.ts`
  Auxiliary local import/export archive helpers, not primary persistence or upload infrastructure.

## Local Integration

### Development servers

- Frontend Vite dev server: `http://127.0.0.1:3000`
- Backend API expected through Vite proxy:
  - HTTP: `/api` -> `http://127.0.0.1:3100`
  - WebSocket: `/ws` -> `ws://127.0.0.1:3100`

### Optional environment overrides

- `VITE_API_BASE_URL`
  Overrides default HTTP base URL.
- `VITE_WS_URL`
  Overrides default WebSocket endpoint.

If not provided, frontend derives:

- API base URL from current origin
- WebSocket URL from `/ws` on the same origin, with `ws:` / `wss:` protocol mapping

## Testing Strategy

This project uses a lightweight `node:test` pipeline compiled through `scripts/run-tests.mjs`.

Coverage now includes:

- auth API token application
- users API request forwarding
- auth provider session restore and WebSocket lifecycle
- http client refresh single-flight
- protected resource object URL lifecycle
- workflow persistence debounce / single-flight guardrails
- workflow/execution payload normalization
- user management modal/admin list regression coverage
- 55 remote protected image stability baseline
- image manager hysteresis / queued preview upgrade / cache release regression coverage
- workflow reload-equivalent image sync noise guard

## Quality Baseline Status

As of 2026-04-22, the frontend quality baseline has been restored and the temporary quality freeze has been lifted after the unified root gate passed end-to-end.

The following files and directories remain protected review paths for high-risk changes:

- `src/components/context/**`
- `src/components/canvas/**`
- `src/execution-runtime/**`
- `src/services/workflow-file-normalizer.ts`
- `src/services/backendExecutionService.ts`
- `src/services/workflow-upload-scheduler.ts`
- `src/services/image/**`
- `src/nodes/ai-storyboard/**`
- `src/nodes/shared/**`

For these paths:

- Changes should reference a tracked issue from `../quality-baseline-issues.md` when they alter behavior or contracts.
- Do not introduce `any`, broad `eslint-disable`, or unbounded retry loops.
- Do not add new persistence or runtime fields without save/hydrate/reload coverage.
- Do not add new feature logic to `WorkflowContext.tsx` or `Canvas.tsx` without focused regression tests.

Current frontend baseline status:

- `npm.cmd run typecheck`: passing
- `npm.cmd run lint`: passing with `--max-warnings 0`
- `npm.cmd test`: passing

The active freeze rules and issue ledger are maintained in:

- [`../quality-baseline-plan.md`](../quality-baseline-plan.md)
- [`../quality-baseline-issues.md`](../quality-baseline-issues.md)
- [`../quality-baseline-report.md`](../quality-baseline-report.md)
- [`../quality-gate-rules.md`](../quality-gate-rules.md)

## Evolution Notes

Current scope intentionally focuses on:

- member/admin role split
- current user profile and password management
- admin user management
- backend-owned workflow persistence baseline
- authenticated file and execution ownership
- authenticated task history and real-time subscription

Not in current frontend scope:

- multi-tenant account switching
- project-member RBAC remapping onto account roles
- fine-grained permissions beyond `member` / `admin`
- workflow conflict merge / collaborative editing
