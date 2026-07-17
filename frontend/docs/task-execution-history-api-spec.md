# 任务执行、历史与快照接口联调规范

更新时间：2026-04-03

## 1. 目标

本文是 `newworkflow2` 当前前后端联调的唯一正式文档，用于统一以下能力：

- 节点执行前的任务批量创建
- 任务状态更新
- 任务结果回传
- 节点产物文件来源写回
- 任务历史查询与详情展示
- 画布快照与任务关联存储
- 文件节点属性窗口展示

本文绑定当前前端实现，字段命名、枚举值、请求结构均以当前前端类型系统为准。

绑定代码位置：

- `frontend/src/types/task.types.ts`
- `frontend/src/types/snapshot.types.ts`
- `frontend/src/types/file.types.ts`
- `frontend/src/api/services/task-api.ts`
- `frontend/src/api/services/snapshot-api.ts`
- `frontend/src/utils/workflow/task-batch.ts`
- `frontend/src/utils/workflow/snapshot-links.ts`
- `frontend/src/nodes/shared/task-result-normalizer.ts`
- `frontend/src/components/history/TaskHistoryList.tsx`
- `frontend/src/components/history/TaskHistoryDetail.tsx`
- `frontend/src/components/node/file/file-node-property-sections.ts`

## 2. 统一规则

### 2.1 任务编号规则

- `taskId`
  语义：任务主键，后端内部唯一标识
  生成方：后端
  建议格式：UUID / 雪花 ID / 等价全局唯一字符串
- `taskNo`
  语义：用户可见任务编号，用于历史页、属性窗口、人工排查
  生成方：后端
  格式：`TASK-YYYYMMDD-000001`
  示例：`TASK-20260403-000001`
- `batchId`
  语义：同一次前端批量创建请求的归组编号
  生成方：后端优先；前端可预传，后端可接受或重写
  注意：`batchId` 只能用于归组，不能代替单任务记录

### 2.2 时间字段语义

必须保留三个任务时间字段：

- `createdAt`
  语义：任务记录创建时间
- `startedAt`
  语义：任务开始实际执行时间
- `completedAt`
  语义：任务进入终态时间，适用于 `completed` / `failed` / `cancelled`

统一要求：

- 时间字段全部使用毫秒级 Unix 时间戳
- 后端返回值必须为数字
- `createdAt` 必填
- `startedAt`、`completedAt` 可为空
- 一旦进入终态，`completedAt` 必须写入

### 2.3 任务状态枚举

`TaskStatus`：

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

状态流转规则：

- 初始状态只能是 `queued`
- `queued -> processing`
- `processing -> completed | failed | cancelled`
- 原则上不允许终态再回退

### 2.4 任务作用域枚举

`TaskScope`：

- `node`
  语义：一个节点整体执行对应一个任务
- `group`
  语义：一个节点的单个输入组执行对应一个任务

并发规则：

- 一个节点并发 10 个实际任务，就必须有 10 条 `TaskRecord`
- grouped 节点下，每个输入组对应一条独立任务记录

### 2.5 文件来源规则

`FileSource.type` 仅允许两类：

- `imported`
  语义：本地导入文件
- `node-output`
  语义：节点执行生成的产物文件

补充规则：

- 当前阶段 `imported` 仅表示本地导入
- `imported.importMethod` 当前固定为 `local`
- 节点产物必须补齐生成节点和任务来源信息

## 3. 统一数据模型

### 3.1 TaskNodeRef

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `nodeId` | `string` | 是 | 节点内部 ID |
| `nodeDisplayId` | `string` | 是 | 节点展示编号，如 `#00002` |
| `nodeType` | `string` | 是 | 节点类型 |
| `nodeTitle` | `string` | 否 | 节点标题，前端优先显示该值 |

