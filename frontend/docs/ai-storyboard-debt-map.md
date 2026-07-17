# AI Storyboard Debt Map

Last updated: 2026-04-24

## Current Status

The `aiStoryboard` contractization recovery chain has closed the highest-risk leaks that originally made storyboard behavior pollute `WorkflowContext` and generic output reconcile.

Closed in this phase:

- `aiStoryboard` no longer uses a `mock` execution placeholder.
- The node definition now exposes `mode: 'node-action-only'` through `src/nodes/ai-storyboard/runtime.ts`.
- Arrange, single-shot image, single-shot video, and batch video are declared as node actions.
- `AIStoryboardNode` dispatches those actions through `actions.runNodeAction`.
- Public storyboard-specific `WorkflowContext` actions were removed.
- Storyboard arrange/image/video/batch logic lives in node-domain services and runners.
- Generic `execution-output-reconcile.service.ts` no longer contains `aiStoryboard`-specific branches.
- Storyboard output compatibility is isolated in `execution-runtime/adapters/ai-storyboard.adapter.ts`.
- Storyboard runtime-only shot fields are stripped on persistence by the workflow file normalizer.
- Storyboard resize and drop normalization now reuse shared node interaction helpers.

## Guarded User-Visible Behavior

The following capabilities remain protected by regression tests and must not be broken by future cleanup:

- intelligent storyboard arrange
- single-shot image generation
- single-shot video generation
- batch video generation
- output file-node materialization on the right side of the storyboard node
- output-link recovery after refresh
- legacy workflow hydrate and task-ref reconcile
- body, panel, and slot drop target semantics
- viewport-zoom-aware resize behavior

Primary regression coverage:

- `src/nodes/ai-storyboard/component.arrange.spec.tsx`
- `src/nodes/ai-storyboard/component.execution.spec.tsx`
- `src/nodes/ai-storyboard/component.layout.spec.tsx`
- `src/nodes/ai-storyboard/component.resize.spec.tsx`
- `src/nodes/ai-storyboard/component.sync.spec.tsx`
- `src/nodes/ai-storyboard/storyboard-current-behavior.spec.ts`
- `src/nodes/ai-storyboard/storyboard-execution-service.spec.ts`
- `src/nodes/ai-storyboard/storyboard-state-service.spec.ts`
- `src/nodes/ai-storyboard/storyboard-arrange-service.spec.ts`
- `src/nodes/ai-storyboard/storyboard-shot-image-runner.spec.ts`
- `src/nodes/ai-storyboard/storyboard-shot-video-runner.spec.ts`
- `src/nodes/ai-storyboard/storyboard-batch-video-runner.spec.ts`
- `src/nodes/ai-storyboard/storyboard-runtime-state.spec.ts`
- `src/nodes/ai-storyboard/runtime.spec.ts`
- `src/execution-runtime/adapters/ai-storyboard.adapter.spec.ts`
- `src/execution-runtime/execution-output-reconcile.service.spec.ts`

## Current Isolation Boundary

Storyboard-owned concerns now live in `src/nodes/ai-storyboard/**`:

- action declarations
- arrange service
- shot image runner
- shot video runner
- batch video runner
- state patch helpers
- execution payload helpers
- task-ref merge and committed-output lookup
- runtime-state persistence boundary
- drop and resize interaction integration

Generic output reconcile delegates storyboard compatibility through the registered execution-runtime adapter instead of hard-coding storyboard branches.

## Remaining Debt

The remaining debt is no longer a quality-gate blocker.

1. Live-provider storyboard acceptance still lacks a dated human execution record in the real UI/runtime environment.
2. `WorkflowContext.tsx` is still oversized in general, but storyboard-specific dependency binding now lives in the node action registry/facade layer instead of being assembled inline in context.
3. Frontend/backend contract convergence is still separate follow-up work and is not storyboard-specific.

Closed in the latest follow-up:

- `updateAIStoryboardShots` was replaced by the generic typed node-config mutation path.
- `node-action-only` execution payload is now a formal typed contract instead of an adapter-only placeholder shape.
- storyboard output identity normalization now lives in `storyboard-output-identity.ts` and `workflow-file-normalizer.ts`.

## Follow-Up Plan

Next cleanup should be tracked separately from the completed contractization recovery:

1. Execute the documented live storyboard acceptance flow and attach dated evidence.
2. Keep `node-action-only` payload and storyboard identity helpers reusable if another workbench node adopts the same contract.
3. Continue broader `WorkflowContext.tsx` decomposition without reintroducing storyboard-specific service assembly.

## Acceptance Result

The automated storyboard contractization scope is closed and stayed green after the 2026-04-24 rerun.

Task [12] leaves one explicit non-automated item open:

1. A human still needs to execute the live storyboard acceptance checklist and attach dated evidence.

The completed acceptance conditions are:

1. Frontend typecheck, lint, and tests pass.
2. The unified project quality gate passes.
3. `WorkflowContext` has no public storyboard-specific execution actions.
4. `execution-output-reconcile.service.ts` has no `aiStoryboard` hard-coded branch.
5. Storyboard-specific dependency wiring stays in node-domain facade/registry layers, not in `WorkflowContext`.
