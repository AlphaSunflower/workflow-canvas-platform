# 文件资产设计

## 1. 文档目的

本文档定义后端执行体系中的文件规则、文件分层模型、去重策略、注册/上传流程，以及与任务的关系。

## 2. 总体目标

文件体系必须满足以下目标：

- 所有参与后端执行的输入文件都必须拥有后端 `fileId`
- 重复文件内容可以跳过二进制上传
- 相同内容可以跨用户复用物理文件
- 不同用户的文件历史仍然独立
- 输出产物必须能追溯到具体任务

## 3. 核心规则

正式规则如下：

- 只要某个文件要参与后端执行，就必须先获得后端 `fileId`

这意味着：

- 后端不能直接使用前端本地文件路径
- 可以跳过的是“重复上传字节”，不能跳过“后端登记”
- 执行请求里只能传 `fileId`，不能传本地文件路径

## 4. 双层文件模型

### 4.1 物理层：FileBlob

`file_blobs` 表示实际存储的物理文件。

特点：

- 以内容哈希为唯一依据
- 相同内容只存一份
- 支持跨用户复用

### 4.2 逻辑层：FileAsset

`file_assets` 表示用户侧可见、可追踪的逻辑文件。

特点：

- 每个用户拿到自己的 `fileId`
- 历史归属不会串
- 权限控制简单

## 5. 跨用户复用规则

如果用户 B 使用了一个与用户 A 完全相同内容的文件：

1. 后端不重复上传二进制
2. 后端为用户 B 新建一条 `file_asset`
3. 两条 `file_asset` 指向同一个 `file_blob`

这样可以同时满足：

1. 物理文件只保存一份
2. 不同用户历史仍然独立
3. 权限仍然按用户隔离

## 6. 前端文件接入流程

### 6.1 第一步：本地计算哈希

前端在本地计算文件 `sha256`。

建议：

- 放在 Web Worker 中计算
- 避免大文件阻塞主线程

### 6.2 第二步：调用注册接口

前端调用：

- `POST /api/v1/files/register`

提交信息：

- `userId`
- `sha256`
- `size`
- `mimeType`
- `originalName`

### 6.3 第三步：后端判断是否需要上传

后端处理逻辑：

1. 如果已经存在相同内容的 `file_blob`
   - 直接为当前用户创建一条新的 `file_asset`
   - 返回 `uploadRequired = false`、新的 `fileId` 和文件元数据
2. 如果不存在
   - 返回 `uploadRequired = true`
   - 同时生成 `uploadId` 与预分配 `fileId`
   - 前端继续调用上传接口

### 6.4 第四步：需要时才上传

前端只有在 `uploadRequired = true` 时，才真正上传二进制文件。

上传请求至少包含：

- `uploadId`
- `contentBase64`

### 6.5 第五步：执行只引用 fileId

所有执行请求，只传：

- `fileId`
- `referenceFileIds`
- `fileBindings`

不再传本地路径。

## 7. API 设计要求

### 7.1 POST /api/v1/files/register

用途：

- 先注册、再决定是否上传

如果命中已有物理文件：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "uploadRequired": false,
    "fileId": "file_xxx",
    "file": {}
  },
  "timestamp": 1770000000000
}
```

如果需要上传：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "uploadRequired": true,
    "uploadId": "upload_xxx",
    "fileId": "file_xxx",
    "file": {}
  },
  "timestamp": 1770000000000
}
```

### 7.2 POST /api/v1/files/upload

用途：

- 上传真正的二进制文件
- 落物理文件与逻辑资产
- 返回最终 `fileId`

上传完成后必须：

1. 后端重新计算二进制 `sha256`
2. 与注册阶段传入摘要比对
3. 一致后才允许落盘与绑定 `blob`
4. 不一致则返回 `FILE_HASH_MISMATCH`

### 7.3 GET /api/v1/files/:id

用途：

- 查询文件元数据
- 支撑历史详情和前端文件查询

### 7.4 GET /api/v1/files/:id/download

用途：

- 下载原始文件

### 7.5 GET /api/v1/files/:id/preview

用途：

- 获取预览文件

## 8. 文件类型与来源

一期当前统一命名如下：

逻辑来源：

- `input`
- `intermediate`
- `output`

文件用途类型：

- `image`
- `unknown`

任务关系角色：

- `input`
- `reference`
- `intermediate`
- `output`

说明：

- 线稿图和深度图必须作为 `intermediate` 文件资产落库
- 最终结果图作为 `output` 文件资产落库

## 9. 输出产物规则

所有外部平台返回的产物都必须经过以下流程：

1. 后端接收到产物
2. 后端将产物写入对象存储
3. 后端创建新的 `file_blob`
   如果内容重复，可复用已有 `blob`
4. 后端创建新的输出 `file_asset`
5. 后端建立 `task_file_link(role=output)`

只有完成以上步骤，任务才算成功。

对于白模渲染节点，还必须满足：

