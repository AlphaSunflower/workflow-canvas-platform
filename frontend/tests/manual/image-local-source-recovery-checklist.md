# Image Local Source Recovery Checklist

## Scope

Use this checklist before release when validating imported image recovery after save, reopen, local archive import, rebind, and File System Access permission changes.

## Preconditions

- Prepare one small PNG or JPG, one large PNG or JPG, and one intentionally mismatched file.
- Prepare one saved workflow created before the `originalPath` migration where `source.originalPath` equals the file name only.
- Test at least one browser with File System Access support and one unsupported or disabled environment.
- Keep DevTools Network open with cache behavior visible.

## Automated Gate

- `src/services/workflow-file-normalizer.spec.ts`
- `src/services/local-archive-boundary.spec.ts`
- `src/services/local-file-source-store.spec.ts`
- `src/services/local-file-rebind.spec.ts`
- `src/services/image/image-node.spec.ts`
- `src/components/context/WorkflowContext.persistence.spec.tsx`

## Manual Matrix

### 1. FSA Import And Reopen

Steps:

- Import an image through the FSA-capable local picker.
- Save the workflow.
- Reload or reopen the same backend workflow.
- Grant permission if prompted.
- Open the image viewer.

Expected:

- Workflow data contains `sourceDisplayName` and local source reference metadata.
- Workflow data does not contain a real disk path string or a serialized handle object.
- Reopen changes the node to local source available after permission succeeds.
- Viewer prefers the restored local original.
- Canvas thumbnails still load through runtime thumbnail, persistent cache, or backend fallback without flicker.

### 2. FSA Permission Denied Or Lost

Steps:

- Save a workflow with an FSA-linked image.
- Deny permission on reopen or revoke browser file permission before reopen.
- Open canvas and viewer.

Expected:

- Node remains visible using backend thumbnail or cached thumbnail.
- Viewer falls back to backend `/download`.
- UI shows permission-required, missing, or rebind state.
- The workflow is not silently rewritten as if the filename were a local path.

### 3. Unsupported Browser

Steps:

- Import and save in a browser or environment without FSA support.
- Reopen the backend workflow.

Expected:

- Local source is runtime-only during the import session.
- After reopen, remote thumbnail and original fallback are used.
- UI does not promise automatic local original recovery.

### 4. Manual Rebind Success

Steps:

- Open a workflow whose local source is missing or permission-required.
- Use "rebind local file".
- Select the matching original file.
- Open viewer.

Expected:

- File name, size, MIME, and hash checks pass when available.
- Runtime original source is registered.
- Viewer prefers the rebound local original.
- Existing backend file binding is not overwritten silently.

### 5. Manual Rebind Mismatch

Steps:

- Repeat rebind with the intentionally mismatched file.

Expected:

- Rebind is rejected with a clear error.
- Node keeps its previous backend fallback.
- No new runtime original is registered for the mismatched file.

### 6. Local Archive Export And Import

Steps:

- Import an image and export a local archive.
- Inspect embedded asset metadata.
- Import the archive into a fresh session.
- Save and reopen through backend workflow APIs.

Expected:

- Embedded metadata includes `localSourceBoundary = runtime-only-archive`.
- Archive import restores the file only as `localSource.status = runtime-only`.
- Archive import can show local runtime thumbnail/original in that session.
- Backend save/reopen does not treat archive-restored files as persistent FSA handles.

### 7. Legacy originalPath Migration

Steps:

- Load a historical workflow where imported source has `originalPath` equal to the file name.
- Open the file node property panel.
- Save and inspect the persisted node payload.

Expected:

- Workflow loads without crashing.
- File name is displayed as source display information.
- UI does not call the value a real original disk path.
- Save removes filename-only `originalPath`.
- Path-like legacy `originalPath` values, if present, remain only as compatibility metadata and are not used for automatic recovery.

### 8. Cache And Offscreen Return

Steps:

- Import or reopen a workflow with several images.
- Pan and zoom until image nodes leave the viewport.
- Return to the same nodes repeatedly.
- Refresh the browser and repeat.

Expected:

- Stable viewport avoids ready -> release -> request-started loops for the same thumbnail.
- Thumbnail and preview persistent cache reduces repeated network requests after refresh.
- Resource hash or version changes invalidate stale cache entries.
- Cache failures fall back to network and do not affect local original recovery priority.

## Sign-Off Record

- Build or branch:
- Browser and version:
- FSA import/reopen:
- Permission denied/lost:
- Unsupported browser:
- Rebind success:
- Rebind mismatch:
- Local archive import:
- Legacy originalPath migration:
- Cache and offscreen return:
- Remaining risks:
