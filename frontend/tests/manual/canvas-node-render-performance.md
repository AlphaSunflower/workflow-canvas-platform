# Canvas Node Render Performance Debugging

## Enable Diagnostics

In the browser console on a development build:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__({ verbose: false, autoReport: false })
```

Optional verbose mode:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__({ verbose: true })
```

Reset existing samples before a new run:

```js
window.__CANVAS_IMAGE_PERF_RESET__()
```

## Read Key Metrics

Get the summarized snapshot:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__()
```

Key fields to inspect:

- `renderPlanPressure`
  Use this as the top-level pressure summary for 100, 500, and 1000 node pan/zoom runs.
- `fileNodeRenderSummary`
  Use this to inspect per-node render count, drag commit count, average commit cost and max commit cost.
- `dragVisibilitySummary`
  Confirm render plan visibility work is scheduled by animation frame during pan/drag, not by every pointer event.
- `viewportImageScheduleSummary`
  Confirm image work is deferred during drag and flushed after drag end.
- `subscriptionSummary`
  Check `totalSubscriptions`, `peakSubscriptions`, `canvasSubscriptions`, `originalSubscriptions`, `uploadSnapshotReadCount`.
- `cache`
  Check resource entry counts, byte usage, cache limits and usage ratios.
- `memorySummary`
  Check heap growth trend and whether long task spikes rise with memory samples.

Get the full debug snapshot when needed:

```js
window.__CANVAS_IMAGE_PERF_DEBUG__()
```

Get the current image manager snapshot:

```js
window.__IMAGE_MANAGER_DEBUG__()
```

## Suggested Workflow

1. Reset diagnostics.
2. Import a large batch of images.
3. Drag and zoom the canvas for 10 to 20 seconds.
4. Pan a mixed node cluster fully offscreen and back onscreen until every node type has crossed the viewport boundary.
5. Read `window.__CANVAS_IMAGE_PERF_SUMMARY__()`.
6. Compare:
   - whether `renderPlanPressure.status` is `pass`, `watch`, or `fail`
   - whether `renderPlanPressure.nodeCount` matches the intended 100, 500, or 1000 node scale
   - whether `originalSubscriptions` grows even when the viewer stays closed
   - whether `uploadSnapshotReadCount` rises much faster than actual upload activity
   - whether `peakSubscriptions` and `cache.canvasByteUsageRatio` rise together
   - whether `dragVisibilitySummary.totalComputations` grows by frame/window instead of raw pointer event count
   - whether `viewportImageScheduleSummary.totalFlushes` records a final flush after drag end
   - whether `memorySummary.maxUsedJSHeapSize` rises with long task spikes
   - whether `.react-flow__node` DOM count tracks the current render tier plan rather than total workflow size

## Render Plan Regression Requirements

- Unchanged render plans should reuse rendered node references; `renderPlanSummary.lastReusedNodeCount` should be close to rendered node count during steady pan.
- Bulk visible importing images should mostly be compact/proxy unless selected, hovered, dragged, or opened.
- Raster candidates should track the render plan candidate list, not total image node count.
- React Flow must stay out of visibility clipping: `onlyRenderVisibleElements={false}`.

Record for each scale:

| Scale | Rendered DOM nodes | Full | Compact/proxy | Placeholder | Raster candidates | Reused nodes | Interaction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | | | | | | | |
| 500 | | | | | | | |
| 1000 | | | | | | | |

## Interpretation

- `renderPlanPressure.status === 'fail'` means the run crossed an agreed manual threshold and needs follow-up before release.
- High `fileNodeRenderSummary[*].dragCommitCount` means drag interactions are still causing node-level rerenders.
- Missing `dragVisibilitySummary` activity during pan means returned nodes may be waiting for unrelated workflow updates before becoming visible.
- Missing final `viewportImageScheduleSummary` flush can leave raster images visually stale after the DOM node has moved.
- High `originalSubscriptions` with the viewer closed means original image resources are being over-subscribed.
- High `uploadSnapshotReadCount` with low real upload activity means upload state propagation is too broad.
- High cache usage ratio plus rising heap samples usually indicates pressure is moving from CPU to memory and GC.
