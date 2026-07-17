# AI Storyboard Contractization Report

Date: 2026-04-24

## Scope

This report closes the storyboard contractization recovery chain executed after the broader quality-baseline restoration.

Covered work:

- node action contract introduction and storyboard action registration
- migration of storyboard UI actions onto `runNodeAction`
- extraction of storyboard state, arrange, image, video, and batch-video logic into node-domain services/runners
- removal of storyboard-specific public `WorkflowContext` actions
- removal of storyboard-specific generic output reconcile branches
- split of storyboard persistence cleanup from runtime-only fields
- alignment of storyboard resize/drop interaction with shared helpers
- replacement of storyboard-specific context config mutation with generic typed node-config updates
- formalization of storyboard `node-action-only` execution payload typing
- consolidation of storyboard output identity compatibility into a dedicated migration helper
- conversion of high-value storyboard contract tests from source-string matching toward behavior and contract assertions

## Delivered Outcome

### Contract Boundary

- `aiStoryboard` no longer depends on `mock` execution.
- `aiStoryboardExecution` uses `mode: 'node-action-only'`.
- Internal storyboard operations are declared in `runtime.ts` as node actions.

### UI And Orchestration

- `AIStoryboardNode` dispatches arrange, shot-image, shot-video, and batch-video through `runNodeAction`.
- Storyboard business logic now lives under `src/nodes/ai-storyboard/**`.
- `WorkflowContext` no longer exposes storyboard-specific execution APIs in its public action surface.
- `WorkflowContext` no longer assembles storyboard-specific action dependencies inline; shared services are adapted through `src/nodes/shared/node-action-service-registry.default.ts` and `src/nodes/ai-storyboard/storyboard-action-facade.ts`.

### Output And Persistence

- generic `execution-output-reconcile.service.ts` no longer contains storyboard-specific branches
- storyboard output compatibility is isolated in `execution-runtime/adapters/ai-storyboard.adapter.ts`
- persistence cleanup strips storyboard runtime-only shot state in the workflow normalization path
- old workflow payloads remain readable for backward compatibility
- storyboard task refs, reconcile lookup, and workflow hydrate now normalize identity through `storyboard-output-identity.ts`

### Test Shape Recovery

- `component.execution.spec.tsx` now validates public contract behavior and keeps only a small number of architecture smoke checks
- `component.arrange.spec.tsx` validates arrange contract and behavior without importing the full component graph
- `component.layout.spec.tsx` is reduced to a minimal shell/style smoke boundary
- `component.resize.spec.tsx` now focuses on shared resize helper behavior instead of component source matching

### Shared Interaction Alignment

- storyboard resize uses the shared zoom-aware resize helper
- storyboard drop normalization reuses the shared image drop builder
- existing body/panel/slot drop semantics were preserved

## Verified Evidence

Commands executed during the automated close-out reruns:

- `frontend`: `npm.cmd run typecheck`
- `frontend`: `npm.cmd run lint`
- `frontend`: `npm.cmd test`
- `newworkflow2`: `powershell -ExecutionPolicy Bypass -File .\verify-quality.ps1`

Latest full root-gate rerun for this close-out completed on 2026-04-24.

Focused storyboard regressions also passed during the implementation chain:

- `component.arrange.spec.js`
- `component.execution.spec.js`
- `component.layout.spec.js`
- `component.sync.spec.js`
- `component.resize.spec.js`
- `runtime.spec.js`
- `storyboard-execution-service.spec.js`
- `workflow-file-normalizer.spec.js`
- `ai-storyboard.adapter.spec.js`
- `execution-output-reconcile.service.spec.js`

Latest focused rerun on 2026-04-24:

- `frontend`: `npm.cmd test -- src/nodes/ai-storyboard/component.execution.spec.tsx src/nodes/ai-storyboard/component.arrange.spec.tsx src/nodes/ai-storyboard/component.layout.spec.tsx src/nodes/ai-storyboard/component.resize.spec.tsx`

## Manual Review Checklist

Manual review status for this phase:

- arrange: code path and regression coverage verified
- single-shot image: code path and regression coverage verified
- single-shot video: code path and regression coverage verified
- batch video: code path and regression coverage verified
- output connection materialization: code path and regression coverage verified
- refresh-time output recovery: code path and regression coverage verified

No separate live-provider manual click-through was executed in this terminal task. Runtime safety is backed by automated regression coverage and gate verification, while real UI/provider acceptance remains pending in `frontend/docs/ai-storyboard-live-acceptance.md`.

## Remaining Follow-Up

The following items remain tracked debt, not acceptance blockers for this phase:

- live provider/browser acceptance is not yet recorded as completed
- broader `WorkflowContext.tsx` size and hook-boundary simplification still belong to next-phase architecture work

These items remain tracked in:

- `frontend/docs/ai-storyboard-debt-map.md`
- `quality-baseline-issues.md`

## Conclusion

The storyboard contractization recovery phase is accepted for its automated contract scope.

`aiStoryboard` is no longer a public `WorkflowContext` feature branch, no longer depends on mock execution, no longer rebuilds storyboard-specific dependency wiring inside context, and no longer pollutes the generic output reconcile path. Remaining debt is narrowed to pending live acceptance and broader non-storyboard architecture cleanup, rather than hidden contract gaps. `QBL-FE-STORY-105` remains open until the live acceptance record is executed by a human in a real browser/provider environment.
