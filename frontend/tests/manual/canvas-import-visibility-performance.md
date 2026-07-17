# Canvas Import Visibility Performance Acceptance

## Goal

Confirm the current render-plan architecture restores import, pan, zoom, and drag-release performance without regressing the viewport-return invisibility fix.

## Setup

Run in development mode and reset diagnostics before each row:

```js
window.__CANVAS_IMAGE_PERF_RESET__?.()
window.__CANVAS_IMAGE_PERF_ENABLE__?.({ verbose: false, autoReport: false })
```

React Flow must remain configured with `onlyRenderVisibleElements={false}`.

Use these console reads after each scenario:

```js
const summary = window.__CANVAS_IMAGE_PERF_SUMMARY__?.()
const detail = window.__CANVAS_IMAGE_PERF_DEBUG__?.()
summary?.imageManagerEmitSummary
summary?.rasterRebuildSummary
summary?.nodePatchQueueSummary
summary?.moveEndSummary
summary?.renderPlanPressure
```

## 20 / 50 / 100 Image Import Matrix

| Images | Placement | Total ms | Enhancement ms | Hydration max ms | Raster candidates max | Emit/sec | Raster rebuilds/sec | Patch queue max | Long task max ms | Interaction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | in viewport | | | | | | | | | |
| 20 | offscreen | | | | | | | | | |
| 50 | in viewport | | | | | | | | | |
| 50 | offscreen | | | | | | | | | |
| 100 | in viewport | | | | | | | | | |
| 100 | offscreen | | | | | | | | | |

Pass criteria:

- In-viewport import is not tens of times slower than offscreen import.
- Progress remains accurate: `completed + failed === total`.
- Pan, zoom, and release mouse remain usable while thumbnails settle.
- Passive visible importing images render through compact/proxy loading state unless a thumbnail is ready or the node is selected, hovered, or active.
- `imageManagerEmitSummary.emitsPerSecond` stays bounded and does not scale linearly from 20 to 50 to 100 visible importing images.
- `rasterRebuildSummary.totalRebuilds` is lower than the number of individual image lifecycle transitions.
- `nodePatchQueueSummary.pendingCount` returns to `0` after import settles.
- Repeated long tasks above 50 ms fail the row; an isolated spike must include a recorded phase and follow-up.

## 100 / 500 / 1000 Node Visibility Matrix

| Nodes | Required mix | DOM count idle | DOM count dragging | Drag max ms | Long task max ms | Returned nodes OK |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | ordinary file node, image node, AI node, dynamic handle AI node, task output node | | | | | |
| 500 | image-heavy mixed workflow | | | | | |
| 1000 | sparse and dense mixed workflow | | | | | |

Pass criteria:

- ordinary file node, image node, AI node, dynamic handle AI node, and task output node all return visible and interactive after leaving the viewport.
- Task output hydration is not required to restore an existing node.
- `output-link` and `file-reference` edges reappear with restored nodes.
- Dynamic handle AI nodes do not produce missing-handle warnings.

## Zoom And Drag Release

1. Put at least 30 passive image nodes in view.
2. Continuously zoom for 15 seconds.
3. Drag the same cluster offscreen and back.
4. Release the mouse repeatedly during thumbnail import.

Expected:

- Visibility diff count is lower than a build that emits on every small zoom step.
- Image requests resume after zoom settles.
- Raster images do not remain painted at old positions.
- Release-mouse work is staged: viewport sync and workflow viewport-only sync are light, image work is scheduled later, and patch queue flush is not forced by release.
- `moveEndSummary.maxImageWorkFlushMs` should stay near zero because image work is deferred.
- `moveEndSummary.maxVisibilityApplyMs`, `maxResourceScheduleMs`, `maxPatchQueueFlushMs`, and `maxWorkflowViewportSyncMs` should be recorded separately.

## Importing Resource Policy Checks

1. Start importing at least 50 images into the visible viewport.
2. Without selecting any image, observe the visible passive image nodes during preprocessing.
3. Select one importing image, hover another, and open the viewer for a third.
4. Pan the rest of the importing images offscreen and back.

Expected:

- Passive importing images show compact/proxy loading cards and do not all enter the raster request queue.
- Selected, hovered, or active importing images load promptly.
- Runtime thumbnail readiness makes an image eligible for raster without waiting for node data patch flush.
- Offscreen importing images keep metadata but do not create resource request pressure.

## Final Acceptance Record

| Scenario | Emit/sec bounded | Raster rebuild batched | Patch queue drained | Long task <= 50 ms sustained | Viewport return OK | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 20 visible import | | | | | | |
| 50 visible import | | | | | | |
| 100 visible import | | | | | | |
| 100-node mixed workflow | | | | | | |
| 500-node image-heavy workflow | | | | | | |
| 1000-node mixed workflow | | | | | | |