1. 线稿图与深度图可作为中间产物独立落库
2. 若中间产物内容重复，可复用已有 `file_blob`
3. 若命中缓存，仍需建立当前任务对应的 `task_file_link(role=intermediate)`

## 10. 一期默认本地存储方案

一期默认采用后端本地文件存储，作为对象存储接入前的最小可用实现。

### 10.1 存储目录规则

建议本地目录如下：

```text
backend/
  data/
    files-store.json
    storage-index.json
  storage/
    blobs/
    inputs/
    intermediates/
    outputs/
```

说明：

- `blobs/`
  当前文件上传链路使用的物理去重目录
- `inputs/`
  Worker 存储输入文件副本或后续统一存储落点
- `intermediates/`
  线稿图、深度图等中间产物默认目录
- `outputs/`
  最终结果图默认目录

### 10.2 存储抽象要求

一期已经明确需要独立存储抽象层，不能把落盘逻辑写死在业务执行器中。

存储层最少提供以下能力：

1. 按二进制保存文件
2. 按 base64 保存文件
3. 按 `storageKey` 读取文件
4. 查询文件元数据

### 10.3 base64 落盘规则

所有外部平台返回的图片 base64，都必须统一经过存储层转换为二进制后保存。

统一要求：

1. 先做 base64 解码
2. 统一计算 `sha256`
3. 统一生成本地文件路径与 `storageKey`
4. 写入后返回可落库的存储元数据

### 10.4 长期保留策略

一期当前默认长期保留：

- 输入文件
- 中间产物
- 最终结果图

当前阶段不做自动清理和归档。

## 11. 数据表建议

### 11.1 file_blobs

建议字段：

- `blob_id`
- `sha256`
- `size`
- `storage_key`
- `preview_key`
- `thumbnail_key`
- `created_at`

建议约束：

- `sha256` 唯一索引

### 11.2 file_assets

建议字段：

- `file_id`
- `user_id`
- `blob_id`
- `original_name`
- `display_name`
- `mime_type`
- `file_type`
- `source_type`
- `created_at`

建议索引：

- `idx_file_assets_user_id`
- `idx_file_assets_blob_id`
- `idx_file_assets_created_at`

### 11.3 task_file_links

建议字段：

- `id`
- `task_id`
- `file_id`
- `role`
- `order_index`
- `source_handle`
- `group_id`

建议索引：

- `idx_task_file_links_task_id`
- `idx_task_file_links_file_id`
- `idx_task_file_links_role`

### 11.4 intermediate_artifacts

建议字段：

- `id`
- `source_blob_id`
- `artifact_type`
- `file_id`
- `provider`
- `model`
- `pipeline_version`
- `prompt_version`
- `status`
- `last_task_id`
- `created_at`
- `last_used_at`

说明：

- `artifact_type` 只允许：
  - `lineart`
  - `depth`
- 该表不直接代替文件资产，只记录可复用中间产物的缓存索引
- 真正文件内容仍由 `file_blobs + file_assets` 管理

## 12. 白模渲染节点的文件映射

对于每个 group：

1. 白模图注册为 `file_assets(source_type=input)`
2. 风格参考图注册为 `file_assets(source_type=input)`
3. 线稿图注册为 `file_assets(source_type=intermediate)`
4. 深度图注册为 `file_assets(source_type=intermediate)`
5. 最终结果图注册为 `file_assets(source_type=output)`

对应任务关系：

1. 白模图通常对应 `task_file_links(role=input)`
2. 风格参考图通常对应 `task_file_links(role=reference)`
3. 线稿图和深度图对应 `task_file_links(role=intermediate)`
4. 最终结果图对应 `task_file_links(role=output)`

## 13. 权限与可见性

规则如下：

- 普通用户只能查询自己的 `file_assets`
- 管理员可以查询全局 `file_assets`
- `file_blobs` 属于内部表，不直接暴露给前端
- 实际对象存储路径不能直接裸露给客户端

## 14. 一期不做的内容

一期不要求：

- 文件过期清理策略
- 冷存储归档
- 文件版本链
- 高级重名处理体验
- 语义层面的内容相似去重
## 15. ply 模型资产补充规则

当前文件资产体系已补充 `ply` 类型支持，当前规则如下：

1. `ply` 作为正式 `fileType` 进入统一 files 体系，不再挂在 `unknown` 下
2. 图片转模型节点的结果文件按 `sourceType = output`、`fileType = ply` 落库
3. `ply` 文件与图片文件共用同一套注册、上传、去重、下载、查询通道
4. `ply` 资产保留 `downloadUrl`，不返回 `previewUrl`
5. 查询执行详情时，`resultFile` 会按统一 `FileAssetResponse` 回显模型文件信息
6. 当前默认接受 `.ply` 扩展名，MIME 可先使用 `application/octet-stream`
## Task 01 File Asset Boundary Addendum

The phase-1 file asset migration baseline is defined by:

- `FILE-DATABASE-MIGRATION-FIELD-MAPPING.md`
- `FILE-DATABASE-CUTOVER-RUNBOOK.md`

