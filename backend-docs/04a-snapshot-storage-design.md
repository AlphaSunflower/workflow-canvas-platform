# 快照存储设计与接口细则

## 1. 目标

任务 4 需要实现三件事：

- 持久化某次保存时刻的画布状态
- 持久化该时刻关联的任务集合
- 支持从快照查任务，也支持从任务经 `snapshotId` 定位画布

## 2. 设计结论

## 2.1 存储采用主表 + 关联表

必须建立：

- `snapshots`
- `snapshot_task_links`

原因：

- 一个快照可以关联多个任务
- 一个任务理论上也可能出现在多个已保存快照中
- 单纯在任务表上放一个 `snapshotId` 不足以表达完整关系

## 2.2 接口写入与读取分离

写接口：

- 只要求前端提交 `relatedTaskIds`

读接口：

- 返回标准 `relatedTasks`
- 同时返回完整 `tasks`

这样做的原因：

- 保存时前端只需要表达“绑定哪些任务”
- 节点编号、任务编号、节点类型等信息应由后端以任务主记录为准填充
- 避免前端提交的任务引用对象与后端任务主记录发生漂移

## 3. 快照主表设计

建议结构：

```sql
snapshots
---------
snapshot_id        varchar / uuid primary key
workflow_id        varchar / uuid not null
project_id         varchar / uuid null
canvas_state       jsonb not null
saved_at           bigint / timestamptz not null
created_at         bigint / timestamptz not null
updated_at         bigint / timestamptz not null
```

建议索引：

- `idx_snapshots_workflow_id`
- `idx_snapshots_project_id`
- `idx_snapshots_saved_at`

## 4. 快照任务关联表设计

建议结构：

```sql
snapshot_task_links
-------------------
id                 bigserial / uuid primary key
snapshot_id        varchar / uuid not null
task_id            varchar / uuid not null
task_no            varchar not null
batch_id           varchar null
node_id            varchar not null
node_display_id    varchar not null
node_type          varchar not null
linked_at          bigint / timestamptz not null
```

建议约束：

- `foreign key (snapshot_id) references snapshots(snapshot_id)`
- `foreign key (task_id) references tasks(task_id)`
- `unique (snapshot_id, task_id)`

建议索引：

- `idx_snapshot_task_links_snapshot_id`
- `idx_snapshot_task_links_task_id`
- `idx_snapshot_task_links_task_no`

## 5. 创建快照接口

### 5.1 接口

```http
POST /api/v1/workflow-snapshots
Content-Type: application/json
```

### 5.2 请求体

```ts
interface CreateWorkflowSnapshotRequest {
  workflowId: string
  projectId?: string
  canvasState: unknown
  relatedTaskIds: string[]
}
```

### 5.3 后端处理规则

- 创建一条 `snapshots` 记录
- 根据 `relatedTaskIds` 查询任务主记录
- 为每个有效任务创建一条 `snapshot_task_links` 记录
- 从任务主记录映射出 `relatedTasks`
- 返回快照详情对象

### 5.4 校验规则

- `workflowId` 必填
- `canvasState` 必填
- `relatedTaskIds` 允许为空数组
- 如果 `relatedTaskIds` 中存在不存在的任务 ID，应返回校验错误，不能静默忽略

## 6. 查询快照详情接口

### 6.1 接口

```http
GET /api/v1/workflow-snapshots/:snapshotId
```

### 6.2 响应体

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

interface WorkflowSnapshotDetail {
  snapshot: WorkflowSnapshot
  tasks: TaskRecord[]
}
```

### 6.3 返回要求

- `snapshot.canvasState` 必须可直接用于恢复画布
- `snapshot.relatedTasks` 必须可直接用于任务引用展示
- `tasks` 必须是完整任务对象数组

## 7. 任务反查快照

## 7.1 列表查询

通过任务查询接口支持：

```http
GET /api/v1/tasks?snapshotId={snapshotId}
```

实现方式：

- 根据 `snapshot_task_links` 找到关联 `task_id`
- 再查询任务主记录

## 7.2 单任务定位画布

如果任务详情场景已经知道 `snapshotId`：

- 先查任务详情
- 再用 `snapshotId` 查快照详情

## 8. 任务 4 与现有任务模型的关系

虽然 `TaskRecord` 中保留了 `snapshotId?: string` 字段，但这里明确：

- 它不是快照关联的底层真相来源
- 真相来源是 `snapshot_task_links`
- `TaskRecord.snapshotId` 更适合作为查询结果中的辅助字段或上下文回显字段

## 9. 后端文件映射建议

本任务文档对应的后端实现文件职责建议如下：

- `snapshot.entity.ts`
  对应 `snapshots`
- `snapshot-task-link.entity.ts`
  对应 `snapshot_task_links`
- `snapshot.service.ts`
  负责创建快照、加载快照详情、组装关联任务
- `snapshot.controller.ts`
  暴露保存与查询接口
- `create-snapshot.dto.ts`
  校验 `workflowId`、`canvasState`、`relatedTaskIds`
- `snapshot-detail.dto.ts`
  返回 `WorkflowSnapshotDetail`
