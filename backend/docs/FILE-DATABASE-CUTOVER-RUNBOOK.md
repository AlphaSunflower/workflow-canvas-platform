# File Database Cutover Runbook

This runbook defines the phase-1 operational boundary for moving from JSON-backed persistence to database-backed persistence.

It is the operator baseline for the phase-1 JSON-to-DB cutover. Runtime selection is controlled by `persistence.mode` with the implemented values `json` and `db`.

## 1. Cutover Goals

The cutover must:

- Preserve existing file API behavior.
- Preserve existing workflow payloads.
- Preserve existing execution history.
- Preserve existing account and audit data.
- Keep binary files in their current storage location for phase 1.
- Allow a controlled rollback before DB write mode is enabled.

## 2. Cutover Non-Goals

The cutover must not:

- Move binary files to MinIO/S3.
- Delete JSON store files.
- Delete local storage files.
- Introduce automatic file cleanup.
- Introduce long-term dual-write.
- Change frontend file API contracts.
- Change workflow canvas JSON shape.
- Introduce multi-tenant/project-member authorization.

## 3. Runtime Modes

The implemented runtime switch is:

```json
{
  "persistence": {
    "mode": "json"
  }
}
```

or:

```json
{
  "persistence": {
    "mode": "db"
  }
}
```

The documented cutover stages are operational stages, not additional runtime enum values:

```text
json-read-write
  Production baseline. Runtime uses persistence.mode=json and JSON stores remain the read/write source.

db-shadow-read
  DB has migrated data. Runtime still uses persistence.mode=json. Operators compare DB and JSON through migration verification and admin/read-only smoke tests in staging or during a freeze window.

db-read-json-fallback
  Short validation window. Operators start API against the migrated DB with Worker stopped, run read-only checks, and keep JSON backups available for immediate rollback.

db-read-write
  Runtime uses persistence.mode=db. DB becomes the source of truth. JSON stores become read-only backup material.
```

Phase 1 does not require long-term dual-write. Dual-write should be avoided unless a later task explicitly designs reconciliation.

`persistence.cutoverStage` may be recorded in config for operator visibility, but the application only selects repositories from `persistence.mode`.

## 3.1 Configuration Matrix

| Stage | `persistence.mode` | API | Worker | Writes |
| --- | --- | --- | --- | --- |
| `json-read-write` | `json` | running | running | JSON |
| `db-shadow-read` | `json` | running | running | JSON |
| `db-read-json-fallback` | `db` in controlled validation, or staging only | API only | stopped | none except smoke-test reads |
| `db-read-write` | `db` | running | running | DB |

Do not run Worker in DB mode until API read-only smoke tests pass.

## 4. Migration Boundary

### 4.1 Migrated in Phase 1

- File blob metadata.
- File asset metadata.
- File variants: original, preview, thumbnail.
- Pending uploads.
- Worker storage inventory as compatibility records.
- Workflow summaries.
- Workflow full payloads.
- Workflow file bindings.
- Execution runs.
- Execution tasks.
- Task events where present.
- Task input/output file links that can be derived.
- Users.
- Refresh sessions.
- Audit logs.

### 4.2 Preserved but Not Moved

- Binary files under `backend/storage/**`.
- Full workflow JSON payload shape.
- Provider snapshots under `backend/data/provider-snapshots/**`.
- Legacy JSON stores as backup artifacts.

### 4.3 Not Migrated in Phase 1

- Runtime sequence counters as authoritative DB counters.
- Cost records.
- Quota records.
- Provider key pool state.
- Storage lifecycle state.
- Deletion approval state.

## 5. Pre-Cutover Checklist

Before any production cutover:

