# Frontend

## Current Status

Frontend is already connected to the backend account system.

Implemented areas:

- register / login / logout / session restore
- access token injection and automatic refresh
- current user profile and password management
- admin user list / create / enable-disable / reset password
- authenticated file preview and download
- backend-owned workflow canvas save / load
- authenticated workflow execution and task history access
- session-driven WebSocket connection lifecycle

## Run Locally

1. Start backend on `http://127.0.0.1:3100`
2. Start frontend:

```bash
npm run dev
```

Default frontend address:

- `http://127.0.0.1:3000`

Vite proxy defaults:

- `/api` -> `http://127.0.0.1:3100`
- `/ws` -> `ws://127.0.0.1:3100`

Optional overrides:

- `VITE_API_BASE_URL`
- `VITE_WS_URL`

## Auth and Session Notes

- Access token is kept in memory only.
- Refresh token is stored in local storage.
- App boot tries refresh first to restore session.
- When refresh fails, frontend clears session and disconnects WebSocket.
- WebSocket token source is provided by session state, not URL query params.

## Common Local Flow

1. Open frontend
2. Register a member account or log in with an existing account
3. Open account modal from side navigation
4. Verify current user profile
5. Add files into the canvas and wait for backend sync to complete
6. Save or reload the canvas from the backend
7. Run authenticated workflow nodes
8. Open task history page after login
9. Log in as admin to verify user management actions

## Canvas Persistence Notes

- Backend is now the source of truth for workflow canvas persistence.
- Canvas save/load goes through `/api/v1/workflows`.
- Local import/export remains available only as an auxiliary archive path.
- Local archive file registration only serves archive embed/restore and auxiliary export.
- Local archive state is not treated as the primary source for backend file upload or workflow persistence.
- Protected file preview/download and workflow task history both depend on an authenticated session.
- Legacy task/snapshot/local-archive residual paths are tracked in `docs/LEGACY-FRONTEND-PATH-AUDIT.md`.

## Image Stability Notes

- Remote image nodes now consume backend `thumbnailUrl`, `previewUrl`, and `downloadUrl` as separate resources.
- Default canvas rendering prefers `thumbnail`.
- `preview` is only requested when canvas display size is large enough.
- Full-size viewer uses original/download resource or preview fallback.
- Protected remote image URLs are resolved through authenticated resource loading, not raw browser requests.

## Local Flicker Diagnosis

If you see "image appears, then blacks out, then reloads repeatedly", check in this order:

1. Resource contract
   Open `window.__IMAGE_MANAGER_DEBUG__()` and confirm image nodes have distinct `thumbnail` and `preview` URLs instead of one shared preview path.
2. Variant switching
   Open `window.__CANVAS_IMAGE_FLICKER_DEBUG__()` and inspect whether the same node shows repeated `request-started` with alternating variant intent.
3. Cache pressure
   In `window.__IMAGE_MANAGER_DEBUG__()`, inspect `cache.stats.previewEntryCount`, `evictionCount`, and `decodedReleaseCount`.
4. State sync noise
   In `window.__CANVAS_IMAGE_PERF_DEBUG__()`, inspect whether the same node keeps producing commits without a real image state change.
5. Auth delivery
   If network requests show `401`, the issue is not image cache policy first. Check session restore, token refresh, and protected-resource flow.

Quick reset during local debugging:

- `window.__CANVAS_IMAGE_PERF_RESET__()`

Recommended local repro baseline:

- Load a workflow with about 55 remote protected image nodes.
- Save to backend.
- Reload from backend.
- Keep viewport stable and verify the same nodes do not enter repeated `ready -> release -> request` loops.

## Commands

```bash
npm run dev
npm run arch:report
npm run typecheck
npm run lint
npm test
npm run verify
```

## Architecture Report

Frontend architecture scanning is currently available in report-only mode.

Run:

```bash
npm run arch:report
```

Current report categories include:

- reverse dependency into `components/context`
- cross-layer direct imports into component implementations
- dependency cycles across source layers

Rules and baseline references:

- `../docs/architecture-layer-rules.md`
- `../docs/architecture-baseline.md`

## Testing And Lint Boundaries

- Production source files keep the strict baseline rules. In particular, `no-explicit-any`, `no-unused-vars`, `prefer-const`, and `no-var` remain enforced for real source code.
- Test files and test-support files under `src/**/*.{spec,test}.{ts,tsx}` no longer require explicit return-type annotations for every helper callback. This removes high-noise warnings without relaxing production constraints.
- Source warnings and source errors are still intentional signals. The detailed boundary and rationale are documented in `docs/testing-and-lint-rules.md`.

Test discovery uses two separate entry styles:

- `src/**/*.spec.ts[x]`: compiled and executed as direct source test entrypoints.
- `tests/*.test.mjs`: root-level node test entrypoints that can import shared support modules.

Files named `src/**/*.test.ts[x]` are treated as shared test-support modules. They are compiled for imports, but they are not executed as standalone node:test entrypoints.

## Unified Quality Gate

Run the project-level quality gate from `newworkflow2/`:

```powershell
.\verify-quality.ps1
```

Windows `cmd` entry:

```bat
verify-quality.cmd
```

Execution order is fixed and fail-fast:

- frontend `typecheck`
- frontend `lint`
- frontend `test`
- backend `typecheck`
- backend `test`

This is the baseline PR gate entry for the current recovery phase.

Current practical status:

- frontend `typecheck`: passing
- frontend `test`: passing
- frontend `lint`: passing under `--max-warnings 0`
- backend `typecheck`: passing
- backend `test`: passing and included in the unified gate

The temporary baseline freeze used during recovery has been lifted on 2026-04-22. Protected-path changes still require the same review rigor, tests, and issue tracking defined in:

- `../quality-baseline-report.md`
- `../quality-gate-rules.md`

## Test Coverage Focus

Current automated tests cover:

- auth API token handling
- users API request forwarding
- auth provider restore flow
- http client refresh single-flight
- protected resource access
- workflow persistence debounce / single-flight
- execution payload shaping
- selected user management UI regressions
- remote image variant selection and thumbnail-first strategy
- image manager flicker, hysteresis, cache, and queued upgrade regression cases
- workflow reload-equivalent remote image stability baseline

Lint signal policy:

- `error`: must fix before merge.
- `warning`: non-gated guidance or tracked debt only. The main frontend lint command currently remains green under `--max-warnings 0`.

For the final recovery summary and ongoing development rules, see:

- `../quality-baseline-report.md`
- `../quality-gate-rules.md`
