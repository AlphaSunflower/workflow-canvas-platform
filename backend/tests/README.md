# Backend Tests

This directory contains backend regression and integration-oriented tests for the current project.

## Unified Entry

Use backend root commands:

- `npm.cmd test`
- `npm.cmd run test:local`
- `npm.cmd run test:env`
- `npm.cmd run test:db`
- `npm.cmd run test:list`
- `npm.cmd run verify`
- `npm.cmd run verify:db`

The project root gate `newworkflow2/verify-quality.ps1` now includes backend `typecheck` and backend `test`.

## Test Categories Present

- API behavior tests
- Auth and account flow tests
- Workflow and execution tests
- File upload and file access tests
- Worker executor tests
- Queue, retry, and provider scheduling tests
- End-to-end or environment-sensitive regression tests

## Execution Split

### Local Automated

Included in `npm.cmd test`:

- tests under `backend/tests/**/*.spec.ts`
- module-level tests under `backend/api/src/**/*.spec.ts`
- module-level tests under `backend/worker/src/**/*.spec.ts`

The `backend/tests/db/` directory is intentionally excluded from this default
local scope because those tests require a real PostgreSQL database.

These tests must stay local-safe:

- no real provider credentials
- no dependence on shared long-lived backend services
- no manual operator steps

### Environment-Dependent Automated

Reserved for `npm.cmd run test:env`.

Current status:

- none

If a future backend test requires real external services or credentials, it must be explicitly moved into this bucket and documented in `backend/docs/backend-quality-gate.md`.

### DB Mode End-to-End

Run separately with:

- `npm.cmd run test:db`
- `node ./scripts/run-tests.mjs --scope db`

Required environment:

- `BACKEND_TEST_DATABASE_URL`, or `DATABASE_URL`

This scope is a DB Only gate. When neither database URL is configured,
`npm.cmd run test:db` must fail with a clear configuration error. DB tests must
not be skipped or converted to no-op runs.

The DB E2E scope creates a unique PostgreSQL schema per test file, applies
`backend/db/migrations/001_init.sql`, `002_intermediate_artifacts.sql`, and
`003_file_database_platform.sql`, then drops the schema during cleanup. These
tests cover DB-mode file register/upload/download, workflow save/load, execution
queue/output/task history, admin read APIs, permission isolation, and migration
verification.

DB Only coverage currently includes:

- auth/session/audit repository flow
- file asset register/upload/download/preview/thumbnail flow
- workflow CRUD, groups, file bindings, and file metadata hydration
- execution run/task/event creation and DB queue claim
- Worker output file asset registration and task file links
- workflow task history aggregation
- admin overview, files, executions, workflows, users, and storage issue APIs
- schema health and migration verification helpers

`tests/db/db-only-no-json-store.e2e.spec.ts` is the explicit no-JSON-store
sentinel. It removes the per-test legacy JSON `data` directory before executing
auth, files, workflow, execution, Worker, task history, and admin API flows, then
asserts legacy JSON stores were not recreated.

The connection user must be allowed to create/drop schemas and use `pgcrypto`.
Do not point this scope at production or shared staging data.

### Manual / Operator-Assisted

Documented in:

- `backend/tests/manual/`

These checks are not part of the automated quality gate.

## Quality Baseline Freeze Rules

During the baseline recovery phase:

- Do not add new backend feature behavior in test-covered modules unless the change closes a tracked issue from `quality-baseline-issues.md`.
- Do not weaken test assertions to make failing behavior pass.
- Document whether each future backend test entry is:
  - automatic and local
  - automatic but environment-dependent
  - manual or operator-assisted

See also:

- `backend/docs/backend-quality-gate.md`