- Confirm schema migrations have been reviewed.
- Confirm field mapping has been reviewed: `FILE-DATABASE-MIGRATION-FIELD-MAPPING.md`.
- Confirm migration tool dry-run has been executed against a production-like copy.
- Confirm `report.errors` is zero.
- Confirm warnings are reviewed and accepted.
- Confirm backup storage is available.
- Confirm API and Worker can be stopped or put into write freeze.
- Confirm rollback owner and decision deadline.
- Confirm post-cutover smoke tests are assigned.

## 6. Backup Checklist

Back up these paths before running migration:

- `backend/data`
- `backend/storage`
- Current database, if any
- Backend config files

Backup requirements:

- Backups must be timestamped.
- Backups must be outside the directory being modified.
- Operators must verify backup readability before proceeding.

## 7. Dry-Run Procedure

Dry-run happens before the production write freeze.

Steps:

1. Copy production-like `backend/data` and `backend/storage` to a test environment.
2. Apply schema migrations to an empty or staging database.
3. Run JSON-to-DB migration generation.
4. Inspect migration report.
5. Import generated SQL into the staging database.
6. Run migration verification.
7. Run file API smoke tests against staging.
8. Run workflow list/detail smoke tests against staging.
9. Run execution history smoke tests against staging.
10. Record issues and fix before production cutover.

Dry-run must produce:

- Migration SQL.
- Migration report.
- Verification report.
- Known-warning acceptance list.
- Estimated production downtime.

## 7.1 Read-Only Validation Mode

Read-only validation is the safety gate between migration and DB writes.

Allowed actions:

- Start API with `persistence.mode=db`.
- Keep Worker stopped.
- Use admin/member accounts to run GET-style smoke checks.
- Download known files and previews.
- Query known workflows, executions, tasks, and admin detail endpoints.
- Run migration verification against the same DB.

Blocked actions:

- Do not start Worker.
- Do not accept normal user traffic.
- Do not create new executions.
- Do not run bulk uploads.
- Do not change workflow payloads except a controlled smoke object if explicitly approved.

Pass criteria:

- `/healthz` reports DB status `ok`.
- Admin login succeeds.
- Member login succeeds.
- Known workflow list/detail matches source JSON.
- Known file download works.
- Known execution and task history can be queried.
- Admin API can inspect files, workflows, executions, users, and storage issues.

## 8. Production Cutover Procedure

### 8.1 Enter Write Freeze

1. Stop API write traffic or stop API service.
2. Stop Worker service.
3. Confirm no active uploads are in progress, or record pending uploads.
4. Confirm no task queue workers are claiming new tasks.

### 8.2 Backup

1. Back up `backend/data`.
2. Back up `backend/storage`.
3. Back up database.
4. Record backup paths in the production migration report.

### 8.3 Schema Migration

1. Apply reviewed schema migrations.
2. Confirm migration version.
3. Confirm required tables exist.
4. Confirm required indexes exist.

### 8.4 Data Migration

1. Run migration generation against production `backend/data`.
2. Confirm `report.errors = 0`.
3. Review warnings.
4. Apply generated SQL.
5. Run verification.

### 8.5 Start DB Read Mode

1. Configure API for DB read mode where implemented.
2. Start API only.
3. Run read-only smoke tests.
4. Keep Worker stopped during read validation.

Smoke tests:

- Login as admin.
- Login as member.
- List workflows.
- Open workflow detail.
- Query a known file.
- Download a known file.
- Query a known execution run.
- Query a known task detail.
- Query admin overview.
- Query admin file detail and confirm usage links.
- Query admin execution detail and confirm input/output files.

### 8.6 Enable DB Write Mode

Only after read smoke tests pass:

1. Set `persistence.mode = "db"` and `persistence.cutoverStage = "db-read-write"`.
2. Restart API and confirm `/healthz`.
3. Start Worker with DB persistence enabled.
3. Upload a small image as a member.
4. Confirm file asset is written to DB.
5. Run one low-risk execution path if available.
6. Confirm output file asset and task link are written to DB.
7. Confirm admin overview counters move as expected.

## 8.7 Post-Write Smoke Tests

