# Canvas Render Plan Performance Check

## Goal

Confirm that the project-owned render plan can carry canvas visibility and image rendering pressure after React Flow built-in visible-element clipping is disabled.

## Test Matrix

Run every scenario with diagnostics reset before the capture:

```js
window.__CANVAS_IMAGE_PERF_RESET__?.()
window.__CANVAS_IMAGE_PERF_ENABLE__?.({ verbose: false, autoReport: false })
```

| Scale | Dataset | Required result |
| --- | --- | --- |
| 100 nodes | Mixed file, image, AI, and output nodes | No visible regression; pan/zoom remains smooth. |
| 500 nodes | At least 250 image nodes and 50 AI nodes | Raster layer carries passive image display cost; no sustained long tasks. |
| 1000 nodes | Mixed graph with dense and sparse regions | Interaction remains usable; mild degradation is acceptable if nodes never disappear or become unclickable. |

## Pan/Zoom Procedure

1. Open the test workflow and wait until initial images settle.
2. Record DOM node count:

```js
document.querySelectorAll('.react-flow__node').length
```

3. Pan horizontally and vertically for 30 seconds.
4. Zoom from overview into a dense cluster, then back to overview.
5. Move a dense image cluster fully offscreen and back onscreen 20 times.
6. Read:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__?.()
```

Also capture the detailed snapshot when a row fails:

```js
window.__CANVAS_IMAGE_PERF_DEBUG__?.()
```

## Continuous Zoom Check

1. Use a viewport containing at least 30 passive image nodes.
2. Hold `Ctrl` and wheel zoom continuously for 15 seconds.
3. Repeat with pinch zoom if available.
4. Stop zooming and wait 1 second.
5. Confirm raster images redraw at the final scale and remain aligned with selectable nodes.
6. Confirm image requests resume only after zoom settles; there should be no sustained request loop during the zoom gesture.

Expected:

- `dragVisibilitySummary.maxDurationMs` and raster item build time do not spike repeatedly during continuous zoom.
- Visibility diff count should be visibly lower than builds where display buckets changed on every small zoom step.
- Images may briefly use the previous raster draw during the zoom gesture, but after zoom settles their position and clarity recover.
- No image remains painted at an old location, and every visible image node is clickable/selectable.

## Metrics To Record

- `renderPlanPressure.scale`
- `renderPlanPressure.status`
- `renderPlanPressure.watchReasons`
- `renderPlanPressure.nodeCount`
- `renderPlanPressure.visibleNodeCount`
- `renderPlanPressure.nearViewportNodeCount`
- `renderPlanPressure.dragMaxNodeCount`
- `dragVisibilitySummary.maxDurationMs`
- `longTaskSummary.count`
- `longTaskSummary.maxDurationMs`
- `memorySummary.maxUsedJSHeapSize`
- `cache.visibleEntryCount`
- `cache.nearViewportEntryCount`
- `cache.thumbnailByteUsageRatio`
- `imageManagerEmitSummary.emitsPerSecond`
- `imageManagerEmitSummary.canvasEmitsPerSecond`
- `rasterSummary.maxCandidateNodeCount`
- `rasterSummary.maxRegisteredNodeCount`
- `rasterSummary.maxRequestedNodeCount`
- `rasterRebuildSummary.totalRebuilds`
- `rasterRebuildSummary.rebuildsPerSecond`
- `rasterRebuildSummary.byReason`
- `nodePatchQueueSummary.maxPendingCount`
- `nodePatchQueueSummary.maxFlushDurationMs`
- `nodesReferenceSummary.changesPerSecond`
- `moveEndSummary.maxVisibilityApplyMs`
- `moveEndSummary.maxResourceScheduleMs`
- `moveEndSummary.maxPatchQueueFlushMs`
- `moveEndSummary.maxWorkflowViewportSyncMs`
- Zoom gesture result: smooth, usable, degraded, or failed
- Whether raster requests were deferred until zoom settled
- `.react-flow__node` DOM count before, during, and after pan
- Subjective interaction result: smooth, usable, degraded, or failed

## Initial Thresholds

- 100 nodes:
  - `renderPlanPressure.status` should be `pass`.
  - No repeated long tasks above 50 ms.
  - DOM count should stay close to visible/near-viewport work, not total workflow size.
- 500 nodes:
  - `renderPlanPressure.status` may be `pass` or `watch`.
  - `dragVisibilitySummary.maxDurationMs` should normally stay at or below 16 ms.
  - No sustained image release/request loops while panning.
- 1000 nodes:
  - `renderPlanPressure.status` may be `watch`.
  - `fail` requires follow-up before release unless caused by a known one-time import spike.
  - Long tasks above 120 ms, drag visibility above 32 ms, or runtime sync above 120 ms are not acceptable during steady drag.

## Raster Layer Checks

1. Use 250 or more image nodes.
2. Pan dense image regions across the viewport edge.
3. Confirm passive visible images are drawn by the raster layer when not active.
4. Select and drag a returned image node to force DOM promotion.

Expected:

- Images do not stay painted at old positions after pan ends.
- A visible image corresponds to a selectable React Flow node.
- `cache.visibleEntryCount` and `cache.nearViewportEntryCount` track viewport movement.
- `originalSubscriptions` remains low unless the image viewer is opened.

## Comparison Record

Use this table once for the pre-change baseline if available and once for the current branch:

| Build | Scale | DOM count idle | DOM count dragging | Long task max | Drag visibility max | Memory max | Pressure status | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 100 | | | | | | | |
| current | 100 | | | | | | | |
| baseline | 500 | | | | | | | |
| current | 500 | | | | | | | |
| baseline | 1000 | | | | | | | |
| current | 1000 | | | | | | | |

## Adjustment Guidance

- DOM count too high: review full/compact/minimal render tier thresholds first.
- Returned nodes appear late: inspect `dragVisibilitySummary.totalComputations` and final drag flush timing.
- Passive images are expensive: review raster candidate selection and image cache pressure.
- Near-viewport churn is high: review overscan and candidate retention together; do not tune one without checking the other.

## Task 10 Tuning Matrix

Run the full pan/zoom procedure with current values first. Only run candidate rows when a measured metric crosses a threshold.

| Parameter group | Current | Candidate | Use candidate when | Revert candidate when |
| --- | --- | --- | --- | --- |
| visibility overscan | `360` | `240` | near-viewport churn or resource candidate count is high while viewport return remains reliable | returned nodes appear late or raster/DOM alignment regresses |
| visibility overscan | `360` | `480` | fast pan causes returned nodes to appear late | emit/resource pressure or memory rises without return benefit |
| default retention | `6000` | `3000` | retained passive candidates keep resource pressure high after pan | returned ready images flicker or are repeatedly re-requested |
| importing retention | `1200` | `800` | importing candidates remain queued after leaving viewport | visible importing nodes lose loading continuity during quick pan-back |
| patch queue max/frame | `8` | `4` | patch queue flush duration creates long tasks | queue drains too slowly after import completion |
| passive raster batch/concurrency | `8 / 4` | `4 / 2` | steady pan/zoom still shows request or decode pressure | ready images lag noticeably after import settles |
| importing raster batch/concurrency | `2 / 2` | `1 / 1` | 50/100 visible imports show request pressure or repeated long tasks | selected, hovered, or active importing images feel delayed |

Rules:

- Change one parameter group at a time.
- Keep the current value if the candidate does not improve the failing metric.
- Do not tune `onlyRenderVisibleElements`; it must remain `false`.
- Prefer lowering importing raster batch/concurrency before reducing overscan.

## Final Baseline Record

| Build | Overscan | Retention | Importing retention | Patch budget | Passive request budget | Importing request budget | 100 result | 500 result | 1000 result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | `360` | `6000` | `1200` | `8` | `8 / 4` | `2 / 2` | | | |
| tuned | | | | | | | | | |

## Result Template

- Build / branch:
- Browser / OS:
- Dataset generator:
- Node count:
- Image node count:
- DOM count idle:
- DOM count dragging:
- Pressure summary:
- Long task summary:
- Drag visibility summary:
- Memory summary:
- Cache summary:
- Image manager emit summary:
- Raster rebuild summary:
- Patch queue summary:
- Move-end summary:
- Raster result:
- Interaction result:
- Selected parameter values:
- Required follow-up:
