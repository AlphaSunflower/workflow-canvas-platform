# Canvas Frontend Optimization Regression Checklist

## Goal

Validate that the remaining frontend optimizations improve large-image canvas interaction without changing thumbnail-only canvas behavior, upload, save, reload, or protected-resource behavior.

## Test Setup

- Use a development build with the current branch changes.
- Prepare one workflow with at least 50 to 100 image nodes.
- Prepare one batch containing local images, remote images, and at least a few protected resources when available.
- Reset diagnostics before each run with `window.__CANVAS_IMAGE_PERF_RESET__()`.

## Console Commands

Enable aggregated diagnostics only when needed:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__({ verbose: false, autoReport: false })
```

Read the summarized performance snapshot:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__()
```

Read image manager and cache state:

```js
window.__IMAGE_MANAGER_DEBUG__()
```

Read flicker-oriented diagnostics:

```js
window.__CANVAS_IMAGE_FLICKER_DEBUG__()
```

Disable diagnostics after verification:

```js
window.__CANVAS_IMAGE_PERF_DISABLE__()
```

## Verification Steps

1. Large import and drag baseline
   - Import at least 50 images into an empty canvas.
   - While import is still running, drag and pan continuously for 5 to 10 seconds.
   - Confirm nodes show stable loading placeholders and then runtime thumbnails rather than broad blank placeholders.
   - Confirm drag remains responsive and newly imported nodes continue to reveal thumbnails after interaction stops.

2. Drag and zoom after import
   - After import completes, drag across dense image regions for 10 seconds.
   - Zoom in and out across dense image regions.
   - Confirm visible and near-viewport nodes resolve thumbnails first, far nodes stay compact, and there is no broad flicker loop.

3. Viewer and original resource activation
   - Keep the viewer closed during drag and zoom runs.
   - Confirm `originalSubscriptions` stays at 0 or near 0 while the viewer remains closed.
   - Open viewer for several nodes, including at least one protected image.
   - Confirm original resources load only after viewer open and release cleanly after close.

4. Upload status isolation
   - Keep a canvas with many stable image nodes open.
   - Start an upload for a small subset of nodes.
   - Confirm non-uploading nodes do not visibly rerender or churn because of unrelated upload status changes.

5. Save and reload
   - Save after import and after drag.
   - Reload the workflow.
   - Confirm final viewport, media dimensions, thumbnail behavior, and remote thumbnail-first hydration remain correct.
   - Confirm runtime-only fields such as transient thumbnail handles and render-tier state are not persisted.

6. Protected resource stability
   - Open and close protected image or video resources repeatedly.
   - Confirm display remains correct, auth semantics remain intact, and no stale object URL behavior appears after close and reopen.

## Metrics To Check

- `fileNodeRenderSummary`
  Drag-heavy runs should show lower render amplification on stable nodes.
- `subscriptionSummary.canvasSubscriptions` and `subscriptionSummary.originalSubscriptions`
  Original subscriptions should stay dormant until viewer activation.
- `subscriptionSummary.uploadSnapshotReadCount`
  Should correlate with active upload nodes, not total image count.
- `cache`
  Check `thumbnailEntryCount`, `originalEntryCount`, `thumbnailBytes`, `originalBytes`, eviction count, and decoded release count.
- `memorySummary`
  Heap growth should remain flatter during drag and after import.
- `longTaskSummary`
  Long tasks should not rise sharply during steady drag or viewer-idle operation.

## Pass Criteria

- Large-batch drag stutter is visibly lower than the pre-optimization baseline.
- Viewer-closed scenes no longer maintain broad original-resource subscription pressure.
- Upload activity only affects active upload nodes, not the full stable canvas.
- Save, reload, import thumbnail hydration, protected resource access, and remote thumbnail-first behavior remain correct.
- No new flicker loop, state rollback, thumbnail loss, or protected-resource regression is observed.

## Risk Log Template

- Scenario:
- Observed symptom:
- Repro steps:
- Perf summary:
- Image manager snapshot:
- Flicker debug summary:
- Protected resource state:
- Save or reload impacted:
- Severity:
- Follow-up owner:
