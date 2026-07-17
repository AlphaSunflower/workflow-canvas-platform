# Quality Baseline Recovery Report

Last updated: 2026-04-24

## Executive Summary

The quality baseline recovery phase is complete.

The follow-up `aiStoryboard` contractization recovery chain is complete for its automated-contract scope, with one remaining manual acceptance record still pending.

Final verified outcomes:

- unified project quality gate exists at `newworkflow2/verify-quality.ps1` and `newworkflow2/verify-quality.cmd`
- frontend `typecheck`, `lint`, and `test` are green
- backend `typecheck` and `test` are green
- root fail-fast gate is green
- `QBL-FE-GATE-001` and `QBL-BE-TEST-001` are closed
- `QBL-FE-STORY-101` through `QBL-FE-STORY-104` are closed
- protected-path freeze was lifted in a controlled manner on 2026-04-22
- `aiStoryboard` no longer depends on mock execution or public storyboard-specific `WorkflowContext` actions
- storyboard output compatibility is isolated in its execution-runtime adapter instead of generic output reconcile
- storyboard tests now rely primarily on behavior/contract assertions instead of large source-string matching suites

This phase converted the project from implicit, partially broken quality status into an explicit, executable, and currently green quality system.

## Task 27 Acceptance Result

Original final acceptance was executed on 2026-04-22 from `newworkflow2/`.

Latest storyboard close-out re-verification was executed on 2026-04-24 from the same root gate.

Verified commands:

- `npm.cmd run typecheck` in `frontend`
- `npm.cmd run lint` in `frontend`
- `npm.cmd test` in `frontend`
- `npm.cmd run typecheck` in `backend`
- `npm.cmd test` in `backend`
- `powershell -ExecutionPolicy Bypass -File .\verify-quality.ps1` in `newworkflow2`

Result: accepted.

Current gate status:

| Gate | Status | Notes |
| --- | --- | --- |
| Frontend typecheck | Pass | Re-verified on 2026-04-24. |
| Frontend lint | Pass | Re-verified on 2026-04-24 under `--max-warnings 0`. |
| Frontend tests | Pass | Full `npm.cmd test` re-passes on 2026-04-24. Output still contains tracked non-blocking React test-environment warning noise. |
| Backend typecheck | Pass | `backend` root `npm.cmd run typecheck` re-passes on 2026-04-24. |
| Backend tests | Pass | `backend` root `npm.cmd test` re-passes on 2026-04-24. One earlier 2026-04-24 rerun hit a transient timeout before the immediate rerun passed. |
| Unified root gate | Pass | `verify-quality.ps1` re-passes end-to-end on 2026-04-24. |

Conclusion:

- the project has returned to a sustainable quality baseline
- temporary protected-path freeze is lifted
- remaining work is tracked as next-phase P1/P2 debt, not as baseline blockers

## Work Completed

### Quality Gate And Baseline Tracking

- Added and stabilized the unified project verification entry.
- Wired backend tests into the root quality gate.
- Established root fail-fast verification order.
- Published baseline issue ledger, plan, report, and rules.
- Re-ran full gate and recorded final acceptance evidence.

### Frontend Stability

- Restored workflow persistence resource boundaries for image, video, local, remote, and runtime resources.
- Added persistence resource boundary documentation and regression tests.
- Cleared original frontend lint hard failures and then reduced warnings to zero under the real project lint command.
- Added focused regression coverage for canvas edge removal, drop target hit testing, node resize behavior, runtime visual state, and hydration boundaries.
- Isolated AI storyboard execution helper logic behind dedicated service/shared layers.
- Cleaned Fast Refresh boundary violations and console-based diagnostics warnings without changing runtime behavior.

### AI Storyboard Contractization

- Replaced storyboard mock execution with a `node-action-only` execution boundary.
- Added the generic node action contract and registered storyboard `arrange`, `shot-image`, `shot-video`, and `batch-video` actions.
- Migrated storyboard UI buttons to `runNodeAction`.
- Moved storyboard arrange, single-shot image, single-shot video, batch-video, state patching, and runtime-state cleanup into `src/nodes/ai-storyboard/**`.
- Removed public storyboard-specific execution actions from `WorkflowContextActions`.
- Removed storyboard-specific hard-coded branches from generic execution output reconcile.
- Isolated storyboard output compatibility in `execution-runtime/adapters/ai-storyboard.adapter.ts`.
- Aligned storyboard resize and drop behavior with shared node interaction helpers.
- Replaced storyboard-specific context config mutation with the generic typed node-config update path.
- Formalized storyboard `node-action-only` execution payload typing and normalized output identity compatibility through dedicated helpers.
- Reduced `component.execution/arrange/layout/resize` tests to mostly behavior and contract assertions, keeping only small architecture smoke checks.
- Added `frontend/docs/ai-storyboard-contractization-report.md`.
- Added `frontend/docs/ai-storyboard-live-acceptance.md`.

