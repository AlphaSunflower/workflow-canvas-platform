# 后端开发方案与技术路径研究

更新时间：2026-04-03

## 1. 结论摘要

这个仓库当前不是“前后端待联调的完整平台”，而是一个已经有较强画布运行时能力的前端原型。后端开发不应该直接照 `spec.md` 的全栈蓝图一次性铺开，而应该按当前前端真实调用链分三层推进：

1. 先做“工作流持久化 + 文件服务 + 基础任务服务”的 MVP 后端。
2. 再做“真实 AI 异步执行 + 任务进度推送 + 结果文件回写”。
3. 最后再做“用户/项目/团队/协作/审计”等平台化能力。

推荐路线是：

- 语言与主服务：`Go`
- Web 框架：`Gin`
- 数据库：`PostgreSQL`
- 缓存与任务队列：`Redis`
- 对象存储：`MinIO`
- ORM：`GORM`
- 异步任务：`Asynq` 作为 MVP；如果后期要做长时复杂编排，再评估 `Temporal`
- 实时推送：WebSocket

原因很简单：当前前端已经预留了 `workflow/file/task/ws` 四类后端接口，且节点运行模型天然适合“HTTP 创建任务 + WebSocket 订阅进度 + 对象存储承载产物”的模式。

## 2. 基于代码的项目现状判断

### 2.1 当前真实运行形态

从代码看，当前应用入口是一个固定项目画布：

