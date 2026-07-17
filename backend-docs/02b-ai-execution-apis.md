# AI 执行接口命名空间

## 1. 目标

任务主记录接口已经统一使用 `/api/v1/tasks/*`。

为避免与现有流式 AI 执行接口冲突，实际执行型 AI 任务必须独立到单独命名空间，前后端统一改为：

- `POST /api/v1/ai/tasks`
- `GET /api/v1/ai/tasks/:taskId`
- `DELETE /api/v1/ai/tasks/:taskId`

说明：

- 这里的 `taskId` 表示 AI 执行任务 ID，不等于任务主记录 `TaskRecord.taskId`
- 任务主记录负责编号、历史、快照关联、文件来源追踪
- AI 执行任务负责实际排队、流式进度、取消与执行输出

## 2. 推荐关系

前端执行一个节点时，应先创建任务主记录，再创建 AI 执行任务。

推荐映射关系：

- `TaskRecord.taskId`: 任务历史主键
- `TaskRecord.taskNo`: 业务编号
- `AITask.id`: 执行实例 ID

前端在发起 AI 执行请求时，应把主记录信息写入执行上下文，至少包括：

- `taskRecordId`
- `taskNo`
- `batchId`
- `nodeDisplayId`

## 3. AI 执行创建接口

```http
POST /api/v1/ai/tasks
Content-Type: application/json
```

在现有执行请求体 `input.execution` 中新增以下上下文字段：

```ts
interface AITaskExecutionContext {
  scope: 'node' | 'group'
  workflowId?: string
  workflowVersion?: number
  nodeType?: string
  nodeDisplayId?: string
  taskRecordId?: string
  taskNo?: string
  batchId?: string
  groupId?: string
  groupLabel?: string
  groupOrder?: number
  outputHandle?: string
  idempotencyKey?: string
}
```

## 4. WebSocket 事件

WebSocket 事件类型仍可继续使用：

- `ai-stream`
- `subscribe-task`
- `unsubscribe-task`

但这里订阅的对象是 `AITask.id`，不是任务主记录 ID。

## 5. 前端接入原则

- 取消执行时，调用 `DELETE /api/v1/ai/tasks/:taskId`
- 状态流转和结果回传时，调用 `/api/v1/tasks/:taskRecordId/*`
- UI 展示时允许同时保留：
  - `aiTaskId`
  - `taskRecordId`
  - `taskNo`

## 6. 与任务历史接口的边界

下列接口只面向任务主记录，不得混用到 AI 执行任务上：

- `POST /api/v1/tasks/batch`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId/status`
- `POST /api/v1/tasks/:taskId/result`
