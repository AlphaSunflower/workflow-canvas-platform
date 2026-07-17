# DB Only Backend Runbook

## Runtime Boundary

`persistence.mode = "db"` is the default backend runtime path. JSON stores are legacy fallback files only and must not participate in the main backend test chain.

DB Only covers:

- auth, refresh session, and audit log data
- file blobs, file assets, uploads, variants, events, and object metadata indexes
- workflow groups, workflow payload JSONB, and workflow-file bindings
- execution runs, execution tasks, task events, and task-file links
- Worker output and intermediate file asset registration
- intermediate artifact cache state
- provider call log summaries
- admin read-only APIs

Binary files are not stored in PostgreSQL. DB Only means PostgreSQL owns metadata,
relationships, permissions, lifecycle state, and object lookup keys. File bytes
remain in local storage for development and should move to object storage in
production.

## Storage Boundary

The backend uses a split storage model:

- PostgreSQL stores metadata only: `file_blobs`, `file_assets`,
  `file_blob_variants`, `file_uploads`, `file_events`,
  `workflow_file_bindings`, `task_file_links`, `intermediate_artifacts`, and
  `provider_call_logs`.
- Object storage stores bytes: original uploads, generated previews,
  thumbnails, Worker intermediate artifacts, Worker outputs, and provider
  diagnostic snapshots.
- `file_blob_variants` is the runtime source of truth for physical object
  lookup. `variant = 'original'` is used for download, `preview` for preview,
  and `thumbnail` for thumbnail.
- `storage_objects` is legacy migration inventory for imported
  `storage-index.json` rows. Runtime upload, download, Worker output
  registration, Admin storage issue checks, and DB Only tests must not depend on
  `storage_objects`.

Do not put original file bytes, previews, thumbnails, or provider raw response
payloads into PostgreSQL. Storing large binary payloads in PostgreSQL would
increase backup size, vacuum pressure, restore time, and connection/query load
without improving the main lookup path.

## Production Storage Recommendation

Production should use:

- S3, MinIO, OSS, or another object-storage-compatible service for bytes.
- PostgreSQL for metadata, relationships, permissions, and audit records.
- Object keys stored in `file_blob_variants.storage_key` with
  `storage_provider` identifying the provider.
- Provider raw diagnostic snapshots stored in object storage or an equivalent
  file-backed diagnostic bucket. `provider_call_logs.snapshot_path` should point
  to that object or path.

Local disk storage under `backend/storage` remains acceptable for development
and isolated test environments only.

Runtime object storage is configured by `storage.provider` in
`backend/config/backend.config.json` or `BACKEND_OBJECT_STORAGE_PROVIDER`.
Supported providers are:

- `local`: reads and writes `backend/storage`.
- `s3`: uses the S3-compatible adapter for API uploads/downloads, Admin storage
  issue checks, Worker inputs, and Worker outputs.

S3-compatible configuration:

```json
{
  "storage": {
    "provider": "s3",
    "s3": {
      "endpoint": "http://127.0.0.1:9000",
      "region": "us-east-1",
      "bucket": "newworkflow",
      "accessKeyId": "minio-access-key",
      "secretAccessKey": "minio-secret-key",
      "forcePathStyle": true,
      "publicBaseUrl": null
    }
  }
}
```

Environment overrides:

- `BACKEND_OBJECT_STORAGE_PROVIDER`
- `BACKEND_S3_ENDPOINT`
- `BACKEND_S3_REGION`
- `BACKEND_S3_BUCKET`
- `BACKEND_S3_ACCESS_KEY_ID`
- `BACKEND_S3_SECRET_ACCESS_KEY`
- `BACKEND_S3_FORCE_PATH_STYLE`
- `BACKEND_S3_PUBLIC_BASE_URL`

API file uploads stage bytes under a unique temporary object key, publish to the
content-addressed final key inside the DB transaction, and clean temporary keys
after success or failure. The DB transaction uses a sha256 advisory lock while
publishing file blob objects so concurrent uploads for the same content do not
delete each other's committed objects during rollback cleanup.

## Backup Boundary

Backups must be planned as two separate streams:

- PostgreSQL backup: schema, metadata, users, sessions, audit logs, workflows,
  executions, task events, file relationships, intermediate artifact cache
  state, and provider call log summaries.
- Object storage backup: original files, previews, thumbnails, intermediate
  files, output files, and provider diagnostic snapshots.