- [App.tsx](/D:/project/newflow5/newworkflow2/frontend/src/App.tsx#L13) 把 `Canvas` 直接绑定到 `projectId="default"`

前端真实运行链路是：

- `ReactFlow runtime`
- `WorkflowProvider`
- `useWorkflow`
- `Canvas / Toolbar / Node definitions`

也就是说，当前“真状态源”仍然主要在前端运行时，而不是数据库。

### 2.2 前端已经明确依赖的后端能力

代码中已经有明确的后端调用位点：

- 工作流加载/保存：
  - [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L287)
  - [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L648)
  - [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L664)
- AI 任务创建/订阅：
  - [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L720)
  - [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L737)
- 任务结果文件信息查询与远程文件 URL 生成：
  - [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L598)
  - [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L631)

这说明后端一期最少要支撑：

- `workflow get/save`
- `file upload/get/download/preview/thumbnail`
- `task create/get/cancel`
- `ws task progress`

### 2.3 当前哪些能力仍然是前端本地逻辑

文件导入阶段，前端现在先本地生成预览和元数据，再渲染成节点：

- [Canvas.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/canvas/Canvas.tsx#L605)
- [Canvas.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/canvas/Canvas.tsx#L628)
- [Canvas.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/canvas/Canvas.tsx#L736)
- [file-service.ts](/D:/project/newflow5/newworkflow2/frontend/src/services/file/file-service.ts)

因此后端一期不必强行接管“导入前预处理”。更合理的策略是：

- 前端继续负责导入时即时预览
- 后端负责正式文件入库、远程预览地址、缩略图产物和持久元数据

### 2.4 节点执行模型已经给出后端任务边界

各 AI 节点已经把执行需求编码成任务类型与输入模型：

- `aiImageGen`：分组执行，任务类型 `image-gen`
- `aiMultiViewRestore`：分组执行，任务类型 `multi-view-restore`
- `aiModelRenderTransfer`：分组执行，任务类型 `model-render-transfer`
- `aiVideoGen`：占位 mock，任务类型 `video-gen`
- `aiImageToPly`：当前 mock，任务类型 `image-to-ply`
- `aiImageHd`：当前 mock，任务类型 `image-hd`
- `aiFloorplanColorize`：当前 mock，任务类型 `floorplan-colorize`

对应文件可见：

- [ai-image-gen/runtime.ts](/D:/project/newflow5/newworkflow2/frontend/src/nodes/ai-image-gen/runtime.ts)
- [ai-multi-view-restore/runtime.ts](/D:/project/newflow5/newworkflow2/frontend/src/nodes/ai-multi-view-restore/runtime.ts)
- [ai-model-render-transfer/runtime.ts](/D:/project/newflow5/newworkflow2/frontend/src/nodes/ai-model-render-transfer/runtime.ts)
- [ai-image-to-ply/runtime.ts](/D:/project/newflow5/newworkflow2/frontend/src/nodes/ai-image-to-ply/runtime.ts)
- [ai-image-hd/runtime.ts](/D:/project/newflow5/newworkflow2/frontend/src/nodes/ai-image-hd/runtime.ts)
- [ai-floorplan-colorize/runtime.ts](/D:/project/newflow5/newworkflow2/frontend/src/nodes/ai-floorplan-colorize/runtime.ts)

后端不需要重新定义这套任务边界，应该直接复用。

## 3. 推荐的后端总体方案

## 3.1 目标架构

建议先采用“单仓单体后端 + 独立 worker”的务实架构：

```text
frontend
  -> HTTP API (Gin)
  -> WebSocket Gateway

API Server
  -> PostgreSQL
  -> Redis
  -> MinIO
  -> Asynq Client

Worker
  -> Asynq Server
  -> AI Provider Adapters
  -> MinIO
  -> PostgreSQL
  -> Redis
```

这样做的优点：

- 实现快
- 与前端现有 API 预留最贴合
- 易于本地开发和私有部署
- 后续可以平滑拆分任务 worker、文件处理 worker、协作服务

不建议一开始就上微服务，原因是当前业务边界还没稳定，协议也还未完全统一。

## 3.2 技术选型建议

### 首选方案

- `Go + Gin + GORM + PostgreSQL + Redis + MinIO + Asynq`

适用原因：

- Go 很适合高并发 API、任务调度、文件流转和 WebSocket
- 前端文档原本也倾向 Go，团队认知成本更低
- Asynq 对“任务提交/重试/延迟/优先级”这类 AI 工作流需求足够实用
- MinIO 适合私有化部署和 S3 兼容接口

### 可选替代方案

#### 方案 B：`NestJS + PostgreSQL + Redis + MinIO + BullMQ`

优点：

- 对前端同学更友好
- DTO / 验证 / OpenAPI 支持成熟

缺点：

- 文件和长任务链路下，资源开销通常高于 Go
- 当前仓库的技术文档、类型边界和工程气质更偏 Go

#### 方案 C：`Go + Temporal`

适合条件：

- 后续要做复杂多步编排
- 同一任务有长时间等待、人工干预、回调补偿、强幂等等需求

现阶段不建议直接上，原因是：

- 当前项目第一阶段只需要简单异步队列
- Temporal 引入的运维和学习成本较高

结论：

- MVP 用 `Asynq`
- 当 AI 编排明显复杂化后，再评估升级到 `Temporal`

## 4. 建议的后端边界拆分

## 4.1 一期必须实现

### 模块 A：工作流服务

职责：

- 根据 `projectId` 读取工作流
- 保存完整工作流快照
- 保存版本号与更新时间
- 提供导入导出

原因：

- 当前前端启动时就会请求工作流；失败时才退回内存创建
- 见 [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L664)

### 模块 B：文件服务

职责：

- 文件上传
- 元数据存储
- 预览图/缩略图访问
- 文件详情查询
- 下载
- 产物文件入库

原因：

- AI 输出回写逻辑依赖 `FileInfo`
- 图片节点远程渲染依赖 `/preview` 和 `/thumbnail`
- 见 [file-api.ts](/D:/project/newflow5/newworkflow2/frontend/src/api/services/file-api.ts#L208)

### 模块 C：AI 任务服务

职责：

- 创建任务
- 查询任务状态
- 取消任务
- 推送任务进度
- 任务完成后写入输出文件记录

原因：

- 前端 AI 节点执行链已经强依赖此模型

### 模块 D：项目壳层

职责：

- 至少提供 `project` 概念
- 先支持单用户或默认工作区下的项目

原因：

- 工作流与文件都天然挂在 `projectId`

## 4.2 二期建议实现

- 登录鉴权
- 用户体系
- 项目成员与角色
- 模板存储
- 审计日志
- 文件去重与秒传
- 预签名 URL

## 4.3 三期再实现

- 实时协作
- 细粒度权限
- 配额与计费
- API 资源池与多供应商调度台
- 运维后台

## 5. 数据模型建议

## 5.1 建议采用“工作流快照 + 结构化附属表”模式

不要一开始把节点、边、分组、引用全拆成高度范式化表。

更推荐：

- 主表里保存工作流 JSON 快照
- 辅助表保存文件、任务、项目、用户等稳定实体

原因：

- 当前前端工作流结构变化频繁
- 节点类型和输入分组逻辑仍在演进
- 用 JSONB 存整个 workflow 能最快落地，且最贴合前端现状

### 建议核心表

#### `projects`

```sql
id uuid pk
name text
description text
status text
owner_id uuid null
created_at timestamptz
updated_at timestamptz
```

#### `workflows`

```sql
id uuid pk
project_id uuid unique
name text
version int not null default 1
snapshot jsonb not null
created_at timestamptz
updated_at timestamptz
```

#### `files`

```sql
id uuid pk
project_id uuid
uploaded_by uuid null
name text
original_name text
size bigint
mime_type text
format text
file_type text
status text
hash text null
storage_key text
thumbnail_key text null
preview_key text null
metadata jsonb
source jsonb
created_at timestamptz
updated_at timestamptz
deleted_at timestamptz null
```

#### `ai_tasks`

```sql
id uuid pk
project_id uuid
node_id text
type text
provider text
model text null
status text
progress int
input jsonb
output jsonb null
error jsonb null
priority text
retry_count int
max_retries int
timeout_seconds int null
created_at timestamptz
updated_at timestamptz
started_at timestamptz null
completed_at timestamptz null
```

#### `task_events`

```sql
id bigserial pk
task_id uuid
event_type text
sequence int
payload jsonb
created_at timestamptz
```

这个表不是必须，但强烈建议保留，用于：

- WebSocket 断线补偿
- 调试任务进度
- 审计问题排查

## 5.2 工作流快照结构应直接复用前端类型

工作流结构应尽量对齐：

- [workflow.types.ts](/D:/project/newflow5/newworkflow2/frontend/src/types/workflow.types.ts)
- [node.types.ts](/D:/project/newflow5/newworkflow2/frontend/src/types/node.types.ts)
- [ai.types.ts](/D:/project/newflow5/newworkflow2/frontend/src/types/ai.types.ts)
- [file.types.ts](/D:/project/newflow5/newworkflow2/frontend/src/types/file.types.ts)

建议在后端定义一套与前端同构的 DTO，而不是按数据库表形强行重构 JSON。

## 6. 文件服务设计建议

## 6.1 对象存储路径建议

建议：

```text
projects/{project_id}/files/{file_id}/original
projects/{project_id}/files/{file_id}/preview
projects/{project_id}/files/{file_id}/thumbnail
projects/{project_id}/tasks/{task_id}/outputs/{file_id}
```

优点：

- 便于按项目清理
- 便于追踪任务产物
- 与用户体系解耦，后续再补用户维度也不难

## 6.2 文件上传策略

### 一期建议

- 小文件：后端直传
- 大文件：后端分片上传接口

### 但要注意当前前端有协议问题

现有前端实现中，分片接口把 `Blob` 放进 JSON 请求体：

- [file-api.ts](/D:/project/newflow5/newworkflow2/frontend/src/api/services/file-api.ts#L108)

这在真实后端里不可用。应改成两种之一：

1. 前端直接上传分片二进制到后端
2. 后端签发分片上传 URL，前端直传 MinIO/S3

建议采用：

- MVP：二进制分片走后端
- 二期：预签名直传 MinIO

## 6.3 预览与缩略图策略

### 当前前端真实需求

图片节点需要：

- 预览图 URL
- 缩略图 URL
- 原图 URL 最好也可访问

见：

- [image-asset.ts](/D:/project/newflow5/newworkflow2/frontend/src/services/image/image-asset.ts)
- [nodes/shared/runtime.ts](/D:/project/newflow5/newworkflow2/frontend/src/nodes/shared/runtime.ts#L309)

### 建议

- 上传图片时生成 `thumbnail + preview`
- 上传视频时生成 `thumbnail`
- 图片原图可通过 `/download` 或 `/original` 提供
- `FileInfo` 中记录 `metadata.width/height/duration`

## 6.4 文件去重

现阶段建议只做“软去重能力预留”：

- 表结构保留 `hash`
- 上传完成后异步算 hash
- 先不做跨项目硬复用

原因：

- 当前前端节点与项目关系还较轻
- 一开始做跨项目物理去重会把权限和引用语义复杂化

## 7. AI 任务服务设计建议

## 7.1 当前最适合的任务模型

前端已经形成统一模型：

- HTTP 创建任务
- WebSocket 推送 chunk/progress
- 任务完成后回查 `task`
- 再查 `fileInfo`

这是典型的“异步任务 + 事件流”架构。

## 7.2 任务生命周期

建议状态机：

```text
pending -> queued -> processing -> completed
                             -> failed
                             -> cancelled
```

与前端类型基本一致。

## 7.3 Worker 责任拆分

每个 worker 执行流程建议统一为：

1. 读取任务
2. 解析输入文件 ID
3. 拉取原始文件或预览文件
4. 调用 AI provider
5. 写入任务进度事件
6. 保存输出文件到 MinIO
7. 创建 `files` 记录
8. 更新 `ai_tasks.output`
9. 推送完成事件

## 7.4 任务输出格式

后端务必返回前端已经能直接消费的结构：

```json
{
  "files": ["file-id-1"],
  "fileInfos": [
    {
      "id": "file-id-1",
      "name": "result.png",
      "size": 123456,
      "mimeType": "image/png",
      "format": "png",
      "fileType": "image",
      "status": "completed",
      "path": "projects/.../original",
      "metadata": { "width": 1024, "height": 1024 },
      "source": { "type": "generated", "taskId": "task-id" },
      "timestamp": { "created": 0, "updated": 0 }
    }
  ],
  "metadata": {}
}
```

原因：

- 前端优先读取 `task.output.fileInfos`
- 如果没有，才回退到 `task.output.files` 再逐个查询 `fileApi.getInfo`

见：

- [WorkflowContext.tsx](/D:/project/newflow5/newworkflow2/frontend/src/components/context/WorkflowContext.tsx#L586)

建议后端直接把 `fileInfos` 填完整，减少额外查询。

## 7.5 Provider 适配层设计

建议后端抽象：

```text
providers/
  image/
  video/
  model/
```

统一接口：

```go
type TaskExecutor interface {
    Execute(ctx context.Context, task TaskContext) (<-chan TaskEvent, error)
}
```

这样能把：

- `stability`
- `runway`
- `meshy`

等供应商隔离在适配层，不污染主业务。

## 8. 工作流服务设计建议

## 8.1 保存策略

建议一期采用“整份快照保存”：

- `GET /api/v1/projects/:id/workflow`
- `POST /api/v1/projects/:id/workflow`

正好匹配当前前端：

- [workflow-api.ts](/D:/project/newflow5/newworkflow2/frontend/src/api/services/workflow-api.ts)

## 8.2 版本控制

建议工作流表加 `version` 字段，并支持乐观锁：

- 前端保存时带当前版本
- 后端比较版本
- 冲突时返回 `409`

虽然当前前端还没有多人协作，但这能为将来协作打基础。

## 8.3 导出导入

建议：

- 导出：直接返回 JSON 文件流
- 导入：后端校验结构后保存为新 workflow

当前前端已经有导入导出模型，但下载接口实现与 `httpClient` 风格不统一，建议后续顺手统一。

## 9. WebSocket 设计建议

## 9.1 一期只做任务类消息

不要一开始把协作消息也塞进去。

一期消息类型建议只包括：

- `task_progress`
- `task_completed`
- `task_failed`
- `ping`
- `pong`

## 9.2 当前前端存在协议不一致

当前类型层定义的 `WSMessageType` 和实际调用并不一致。

例如：

- 类型定义里是 `task_progress`
- 但订阅代码使用的是 `ai-stream`
- 发送代码还出现 `subscribe-task`

见：

- [workflow-api.ts](/D:/project/newflow5/newworkflow2/frontend/src/api/services/workflow-api.ts#L52)
- [api.types.ts](/D:/project/newflow5/newworkflow2/frontend/src/types/api.types.ts)

后端开发前必须先统一协议，建议直接改成：

- 前端连接后订阅 `task:{taskId}`
- 服务端只发统一任务事件

例如：

```json
{
  "type": "task_progress",
  "payload": {
    "taskId": "xxx",
    "status": "processing",
    "progress": 35,
    "message": "generating"
  },
  "timestamp": 0
}
```

## 10. 用户与权限方案建议

## 10.1 一期建议极简

由于当前前端仍是固定 `projectId="default"` 模式，不建议一开始就做完整 RBAC。

建议分两步：

### Step 1

- 无鉴权或开发态假用户
- 单用户工作区
- 默认 project

### Step 2

- JWT 登录
- `users`
- `project_members`
- 项目级权限

这样能明显降低一期复杂度。

## 10.2 如果业务要求立即上权限

则最少实现：

- 注册/登录
- 当前用户
- 项目 owner/editor/viewer
- 文件和 workflow 都按 `project_id` 做访问控制

不要先做团队、组织、API 资源池后台，这些都不是当前前端第一落点。

## 11. 推荐的开发阶段

## Phase 0：协议对齐

目标：把前端预留接口与真实后端协议统一。

必须处理的问题：

- WebSocket 消息类型统一
- 文件分片上传改为可执行协议
- `FileInfo` 结构与后端响应固定
- 工作流保存响应格式固定

## Phase 1：后端骨架

内容：

- Gin 项目初始化
- 配置系统
- PostgreSQL/Redis/MinIO 接入
- Docker Compose
- 健康检查
- 统一响应结构

## Phase 2：工作流与文件服务

内容：

- `projects`
- `workflows`
- `files`
- 上传/查询/下载/预览/缩略图
- 工作流加载/保存

验收标志：

- 画布能真实保存并重新加载
- 导入文件后能拿到后端文件记录
- 图片节点能走后端预览地址显示

## Phase 3：AI 任务服务

内容：

- `ai_tasks`
- Asynq worker
- 任务创建/取消/查询
- WebSocket 推送进度
- 输出文件入库

验收标志：

- 至少一个真实 AI 节点能跑通闭环
- 任务完成后自动生成输出文件节点

## Phase 4：用户与项目化

内容：

- 登录鉴权
- 项目列表
- 项目成员
- 权限控制

## Phase 5：协作与高级能力

内容：

- Yjs / 协作服务
- 审计日志
- 模板云端化
- API 池与资源调度

## 12. 我建议的目录结构

```text
backend/
  cmd/api/
  cmd/worker/
  internal/
    app/
    config/
    infra/
      db/
      redis/
      storage/
      queue/
      ws/
    domain/
      project/
      workflow/
      file/
      task/
      auth/
    service/
      workflow/
      file/
      task/
    transport/
      http/
      websocket/
    worker/
      handlers/
      providers/
  migrations/
  deployments/
    docker-compose.yml
```

特点：

- 单体，但层次清晰
- API 与 worker 分入口
- domain/service/infra 易于演化

## 13. 开发前必须先解决的几个风险点

## 风险 1：当前前端接口是“半真实、半占位”

例如：

- 有真实 API 调用位点
- 但上传分片和 WS 订阅协议还不闭合

这意味着后端不能盲写，必须先做接口收口。

## 风险 2：项目与用户模型尚未真正进入 UI 主流程

当前仍是固定 `default` 项目。

如果后端直接做复杂用户/组织模型，短期不会被前端消费，投入产出比低。

## 风险 3：AI 节点并非全部是真实执行模式

目前只有部分节点是“真实任务式建模”，不少仍是 mock 输出。

后端一期最好先选 1 到 2 个最关键节点打通，而不是全量铺开。

建议优先：

1. `aiImageGen`
2. `aiMultiViewRestore` 或 `aiModelRenderTransfer`

## 风险 4：工作流结构仍可能继续演化

因此不建议先做重数据库范式化建模。

优先 JSONB 快照，是更稳妥的路径。

## 14. 最终推荐方案

如果目标是“尽快把这个项目从前端原型推进到可真实运行的平台”，我建议采用下面的路径：

### 推荐路线

- 后端栈：`Go + Gin + GORM + PostgreSQL + Redis + MinIO + Asynq`
- 一期范围：`workflow + file + task + ws`
- 存储策略：`workflow snapshot(JSONB) + files/tasks 结构化表`
- 文件策略：前端保留导入即时预处理，后端负责正式存储与远程资源
- AI 策略：先打通 `aiImageGen`
- 权限策略：先单用户/弱鉴权，再逐步平台化

### 不推荐路线

- 按 `spec.md` 一次性做完整平台
- 一开始就做微服务
- 一开始就做复杂 RBAC/团队系统
- 一开始就把 workflow 拆成高度范式化关系表

## 15. 建议的下一步

建议立即做三件事：

1. 先写后端 OpenAPI 草案，收口 `workflow/file/task/ws` 协议。
2. 在仓库新增 `backend/` 骨架、Docker Compose、配置文件模板。
3. 先实现 `GET/POST workflow` 和 `file upload/get/preview/thumbnail`，把前端从“内存/本地预处理”推进到“可持久化画布”。

---

如果继续推进，我建议下一步直接为这个仓库搭一个 `backend/` 初始工程，并同时产出：

- API 路由骨架
- 数据表初版 migration
- Docker Compose
- 与当前前端对齐的 DTO 定义

## 16. 任务/历史/快照正式联调文档

从 2026-04-03 起，任务编号、任务历史、任务状态流转、结果回传、文件来源、快照绑定相关接口，统一以下文档为最终定稿依据：

- [frontend/docs/task-execution-history-api-spec.md](/D:/Project/newflow5/newworkflow2/frontend/docs/task-execution-history-api-spec.md)

该文档已经覆盖：

- `POST /api/v1/tasks/batch`
- `PUT /api/v1/tasks/:taskId/status`
- `POST /api/v1/tasks/:taskId/result`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `POST /api/v1/workflow-snapshots`
- `GET /api/v1/workflow-snapshots/:snapshotId`
- 任务编号规则
- 时间字段语义
- 文件来源规则
- 任务历史页字段展示规范
- 文件节点属性窗口字段展示规范
- 从“创建任务”到“保存快照/展示历史”的完整时序

生效优先级：

- 如本文件中的旧任务草案与正式联调文档冲突，以正式联调文档为准。
- [frontend/docs/backend-node-execution-payload-spec.md](/D:/Project/newflow5/newworkflow2/frontend/docs/backend-node-execution-payload-spec.md) 继续保留，作为旧执行链路背景材料；但不再作为 tasks/snapshots/history 的最终接口定稿依据。
