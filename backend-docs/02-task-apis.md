# 任务接口文档

## 1. 目标

后端首先需要提供任务主记录与编号生成能力，并允许前端一次性创建 1..N 个实际任务。

## 2. 批量创建任务

### 2.1 接口

```http
POST /api/v1/tasks/batch
Content-Type: application/json
```

### 2.2 请求体

```ts
interface CreateTaskBatchItem {
  scope: 'node' | 'group'
  groupId?: string
  groupLabel?: string
  groupOrder?: number
  node: {
    nodeId: string
    nodeDisplayId: string
    nodeType: string
    nodeTitle?: string
  }
  inputSummary?: Record<string, unknown>
  inputFiles?: Array<{
    fileId: string
    fileName?: string
    mimeType?: string
  }>
}

interface CreateTaskBatchRequest {
  projectId?: string
  workflowId?: string
  batchId?: string
  items: CreateTaskBatchItem[]
}
```

### 2.3 处理规则

- 如果前端未传 `batchId`，后端生成一个新的 `batchId`
- `items.length` 代表本次需要创建的实际任务数
- 每个 `item` 必须创建一条独立任务记录
- 每条任务记录都必须拥有唯一 `taskId` 与 `taskNo`
- 初始状态统一为 `queued`
- `createdAt` 由后端写入
- 此接口只负责创建任务主记录，不代表任务已开始执行

### 2.4 响应体

```ts
interface CreateTaskBatchResponse {
  batchId: string
  tasks: TaskRecord[]
}
```

### 2.5 示例

请求：

```json
{
  "projectId": "proj-001",
  "workflowId": "wf-001",
  "items": [
    {
      "scope": "group",
      "groupId": "group-1",
      "groupLabel": "组 1",
      "groupOrder": 0,
      "node": {
        "nodeId": "17",
        "nodeDisplayId": "#00017",
        "nodeType": "aiImageGen",
        "nodeTitle": "AI 生图"
      },
      "inputSummary": {
        "prompt": "modern living room"
      },
      "inputFiles": [
        {
          "fileId": "file-001",
          "fileName": "input.png",
          "mimeType": "image/png"
        }
      ]
    }
  ]
}
```

响应：

```json
{
  "batchId": "batch-20260403-001",
  "tasks": [
    {
      "taskId": "task-uuid-001",
      "taskNo": "TASK-20260403-000001",
      "batchId": "batch-20260403-001",
      "projectId": "proj-001",
      "workflowId": "wf-001",
      "node": {
        "nodeId": "17",
        "nodeDisplayId": "#00017",
        "nodeType": "aiImageGen",
        "nodeTitle": "AI 生图"
      },
      "scope": "group",
      "groupId": "group-1",
      "groupLabel": "组 1",
      "groupOrder": 0,
      "status": "queued",
      "createdAt": 1775188800000,
      "inputSummary": {
        "prompt": "modern living room"
      },
      "inputFiles": [
        {
          "fileId": "file-001",
          "fileName": "input.png",
          "mimeType": "image/png"
        }
      ]
    }
  ]
}
```

## 3. 查询单任务

### 3.1 接口

```http
GET /api/v1/tasks/:taskId
```

### 3.2 返回

返回完整 `TaskRecord`。

用途：

- 节点详情查询
- 文件属性面板回查
- 任务历史页详情查看

## 4. 查询任务列表

### 4.1 接口

```http
GET /api/v1/tasks
```

### 4.2 查询参数

支持以下筛选条件：

- `taskId`
- `taskNo`
- `batchId`
- `snapshotId`
- `nodeId`
- `nodeDisplayId`
- `nodeType`
- `status`
- `createdFrom`
- `createdTo`
- `startedFrom`
- `startedTo`
- `completedFrom`
- `completedTo`
- `page`
- `pageSize`

### 4.3 返回

```ts
interface TaskListResponse {
  items: TaskRecord[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  totalPages: number
}
```

## 5. 更新任务状态

### 5.1 接口

```http
PATCH /api/v1/tasks/:taskId/status
Content-Type: application/json
```

### 5.2 请求体