### Backend Quality

- Added backend root `npm test`, `npm run test:local`, `npm run test:env`, `npm run test:list`, and `npm run verify`.
- Added backend quality-gate documentation and shared type-contract baseline documentation.
- Rebuilt backend test fixtures around current workflow-scoped execution contracts.
- Restored backend test compatibility with current helper signatures and queue/store input contracts.
- Re-ran backend root `typecheck` and `test` to confirm green status.

## Final Baseline Evidence

Original baseline-restore acceptance commands on 2026-04-22:

- `frontend`: `npm.cmd run typecheck`
- `frontend`: `npm.cmd run lint`
- `frontend`: `npm.cmd test`
- `backend`: `npm.cmd run typecheck`
- `backend`: `npm.cmd test`
- `newworkflow2`: `powershell -ExecutionPolicy Bypass -File .\verify-quality.ps1`

Latest full close-out rerun on 2026-04-24:

- `frontend`: `npm.cmd run typecheck`
- `frontend`: `npm.cmd run lint`
- `frontend`: `npm.cmd test`
- `backend`: `npm.cmd run typecheck`
- `backend`: `npm.cmd test`
- `newworkflow2`: `powershell -ExecutionPolicy Bypass -File .\verify-quality.ps1`

Latest storyboard test-shape close-out command on 2026-04-24:

- `frontend`: `npm.cmd test -- src/nodes/ai-storyboard/component.execution.spec.tsx src/nodes/ai-storyboard/component.arrange.spec.tsx src/nodes/ai-storyboard/component.layout.spec.tsx src/nodes/ai-storyboard/component.resize.spec.tsx`

Latest storyboard service-registry close-out commands on 2026-04-24:

- `frontend`: `npm.cmd run typecheck`
- `frontend`: `npm.cmd run lint`
- `frontend`: `npm.cmd test -- --runInBand src/nodes/shared/node-action-service-registry.spec.ts src/nodes/ai-storyboard/storyboard-action-facade.spec.ts src/nodes/ai-storyboard/runtime.spec.ts src/nodes/ai-storyboard/component.execution.spec.tsx src/nodes/ai-storyboard/storyboard-execution-service.spec.ts`

Observed non-blocking output during the final run:

- frontend tests still print React `act(...)` environment warnings in some suites
- frontend and backend tests print intentional diagnostic and permission/backpressure logs from mocked scenarios
- these outputs do not change exit codes and are tracked separately as non-P0 debt

Observed gate stability note during the 2026-04-24 rerun:

- one earlier root-gate attempt hit `RUN_WAIT_TIMEOUT:<runId>:processing` in `backend/tests/execution.e2e.spec.ts`
- immediate rerun of `backend` `npm.cmd test` passed
- immediate rerun of `verify-quality.ps1` also passed
- treat this as residual backend timing sensitivity to monitor, not as a current storyboard blocker

## Remaining Debt

### P1 / High Risk Follow-Up

- `QBL-FE-WARN-001`: `Canvas` Hook dependency risk
- `QBL-FE-WARN-002`: `WorkflowContext` Hook dependency risk
- `QBL-FE-WARN-003`: `CanvasImageRasterLayer` Hook dependency risk
- `QBL-FE-ARCH-001`: oversized `WorkflowContext.tsx` boundary
- `QBL-FE-ARCH-002`: oversized `Canvas.tsx` boundary
- `QBL-CONTRACT-001`: frontend still mirrors backend API contracts locally instead of consuming a shared/generated contract artifact

### P2 / Cleanup

- `QBL-FE-WARN-102`: React test environment warning noise remains
- `QBL-FE-STORY-105`: storyboard live manual acceptance record is still pending
- `QBL-DOC-002`: root checklist still contains encoding and legacy-content cleanup debt

## Not Included In This Recovery

- full decomposition of `WorkflowContext.tsx`
- full decomposition of `Canvas.tsx`
- CI/PR platform integration
- generated frontend client or shared package import pipeline
- manual real-provider acceptance automation
- real human execution of the storyboard live-acceptance checklist

## Freeze Status

Protected-path freeze was lifted on 2026-04-22 after the following conditions were satisfied:

1. unified root gate passed end-to-end
2. `QBL-FE-GATE-001` was closed
3. `QBL-BE-TEST-001` was closed
4. remaining P1/P2 items were explicitly carried into the next-phase debt set

The freeze lift does not remove review rigor on protected paths. It only ends the temporary no-feature restriction that was in place during baseline restoration.

## Next-Phase Boundary

The next phase may proceed with:

- live storyboard browser/provider acceptance execution and evidence capture
- `WorkflowContext.tsx` decomposition
- `Canvas.tsx` decomposition
- contract convergence between frontend local mirrors and backend shared types
- cleanup of test-environment warning noise
- documentation and checklist legibility cleanup

These items are no longer baseline blockers, but they remain high-value follow-up work and must stay issue-tracked.
