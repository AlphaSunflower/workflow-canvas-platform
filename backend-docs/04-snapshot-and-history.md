# 快照关联与任务历史规范

## 1. 目标

任务历史页面需要同时满足两件事：

- 能按实际任务记录查看执行历史
- 能与某次画布状态快照建立关联

## 2. 任务历史的数据基础

任务历史页面必须基于 `TaskRecord` 列表构建，不基于节点状态临时推导。

每条任务历史至少展示：

- `taskNo`
- `status`
- `node.nodeDisplayId`
- `node.nodeTitle`
- `node.nodeType`
- `createdAt`
- `startedAt`
- `completedAt`
- `inputSummary`
- `outputSummary`
- `inputFiles`
- `outputFiles`

## 3. 并发任务规则

如果一个节点并发 10 个任务：

- 必须创建 10 条 `TaskRecord`
- 可共用一个 `batchId`
- 历史页可按 `batchId` 分组展示
- 但每条任务历史依然独立存在

## 4. 画布快照关联

### 4.1 快照存储结构

```ts
interface WorkflowSnapshotTaskRef {
  taskId: string
  taskNo: string
  batchId?: string
  nodeId: string
  nodeDisplayId: string
  nodeType: string
}

interface WorkflowSnapshot {
  snapshotId: string
  workflowId: string
  projectId?: string
  savedAt: number
  canvasState: unknown
  relatedTasks: WorkflowSnapshotTaskRef[]
}
```

### 4.2 关联规则

- 保存画布快照时，前端提交当前关联任务 ID 列表
- 后端根据任务主记录把 `relatedTaskIds` 扩展为标准 `relatedTasks`
- 后端保存快照主表与快照任务关联表
- 后续历史页或快照回放时，可反查当次画布关联的任务

## 5. 推荐接口

### 5.1 创建快照

```http
POST /api/v1/workflow-snapshots
Content-Type: application/json
```

请求体：

```ts
interface CreateWorkflowSnapshotRequest {
  workflowId: string
  projectId?: string
  canvasState: unknown
  relatedTaskIds: string[]
}
```

说明：

- 写接口使用 `relatedTaskIds`
- 读接口统一返回 `relatedTasks`
- 这样可以减少前端重复提交节点来源冗余信息，同时保证服务端以任务主记录为准构建关联

### 5.1.1 创建快照响应

```ts
interface WorkflowSnapshotDetail {
  snapshot: WorkflowSnapshot
  tasks: TaskRecord[]
}
```

### 5.2 查询快照

```http
GET /api/v1/workflow-snapshots/:snapshotId
```

响应：

```ts
interface WorkflowSnapshotDetail {
  snapshot: WorkflowSnapshot
  tasks: TaskRecord[]
}
```

要求：

- 返回 `snapshot.canvasState`
- 返回 `snapshot.relatedTasks`
- 返回完整 `tasks`
- 前端加载该接口后即可恢复画布并拿到关联任务集合

## 6. 任务历史页推荐查询模式

### 6.1 列表页

支持按以下条件筛选：

- `taskNo`
- `batchId`
- `nodeId`
- `nodeDisplayId`
- `nodeType`
- `status`
- `createdAt` 时间范围
- `snapshotId`

### 6.2 详情页

详情页应至少能获取：

- 完整 `TaskRecord`
- 关联 `snapshotId`
- 相关输入文件与输出文件
- 节点来源信息

## 7. 任务通过 snapshotId 反查画布

实现要求：

- `GET /api/v1/tasks?snapshotId={snapshotId}` 必须返回该快照关联的任务集合
- 任务详情在带快照上下文查询时，可回显 `snapshotId`
- 如果需要定位画布状态，应再调用 `GET /api/v1/workflow-snapshots/:snapshotId`

推荐流程：

1. 历史页按 `snapshotId` 查询任务列表
2. 用户打开某条任务或某个批次
3. 前端再调用快照详情接口恢复当时画布

## 8. 为什么快照关联不只保存 taskId

只保存 `taskId` 不够，原因是：

- 历史页列表需要直接显示业务编号 `taskNo`
- 快照列表可能直接显示节点来源信息
- 减少额外查询次数

因此：

- 写请求可以只传 `relatedTaskIds`
- 但读模型必须返回 `relatedTasks`
- 存储层应同时有快照主表和快照任务关联表
