# File Database Observability Checklist

Use this checklist during JSON-to-DB dry-run, read-only validation, DB write enablement, and the first 24 hours after cutover.

## 1. Required Signals

### API Health

- `GET /healthz` returns success.
- DB health is `ok` when `persistence.mode = "db"`.
- DB health latency is stable.
- API error rate does not increase after switching to DB.
- admin API latency remains acceptable.

### Worker Health

- Worker `GET /healthz` returns success.
- queue polling continues after DB mode is enabled.
- task claim errors do not increase.
- provider concurrency counters remain sane.
- output asset registration succeeds.

### Database

- active connections stay below the configured pool and PostgreSQL limits.
- connection timeout errors are zero or transient.
- statement timeout errors are zero or explained.
- lock waits do not persist.
- migration version and expected tables are present.
- table counts match verification expectations.

### File Flows

- file register success rate remains stable.
- upload success rate remains stable.
- hash mismatch failures are expected and not elevated.
- download, preview, and thumbnail success rates remain stable.
- new `file_assets` rows are created for uploads.
- new `file_blob_variants` rows are created for previews/thumbnails when applicable.
- no surge of missing storage-object errors.

### Workflow Flows

- workflow list latency remains stable.
- workflow detail payloads match pre-cutover source.
- save/update succeeds in DB write mode.
- `workflow_file_bindings` are updated after save.
- deleting a workflow does not delete file assets.

### Execution Flows

- execution creation writes run and task rows.
- Worker can claim queued tasks.
- task events are appended in order.
- output file assets are linked through `task_file_links`.
- task history by workflow returns recent DB-mode tasks.

### Auth And Admin

- admin login succeeds.
- member login succeeds.
- refresh token rotation works.
- logout works.
- audit logs are written.
- member cannot access another member's files, workflows, executions, or tasks.
- admin API can list files, executions, workflows, users, and storage issues.

## 2. Read-Only Validation Checklist

Run with Worker stopped.

- API starts with `persistence.mode = "db"`.
- `/healthz` reports DB `ok`.
- admin can login.
- member can login.
- known workflow list returns expected count.
- known workflow detail contains expected nodes and bindings.
- known file detail returns expected metadata.
- known file download returns expected bytes or content length.
- known execution detail returns expected run/tasks.
- task events load in stable order.
- admin overview returns counters.
- admin file detail includes workflow/task usage where expected.
- admin execution detail includes input/output file links where expected.
- migration verification report is pass.

Failure in this stage should normally rollback to JSON because no DB writes should have occurred.

## 3. DB Write Enablement Checklist

Run after read-only validation passes.

- config has `persistence.mode = "db"`.
- config has `persistence.cutoverStage = "db-read-write"` if the field is used.
- API restarted and `/healthz` DB status is `ok`.
- Worker started after API validation.
- upload a small image as member.
- download the uploaded image.
- save a test workflow referencing that image.
- reload the workflow and confirm binding.
- start one low-risk execution.
- confirm run/task/event rows are created.
- confirm output file asset is created.
- confirm admin overview counters changed.
- confirm member access isolation.

## 4. Alert Thresholds

Treat these as rollback or incident-review triggers during cutover:

- API cannot start in DB mode.
- DB health remains `error` for more than 2 consecutive checks.
- known file download fails.
- admin/member login fails globally.
- migration verification critical counts mismatch.
- task claims fail continuously for more than 5 minutes.
- output file asset creation fails for completed tasks.
- storage missing-file errors increase after cutover.
- member can access another member's data.

After DB writes begin, do not automatically rollback. Use `FILE-DATABASE-ROLLBACK-GUIDE.md`.

## 5. Observation Cadence

Before switching DB writes:

- check every smoke-test step synchronously.
- record pass/fail and timestamp.

First hour after DB write mode:

- check API `/healthz` every 5 minutes.
- check Worker `/healthz` every 5 minutes.
- check DB connection and error logs every 5 minutes.
- run file/workflow/execution/admin smoke checks at least once.

First 24 hours:

- check API/Worker health every 30 minutes during active usage.
- review task failures and storage errors at least twice.
- keep JSON and storage backups unchanged.

## 6. Handoff Record

Record these values in the cutover ticket:

- cutover date and time
- operator
- config path
- final `persistence.mode`
- final `persistence.cutoverStage`
- migration report path
- verification report path
- accepted warnings
- read-only smoke result
- DB write smoke result
- rollback deadline
- first DB write timestamp
- post-cutover issues and owners
