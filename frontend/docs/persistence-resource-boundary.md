# Persistence Resource Boundary

This document defines the workflow persistence resource boundary for frontend save, hydrate, and runtime snapshot flows.

## Scope

This boundary applies to:

- `buildWorkflowWithRuntime(...)`
- `normalizeWorkflowForPersistence(...)`
- `hydrateWorkflowFromApiDetail(...)`
- `saveRuntimeSnapshotWithMaterialization(...)`

The goal is to keep workflow persistence stable and reproducible:

- persist stable metadata
- strip transient runtime-only resources
- rebuild remote resources only where the node type and source policy allow it
- keep `output-link` graph data intact

## Source Classes

### Imported Local Source

- `localSource.status = linked`
  A persistent local reference exists, but it is not restored into the current session runtime yet.
- `localSource.status = available`
  A persistent local reference exists and has already been restored in the current session.
- `localSource.status = runtime-only`
  A local file is available only for the current browser session and cannot be restored after reopen.

### Remote / Produced Source

- `source.type = node-output`
  File is produced by node execution and may use backend remote resources.

## Resource Classes

- Runtime-only URL
  `blob:`, `data:`, `file:`, `runtime:`
- Stable backend resource URL
  `/api/v1/files/<fileId>/thumbnail`
  `/api/v1/files/<fileId>/preview`
  `/api/v1/files/<fileId>/download`
- Image resource container
  `imageAsset.variants.thumbnail`
  `imageAsset.variants.original`

## Rules Matrix

### Runtime Snapshot -> Workflow (`buildWorkflowWithRuntime`)

| Node / Source | `previewUrl` | `thumbnailUrl` | `imageAsset` |
| --- | --- | --- | --- |
| Image + remote / node-output | clear | keep stable remote thumbnail only | keep stable remote `thumbnail` and `original` only |
| Image + imported local `linked` | clear | clear | clear variants |
| Image + imported local `available` | clear | clear | clear variants |
| Image + imported local `runtime-only` | clear | clear | clear variants |
| Video | keep stable remote preview | keep stable remote thumbnail | not applicable |
| PLY | keep stable preview if present | keep stable thumbnail if present | not applicable |

Additional runtime-only UI state always clears:

- `renderTier`
- `activeState`
- `activeReasons`

### Workflow -> API Payload (`normalizeWorkflowForPersistence`)

All file nodes must strip these fields from the payload:

- `previewUrl`
- `thumbnailUrl`
- `imageAsset`
- `file`
- `localFile`
- `objectUrl`
- `localState`

Persisted payload stores stable metadata only:

- source metadata
- task metadata
- file identity
- node geometry / workflow graph data

### API Detail -> Hydrated Workflow (`hydrateWorkflowFromApiDetail`)

| Node / Source | `previewUrl` | `thumbnailUrl` | `imageAsset` |
| --- | --- | --- | --- |
| Image + remote / node-output | clear | rebuild backend thumbnail | rebuild remote `thumbnail` and `original` |
| Image + imported local `linked` | clear | clear | clear variants |
| Image + imported local `available` | clear | clear | clear variants |
| Image + imported local `runtime-only` | clear | rebuild backend thumbnail | rebuild remote `thumbnail` and `original` |
| Video | keep stable remote preview | keep stable remote thumbnail when remote fallback is allowed | not applicable |

Notes:

- Images never keep `previewUrl` after hydration.
- Linked and available imported local image sources remain metadata-only after reopen.
- Runtime-only imported local image sources are not recoverable after reopen, so image rendering falls back to backend remote resources.

## Image / Video Difference

Image nodes and video nodes do not share the same persistence rules.

### Image Nodes

- `previewUrl` is always treated as runtime-only or non-canonical and must not survive persistence/hydration.
- Canvas rendering should depend on `thumbnail` plus `imageAsset` remote rebuild when allowed.
- Local imported image nodes with restorable persistent handles (`linked` / `available`) must not silently switch to backend remote image resources after save/reopen.

### Video Nodes

- Stable backend `previewUrl` is legitimate persisted runtime state after snapshot save and legitimate hydrated state after reopen.
- `thumbnailUrl` may remain for non-image file nodes where remote fallback is allowed.

## Output-Link Rule

Persistence must preserve the workflow graph independently from resource cleanup.

These fields must survive save and restore:

- `connection.type = output-link`
- `connection.sourceId`
- `connection.targetId`
- `connection.sourceHandle`
- `connection.order`

Hydration may repair missing `node-output` file source task metadata by following the `output-link` graph, but it must not delete or rewrite the connection itself.

## Save Wrapper Rule

`saveRuntimeSnapshotWithMaterialization(...)` is not a resource cleanup layer.

It may:

- ensure the workflow is materialized first
- forward the exact runtime snapshot to the actual save implementation

It must not:

- mutate `previewUrl`
- mutate `thumbnailUrl`
- mutate `imageAsset`
- rewrite `output-link`

## Regression Coverage

Current regression coverage should include:

- remote image persistence cleanup
- linked local image persistence cleanup
- runtime-only image object URL cleanup
- image vs video resource difference
- payload stripping before API save
- hydrate rebuild for remote images
- hydrate no-fallback behavior for linked local images
- output-link save and restore integrity
- save-wrapper pass-through behavior

Reference tests:

- `src/components/context/WorkflowContext.persistence.spec.tsx`
- `src/services/workflow-file-normalizer.spec.ts`
- `src/components/context/workflow-save.spec.ts`
