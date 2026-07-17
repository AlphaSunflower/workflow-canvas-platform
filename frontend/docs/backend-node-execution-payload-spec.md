# 后端节点执行回传规范

## 1. 目标

本文用于为 `newworkflow2/frontend` 的后端执行链路铺路，统一以下问题：

- 前端如何创建真实 AI 执行任务
- 后端如何回传任务状态、进度、产物与错误
- 前端如何把真实任务结果写回工作流
- 单任务节点与分组任务节点如何共用一套协议

本规范直接绑定当前前端实现，不另起一套抽象。

绑定代码位置：

- `src/components/context/WorkflowContext.tsx`
- `src/components/context/workflow-context.types.ts`
- `src/nodes/types.ts`
- `src/nodes/shared/runtime.ts`
- `src/types/ai.types.ts`
- `src/types/api.types.ts`

## 2. 当前前端真实执行模型

当前前端存在三类执行模式：

- `mock`
- `legacy-single-task`
- `legacy-grouped-task`

其中真正需要后端承接的是后两类：

- `legacy-single-task`
  语义：一个节点发起一个任务，任务完成后统一写回输出
- `legacy-grouped-task`
  语义：一个节点按输入组拆成多个任务并发执行，每个任务完成后按组写回输出

当前前端执行入口在 `WorkflowContext.runAINode(...)`。

当前前端输出回写入口在：

- `appendResolvedTaskOutputs(...)`
- `createRuntimeOutputSnapshot(...)`

也就是说，后端不需要直接操作工作流节点图，只需要稳定回传任务与产物数据，前端会把结果转成：

- 新文件节点
- `output-link` 连接
- 源 AI 节点 `outputs` 更新

## 3. 节点与任务映射

当前节点执行模式如下：

| 节点 type | taskType | mode | 回传粒度 |
| --- | --- | --- | --- |
| `aiImageGen` | `image-gen` | `legacy-grouped-task` | 每组一个任务 |
| `aiMultiViewRestore` | `multi-view-restore` | `legacy-grouped-task` | 每组一个任务 |
| `aiModelRenderTransfer` | `model-render-transfer` | `legacy-grouped-task` | 每组一个任务 |
| `aiImageToPly` | `image-to-ply` | `mock` | 后续建议升级为 grouped-task |
| `aiImageHd` | `image-hd` | `mock` | 后续建议升级为 grouped-task |
| `aiFloorplanColorize` | `floorplan-colorize` | `mock` | 后续建议升级为 grouped-task |
| `aiVideoGen` | `video-gen` | `mock` | 后续建议升级为 single-task |

后端第一阶段至少要无缝支持：

- `legacy-single-task`
- `legacy-grouped-task`

## 4. 创建任务请求规范

前端通过 `POST /api/v1/tasks` 创建任务。

请求体类型以 `CreateAITaskRequest` 为准，关键字段如下：

```ts
interface CreateAITaskRequest {
  type: AITaskType;
  provider?: AIProvider;
  model?: AIModelType;
  nodeId: string;
  projectId: UUID;
  input: {
    files: UUID[];
    references: UUID[];
    config: AIConfig;
    prompt?: string;
    negativePrompt?: string;
    fileBindings?: AITaskInputFileBinding[];
    execution?: AITaskExecutionContext;
  };
  priority?: 'high' | 'normal' | 'low';
  userId?: UUID;
  retryCount?: number;
  maxRetries?: number;
  timeout?: number;
  idempotencyKey?: string;
}
```

### 4.1 `input.execution`

后端必须保留并原样带回 `input.execution` 语义，至少用于：

- 确认当前任务是整节点任务还是分组任务
- 在分组任务完成时定位 `groupId`
- 在输出回传时保留 `outputHandle`
- 做幂等、防重、审计与问题追踪

推荐结构：

```ts
interface AITaskExecutionContext {
  scope: 'node' | 'group';
  workflowId?: string;
  workflowVersion?: number;
  nodeType?: AINodeData['type'];
  groupId?: string;
  groupLabel?: string;
  groupOrder?: number;
  outputHandle?: string;
  idempotencyKey?: string;
}
```

