# Canvas Drag Regression Checklist

## Goal

Validate that the drag-performance optimizations keep canvas interaction smooth after large image imports without changing thumbnail-only canvas behavior, persistence, or import semantics.

## Test Setup

- Use a development build with the current branch changes.
- Prepare one workflow containing at least 50 imported image nodes.
- Prepare one import batch with mixed image sizes so that thumbnail generation and runtime apply both run.
- Before each run, call `window.__CANVAS_IMAGE_PERF_RESET__()` in the browser console.

## Console Commands

Enable lightweight diagnostics only when needed:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__()
```

Read the aggregated drag/import summary:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__()
```

Print the same summary to the console:

```js
window.__CANVAS_IMAGE_PERF_REPORT__()
```

Read flicker-oriented image manager diagnostics:

```js
window.__CANVAS_IMAGE_FLICKER_DEBUG__()
```

Disable diagnostics after verification:

```js
window.__CANVAS_IMAGE_PERF_DISABLE__()
```

## Verification Steps

1. Large import baseline
   - Import at least 50 images into an empty canvas.
   - Confirm nodes appear quickly with stable loading placeholders and then runtime thumbnails.
   - Confirm import completion does not trigger visible thumbnail rollback.

2. Drag during import
   - Start another large import batch.
   - While import is still running, continuously drag and pan the canvas for 5 to 10 seconds.
   - Confirm the viewport stays responsive and no large region remains stuck in placeholder state.
   - Confirm newly imported nodes still reveal thumbnails after drag stops.

3. Drag after import
   - After all imports complete, drag the canvas across dense image regions for 10 seconds.
   - Confirm drag updates feel frame-batched rather than pointer-event-blocked.
   - Confirm thumbnails remain stable when nodes cross viewport boundaries repeatedly.
   - Pan a mixed cluster fully out of the viewport and back 20 times without selecting another node.
   - Confirm 普通文件节点, 图片节点, AI 节点, dynamic-handle 节点, and 任务输出节点 all reappear without waiting for task completion or another workflow update.

4. Zoom stress
   - Zoom in and out across dense image regions while dragging.
   - Confirm nodes do not flicker between loading and ready repeatedly.
   - Confirm near-viewport and visible nodes still reveal thumbnails before far offscreen nodes.

5. Save and reload
   - Save immediately after a drag operation ends.
   - Reload the workflow.
   - Confirm final viewport position matches the last visible canvas position before save.
   - Confirm persisted remote images reload thumbnail-first and original remains viewer-only.
   - Confirm runtime-only local import thumbnail refs are not persisted into workflow state.

6. Worker fallback sanity
   - Run once with `VITE_CANVAS_VISIBILITY_WORKER=true`.
   - Run once with `VITE_CANVAS_VISIBILITY_WORKER=false`.
   - Confirm visible thumbnail behavior, drag result, save result, and reload result stay consistent.

## Metrics To Check

- `dragVisibilitySummary.totalComputations`
  Should scale by frame/window, not raw pointer event count.
- `dragVisibilitySummary.maxDurationMs`
  Should not show repeated large spikes during steady dragging.
- `longTaskSummary.count` and `longTaskSummary.maxDurationMs`
  Should not show sustained main-thread blocking during drag.
- `viewportImageScheduleSummary.totalScheduled` and `totalFlushes`
  Should show deferred scheduling during drag and final flush on drag end.
- `runtimeSyncSummary.totalWrites`
  Should stay stable during drag-only interaction and not jump with every viewport change.
- `cache.thumbnailEntryCount`, `cache.evictionCount`, `cache.decodedReleaseCount`
  Should not show release storms while visible images remain on screen.

## Pass Criteria

- Large-batch drag stutter is visibly lower than the pre-optimization baseline.
- Dragging during import no longer causes broad thumbnail loss or prolonged blank placeholders.
- Nodes that leave the viewport and return are visible and interactive immediately.
- Task completion or output hydration is not required to restore a returned node.
- Final viewport, save, reload, import completion, and thumbnail readiness semantics remain correct.
- No new flicker loop, state rollback, or persistence regression is observed.

## Risk Log Template

- Scenario:
- Observed symptom:
- Repro steps:
- Perf summary:
- Flicker debug summary:
- Affected node count:
- Worker enabled:
- Save/reload impacted:
- Severity:
- Follow-up owner:
