# Backend Scripts

This directory contains backend development and operations helpers.

## Database Initialization

Initialize or re-apply the backend PostgreSQL schema:

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/newworkflow'
npm run init-db
```

For DB tests, use a separate database URL:

```powershell
$env:BACKEND_TEST_DATABASE_URL='postgres://user:pass@localhost:5432/newworkflow_test'
npm run init-db:test
```

Useful options:

- `--database-url <url>`: explicit PostgreSQL URL. This overrides environment variables.
- `--test`: read `BACKEND_TEST_DATABASE_URL` instead of development `DATABASE_URL`.
- `--ssl`: enable relaxed PostgreSQL SSL for hosted databases.

The script applies migrations in order:

1. `db/migrations/001_init.sql`
2. `db/migrations/002_intermediate_artifacts.sql`
3. `db/migrations/003_file_database_platform.sql`

The migrations are idempotent and can be run repeatedly against the same database. After
applying them, the script checks the DB Only required tables and fails with
`DATABASE_SCHEMA_NOT_READY` if any table is missing.

## JSON Store Migration

Generate auditable SQL and a report without writing to the database:

```powershell
npm run migrate:json-store -- --label first-db-migration
```

Useful options:

- `--source-root <path>`: backend root containing `data/` and `storage/`.
- `--output-dir <path>`: directory for `migration.sql`, `report.json`, and `README.md`.
- `--label <label>`: stable migration label. The default output directory uses this label.
- `--migration-id <uuid>`: optional stable `legacy_migration_runs.id`.
- `--apply`: execute generated SQL through `psql`.
- `--database-url <url>`: PostgreSQL URL for `--apply`; defaults to `DATABASE_URL`.
- `--psql <path>`: `psql` executable path.
- `--force`: allow `--apply` when the report contains errors.

Default mode is dry-run. It reads JSON stores from `backend/data`, checks files under
`backend/storage`, writes generated artifacts under
`backend/.tmp/migrations/json-store-to-db/<label>/`, and never deletes old JSON or moves
binary files.

Apply only after reviewing the generated report:

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/newworkflow'
npm run migrate:json-store -- --label first-db-migration --apply
```

## JSON Store Migration Verification

After importing generated SQL into PostgreSQL, compare the old JSON stores with the DB:

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/newworkflow'
npm run verify:json-store-migration -- --label first-db-migration
```

Useful options:

- `--source-root <path>`: backend root containing the original `data/` and `storage/`.
- `--output-dir <path>`: directory for `verification-report.json`.
- `--label <label>`: stable verification output label.
- `--database-url <url>`: PostgreSQL URL; defaults to `DATABASE_URL`.
- `--sample-size <n>`: number of DB `file_blobs` sampled for storage lookup.

The verification report returns `status: "pass"` or `status: "fail"`, count comparisons,
missing migrated IDs by type, missing file references, and sampled storage files that cannot
be located.
