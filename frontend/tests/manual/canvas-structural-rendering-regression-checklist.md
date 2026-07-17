# Canvas Structural Rendering Regression Checklist

## Scope

Validate the structural rendering changes before release:

- active/passive node promotion
- FileNodeProxy routing
- passive image raster layer
- spatial-index hit test
- drag-time raster transform
- ReactFlow node data stabilization
- offscreen passive DOM windowing

## Preconditions

- Run the frontend in development mode.
- Open DevTools Console.
- Prepare a workflow with at least 100 image nodes, including remote/protected images if available.
- Prepare a local import batch with 50 or more images.
- Before each scenario, reset diagnostics:

```js
window.__CANVAS_IMAGE_PERF_RESET__?.()
```

Enable diagnostics when collecting metrics:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__?.({ verbose: false, autoReport: false })
```

Read summary:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__?.()
```

Read image manager state:

```js
window.__IMAGE_MANAGER_DEBUG__?.()
```

Read flicker diagnostics:

```js
window.__CANVAS_IMAGE_FLICKER_DEBUG__?.()
```

## Automated Gate

Confirm these test groups passed before manual checks:

- `Canvas.import-thumbnail-runtime.spec.js`
- `FileNode.thumbnail-display.spec.js`
- `FileNode.save.spec.js`
- `FileNode.stress.spec.js`
- `FileNodeProxy.spec.js`
- `canvas-active-node-state.spec.js`
- `canvas-runtime-visual-state.spec.js`
- `canvas-node-spatial-index.spec.js`
- `canvas-hit-test.spec.js`
- `canvas-node-promotion.spec.js`
- `canvas-image-raster-draw.spec.js`
- `canvas-image-raster-layer.spec.js`
- `canvas-raster-image-resource-bridge.spec.js`
- `canvas-node-dom-windowing.spec.js`
- `drag-visibility-scheduler.spec.js`
- `canvas-drag-render-coordinator.spec.js`
- `viewport-image-scheduler.spec.js`
- `viewport-sync.spec.js`
- `import-batch.spec.js`
- `WorkflowContext.image-stability.spec.js`
- `WorkflowContext.persistence.spec.js`
- `image-manager.spec.js`
- `image-manager.flicker.spec.js`
- `image-cache.spec.js`
- `workflow-upload-scheduler.spec.js`
- `protected-resource.spec.js`
- `protected-resource-pool.spec.js`

## Manual Scenarios

### 1. Large Import

1. Import at least 50 local images into an empty workflow.
2. Pan and zoom while the import batch is still running.
3. Wait for import completion.

Expected:

- Placeholder nodes appear quickly.
- Imported image nodes show stable loading placeholders before thumbnail enhancement finishes.
- No large blank region remains after drag stops.
- Import completion does not roll thumbnails back to empty state.

### 2. Dense Drag After Import

1. Use a workflow with at least 100 image nodes.
2. Drag the canvas across dense image regions for 10 to 20 seconds.
3. Zoom in and out across dense image regions.

Expected:

- Drag stays responsive.
- Visible passive images are rendered by the raster layer when not active.
- Far passive nodes show lightweight proxy instead of full FileNode.
- Extremely offscreen passive nodes do not stay mounted in ReactFlow DOM.
- Returning to a dense region restores proxy or full FileNode without visual corruption.

### 3. Active Promotion

1. Click, double-click, hover, and right-click passive image nodes.
2. Double-click a passive image node to open viewer.
3. Right-click a passive image node to open context menu.
4. Select a node that was previously offscreen and pan back to it.

Expected:

- Passive node promotes to full FileNode before interactive behavior runs.
- Viewer opens with existing original-resource semantics.
- Right-click menu target is correct.
- Selection state is preserved across proxy, raster, and DOM-windowed states.

### 4. Save And Reload

1. Save immediately after dragging and after opening/closing viewer.
2. Reload the workflow.
3. Reopen the same area and compare positions, thumbnails, and selected state expectations.

Expected:

- Workflow saves without missing detached nodes.
- Reloaded workflow contains all nodes and connections.
- Runtime-only fields such as `renderTier`, `activeState`, `activeReasons`, and runtime thumbnail handles are not persisted.
- Remote images reload thumbnail-first and remain original-on-viewer only.

### 5. Protected Resources

1. Open a workflow with protected remote images.
2. Pan away from and back to protected nodes.
3. Open viewer on a protected image.
4. Close viewer and continue panning.

Expected:

- Raster layer and FileNode reuse existing protected resource lifecycle.
- `original` resource is requested only by viewer path.
- No repeated object URL creation/revocation storm.
- No broken image after returning from offscreen detached state.

### 6. Upload State

1. Import local images that require backend upload.
2. Observe upload progress on active/uploading nodes.
3. Drag the canvas while upload status changes.

Expected:

- Uploading nodes remain active/full where needed.
- Stable nodes are not re-rendered by unrelated upload state changes.
- Upload failure and completion remain visible on the correct nodes.

## Metrics To Capture

Record these before and after structural rendering changes if a baseline is available:

- DOM node count around `.react-flow__node`
- `fileNodeRenderSummary.totalRenders`
- `fileNodeRenderSummary.maxCommitDurationMs`
- `subscriptionSummary.canvasSubscriptions`
- `subscriptionSummary.originalSubscriptions`
- `dragVisibilitySummary.totalComputations`
- `longTaskSummary.count`
- `longTaskSummary.maxDurationMs`
- image manager `cache.stats.thumbnailEntryCount`
- image manager `cache.stats.objectUrlEntryCount`

Expected trend:

- DOM node count drops when most nodes are offscreen passive.
- FileNode render count drops during drag.
- Original subscriptions stay near zero until viewer opens.
- Long task count and max duration reduce during dense drag.

## Release Record Template

- Build / branch:
- Browser / OS:
- Dataset size:
- Local images:
- Remote/protected images:
- Dense drag result:
- Import-during-drag result:
- Viewer result:
- Context menu result:
- Upload result:
- Save/reload result:
- Protected resource result:
- Perf summary:
- Image manager summary:
- Remaining risks:

## Residual Risks

- Browser DevTools and development logging can affect frame rate; collect at least one run with diagnostics disabled.
- DOM node count is browser-renderer dependent, so compare relative trend against the same browser and dataset.
- Worker visibility mode and main-thread fallback should both be checked before release if the worker flag is used.
