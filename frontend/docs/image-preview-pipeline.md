# Image Preview Pipeline

## Goals

- Keep imported image nodes visually stable while thumbnails and previews are generated.
- Avoid persisting transient `blob:`, `data:`, `file:`, or `runtime:` URLs into workflow data.
- Prefer local originals only when an actual runtime file source is available.
- Fall back to backend resources predictably when local source recovery is unavailable or permission is lost.

## Resource Priority

- Canvas thumbnail: runtime thumbnail store, then persistent protected-resource cache, then backend `/thumbnail`, then backend `/preview` if configured.
- Canvas preview: runtime preview if present, then persistent cache, then backend `/preview` or `/download` according to node type.
- Viewer original: runtime local original or FSA-restored file, then backend `/download`, then rebind or permission prompt.
- Local archive import: restored archive file is session-only and treated as `localSource.status = runtime-only`.

## Local Source States

- `runtime-only`: a local file is available only in the current browser session. It is not recoverable after backend save/reopen.
- `linked`: a stable reference exists, usually an FSA reference id, but it has not been restored in this session.
- `available`: the linked file was restored in this session and viewer can prefer the local original.
- `permission-required`: an FSA handle exists but permission must be granted again.
- `missing` or `unknown`: local recovery cannot be trusted; remote resources remain the fallback.

Only `available` suppresses remote fallback during hydration. `linked` keeps metadata for recovery, but backend `/thumbnail`, `/preview`, and `/download` remain valid fallbacks until restoration succeeds.

## Persistence Rules

- Workflow save strips runtime URLs and runtime image variants.
- Backend workflow persistence stores stable metadata only, including `sourceDisplayName` and local source reference status.
- `available` is downgraded to `linked` when persisted so reopening must explicitly restore permission and file access.
- Filename-only legacy `originalPath` values are migrated to `sourceDisplayName` and are not treated as disk paths.
- Path-like legacy `originalPath` values may remain as compatibility metadata, but they are not used as a recoverable file handle.

## Browser Boundary

- Browsers that support File System Access can restore a local original after reopen only if a persisted handle exists and permission is granted or reauthorized.
- Browsers without File System Access can keep local originals only for the current runtime session or via explicit local archive import.
- Pure browser code cannot recover an arbitrary real disk path after reopen from a filename string.
- Permission loss must degrade to backend resources and show a recoverable UI state instead of breaking canvas display.

## Debug Signals

Use `imageManager.getDebugSnapshot()` or `window.__IMAGE_MANAGER_DEBUG__?.()` to observe:

- `features.canvasDisplayUrlLoading`
- `features.visibilityScoring`
- `cache.stats.previewEntryCount`
- `cache.stats.decodedReleaseCount`
- `cache.stats.retryRecoveredCount`
- `inflightRequests.length`
- `states[].lastEventKind`

Compare these metrics across import, save/reopen, pan/zoom, offscreen return, and permission-loss scenarios.

## Regression Scenarios

1. Import 20 to 50 local images, then pan and zoom during thumbnail generation.
2. Save and reopen with FSA support enabled; verify restored `available` local source makes viewer prefer local original.
3. Save and reopen without FSA support; verify backend thumbnails and downloads render without relying on local runtime files.
4. Revoke or deny FSA permission; verify `permission-required` state, remote fallback, and reauthorization or rebind path.
5. Export and import a local archive; verify restored files are runtime-only and do not become persistent FSA handles.
6. Load a legacy workflow with `originalPath = file.name`; verify it becomes source display text only.

## Rollback

- `visibility scoring scheduling` can be disabled with `VITE_IMAGE_VISIBILITY_SCORING=false` or `ImageManagerOptions.enableVisibilityScoring`.
- `canvas display-url loading` can be disabled with `VITE_IMAGE_CANVAS_DISPLAY_URL_LOADING=false` or `ImageManagerOptions.enableCanvasDisplayUrlLoading`.
- Disabling these preview optimizations must not change persistence semantics or local-source recovery fallback behavior.
