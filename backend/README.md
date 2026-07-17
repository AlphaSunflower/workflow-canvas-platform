# Backend

This directory contains all backend-related code, runtime configuration, and backend-side documentation for the project.

## Quality Gate

Use the project root gate from `newworkflow2/`:

- PowerShell: `.\verify-quality.ps1`
- Command Prompt: `verify-quality.cmd`

Current gate coverage order:

1. frontend `typecheck`
2. frontend `lint`
3. frontend `arch:check`
4. frontend `test`
5. backend `typecheck`
6. backend `lint`
7. backend `arch:check`
8. backend `test`

Backend root quality commands:

- `npm run arch:report`
- `npm run arch:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run verify`
- `npm run test:db`
- `npm run verify:db`

See:

- `backend/tests/README.md`
- `backend/docs/backend-quality-gate.md`
- `backend/docs/type-contract-baseline.md`
- `../quality-baseline-report.md`
- `../quality-gate-rules.md`

Current backend baseline status:

- `npm run arch:report`: available for diagnostics
- `npm run arch:check`: active blocking gate
- `npm run lint`: active blocking gate
- `npm run typecheck`: passing
- `npm test`: passing and wired into the unified gate
- `npm run verify`: passing backend quality entry
- `npm run verify:db`: DB Only quality entry; requires `BACKEND_TEST_DATABASE_URL` or `DATABASE_URL`

The temporary baseline freeze used during recovery has been lifted on 2026-04-22 after the root gate passed end-to-end. Protected backend paths still require the same contract discipline, tests, and documentation updates defined in:

- `../quality-baseline-report.md`
- `../quality-gate-rules.md`

Architecture rule references:

- `../docs/architecture-layer-rules.md`
- `../docs/architecture-baseline.md`

## Directory Layout

- `docs/`
  backend design notes, API specifications, data model and scheduling documents
- `config/`
  unified backend config directory, default config path is `backend/config/backend.config.json`
- `api/`
  HTTP and WebSocket API service
- `worker/`
  async task execution worker, scheduling, provider integration, and result write-back
- `admin-web/`
  standalone admin frontend
- `shared/`
  shared backend types, constants, protocol definitions, env and logger utilities
- `db/`
  database migrations, schema, and seed-related material
- `deploy/`
  deployment config and Docker-related assets
- `scripts/`
  local development, build, bootstrap, and validation scripts
- `tests/`
  backend regression, integration, and end-to-end oriented tests

## Current Documentation

- `docs/DOMAIN-MODEL.md`
- `docs/AUTH-ACCOUNT-MVP.md`
- `docs/FILE-ASSET-DESIGN.md`
- `docs/EXECUTION-AND-RETRY.md`
- `docs/SCHEDULER-DESIGN.md`
- `docs/API-SPEC.md`
- `docs/ADMIN-UI-SPEC.md`
- `docs/DATABASE-SCHEMA.md`
- `docs/DB-ONLY-BACKEND-RUNBOOK.md`
- `docs/FILE-DATABASE-CUTOVER-RUNBOOK.md`
- `docs/FILE-DATABASE-ROLLBACK-GUIDE.md`
- `docs/FILE-DATABASE-OBSERVABILITY-CHECKLIST.md`
- `docs/BACKEND-STRUCTURE.md`
- `docs/WORKFLOW-CANVAS-BACKENDIZATION-MVP.md`
- `docs/PERFORMANCE-GUARDRAILS.md`
- `docs/ERROR-AND-EVENT-SPEC.md`
- `docs/WHITE-MODEL-RENDER-V1.md`
- `docs/AI-IMAGE-GEN.md`
- `docs/AI-MULTI-VIEW-RESTORE.md`
- `docs/AI-MULTI-VIEW-RESTORE-ACCEPTANCE.md`
- `docs/AI-IMAGE-TO-PLY.md`
- `docs/AI-IMAGE-TO-PLY-ACCEPTANCE.md`
- `docs/RUNNINGHUB-SCHEDULING.md`
- `docs/RUNNINGHUB-SCHEDULING-ACCEPTANCE.md`
- `docs/V1-ACCEPTANCE.md`
- `docs/examples/README.md`
- `tests/manual/ai-multi-view-restore-checklist.md`

## Current Scope

The current backend phase is not trying to deliver a full generic platform in one pass.
The active priority is to make the phase-one real execution paths stable and operable.

Phase-one baseline documents:

- `docs/WHITE-MODEL-RENDER-V1.md`
- `docs/AI-IMAGE-GEN.md`
- `docs/AI-MULTI-VIEW-RESTORE.md`
- `docs/AI-IMAGE-TO-PLY.md`
- `docs/RUNNINGHUB-SCHEDULING.md`

If any broader planning document conflicts with these phase-one boundary documents, the node-specific phase-one document wins.

## Phase-One Responsibilities

- white-model render node real execution interface
- grouped task splitting and execution record handling
- input file registration, upload, dedupe, and `fileId` allocation
- provider API wrapper integration
- file asset persistence for line art, depth images, and final outputs
- intermediate artifact retention and automatic reuse
- task status, step events, retry progress, and result query
- workflow canvas backend persistence, canvas file references, and task history aggregation by workflow
- minimum API, Worker, database, and shared contract support for the above
- account, auth, session, and admin account management MVP baseline

## Explicitly Out of Scope for This Phase

- multi-node concurrent orchestration
- multi-provider switching platform
- open-ended node parameter configuration
- project member management, multi-tenant support, or full RBAC
- automatic workflow orchestration across downstream nodes
- complex analytics, operations dashboards, or storage governance strategy

## Workflow Canvas Backendization MVP

The backend now formally owns persistence for workflow canvas, files, executions, and task history.
See `docs/WORKFLOW-CANVAS-BACKENDIZATION-MVP.md`.

Current constraints:

- `Workflow` remains the persistence entity for the canvas, and `projectId` is temporarily retained.
- Backend is the source of truth for canvas persistence; frontend local JSON import/export is only an auxiliary archive path.
- Files begin upload scheduling as soon as they enter the canvas, with content-hash precheck before upload.
- If execution starts while files are still pending upload, file upload dependencies are scheduled first.
- Task history is stored at `execution task` granularity and aggregated by `workflowId`.
- Removing a canvas file binding only removes the reference, not the physical file.

## Account/Auth MVP

See `docs/AUTH-ACCOUNT-MVP.md`.

Current constraints:

- roles are limited to `member` and `admin`
- session model is fixed to `access token + refresh token`
- bootstrap admin config can initialize the first admin account
- this phase does not include project members, multi-tenant support, or full RBAC

## Current Backend Skeleton

- `api/`
  standalone `package.json`, `tsconfig.json`, and `src/main.ts`
- `worker/`
  standalone `package.json`, `tsconfig.json`, and `src/main.ts`
- `shared/`
  standalone `package.json`, `tsconfig.json`, and shared env/logger utilities
- `data/workflows/`
  workflow summaries, full workflow records, file references, and task summary shards
- `db/`
  database-related assets
- `scripts/`
  backend script entry points
- `tests/`
  backend test assets
- `.env.example`
  backend environment variable example
- `package.json`
  backend root command entry
- `start-backend.cmd`
  Windows backend startup helper

## Recommended Startup Flow

Preferred config path:

- `backend/config/backend.config.json`

Example config:

- `backend/config/backend.config.example.json`

Recommended startup:

1. Prepare `backend/config/backend.config.json`
2. Run `backend/start-backend.cmd` on Windows

Or run from `backend/`:

- `npm run start`

Admin read-only web panel:

- `npm run admin-web:dev`
- open `http://127.0.0.1:3300`
- the Vite dev server proxies `/api` to `http://127.0.0.1:3100`
- production build output is generated by `npm run admin-web:build`

If you only need to validate config loading:

- `npm run check-config`

Older service-specific startup paths still exist, but are no longer the recommended path:

- `cd backend/api && npm run start`
- `cd backend/worker && npm run start`

## Minimum Runtime Capability

- API listens on `3100` by default
- API exposes `GET /healthz`
- API exposes workflow create/read/update/list endpoints
- Admin web dev server listens on `3300` when started with `npm run admin-web:dev`
- Worker listens on `3200` by default
- Worker exposes `GET /healthz`
- API and Worker read the same `backend/config/backend.config.json`
- DB mode is the default runtime path and requires PostgreSQL schema readiness before startup
- legacy JSON stores are available only when `persistence.mode = "json"` is set explicitly

## DB Only Runtime

Runtime persistence is controlled by `persistence.mode` in `backend/config/backend.config.json` or `BACKEND_PERSISTENCE_MODE`.

- `db`: default and primary runtime. Auth/session/audit, files, workflows, executions/tasks/events, Worker outputs, and admin read APIs use PostgreSQL-backed repositories.
- `json`: legacy fallback for rollback or isolated diagnostics. It is not part of the main backend test chain.

