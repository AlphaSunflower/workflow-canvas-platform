# 数据库表设计

## 1. 文档目的

本文档定义后端一期当前真实开发范围内的最小数据库结构。

当前目标不是一次性设计完整平台数据库，而是先支撑：

1. 前端 workflow 画布保存到后端
2. 文件入画布即上传、预检去重与复用
3. 前端一次白模渲染节点点击执行
4. 后端拆分多个 group 子任务
5. 子任务真实调用外部平台执行
6. 保存输入文件、中间产物、最终产物
7. 记录任务事件、尝试、错误、重试
8. 复用同一白模图生成的线稿图和深度图

如与更早的总体规划冲突，以当前文档为准。

## 2. 设计原则

一期数据库设计遵循以下原则：

1. 只保留当前真实执行闭环所必需的表
2. 文件使用“物理去重 + 逻辑引用”双层模型
3. 任务、尝试、事件、外部调用必须可追溯
4. grouped 多任务必须可独立落库和独立失败
5. 中间产物必须可按内容复用
6. 画布、文件、执行、任务历史必须可按 `workflowId` 聚合
7. 字段命名统一引用 `backend/shared` 中共享常量

## 3. 一期最小表清单

一期当前最小表如下：

1. `file_blobs`
2. `file_assets`
3. `execution_runs`
4. `execution_tasks`
5. `task_attempts`
6. `task_events`
7. `task_file_links`
8. `provider_call_logs`
9. `intermediate_artifacts`
10. `users`
11. `refresh_tokens`
12. `audit_logs`

补充的 JSON Store / 分片持久化对象：

13. `workflow_index`
14. `workflow_detail`
15. `workflow_files`
16. `workflow_task_summaries`
17. `task_event_streams`

说明：

- 当前已落地迁移仍以执行域与文件域为主，账户域表将在后续 `auth/users` 任务中补齐
- 本轮先把账户域目标结构纳入正式设计基线，避免后续实现与已有执行域冲突
- 账户 MVP 仅覆盖 `member` / `admin` 两级角色
- 当前一期先不落 API Key 池，因此不设计 `provider_keys`、`provider_key_leases`
- 任务归属仍保留 `user_id` 字段，便于后续恢复账号体系时平滑接入
- 当前阶段 workflow 相关数据优先采用 JSON Store 分片，而不是先强行落为 SQL 表
- 即使底层不是关系库，字段基线也应与本文件保持一致

## 4. 表设计

### 4.1 file_blobs

表示按内容去重后的物理文件。

```sql
file_blobs
id                  uuid primary key
sha256              varchar(64) not null unique
size                bigint not null
mime_type           text not null
storage_key         text not null
storage_provider    text not null default 'local'
extension           text null
width               int null
height              int null
created_at          timestamptz not null default now()
```

索引建议：

- `uq_file_blobs_sha256`

用途：

- 跨用户复用物理文件
- 为中间产物复用提供内容定位依据

### 4.2 file_assets

表示逻辑文件资产。

```sql
file_assets
id                  uuid primary key
user_id             text null
blob_id             uuid not null
original_name       text not null
display_name        text not null
mime_type           text not null
file_type           text not null
source_type         text not null
created_at          timestamptz not null default now()
```

约束建议：

- `file_type in ('image', 'unknown')`
- `source_type in ('input', 'intermediate', 'output')`

索引建议：

- `idx_file_assets_user_id`
- `idx_file_assets_blob_id`
- `idx_file_assets_created_at`

用途：

- 提供后端唯一 `fileId`
- 分离逻辑归属与物理存储

### 4.3 execution_runs

表示一次节点点击执行。

```sql
execution_runs
id                  uuid primary key
run_no              varchar(32) not null unique
user_id             text null
workflow_id         text not null
node_type           text not null
task_type           text not null
execution_mode      text not null
node_id             text null
node_title          text null
provider            text not null
status              text not null
total_task_count    int not null default 0
completed_task_count int not null default 0
failed_task_count   int not null default 0
request_payload     jsonb not null
result_summary      jsonb null
created_at          timestamptz not null default now()
started_at          timestamptz null
completed_at        timestamptz null
```

