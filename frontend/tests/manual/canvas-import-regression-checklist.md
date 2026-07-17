# Canvas Import Regression Checklist

## Scope

This checklist is for release validation of the recent canvas import optimizations:

- stable placeholder to runtime thumbnail transition during import
- import runtime snapshot batching
- bounded metadata probe and thumbnail enhancement concurrency
- runtime-only thumbnail/original stores instead of workflow-persisted transient urls
- local source recovery after save/reopen with and without File System Access support
- legacy `originalPath = file.name` migration into source display metadata

Use it together with [canvas-import-performance.md](/D:/Project/newflow5/newworkflow2/frontend/tests/manual/canvas-import-performance.md).

## Preconditions

- run the frontend in development mode
- open the target canvas page
- open DevTools Console
- prepare one large import set:
  20 to 50 local image files
- prepare one mixed import set:
  images plus a few videos if the canvas supports both

## Automated Gate

Confirm these regression groups passed before manual checks:

- `Canvas.import-thumbnail-runtime.spec.js`
- `image-import-coordinator.spec.ts`
- `image-thumbnail-runtime-store.spec.ts`
- `image-original-source-registry.spec.ts`
- `image-thumbnail-worker-pipeline.spec.ts`
- `WorkflowContext.image-stability.spec.js`
- `WorkflowContext.persistence.spec.js`
- `image-manager.spec.js`
- `FileNode.stress.spec.js`
- `import-batch.spec.js`

## Manual Validation Flow

### 1. Reset debug state

Run:

```js
window.__CANVAS_IMAGE_PERF_RESET__?.();
```

### 2. Large image import

Import the large image set in one batch.

Expected:

- placeholder nodes appear quickly
- imported image nodes stay on stable loading or unavailable placeholders until thumbnail is ready
- no large area of blank white/empty image cards remains on canvas

### 3. Move canvas during import

While the same batch is still importing:

- pan the canvas repeatedly
- zoom in and out
- move the viewport away and back to the imported cluster

Expected:

- thumbnails continue to appear
- imported nodes that briefly leave viewport do not stay blank for a long time
- no obvious thumbnail rollback from ready state back to empty state

### 4. Mixed import batch

Import the mixed image and video set.

Expected:

- image nodes get runtime thumbnail progressively without blocking interaction
- video nodes keep expected thumbnail/preview behavior
- completion and failure counts still match actual files

### 5. Save after import

After batch completion, save the workflow.

Expected:

- save completes normally
- no unusual long freeze during save
- workflow remains visually unchanged after save

### 6. Reload after save

Reload the page or re-open the same workflow.

Expected:

- imported image nodes load without dependency on stale runtime thumbnail/original refs
- if FSA is unsupported or no handle was stored, nodes use remote thumbnail and backend original semantics
- if FSA handle restoration succeeds, viewer prefers the restored local original while canvas may still use thumbnail cache or backend thumbnail
- no missing thumbnail caused by reload

### 7. FSA supported reopen

Use a browser with File System Access support and import through the FSA-capable picker.

Expected:

- imported node source shows a restorable local source reference
- save payload stores stable local source metadata, not a real disk path or handle object
- after reload, permission restoration changes the node to local source available
- viewer opens the local original before backend `/download`

### 8. FSA unavailable or denied

Repeat reload in a browser without FSA support, or deny/revoke file permission before reopening.

Expected:

- canvas still shows backend thumbnail or cached thumbnail
- viewer falls back to backend `/download`
- node UI exposes permission-required, missing, or rebind state instead of silently pretending a path exists

### 9. Legacy originalPath compatibility

Open a workflow whose imported node has `source.originalPath` equal to the file name only.

Expected:

- workflow loads without validator or normalizer errors
- file node source display uses that value as a display name
- UI does not label it as a real local disk path
- saving the workflow removes the filename-only `originalPath` field

## Debug Checks

Read the snapshot:

```js
const perf = window.__CANVAS_IMAGE_PERF_DEBUG__?.();
perf
```

Validate:

- `perf.importBatches[0].thumbnailReadyNodes` reaches `thumbnailReadyTargetCount`
- `perf.importBatches[0].runtimeSyncCount` is not inflated per imported node
- `perf.importBatches[0].longTaskCount` does not show repeated blocking spikes

Check runtime sync detail:

```js
perf.runtimeSyncs
```

Validate:

- imported batches are attributed by `batchId`
- write count is frame/batch merged rather than node-by-node explosion

Check flicker snapshot:

```js
window.__CANVAS_IMAGE_FLICKER_DEBUG__?.()
```

Validate:

- no suspicious release/request loop spike during stable viewport after import settles

## Persistence Spot Check

After import and save, inspect a saved workflow payload or save callback capture if available.

Expected:

- imported image nodes do not persist runtime thumbnail/original handles
- imported image nodes do not persist large temporary `blob:` or `runtime:` urls
- workflow retains stable remote fallback metadata or restorable local source references after reload normalization
- workflow does not persist `FileSystemFileHandle` objects, embedded archive binary data, or filename-only `originalPath`

## Release Notes Template

Record the result in this format:

- Build / branch:
- Import dataset used:
- Large import result:
- Move-during-import result:
- Save result:
- Reload result:
- FSA supported result:
- FSA denied/unsupported result:
- Legacy originalPath result:
- Debug metrics summary:
- Remaining anomalies:

## Known Residual Risks

- Manual validation still depends on representative local hardware and browser load.
- Very large mixed batches may still show isolated late thumbnail readiness if the browser throttles background work.
- Dev-only debug hooks are not available in production builds, so evidence should be captured before release build sign-off.
