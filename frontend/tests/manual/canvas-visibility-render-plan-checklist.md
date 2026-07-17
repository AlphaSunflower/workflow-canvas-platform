# Canvas Visibility Render Plan Checklist

## Goal

Validate the real regression path where nodes leave the viewport, return to the viewport, and must become visible and interactive without waiting for task output hydration or any unrelated canvas update.

## Visibility Ownership

- `visibleNodes` is the viewport fact source.
- `CanvasRenderPlan` is the only source for full/proxy/placeholder node rendering, hidden edges, render tier, and raster eligibility.
- React Flow must keep `onlyRenderVisibleElements={false}` and must not reintroduce dynamic visibility clipping.
- Connected dynamic-handle AI nodes stay alive through render plan / DOM windowing rules, not through React Flow clipping switches.

## Preconditions

- Run the frontend in development mode.
- Use a workflow with at least 100 nodes distributed across a large canvas.
- Include this node matrix:
  - 普通文件节点
  - 图片节点
  - AI 节点
  - connected dynamic-handle AI 节点
  - 任务输出节点
- Keep one AI task running or ready to complete while the viewport is being dragged.
- Enable diagnostics only when collecting evidence:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__?.({ verbose: false, autoReport: false })
window.__CANVAS_IMAGE_PERF_RESET__?.()
```

## Core Regression Path

### 离开视口再返回

1. Put one node from each matrix row in the current viewport.
2. Pan the canvas until all matrix nodes fully leave the viewport.
3. Pan back to the original area without selecting another node or waiting for task completion.
4. Repeat the leave-and-return cycle 20 times at normal drag speed and 20 times with fast flick panning.
5. Repeat once while an AI task output is hydrating into the workflow.

Expected:

- Every returned node is visible without requiring another task result, selection change, or unrelated node update.
- Every returned node can be clicked, selected, dragged, and opened through its expected UI.
- Existing edges reappear with the returned nodes and no `output-link` or `file-reference` connection disappears.
- Drag-only viewport movement does not persist placeholder nodes, hidden edges, or React Flow transient fields into workflow state.

## Node Matrix

| Node type | Steps | Pass criteria |
| --- | --- | --- |
| 普通文件节点 | Pan out, pan back, select, drag, open context menu. | Node body and handles are visible; selection and context menu target the same node. |
| 图片节点 | Pan out, pan back, click thumbnail, drag node, open viewer. | raster/DOM state is consistent; image does not remain at the old position; visible image is clickable through the node. |
| AI 节点 | Pan out, pan back, select, edit a config field, start or inspect a task. | Full node UI returns; config controls and handles remain interactive. |
| connected dynamic-handle AI 节点 | Pan out, pan back, inspect all dynamic handles and connected edges. | Dynamic handles exist before edges render; React Flow does not report missing target/source handle warnings. |
| 任务输出节点 | Complete or reconcile an output, pan out during hydration, pan back. | Output node and `output-link` stay present; hydration is not required to make an existing node visible again. |

## Image Raster/DOM Consistency

1. Put 20 or more 图片节点 in a cluster.
2. Pan until the cluster is offscreen and returns from the opposite side.
3. Stop dragging immediately when the cluster re-enters the viewport.
4. Try to click, drag, and open the viewer for the first visible image node.
5. Repeat after zooming out to show the raster layer and after zooming in to force full DOM promotion.

Expected:

- raster/DOM position matches the React Flow node position after drag end.
- No image remains painted at an old viewport position after its node moved.
- No state appears where the image is visible but the node cannot be clicked or selected.
- `window.__CANVAS_IMAGE_PERF_SUMMARY__?.().viewportImageScheduleSummary.totalFlushes` increases after drag end when image work was deferred.
- `rasterRebuildSummary.totalRebuilds` increases by batch or viewport changes, not once per individual image resource state transition.
- `imageManagerEmitSummary.emitsPerSecond` remains bounded while importing thumbnails settle.

## Task Output During Drag

1. Start an AI node execution that produces an image or file output.
2. Drag the canvas so the source AI 节点 and expected output area repeatedly leave and re-enter the viewport.
3. Let the task finish while dragging or immediately after drag end.
4. Pan back to the source and output area.

Expected:

- The source AI 节点 does not disappear while output hydration is pending.
- The 任务输出节点 appears once and remains visible after viewport return.
- The `output-link` is still connected to the correct dynamic handle.
- No delayed instance sync removes the output node, source node, or output edge.

## Evidence To Record

- Build or branch:
- Browser and OS:
- Node matrix size:
- Worker visibility mode:
- Leave/return cycles completed:
- Task output type:
- Any missing node id:
- Any stuck raster image:
- Console warnings:
- Perf summary:
- Image manager emit summary:
- Raster rebuild summary:
- Node patch queue summary:
- Move-end summary:
- Result:

## Final Performance Acceptance

Run the visibility path together with import and raster pressure:

- Import 20, 50, and 100 images into the visible viewport.
- Pan the imported cluster fully out and back while thumbnails are still settling.
- Repeat with a workflow containing 100, 500, and 1000 total nodes.
- Include ordinary file node, image node, AI node, connected dynamic handle AI node, and task output node.

Pass criteria:

- Node leave/return never depends on task output hydration or unrelated node updates.
- Image raster and DOM positions match after drag end.
- Dynamic handles exist before edges render; no React Flow missing-handle warnings appear.
- Task output node and `output-link` are not removed by viewport sync.
- Drag release does not synchronously chain visibility flush, image work, patch queue flush, and workflow sync.
- `nodePatchQueueSummary.pendingCount` drains after import or layout updates settle.
- `onlyRenderVisibleElements={false}` remains unchanged.

## Task 10 Final Checklist

Use this checklist after the 20 / 50 / 100 import matrix and the 100 / 500 / 1000 visibility matrix:

| Check | Pass / fail | Evidence |
| --- | --- | --- |
| 20 image import can pan and zoom during import | | |
| 50 image import can pan and zoom during import | | |
| 100 image import can pan and zoom during import | | |
| No sustained long tasks above 50 ms | | |
| `imageManager.emit/sec` is bounded under visible importing pressure | | |
| Raster rebuilds are batch-driven, not per image lifecycle event | | |
| Node patches are merged through the patch queue during import | | |
| Drag release move-end metrics show staged work | | |
| Nodes leaving and returning to viewport stay visible and clickable | | |
| `onlyRenderVisibleElements={false}` is still present in `Canvas.tsx` | | |
