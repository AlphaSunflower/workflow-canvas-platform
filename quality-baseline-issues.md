# Quality Baseline Issue Ledger

Last updated: 2026-04-24

## Status Legend

- `open`: confirmed and not fixed
- `blocked`: cannot proceed until another issue is resolved
- `closed`: fixed and verified
- `deferred`: intentionally moved out of this recovery phase with rationale

## Priority Legend

- `P0`: blocks quality gate or can corrupt persisted/runtime behavior
- `P1`: high-risk source warning, architectural leak, or fragile interaction path
- `P2`: cleanup, test noise, or documentation gap that should not block P0 recovery

## Current Gate Summary

| Gate | Status | Evidence |
| --- | --- | --- |
| Frontend typecheck | Pass | `npm.cmd run typecheck` in `frontend` passes on 2026-04-24. |
| Frontend lint | Pass | `npm.cmd run lint` in `frontend` passes on 2026-04-24. |
| Frontend tests | Pass | `npm.cmd test` in `frontend` passes on 2026-04-24. |
| Backend typecheck | Pass | `npm.cmd run typecheck` in `backend` passes on 2026-04-24 and stays green inside the unified root gate rerun. |
| Backend tests | Pass | `npm.cmd test` in `backend` passes on 2026-04-24; one earlier root-gate attempt hit a transient `execution.e2e.spec.ts` wait-timeout before the immediate rerun passed. |
| Unified root gate | Pass | `powershell -ExecutionPolicy Bypass -File .\verify-quality.ps1` passes on 2026-04-24 after the storyboard close-out documentation sync. |

## P0 Issues

| ID | Area | Status | Evidence | Required Outcome |
| --- | --- | --- | --- | --- |
| QBL-FE-TEST-001 | Frontend persistence test failure | closed | Persistence boundary and regression matrix were restored; frontend full test baseline passes. | Keep image/video/local/remote/runtime resource boundaries covered. |
| QBL-FE-LINT-001 | `WorkflowContext` unbounded retry loop | closed | Replaced during baseline recovery work. | Keep retry logic bounded and observable. |
| QBL-FE-LINT-002 | `WorkflowContext` unsafe execution commit typing | closed | Execution commit path was isolated and typed. | Keep payload adaptation behind typed helpers. |
| QBL-FE-LINT-003 | Backend execution response loose branded string typing | closed | Backend execution payload typing was corrected during lint recovery. | Keep execution request and response strings contract-based. |
| QBL-FE-LINT-004 | File export control regex lint failure | closed | Sanitizer implementation was made lint-compliant. | Preserve compliant implementation. |
| QBL-FE-LINT-005 | Image cache spec mutable binding | closed | Test binding cleanup completed. | Keep test code aligned with lint expectations. |
| QBL-FE-LINT-006 | Workflow upload scheduler constant condition | closed | Replaced during bounded retry recovery. | Do not reintroduce unbounded scheduler loops. |
| QBL-FE-LINT-007 | Async pool constant condition | closed | Replaced during bounded retry recovery. | Do not reintroduce unbounded async loops. |
| QBL-FE-LINT-008 | Canvas image performance unused variables | closed | Unused values were removed or normalized during lint recovery. | Keep performance helpers warning-clean. |
| QBL-FE-GATE-001 | Frontend lint warning gate still red | closed | `npm.cmd run lint` in `frontend` passes on 2026-04-22 under `--max-warnings 0`. | Keep frontend lint green under the real project command. |
| QBL-BE-TEST-001 | Backend full automated test gate still red | closed | `npm.cmd test` in `backend` passes on 2026-04-22 and is included in the root gate. | Keep backend full-test baseline green. |

## P1 Issues