Run these immediately after Worker starts:

- Register and upload a new small image.
- Download the uploaded file.
- Save and reload a test workflow that references the uploaded file.
- Start one low-risk execution and wait for completion.
- Confirm `execution_tasks.result_file_id` is populated.
- Confirm `task_file_links` contains output links.
- Confirm admin file detail shows task/workflow usage.
- Confirm member cannot access another member's file, workflow, or execution.

## 9. Rollback Rules

### 9.1 Rollback Is Safe Before DB Write Mode

If failure occurs before enabling DB write mode:

1. Stop API and Worker.
2. Switch persistence config back to JSON.
3. Start API and Worker.
4. Keep migrated DB data for diagnosis.

### 9.2 Rollback Is Risky After DB Write Mode

After DB write mode creates new data, rollback to JSON can lose new writes because JSON stores are no longer authoritative.

Preferred response after DB write mode:

- Fix forward.
- Temporarily disable affected write path.
- Export new DB records if a manual rollback is unavoidable.

Rollback after DB writes requires a separate incident decision.

Detailed rollback procedures are in `FILE-DATABASE-ROLLBACK-GUIDE.md`.

## 10. Rollback Triggers

Rollback before DB write mode if any occurs:

- API cannot start.
- Admin/member login fails globally.
- Workflow list cannot load.
- Known file cannot be downloaded.
- Migration verification fails on critical counts.
- Database connection is unstable.

Fix-forward after DB write mode unless data loss risk is higher than downtime risk.

## 11. Post-Cutover Monitoring

Observe for at least 24 hours:

- File register success rate.
- File upload success rate.
- File download/preview/thumbnail success rate.
- DB connection pool errors.
- Task claim failures.
- Task completion failures.
- New output file asset creation.
- Admin query latency.
- Disk usage under `backend/storage`.

Use `FILE-DATABASE-OBSERVABILITY-CHECKLIST.md` as the monitoring checklist and incident handoff template.

## 12. Phase 1 Acceptance

Cutover is complete only when:

- JSON stores are no longer the runtime write source.
- File API reads and writes use DB-backed metadata.
- New task outputs create DB file assets.
- Workflow file bindings are queryable from DB.
- Admin read-only queries can inspect files, workflows, executions, and users.
- Old JSON and storage backups remain available.

## 13. Documentation Updates Required After Cutover

After a successful cutover, update:

- `backend/README.md`
- `backend/config/README.md`
- `backend/docs/DATABASE-SCHEMA.md`
- `backend/docs/FILE-ASSET-DESIGN.md`
- `backend/docs/FILE-DATABASE-MIGRATION-AND-ADMIN-PLATFORM-PLAN.md`

The production migration report must record:

- Date and operator.
- Source data snapshot.
- Database migration version.
- Migration report path.
- Verification report path.
- Accepted warnings.
- Smoke test result.
- Final runtime mode.

## 14. Production Rehearsal Record Template

Use `FILE-DATABASE-MIGRATION-DRY-RUN-REPORT.md` as the running record for rehearsal and production cutover. Every rehearsal must include:

- source `backend/data` snapshot path
- source `backend/storage` snapshot path
- migration label
- migration id
- schema migration version
- dry-run command
- dry-run duration
- dry-run `errors` count
- dry-run `warnings` count
- warning disposition
- generated SQL path
- generated report path
- SQL import duration
- verification command
- verification report path
- API DB read-only smoke result
- Worker DB write smoke result
- DB E2E regression result
- rollback owner
- rollback deadline
- final go/no-go decision

Task 18 local rehearsal result:

- Snapshot dry-run label: `task18-production-rehearsal-snapshot-absolute`
- Dry-run result: `errors = 0`, `warnings = 1`
- SQL import: not executed because no PostgreSQL test URL or `psql` executable was available in this environment
- Full DB-mode rehearsal remains blocked until a PostgreSQL rehearsal database is provided
