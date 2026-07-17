# File Database Migration Field Mapping

This document is the field-level baseline for migrating the current JSON stores to the database-backed file and admin platform.

It freezes the migration scope for phase 1. If a later implementation discovers a field not listed here, the implementation must update this document before changing schema or repository behavior.

## 1. Source Stores

Phase 1 covers these JSON-backed sources:

- `backend/data/files/files-store.json`
- `backend/data/storage-index.json`
- `backend/data/accounts-store.json`
- `backend/data/executions-store.json`
- `backend/data/workflows/index.json`
- `backend/data/workflows/groups-index.json`
- `backend/data/workflows/{workflowId}/workflow.json`
- `backend/data/workflows/{workflowId}/files.json`
- `backend/data/workflows/{workflowId}/tasks.json`, if present
- `backend/data/workflows/{workflowId}/events/{taskId}.jsonl`, if present

Phase 1 keeps binary payloads in `backend/storage/**`; only metadata and relationships move to the database.

## 2. Mapping Decisions

Each field has one target decision:

- `structured`: move to a first-class database column.
- `jsonb`: preserve inside a JSONB payload because the shape is large, nested, or still evolving.
- `derived`: recompute or derive during migration/runtime.
- `legacy-only`: keep in backup JSON only; do not migrate.
- `deferred`: not used by phase 1 runtime, but reserved for a later task.

## 3. files-store.json

### 3.1 `blobs[]`

Target table: `file_blobs`

| JSON field | Target | Decision | Notes |
| --- | --- | --- | --- |
| `id` | `file_blobs.id` | structured | Physical blob id. |
| `sha256` | `file_blobs.sha256` | structured | Unique content hash. |
| `size` | `file_blobs.size` | structured | Original file size. |
| `mimeType` | `file_blobs.mime_type` | structured | Original MIME type. |
| `storageKey` | `file_blobs.storage_key` | structured | Original object key. |
| `storageProvider` | `file_blobs.storage_provider` | structured | Defaults to `local`. |
| `extension` | `file_blobs.extension` | structured | Original extension. |
| `width` | `file_blobs.width` | structured | Original width if available. |
| `height` | `file_blobs.height` | structured | Original height if available. |
| `duration` | `file_blobs.duration` | structured | Video/audio duration if available. |
| `previewStorageKey` | `file_blobs.preview_storage_key` | structured | Backward-compatible fast lookup. |
| `previewMimeType` | `file_blobs.preview_mime_type` | structured | Backward-compatible fast lookup. |
| `previewSize` | `file_blobs.preview_size` | structured | Backward-compatible fast lookup. |
| `previewWidth` | `file_blobs.preview_width` | structured | Backward-compatible fast lookup. |
| `previewHeight` | `file_blobs.preview_height` | structured | Backward-compatible fast lookup. |
| `thumbnailStorageKey` | `file_blobs.thumbnail_storage_key` | structured | Backward-compatible fast lookup. |
| `thumbnailMimeType` | `file_blobs.thumbnail_mime_type` | structured | Backward-compatible fast lookup. |
| `thumbnailSize` | `file_blobs.thumbnail_size` | structured | Backward-compatible fast lookup. |
| `thumbnailWidth` | `file_blobs.thumbnail_width` | structured | Backward-compatible fast lookup. |
| `thumbnailHeight` | `file_blobs.thumbnail_height` | structured | Backward-compatible fast lookup. |
| `createdAt` | `file_blobs.created_at` | structured | Preserve original creation time. |

Additional target table: `file_blob_variants`

For every blob:

- `storageKey` creates variant `original`.
- `previewStorageKey` creates variant `preview` when present.
- `thumbnailStorageKey` creates variant `thumbnail` when present.

### 3.2 `files[]`

Target table: `file_assets`