Phase 1 keeps the existing two-layer file model:

- `file_blobs` are physical content records keyed by `sha256`.
- `file_blob_variants` are the runtime physical object index for original, preview, and thumbnail objects.
- `file_assets` are user-visible logical records referenced by frontend, workflow, and tasks.

The public file API shape must remain compatible during phase 1:

- `POST /api/v1/files/register`
- `POST /api/v1/files/upload`
- `GET /api/v1/files/:fileId`
- `GET /api/v1/files/:fileId/download`
- `GET /api/v1/files/:fileId/preview`
- `GET /api/v1/files/:fileId/thumbnail`

Phase 1 migrates file metadata and relationships only. It does not move binary files out of local storage, does not perform physical deletion, and does not introduce lifecycle cleanup.

The migration boundary is:

- `files-store.json.blobs[]` -> `file_blobs` and `file_blob_variants`
- `files-store.json.files[]` -> `file_assets`
- `files-store.json.pendingUploads[]` -> `file_uploads`
- `storage-index.json.files[]` -> `storage_objects` as legacy migration inventory only
- workflow file bindings -> `workflow_file_bindings`
- task input/output references -> `task_file_links`

## Task 01 Physical Object Index Boundary

The DB-only runtime uses one canonical physical object index:

- `file_blob_variants` is the only runtime index for physical objects.
- `file_assets.blob_id -> file_blobs.id -> file_blob_variants.blob_id` is the lookup path for download, preview, thumbnail, and storage diagnostics.
- `file_blob_variants.variant = 'original'` is required for every ready asset with a blob.
- `file_blob_variants.variant = 'preview'` is required only when `file_assets.preview_ready = true`.
- `file_blob_variants.variant = 'thumbnail'` is required only when `file_assets.thumbnail_ready = true`.
- New uploads and Worker output registration should write `file_blobs`, `file_assets`, `file_blob_variants`, `file_uploads`, `file_events`, and task/workflow link tables as needed.
- New runtime writes must not create or update `storage_objects`.
- `storage_objects` is retained only to preserve imported `storage-index.json` rows for migration traceability and audit.
- Binary bytes remain in local/object storage. The database stores metadata, relationships, and object keys, not file payload bytes.

## DB Only File Storage Boundary

The file asset system is a metadata-first design. PostgreSQL is not the binary
file store.

PostgreSQL owns:

- dedupe identity: `file_blobs.sha256`
- user-visible asset identity: `file_assets.id`
- upload lifecycle: `file_uploads`
- object lookup keys: `file_blob_variants`
- file lifecycle/audit events: `file_events`
- workflow usage: `workflow_file_bindings`
- task usage: `task_file_links`
- intermediate cache state: `intermediate_artifacts`

Object storage owns:

- original upload bytes
- preview bytes
- thumbnail bytes
- intermediate artifact bytes
- output artifact bytes

The local storage adapter is the development implementation of this object
storage role. Production should use S3, MinIO, OSS, or another object storage
provider and keep the same DB metadata model.

### Why File Bytes Do Not Go Into PostgreSQL

The backend intentionally does not put original file bytes into PostgreSQL.

Reasons:

- Large generated images, videos, and PLY files would inflate DB backups and
  restore time.
- Binary-heavy tables increase vacuum and storage pressure.
- Download/preview traffic should not compete with metadata queries on DB
  connections.
- Object storage already provides cheaper byte storage, lifecycle controls,
  replication, and range/object access patterns.

The DB stores enough metadata to locate, authorize, audit, and verify files. It
does not need to store the file payload.

### Variant Rules

Every ready logical file with a blob must have an `original` variant in
`file_blob_variants`.

Derivative variants are conditional:

- `preview` exists only when preview generation succeeded.
- `thumbnail` exists only when thumbnail generation succeeded.

Admin storage diagnostics should check DB metadata first and then verify object
existence through the storage adapter. They must not use `storage_objects` as the
runtime index.

### Intermediate Files

Lineart/depth and similar reusable intermediate files are normal file assets:

- `file_assets.source_type = 'intermediate'`
- `task_file_links.role = 'intermediate'`
- object bytes stored in object storage
- lookup through `file_blob_variants`

`intermediate_artifacts` is only the cache coordination table. It records the
cache key, status, owning source blob, provider/model/version dimensions, and
ready `file_id`.

### Provider Diagnostics

Provider raw snapshots are not file assets unless they become user-visible
artifacts. They should stay in diagnostic object storage or local diagnostic
folders. `provider_call_logs` stores searchable summaries and the snapshot
path/key so operators can locate the raw diagnostic file when needed.

### Backup Responsibility

Back up metadata and bytes separately:

- PostgreSQL backup protects file metadata, permissions, task/workflow links,
  intermediate cache records, and provider call summaries.
- Object storage backup protects the actual original/preview/thumbnail/
  intermediate/output bytes and diagnostic snapshots.

Restore validation must check both sides. Missing object bytes should surface as
storage issues, not as metadata corruption.