约束建议：

- `status in ('queued', 'processing', 'completed', 'failed', 'cancelled')`

索引建议：

- `idx_execution_runs_user_id`
- `idx_execution_runs_workflow_id`
- `idx_execution_runs_status`
- `idx_execution_runs_created_at`
- `idx_execution_runs_node_type`

用途：

- 作为一次点击执行的顶层记录
- 显式归属到一个 workflow
- 聚合 grouped 多任务结果

### 4.4 execution_tasks

表示一个 group 对应的一条可调度任务。

```sql
execution_tasks
id                  uuid primary key
task_no             varchar(32) not null unique
run_id              uuid not null
user_id             text null
workflow_id         text not null
group_id            text not null
group_order         int not null
node_id             text null
node_type           text null
provider            text not null
model               text not null
status              text not null
current_step        text null
current_attempt_no  int not null default 0
retry_count         int not null default 0
max_retries         int not null default 2
last_error_code     text null
last_error_message  text null
result_file_id      uuid null
created_at          timestamptz not null default now()
started_at          timestamptz null
completed_at        timestamptz null
```

约束建议：

- `status in ('queued', 'processing', 'completed', 'failed', 'cancelled')`
- `max_retries >= 0`
- `retry_count >= 0`

索引建议：

- `idx_execution_tasks_run_id`
- `idx_execution_tasks_workflow_id`
- `idx_execution_tasks_status`
- `idx_execution_tasks_created_at`
- `idx_execution_tasks_group_id`

用途：

- 承载 group 级调度
- 承载重试主状态
- 记录最终结果文件
- 支撑按 workflow 聚合的任务历史查询

### 4.5 task_attempts

表示任务的一次真实执行尝试。

```sql
task_attempts
id                      uuid primary key
task_id                 uuid not null
attempt_no              int not null
status                  text not null
current_step            text null
progress                int not null default 0
error_code              text null
error_message           text null
provider_request_meta   jsonb null
provider_response_meta  jsonb null
started_at              timestamptz not null default now()
completed_at            timestamptz null
```

约束建议：

- `unique (task_id, attempt_no)`
- `status in ('queued', 'processing', 'completed', 'failed', 'cancelled')`

索引建议：

- `idx_task_attempts_task_id`
- `idx_task_attempts_started_at`

用途：

- 记录第几次尝试
- 保存失败和响应信息，不覆盖历史

### 4.6 task_events

表示任务时间线事件。

```sql
task_events
id                  uuid primary key
run_id              uuid not null
task_id             uuid not null
workflow_id         text not null
attempt_no          int null
event_type          text not null
status              text not null
phase               text null
step_type           text null
progress            int not null default 0
message             text null
payload             jsonb null
created_at          timestamptz not null default now()
```

约束建议：

- `status in ('queued', 'processing', 'completed', 'failed', 'cancelled')`

索引建议：

- `idx_task_events_task_id`
- `idx_task_events_run_id`
- `idx_task_events_workflow_id`
- `idx_task_events_created_at`

用途：

- 驱动前端节点状态展示
- 记录步骤开始、完成、命中缓存、重试等事件
- 在 JSON Store 落地时对应 `events/{taskId}.jsonl` 追加写

### 4.7 task_file_links

表示任务与文件之间的关系。

```sql
task_file_links
id                  uuid primary key
task_id             uuid not null
file_id             uuid not null
workflow_id         text not null
role                text not null
order_index         int null
source_handle       text null
group_id            text not null
created_at          timestamptz not null default now()
```

约束建议：

- `role in ('input', 'reference', 'intermediate', 'output')`

索引建议：

- `idx_task_file_links_task_id`
- `idx_task_file_links_file_id`
- `idx_task_file_links_workflow_id`
- `idx_task_file_links_role`

用途：