```ts
interface UpdateTaskStatusRequest {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  startedAt?: number
  completedAt?: number
  errorInfo?: {
    code: string
    message: string
  }
}
```

### 5.3 规则

- 任务进入 `processing` 时应补写 `startedAt`
- 任务进入终态时应补写 `completedAt`
- 失败任务必须记录 `errorInfo`
- 状态流转必须遵守统一状态机，不可从终态回退
- 如果请求未传时间字段，后端使用服务端时间自动补齐

### 5.4 成功响应

返回更新后的完整 `TaskRecord`。

## 6. 回传任务结果

### 6.1 接口

```http
POST /api/v1/tasks/:taskId/result
Content-Type: application/json
```

### 6.2 请求体

请求体使用 `NodeTaskResultPayload`。

### 6.3 规则

- `taskId` 路径参数与请求体必须一致
- `taskNo` 必须回传，便于前后端日志对照
- `outputs.files` 中每个文件必须是完整 `FileInfo`
- 回传后，后端应更新：
  - `status`
  - `startedAt`
  - `completedAt`
  - `inputSummary`
  - `outputSummary`
  - `inputFiles`
  - `outputFiles`
  - `errorInfo`
- 若 `outputs.files` 为节点产物文件，后端必须自动补全 `FileSource`
- 文件来源补全规则见 [03-file-node-metadata.md](./03-file-node-metadata.md)

### 6.4 请求体语义补充

```ts
interface NodeTaskResultPayload {
  taskId: string
  taskNo: TaskNo
  batchId?: string
  node: TaskNodeRef
  scope: 'node' | 'group'
  groupId?: string
  groupLabel?: string
  groupOrder?: number
  status: 'processing' | 'completed' | 'failed' | 'cancelled'
  createdAt: number
  startedAt?: number
  completedAt?: number
  inputs?: Record<string, unknown>
  outputs: {
    files?: FileInfo[]
    data?: Record<string, unknown>
    text?: string
  }
  errorInfo?: {
    code: string
    message: string
  }
}
```

### 6.5 成功响应

返回更新后的完整 `TaskRecord`。

## 7. 编号生成规则

### 7.1 taskNo

格式：

```text
TASK-YYYYMMDD-000001
```

要求：

- 服务端统一生成
- 同日单调递增
- 高并发下不可重复

### 7.2 batchId

建议格式：

```text
BATCH-YYYYMMDD-HHMMSS-XXXX
```

要求：

- 一次批量触发共用同一个 `batchId`
- 用于历史页聚合，不替代 `taskId`

## 8. 查询接口细化

## 8.1 GET /api/v1/tasks

用途：

- 任务历史页列表
- 属性面板的反向任务检索
- 按节点或快照聚合排查

查询参数：

```ts
interface TaskQueryParams {
  taskId?: string
  taskNo?: string
  batchId?: string
  snapshotId?: string
  nodeId?: string
  nodeDisplayId?: string
  nodeType?: string
  status?: TaskStatus | TaskStatus[]
  createdFrom?: number
  createdTo?: number
  startedFrom?: number
  startedTo?: number
  completedFrom?: number
  completedTo?: number
  page?: number
  pageSize?: number
}
```

说明：

- `taskNo` 用于业务编号精确查找或模糊查找
- `nodeDisplayId` 用于按前端显示编号检索
- `batchId` 用于查看某次批量触发产生的全部任务
- `snapshotId` 用于查看某次画布快照关联的全部任务

补充规则：

- `snapshotId` 查询必须基于快照任务关联表实现
- 不应仅依赖任务表中的单字段冗余回查
- 返回结果仍然使用标准 `TaskRecord[]`

## 8.2 GET /api/v1/tasks/:taskId

返回完整任务详情，供以下场景复用：

- 任务历史详情页
- 文件节点属性面板
- 调试与排障

## 9. 任务 3 验收映射

本任务文档已覆盖以下验收要求：

- `PATCH /api/v1/tasks/:taskId/status` 正确维护状态流转和时间字段
- `POST /api/v1/tasks/:taskId/result` 回传结果后，节点产物文件具备完整来源信息
- `GET /api/v1/tasks` 和 `GET /api/v1/tasks/:taskId` 满足任务历史页查询需求
