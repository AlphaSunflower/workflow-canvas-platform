# Canvas Drag Performance Debug Guide

## Goal

Use lightweight aggregated metrics in development to inspect canvas drag performance without letting debug logging distort the result.

## Default Behavior

- Development mode now keeps performance collection in a lightweight state by default.
- High-frequency `FileNode` and canvas session diagnostics are disabled unless explicitly enabled.
- Drag visibility metrics keep aggregated summaries by default and only sample a subset of detailed commits.

## Enable Diagnostics

Run these commands in the browser console on a development build:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__()
```

Enable verbose detail capture:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__({ verbose: true })
```

Enable periodic aggregated console reporting:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__({ autoReport: true })
```

Disable all explicit diagnostics again:

```js
window.__CANVAS_IMAGE_PERF_DISABLE__()
```

The setting is persisted in `localStorage`, so disable it after debugging if you want to return to the default lightweight mode.

## Read Metrics

Read a lightweight aggregated snapshot:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__()
```

Print the same summary to the console:

```js
window.__CANVAS_IMAGE_PERF_REPORT__()
```

Read the full snapshot with retained detail buffers:

```js
window.__CANVAS_IMAGE_PERF_DEBUG__()
```

Read flicker-oriented image diagnostics with image manager cache context:

```js
window.__CANVAS_IMAGE_FLICKER_DEBUG__()
```

Reset all retained performance buffers:

```js
window.__CANVAS_IMAGE_PERF_RESET__()
```

## What To Check During Dragging

- `renderPlanPressure`
  Confirms the current 100/500/1000 node pressure scale and whether the run is `pass`, `watch`, or `fail`.
- `dragVisibilitySummary.totalComputations`
  Confirms visibility work is frame-batched rather than pointer-event-batched.
- `dragVisibilitySummary.averageDurationMs` and `maxDurationMs`
  Highlights whether visibility compute/apply is still heavy.
- `longTaskSummary.count` and `longTaskSummary.maxDurationMs`
  Confirms whether the main thread still has long blocking tasks during dragging.
- `cache.thumbnailEntryCount`, `cache.thumbnailBytes`, `cache.evictionCount`
  Shows whether thumbnail cache pressure is causing heavy reconcile work.
- `runtimeSyncSummary.totalWrites`
  Should remain stable during drag-only interactions and not spike unexpectedly.

## Recommended Debug Sequence

1. Call `window.__CANVAS_IMAGE_PERF_RESET__()`.
2. Run the sequence once each with 100, 500, and 1000 nodes.
3. Drag the canvas for 5 to 10 seconds with a large imported image set.
4. Record `.react-flow__node` DOM count before and during dragging.
5. Call `window.__CANVAS_IMAGE_PERF_SUMMARY__()`.
6. Compare `renderPlanPressure.status`, `longTaskSummary.maxDurationMs`, and `dragVisibilitySummary.maxDurationMs`.
7. Only if needed, enable verbose mode and repeat once for a short capture window.
8. Disable diagnostics after investigation.

## Final Regression Matrix

Run this matrix after visibility or import performance changes:

| Scale | Required node mix | Action | Pass criteria |
| --- | --- | --- | --- |
| 100 nodes | ordinary file node, image node, AI node, dynamic handle AI node, task output node | Pan out and back 20 times, then zoom in/out for 15 seconds. | No returned node is invisible or unclickable; `onlyRenderVisibleElements={false}` remains active. |
| 500 nodes | At least 250 image nodes and 20 AI nodes | Drag dense regions while imports or task outputs settle. | No sustained long task above 120 ms; drag remains usable. |
| 1000 nodes | Mixed sparse and dense regions | Pan between distant clusters and release mouse repeatedly. | Final viewport flush restores nodes and raster positions without waiting for task hydration. |

Release-mouse check:

- `flushDragVisibility` runs before post-drag image work.
- `viewportImageScheduleSummary.totalFlushes` increases after a drag that deferred image work.
- Workflow sync remains viewport-only during drag release and does not write placeholder nodes.

## Scale Thresholds

- 100 nodes: expected `renderPlanPressure.status === 'pass'`.
- 500 nodes: `pass` or `watch` is acceptable if interaction remains smooth and there are no sustained long tasks.
- 1000 nodes: `watch` is acceptable for stress testing; `fail` needs follow-up unless tied to a one-time import spike.
- During steady drag, `dragVisibilitySummary.maxDurationMs > 32` or `longTaskSummary.maxDurationMs > 120` is not acceptable.

## Notes

- Verbose mode intentionally captures more detail and can still affect development-time smoothness.
- Production behavior is unchanged. These switches only affect development diagnostics.
