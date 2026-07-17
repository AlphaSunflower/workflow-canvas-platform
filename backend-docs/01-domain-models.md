# 域模型与字段定稿

## 1. TaskRecord

单条实际任务记录的标准结构如下：

```ts
type TaskScope = 'node' | 'group'

type TaskStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

type TaskNo = `TASK-${string}`

interface TaskNodeRef {
  nodeId: string
  nodeDisplayId: string
  nodeType: string
  nodeTitle?: string
}

interface TaskFileRef {
  fileId: string
  fileName?: string
  mimeType?: string
}

interface TaskErrorInfo {
  code: string
  message: string
}

interface TaskRecord {
  taskId: string
  taskNo: TaskNo
  batchId?: string
  projectId?: string
  workflowId?: string
  snapshotId?: string
  node: TaskNodeRef
  scope: TaskScope
  groupId?: string
  groupLabel?: string
  groupOrder?: number
  status: TaskStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  inputSummary?: Record<string, unknown>
  outputSummary?: Record<string, unknown>
  inputFiles?: TaskFileRef[]
  outputFiles?: TaskFileRef[]
  errorInfo?: TaskErrorInfo
}
```

## 2. taskId 与 taskNo 分工

### 2.1 taskId

- 系统内部主键
- 建议使用 UUID 或同等级唯一 ID
- 用于接口路径、数据库主键、任务关联

### 2.2 taskNo

- 面向展示和检索的业务编号
- 用于属性面板、任务历史页、运营排查、人工沟通
- 必须稳定、可读、唯一

格式固定为：

```text
TASK-YYYYMMDD-000001
```

示例：

```text
TASK-20260403-000001
TASK-20260403-000002
```

规则：

- 按服务端日期生成
- 每日序列从 `000001` 开始
- 同一天内不得重复

## 3. NodeTaskRef

节点本地保存的任务引用结构如下：

```ts
interface NodeTaskRef {
  taskId: string
  taskNo: TaskNo
  batchId?: string
  scope: 'node' | 'group'
  groupId?: string
  groupLabel?: string
  groupOrder?: number
  status: TaskStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
}
```

要求：

- `taskNo` 为必填
- 节点只保存任务引用，不保存后端专用冗余对象
- 详情查询以 `TaskRecord` 为准

## 4. FileSource

文件来源字段定稿如下：

```ts
interface FileSource {
  type: 'imported' | 'node-output'
  importMethod?: 'local'
  originalPath?: string
  importedAt?: number
  uploadedBy?: string
  producerNodeId?: string
  producerNodeDisplayId?: string
  producerNodeType?: string
  taskId?: string
  taskNo?: string
  taskCreatedAt?: number
  taskStartedAt?: number
  taskCompletedAt?: number
}
```

规则：

- `imported` 仅表示本地导入
- `node-output` 表示节点任务产物
- 节点产物必须带上生产节点与任务信息

## 5. NodeTaskResultPayload

节点任务完成后回传结果结构如下：

```ts
interface TaskResultOutput {
  files?: FileInfo[]
  data?: Record<string, unknown>
  text?: string
}

interface NodeTaskResultPayload {
  taskId: string
  taskNo: TaskNo
  batchId?: string
  node: TaskNodeRef
  scope: 'node' | 'group'
  groupId?: string
  groupLabel?: string
  groupOrder?: number
  status: TaskStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  inputs?: Record<string, unknown>
  outputs: TaskResultOutput
  errorInfo?: TaskErrorInfo
}
```

要求：

- 回传时必须带回 `taskId` 和 `taskNo`
- 必须保留 `createdAt`、`startedAt`、`completedAt`
- `outputs.files` 中每个 `FileInfo.source` 必须可还原来源

## 6. WorkflowSnapshot

工作流快照与任务关联结构如下：

```ts
interface WorkflowSnapshotTaskRef {
  taskId: string
  taskNo: TaskNo
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

规则：

- 快照与任务之间使用 `relatedTasks` 显式关联
- 不再只保存简单的 `relatedTaskIds`
- 属性面板、任务历史页、快照回放使用同一套任务引用字段

## 7. WorkflowSnapshotDetail

用于“加载快照时恢复画布并拿到对应任务集合”的接口响应。

```ts
interface WorkflowSnapshotDetail {
  snapshot: WorkflowSnapshot
  tasks: TaskRecord[]
}
```

规则：

- `snapshot` 用于恢复画布状态
- `tasks` 用于直接恢复关联任务集合
- 读接口应尽量避免前端再发二次批量任务查询

## 8. snapshotId 语义补充

当前 `TaskRecord` 中保留 `snapshotId?: string`，但其语义需要收口：

- 快照与任务的真实关联来源应是 `snapshot_task_links`
- `TaskRecord.snapshotId` 在查询场景中可作为“当前查询上下文快照 ID”回显
- 不应依赖 `TaskRecord.snapshotId` 代替关联表作为唯一真相来源
