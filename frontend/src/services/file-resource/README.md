# File Resource Boundary

`FileResourceService` is the single entry point for original-file resolution.

New code that needs an original file, blob, object URL, display URL, or backend file id must call `resolveFileResource()` with the correct purpose and the current `workflowId`/`authScope` whenever that scope is available:

- `viewer-original`
- `inpaint-editor-original`
- `upload-input`
- `export-original`
- `prompt-reference`
- `runtime-output`

Canvas thumbnails must use `canvas-thumbnail` and must not fall back to original/download resources.

Export is scope-sensitive. Any caller of `fileExportService.exportNodeFile()` must pass the active `workflowId`; export resolution then passes `workflowId` and `authScope` into `resolveFileResource()` so registry, manifest, runtime, and backend bindings cannot cross workflows or sessions.

Task History image input previews are display-only thumbnails. They may use `thumbnailUrl`, `previewUrl`, and non-ephemeral thumbnail/preview paths, but must not use `downloadUrl`, original file paths, or stale blob/object URLs as image fallback. Video and 3D input previews may keep download fallback because their preview surface needs the playable/downloadable artifact.

Do not call these lower-level APIs from component, hook, node, adapter, upload, export, or prompt feature code:

- `getFileNodeImageOriginalUrl`
- `fetchProtectedResourceBlob('/download')`
- `imageOriginalSourceRegistry.getOrCreateObjectUrl`

Allowed direct runtime callers are limited to low-level file resource internals, protected-resource internals, execution runtime sync, and image asset helpers. Specs may use these APIs only when they test the low-level service itself. The boundary spec fails when a new direct caller appears outside the allowlist or when a feature path stops passing through `FileResourceService`.
