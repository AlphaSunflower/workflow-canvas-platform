# 文件数据库化与中台建设规划

## 1. 背景

当前后端文件系统已经具备 `register / upload / get / download / preview / thumbnail`
接口，但核心数据仍保存在 JSON 文件中：

- `backend/data/files/files-store.json`
- `backend/data/storage-index.json`
- `backend/data/workflows/{workflowId}/files.json`
- `backend/data/accounts-store.json`
- `backend/data/executions-store.json`

这套方式适合本地测试，不适合后续运营中台、权限审计、文件治理、任务追踪和多实例部署。

本规划的目标是把文件、账号、执行、workflow 关联逐步迁入数据库，同时保留当前 API
形态，降低前端和 Worker 的改造成本。

## 2. 总目标

1. 数据库成为文件主数据的唯一事实来源。
2. 对象存储只保存二进制内容，不承担索引职责。
3. 文件资产、执行任务、workflow、用户账号可以被中台统一查询。
4. 保留 `sha256` 去重能力，相同内容只保存一份物理文件。
5. 普通用户按 `file_assets.user_id` 隔离，管理员可全局查询。
6. 迁移过程可预检查、可回滚、可重复生成 SQL。

## 3. 总体架构

```text
Frontend
  -> Files API
      -> FilesService
          -> DbFilesRepository
          -> ObjectStorageAdapter(local / MinIO / S3)
  -> Workflow API
      -> DbWorkflowRepository
  -> Execution API
      -> DbExecutionRepository

Worker
  -> FilesService or file asset command service
      -> DbFilesRepository
      -> ObjectStorageAdapter

Admin Web
  -> Admin API
      -> file_assets / file_blobs / workflow / execution / user / audit queries
```

数据库保存元数据和关系；二进制文件继续保存在 `backend/storage`，生产环境再切到 MinIO
或 S3。

## 4. 文件领域模型

### 4.1 file_blobs

物理文件层，按 `sha256` 去重。

关键字段：

- `id`
- `sha256`
- `size`
- `mime_type`
- `storage_provider`
- `storage_key`
- `extension`
- `width / height / duration`
- `preview_storage_key`
- `thumbnail_storage_key`

规则：

- `sha256` 唯一。
- 不直接暴露给前端。
- 同一 blob 可被多个 `file_assets` 引用。

### 4.2 file_assets

用户可见的逻辑文件层。

关键字段：

- `id`
- `user_id`
- `blob_id`
- `original_name`
- `display_name`
- `file_type`
- `source_type`
- `status`
- `pending_upload_id`
- `created_at`

规则：

- 前端、任务和 workflow 引用的都是 `file_assets.id`。
- 用户 A 和用户 B 上传相同内容时，各自拥有不同 `file_asset`，但共享同一个 `file_blob`。
- 删除 workflow 绑定不删除物理文件。

### 4.3 file_uploads

上传会话。

用途：

- 记录 pending upload。
- 支持上传前预分配 `fileId`。
- 支持过期、失败、取消和补偿。

### 4.4 file_blob_variants

文件变体。

当前变体：

- `original`
- `preview`
- `thumbnail`

后续可扩展：

- 水印图
- 低清视频
- 模型预览图

### 4.5 task_file_links

任务与文件关系。

角色：

- `input`
- `reference`
- `intermediate`
- `output`

规则：

- 每个任务的输入、输出、中间产物都必须可追踪。
- 中台通过该表从任务反查文件，也可以从文件反查任务。

### 4.6 workflow_file_bindings

workflow 画布与文件关系。

角色：

- `file-node`
- `node-reference`
- `connection-reference`
- `file-group`

用途：

- 打开 workflow 详情时快速查询相关文件。
- 中台展示某个文件被哪些 workflow 使用。

## 5. 数据库迁移结构

新增迁移：

- `backend/db/migrations/003_file_database_platform.sql`

该迁移补齐：