Restore requires both streams. A DB-only restore without object storage can
recover metadata and show missing-object issues, but cannot serve downloads,
previews, thumbnails, or generated outputs. An object-storage-only restore
without DB metadata cannot reconstruct ownership, workflow links, task links, or
permissions reliably.

## Required Configuration

Set DB mode explicitly in `backend/config/backend.config.json` or rely on the runtime default:

```json
{
  "persistence": {
    "mode": "db",
    "cutoverStage": "db-read-write"
  },
  "database": {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "newworkflow",
    "user": "postgres",
    "password": "postgres"
  }
}
```

Environment overrides:

- `BACKEND_PERSISTENCE_MODE`
- `DATABASE_URL` or `BACKEND_DATABASE_URL`
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `BACKEND_DATABASE_HOST`, `BACKEND_DATABASE_PORT`, `BACKEND_DATABASE_NAME`, `BACKEND_DATABASE_USER`, `BACKEND_DATABASE_PASSWORD`

Invalid persistence values fail during config loading. DB mode never falls back to JSON.

## Schema Requirement

Apply all backend migrations before starting API or Worker:

1. `backend/db/migrations/001_init.sql`
2. `backend/db/migrations/002_intermediate_artifacts.sql`
3. `backend/db/migrations/003_file_database_platform.sql`
4. `backend/db/migrations/004_production_hardening.sql`

`004_production_hardening.sql` adds global run/task sequences, task lease
columns, provider concurrency lease state, and production indexes for queue,
workflow, file, and task lookups.

Startup checks require the core DB tables for accounts, files, workflows,
executions, task links, provider concurrency leases, and legacy migration
tracking. Missing tables fail startup with `DATABASE_SCHEMA_NOT_READY`.

## Startup Checks

From `backend/`:

```powershell
npm run check-config
npm run start
```

In DB mode, `check-config`, `start`, and `dev` validate:

- config file is readable
- `persistence.mode` is `db` or `json`
- PostgreSQL can be reached
- required schema tables exist
- bootstrap admin can be created in DB when configured

If PostgreSQL is unavailable, startup fails with `DATABASE_NOT_READY`.

## Health Verification

After startup:

```powershell
Invoke-RestMethod http://127.0.0.1:3100/healthz
Invoke-RestMethod http://127.0.0.1:3200/healthz
```

Expected DB mode health:

- `persistenceMode = "db"`
- `database.enabled = true`
- `database.status = "ok"`
- service `status = "ok"`

If DB connectivity fails after startup, health responses report degraded database status instead of switching to JSON.

## Test Chain

DB-backed tests should run with a test database URL:

```powershell
$env:BACKEND_TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/newworkflow_test"
npm run test:db
```

Local legacy JSON tests may still exist for rollback compatibility, but DB Only acceptance requires the DB test scope to pass and all backend runtime data paths to use DB repositories.

## Device Migration

To move the backend service to another server:

1. Stop API and Worker on the source server.
2. Back up PostgreSQL from the source server.
3. Back up object storage:
   - for `local`, copy `backend/storage` and the configured
     `providerSnapshotDir`;
   - for `s3`, back up or replicate the bucket.
4. Restore PostgreSQL on the target server.
5. Restore or configure object storage on the target server.
6. Copy `backend/config/backend.config.json` and rotate host-specific secrets if
   needed.
7. Run `npm run init-db` or apply migrations `001` through `004` manually.
8. Run `npm run check-config`.
9. Start API and Worker with `npm run start`.
10. Check `/healthz` for both services and Admin storage issues.

For local-disk to S3-compatible migration, run a dry run first:

```powershell
npm run migrate:storage:s3
```

Then upload objects:

```powershell
npm run migrate:storage:s3 -- --apply
```

After upload, set `storage.provider = "s3"` and run `npm run check-config`.
Existing DB rows keep their historical `storage_provider` metadata, but runtime
reads use `storage_key` through the configured object-storage adapter.

## Legacy JSON Fallback

`persistence.mode = "json"` is reserved for explicit fallback or isolated diagnostics. In this mode:

- `/healthz` reports database status as `disabled`
- JSON files under `backend/data` are used as the source of truth
- DB Only acceptance is not satisfied

Do not use JSON mode as an automatic recovery path for DB errors. Recovery must be an operator decision with data reconciliation understood.