| JSON field | Target | Decision | Notes |
| --- | --- | --- | --- |
| `id` | `file_assets.id` | structured | Public backend `fileId`. |
| `userId` | `file_assets.user_id` | structured | Owner id. |
| `blobId` | `file_assets.blob_id` | structured | Nullable for pending or damaged legacy data. |
| `originalName` | `file_assets.original_name` | structured | Original upload/result name. |
| `displayName` | `file_assets.display_name` | structured | Display name. |
| `mimeType` | `file_assets.mime_type` | structured | Asset MIME type. |
| `fileType` | `file_assets.file_type` | structured | Must support `image`, `video`, `ply`, `unknown`. |
| `sourceType` | `file_assets.source_type` | structured | `input`, `intermediate`, `output`. |
| `status` | `file_assets.status` | structured | `pending_upload`, `ready`, `failed`, `deleted`. |
| `pendingUploadId` | `file_assets.pending_upload_id` | structured | Upload session id. |
| `sha256` | `file_assets.sha256` | structured | Denormalized lookup. |
| `size` | `file_assets.size` | structured | Denormalized lookup. |
| `extension` | `file_assets.extension` | structured | Denormalized lookup. |
| `width` | `file_assets.width` | structured | Denormalized lookup. |
| `height` | `file_assets.height` | structured | Denormalized lookup. |
| `duration` | `file_assets.duration` | structured | Denormalized lookup. |
| `previewReady` | `file_assets.preview_ready` | structured | Display optimization. |
| `previewWidth` | `file_assets.preview_width` | structured | Display optimization. |
| `previewHeight` | `file_assets.preview_height` | structured | Display optimization. |
| `thumbnailReady` | `file_assets.thumbnail_ready` | structured | Display optimization. |
| `thumbnailWidth` | `file_assets.thumbnail_width` | structured | Display optimization. |
| `thumbnailHeight` | `file_assets.thumbnail_height` | structured | Display optimization. |
| `createdAt` | `file_assets.created_at` | structured | Preserve original creation time. |

Migration also writes `file_events(event_type=legacy_file_asset_migrated)` for each migrated file asset.

### 3.3 `pendingUploads[]`

Target table: `file_uploads`

| JSON field | Target | Decision | Notes |
| --- | --- | --- | --- |
| `uploadId` | `file_uploads.id` | structured | Upload session id. |
| `fileId` | `file_uploads.file_id` | structured | Preallocated file asset id. |
| `userId` | `file_uploads.user_id` | structured | Owner id. |
| `sha256` | `file_uploads.sha256` | structured | Expected hash. |
| `size` | `file_uploads.size` | structured | Expected size. |
| `mimeType` | `file_uploads.mime_type` | structured | Expected MIME type. |
| `originalName` | `file_uploads.original_name` | structured | Original file name. |
| `displayName` | `file_uploads.display_name` | structured | Display file name. |
| `fileType` | `file_uploads.file_type` | structured | Same enum as file assets. |
| `sourceType` | `file_uploads.source_type` | structured | Same enum as file assets. |
| `width` | `file_uploads.width` | structured | Optional declared width. |
| `height` | `file_uploads.height` | structured | Optional declared height. |
| `duration` | `file_uploads.duration` | structured | Optional declared duration. |
| `createdAt` | `file_uploads.created_at` | structured | Preserve creation time. |

Derived fields:

- `status` becomes `pending`.
- `expires_at` is not backfilled in phase 1.

## 4. storage-index.json

Target table: `storage_objects`

This store is a compatibility inventory for Worker-written objects. It is not the future source of truth.

| JSON field | Target | Decision | Notes |
| --- | --- | --- | --- |
| `blobId` | `storage_objects.legacy_blob_id` | structured | Legacy Worker blob id, not always equal to `file_blobs.id`. |
| `sha256` | `storage_objects.sha256` | structured | Content hash. |
| `fileType` | `storage_objects.file_type` | structured | File type. |
| `sourceType` | `storage_objects.source_type` | structured | Source type. |
| `originalName` | `storage_objects.original_name` | structured | Original name. |
| `mimeType` | `storage_objects.mime_type` | structured | MIME type. |
| `storageProvider` | `storage_objects.storage_provider` | structured | Usually `local`. |
| `storageKey` | `storage_objects.storage_key` | structured | Unique with provider. |
| `absolutePath` | `storage_objects.absolute_path` | structured | Diagnostic only; not used for client access. |
| `size` | `storage_objects.size` | structured | Object size. |
| `extension` | `storage_objects.extension` | structured | Extension. |
| `width` | `storage_objects.width` | structured | Optional width. |
| `height` | `storage_objects.height` | structured | Optional height. |
| `createdAt` | `storage_objects.created_at` | structured | Preserve creation time. |

