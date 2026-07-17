# Local Archive Boundary

## Boundary

- `local-workflow-archive.ts` and `local-workflow-assets.ts` are auxiliary local import/export helpers.
- They embed selected local files into exported archive JSON and restore those files when a local archive is imported.
- They are not the source of truth for backend workflow persistence, backend task history, or backend upload scheduling.
- They do not persist browser `FileSystemFileHandle` objects. FSA handles are stored only by `local-file-source-store.ts`.

## Resource Priority

- Canvas thumbnail display prefers runtime thumbnail data first, then persistent/browser cache, then backend `/thumbnail` or `/preview` fallback.
- Viewer original display prefers a restored runtime local original first, including an FSA-restored file, then backend `/download`.
- A local archive import can register a runtime original for the current session, but it does not create a persistent local source for future backend workflow reopen.
- Pure browser reopen without a persisted FSA handle cannot guarantee "prefer local original after reopen"; the system must fall back to backend resources or ask the user to rebind.

## Source Metadata Rules

- `sourceDisplayName` is the user-facing source name.
- `originalPath` is legacy compatibility metadata only. Filename-only legacy values are migrated into `sourceDisplayName` and are not retained as a path.
- Path-like legacy `originalPath` values may be preserved for compatibility, but they are not treated as a recoverable local file reference.
- `localSource.status = available` means a local file has been restored in the current session.
- `localSource.status = linked` means a persistent reference exists but has not been restored in this session.
- `localSource.status = runtime-only` means the local source is available only for the current browser session.

## Archive Registry Scope

- Archive registry is populated during local file import so auxiliary local archive export can embed original files.
- Archive registry is restored when importing an embedded local archive.
- Restored archive files are marked with `localSource.status = runtime-only` and `localSource.kind = runtime`.
- Embedded asset metadata carries `localSourceBoundary = runtime-only-archive` and `localSourceScope = archive-import-runtime`.
- Archive registry must not be used by new main-chain workflow, file, execution, or history logic.

## Runtime Upload Source

- Immediate backend upload uses node-resolved resource URLs or runtime file sources registered during local import.
- Runtime file sources are managed in `backendFileService.ts`.
- Runtime file source cache is cleaned when nodes are removed or no longer present in the current workflow graph.
- Backend upload intentionally does not fall back to the local archive registry when no runtime source is present.

## Manual Checks

- Export a local archive after import and verify embedded asset metadata has `localSourceBoundary = runtime-only-archive`.
- Import that archive and verify the node shows a session-only local source, not an FSA-linked source.
- Save and reopen through backend workflow APIs and verify no embedded binary data or FSA handle objects are serialized into `workflow.json`.
- Load a legacy workflow with `originalPath = file.name` and verify the UI uses it only as `sourceDisplayName`.