### 3.2 TaskFileRef

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileId` | `string` | 是 | 文件 ID |
| `fileName` | `string` | 否 | 文件名称 |
| `mimeType` | `string` | 否 | 文件 MIME |

### 3.3 TaskRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | `string` | 是 | 任务主键 |
| `taskNo` | `TASK-*` | 是 | 用户可见任务编号 |
| `batchId` | `string` | 否 | 批次编号 |
| `projectId` | `string` | 否 | 项目 ID |
| `workflowId` | `string` | 否 | 工作流 ID |
| `snapshotId` | `string` | 否 | 关联快照 ID |
| `node` | `TaskNodeRef` | 是 | 节点来源 |
| `scope` | `node \| group` | 是 | 任务作用域 |
| `groupId` | `string` | 否 | 输入组 ID |
| `groupLabel` | `string` | 否 | 输入组名称 |
| `groupOrder` | `number` | 否 | 输入组顺序 |
| `status` | `TaskStatus` | 是 | 任务状态 |
| `createdAt` | `number` | 是 | 创建时间 |
| `startedAt` | `number` | 否 | 开始时间 |
| `completedAt` | `number` | 否 | 终态时间 |
| `inputSummary` | `object` | 否 | 输入概要 |
| `outputSummary` | `object` | 否 | 输出概要 |
| `inputFiles` | `TaskFileRef[]` | 否 | 输入文件清单 |
| `outputFiles` | `TaskFileRef[]` | 否 | 输出文件清单 |
| `errorInfo` | `{ code, message }` | 否 | 错误信息 |

### 3.4 UpdateTaskStatusRequest

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | `TaskStatus` | 是 | 目标状态 |
| `startedAt` | `number` | 否 | 进入执行时间 |
| `completedAt` | `number` | 否 | 进入终态时间 |
| `errorInfo` | `{ code, message }` | 否 | 错误信息 |

### 3.5 NodeTaskResultPayload

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | `string` | 是 | 任务 ID |
| `taskNo` | `TASK-*` | 是 | 任务编号 |
| `batchId` | `string` | 否 | 批次编号 |
| `node` | `TaskNodeRef` | 是 | 节点来源 |
| `scope` | `node \| group` | 是 | 任务作用域 |
| `groupId` | `string` | 否 | 输入组 ID |
| `groupLabel` | `string` | 否 | 输入组名称 |
| `groupOrder` | `number` | 否 | 输入组顺序 |
| `status` | `TaskStatus` | 是 | 回传结果状态 |
| `createdAt` | `number` | 是 | 创建时间 |
| `startedAt` | `number` | 否 | 开始时间 |
| `completedAt` | `number` | 否 | 完成时间 |
| `inputs` | `object` | 否 | 输入详情 |
| `outputs.files` | `FileInfo[]` | 否 | 产物文件完整信息 |
| `outputs.data` | `object` | 否 | 结构化输出数据 |
| `outputs.text` | `string` | 否 | 文本输出 |
| `errorInfo` | `{ code, message }` | 否 | 错误信息 |

说明：

- 当前前端已经把 `outputs.files` 设计为 `FileInfo[]`
- 后端不需要再额外定义 `fileInfos` 字段
- 节点产物文件必须在后端落库后，再按完整 `FileInfo[]` 回传

### 3.6 FileSource

#### imported

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `'imported'` | 是 | 来源类型 |
| `importMethod` | `'local'` | 否 | 导入方式 |
| `originalPath` | `string` | 否 | 本地原始路径 |
| `importedAt` | `number` | 否 | 导入时间 |
| `uploadedBy` | `string` | 否 | 上传人 |

#### node-output

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `'node-output'` | 是 | 来源类型 |
| `producerNodeId` | `string` | 是 | 生成节点 ID |
| `producerNodeDisplayId` | `string` | 是 | 生成节点编号 |
| `producerNodeType` | `string` | 是 | 生成节点类型 |
| `taskId` | `string` | 是 | 生成任务 ID |
| `taskNo` | `string` | 是 | 生成任务编号 |
| `taskCreatedAt` | `number` | 是 | 任务创建时间 |
| `taskStartedAt` | `number` | 否 | 任务开始时间 |
| `taskCompletedAt` | `number` | 否 | 任务完成时间 |

### 3.7 WorkflowSnapshotTaskRef

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | `string` | 是 | 任务 ID |
| `taskNo` | `TASK-*` | 是 | 任务编号 |
| `batchId` | `string` | 否 | 批次编号 |
| `nodeId` | `string` | 是 | 节点 ID |
| `nodeDisplayId` | `string` | 是 | 节点编号 |
| `nodeType` | `string` | 是 | 节点类型 |

### 3.8 WorkflowSnapshot

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `snapshotId` | `string` | 是 | 快照 ID |
| `workflowId` | `string` | 是 | 工作流 ID |
| `projectId` | `string` | 否 | 项目 ID |
| `savedAt` | `number` | 是 | 保存时间 |
| `canvasState` | `object` | 是 | 当时画布完整状态 |
| `relatedTasks` | `WorkflowSnapshotTaskRef[]` | 是 | 关联任务引用 |

### 3.9 WorkflowSnapshotDetail

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `snapshot` | `WorkflowSnapshot` | 是 | 快照信息 |
| `tasks` | `TaskRecord[]` | 是 | 关联任务详情列表 |

## 4. 统一响应包装

HTTP 返回统一使用：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": 1770000000000
}
```