DB mode does not silently fall back to JSON. Missing PostgreSQL connectivity, missing `pg`, or missing required schema fails `npm run check-config`, `npm run start`, or `npm run dev`; API and Worker `/healthz` report DB health as degraded if a running service loses database access.

Use `persistence.cutoverStage` only as an operator note for the deployment stage; it does not change runtime behavior.

DB Only regression commands:

- `npm run test:db`: runs the PostgreSQL-backed E2E scope for auth, files, workflows, executions, Worker output assets, task history, admin APIs, schema health, and migration checks.
- `npm run verify:db`: runs backend typecheck and then the full DB Only E2E scope.

Both commands require `BACKEND_TEST_DATABASE_URL` or `DATABASE_URL`. If no PostgreSQL test URL is configured, DB tests fail with a configuration error and are not skipped. The DB E2E bootstrap creates an isolated schema per test file and `tests/db/db-only-no-json-store.e2e.spec.ts` verifies the core chain still works when legacy JSON stores are absent.

DB Only references:

- `docs/DB-ONLY-BACKEND-RUNBOOK.md`
- `docs/DB-ONLY-VERIFICATION-REPORT.md`
- `docs/FILE-DATABASE-CUTOVER-RUNBOOK.md`
- `docs/FILE-DATABASE-ROLLBACK-GUIDE.md`
- `docs/FILE-DATABASE-OBSERVABILITY-CHECKLIST.md`
- `config/README.md`

## Account Persistence Baseline

In DB mode, accounts, refresh sessions, and audit logs are stored in PostgreSQL tables:

- `users`
- `refresh_tokens`
- `audit_logs`

The legacy JSON fallback store remains:

- `backend/data/accounts-store.json`

Current collections:

- `users`
- `sessions`
- `auditLogs`

Current constraints:

- email is globally unique
- valid `auth.bootstrapAdmin.*` config will auto-fill the initial admin account during startup
- JSON account storage is used only when `persistence.mode = "json"` is explicitly selected

## API Authenticated Ownership

Current authenticated API behavior:

- `GET /api/v1/workflows`, `POST /api/v1/workflows`, `GET /api/v1/workflows/:workflowId`, `PUT /api/v1/workflows/:workflowId` all require `Authorization: Bearer <accessToken>`.
- `POST /api/v1/files/register`, `POST /api/v1/files/upload`, `POST /api/v1/executions` all require `Authorization: Bearer <accessToken>`.
- `GET /api/v1/files/:fileId`, `/download`, `/preview`, `GET /api/v1/executions/:runId`, `GET /api/v1/tasks`, `GET /api/v1/tasks/:taskId`, and `GET /api/v1/tasks/:taskId/events` all resolve visibility from the current authenticated account.
- Request body or query `userId` fields remain compatible at the API shape level, but the backend ignores them as a trusted ownership source.
- `member` accounts can only access their own workflows, files, runs, tasks, and events.
- `admin` accounts can inspect any workflow, file, run, task, and event data.

Recommended request flow:

1. Call `POST /api/v1/auth/register` or `POST /api/v1/auth/login` to get `accessToken`.
2. Use `accessToken` for file register/upload APIs.
3. Use `accessToken` for workflow create/read/update/list APIs.
4. Use `accessToken` for `POST /api/v1/executions`.
5. Use the same `accessToken` for execution/task detail and event queries.

Additional references:

- image delivery contract: `docs/IMAGE-DELIVERY-MVP.md`
- backend node parallel development spec: `docs/BACKEND-NODE-PARALLEL-DEVELOPMENT-SPEC.md`

## Provider Scheduling Notes

`laozhang-veo` is used by `video-gen` tasks.

Veo requests use the Laozhang Veo 3.1 official-forward Videos API:

- create task: `POST /v1/videos` with `multipart/form-data`
- query task: `GET /v1/videos/{id}`
- download result: `GET /v1/videos/{id}/content`
- supported models: `veo-3.1-fast-generate-preview`, `veo-3.1-generate-preview`
- legacy saved model names are normalized to one of the supported official-forward models before execution

Default behavior:

- no local Worker-side concurrency limit is applied by default

Optional local limiting:

- `providers.laozhang.veo.maxConcurrency`
- `LAOZHANG_VEO_MAX_CONCURRENCY`

Rules:

- omitted, non-integer, or values lower than `1` mean unlimited local dispatch
- set `2` to cap the current Worker process at 2 concurrent tasks
- set `3` to cap the current Worker process at 3 concurrent tasks

This is independent from RunningHub. RunningHub uses `providers.runninghub.maxConcurrency`, and its current default remains `3`.

Relevant config fields:

- `providers.laozhang.apiKey`
- `providers.laozhang.apiUrl`
- `providers.laozhang.openaiApiBaseUrl`
- `providers.laozhang.veo.apiBaseUrl`
- `providers.laozhang.veo.pollIntervalMs`
- `providers.laozhang.veo.timeoutMs`
- `providers.laozhang.veo.maxConcurrency`
- `providers.runninghub.apiKey`
- `providers.runninghub.apiBaseUrl`
- `providers.runninghub.maxConcurrency`

## AI Image Models

The following image-generation nodes currently support two LaoZhang-backed model paths:

- `gemini-3-pro-image-preview`
- `gpt-image-2-vip`
- `gpt-image-2-official`

Supported node scope:

- `aiImageGen`
- `aiImageHd`
- `aiFloorplanColorize`
- `aiModelRenderTransfer`
- `aiStoryboard` image-shot path via `aiImageGen`

Not in scope for this adaptation:

- `aiMultiViewRestore`

Behavior summary:

- frontend sends simplified `model + imageSize + aspectRatio`
- backend keeps the only `imageSize/aspectRatio -> size` mapping source
- `gpt-image-2-vip` supports `1..5` input images on `aiImageGen` and storyboard image-shot groups
- `gpt-image-2-official` is routed through the Sora2Official OpenAI-compatible group, sends provider model `gpt-image-2`, and currently supports text-to-image generation without reference images
- Gemini path still uses `imageSize + aspectRatio`
- GPT path resolves final `size` on the backend and calls the OpenAI-compatible `images/edits` endpoint
- GPT Image 2 Official resolves `size` to `auto` or `WIDTHxHEIGHT`, forwards `quality`, and calls `images/generations`
- single-image and staged image nodes reuse the same backend-only mapping rule and provider route

Required GPT Image 2 Official config:

- `providers.laozhang.sora2Official.apiKey` or `LAOZHANG_SORA2OFFICIAL_API_KEY`
- `providers.laozhang.sora2Official.apiBaseUrl` or `LAOZHANG_SORA2OFFICIAL_BASE_URL`

Additional references:

- `docs/AI-IMAGE-GEN.md`
- `config/README.md`

## Provider Snapshot Cleanup

`backend/data/provider-snapshots` retains third-party call snapshots for debugging and diagnosis.

Worker cleanup rules:

- run once on startup
- run once per hour afterward
- delete temporary snapshot files older than 3 hours

Cleanup targets:

- time-stamped `.json` snapshot files under `backend/data/provider-snapshots/`
- time-stamped `.lock` temp files under `backend/data/provider-snapshots/`

The following persisted data is not covered by that cleanup rule:

- `workflows/index.json`
- `workflows/{workflowId}/workflow.json`
- `workflows/{workflowId}/files.json`
- `workflows/{workflowId}/tasks.json`
- `executions-store.json`
- `files-store.json`
- `intermediate-artifacts-store.json`
- `storage-index.json`

## RunningHub Scheduling Baseline

All RunningHub task local concurrency limits, queue ordering, refill rules, and `task_queue_maxed` backpressure handling are defined in `docs/RUNNINGHUB-SCHEDULING.md`.

Current config baseline:

- `providers.runninghub.maxConcurrency` defaults to `3`
- Worker startup logs the active RunningHub concurrency cap
- Worker `GET /healthz` reports `scheduling.runninghub.active / max / available / queued`
- Worker `GET /healthz` reports the most recent RunningHub backpressure timestamp, error code, and refill timestamp

If you need to debug why a task did not start immediately, check `/healthz` first and then inspect Worker `worker-queue` logs.

## RunningHub Acceptance Status

As of 2026-04-07, one round of real RunningHub mixed scheduling acceptance has been completed:

- `aiImageToPly`: 6 groups
- `aiMultiViewRestore`: 6 groups
- total: 12 real RunningHub tasks

Confirmed in that round:

1. local Worker concurrency peak did not exceed `3`
2. tasks above `3` remained stably queued
3. refill order matched `createdAt + groupOrder`
4. `task_queue_maxed` was not observed in that run

Acceptance reference:

- `docs/RUNNINGHUB-SCHEDULING-ACCEPTANCE.md`
