# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Language**: Always reply in Chinese (中文). Code, comments, commit messages, and documentation stay in English.

## Project Overview

Workflow Canvas Platform — a collaborative visual workflow editor built on ReactFlow. Users arrange images, videos, and 3D models on a canvas, connect them to AI services (image generation, video generation, 3D reconstruction), and manage AI task execution in a visual node-graph interface. Codebase is in English; product UI is in Chinese.

## Tech Stack

- **Frontend**: React 18 + Vite 5 + TailwindCSS 3 + ReactFlow 11 + Zustand + TanStack Query + PixiJS
- **Backend**: Node.js/TypeScript (executed via `tsx`) — API server (port 3100) + Worker (port 3200) + shared types
- **Database**: PostgreSQL (primary), legacy JSON store fallback (explicit opt-in only)
- **Storage**: Local file storage with S3-compatible option

## Commands

### Unified Quality Gate (run from project root `newworkflow2/`)

```powershell
.\verify-quality.ps1        # PowerShell
verify-quality.cmd           # CMD
```

Runs fail-fast in order: frontend typecheck → lint → arch:check → test → backend typecheck → lint → arch:check → test.

### Frontend (from `frontend/`)

```bash
npm run dev          # Vite dev server on port 3000
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint with --max-warnings 0
npm test             # node:test pipeline via scripts/run-tests.mjs
npm run arch:report  # Architecture rule scanning (report-only)
npm run arch:check   # Architecture rule enforcement (blocking)
npm run verify       # Full quality gate: typecheck + lint + arch:check + test
```

### Backend (from `backend/`)

```bash
npm run start        # Start backend via scripts/start-backend.mjs --start
npm run dev          # Start backend in dev mode
npm run typecheck    # Typecheck shared, api, and worker sequentially
npm run lint         # ESLint on api/src, worker/src, shared/src
npm test             # Local-scope tests (default)
npm run test:env     # Environment-scope tests
npm run test:db      # PostgreSQL-backed E2E tests (requires BACKEND_TEST_DATABASE_URL)
npm run verify       # Full backend quality gate
npm run verify:db    # Typecheck + DB tests
npm run init-db      # Initialize database schema
npm run check-config # Validate config loading
npm run admin-web:dev # Admin panel dev server on port 3300
```

### Running a Single Test

Frontend: Tests are `frontend/src/**/*.spec.ts[x]` (source-adjacent) and `frontend/tests/*.test.mjs` (root-level entrypoints). The custom runner at `frontend/scripts/run-tests.mjs` discovers and executes them via `node:test`.

Backend: Tests are in `backend/tests/`. Use `npm test` from `backend/` for local-scope tests. DB-backed tests require `BACKEND_TEST_DATABASE_URL` or `DATABASE_URL` env var.

## Architecture

### Frontend Layer Structure

Dependency direction flows downward — lower layers must not import from higher layers:

```
components/, hooks/, App.tsx          ← UI rendering and interaction
auth/, components/context/, execution-runtime/  ← session state, workflow runtime
services/                             ← domain logic (file binding, execution, protected resources)
api/                                  ← HTTP/WebSocket transport, token injection
```

**Key constraints:**
- `nodes/`, `execution-runtime/`, `services/`, `utils/` must NOT import from `components/context`
- `nodes/` must NOT import from `components/canvas` or `components/node/*` implementations
- Core/runtime layers must use precise module imports, not barrel exports (`@/services`, `@/hooks`, etc.)
- `WorkflowContext` is an orchestration layer — do not add node-specific logic there

### Backend Layer Structure

```
main/composition → controller → service → repository/shared-contracts
```

**Key constraints:**
- `service -> dto` is forbidden
- `service -> controller` is forbidden
- Business source files must not import `shared/src/**` directly
- Dependency wiring belongs in composition root

### Backend Sub-packages

- `backend/api/` (`@newworkflow/backend-api`) — HTTP/WebSocket API server
- `backend/worker/` (`@newworkflow/backend-worker`) — async task execution worker
- `backend/shared/` (`@newworkflow/backend-shared`) — shared types, constants, protocol definitions

### Canvas Image Delivery

Canvas rendering is thumbnail-first. Upgrades to preview only when display size crosses a threshold, with hysteresis to prevent ping-pong. Original/download resources are reserved for viewer and export paths. Remote protected images require authenticated blob fetches — never mount raw browser `src` when auth is required.

