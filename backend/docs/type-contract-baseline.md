# Type Contract Baseline

## Scope

This baseline defines the minimum contract alignment required between:

- backend `shared` API types
- backend API/Worker runtime responses
- frontend request and response handling
- root quality gate expectations

## Current Baseline Status

As of 2026-04-22:

- backend root `npm run typecheck` passes
- backend root `npm test` is part of the unified quality gate
- frontend and backend both rely on the backend `shared` package as the contract source for backend-owned API shapes
- several frontend files still keep local mirror types for backend payloads, which is technical debt and must not drift from the shared contract

## Contract Source Of Truth

Backend-owned API contracts must be defined in:

- `backend/shared/src/types/api/executions.ts`
- `backend/shared/src/types/api/execution-query.ts`
- `backend/shared/src/types/api/workflows.ts`
- `backend/shared/src/types/api/auth.ts`
- `backend/shared/src/types/api/files.ts`

Re-exports must stay available from:

- `backend/shared/src/index.ts`

## Required Execution Contract Rules

For `CreateExecutionRequest`:

- `workflowId` is required for all execution-create requests
- `projectId` is not part of the execution-create request payload
- `projectId` is derived by backend from the persisted workflow record
- `nodeId` and `nodeTitle` may be omitted by callers, but backend should preserve them when provided

Reason:

- execution ownership, workflow-task history, and worker reconciliation all depend on a persisted workflow identity

## Required Workflow Contract Rules

For workflow payloads:

- `projectId` remains required in workflow create and update payloads
- `workflowId` is a route identity, not a required field inside `WorkflowPayload`
- workflow list/detail response shapes must stay aligned with frontend hydration logic

## Health Response Contract Rules

Health endpoints are backend-owned typed responses:

- API `GET /healthz` returns `ApiHealthResponseData`
- Worker `GET /healthz` returns `WorkerSchedulingHealthResponseData`

These responses are operational contracts and must be updated in shared types when fields change.

## Envelope Contract Rules

JSON API envelope shape is:

- `code`
- `message`
- optional `error`
- optional `data`
- `timestamp`

This shape is now explicitly documented as `ApiEnvelope<T>` in backend shared types.

## Quality Gate Standard

Frontend and backend now follow the same gate principle:

1. typecheck must pass
2. automated checks included in the gate must be executable through a single stable root command
3. failures must fail the unified gate immediately
4. production contract changes must update shared type definitions and at least one verification path

## Regression Expectations For Contract Changes

When changing shared API contracts:

- update backend `shared` source types first
- update backend runtime producers second
- update frontend consumers or mirror types third
- run backend `npm run typecheck`
- run at least one targeted backend test or verification command touching the changed contract

## Current Debt

- frontend still contains duplicated workflow and execution payload mirror types in service files
- API envelope is not yet fully imported from backend shared types on the frontend side
- root unified gate is still red because frontend lint warnings and backend test type debt remain unresolved
