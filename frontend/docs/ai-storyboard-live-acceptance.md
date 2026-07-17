# AI Storyboard Live Acceptance Record

Last updated: 2026-04-24

## Scope

This record is the manual acceptance sheet for the post-contractization `aiStoryboard` node.

It exists to verify the real browser/runtime path that automated `node:test` coverage cannot prove inside the current terminal-only environment.

## Current Status

- automated contract and regression coverage: complete
- frontend gate (`typecheck` / `lint` / `test`): verified on 2026-04-24
- unified root gate: verified on 2026-04-24
- live browser/provider click-through: pending manual execution

This file is intentionally not marked as passed yet.

## Environment Prerequisites

- start frontend and backend in a real browser environment
- sign in with an account that can run storyboard-related AI tasks
- ensure the target provider path for storyboard image/video generation is available
- prepare at least:
  - one storyboard node with upstream image inputs
  - one workflow that can be saved and reloaded
  - one browser session capable of page refresh and file download verification

## Manual Checklist

### 1. Arrange

- Open a workflow with an `aiStoryboard` node connected to valid upstream image inputs.
- Trigger the arrange action.
- Expected:
  - arrange button stays on the node action path
  - shot order/prompt updates are visible
  - no broken placeholder or unsupported-execution message appears

### 2. Single-Shot Image

- Pick one shot with prompt and valid reference image.
- Trigger single-shot image generation.
- Expected:
  - shot state enters running/progress state
  - completion writes output through the right-side output slot
  - no direct stale local runtime patch corrupts persisted state

### 3. Single-Shot Video

- Pick one shot with prompt and confirmed backend-capable reference image.
- Trigger single-shot video generation.
- Expected:
  - shot state enters running/progress state
  - bounded retry behavior is acceptable if provider is slow
  - completion writes video output through the right-side output slot

### 4. Batch Video

- Trigger batch video generation on a node containing at least two executable shots.
- Expected:
  - already-generating shots are skipped
  - executable shots dispatch together
  - final success/warning summary matches actual per-shot result

### 5. Output Node Materialization

- After image/video completion, inspect canvas output nodes and output-link edges.
- Expected:
  - output file nodes are created on the right side of the storyboard node
  - output-link source handle matches the completed shot output handle, for example `shot-id:result`
  - repeated completions append distinct output nodes without breaking previous outputs

### 6. Refresh Recovery

- Save the workflow, refresh the page, and reopen the same workflow.
- Expected:
  - existing storyboard outputs are restored
  - output-link edges are restored
  - legacy task refs, if present in the workflow, do not block recovery

## Record Template

- Acceptance date:
- Operator:
- Environment:
- Workflow id / name:
- Provider / account:
- Result:
- Evidence links or screenshots:
- Notes:

## Pending Items

- This record stays open until a human runs the checklist above in the real UI.
- Until then, `QBL-FE-STORY-105` remains open.