约束：

- 成功时 `code` 允许为 `0` 或 `200`
- 失败时必须返回非成功码，并带 `message`
- `timestamp` 为服务端毫秒时间戳

## 5. 接口定义

### 5.1 批量创建任务

`POST /api/v1/tasks/batch`

用途：

- 节点执行前由前端一次性申请真实任务记录
- 支持单节点单任务
- 支持 grouped 节点一次创建多条任务记录

请求体：

```json
{
  "projectId": "project-1",
  "workflowId": "workflow-1",
  "batchId": "batch-client-optional",
  "items": [
    {
      "scope": "group",
      "groupId": "group-1",
      "groupLabel": "Group 1",
      "groupOrder": 0,
      "node": {
        "nodeId": "2",
        "nodeDisplayId": "#00002",
        "nodeType": "aiImageGen",
        "nodeTitle": "客厅生图"
      },
      "inputSummary": {
        "groupId": "group-1",
        "groupLabel": "Group 1",
        "groupOrder": 0,
        "inputFileCount": 2,
        "inputNodeIds": ["11", "12"],
        "inputFileIds": ["file-11", "file-12"]
      },
      "inputFiles": [
        {
          "fileId": "file-11",
          "fileName": "input-1.png",
          "mimeType": "image/png"
        },
        {
          "fileId": "file-12",
          "fileName": "input-2.png",
          "mimeType": "image/png"
        }
      ]
    }
  ]
}
```

