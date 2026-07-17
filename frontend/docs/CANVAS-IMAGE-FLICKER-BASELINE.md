# Canvas Image Flicker Baseline

## Scope

- Baseline workflow ID: `544c80a3-e27b-4640-bebb-24a6fa800354`
- Baseline data source:
  - `backend/data/workflows/544c80a3-e27b-4640-bebb-24a6fa800354/workflow.json`
  - `backend/data/workflows/544c80a3-e27b-4640-bebb-24a6fa800354/files.json`
- Current real sample characteristics:
  - 55 workflow-file bindings
  - all bindings are protected remote files
  - viewport loads into a dense image area

## Debug Entry Points

Development mode exposes three debug helpers:

```ts
window.__IMAGE_MANAGER_DEBUG__?.()
window.__CANVAS_IMAGE_PERF_DEBUG__?.()
window.__CANVAS_IMAGE_FLICKER_DEBUG__?.()
```

Recommended inspection order:

1. `window.__CANVAS_IMAGE_FLICKER_DEBUG__?.()`
2. `window.__CANVAS_IMAGE_PERF_DEBUG__?.()`
3. `window.__IMAGE_MANAGER_DEBUG__?.()`

## What To Watch

`__CANVAS_IMAGE_FLICKER_DEBUG__()` should directly answer:

- current session node count, visible node count, near-viewport node count
- preview cache entry count and preview entry limit
- inflight image request count
- per-node lifecycle event sequence
- suspected `ready -> release -> request-started` loops

Key fields:

- `session.nodeCount`
- `session.visibleNodeCount`
- `session.nearViewportNodeCount`
- `cache.previewEntryCount`
- `cache.previewEntryLimit`
- `cache.inflightRequestCount`
- `suspectedLoops`
- `nodeLifecycleStats`

## Regression Criteria

Stable viewport means:

- no drag
- no zoom
- no node resize
- no node selection churn
- no explicit file open / viewer open

Under a stable viewport, the following should hold:

- the same node must not continuously appear in `suspectedLoops`
- the same node must not keep increasing `readyReleaseRequestLoopCount`
- `cache.previewEntryCount` should not oscillate together with repeated `release` and `request-started` on the same visible node
- visible nodes should converge to `preview-ready` or `thumbnail-ready`, not bounce forever between `ready`, `release`, and `loading`

## Known Bad Pattern

The current flicker symptom is defined as:

1. image becomes visible
2. node reaches `load-succeeded`
3. resource gets `release`
4. same node quickly emits `request-started` again
5. browser image element reloads and user sees flashing / black placeholder

This corresponds to:

- `nodeLifecycleStats[*].requestAfterReleaseCount` growing
- `nodeLifecycleStats[*].readyReleaseRequestLoopCount` growing
- `suspectedLoops.length > 0`

## Baseline Expectations For The 55 Image Sample

- `session.nodeCount === 55`
- `baseline.expectedRemoteProtectedImageCount === 55`
- `cache.previewEntryLimit === 48` on the current implementation baseline
- `cache.previewEntryCount > cache.previewEntryLimit` is a pressure indicator, not itself a regression verdict
- regression is confirmed only when cache pressure is accompanied by repeated per-node release/request loops

## Test Coverage

Related tests:

- `src/services/image/image-manager.spec.ts`
- `src/components/node/file/FileNode.stress.spec.tsx`

These tests cover:

- loop observability
- 55 image baseline reporting
- preview pressure reporting
- stable viewport false-positive suppression
