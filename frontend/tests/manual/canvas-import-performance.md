# Canvas Import Performance Debug Guide

## Scope

This checklist is for manual debugging of canvas file import performance in local development.

Task 1 adds metrics for:

- import phase timing
- long task observation during import
- runtime snapshot write frequency and duration
- canvas thumbnail ready timing for imported image nodes
- image manager emit frequency
- raster rebuild frequency and rebuild reasons
- node patch and node patch queue pressure
- React Flow nodes reference changes
- drag-release phase timing

## Prerequisites

- run the frontend in development mode
- open the page containing the canvas
- open DevTools Console

These debug hooks are only exposed in `import.meta.env.DEV`.

## Debug Commands

Enable lightweight diagnostics:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__({ verbose: false, autoReport: false })
```

Read the latest snapshot:

```js
window.__CANVAS_IMAGE_PERF_DEBUG__()
```

Reset all collected metrics before a new import:

```js
window.__CANVAS_IMAGE_PERF_RESET__()
```

Optional flicker-oriented snapshot:

```js
window.__CANVAS_IMAGE_FLICKER_DEBUG__()
```

Read the aggregated acceptance summary:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__()
```

## Where To Read Import Metrics

Run one import batch, then inspect:

```js
const perf = window.__CANVAS_IMAGE_PERF_DEBUG__();
perf.importBatches[0];
```

Key fields on an import batch:

- `responseMs`
  placeholder nodes became visible on canvas after batch start
- `totalMs`
  batch hydration completed after batch start
- `enhancementMs`
  async thumbnail preprocessing window
- `thumbnailReadyTargetCount`
  number of imported image nodes expected to reach canvas thumbnail ready
- `thumbnailReadyNodes`
  number of imported image nodes that already reached canvas thumbnail ready
- `firstCanvasThumbnailReadyMs`
  first imported image thumbnail became ready after batch start
- `allCanvasThumbnailReadyMs`
  all imported image thumbnails became ready after batch start
- `runtimeSyncCount`
  number of `syncRuntimeSnapshot` writes attributed to this batch
- `runtimeSyncTotalMs`
  total time spent in those writes
- `runtimeSyncMaxMs`
  slowest single write attributed to this batch
- `longTaskCount`
  number of browser long tasks overlapping this batch
- `maxLongTaskMs`
  longest observed long task overlapping this batch

Detailed phase events:

```js
perf.importBatches[0].stages
```

Phase summary:

```js
perf.importBatches[0].stageSummary
```

Current phases:

- `layout-probe`
- `layout-positioning`
- `placeholder-batch-build`
- `placeholder-insert`
- `node-hydration`
- `enhancement-preprocess`
- `canvas-thumbnail-ready`

## Where To Read Runtime Snapshot Writes

Inspect all recent writes:

```js
const perf = window.__CANVAS_IMAGE_PERF_DEBUG__();
perf.runtimeSyncs
```

Global summary:

```js
perf.runtimeSyncSummary
```

Useful fields:

- `reason`
  why the write happened
- `batchId`
  which import batch it belongs to, if attribution succeeded
- `nodeCount`
  node count included in the snapshot
- `connectionCount`
  connection count included in the snapshot
- `durationMs`
  total write duration
- `snapshotBuildMs`
  runtime snapshot build duration
- `metadataNormalizeMs`
  metadata normalization duration
- `actionCommitMs`
  `actions.syncRuntimeSnapshot(...)` call duration

## Where To Read Long Tasks

Global long tasks:

```js
const perf = window.__CANVAS_IMAGE_PERF_DEBUG__();
perf.longTasks
perf.longTaskSummary
```

Per import batch overlap:

```js
perf.importBatches[0].longTaskCount
perf.importBatches[0].maxLongTaskMs
```

## Where To Read Chain-Break Metrics

Run one import batch, interact with the canvas, then inspect:

```js
const summary = window.__CANVAS_IMAGE_PERF_SUMMARY__();
summary.imageManagerEmitSummary;
summary.rasterRebuildSummary;
summary.nodePatchSummary;
summary.nodesReferenceSummary;
summary.nodePatchQueueSummary;
summary.moveEndSummary;
summary.rasterSummary;
summary.renderPlanSummary;
```

Key fields:

- `imageManagerEmitSummary.emitsPerSecond`
  total image manager emit rate during the measured window
- `imageManagerEmitSummary.canvasEmitsPerSecond`
  canvas-mode emit rate; this should stay bounded during visible importing
- `rasterRebuildSummary.rebuildsPerSecond`
  raster rebuild frequency; this should follow batch ready snapshots and viewport changes, not every image load event
- `rasterRebuildSummary.byReason`
  rebuild reason distribution
- `nodePatchSummary.patchesPerSecond`
  direct node patch pressure
- `nodePatchSummary.maxAttemptsPerNode`
  same-node patch pressure; high values during one import indicate merge failure
- `nodesReferenceSummary.changesPerSecond`
  React Flow nodes array replacement rate
- `nodePatchQueueSummary.maxPendingCount`
  maximum queued node patch pressure
- `nodePatchQueueSummary.maxFlushDurationMs`
  slowest patch queue flush
- `moveEndSummary.maxVisibilityApplyMs`
  drag-release visibility apply cost
- `moveEndSummary.maxResourceScheduleMs`
  drag-release deferred resource scheduling cost
- `moveEndSummary.maxPatchQueueFlushMs`
  drag-release patch queue cost
- `moveEndSummary.maxWorkflowViewportSyncMs`
  drag-release viewport-only workflow sync cost

## How To Distinguish Root Causes

### Preprocessing is slow

Signals:

- `enhancementMs` is high
- `stageSummary` shows high `enhancement-preprocess.totalMs` or `maxMs`
- `runtimeSyncTotalMs` is low relative to `enhancementMs`

Interpretation:

- worker-side or file preprocessing path is the main bottleneck

### Runtime write-back is slow

Signals:

- `runtimeSyncCount` is high during one batch
- `runtimeSyncTotalMs` is high
- `runtimeSyncMaxMs` is high
- `runtimeSyncs` show large `snapshotBuildMs`, `metadataNormalizeMs`, or `actionCommitMs`

Interpretation:

- main-thread snapshot rebuild / normalize / write-back is the main bottleneck

### Main thread is blocked

Signals:

- `longTaskCount > 0`
- `maxLongTaskMs` is large
- long tasks overlap with placeholder insertion, hydration, or write-back spikes

Interpretation:

- import flow is producing blocking work on the browser main thread

### Thumbnail ready is late or missing

Signals:

- `thumbnailReadyTargetCount > thumbnailReadyNodes`
- `firstCanvasThumbnailReadyMs` is reasonable but `allCanvasThumbnailReadyMs` is absent or very high
- `canvas-thumbnail-ready` stage count is below image node count

Interpretation:

- import completed, but some image thumbnails still did not become canvas-usable in time

## Recommended Manual Flow

1. Call `window.__CANVAS_IMAGE_PERF_RESET__()`.
2. Import one controlled batch of images or mixed files.
3. Wait until the import progress UI finishes.
4. Pan and zoom the imported image cluster for 30 seconds.
5. Move the image cluster fully offscreen and back onscreen 20 times.
6. Read `window.__CANVAS_IMAGE_PERF_DEBUG__()` and `window.__CANVAS_IMAGE_PERF_SUMMARY__()`.
7. Compare `enhancementMs`, `runtimeSyncTotalMs`, `longTaskCount`, and `renderPlanPressure.status`.
8. Inspect `runtimeSyncs` if write-back looks suspicious.
9. Inspect `stages` if one specific phase looks abnormal.

## Batch Import Load-Shedding Checks

Run the same image set twice:

1. Import while the target area is inside the current viewport.
2. Reset metrics and import while the target area is far outside the current viewport.
3. Repeat for 20, 50, and 100 images.
4. During each import, continuously pan and zoom for 15 seconds.
5. Record the import progress result and whether the canvas remains interactive.