响应体：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "batchId": "batch-20260403-000001",
    "tasks": [
      {
        "taskId": "task-1",
        "taskNo": "TASK-20260403-000001",
        "batchId": "batch-20260403-000001",
        "projectId": "project-1",
        "workflowId": "workflow-1",
        "node": {
          "nodeId": "2",
          "nodeDisplayId": "#00002",
          "nodeType": "aiImageGen",
          "nodeTitle": "客厅生图"
        },
        "scope": "group",
        "groupId": "group-1",
        "groupLabel": "Group 1",
        "groupOrder": 0,
        "status": "queued",
        "createdAt": 1770000000000,
        "inputSummary": {
          "groupId": "group-1",
          "groupLabel": "Group 1",
          "groupOrder": 0,
          "inputFileCount": 2,
          "inputNodeIds": ["11", "12"],
          "inputFileIds": ["file-11", "file-12"]
        },
        "inputFiles": [
          {
            "fileId": "file-11",
            "fileName": "input-1.png",
            "mimeType": "image/png"
          },
          {
            "fileId": "file-12",
            "fileName": "input-2.png",
            "mimeType": "image/png"
          }
        ]
      }
    ]
  },
  "timestamp": 1770000000000
}
```

后端实现要求：

- 一个 `items[]` 元素必须生成一条独立任务记录
- 返回顺序必须与请求 `items[]` 顺序一致
- `taskNo` 只能由后端生成

### 5.2 更新任务状态

`PUT /api/v1/tasks/:taskId/status`

用途：

- 任务进入 `processing`
- 任务失败
- 任务取消
- 终态补全时间字段

请求体示例：开始执行

```json
{
  "status": "processing",
  "startedAt": 1770000001200
}
```

请求体示例：失败

```json
{
  "status": "failed",
  "completedAt": 1770000005600,
  "errorInfo": {
    "code": "PROVIDER_TIMEOUT",
    "message": "provider timeout"
  }
}
```

响应体：

- 返回更新后的完整 `TaskRecord`

后端实现要求：

- `processing` 时建议写入 `startedAt`
- 进入终态时必须写入 `completedAt`
- `failed`、`cancelled` 必须保留原任务上下文

### 5.3 回传任务结果

`POST /api/v1/tasks/:taskId/result`

用途：

- 回传输入详情
- 回传输出详情
- 回传产物文件
- 让节点产物文件带完整来源元数据

请求体示例：

```json
{
  "taskId": "task-1",
  "taskNo": "TASK-20260403-000001",
  "batchId": "batch-20260403-000001",
  "node": {
    "nodeId": "2",
    "nodeDisplayId": "#00002",
    "nodeType": "aiImageGen",
    "nodeTitle": "客厅生图"
  },
  "scope": "group",
  "groupId": "group-1",
  "groupLabel": "Group 1",
  "groupOrder": 0,
  "status": "completed",
  "createdAt": 1770000000000,
  "startedAt": 1770000001200,
  "completedAt": 1770000005200,
  "inputs": {
    "prompt": "modern living room",
    "inputFileIds": ["file-11", "file-12"]
  },
  "outputs": {
    "files": [
      {
        "id": "file-output-1",
        "name": "result-1.png",
        "originalName": "result-1.png",
        "size": 1024000,
        "mimeType": "image/png",
        "format": "png",
        "fileType": "image",
        "status": "ready",
        "hash": "hash-1",
        "path": "/objects/project-1/file-output-1/original",
        "thumbnailPath": "/objects/project-1/file-output-1/thumbnail",
        "metadata": {
          "width": 1024,
          "height": 1024
        },
        "source": {
          "type": "node-output",
          "producerNodeId": "2",
          "producerNodeDisplayId": "#00002",
          "producerNodeType": "aiImageGen",
          "taskId": "task-1",
          "taskNo": "TASK-20260403-000001",
          "taskCreatedAt": 1770000000000,
          "taskStartedAt": 1770000001200,
          "taskCompletedAt": 1770000005200
        },
        "timestamp": {
          "created": 1770000005200,
          "updated": 1770000005200
        }
      }
    ],
    "data": {
      "providerJobId": "job-123",
      "seed": 1001
    },
    "text": "completed"
  }
}
```

响应体：

- 返回最终完整 `TaskRecord`

后端实现要求：

- `outputs.files[]` 中每个文件都必须是完整 `FileInfo`
- `outputs.files[].source` 必须补齐为 `node-output`
- 同步回写 `TaskRecord.outputSummary`
- 同步回写 `TaskRecord.outputFiles`
- 如果 `status=completed`，必须保证任务记录进入终态

### 5.4 查询任务列表

`GET /api/v1/tasks`

用途：

- 任务历史页面列表查询
- 多条件筛选
- 快照反查任务

支持查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `taskId` | `string` | 按任务 ID |
| `taskNo` | `string` | 按任务编号 |
| `batchId` | `string` | 按批次 |
| `snapshotId` | `string` | 按快照 |
| `nodeId` | `string` | 按节点 ID |
| `nodeDisplayId` | `string` | 按节点编号 |
| `nodeType` | `string` | 按节点类型 |
| `status` | `string` | 按状态 |
| `createdFrom` | `number` | 创建时间起 |
| `createdTo` | `number` | 创建时间止 |
| `startedFrom` | `number` | 开始时间起 |
| `startedTo` | `number` | 开始时间止 |
| `completedFrom` | `number` | 完成时间起 |
| `completedTo` | `number` | 完成时间止 |
| `page` | `number` | 页码 |
| `pageSize` | `number` | 每页条数 |

请求示例：

```text
GET /api/v1/tasks?taskNo=TASK-20260403-000001&status=completed&nodeDisplayId=%2300002&page=1&pageSize=100
```

响应体：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "taskId": "task-1",
        "taskNo": "TASK-20260403-000001",
        "batchId": "batch-20260403-000001",
        "snapshotId": "snapshot-1",
        "node": {
          "nodeId": "2",
          "nodeDisplayId": "#00002",
          "nodeType": "aiImageGen",
          "nodeTitle": "客厅生图"
        },
        "scope": "group",
        "groupId": "group-1",
        "groupLabel": "Group 1",
        "groupOrder": 0,
        "status": "completed",
        "createdAt": 1770000000000,
        "startedAt": 1770000001200,
        "completedAt": 1770000005200,
        "inputSummary": {
          "inputFileCount": 2
        },
        "outputSummary": {
          "outputFileCount": 1
        },
        "inputFiles": [
          {
            "fileId": "file-11",
            "fileName": "input-1.png",
            "mimeType": "image/png"
          }
        ],
        "outputFiles": [
          {
            "fileId": "file-output-1",
            "fileName": "result-1.png",
            "mimeType": "image/png"
          }
        ]
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 100,
    "hasMore": false,
    "totalPages": 1
  },
  "timestamp": 1770000008000
}
```