Phase 1 runtime must stop treating `storage-index.json` as a business index after DB write mode is enabled.

Migration warning handling:

- `storage_object_missing_legacy_blob`: allowed warning when `storage-index.json` references a `blobId` that is not present in `files-store.json.blobs[]`. The object is still imported into `storage_objects`, `legacy_blob_id` is set to `null`, and the original `storageKey` remains available for diagnostics. This warning must be reviewed during rehearsal, but it does not block migration when the object is not required by a `file_asset` or `task_file_link`.

## 5. accounts-store.json

### 5.1 `users[]`

Target table: `users`

| JSON field | Target | Decision |
| --- | --- | --- |
| `id` | `users.id` | structured |
| `email` | `users.email` | structured |
| `passwordHash` | `users.password_hash` | structured |
| `displayName` | `users.display_name` | structured |
| `role` | `users.role` | structured |
| `status` | `users.status` | structured |
| `lastLoginAt` | `users.last_login_at` | structured |
| `createdAt` | `users.created_at` | structured |
| `updatedAt` | `users.updated_at` | structured |

### 5.2 `sessions[]`

Target table: `refresh_tokens`

| JSON field | Target | Decision |
| --- | --- | --- |
| `id` | `refresh_tokens.id` | structured |
| `userId` | `refresh_tokens.user_id` | structured |
| `tokenHash` | `refresh_tokens.token_hash` | structured |
| `status` | `refresh_tokens.status` | structured |
| `issuedAt` | `refresh_tokens.issued_at` | structured |
| `expiresAt` | `refresh_tokens.expires_at` | structured |
| `rotatedFromSessionId` | `refresh_tokens.rotated_from_id` | structured |
| `revokedAt` | `refresh_tokens.revoked_at` | structured |
| `revokedReason` | `refresh_tokens.revoked_reason` | structured |
| `userAgent` | `refresh_tokens.user_agent` | structured |
| `ipAddress` | `refresh_tokens.ip_address` | structured |

### 5.3 `auditLogs[]`

Target table: `audit_logs`

| JSON field | Target | Decision |
| --- | --- | --- |
| `id` | `audit_logs.id` | structured |
| `actorUserId` | `audit_logs.actor_user_id` | structured |
| `actorRole` | `audit_logs.actor_role` | structured |
| `action` | `audit_logs.action` | structured |
| `targetType` | `audit_logs.target_type` | structured |
| `targetId` | `audit_logs.target_id` | structured |
| `payload` | `audit_logs.payload` | jsonb |
| `createdAt` | `audit_logs.created_at` | structured |

## 6. executions-store.json

### 6.1 Root fields

| JSON field | Target | Decision | Notes |
| --- | --- | --- | --- |
| `runSequence` | none | legacy-only | Sequence state is not migrated in phase 1. New DB sequence strategy is a later implementation detail. |
| `taskSequence` | none | legacy-only | Same as `runSequence`. |
| `runs` | `execution_runs` | structured | See below. |
| `tasks` | `execution_tasks` | structured | See below. |
| `events` | `task_events` | structured | See below. |

### 6.2 `runs[]`

Target table: `execution_runs`

| JSON field | Target | Decision |
| --- | --- | --- |
| `id` | `execution_runs.id` | structured |
| `runNo` | `execution_runs.run_no` | structured |
| `userId` | `execution_runs.user_id` | structured |
| `workflowId` | `execution_runs.workflow_id` | structured |
| `projectId` | `execution_runs.project_id` | structured |
| `nodeType` | `execution_runs.node_type` | structured |
| `taskType` | `execution_runs.task_type` | structured |
| `executionMode` | `execution_runs.execution_mode` | structured |
| `nodeId` | `execution_runs.node_id` | structured |
| `nodeTitle` | `execution_runs.node_title` | structured |
| `provider` | `execution_runs.provider` | structured |
| `status` | `execution_runs.status` | structured |
| `totalTaskCount` | `execution_runs.total_task_count` | structured |
| `completedTaskCount` | `execution_runs.completed_task_count` | structured |
| `failedTaskCount` | `execution_runs.failed_task_count` | structured |
| `requestPayload` | `execution_runs.request_payload` | jsonb |
| `resultSummary` | `execution_runs.result_summary` | jsonb |
| `createdAt` | `execution_runs.created_at` | structured |
| `startedAt` | `execution_runs.started_at` | structured |
| `completedAt` | `execution_runs.completed_at` | structured |