- 记录输入、参考图、中间产物、输出产物
- 记录最终生成时的固定输入顺序
- 支撑 workflow 维度的文件反查

### 4.8 provider_call_logs

表示一次外部平台调用日志。

```sql
provider_call_logs
id                  uuid primary key
task_id             uuid not null
attempt_id          uuid null
step_type           text not null
provider            text not null
model               text not null
request_summary     jsonb null
response_summary    jsonb null
http_status         int null
success             boolean not null default false
error_code          text null
error_message       text null
started_at          timestamptz not null default now()
completed_at        timestamptz null
```

索引建议：

- `idx_provider_call_logs_task_id`
- `idx_provider_call_logs_attempt_id`
- `idx_provider_call_logs_step_type`
- `idx_provider_call_logs_started_at`

用途：

- 支撑外部调用排查
- 保存成功/失败摘要
- 记录同步调用链路

### 4.9 intermediate_artifacts

表示白模渲染节点可复用的中间产物缓存。

```sql
intermediate_artifacts
id                  uuid primary key
source_blob_id      uuid not null
artifact_type       text not null
file_id             uuid null
provider            text not null
model               text not null
pipeline_version    text not null
prompt_version      text not null
status              text not null
last_task_id        uuid null
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()
last_used_at        timestamptz null
```

约束建议：

- `artifact_type in ('lineart', 'depth')`
- `status in ('processing', 'ready', 'failed')`
- `unique (source_blob_id, artifact_type, provider, model, pipeline_version, prompt_version)`

索引建议：

- `idx_intermediate_artifacts_source_blob_id`
- `idx_intermediate_artifacts_status`
- `idx_intermediate_artifacts_last_used_at`

用途：

- 对同一张白模图复用线稿图和深度图
- 支撑处理中锁
- 用版本字段避免错误复用
- 支撑部分命中时只补缺失项

### 4.10 users

表示后端账户主体。

```sql
users
id                  uuid primary key
email               text not null unique
password_hash       text not null
display_name        text not null
role                text not null default 'member'
status              text not null default 'enabled'
last_login_at       timestamptz null
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()
```

约束建议：

- `role in ('member', 'admin')`
- `status in ('enabled', 'disabled')`

索引建议：

- `uq_users_email`
- `idx_users_status`
- `idx_users_role`

用途：

- 承载真实用户身份
- 提供文件与执行归属主实体
- 支撑管理员账户管理

### 4.11 refresh_tokens

表示 refresh token 会话记录。

```sql
refresh_tokens
id                  uuid primary key
user_id             uuid not null
token_hash          text not null unique
status              text not null
issued_at           timestamptz not null default now()
expires_at          timestamptz not null
rotated_from_id     uuid null
revoked_at          timestamptz null
revoked_reason      text null
user_agent          text null
ip_address          text null
```

约束建议：

- `status in ('active', 'rotated', 'revoked', 'expired')`

索引建议：

- `idx_refresh_tokens_user_id`
- `idx_refresh_tokens_status`
- `idx_refresh_tokens_expires_at`

用途：

- 承载登录后的 refresh session
- 支撑 refresh token 轮换
- 支撑 logout 与禁用用户后的会话失效

### 4.12 audit_logs

表示管理员或系统关键操作的审计日志。

```sql
audit_logs
id                  uuid primary key
actor_user_id       uuid null
actor_role          text null
action              text not null
target_type         text not null
target_id           text null
payload             jsonb null
created_at          timestamptz not null default now()
```

索引建议：

- `idx_audit_logs_actor_user_id`
- `idx_audit_logs_action`
- `idx_audit_logs_created_at`

用途：

- 记录用户管理操作
- 记录关键认证操作
- 为后续后台排查提供最小审计面

## 5. 表关系

一期关键关系如下：

0. `workflow -> execution_runs`
   一对多
1. `file_blobs -> file_assets`
   一对多
2. `execution_runs -> execution_tasks`
   一对多
3. `execution_tasks -> task_attempts`
   一对多
