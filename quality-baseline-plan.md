# Quality Baseline Recovery Plan

Last updated: 2026-04-22

## Purpose

This document records the recovery boundary, protected-path scope, and final exit state of the quality baseline restoration phase.

The recovery goal was to return the project to a sustainable development state before allowing the next phase of storyboard contractization and broader architecture governance.

## Final Recovery State

Commands were re-validated on 2026-04-22 from `D:\Project\newflow5\newworkflow2`.

| Area | Command | Result | Notes |
| --- | --- | --- | --- |
| Frontend typecheck | `npm.cmd run typecheck` in `frontend` | Pass | TypeScript compiles with `--noEmit`. |
| Frontend lint | `npm.cmd run lint` in `frontend` | Pass | Runs with `--max-warnings 0`; warning baseline is green. |
| Frontend tests | `npm.cmd test` in `frontend` | Pass | Full suite passes. Output still contains non-blocking React test-environment warning noise tracked separately. |
| Backend typecheck | `npm.cmd run typecheck` in `backend` | Pass | Runs `shared`, `api`, and `worker` typechecks. |
| Backend tests | `npm.cmd test` in `backend` | Pass | Root backend automated test entry is green. |
| Unified root gate | `powershell -ExecutionPolicy Bypass -File .\verify-quality.ps1` in `newworkflow2` | Pass | Root fail-fast gate passed end-to-end. |

## Recovery Outcome

The quality baseline recovery phase is complete.

Recovered outcomes:

- root quality gate is executable and green
- frontend typecheck, lint, and test gates are green
- backend typecheck and test gates are green
- all P0 gate blockers in `quality-baseline-issues.md` are closed
- freeze was formally lifted on 2026-04-22
- remaining work has been downgraded to tracked next-phase P1/P2 debt instead of hidden baseline drift

## Protected Paths After Freeze Lift

The temporary freeze is no longer active, but the original freeze scope remains the protected-path review scope for high-risk changes.

Frontend protected paths:

- `frontend/src/components/context/WorkflowContext.tsx`
- `frontend/src/components/context/**`
- `frontend/src/components/canvas/Canvas.tsx`
- `frontend/src/components/canvas/**`
- `frontend/src/execution-runtime/**`
- `frontend/src/services/workflow-file-normalizer.ts`
- `frontend/src/services/backendExecutionService.ts`
- `frontend/src/services/workflow-upload-scheduler.ts`
- `frontend/src/services/image/**`
- `frontend/src/nodes/ai-storyboard/**`
- `frontend/src/nodes/shared/**`

Backend protected paths:

- `backend/shared/src/**`
- `backend/api/src/modules/workflows/**`
- `backend/api/src/modules/files/**`
- `backend/api/src/modules/executions/**`
- `backend/worker/src/modules/executors/**`
- `backend/worker/src/modules/queue/**`
- `backend/worker/src/modules/providers/**`

## Operating Rules After Freeze Lift

Changes touching protected paths must still follow the baseline rules:

- reference the relevant issue ID from `quality-baseline-issues.md`, or add a new tracked issue before changing behavior
- add or update focused tests before changing observable behavior
- do not introduce `any`, `as any`, or untyped adapter escape hatches
- do not add broad `eslint-disable` comments
- do not reintroduce unbounded retry, polling, or scheduler loops
- do not add persistence fields without save, hydrate, and reload coverage
- do not change `WorkflowContext.tsx` or `Canvas.tsx` behavior without focused regression coverage

## Issue ID Scheme

Use the following prefixes in tasks, PR descriptions, and review notes:

- `QBL-FE-LINT-*`: frontend lint failures
- `QBL-FE-TEST-*`: frontend test failures
- `QBL-FE-GATE-*`: frontend gate blockers not limited to one lint/test defect
- `QBL-FE-WARN-*`: frontend warnings and runtime warning noise
- `QBL-FE-ARCH-*`: frontend architecture or boundary debt
- `QBL-FE-CANVAS-*`: canvas interaction and synchronization risks
- `QBL-FE-STORY-*`: AI storyboard isolation and execution contract debt
- `QBL-BE-GATE-*`: backend gate and test-entry risks
- `QBL-BE-TEST-*`: backend test failures or automated test debt
- `QBL-CONTRACT-*`: frontend/backend shared contract drift
- `QBL-DOC-*`: documentation or checklist gaps

## Exit Criteria

All recovery exit criteria are met as of 2026-04-22:

- all P0 items are closed
- frontend `typecheck`, `lint`, and `test` commands pass
- backend root `typecheck` and `test` commands pass
- unified root quality gate passes end-to-end
- remaining P1 and P2 debt is explicitly tracked and no longer blocks the baseline

## Final References

Use these documents as the current source of truth after recovery:

- `quality-baseline-report.md`
- `quality-baseline-issues.md`
- `quality-gate-rules.md`
- `backend/docs/backend-quality-gate.md`
- `backend/docs/type-contract-baseline.md`

