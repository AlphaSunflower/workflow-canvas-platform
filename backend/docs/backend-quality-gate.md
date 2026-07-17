# Backend Quality Gate

## Unified Entry

Backend quality checks now use the backend root commands:

- `npm run typecheck`
- `npm test`
- `npm run verify`

Project root quality gate also calls these commands through `newworkflow2/verify-quality.ps1`.

## Automated Test Split

Current backend test categories are split into three buckets:

### 1. Local Automated

Command:

- `npm test`
- `npm run test:local`

Scope:

- `backend/tests/**/*.spec.ts`
- `backend/api/src/**/*.spec.ts`
- `backend/worker/src/**/*.spec.ts`
- `backend/shared/src/**/*.spec.ts`

Characteristics:

- must run locally without real third-party provider credentials
- may start ephemeral in-process API or Worker instances
- may use temp directories, fake configs, fake fetch implementations, and local file storage
- must fail the quality gate when any case fails

Execution model:

- backend tests are compiled to a temporary ESM output first
- compiled test files are then executed sequentially
- sequential execution is intentional to reduce port, temp-file, and process-env cross-test pollution

### 2. Environment-Dependent Automated

Reserved command:

- `npm run test:env`

Current status:

- no backend `.spec.ts` files are currently classified into this bucket

Admission rule:

- only add a test here if it requires external infrastructure, real service credentials, or non-local operator-provided runtime dependencies
- do not silently mix such tests into `npm test`

### 3. Manual / Operator-Assisted

Current location:

- `backend/tests/manual/*.md`

Examples:

- real RunningHub scheduling checklist
- real AI image-to-ply checklist
- real AI multi-view restore checklist
- real white-model render checklist

Rules:

- these checks are not part of `npm test`
- they must stay documented as manual acceptance paths unless converted into stable automated tests

## Gate Contract

`npm run verify` is the backend-side stable contract for CI or PR gate integration:

1. backend `typecheck`
2. backend `test`

Failure in either step must fail the backend gate.

## Operational Notes

- Use `npm run test:list` to inspect the current local automated test inventory.
- Use `BACKEND_TEST_FILE=<file>` or `--file <file>` to run a single backend test through the unified runner.
- New backend tests should default to the local automated bucket unless there is a concrete external dependency that cannot be mocked or isolated.