### 4.2 `input.fileBindings`

后端不要只依赖 `files` 和 `references` 两个扁平数组，真实执行建议读取 `fileBindings`：

```ts
interface AITaskInputFileBinding {
  fileId: string;
  nodeId?: string;
  handle?: string;
  groupId?: string;
  portId?: string;
  order?: number;
  role?: 'input' | 'reference';
}
```

用途：

- 还原端口语义
- 还原同组输入顺序
- 区分主输入和参考输入
- 便于后端日志和调试

## 5. 创建任务响应规范

创建成功后，后端返回一个完整 `AITask`。

最小必需字段：

```ts
{
  id: string,
  type: 'image-gen' | 'video-gen' | ...,
  provider: 'stability' | 'runway' | ...,
  status: 'queued',
  nodeId: string,
  projectId: string,
  input: { ... },
  progress: 0,
  timestamp: {
    created: number,
    updated: number
  }
}
```

要求：

- `status` 初始值必须明确，推荐 `queued`
- `progress` 初始值必须存在，推荐 `0`
- `input.execution` 必须原样回显
- 分组任务不能丢失 `groupId` / `outputHandle`

## 6. WebSocket 回传规范

前端当前通过 WebSocket 订阅 `ai-stream`，并使用：

- `subscribe-task`
- `unsubscribe-task`

建议后端遵循如下语义：

### 6.1 客户端发送

```json
{
  "type": "subscribe-task",
  "payload": {
    "taskId": "task_xxx"
  },
  "timestamp": 1710000000000
}
```

```json
{
  "type": "unsubscribe-task",
  "payload": {
    "taskId": "task_xxx"
  },
  "timestamp": 1710000000000
}
```

### 6.2 服务端推送

统一使用：

- `type: "ai-stream"`

`payload` 结构以 `AIStreamChunk` 为准。

推荐结构：

```ts
interface AIStreamChunk {
  taskId: string;
  type: 'status' | 'progress' | 'file' | 'metadata' | 'error' | 'done' | 'text';
  content: string | number | Record<string, unknown>;
  timestamp: number;
  index?: number;
  nodeId?: string;
  projectId?: string;
  groupId?: string;
  sourceHandle?: string;
  status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  fileInfo?: FileInfo;
  output?: AITaskOutput;
  metadata?: Record<string, unknown>;
}
```

### 6.3 事件顺序要求

推荐顺序：

1. `status(queued)` 可选
2. `status(processing)` 或第一条 `progress`
3. 若干 `progress`
4. 若干 `file` / `metadata`
5. `done` 或 `error`

要求：

- `index` 单调递增
- `timestamp` 使用服务端时间
- `done` 后不得继续推送新进度
- `error` 后不得继续推送产物

### 6.4 状态语义

前端当前会通过 `chunk.type` 推断状态，因此后端建议同时给出 `status` 字段，避免歧义。

规则：

- `status: queued`
  任务已落库，尚未执行
- `status: processing`
  执行中
- `status: completed`
  已完成，必须已具备最终输出或可查询最终输出
- `status: failed`
  执行失败
- `status: cancelled`
  已取消

## 7. 任务完成结果规范

前端在两处消费最终结果：

- WebSocket `done`
- `GET /api/v1/tasks/:id`

由于前端在任务终态后会主动再调一次 `getTask(...)`，因此后端必须保证：

- `GET /api/v1/tasks/:id` 在终态时返回最终完整 `AITask`
- `task.output` 结构稳定可用

推荐输出结构：

```ts
interface AITaskOutput {
  files: string[];
  fileInfos?: FileInfo[];
  items?: AITaskOutputItem[];
  metadata: Record<string, unknown>;
  usage?: AIUsage;
}

interface AITaskOutputItem {
  fileId: string;
  fileInfo?: FileInfo;
  sourceHandle?: string;
  groupId?: string;
  order?: number;
  metadata?: Record<string, unknown>;
}
```

### 7.1 后端必须保证的字段

完成任务时推荐至少返回：

- `output.files`
- `output.items`
- `output.metadata`

最佳实践是同时返回：

- `output.fileInfos`
- `output.items[].fileInfo`

理由：

- 前端可以直接创建文件节点
- 不必额外逐个请求 `GET /api/v1/files/:id`
- 可避免“任务完成但文件详情尚未可查”的短暂不一致

### 7.2 `items` 优先级

后端若返回 `items`，前端应按以下顺序消费：

1. `items[].fileInfo`
2. `fileInfos`
3. `files` 后再查文件详情

后端实现上应尽量满足第 1 种。

### 7.3 `sourceHandle` 规则

单任务节点：

- 可为空
- 若有多路输出，必须明确

分组任务节点：

- 必须返回
- 必须等于请求侧 `input.execution.outputHandle` 或与其语义等价

否则前端无法把输出稳定回写到正确的组输出口。

## 8. 分组任务规范

### 8.1 基本原则

对于 `legacy-grouped-task`，后端视角应为：

- 一个前端节点
- 多个独立任务
- 每个任务只对应一个输入组

因此后端任务记录必须保留：

- `nodeId`
- `input.execution.groupId`
- `input.execution.groupOrder`
- `input.execution.outputHandle`

### 8.2 返回要求

分组任务完成时：

- `task.output.items[].groupId` 推荐回传
- `task.output.items[].sourceHandle` 必须可用于前端回写
- `task.output.items[].order` 必须为组内稳定顺序

前端当前在 grouped 节点完成后会按：

- 组顺序 `groupOrder * 1000`
- 再叠加组内输出顺序

来生成最终工作流输出顺序。

所以后端只需要保证同组内 `order` 稳定，不需要参与全局排序。

## 9. 文件信息规范

当前前端创建输出文件节点依赖 `FileInfo`。

后端返回的 `FileInfo` 至少要满足：

- `id`
- `name`
- `originalName`
- `size`
- `mimeType`
- `format`
- `fileType`
- `status`
- `path`
- `metadata`
- `source`
- `timestamp`

对于图片，建议补齐：

- `metadata.width`
- `metadata.height`

对于视频，建议补齐：

- `metadata.width`
- `metadata.height`
- `metadata.duration`

对于 PLY，至少保证：

- `fileType = model3d`
- `format = ply`

## 10. 错误与取消规范

### 10.1 失败任务

失败时，后端必须返回：