### 6.3 `tasks[]`

Target table: `execution_tasks`

| JSON field | Target | Decision |
| --- | --- | --- |
| `id` | `execution_tasks.id` | structured |
| `taskNo` | `execution_tasks.task_no` | structured |
| `runId` | `execution_tasks.run_id` | structured |
| `userId` | `execution_tasks.user_id` | structured |
| `workflowId` | `execution_tasks.workflow_id` | structured |
| `projectId` | `execution_tasks.project_id` | structured |
| `nodeType` | `execution_tasks.node_type` | structured |
| `nodeId` | `execution_tasks.node_id` | structured |
| `nodeTitle` | `execution_tasks.node_title` | structured |
| `taskType` | `execution_tasks.task_type` | structured |
| `groupId` | `execution_tasks.group_id` | structured |
| `groupOrder` | `execution_tasks.group_order` | structured |
| `provider` | `execution_tasks.provider` | structured |
| `model` | `execution_tasks.model` | structured |
| `input` | `execution_tasks.input` | jsonb |
| `status` | `execution_tasks.status` | structured |
| `currentStep` | `execution_tasks.current_step` | structured |
| `currentAttemptNo` | `execution_tasks.current_attempt_no` | structured |
| `retryCount` | `execution_tasks.retry_count` | structured |
| `maxRetries` | `execution_tasks.max_retries` | structured |
| `lastErrorCode` | `execution_tasks.last_error_code` | structured |
| `lastErrorMessage` | `execution_tasks.last_error_message` | structured |
| `resultFileId` | `execution_tasks.result_file_id` | structured |
| `whiteModelFileId` | `task_file_links` | derived |
| `styleReferenceFileId` | `task_file_links` | derived |
| `createdAt` | `execution_tasks.created_at` | structured |
| `startedAt` | `execution_tasks.started_at` | structured |
| `completedAt` | `execution_tasks.completed_at` | structured |

Derived `task_file_links`:

- `whiteModelFileId` -> role `input`.
- `styleReferenceFileId` -> role `reference`.
- `input.referenceFileIds[]` -> role `reference`.
- `input.fileIds[]` -> role `input`.
- `input.sourceFileId` -> role `input`.
- `input.maskFileId` -> role `reference`.
- `resultFileId` -> role `output`.

### 6.4 `events[]`

Target table: `task_events`

| JSON field | Target | Decision |
| --- | --- | --- |
| `id` | `task_events.id` | structured |
| `runId` | `task_events.run_id` | structured |
| `taskId` | `task_events.task_id` | structured |
| `workflowId` | `task_events.workflow_id` | structured/deferred |
| `attemptNo` | `task_events.attempt_no` | structured |
| `eventType` | `task_events.event_type` | structured |
| `status` | `task_events.status` | structured |
| `phase` | `task_events.phase` | structured |
| `stepType` | `task_events.step_type` | structured |
| `progress` | `task_events.progress` | structured |
| `message` | `task_events.message` | structured |
| `payload` | `task_events.payload` | jsonb |
| `createdAt` | `task_events.created_at` | structured |

## 7. workflow stores

### 7.1 `workflows/index.json`

Target table: `workflows`

| JSON field | Target | Decision |
| --- | --- | --- |
| `workflowId` | `workflows.id` | structured |
| `projectId` | `workflows.project_id` | structured |
| `ownerUserId` | `workflows.owner_user_id` | structured |
| `name` | `workflows.name` | structured |
| `groupId` | `workflows.group_id` | structured |
| `containerKey` | `workflows.container_key` | structured |
| `isAutoNamed` | `workflows.is_auto_named` | structured |
| `nodeCount` | `workflows.node_count` | structured |
| `connectionCount` | `workflows.connection_count` | structured |
| `timestamp` | `workflows.timestamp` | structured |
| `version` | `workflows.version` | structured |
| `createdAt` | `workflows.created_at` | structured |
| `updatedAt` | `workflows.updated_at` | structured |

The full document comes from `workflow.json`, not from the index.

### 7.2 `workflows/{workflowId}/workflow.json`

Target table: `workflows`

| JSON field | Target | Decision |
| --- | --- | --- |
| `workflowId` | `workflows.id` | structured |
| `ownerUserId` | `workflows.owner_user_id` | structured |
| `groupId` | `workflows.group_id` | structured |
| `containerKey` | `workflows.container_key` | structured |
| `isAutoNamed` | `workflows.is_auto_named` | structured |
| `workflow` | `workflows.payload` | jsonb |
| `workflow.projectId` | `workflows.project_id` | structured |
| `workflow.name` | `workflows.name` | structured |
| `workflow.nodes` | `workflows.payload` | jsonb |
| `workflow.connections` | `workflows.payload` | jsonb |
| `workflow.viewport` | `workflows.payload` | jsonb |
| `workflow.metadata` | `workflows.payload` | jsonb |
| `workflow.timestamp` | `workflows.timestamp` | structured |
| `workflow.version` | `workflows.version` | structured |
| `createdAt` | `workflows.created_at` | structured |
| `updatedAt` | `workflows.updated_at` | structured |

### 7.3 `workflows/{workflowId}/files.json`

Target table: `workflow_file_bindings`

| JSON field | Target | Decision |
| --- | --- | --- |
| `bindingId` | `workflow_file_bindings.id` | structured |
| `workflowId` | `workflow_file_bindings.workflow_id` | structured |
| `ownerUserId` | `workflow_file_bindings.owner_user_id` | structured |
| `nodeId` | `workflow_file_bindings.node_id` | structured |
| `fileId` | `workflow_file_bindings.file_id` | structured |
| `role` | `workflow_file_bindings.role` | structured |
| `createdAt` | `workflow_file_bindings.created_at` | structured |
| `updatedAt` | `workflow_file_bindings.updated_at` | structured |

### 7.4 `workflows/groups-index.json`

Target table: `workflow_groups`

The current sample is empty. Phase 1 supports these fields if present:

| JSON field | Target | Decision |
| --- | --- | --- |
| `id` or `groupId` | `workflow_groups.id` | structured |
| `ownerUserId` | `workflow_groups.owner_user_id` | structured |
| `name` | `workflow_groups.name` | structured |
| `sortOrder` | `workflow_groups.sort_order` | structured |
| full group object | `workflow_groups.payload` | jsonb |
| `createdAt` | `workflow_groups.created_at` | structured |
| `updatedAt` | `workflow_groups.updated_at` | structured |

## 8. Out-of-Scope for Phase 1

These items are explicitly not part of phase 1:

- Automatic physical file deletion.
- Cold storage/archive policy.
- Cost accounting.
- Quota enforcement.
- Project/team membership.
- Multi-tenant isolation beyond current user ownership.
- Complex RBAC beyond `member` and `admin`.
- Provider key pool management.
- Custom dashboards and reports.
- Long-term dual-write between JSON and DB.

## 9. Migration Boundary

Phase 1 migrates metadata and relationships only.

Phase 1 does not:

- Move binary files out of `backend/storage`.
- Delete old JSON files.
- Rebuild image derivatives unless they are missing and explicitly requested by a later task.
- Rewrite frontend workflow payload structure.
- Change public file API response shape.

## 10. Acceptance Criteria

- Every listed JSON source has a field mapping.
- Every migrated field has a decision: `structured`, `jsonb`, `derived`, `legacy-only`, or `deferred`.
- Phase 1, phase 2, and out-of-scope boundaries are explicit.
- This document is treated as the baseline for later schema and migration-tool work.