### 5.5 查询任务详情

`GET /api/v1/tasks/:taskId`

用途：

- 任务历史详情
- 单任务排查
- 文件节点来源追踪

响应体：

- 返回完整 `TaskRecord`
- 必须包含：
  - `taskNo`
  - `node`
  - `status`
  - `createdAt`
  - `startedAt`
  - `completedAt`
  - `inputSummary`
  - `outputSummary`
  - `inputFiles`
  - `outputFiles`
  - `errorInfo`
  - `snapshotId`

### 5.6 创建画布快照

`POST /api/v1/workflow-snapshots`

用途：

- 保存当前画布状态
- 绑定当前相关任务

请求体：

```json
{
  "workflowId": "workflow-1",
  "projectId": "project-1",
  "canvasState": {
    "id": "workflow-1",
    "projectId": "project-1",
    "name": "Workflow A",
    "nodes": {},
    "connections": [],
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    },
    "metadata": {
      "nodeCount": 0,
      "connectionCount": 0,
      "lastNodeId": 0,
      "canvasSize": {
        "width": 20000,
        "height": 20000
      },
      "relatedTasks": [
        {
          "taskId": "task-1",
          "taskNo": "TASK-20260403-000001",
          "batchId": "batch-20260403-000001",
          "nodeId": "2",
          "nodeDisplayId": "#00002",
          "nodeType": "aiImageGen"
        }
      ]
    },
    "timestamp": {
      "created": 1770000000000,
      "updated": 1770000006000
    }
  },
  "relatedTaskIds": ["task-1"]
}
```

响应体：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "snapshot": {
      "snapshotId": "snapshot-1",
      "workflowId": "workflow-1",
      "projectId": "project-1",
      "savedAt": 1770000009000,
      "canvasState": {
        "id": "workflow-1",
        "projectId": "project-1",
        "name": "Workflow A"
      },
      "relatedTasks": [
        {
          "taskId": "task-1",
          "taskNo": "TASK-20260403-000001",
          "batchId": "batch-20260403-000001",
          "nodeId": "2",
          "nodeDisplayId": "#00002",
          "nodeType": "aiImageGen"
        }
      ]
    },
    "tasks": [
      {
        "taskId": "task-1",
        "taskNo": "TASK-20260403-000001",
        "batchId": "batch-20260403-000001",
        "node": {
          "nodeId": "2",
          "nodeDisplayId": "#00002",
          "nodeType": "aiImageGen",
          "nodeTitle": "客厅生图"
        },
        "scope": "group",
        "groupId": "group-1",
        "groupLabel": "Group 1",
        "groupOrder": 0,
        "status": "completed",
        "createdAt": 1770000000000,
        "startedAt": 1770000001200,
        "completedAt": 1770000005200
      }
    ]
  },
  "timestamp": 1770000009000
}
```

后端实现要求：

- `relatedTaskIds` 允许为空数组
- 返回 `snapshot.relatedTasks` 时必须去重
- 返回的 `tasks[]` 必须与 `relatedTaskIds` 对应

### 5.7 查询快照详情

`GET /api/v1/workflow-snapshots/:snapshotId`

用途：

- 加载画布快照
- 同时恢复任务上下文
- 历史详情页展示关联快照

响应体：

- 返回 `WorkflowSnapshotDetail`
- `snapshot.canvasState` 必须是可直接恢复的画布状态
- `tasks[]` 必须是该快照关联任务的完整详情

## 6. 前端页面字段展示规范

### 6.1 文件节点属性窗口

触发方式：

- 右键文件节点本体
- 菜单点击“属性”
- 打开只读小窗口

#### 基础信息区

必须展示：

- 节点编号
- 文件名称
- 文件类型
- 文件大小
- MIME 类型
- 文件来源
- 创建时间
- 更新时间
- 媒体尺寸
- 时长（仅有时长的媒体）

#### 导入文件的来源信息区

当 `source.type = imported` 时，展示：

- 来源类型：导入
- 导入方式：本地导入
- 导入时间
- 原始路径

#### 节点产物的来源信息区

当 `source.type = node-output` 时，展示：

- 来源类型：节点产物
- 生成节点编号
- 生成节点 ID
- 生成节点类型

#### 节点产物的生成信息区

当 `source.type = node-output` 时，展示：

- 任务编号
- 任务 ID
- 任务创建时间
- 任务开始时间
- 任务完成时间

### 6.2 任务历史页列表

列表最小单位：任务

必须展示：

- 任务编号
- 节点来源
  - 优先显示 `node.nodeTitle`
  - 次级显示 `node.nodeDisplayId | node.nodeType`
- 状态
- 创建时间
- 开始时间
- 完成时间

并发规则：

- 节点并发创建多少真实任务，历史页就展示多少条记录

### 6.3 任务历史详情

详情必须展示：

- 任务编号
- 任务 ID
- 节点来源
- 节点标题
- 批次编号
- 快照编号
- 创建时间
- 开始时间
- 完成时间
- 输入详情
- 输出详情
- 输入文件
- 产出文件
- 错误信息
- 关联快照保存时间
- 关联任务数

## 7. 完整时序

### 7.1 单节点或 grouped 节点执行总时序

1. 前端根据节点输入构造 `CreateTaskBatchRequest.items[]`
2. 前端调用 `POST /api/v1/tasks/batch`
3. 后端生成 `taskId`、`taskNo`、`batchId`，返回 `tasks[]`
4. 前端把返回任务记录注入节点运行上下文
5. 节点开始执行前，前端或执行器调用 `PUT /api/v1/tasks/:taskId/status`，写入 `processing` 和 `startedAt`
6. 后端执行真实任务，产生产物文件
7. 后端写入文件记录，并将节点产物文件的 `source` 填充为 `node-output`
8. 执行完成后，前端或执行器调用 `POST /api/v1/tasks/:taskId/result`
9. 后端将结果写回任务记录：
   - `status`
   - `completedAt`
   - `inputSummary`
   - `outputSummary`
   - `inputFiles`
   - `outputFiles`
   - `errorInfo`
10. 前端把 `TaskRecord` 和 `FileInfo[]` 写回节点输出
11. 前端保存画布时调用 `POST /api/v1/workflow-snapshots`
12. 后端保存 `canvasState + relatedTaskIds`
13. 历史页调用 `GET /api/v1/tasks`
14. 历史详情调用 `GET /api/v1/tasks/:taskId`
15. 若详情含 `snapshotId`，前端调用 `GET /api/v1/workflow-snapshots/:snapshotId`

### 7.2 grouped 并发场景示例

场景：

- 一个节点拆成 10 个输入组

要求：

- `POST /api/v1/tasks/batch` 返回 10 条 `TaskRecord`
- 每条记录拥有独立 `taskId`、`taskNo`
- 若共享同一次触发，可共用一个 `batchId`
- 历史页展示 10 条
- 快照可关联这 10 个任务

## 8. 后端实现约束

后端实现时必须遵守：

- 不允许前端生成 `taskNo`
- 不允许把多个实际任务压缩为一条历史记录
- 不允许节点产物文件缺少 `producerNodeDisplayId`
- 不允许节点产物文件缺少 `taskNo`
- 不允许 `createdAt` / `startedAt` / `completedAt` 混用为单一时间字段
- 不允许只保存任务状态，不保存输入/输出概要
- 不允许快照只保存 `relatedTaskIds` 而不提供可展示的 `relatedTasks`

## 9. 建议数据库落点

建议最少具备：

- `tasks`
  - 主记录
- `task_results` 或 `tasks` JSON 字段
  - 输入/输出详情
- `workflow_snapshots`
  - 快照主表
- `workflow_snapshot_task_links`
  - 快照与任务关联表
- `files`
  - 文件主表，`source` 使用结构化 JSON 或展开字段

## 10. 联调验收标准

- 后端可按本文直接实现接口，无需再次确认核心字段
- 前端不再自行生成任务编号
- 任一节点并发多少实际任务，后端就返回多少真实任务记录
- 节点产物文件可在文件节点属性窗口中完整展示来源和生成信息
- 历史页能按任务编号、节点编号、状态、时间范围、批次、快照查询
- 保存快照后，可通过 `snapshotId` 恢复画布和关联任务上下文