```ts
error: {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

同时要求：

- WebSocket 推送 `error` 或 `status=failed`
- `GET /api/v1/tasks/:id` 返回 `status=failed`
- 失败任务不得带有伪造输出

### 10.2 取消任务

前端通过：

- `DELETE /api/v1/tasks/:id`

发起取消。

后端要求：

- 接口成功返回只表示“已接受取消请求”或“已取消”
- 若任务最终进入 `cancelled`，必须体现在：
  - WebSocket
  - `GET /api/v1/tasks/:id`

## 11. 幂等与重复提交

前端已为真实任务创建预留 `idempotencyKey`。

后端要求：

- 对同一个 `idempotencyKey`，重复请求不得重复生成独立任务和重复产物
- 若请求内容一致，返回原任务或语义等价任务
- 若请求内容不一致，返回冲突错误

推荐幂等粒度：

- 单任务：`workflowId:nodeId:workflowUpdatedAt`
- 分组任务：`workflowId:nodeId:groupId:workflowUpdatedAt`

## 12. REST 接口建议

最低可用接口：

- `POST /api/v1/tasks`
- `GET /api/v1/tasks/:id`
- `DELETE /api/v1/tasks/:id`

建议响应：

### 12.1 `POST /api/v1/tasks`

- 返回创建后的 `AITask`

### 12.2 `GET /api/v1/tasks/:id`

- 非终态返回当前 `AITask`
- 终态返回包含最终 `output` 的完整 `AITask`

### 12.3 `DELETE /api/v1/tasks/:id`

- 返回 `Result<void>` 即可

## 13. 推荐回传示例

### 13.1 创建 grouped 任务

```json
{
  "type": "image-gen",
  "provider": "stability",
  "model": "stable-diffusion-xl",
  "nodeId": "17",
  "projectId": "proj_001",
  "idempotencyKey": "wf_001:17:group-3:1710000000000",
  "input": {
    "files": ["file_a", "file_b"],
    "references": ["file_a", "file_b"],
    "config": {
      "prompt": "modern living room",
      "inputGroups": [
        { "id": "group-3", "label": "Group 3", "order": 2 }
      ]
    },
    "prompt": "modern living room",
    "fileBindings": [
      {
        "fileId": "file_a",
        "groupId": "group-3",
        "portId": "images",
        "handle": "group-3:images",
        "order": 0,
        "role": "input"
      },
      {
        "fileId": "file_b",
        "groupId": "group-3",
        "portId": "images",
        "handle": "group-3:images",
        "order": 1,
        "role": "input"
      }
    ],
    "execution": {
      "scope": "group",
      "workflowId": "wf_001",
      "workflowVersion": 12,
      "nodeType": "aiImageGen",
      "groupId": "group-3",
      "groupLabel": "Group 3",
      "groupOrder": 2,
      "outputHandle": "group-3:result",
      "idempotencyKey": "wf_001:17:group-3:1710000000000"
    }
  }
}
```

### 13.2 进度事件

```json
{
  "type": "ai-stream",
  "payload": {
    "taskId": "task_123",
    "nodeId": "17",
    "projectId": "proj_001",
    "groupId": "group-3",
    "type": "progress",
    "status": "processing",
    "progress": 56,
    "content": 56,
    "timestamp": 1710000005000,
    "index": 4,
    "sourceHandle": "group-3:result",
    "metadata": {
      "stage": "sampling"
    }
  },
  "timestamp": 1710000005000
}
```

### 13.3 完成事件

```json
{
  "type": "ai-stream",
  "payload": {
    "taskId": "task_123",
    "nodeId": "17",
    "groupId": "group-3",
    "type": "done",
    "status": "completed",
    "content": {
      "message": "completed"
    },
    "timestamp": 1710000010000,
    "index": 8,
    "sourceHandle": "group-3:result",
    "output": {
      "files": ["file_out_1"],
      "items": [
        {
          "fileId": "file_out_1",
          "sourceHandle": "group-3:result",
          "groupId": "group-3",
          "order": 0,
          "fileInfo": {
            "id": "file_out_1",
            "name": "result.png",
            "originalName": "result.png",
            "size": 1024000,
            "mimeType": "image/png",
            "format": "png",
            "fileType": "image",
            "status": "ready",
            "hash": "hash_xxx",
            "path": "/objects/file_out_1.png",
            "metadata": {
              "width": 1024,
              "height": 1024
            },
            "source": {
              "type": "generated",
              "uploadedBy": "user_001",
              "taskId": "task_123"
            },
            "timestamp": {
              "created": 1710000010000,
              "updated": 1710000010000
            }
          }
        }
      ],
      "metadata": {
        "providerJobId": "job_789"
      }
    }
  },
  "timestamp": 1710000010000
}
```

## 14. 落地建议

后端第一阶段建议按以下优先级实施：

1. 打通 `POST /api/v1/tasks`、`GET /api/v1/tasks/:id`、`DELETE /api/v1/tasks/:id`
2. WebSocket 支持 `ai-stream`、`subscribe-task`、`unsubscribe-task`
3. 任务终态稳定返回 `output.items[].fileInfo`
4. grouped 任务稳定保留 `groupId` 与 `sourceHandle`
5. 最后再补 usage、provider 原始响应、审计与重试策略

## 15. 不要这样做

- 不要只回传 `files` 而不回传 `fileInfos`
- 不要丢失 grouped 任务的 `groupId`
- 不要让 `sourceHandle` 在请求和响应之间失配
- 不要把“一个节点多个组”的结果合并成单个后端任务返回
- 不要在任务完成后仍要求前端再拼 provider 原始结果才能知道输出顺序
- 不要在 WebSocket 和 `GET /tasks/:id` 中返回不同语义的终态结果
