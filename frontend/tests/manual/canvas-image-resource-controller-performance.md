# Canvas Image Resource Controller Performance Check

## Goal

Validate that visible image resource registration, request, cancellation, priority, and ready snapshot commits are controlled by the canvas resource controller instead of per-node raster subscriptions.

## Setup

Run in development mode:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__?.({ verbose: false, autoReport: false })
window.__CANVAS_IMAGE_PERF_RESET__?.()
```

React Flow must remain configured with `onlyRenderVisibleElements={false}`.

## Scenarios

| Scenario | Steps | Required result |
| --- | --- | --- |
| Passive visible importing | Import 50 images into the viewport without selecting nodes. | Passive importing nodes show proxy/loading and do not all request raster resources. |
| Priority promotion | Select one importing image, hover another, and open one in the viewer. | Selected, hovered, and active nodes load before passive importing nodes. |
| Offscreen cancellation | Pan importing candidates fully offscreen before thumbnails settle. | Queued or in-flight passive work is cancelled, and offscreen importing nodes do not keep requesting. |
| Runtime thumbnail ready | Let thumbnail worker finish while patch queue is still draining. | Ready runtime thumbnails enter raster ready output without waiting for node data patch flush. |
| Viewport return | Pan ready image nodes offscreen and back 20 times. | Ready raster items return aligned with nodes and remain clickable/selectable. |

## Metrics To Record

After each scenario:

```js
const summary = window.__CANVAS_IMAGE_PERF_SUMMARY__?.()
summary?.rasterSummary
summary?.rasterRebuildSummary
summary?.imageManagerEmitSummary
summary?.subscriptionSummary
summary?.nodePatchQueueSummary
summary?.moveEndSummary
```

Record:

- `rasterSummary.maxCandidateNodeCount`
- `rasterSummary.maxRegisteredNodeCount`
- `rasterSummary.maxRequestedNodeCount`
- `rasterRebuildSummary.totalRebuilds`
- `rasterRebuildSummary.byReason`
- `imageManagerEmitSummary.canvasEmitsPerSecond`
- `subscriptionSummary.canvasSubscribeCalls`
- `subscriptionSummary.peakSubscriptions`
- `nodePatchQueueSummary.maxPendingCount`
- `moveEndSummary.maxResourceScheduleMs`

## Acceptance

- Resource requests are bounded by controller scheduling budgets.
- Passive importing images without ready runtime thumbnails do not create raster request pressure.
- Selected, hovered, and active importing images are promoted quickly.
- Leaving the candidate set cancels queued or in-flight passive resource work.
- Raster rebuilds follow batch ready snapshot commits, viewport changes, and canvas size changes.
- `CanvasImageRasterLayer` does not reintroduce per-node `imageManager.subscribe()` behavior.

## Result Record

| Scenario | Registered max | Requested max | Emit/sec | Rebuilds | Peak subscriptions | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Passive visible importing | | | | | | |
| Priority promotion | | | | | | |
| Offscreen cancellation | | | | | | |
| Runtime thumbnail ready | | | | | | |
| Viewport return | | | | | | |