| ID | Area | Status | Evidence | Required Outcome |
| --- | --- | --- | --- | --- |
| QBL-FE-WARN-001 | `Canvas` Hook dependency risk | open | High-risk canvas source still deserves follow-up simplification even though gate is green. | Resolve remaining Hook fragility before larger canvas changes. |
| QBL-FE-WARN-002 | `WorkflowContext` Hook dependency risk | open | High-risk runtime orchestration still deserves follow-up simplification even though gate is green. | Resolve remaining Hook fragility before larger runtime changes. |
| QBL-FE-WARN-003 | `CanvasImageRasterLayer` Hook dependency risk | open | Raster-layer dependency management remains a high-risk area for future refactors. | Stabilize dependency and rendering boundaries before broader image-runtime changes. |
| QBL-FE-ARCH-001 | Oversized context boundary | open | `WorkflowContext.tsx` remains oversized and should not continue accumulating responsibilities. | Extract focused helpers/services over time. |
| QBL-FE-ARCH-002 | Oversized canvas boundary | open | `Canvas.tsx` remains oversized and should not continue accumulating responsibilities. | Extract focused helpers/services over time. |
| QBL-FE-STORY-001 | AI storyboard bypasses node execution contract | closed | `aiStoryboardExecution` now uses `mode: 'node-action-only'`; storyboard actions are declared in `src/nodes/ai-storyboard/runtime.ts` and dispatched by `runNodeAction`. | Keep storyboard internal actions declared through the node definition. |
| QBL-FE-STORY-002 | AI storyboard execution orchestration still lives in `WorkflowContext` | closed | Storyboard arrange/image/video/batch business logic moved to node-domain services and runners; `WorkflowContext` keeps only thin shared-service injection. | Do not reintroduce public storyboard-specific context actions. |
| QBL-FE-STORY-003 | AI storyboard runtime adapter only participates in output commit | closed | `ai-storyboard.adapter.ts` now exposes a node-action-only execution payload boundary instead of rejecting generic payload creation. | Keep generic launch compatibility explicit for node-action-only nodes. |
| QBL-FE-STORY-004 | AI storyboard persisted config mixes business data with runtime execution state | closed | `storyboard-runtime-state.ts` and `workflow-file-normalizer.ts` define and strip runtime-only storyboard shot fields during persistence while preserving legacy hydrate compatibility. | Keep new runtime fields out of persisted storyboard payloads unless explicitly documented and tested. |
| QBL-FE-STORY-005 | AI storyboard output routing still depends on compatibility special casing | closed | Generic output reconcile no longer contains `aiStoryboard` branches; storyboard compatibility lives in `execution-runtime/adapters/ai-storyboard.adapter.ts`. | Keep node-specific output compatibility inside the node adapter, not the generic reconcile service. |
| QBL-FE-STORY-101 | AI storyboard context service-injection adapter remains | closed | `WorkflowContext.tsx` now passes only shared node-action infrastructure; storyboard-specific dependency mapping moved into `src/nodes/shared/node-action-service-registry.default.ts` and `src/nodes/ai-storyboard/storyboard-action-facade.ts`. | Keep storyboard-specific service binding inside node-domain facade/registry layers rather than rebuilding it in `WorkflowContext`. |
| QBL-FE-STORY-102 | AI storyboard shot sync still uses a context bridge | closed | `WorkflowContextActions` now exposes generic `patchNodeConfig`; `src/nodes/shared/node-config-updater.ts`, `AIStoryboardNode`, and `storyboard-state-service.ts` use the typed config update path and production source no longer exposes `updateAIStoryboardShots`. | Keep storyboard config mutation on the generic typed node-config protocol. |
| QBL-FE-STORY-103 | Node-action-only adapter payload is still compatibility shaped | closed | `execution-runtime/node-action-only-execution.ts` defines the formal payload shape; `ai-storyboard.adapter.ts` returns `ExecutionRuntimeNodeActionOnlyExecutionPayload`, and storyboard runners submit `executionMode: 'node-action-only'` under tests. | Keep workbench/node-action-only execution payloads explicit and typed. |
| QBL-FE-STORY-104 | AI storyboard output identity remains compatibility mapped | closed | `storyboard-output-identity.ts` formalizes `groupId` / `outputHandle` / `taskType`; adapter, normalizer, and reconcile paths normalize legacy refs through one migration layer instead of ad hoc guesses. | Keep storyboard output identity compatibility isolated in the dedicated helper and normalizer. |
| QBL-FE-CANVAS-001 | Edge removal lacks explicit domain gate | closed | Focused canvas edge removal regression coverage exists and passes. | Keep edge/data sync changes behind tests. |
| QBL-FE-CANVAS-002 | Drop target hit testing depends on DOM top element | closed | Focused drop target regression coverage exists and passes. | Keep hit-testing changes behind regression coverage. |
| QBL-FE-CANVAS-003 | Node resize uses screen delta without viewport zoom normalization | closed | Shared resize interaction helper and tests exist and pass. | Keep resize logic centralized and zoom-aware. |
| QBL-CONTRACT-001 | Frontend mirrors backend API contracts locally | open | Frontend still contains mirror contract definitions in service-local types. | Reduce drift by converging on shared/generated contract artifacts. |

## P2 Issues

| ID | Area | Status | Evidence | Required Outcome |
| --- | --- | --- | --- | --- |
| QBL-FE-WARN-101 | Test return type warning noise | closed | Test-specific lint boundary split was added during baseline recovery. | Keep test-only warning policy separate from production source rules. |
| QBL-FE-WARN-102 | React test environment warning noise | open | Frontend tests still print repeated `ReactDOMTestUtils.act` deprecation and unsupported `act(...)` warnings during final re-run. | Track separately so real test failures remain visible. |
| QBL-FE-STORY-105 | AI storyboard live manual acceptance record is still pending | open | `frontend/docs/ai-storyboard-live-acceptance.md` was created on 2026-04-24, but no real browser/provider click-through was executed in this terminal-only task. | Execute the documented live storyboard acceptance flow and record dated evidence before calling live acceptance complete. |
| QBL-BE-GATE-001 | Backend automated tests are not wired into root gate | closed | Backend root test entry exists, is documented, and is wired into the unified gate. | Keep test classification and root entry stable. |
| QBL-DOC-001 | Backend tests README has encoding/legibility issues | closed | Backend test documentation is readable and current. | Keep backend test docs updated with gate status. |
| QBL-DOC-002 | Root checklist has encoding/legibility issues and outdated backend assumptions | open | `checklist.md` still contains legacy/encoding cleanup debt. | Replace or normalize legacy checklist content without mixing it with gate logic. |

## Change Tracking Rules

- Every protected-path change should reference at least one issue ID from this file, or add a new one before behavior changes.
- If a task discovers a new blocker, add a new issue ID before fixing it.
- If an issue is reclassified, update priority and rationale in the same change.
- Do not close an issue until relevant command or test evidence is recorded.

## Final References

Current baseline status and long-term rules are maintained in:

- `quality-baseline-report.md`
- `quality-gate-rules.md`

## Phase Transition Rule

- Task [27] is accepted because the unified root gate now passes end-to-end.
- Protected-path freeze was lifted on 2026-04-22 after `QBL-FE-GATE-001` and `QBL-BE-TEST-001` were closed.
- Remaining P1 and P2 items are next-phase tracked debt and are no longer baseline blockers.