- 文件派生字段
- `file_uploads`
- `file_blob_variants`
- `file_events`
- `storage_objects`
- `users`
- `refresh_tokens`
- `audit_logs`
- `workflows`
- `workflow_groups`
- `workflow_file_bindings`
- 执行表的 `workflow_id / project_id / node_id / node_type`
- 迁移批次表 `legacy_migration_runs`

## 6. API 改造规划

### Phase 1: 文件主数据入库

保持当前接口不变：

- `POST /api/v1/files/register`
- `POST /api/v1/files/upload`
- `GET /api/v1/files/:fileId`
- `GET /api/v1/files/:fileId/download`
- `GET /api/v1/files/:fileId/preview`
- `GET /api/v1/files/:fileId/thumbnail`

改造内部实现：

```text
FilesRepository interface
  JsonFilesRepository
  DbFilesRepository
```

上线策略：

1. 新增 `DbFilesRepository`。
2. 配置开关 `persistence.files = json | db`。
3. 默认先用 `json`。
4. 完成迁移和验证后切到 `db`。
5. 保留 `json` 只读回滚窗口。

### Phase 2: Worker 存储索引收口

废弃 `storage-index.json` 的索引职责。

Worker 保存外部平台结果时：

1. 下载或接收 provider 结果。
2. 写入对象存储。
3. 通过文件资产服务创建 `file_blob + file_asset`。
4. 创建 `task_file_links(role=output)`。

### Phase 3: 账号和执行记录入库

迁移：

- `accounts-store.json -> users / refresh_tokens / audit_logs`
- `executions-store.json -> execution_runs / execution_tasks / task_events`

收益：

- 中台可查账号、会话、审计、执行历史。
- 后续可以做用户禁用、任务追踪、失败分析。

### Phase 4: Workflow 入库

迁移：

- `workflows/index.json -> workflows`
- `workflows/{workflowId}/workflow.json -> workflows.payload`
- `workflows/{workflowId}/files.json -> workflow_file_bindings`
- `workflows/groups-index.json -> workflow_groups`

短期可保留 workflow JSON 作为导出/归档格式，但运行态查询应走数据库。

### Phase 5: 对象存储切换

本地开发：

```text
storage_provider = local
storage_key = blobs/xx/sha.ext
```

生产推荐：

```text
storage_provider = minio
bucket = newworkflow-files
storage_key = projects/{projectId}/files/{fileId}/original
```

下载策略：

- 一期继续后端鉴权后流式返回。
- 后续大文件可改为短时签名 URL。

## 7. 中台建设范围

### 7.1 一期只读中台

目标：先支撑排查和运营，不做破坏性操作。

页面：

1. 总览
   - 文件总数
   - 存储总量
   - 今日上传
   - 今日生成
   - 队列中任务
   - 处理中任务
   - 今日成功/失败

2. 文件资产
   - 按用户、类型、来源、状态、时间、sha256 搜索。
   - 查看原图、预览图、缩略图。
   - 查看引用该文件的 workflow 和任务。

3. 执行历史
   - 按 runNo、taskNo、用户、节点类型、状态、时间筛选。
   - 查看输入文件、输出文件、错误和事件。

4. Workflow 管理
   - 列表、归属用户、更新时间、节点数、文件引用数。
   - 只读查看画布 JSON 摘要。

5. 用户管理
   - 用户列表、角色、状态、最近登录。
   - 一期只读或只支持禁用。

6. 存储治理
   - 孤儿 blob。
   - pending upload。
   - 预览/缩略图缺失。
   - 重复资产。

### 7.2 二期可操作中台

能力：

- 禁用/启用用户。
- 重置密码。
- 重试失败任务。
- 重新生成 preview/thumbnail。
- 标记文件删除。
- 存储清理审批。

### 7.3 三期运营平台

能力：

- 成本统计。
- provider key 池管理。
- 多租户/项目成员。
- 容量配额。
- 生命周期策略。

## 8. 一次性迁移方案

迁移工具：

- `backend/scripts/migrate-json-store-to-db.mjs`

默认行为：