### Storyboard Shot Input Ports

Each storyboard shot has its own input port for connecting reference images for video generation:

- **Port mode**: `dynamic` (one input group per shot)
- **Handle format**: `{shotId}:images` (e.g., `storyboard-shot-123:images`)
- **Max connections per shot**: 4 images
- **Legacy compatibility**: `group-1` is preserved for existing connections

**Reference image priority for video generation:**
1. `shot.imageFileId` (AI-generated image, always first)
2. Connected images from per-shot input port
3. Legacy `sourceNode` (fallback)
4. Legacy `shot.sourceImageFileId` (fallback)

**Key files:**
- `frontend/src/nodes/ai-storyboard/groups.ts` — port group definitions and validation
- `frontend/src/nodes/ai-storyboard/input-resolver.ts` — input image resolution
- `frontend/src/nodes/ai-storyboard/storyboard-shot-video-runner.ts` — video generation flow
- `frontend/src/nodes/ai-storyboard/storyboard-execution-service.ts` — reference image resolution

### Video Generation Reference Limits

- Backend: `AI_VIDEO_GEN_MAX_REFERENCE_COUNT = 4`
- Frontend: `maxReferences = 4`
- Each group must provide 1-4 referenceFileIds

### Auth Model

- `AuthProvider` is the single source of truth for session state
- Access token in memory, refresh token in localStorage
- HTTP client auto-injects `Authorization: Bearer <accessToken>` and handles 401 refresh single-flight
- WebSocket reads token from session state (not URL params)
- Roles: `member` (own resources only) and `admin` (can inspect any resource)

### Persistence

Backend is the source of truth for workflow canvas persistence. Frontend local JSON import/export is an auxiliary archive path only. Files start upload scheduling immediately after entering the canvas with content-hash precheck. Canvas save uses debounce (800ms–1500ms) with single-flight guard for concurrent saves.

## Protected Review Paths

Changes to these paths require tracked issue references, tests, and extra scrutiny:

- `frontend/src/components/context/**`
- `frontend/src/components/canvas/**`
- `frontend/src/execution-runtime/**`
- `frontend/src/services/workflow-file-normalizer.ts`
- `frontend/src/services/backendExecutionService.ts`
- `frontend/src/services/workflow-upload-scheduler.ts`
- `frontend/src/services/image/**`
- `frontend/src/nodes/ai-storyboard/**`
- `frontend/src/nodes/shared/**`

## ESLint Key Rules

**Frontend** (`.eslintrc.cjs`):
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/explicit-function-return-type`: warn (off in test files)
- `@typescript-eslint/no-unused-vars`: error (ignore `_` prefix)
- `no-console`: warn (allows `warn` and `error`)
- `prefer-const`: error, `no-var`: error

**Backend** (`eslint.config.mjs`): Flat config format with same core rules (no-unused-vars, no-var, prefer-const).

## Dev Server Setup

- Frontend: `http://127.0.0.1:3000`
- Backend API: `http://127.0.0.1:3100`
- Vite proxies `/api` → `http://127.0.0.1:3100` and `/ws` → `ws://127.0.0.1:3100`
- Admin panel: `http://127.0.0.1:3300` (via `npm run admin-web:dev`)
- Optional env overrides: `VITE_API_BASE_URL`, `VITE_WS_URL`

## Quality Gate Rules

Before changing code:
- Identify whether the change touches a protected path
- Add or update tests before changing observable behavior
- No new `any` or `as any` in production code
- No broad `eslint-disable` comments
- No unbounded retry or polling loops
- No persistence fields without save/hydrate/reload tests
- No execution payload fields without backend shared contract updates

New nodes must include: type/task ownership, handle contracts, persistence behavior, execution payload contract, and tests. New execution paths must include: shared request/response types, validation, payload builder, task history, retry behavior, and tests.

## Documentation References

- `frontend/ARCHITECTURE.md` — detailed frontend architecture
- `backend/README.md` — backend documentation index and scope
- `docs/architecture-layer-rules.md` — dependency rules and cycle governance
- `quality-gate-rules.md` — quality gate requirements and admission rules
- `backend-docs/` — backend design documents (domain models, APIs, task lifecycle)
- `spec.md` — full product specification (Chinese)
