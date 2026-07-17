# File Database Rollback Guide

This guide defines rollback decisions for the JSON-to-DB cutover.

Runtime selection is controlled by:

- `persistence.mode = "json"`
- `persistence.mode = "db"`
- `BACKEND_PERSISTENCE_MODE`

`persistence.cutoverStage` is only an operator note and does not change runtime behavior.

## 1. Rollback Windows

### 1.1 Before DB Write Mode

Rollback is expected to be safe when all are true:

- API has not accepted DB-mode writes.
- Worker has not been started in DB mode.
- No new file upload, workflow save, execution, account, session, or audit write has been accepted in DB mode.
- JSON stores and local storage backups are intact.

Rollback target:

- `persistence.mode = "json"`
- `persistence.cutoverStage = "json-read-write"`

### 1.2 After DB Write Mode

Rollback is data-risky after any DB write has been accepted.

DB writes include:

- new file registration or upload
- workflow create/update/delete
- execution run/task/event writes
- Worker output file asset writes
- account registration, login session, refresh, logout, or audit log writes

Default response after DB writes:

- fix forward
- disable the affected write path if possible
- keep API read access available if safe
- export newly-created DB records before any manual rollback

## 2. Immediate Rollback Triggers

Rollback before DB write mode if any condition occurs:

- API cannot start in DB mode.
- `/healthz` reports DB status `error`.
- admin login fails.
- member login fails.
- known workflow list/detail cannot load.
- known file download fails.
- known execution/task history cannot load.
- migration verification fails on critical counts.
- DB connection errors continue for more than 5 minutes.
- read-only smoke tests fail and no fix can be applied within the agreed window.

Escalate instead of automatic rollback after DB write mode if any condition occurs:

- new DB records were created successfully before the failure.
- users changed workflow data in DB mode.
- Worker produced output files in DB mode.
- account/session data changed in DB mode.

## 3. Pre-Rollback Checks

Before switching back to JSON:

- Confirm current stage and whether DB writes happened.
- Confirm API and Worker process list.
- Confirm backup paths for `backend/data` and `backend/storage`.
- Confirm the config path used by production.
- Capture current `/healthz` output from API and Worker if available.
- Capture last 15 minutes of API, Worker, and DB logs.
- Record the rollback owner and decision time.

## 4. Safe Rollback Procedure Before DB Writes

1. Stop Worker.
2. Stop API.
3. Set config:

```json
{
  "persistence": {
    "mode": "json",
    "cutoverStage": "json-read-write"
  }
}
```

4. Remove any temporary `BACKEND_PERSISTENCE_MODE=db` override from the service environment.
5. Start API.
6. Confirm API `/healthz`.
7. Login as admin and member.
8. Confirm known workflow, file download, and execution history.
9. Start Worker.
10. Confirm Worker `/healthz`.
11. Keep migrated DB unchanged for diagnosis.

## 5. Manual Recovery After DB Writes

Do not run a blind rollback after DB writes.

Required decision record:

- first DB write timestamp
- affected users
- affected workflows
- affected file assets
- affected execution runs/tasks
- whether new binary files exist only in DB-indexed storage
- whether account/session state changed

Minimum data export before manual rollback:

- `file_blobs`
- `file_assets`
- `file_blob_variants`
- `file_uploads`
- `workflow_file_bindings`
- `workflows`
- `execution_runs`
- `execution_tasks`
- `task_events`
- `task_file_links`
- `users`
- `refresh_sessions`
- `audit_logs`

If manual rollback is approved:

1. Stop Worker.
2. Stop API.
3. Export new DB rows created after the cutover timestamp.
4. Decide how those rows will be replayed into JSON or preserved as an incident archive.
5. Restore `persistence.mode = "json"`.
6. Start API in restricted access if available.
7. Validate known old JSON data.
8. Communicate which DB-mode writes are not visible in JSON mode.

## 6. Fix-Forward Options

Prefer these after DB writes:

- restart API or Worker if the failure is process-local.
- increase DB connection limit if pool exhaustion is the cause.
- temporarily stop Worker while keeping API read access.
- disable external write traffic at the gateway while preserving admin diagnostics.
- repair missing migrated rows with audited SQL.
- rerun verification and DB E2E smoke checks after repair.

## 7. Rollback Acceptance

Rollback is complete only when:

- API and Worker are running in `json` mode.
- admin/member login works.
- known workflows load from JSON.
- known files download from JSON metadata.
- known execution history loads.
- no production traffic is still pointed at a DB-mode instance.
- incident notes include DB write status and data reconciliation decision.