1. 读取 JSON store。
2. 校验引用和本地文件。
3. 生成 SQL 文件。
4. 生成迁移报告。
5. 不直接修改数据库。

可选行为：

- 使用 `--apply` 调用本机 `psql` 执行生成的 SQL。

输入：

- `backend/data/files/files-store.json`
- `backend/data/storage-index.json`
- `backend/data/accounts-store.json`
- `backend/data/executions-store.json`
- `backend/data/workflows/index.json`
- `backend/data/workflows/groups-index.json`
- `backend/data/workflows/*/workflow.json`
- `backend/data/workflows/*/files.json`

输出：

- `backend/.tmp/migrations/json-store-to-db/<label>/migration.sql`
- `backend/.tmp/migrations/json-store-to-db/<label>/report.json`
- `backend/.tmp/migrations/json-store-to-db/<label>/README.md`

## 9. 迁移前检查清单

1. 停止 API 和 Worker 写入。
2. 备份 `backend/data` 和 `backend/storage`。
3. 执行数据库结构迁移到 `003_file_database_platform.sql`。
4. 运行迁移工具生成 SQL 和报告。
5. 检查报告中的 `errors` 必须为 0。
6. 检查 `warnings`，确认是否接受。
7. 在测试库执行 SQL。
8. 抽样验证文件下载、预览、任务详情、workflow 文件绑定。
9. 生产执行 SQL。
10. 切换配置到 DB repository。

## 10. 回滚策略

迁移工具不删除旧 JSON，也不移动二进制文件。

回滚方式：

1. 将配置切回 JSON repository。
2. 数据库保留不影响旧路径。
3. 如需清理数据库，按迁移批次 `legacy_migration_runs.id` 生成删除脚本。

注意：切到 DB 后如果发生新写入，回滚到 JSON 会丢失这部分新写入。因此生产切换后建议短期只保留向前修复，不做长时间双写。

## 11. 验收标准

文件侧：

- 相同 sha256 只产生一条 `file_blobs`。
- 每个旧 `files-store.json.files` 都有对应 `file_assets`。
- pending upload 有对应 `file_uploads`。
- `download / preview / thumbnail` 可从数据库元数据定位。

执行侧：

- 每个旧 run 有 `execution_runs`。
- 每个旧 task 有 `execution_tasks`。
- task 的 `result_file_id` 可关联 `file_assets`。

workflow 侧：

- 每个旧 workflow 有 `workflows`。
- 每个旧 `files.json.items` 有 `workflow_file_bindings`。

账号侧：

- 每个旧 user 有 `users`。
- 每个旧 session 有 `refresh_tokens`。
- 每个旧 audit log 有 `audit_logs`。

中台侧：

- 管理员能按用户、文件、任务、workflow 维度检索。
- 文件详情页能看到引用链路。
- 执行详情页能看到输入输出文件。
## Task 01 Baseline Addendum

The phase-1 migration boundary is frozen by these companion documents:

- `FILE-DATABASE-MIGRATION-FIELD-MAPPING.md`
- `FILE-DATABASE-CUTOVER-RUNBOOK.md`

For phase 1, the migration moves metadata and relationships only. Binary files remain in `backend/storage/**`; JSON stores remain as backup material and are not deleted by the migration.

Phase 1 includes:

- File blob metadata, file assets, file variants, and pending uploads.
- Worker storage inventory as compatibility metadata.
- Workflow summaries, full workflow payloads, and workflow file bindings.
- Execution runs, tasks, events, and derivable task-file links.
- Users, refresh sessions, and audit logs.
- Read-only admin query foundations.

Phase 1 explicitly excludes:

- Automatic physical file deletion.
- Cold storage or archive lifecycle policy.
- Cost accounting and quota enforcement.
- Provider key pool management.
- Project/team membership and complex RBAC.
- Long-term dual-write between JSON and DB.
- Moving binary files to MinIO/S3.

If any later task changes the phase-1 boundary, update the field mapping and cutover runbook before implementation.
