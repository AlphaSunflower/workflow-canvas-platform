# 任务生命周期与结果落库规则

## 1. 目标

本文档补充任务 3 的实现细则，明确任务状态流转、结果回传、摘要生成、文件来源自动补全与查询复用规则。

## 2. 状态流转规则

## 2.1 允许的状态机

```text
queued -> processing -> completed
queued -> processing -> failed
queued -> cancelled
processing -> cancelled
```

不允许：

- `completed -> processing`
- `failed -> processing`
- `cancelled -> processing`
- `completed -> failed`
- `failed -> completed`

## 2.2 时间字段维护规则

### 进入 `queued`

- 写入 `createdAt`
- `startedAt` 为空
- `completedAt` 为空

### 进入 `processing`

- 若 `startedAt` 为空，则自动写入当前服务端时间
- `createdAt` 不变
- `completedAt` 仍为空

### 进入终态

终态包括：

- `completed`
- `failed`
- `cancelled`

规则：

- 若 `completedAt` 为空，则自动写入当前服务端时间
- `startedAt` 如为空且业务允许直接终态，则保留为空

## 2.3 幂等要求

重复提交同一终态更新时：

- 不重复覆盖已存在的关键时间字段
- 不重复生成文件记录
- 不重复追加输出文件引用

## 3. 结果回传落库规则

## 3.1 必须落库的任务字段

回传结果时，后端必须同步更新：

- `status`
- `createdAt`
- `startedAt`
- `completedAt`
- `inputSummary`
- `outputSummary`
- `inputFiles`
- `outputFiles`
- `errorInfo`

## 3.2 inputSummary 保存规则

`inputSummary` 用于历史页和属性面板复用，建议保存已规整的轻量摘要，而不是完整原始大对象。

建议包含：

- 输入文件数量
- 关键配置摘要
- 文本提示词摘要
- 输入分组信息

示例：

```json
{
  "prompt": "modern living room",
  "inputFileCount": 2,
  "groupId": "group-1",
  "groupLabel": "组 1",
  "config": {
    "width": 1024,
    "height": 1024,
    "model": "sdxl"
  }
}
```

## 3.3 outputSummary 保存规则

`outputSummary` 用于历史列表快速展示与检索。

建议包含：

- 输出文件数量
- 输出文件 ID 列表
- 输出文本预览
- 输出数据字段列表
- 是否成功生成节点产物

示例：

```json
{
  "outputFileCount": 1,
  "outputFileIds": ["file-out-001"],
  "textPreview": null,
  "dataKeys": ["seed", "providerJobId"],
  "hasNodeOutputs": true
}
```

## 3.4 inputFiles 与 outputFiles

落库存储使用轻量引用结构：

```ts
interface TaskFileRef {
  fileId: string
  fileName?: string
  mimeType?: string
}
```

规则：

- `inputFiles` 保存任务实际消费的文件引用
- `outputFiles` 保存任务实际产出的文件引用
- 历史页列表不依赖文件详情接口即可显示基础信息

## 4. 节点产物文件来源自动补全

## 4.1 自动补全时机

当 `POST /api/v1/tasks/:taskId/result` 中的 `outputs.files` 包含新文件时，后端创建或落库这些文件记录时必须自动补全 `FileSource`。

## 4.2 自动补全字段

对每个节点产物文件写入：

```json
{
  "source": {
    "type": "node-output",
    "producerNodeId": "17",
    "producerNodeDisplayId": "#00017",
    "producerNodeType": "aiImageGen",
    "taskId": "task-uuid-001",
    "taskNo": "TASK-20260403-000001",
    "taskCreatedAt": 1775188800000,
    "taskStartedAt": 1775188802000,
    "taskCompletedAt": 1775188815000
  }
}
```

字段来源：

- `producerNodeId` 来自 `task.node.nodeId`
- `producerNodeDisplayId` 来自 `task.node.nodeDisplayId`
- `producerNodeType` 来自 `task.node.nodeType`
- `taskId` 来自任务主记录
- `taskNo` 来自任务主记录
- 时间字段来自任务主记录最终状态时间

## 4.3 自动补全优先级

如果回传的文件对象中已包含 `source`：

- 后端仍应以任务主记录为准进行补齐和纠正
- 不允许客户端覆盖 `taskNo` 或生产节点标识

## 5. 查询复用规则

## 5.1 列表查询

`GET /api/v1/tasks` 必须满足以下使用场景：

- 任务历史页列表
- 按任务编号检索
- 按节点编号检索
- 按任务状态筛选
- 按批次查看
- 按快照查看

## 5.2 详情查询

`GET /api/v1/tasks/:taskId` 必须可被以下场景共用：

- 任务历史详情页
- 文件节点属性窗口反查任务
- 调试与排障页面

返回必须包含完整 `TaskRecord`。

## 6. snapshotId 查询规则

当传入 `snapshotId` 时：

- 查询结果应返回与该快照 `relatedTasks` 关联的任务
- 如果底层通过关联表实现，表现层仍以 `TaskRecord` 返回
- 如果快照还未建立数据库关联表，至少需要有可行的反查方案

## 7. 推荐实现拆分

即使当前只做接口文档，后端实现建议职责拆分如下：

- `update-task-status.dto.ts`
  负责状态更新入参校验
- `report-task-result.dto.ts`
  负责结果回传入参校验
- `query-tasks.dto.ts`
  负责列表查询条件校验
- `task-result.mapper.ts`
  负责将结果回传对象映射到任务落库结构
- `file-source.mapper.ts`
  负责为节点产物文件生成标准 `FileSource`
