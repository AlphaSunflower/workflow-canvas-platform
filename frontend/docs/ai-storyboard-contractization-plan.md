# AI Storyboard Contractization Plan

Last updated: 2026-04-23

## Purpose

This document now records the executed contractization path and the remaining follow-up scope for `aiStoryboard`.

The completed recovery phase focused on:

- moving storyboard business logic back under `src/nodes/ai-storyboard/**`
- replacing public storyboard-specific context actions with generic node actions
- removing storyboard branches from the generic output reconcile path
- separating persisted storyboard fields from runtime-only shot state in the save path
- aligning storyboard interaction behavior with shared node resize and drop helpers

## What Is Already Done

### Node Contract

- `src/nodes/ai-storyboard/index.tsx` registers `actions: aiStoryboardNodeActions`
- `src/nodes/ai-storyboard/runtime.ts` declares `arrange`, `shot-image`, `shot-video`, and `batch-video`
- `aiStoryboardExecution` now uses `mode: 'node-action-only'`

### UI Dispatch

- `src/nodes/ai-storyboard/component.tsx` dispatches all internal operations through `actions.runNodeAction(...)`
- storyboard-specific public `WorkflowContext` execution actions are gone

### Node-Domain Services

- `storyboard-state-service.ts`
- `storyboard-arrange-service.ts`
- `storyboard-shot-image-runner.ts`
- `storyboard-shot-video-runner.ts`
- `storyboard-batch-video-runner.ts`
- `storyboard-runtime-state.ts`

These files now own storyboard-specific arrange, execution, state patching, and runtime/persistence boundary rules.

### Output Commit And Reconcile

- generic `execution-output-reconcile.service.ts` no longer contains storyboard-specific business fallback branches
- `execution-runtime/adapters/ai-storyboard.adapter.ts` carries storyboard compatibility behavior where needed
- task refs persist `outputHandle`, `groupId`, and `taskType`

### Shared Interaction Alignment

- storyboard resize uses `useNodeResizeInteraction`
- resize is viewport-zoom aware
- storyboard drop normalization reuses the shared drop-config builder

## Current Boundary

Current architecture after the recovery phase:

- `AIStoryboardNode` owns storyboard UI and dispatches generic node actions
- `runtime.ts` owns action declarations and node-action-only execution boundary
- node-domain services/runners own storyboard business logic
- `WorkflowContext` provides thin shared orchestration and service injection
- execution-runtime adapter owns storyboard-specific output compatibility behavior

This means storyboard is no longer a free-form `WorkflowContext` feature branch, but it is not yet fully independent from context-provided shared execution services.

## Remaining Tracked Debt

- `QBL-FE-STORY-101`: thin storyboard orchestration/service injection was moved out of `WorkflowContext` into the node action registry/facade layer on 2026-04-24
- `QBL-FE-STORY-102`: storyboard shot sync still uses a context bridge
- `QBL-FE-STORY-103`: `node-action-only` launch compatibility still relies on a fallback adapter payload
- `QBL-FE-STORY-104`: output identity now maps `shot.id` group ids to per-shot output handles; legacy `group-1:result` remains only as a compatibility anchor for old saved edges

## Explicit Non-Goals

This completed phase does not attempt:

- full removal of all storyboard mentions from `WorkflowContext.tsx`
- conversion of storyboard media generation onto a generic `buildGroupPlans/createExecutionPayload` path
- redesign of storyboard output identity semantics
- deletion of old persisted storyboard execution fields from legacy workflow payloads

## Exit Criteria

The storyboard contractization recovery is considered complete for this phase when:

1. storyboard no longer depends on a `mock` execution placeholder
2. storyboard UI dispatches through generic node actions
3. generic output reconcile contains no storyboard hard-coded branch
4. storyboard business logic is owned by node-domain services/runners
5. quality gate commands are green and the remaining debt is explicitly documented
