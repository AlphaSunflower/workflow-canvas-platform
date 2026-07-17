# 文件节点元数据与属性面板规范

## 1. 目标

文件节点需要支持右键菜单进入属性面板，并展示完整来源信息与生成信息。

为此，后端输出的文件元数据必须满足统一结构。

## 2. 文件来源规则

### 2.1 本地导入文件

```json
{
  "source": {
    "type": "imported",
    "importMethod": "local",
    "importedAt": 1775188800000
  }
}
```

显示文案：

- 文件来源：导入

### 2.2 节点生成文件

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

显示文案：

- 文件来源：节点产物
- 生成节点编号：`producerNodeDisplayId`
- 任务编号：`taskNo`
- 任务创建时间：`taskCreatedAt`
- 任务开始时间：`taskStartedAt`
- 任务完成时间：`taskCompletedAt`

## 3. FileInfo 要求

后端给前端返回的 `FileInfo` 至少应包含：

```ts
interface FileInfo {
  id: string
  name: string
  originalName: string
  size: number
  mimeType: string
  format: string
  fileType: 'image' | 'video' | 'model3d'
  status: 'uploading' | 'processing' | 'ready' | 'error'
  hash: string
  path: string
  thumbnailPath?: string
  metadata: {
    width?: number
    height?: number
    duration?: number
    frameRate?: number
    codec?: string
    bitrate?: number
    frameCount?: number
    colorSpace?: string
    hasAlpha?: boolean
  }
  source: FileSource
  timestamp: {
    created: number
    updated: number
  }
}
```

## 4. 文件节点属性面板所需后端保证

后端必须保证以下行为：

- 查询文件详情时，能够直接返回 `source`
- 节点产物文件的 `source.taskNo` 不为空
- 节点产物文件的 `source.producerNodeDisplayId` 不为空
- 三个任务时间字段按实际值保存

## 5. 节点产物写入规则

当任务结果产生新文件时，后端创建文件记录时应同步写入：

- `source.type = 'node-output'`
- `source.producerNodeId = task.node.nodeId`
- `source.producerNodeDisplayId = task.node.nodeDisplayId`
- `source.producerNodeType = task.node.nodeType`
- `source.taskId = task.taskId`
- `source.taskNo = task.taskNo`
- `source.taskCreatedAt = task.createdAt`
- `source.taskStartedAt = task.startedAt`
- `source.taskCompletedAt = task.completedAt`

补充规则：

- 以上字段由后端根据任务主记录自动补全
- 不依赖前端手工拼装
- 即使回传文件对象中已有部分 `source` 字段，后端也必须以任务主记录为准修正
- 任何节点产物文件都不得缺失 `source.taskNo`
- 任何节点产物文件都不得缺失 `source.producerNodeDisplayId`

## 6. 前后端职责边界

前端：

- 展示文件来源与生成信息
- 右键文件节点弹出菜单
- 点击“属性”后展示弹窗

后端：

- 提供完整可追溯的文件来源元数据
- 保证任务与文件之间的关联一致
- 保证文件详情查询返回的数据足够支撑属性面板
