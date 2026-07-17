# File Database Migration Dry-Run Report

Report date: 2026-05-21

This document records the task 18 migration rehearsal performed in the local test workspace. It is also the template for the production migration record.

## 1. Rehearsal Scope

Source snapshot:

- `backend/.tmp/migration-rehearsal/task18-20260521-111736/source-root/data`
- `backend/.tmp/migration-rehearsal/task18-20260521-111736/source-root/storage`

Generated migration artifacts:

- `backend/.tmp/migrations/json-store-to-db/task18-production-rehearsal-snapshot-absolute/migration.sql`
- `backend/.tmp/migrations/json-store-to-db/task18-production-rehearsal-snapshot-absolute/report.json`

Migration label:

- `task18-production-rehearsal-snapshot-absolute`

Migration id:

- `3f52305b-4246-41f6-b994-f5162200f307`

## 2. Environment

Workspace:

- `D:\Project\newflow5\newworkflow2`

Backend source root used by the migration tool:

- `D:\Project\newflow5\newworkflow2\backend\.tmp\migration-rehearsal\task18-20260521-111736\source-root`

Database environment:

- `BACKEND_TEST_DATABASE_URL`: not set
- `DATABASE_URL`: not set
- `psql`: not available in PATH

Result:

- dry-run completed
- DB import not executed
- migration verification tool not executed
- API/Worker DB-mode regression not executed

## 3. Commands Run

Create source snapshot:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$root = Join-Path (Resolve-Path 'backend\.tmp').Path "migration-rehearsal\task18-$stamp\source-root"
New-Item -ItemType Directory -Force -Path $root
Copy-Item -Path 'backend\data' -Destination (Join-Path $root 'data') -Recurse
Copy-Item -Path 'backend\storage' -Destination (Join-Path $root 'storage') -Recurse
```

Run dry-run from the snapshot source:

```powershell
$source = (Resolve-Path 'backend\.tmp\migration-rehearsal\task18-20260521-111736\source-root').Path
npm.cmd --prefix backend run migrate:json-store -- --source-root $source --label task18-production-rehearsal-snapshot-absolute
```

Check DB tool availability:

```powershell
if ($env:BACKEND_TEST_DATABASE_URL) { 'BACKEND_TEST_DATABASE_URL=set' } else { 'BACKEND_TEST_DATABASE_URL=missing' }
if ($env:DATABASE_URL) { 'DATABASE_URL=set' } else { 'DATABASE_URL=missing' }
Get-Command psql -ErrorAction SilentlyContinue
```

## 4. Dry-Run Result

Status:

- `errors = 0`
- `warnings = 1`

Counts:

| Type | Count |
| --- | ---: |
| fileBlobs | 5 |
| fileAssets | 5 |
| fileBlobVariants | 15 |
| fileUploads | 0 |
| fileEvents | 5 |
| storageObjects | 1 |
| users | 2 |
| refreshTokens | 2 |
| auditLogs | 63 |
| workflows | 8 |
| workflowGroups | 0 |
| workflowFileBindings | 6 |
| executionRuns | 2 |
| executionTasks | 2 |
| taskEvents | 0 |
| taskFileLinks | 2 |
| intermediateArtifacts | 0 |

Warning:

```json
{
  "type": "storage_object_missing_legacy_blob",
  "storageKey": "outputs/d89d3a36-2eda-4204-941f-ab5e9a9009b5.png",
  "blobId": "d89d3a36-2eda-4204-941f-ab5e9a9009b5",
  "action": "legacy_blob_id_set_null"
}
```

Disposition:

- Accepted for rehearsal.
- The storage object is imported as compatibility inventory.
- `legacy_blob_id` is set to `null`.
- This does not block migration unless a production verification report later shows a missing file asset or task output reference.

## 5. Steps Not Completed

These steps require a PostgreSQL test database and `psql`:

- apply schema migrations to a test database
- import generated SQL
- run `npm run verify:json-store-migration`
- start API with `persistence.mode = "db"`
- start Worker with `persistence.mode = "db"`
- run `npm run test:db`
- run manual API/Worker DB smoke tests

Current blocker:

- no `BACKEND_TEST_DATABASE_URL` or `DATABASE_URL`
- no `psql` executable in PATH

## 6. Required Full Rehearsal Commands

After a PostgreSQL test database is available:

```powershell
$env:BACKEND_TEST_DATABASE_URL = 'postgres://user:pass@localhost:5432/newworkflow_rehearsal'
$env:DATABASE_URL = $env:BACKEND_TEST_DATABASE_URL
```

Run DB E2E regression:

```powershell
npm.cmd --prefix backend run test:db
```

Apply migration SQL to a clean rehearsal database:

```powershell
psql $env:DATABASE_URL -f backend\db\migrations\001_init.sql
psql $env:DATABASE_URL -f backend\db\migrations\002_intermediate_artifacts.sql
psql $env:DATABASE_URL -f backend\db\migrations\003_file_database_platform.sql
psql $env:DATABASE_URL -f backend\.tmp\migrations\json-store-to-db\task18-production-rehearsal-snapshot-absolute\migration.sql
```

Verify migration:

```powershell
$source = (Resolve-Path 'backend\.tmp\migration-rehearsal\task18-20260521-111736\source-root').Path
npm.cmd --prefix backend run verify:json-store-migration -- --source-root $source --label task18-production-rehearsal-snapshot-absolute --database-url $env:DATABASE_URL
```

Run DB-mode smoke checks:

```powershell
$env:BACKEND_PERSISTENCE_MODE = 'db'
npm.cmd --prefix backend run check-config
npm.cmd --prefix backend run test:db
```

## 7. Production Operation Record Template

Use this section for the real production rehearsal and cutover ticket.

| Field | Value |
| --- | --- |
| Operator |  |
| Date/time start |  |
| Date/time end |  |
| Source snapshot path |  |
| Storage snapshot path |  |
| Database URL alias |  |
| Schema migration version |  |
| Migration label |  |
| Migration id |  |
| Migration SQL path |  |
| Migration report path |  |
| Verification report path |  |
| Dry-run errors |  |
| Dry-run warnings |  |
| Accepted warnings |  |
| SQL import result |  |
| Verification result |  |
| API DB read smoke result |  |
| Worker DB write smoke result |  |
| `npm run test:db` result |  |
| Rollback deadline |  |
| Final decision |  |

## 8. Rehearsal Acceptance

Current local rehearsal acceptance:

- dry-run completed from a copied source snapshot
- `errors = 0`
- warning reviewed and documented
- generated SQL and report paths recorded

Full task 18 acceptance is not complete until:

- SQL is imported into a PostgreSQL rehearsal database
- verification report passes
- API and Worker run in DB mode
- DB E2E regression passes
- business smoke tests pass
