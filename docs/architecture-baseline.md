# Architecture Baseline

This document records the current architecture baseline after the quality-gate rollout and the frontend cycle-governance follow-up delivered by Tasks `2-1` through `2-6` and `R6`.

## Status

- capture date: `2026-04-29`
- mode: blocking for stabilized rule categories and for frontend runtime or mixed cycles; report-only for remaining type-only frontend cycles
- verify gate: frontend/backend `verify` include architecture checks
- objective: preserve cleaned layer boundaries, block runtime-relevant cycle regressions, and avoid over-splitting contracts only to chase type-only cycle counts

## Report Entrypoints

- frontend: `npm --prefix ./frontend run arch:report`
- frontend blocking: `npm --prefix ./frontend run arch:check`
- backend: `npm --prefix ./backend run arch:report`
- backend blocking: `npm --prefix ./backend run arch:check`

`arch:report` emits JSON for diagnostics. `arch:check` uses the same scanner in enforce mode and exits non-zero on blocking violations.

Frontend enforce-mode policy:

- fail on reverse dependency violations
- fail on cross-layer violations
- fail on `runtimeCycles`
- fail on `mixedCycles`
- allow existing `typeOnlyCycles` until they can be simplified without harming clarity

## Baseline Capture Procedure

1. Run the frontend architecture report.
2. Run the backend architecture report.
3. Save the JSON output into the task log or PR notes for comparison.
4. Compare future task results against:
   - reverse dependency count
   - cross-layer violation count
   - shared package penetration count
   - `runtimeCycles`
   - `mixedCycles`
   - `typeOnlyCycles`
   - enforce-mode pass/fail state

Cycle governance priority:

- `runtimeCycles`: primary refactor target because they can affect module initialization order, hidden side effects, and runtime behavior.
- `mixedCycles`: secondary target because they contain at least one runtime edge and often hide barrel or singleton coupling.
- `typeOnlyCycles`: tertiary target; clean up opportunistically when simplifying contracts, but do not over-split only to chase the total cycle number.

## Current Baseline

### Frontend

- files scanned: `433`
- reverse dependency violations: `0`
- cross-layer violations: `0`
- dependency cycles: `3`
- runtime cycles: `0`
- mixed cycles: `0`
- type-only cycles: `3`
- orphan candidates: `1`

Blocking-gate status:

- `npm --prefix ./frontend run arch:check`: passing
- scanner classifies `src/nodes/**/*.tsx` as node UI adapter surface, which avoids false positives on renderer files
- test files are excluded before production-layer classification
- cycle reporting distinguishes runtime, type-only, and mixed cycles
- `arch:check` now blocks new frontend runtime or mixed cycles while still allowing the current type-only backlog

#### Frontend Cycle Classification Baseline

Primary governance priority: type-only cycles only

1. `src/types/ai.types.ts`
   `src/types/execution-task-ref.types.ts`
   `src/types/node.types.ts`
   `src/types/task.types.ts`
   - classification: `type-only`
   - priority: `low`
   - relation counts: `runtime=0`, `typeOnly=5`, `hybrid=0`

2. `src/execution-runtime/execution-runtime.types.ts`
   `src/types/ai.execution.types.ts`
   `src/types/index.ts`
   - classification: `type-only`
   - priority: `low`
   - relation counts: `runtime=0`, `typeOnly=3`, `hybrid=0`

3. `src/execution-runtime/execution-output-commit.types.ts`
   `src/execution-runtime/node-execution-adapter.types.ts`
   - classification: `type-only`
   - priority: `low`
   - relation counts: `runtime=0`, `typeOnly=2`, `hybrid=0`

Remaining non-blocking hotspot signals:

- no current frontend cycle includes a root barrel participant such as `src/services/index.ts` or `src/nodes/index.ts`
- no current frontend cycle includes a singleton service participant
- no current frontend runtime cycle remains
- no current frontend mixed cycle remains
- Task `2-2` removed the former `src/services/protected-resource.ts <-> src/services/protected-resource-pool.ts` mixed cycle by extracting shared contracts into `src/services/protected-resource.types.ts`
- Task `2-3` removed execution-runtime default adapter registration side effects from `src/execution-runtime/index.ts` and moved them into `src/execution-runtime/register-default-execution-runtime-adapters.ts`, with explicit composition from `WorkflowProvider`
- Task `2-4` removed the `backendFileService.ts / workflow-upload-scheduler.ts / workflow-upload-scheduler.types.ts` mixed cycle by extracting upload contracts and hash helpers
- Task `2-5` removed the `src/utils/node/id.ts <-> src/utils/node/node-id-allocator.ts` runtime cycle by extracting shared node-id primitives
- Task `2-6` removed the utils runtime cycle around `src/nodes/shared/connection.ts`, `src/utils/node/create.ts`, `src/utils/validators/*`, and `src/utils/workflow/runtime.ts` by replacing internal barrel backflow with leaf imports
- Task `R6` removed the last remaining non-type-only frontend cycle in the storyboard node domain by extracting `StoryboardNodeActionServices` into `src/nodes/ai-storyboard/storyboard-action.contracts.ts`, so `runtime.ts` no longer depends on the action-facade implementation file
- current orphan candidate remains `src/components/context/useExecutionRuntime.ts`

### Backend

#### API

- files scanned: `87`
- cross-layer violations: `0`
- `shared/src/**` penetration violations: `0`
- dependency cycles: `0`

Blocking-gate status:

- `npm --prefix ./backend run arch:check`: passing
- execution/task record types were extracted from `executions.repository.ts` into `execution-records.types.ts`
- the former repository cycle between executions and workflow task history is removed

#### Worker

- files scanned: `50`
- `shared/src/**` penetration violations: `0`
- dependency cycles: `0`

Blocking-gate status:

- `npm --prefix ./backend run arch:check`: passing
- worker shared-boundary violations remain cleared after Task 9
- no worker cycles are currently detected

## Baseline Interpretation

- frontend blocking violations identified in Task 1 remain cleared.
- frontend cycle governance has cleared all current `runtimeCycles` and `mixedCycles`; follow-up should only opportunistically simplify the three type-only cycles when related contract work already justifies it.
- backend previously blocking debt remains zero for the categories enforced by Task 12.
- the baseline is now both a comparison point and the basis of the active quality gate.

## Exit Criteria For This Baseline Phase

- every team member can run stable architecture reports and blocking checks locally
- `verify` fails when new stabilized architecture violations are introduced
- cycle follow-up work is judged by whether `runtimeCycles` and `mixedCycles` stay at zero without reopening cleared layer-boundary violations