4. `execution_tasks -> task_events`
   一对多
5. `execution_tasks -> task_file_links`
   一对多
6. `file_assets -> task_file_links`
   一对多
7. `execution_tasks -> provider_call_logs`
   一对多
8. `file_blobs -> intermediate_artifacts`
   一对多
9. `file_assets -> intermediate_artifacts`
   一对多
10. `users -> file_assets`
   一对多
11. `users -> execution_runs`
   一对多
12. `users -> execution_tasks`
   一对多
13. `users -> refresh_tokens`
   一对多
14. `users -> audit_logs`
   一对多

补充的分片聚合关系：

15. `workflow_index -> workflow_detail`
   一对多摘要到单画布详情
16. `workflow_detail -> workflow_files`
   一对多
17. `workflow_detail -> workflow_task_summaries`
   一对多
18. `execution_tasks -> task_event_streams`
   一对一事件流文件

## 6. 与白模渲染节点的映射

一次白模渲染节点点击执行，对应如下落库流程：

1. 画布保存到 `workflow.json`
2. 画布文件引用写入 `files.json`
3. 创建 1 条 `execution_runs`
4. 每个 group 创建 1 条 `execution_tasks`
5. 每个 group 的白模图与风格图进入 `task_file_links`
6. 每次 attempt 创建或更新 1 条 `task_attempts`
7. 每个步骤写入多条 `task_events` 或 JSONL 事件流
8. 每次外部平台调用写入 1 条 `provider_call_logs`
9. 线稿图和深度图命中或写入 `intermediate_artifacts`
10. 最终图保存为 `file_blobs + file_assets + task_file_links(role=output)`
11. workflow 级任务摘要同步汇总到 `tasks.json`

## 7. 一期关键约束

### 7.1 文件去重

- `file_blobs.sha256` 必须唯一
- `file_assets` 与 `file_blobs` 必须分层

### 7.2 grouped 任务

- 一个 `execution_runs` 可对应多个 `execution_tasks`
- 每个 group 必须有唯一 `group_id`
- 每个 task 独立重试和独立成功失败

### 7.3 中间产物复用

- 只复用 `lineart` 和 `depth`
- 复用键必须包含：
  - `source_blob_id`
  - `artifact_type`
  - `provider`
  - `model`
- 命中 `ready` 时必须更新 `last_used_at`
- 未命中时必须创建 `processing` 记录
- 并发情况下必须基于同一缓存键串行化，避免重复生成
  - `pipeline_version`
  - `prompt_version`

### 7.4 重试记录

- `execution_tasks.max_retries = 2`
- 最大 attempt 数为 3
- 每次 attempt 不能覆盖前一次 attempt 记录

### 7.5 Workflow 后端化约束

- 每个 `execution_run` 必须绑定 `workflow_id`
- 每个 `execution_task` 必须绑定 `workflow_id`
- task history 的主查询维度是 `workflow_id + created_at`
- 任务列表返回摘要，不直接内联完整事件流
- workflow 列表返回摘要，不返回完整节点 JSON

## 8. 编号建议

建议业务编号保持两级：

- `run_no`
  示例：`RUN-20260404-000001`
- `task_no`
  示例：`TASK-20260404-000001`

## 9. 一期明确不做的数据库能力

一期不要求：

- 后台运营相关表
- 项目/成员相关表
- API Key 池与租约表
- 文件生命周期治理表
- 成本统计表
- 多租户隔离相关表
- 复杂 RBAC 权限表

## 10. JSON Store 映射基线

当前阶段即使仍以 JSON Store 落地，也应遵循以下映射：

```text
workflow_index          -> backend/data/workflows/index.json
workflow_detail         -> backend/data/workflows/{workflowId}/workflow.json
workflow_files          -> backend/data/workflows/{workflowId}/files.json
workflow_task_summaries -> backend/data/workflows/{workflowId}/tasks.json
task_event_streams      -> backend/data/workflows/{workflowId}/events/{taskId}.jsonl
execution_runs          -> backend/data/executions/runs/{runId}.json
file_blobs/file_assets  -> backend/data/files/files-store.json + backend/storage/blobs/**
```

