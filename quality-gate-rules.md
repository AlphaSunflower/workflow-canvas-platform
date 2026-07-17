# Quality Gate Rules

Last updated: 2026-04-22

## Required Gate

Run the project gate from `newworkflow2/`:

```powershell
.\verify-quality.ps1
```

If local PowerShell execution policy blocks direct script execution, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\verify-quality.ps1
```

Windows `cmd` equivalent:

```bat
verify-quality.cmd
```

Current fail-fast order:

1. frontend `npm run typecheck`
2. frontend `npm run lint`
3. frontend `npm test`
4. backend `npm run typecheck`
5. backend `npm test`

As of 2026-04-22, the unified root gate is green.

## Freeze Status

The temporary quality freeze used during baseline restoration was lifted on 2026-04-22.

Freeze lift evidence:

1. unified root gate passed end-to-end
2. `QBL-FE-GATE-001` was closed
3. `QBL-BE-TEST-001` was closed
4. remaining P1/P2 items were explicitly carried into the next-phase debt map

Protected paths remain high-scrutiny paths even though freeze is lifted.

## Development Admission Rules

Before changing code:

- identify whether the change touches a protected path
- identify the relevant issue ID or create one in `quality-baseline-issues.md`
- add or update tests before changing logic when behavior is observable
- document any test gap before implementation if automation is not practical

No change may introduce:

- new `any` or `as any` in production code
- broad `eslint-disable` comments
- unbounded retry or polling loops
- persistence fields without save/hydrate/reload tests
- execution payload fields without backend shared contract updates
- hidden environment-dependent tests inside default local test commands

## Core File Change Requirements

For `WorkflowContext.tsx`:

- add or update focused tests before changing persistence, execution, storyboard, or notification behavior
- prefer extracting helpers/services over adding new inline branches
- do not add new node-specific execution special cases without a debt-map entry

For `Canvas.tsx`:

- add or update focused interaction tests before changing edge, drop, drag, viewport, or resize behavior
- keep domain mutation helpers separate from React Flow event plumbing when possible
- do not rely only on manual visual verification for data-sync behavior

For backend shared contracts:

- update `backend/shared/src/types/**` first
- update API/Worker producers second
- update frontend consumers or mirror types third
- run backend typecheck and at least one targeted test that touches the changed contract

## New Node Requirements

Any new node must include:

- node type and task type ownership
- input and output handle contract
- persistence behavior for all runtime and backend resources
- execution payload contract, or explicit statement that it is not executable
- tests for drop/resize or shared interaction behavior when applicable
- documentation entry if it uses a provider, backend API, or non-standard persistence field

If the node creates backend tasks, it must use the shared execution contract instead of adding direct special cases to `WorkflowContext`.

## New Execution Path Requirements

Any new execution path must include:

- backend shared request/response type
- backend validation path
- frontend payload builder or adapter
- task history and ownership behavior
- retry and terminal-state behavior
- at least one targeted backend test
- at least one frontend test if the execution result mutates workflow state

Execution create requests must include `workflowId`. `projectId` is derived by backend from the workflow record.

## New Persistence Field Requirements

Any new workflow persistence field must include:

- save rule
- normalize rule
- hydrate rule
- reload compatibility behavior
- runtime-only cleanup behavior if applicable
- regression test that fails without the new rule

Runtime resources such as object URLs, transient thumbnails, active upload handles, abort controllers, or local browser handles must not be persisted unless explicitly documented as stable metadata.

## Backend Test Classification Rules

Backend tests are classified as:

- local automated: default `npm test`
- environment-dependent automated: `npm run test:env`
- manual/operator-assisted: `backend/tests/manual`

Do not place real-provider, real-credential, or operator-dependent checks into default `npm test`.

## Documentation Requirements

Update documentation when changing:

- shared API contract
- node execution contract
- workflow persistence format
- canvas interaction semantics
- backend test classification
- quality gate command order

Documentation must be updated in the same task as the code change.

## CI / PR Recommendation

CI or PR preflight should call one stable command:

```bat
newworkflow2\verify-quality.cmd
```

If the CI environment is PowerShell-first, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File newworkflow2\verify-quality.ps1
```

The CI job should publish logs for each failed step and should not continue after the first failure.

