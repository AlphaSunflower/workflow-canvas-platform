# DB Only Verification Report

## Purpose

This report defines the backend verification gate for the DB Only runtime path:
all primary backend data must be created, queried, and linked through
PostgreSQL-backed repositories. Legacy JSON stores are retained only for explicit
`persistence.mode = "json"` fallback and are not part of the DB Only test chain.

## Gate Commands

Run from `backend/`:

```bash
npm run test:db
npm run verify:db
```

`verify:db` runs `typecheck` first and then the full DB E2E scope.

Required environment:

```bash
BACKEND_TEST_DATABASE_URL=postgres://...
```

`DATABASE_URL` is accepted as a fallback. If neither variable is configured, DB
tests must fail with `DB_TEST_DATABASE_URL_REQUIRED`. They must not be skipped.

## Coverage

- Auth/session/audit: registration, login, refresh, logout, admin/member role
  checks, `users`, `refresh_tokens`, and `audit_logs`.
- Files: register, upload, dedupe, download, preview, thumbnail, permission
  isolation, `file_assets`, `file_blobs`, `file_blob_variants`, `file_uploads`,
  and `file_events`.
- Workflows: create, save, load, groups, delete, JSONB payload persistence,
  `workflow_file_bindings`, and DB-backed file metadata hydration.
- Executions: run/task creation, DB queue claim, task events, task status,
  input/output file links, and task history aggregation.
- Worker outputs: Worker claims queued DB tasks and registers output assets in
  the file asset system.
- Intermediate artifacts: reusable `lineart` and `depth` cache state is stored
  in `intermediate_artifacts`; reusable bytes are registered as
  `file_assets(source_type = 'intermediate')` and stored through the object
  storage adapter.
- Provider call logs: provider calls write searchable summaries to
  `provider_call_logs`; raw snapshots remain file/object-storage diagnostics
  referenced by path/key.
- Admin API: overview, file usage, execution detail, workflow detail, user list,
  storage issue checks, and admin-only authorization.
- Schema/migration: isolated schema initialization, required table health check,
  and migration verification helpers.
- Storage boundary: PostgreSQL stores metadata and object keys only. Original
  file bytes, previews, thumbnails, intermediate outputs, final outputs, and raw
  provider snapshots are not stored in PostgreSQL.

## No JSON Store Sentinel

`tests/db/db-only-no-json-store.e2e.spec.ts` is the explicit DB Only sentinel.
It removes the per-test legacy `data` directory before running the core chain:

1. Auth register/login/refresh.
2. File upload and download.
3. Workflow save/load and file binding hydration.
4. Execution creation.
5. Worker DB queue claim and output file asset registration.
6. Workflow task history query.
7. Admin overview, file usage, execution detail, workflow detail, and user list.
8. Direct DB count assertions for users, sessions, audit logs, files, workflows,
   runs, tasks, events, and file links.

The test asserts these legacy JSON stores remain absent:

- `data/accounts-store.json`
- `data/files-store.json`
- `data/files/files-store.json`
- `data/storage-index.json`
- `data/executions-store.json`
- `data/intermediate-artifacts-store.json`
- `data/workflows/index.json`
- `data/workflows/accounts-index.json`
- `data/workflows/groups-index.json`
- `data/workflows/*/workflow.json`
- `data/workflows/*/files.json`
- `data/workflows/*/task-history/*/index.json`

The sentinel also checks common lock files for those JSON stores. It scans the
per-test `data` directory recursively for legacy main-data shapes so a new JSON
main-data write fails the DB Only gate.

## Static No JSON Gate

`tests/db/db-only-no-json-static.spec.ts` statically scans API and Worker
composition files. The gate allows explicit JSON fallback constructors only in
known legacy fallback branches and fails if a DB-mode branch directly
instantiates a JSON repository.

The static gate currently protects:

- auth account/session/audit repositories
- file repositories
- execution repositories
- workflow repositories
- Worker core file/execution repositories
- Worker intermediate artifact repositories
- workflow task history DB-mode composition

`scripts/run-tests.mjs` requires both DB Only gate tests when the full DB scope
runs:

- `tests/db/db-only-no-json-store.e2e.spec.ts`
- `tests/db/db-only-no-json-static.spec.ts`

This makes `npm run verify:db` the DB Only gate rather than a loose collection of
DB tests.

## Storage And Backup Verification Boundary

DB Only verification does not mean file bytes are inside PostgreSQL. The
accepted architecture is:

- S3, MinIO, OSS, or local test storage stores bytes.
- PostgreSQL stores metadata, relationships, object keys, permissions, audit,
  intermediate cache state, and provider call summaries.
- `file_blob_variants` is the runtime physical object index.
- `storage_objects` is legacy `storage-index.json` migration inventory only.

Backup verification must treat DB and object storage separately:

- DB backup/restore validates metadata and relationships.
- Object storage backup/restore validates original files, derivatives,
  intermediate files, outputs, and provider snapshots.
- A restored DB with missing object bytes should report storage issues through
  Admin diagnostics rather than silently passing.

## Current Local Result

As of 2026-05-21, the DB Only gate is wired into:

- `npm run test:db`
- `npm run verify:db`
- `backend/tests/README.md`
- `backend/README.md`

Local execution still requires a PostgreSQL test database URL. Without
`BACKEND_TEST_DATABASE_URL` or `DATABASE_URL`, the gate is expected to fail early
with a configuration error. A passing DB Only result can only be recorded after
running `npm run verify:db` against a real PostgreSQL test database.