补充说明：

- `workflow.json` 保存完整画布结构，而不是列表摘要
- `tasks.json` 保存 task 级摘要，不保存完整事件流
- `events/{taskId}.jsonl` 使用追加写
- 写入时使用分片锁和原子替换，避免全局大文件竞争
## Task 01 Schema Boundary Addendum

Phase-1 database work must follow:

- `FILE-DATABASE-MIGRATION-FIELD-MAPPING.md`
- `FILE-DATABASE-CUTOVER-RUNBOOK.md`

The database schema target for phase 1 must support these runtime query paths:

- `file_assets -> file_blobs`
- `file_assets -> workflow_file_bindings -> workflows`
- `file_assets -> task_file_links -> execution_tasks`
- `execution_runs -> execution_tasks -> task_events`
- `users -> file_assets / execution_runs / refresh_tokens / audit_logs`

Phase 1 may preserve large or unstable structures as JSONB:

- workflow canvas payload
- execution request payload
- execution result summary
- task input payload
- task event payload
- audit payload

Phase 1 must not introduce schema requirements for:

- automatic storage lifecycle cleanup
- billing/cost tables
- provider key pool tables
- project/team member tables
- complex RBAC tables

Those subjects are reserved for later tasks.

## Task 02 Final Schema Baseline

This section is the schema baseline for Task 02. It supersedes earlier draft notes where they conflict.

### Migration Layout

- `001_init.sql` is the full empty-database baseline. A new database can start from this file and already has the phase-1 file database, workflow, execution, account, and migration tracking tables.
- `002_intermediate_artifacts.sql` remains the focused intermediate-artifact migration and now includes `updated_at`.
- `003_file_database_platform.sql` is the compatibility upgrade migration. It can run on an empty database or after an older `001/002` pair because it creates missing base tables first and then adds missing columns/indexes.

### File Tables

`file_blobs` stores deduplicated physical content:

- `id`, `sha256`, `size`, `mime_type`, `storage_key`, `storage_provider`
- original metadata: `extension`, `width`, `height`, `duration`
- current code fields for image derivatives: `preview_storage_key`, `preview_mime_type`, `preview_size`, `preview_width`, `preview_height`, `thumbnail_storage_key`, `thumbnail_mime_type`, `thumbnail_size`, `thumbnail_width`, `thumbnail_height`
- lifecycle timestamps: `created_at`, `updated_at`

`file_assets` stores user/business file records:

- nullable `blob_id` to support pending uploads
- `user_id`, `original_name`, `display_name`, `mime_type`, `file_type`, `source_type`
- upload state: `status`, `pending_upload_id`
- denormalized lookup metadata: `sha256`, `size`, `extension`, `width`, `height`, `duration`
- derivative readiness flags and dimensions: `preview_ready`, `preview_width`, `preview_height`, `thumbnail_ready`, `thumbnail_width`, `thumbnail_height`
- `file_type` supports `image`, `video`, `ply`, `unknown`
- `source_type` supports `input`, `intermediate`, `output`
- `status` supports `pending_upload`, `ready`, `failed`, `deleted`

`file_blob_variants` stores extensible blob variants:

- `blob_id`, `variant`, `variant_key`, `storage_provider`, `storage_key`
- `mime_type`, `size`, `extension`, `width`, `height`, `duration`, `metadata`
- unique identity: `blob_id + variant + variant_key`

`file_uploads` stores pending/completed upload requests:

- `file_id`, `user_id`, `sha256`, `size`, `mime_type`
- `original_name`, `display_name`, `file_type`, `source_type`
- `width`, `height`, `duration`
- `status`, `error_code`, `error_message`, `created_at`, `expires_at`, `completed_at`

`file_events` stores file audit and lifecycle events:

- `file_id`, `blob_id`, `upload_id`, `actor_user_id`, `event_type`, `payload`, `created_at`

`storage_objects` stores compatibility inventory for `storage-index.json`:

- `legacy_blob_id`, `sha256`, `file_type`, `source_type`, `original_name`, `mime_type`
- `storage_provider`, `storage_key`, `absolute_path`
- `size`, `extension`, `width`, `height`, `duration`, `metadata`, `created_at`, `migrated_at`

### Task 01 Physical Object Index Boundary

Runtime file lookup has a single physical object index:

- `file_blob_variants` is the runtime source of truth for physical objects.
- The runtime path from logical file to stored object is `file_assets.blob_id -> file_blobs.id -> file_blob_variants.blob_id`.
- `variant = 'original'` stores the primary object used by download.
- `variant = 'preview'` stores the preview object when `file_assets.preview_ready = true`.
- `variant = 'thumbnail'` stores the thumbnail object when `file_assets.thumbnail_ready = true`.
- `file_blobs.storage_key`, `preview_storage_key`, and `thumbnail_storage_key` are compatibility/backfill columns. New runtime checks should not treat them as the physical object index.
- `storage_objects` is legacy migration inventory for imported `storage-index.json` rows only. Runtime upload, Worker output registration, download, preview, thumbnail, and Admin storage issue queries must not depend on it.
- Admin storage issue checks must use `file_assets`, `file_blobs`, and `file_blob_variants` to detect missing original, preview, and thumbnail objects.

### Workflow Tables

`workflows` uses `text` ids because the current API treats `workflowId` as a route string, even though current samples are UUID-shaped:

- `id`, `project_id`, `owner_user_id`, `name`
- `group_id`, `container_key`, `is_auto_named`
- `node_count`, `connection_count`, `timestamp`, `version`
- full canvas document in `payload`
- `created_at`, `updated_at`

`workflow_groups` stores group metadata from `groups-index.json`.

`workflow_file_bindings` stores `workflows/{workflowId}/files.json`:

- `workflow_id`, `owner_user_id`, `node_id`, `file_id`, `role`
- `role` supports `file-node`, `node-reference`, `connection-reference`, `file-group`
- unique identity: `workflow_id + node_id + file_id + role`

### Execution Tables

`execution_runs` now includes workflow dimensions:

- `workflow_id`, `project_id`, `node_type`, `task_type`, `node_id`, `node_title`
- `request_payload` and `result_summary` remain JSONB for phase 1

`execution_tasks` now includes workflow and node dimensions:

- `workflow_id`, `project_id`, `node_type`, `node_id`, `node_title`, `task_type`
- `input` remains JSONB for executor-specific payloads
- `result_file_id` keeps the primary output shortcut

`task_events` now includes `workflow_id` for workflow task-history queries.

`task_file_links` now includes `workflow_id` for reverse lookup from file to task/workflow:

- derived inputs from `whiteModelFileId`, `styleReferenceFileId`, `input.referenceFileIds[]`, `input.fileIds[]`, `input.sourceFileId`, `input.maskFileId`
- outputs from `resultFileId`
- `source_handle` should preserve the original JSON field path when the migration tool can determine it

### Account And Migration Tables

`users`, `refresh_tokens`, and `audit_logs` cover `accounts-store.json` phase-1 migration.

`legacy_migration_runs` records one-shot migration attempts:

- `label`, `source_root`, `status`, `summary`, `error_message`
- `status` supports `generated`, `applied`, `failed`

### Required Query Paths

The Task 02 schema supports these bidirectional paths:

- file to physical object: `file_assets.blob_id -> file_blobs.id -> file_blob_variants.blob_id`
- file to workflow: `file_assets.id -> workflow_file_bindings.file_id -> workflows.id`
- workflow to files: `workflows.id -> workflow_file_bindings.workflow_id -> file_assets.id`
- workflow to execution: `workflows.id -> execution_runs.workflow_id -> execution_tasks.run_id`
- task to files: `execution_tasks.id -> task_file_links.task_id -> file_assets.id`
- file to tasks: `file_assets.id -> task_file_links.file_id -> execution_tasks.id`
- run to event stream: `execution_runs.id -> execution_tasks.run_id -> task_events.task_id`