Expected:

- In-viewport import should no longer be tens of times slower than offscreen import.
- Import progress should keep correct `completed`, `failed`, and `total` values.
- `node-hydration.maxMs` should not show one long continuous main-thread block.
- `canvas-thumbnail-ready` may spread over more frames, but pan/zoom must remain usable.
- `longTaskCount` should stay low during steady import; repeated long tasks over 50 ms or any long task over 120 ms needs investigation.
- `imageManagerEmitSummary.emitsPerSecond` should not grow linearly with visible importing node count.
- `rasterRebuildSummary.totalRebuilds` should not match the number of individual image loading events.
- `nodePatchQueueSummary.flushCount` should grow by frame batches, while `nodePatchSummary.maxAttemptsPerNode` should stay low for same-node import results.

Record:

| Images | Placement | Total ms | Enhancement ms | Hydration max ms | Thumbnail ready all ms | Emit/sec | Raster rebuilds | Patch queue max | Long task max ms | Interaction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | in viewport | | | | | | | | | |
| 20 | offscreen | | | | | | | | | |
| 50 | in viewport | | | | | | | | | |
| 50 | offscreen | | | | | | | | | |
| 100 | in viewport | | | | | | | | | |
| 100 | offscreen | | | | | | | | | |

Final acceptance:

- In-viewport imports must not be tens of times slower than offscreen imports.
- Import progress must finish with correct `completed + failed === total`.
- During import, pan/zoom must remain usable and release-mouse should not produce a visible pause.
- Visible importing image nodes should appear as compact/proxy unless active.
- Thumbnail apply can spread over more frames; correctness is more important than applying every thumbnail immediately.
- Single-frame long tasks must not stay above 50 ms during steady interaction.
- `imageManagerEmitSummary.emitsPerSecond` must stay bounded when visible importing count increases.
- `rasterRebuildSummary.byReason` must show batch or viewport-driven rebuilds, not one rebuild per image resource event.
- `nodePatchQueueSummary.pendingCount` must drain after import settles.

## Post-Import Render Plan Pressure

Record these fields after large image import, once with 100 nodes, once with 500 nodes, and once with 1000 nodes:

- `renderPlanPressure.scale`
- `renderPlanPressure.status`
- `renderPlanPressure.watchReasons`
- `cache.visibleEntryCount`
- `cache.nearViewportEntryCount`
- `cache.thumbnailByteUsageRatio`
- `.react-flow__node` DOM count
- subjective pan/zoom result

Expected:

- 100-node import has no visible interaction regression.
- 500-node image-heavy import remains smooth enough for repeated pan/zoom.
- 1000-node import has a recorded pressure result; `fail` requires follow-up before release unless caused by a one-time import spike.

## Task 10 Parameter Record

Record the constants used for each run before tuning:

| Parameter | Current value | Candidate values | Selected value | Reason |
| --- | --- | --- | --- | --- |
| `IMAGE_VISIBILITY_OVERSCAN` | `360` | `240`, `360`, `480` | | |
| `IMAGE_VISIBILITY_CANDIDATE_RETENTION_MS` | `6000` | `3000`, `6000` | | |
| `IMAGE_VISIBILITY_IMPORTING_CANDIDATE_RETENTION_MS` | `1200` | `800`, `1200` | | |
| `CANVAS_NODE_PATCH_QUEUE_MAX_PER_FRAME` | `8` | `4`, `8` | | |
| passive raster batch / concurrency | `8 / 4` | `4 / 2`, `8 / 4` | | |
| importing raster batch / concurrency | `2 / 2` | `1 / 1`, `2 / 2` | | |

Tuning rules:

- Change one parameter group per run.
- Keep the current values unless the 50 or 100 image run shows repeated long tasks, request pressure, or queue pressure.
- Prefer lowering importing raster batch and concurrency to `1 / 1` before changing overscan.
- Do not change `onlyRenderVisibleElements={false}` as part of performance tuning.