### Task 02 Acceptance Coverage

- New empty database path: `001_init.sql` contains the complete phase-1 baseline.
- Existing database path: `003_file_database_platform.sql` creates missing tables and upgrades older `001/002` schemas with `if not exists` guards.
- Old JSON critical fields have database targets defined in `FILE-DATABASE-MIGRATION-FIELD-MAPPING.md` and concrete columns or JSONB landing zones in this schema.
- File, task, and workflow reverse lookup is covered by `workflow_file_bindings`, `task_file_links`, and indexed `workflow_id` columns.

## DB Only Storage Boundary Addendum

This section is the current DB Only boundary and supersedes earlier draft text
where it conflicts.

### PostgreSQL Does Not Store File Bytes

The backend does not store original file bytes, preview bytes, thumbnail bytes,
Worker output bytes, Worker intermediate bytes, or provider raw response
snapshots in PostgreSQL.

PostgreSQL stores:

- content identity and metadata
- logical file ownership and permissions
- upload state
- physical object keys
- workflow and task relationships
- execution state and event timelines
- intermediate artifact cache state
- provider call log summaries

Object storage stores:

- original uploaded files
- generated previews
- generated thumbnails
- intermediate artifacts such as `lineart` and `depth`
- final outputs
- provider diagnostic snapshots

The production target is S3, MinIO, OSS, or another object-storage-compatible
service plus PostgreSQL metadata. Local disk storage is only the development and
test implementation of the object storage interface.

### Physical Object Index

`file_blob_variants` is the only runtime physical object index.

Runtime lookup paths:

- download: `file_assets.blob_id -> file_blob_variants(variant = 'original')`
- preview: `file_assets.blob_id -> file_blob_variants(variant = 'preview')`
- thumbnail: `file_assets.blob_id -> file_blob_variants(variant = 'thumbnail')`

`file_blobs.storage_key`, `preview_storage_key`, and `thumbnail_storage_key` are
compatibility/backfill columns. New runtime code should not treat them as the
primary physical object index.

`storage_objects` is legacy migration inventory only:

- It records rows imported from old `storage-index.json`.
- It is useful for migration audit and troubleshooting old storage indexes.
- New uploads and Worker outputs must not write it.
- Download, preview, thumbnail, Admin storage issue checks, and DB Only tests
  must not depend on it.

### Intermediate Artifacts

`intermediate_artifacts` stores cache state, not bytes.

The reusable file itself is still represented by:

- `file_assets(source_type = 'intermediate')`
- `file_blobs`
- `file_blob_variants`

`intermediate_artifacts.file_id` points to the reusable logical file asset when
the cache entry is ready. The unique cache key is:

- `source_blob_id`
- `artifact_type`
- `provider`
- `model`
- `pipeline_version`
- `prompt_version`

Concurrency should be controlled by the database unique constraint and
transactions. JSON intermediate stores are legacy fallback only and are not part
of DB Only runtime.

### Provider Call Logs

`provider_call_logs` stores searchable summaries for provider calls:

- task id
- provider
- model
- step
- HTTP status
- success/failure
- error code and message
- request/response summaries
- snapshot path or object key

It must not store full provider raw responses when those responses can be large
or sensitive. Raw diagnostics remain file/object-storage data and are referenced
by path/key from the DB row.

### Backup Model

PostgreSQL backup and object storage backup are separate requirements:

- DB backup covers metadata, relationships, audit logs, workflows, executions,
  intermediate cache state, and provider call summaries.
- Object storage backup covers original bytes, derivatives, intermediate files,
  output files, and raw diagnostic snapshots.

Both are required for a complete restore. The DB can detect missing objects via
`file_blob_variants`, but it cannot recreate missing bytes.
