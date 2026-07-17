# 接口规范

## 1. 文档目的

本文档用于说明当前后端已经落地的最小 API 边界，覆盖：

- 文件注册、上传、查询与下载
- grouped-task 执行创建
- 执行、任务、事件查询

如与更早规划冲突，以本文档为准。

## 2. 统一响应

成功响应统一结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": 1770000000000
}
```

失败响应至少包含：

```json
{
  "code": 40001,
  "error": "VALIDATION_ERROR",
  "message": "可读错误信息",
  "timestamp": 1770000000000
}
```

## 3. 当前接口范围

当前已实现接口：

- `POST /api/v1/files/register`
- `POST /api/v1/files/upload`
- `GET /api/v1/files/:id`
- `GET /api/v1/files/:id/download`
- `GET /api/v1/files/:id/preview`
- `POST /api/v1/executions`
- `GET /api/v1/executions/:id`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:id`
- `GET /api/v1/tasks/:id/events`

当前阶段不做：

- 登录接口
- 用户管理接口
- 管理后台接口
- Key 池管理接口

## 4. 文件接口

### 4.1 POST /api/v1/files/register

用途：

- 按哈希注册文件
- 判断是否需要上传二进制
- 返回后续执行可复用的 `fileId`

请求体示例：

```json
{
  "userId": "user-demo",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "size": 12345,
  "mimeType": "image/png",
  "originalName": "input.png",
  "displayName": "input.png",
  "fileType": "image",
  "sourceType": "input"
}
```

字段说明：

- `userId`
  当前阶段可选
- `sha256`
  前端本地计算出的文件摘要
- `size`
  文件字节大小
- `mimeType`
  MIME 类型
- `originalName`
  原始文件名
- `displayName`
  前端显示名，可选
- `fileType`
  当前主要为 `image`
- `sourceType`
  输入图通常为 `input`

### 4.2 POST /api/v1/files/upload

用途：

- 上传二进制内容
- 绑定逻辑文件与物理 blob
- 完成文件状态切换为 `ready`

请求体示例：

```json
{
  "uploadId": "upload_xxx",
  "contentBase64": "base64-string"
}
```

处理规则：

1. 后端根据 `uploadId` 找到待上传文件
2. 重新计算 `sha256`
3. 若与注册摘要不一致，则返回 `FILE_HASH_MISMATCH`
4. 一致则写入物理存储，或命中已有 blob
5. 更新文件状态为 `ready`

### 4.3 GET /api/v1/files/:id

用途：

- 查询文件元数据
- 用于执行前确认输入文件

### 4.4 GET /api/v1/files/:id/download

用途：

- 下载原始文件内容

### 4.5 GET /api/v1/files/:id/preview

用途：

- 当前阶段直接返回原始文件内容
- 后续可演进为独立预览图链路

## 5. 执行接口

### 5.1 POST /api/v1/executions

补充说明：当前共享协议中，`POST /api/v1/executions` 已冻结支持以下 4 类节点：

1. `aiModelRenderTransfer -> model-render-transfer`
2. `aiImageGen -> image-gen`
3. `aiImageHd -> image-hd`
4. `aiFloorplanColorize -> floorplan-colorize`

其中，AI 生图节点使用以下请求结构：

- `nodeType = aiImageGen`
- `taskType = image-gen`
- `executionMode = legacy-grouped-task`
- 节点级共享输入：`prompt`
- 节点级可选参数：`imageSize`
- 节点级可选参数：`aspectRatio`
- group 输入结构：`groupId + referenceFileIds`

AI 生图节点请求体示例：

```json
{
  "userId": "user-demo",
  "nodeType": "aiImageGen",
  "taskType": "image-gen",
  "executionMode": "legacy-grouped-task",
  "nodeId": "node-003",
  "nodeTitle": "AI 生图",
  "prompt": "节点共享提示词",
  "imageSize": "1K",
  "aspectRatio": "auto",
  "groups": [
    {
      "groupId": "group-1",
      "referenceFileIds": ["file_ref_1", "file_ref_2"]
    },
    {
      "groupId": "group-2",
      "referenceFileIds": ["file_ref_3"]
    }
  ]
}
```

AI 生图节点补充校验规则：

1. `prompt` 必须为非空字符串
2. 每个 group 必须包含 `referenceFileIds`
3. 每个 group 的 `referenceFileIds` 长度必须落在 `1~5`
4. `referenceFileIds` 中所有 `fileId` 必须存在且状态为 `ready`
5. 如传入 `imageSize / aspectRatio`，必须落在共享常量允许范围内

AI 生图节点当前创建阶段入库映射规则：

1. 创建 1 条 `ExecutionRun`
2. 每个 group 创建 1 条独立 `ExecutionTask`
3. 节点级 `prompt / imageSize / aspectRatio` 会写入每条 `ExecutionTask.input`
4. 每条任务的 `input.referenceFileIds` 保持当前 group 输入顺序

用途：

- 创建一次执行主记录
- 创建一条或多条 group 任务
- 初始化状态为 `queued`

当前已支持 3 类节点，统一使用 `legacy-grouped-task`：

1. 白模渲染
   - `nodeType = aiModelRenderTransfer`
   - `taskType = model-render-transfer`
   - group 输入：`whiteModelFileId + styleReferenceFileId`
2. 图片高清化
   - `nodeType = aiImageHd`
   - `taskType = image-hd`
   - group 输入：`sourceFileId + imageSize + aspectRatio`
3. 平面图转彩平
   - `nodeType = aiFloorplanColorize`
   - `taskType = floorplan-colorize`
   - group 输入：`sourceFileId + stylePreset + imageSize + aspectRatio`

白模渲染请求体示例：

```json
{
  "userId": "user-demo",
  "nodeType": "aiModelRenderTransfer",
  "taskType": "model-render-transfer",
  "executionMode": "legacy-grouped-task",
  "nodeId": "node-001",
  "nodeTitle": "白模渲染",
  "groups": [
    {
      "groupId": "group-1",
      "whiteModelFileId": "file_white_1",
      "styleReferenceFileId": "file_style_1"
    },
    {
      "groupId": "group-2",
      "whiteModelFileId": "file_white_2",
      "styleReferenceFileId": "file_style_2"
    }
  ]
}
```

单图节点请求体示例：

```json
{
  "userId": "user-demo",
  "nodeType": "aiImageHd",
  "taskType": "image-hd",
  "executionMode": "legacy-grouped-task",
  "nodeId": "node-002",
  "nodeTitle": "图片高清化",
  "groups": [
    {
      "groupId": "group-1",
      "sourceFileId": "file_source_1",
      "imageSize": "2K",
      "aspectRatio": "16:9"
    },
    {
      "groupId": "group-2",
      "sourceFileId": "file_source_2",
      "imageSize": "4K",
      "aspectRatio": "auto"
    }
  ]
}
```

平面图转彩平风格参数补充：

- `stylePreset` 仅对 `aiFloorplanColorize` 生效
- 当前支持：
  - `three-d-render`
  - `photoreal-render`
- 默认值：
  - `three-d-render`
- 前端只传 `stylePreset`，不直接传 prompt 原文
- prompt 由后端共享常量按 `stylePreset` 固定映射
- 未传 `stylePreset` 时，后端创建阶段自动补默认值并写入任务 `input`

说明：

- `aiFloorplanColorize` 与 `aiImageHd` 同为单图输入节点，但平面图转彩平额外支持 `stylePreset`
- 单图节点固定提示词由后端共享常量维护，不从前端传入
- 平面图转彩平节点由前端传 `stylePreset`，后端按固定映射补对应 prompt
- 单图节点未传 `imageSize / aspectRatio` 时，后端会补默认值
- 平面图转彩平节点未传 `stylePreset` 时，后端会补默认值 `three-d-render`

统一校验规则：

1. `nodeType / taskType / executionMode` 必须是已注册节点的合法组合
2. `groups` 至少包含 1 组
3. 每个 group 都必须有非空 `groupId`
4. 白模渲染每个 group 必须同时包含 `whiteModelFileId` 与 `styleReferenceFileId`
5. 单图节点每个 group 必须包含 `sourceFileId`
6. 平面图转彩平节点如传入 `stylePreset`，必须落在共享常量允许范围内
7. 单图节点如传入 `imageSize / aspectRatio`，必须落在共享常量允许范围内
8. 所有传入 `fileId` 必须存在，且文件状态必须为 `ready`

当前创建接口相关校验错误码：

- `40031` `groupId` 为空
- `40032` 白模 group 缺少 `whiteModelFileId`
- `40033` 白模 group 缺少 `styleReferenceFileId`
- `40038` 单图 group 缺少 `sourceFileId`
- `40043` `stylePreset` 非法
- `40039` `imageSize` 非法
- `40040` `aspectRatio` 非法
- `40431` 文件不存在或未就绪

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "runId": "run_xxx",
    "runNo": "RUN-20260404-000001",
    "nodeType": "aiImageHd",
    "taskType": "image-hd",
    "executionMode": "legacy-grouped-task",
    "status": "queued",
    "tasks": [
      {
        "taskId": "task_xxx_1",
        "taskNo": "TASK-20260404-000001",
        "groupId": "group-1",
        "groupOrder": 1,
        "status": "queued"
      },
      {
        "taskId": "task_xxx_2",
        "taskNo": "TASK-20260404-000002",
        "groupId": "group-2",
        "groupOrder": 2,
        "status": "queued"
      }
    ]
  },
  "timestamp": 1770000000000
}
```

### 5.2 GET /api/v1/executions/:id

补充说明：当 `nodeType = aiImageGen` 时，执行详情查询至少应支持以下输入摘要字段回显：

- `prompt`
- `referenceFileIds`
- `imageSize`
- `aspectRatio`
- `resultFileId`
- `resultFile`

说明：

1. `referenceFileIds` 顺序应与创建执行时保持一致
2. 这些字段用于前端统一执行态映射与结果回写
3. AI 生图节点与白模节点、单图节点共用同一执行查询主接口

用途：

- 查询一次执行详情
- 返回 run 级状态与 group 级结果

返回至少包含：

1. `runId / runNo`
2. 顶层 `status`
3. `totalTaskCount / completedTaskCount / failedTaskCount`
4. `tasks[]`

每个 task 至少包含：

1. `taskId / taskNo`
2. `nodeType / taskType`
3. `groupId / groupOrder`
4. `status`
5. `currentStep`
6. `currentAttemptNo / retryCount / maxRetries / maxAttempts`
7. `lastErrorCode / lastErrorMessage`
8. `resultFileId / resultFile`

白模节点额外字段：

- `whiteModelFileId`
- `styleReferenceFileId`
- `whiteModelFile`
- `styleReferenceFile`

单图节点额外字段：

- `inputFileId`
- `sourceFileId`
- `inputFile`
- `imageSize`
- `aspectRatio`

说明：

- 任务列表与任务详情接口复用同一批基础字段
- 白模专用字段继续保留，避免旧前端回退
- 单图节点通过输入文件与参数摘要支持查询回显

## 6. 任务接口

### 6.1 GET /api/v1/tasks

用途：

- 查询任务列表

建议支持参数：

- `runId`
- `userId`
- `status`
- `page`
- `pageSize`

响应至少包含：

- `items`
- `total`
- `page`
- `pageSize`

### 6.2 GET /api/v1/tasks/:id

用途：

- 查询单条任务详情
- 返回当前状态、步骤、错误、输入摘要、结果文件
- 返回最近事件列表，用于前端时间线展示

### 6.3 GET /api/v1/tasks/:id/events

用途：

- 查询任务事件流
- 返回统一 `task_event` 结构，便于后续平滑接入 WebSocket

返回至少包含：

- `messageType = task_event`
- `items[]`
- `total`

每条事件至少包含：

- `eventId`
- `eventType`
- `runId`
- `taskId`
- `attemptNo`
- `status`
- `phase`
- `stepType`
- `progress`
- `message`
- `payload`
- `timestamp`

## 7. 当前实现约束

当前已实现的后端约束：

- 后端不依赖前端本地路径
- 所有执行请求只引用 `fileId`
- `register` 阶段负责判断是否需要上传
- `upload` 阶段负责写入物理存储和哈希校验
- 执行、任务、事件当前使用本地 JSON 存储
- 文件内容当前使用本地文件目录存储
- 后续迁移数据库时，接口协议应保持不变

## 8. 当前不做的接口

当前阶段不要求：

- 登录接口
- 用户管理接口
- 管理后台接口
- Key 池管理接口
- 工作流保存接口
- 画布快照接口
- 项目/成员接口
- 管理员手动重放历史任务接口
- 复杂结果质量校验接口

## 9. AI 生图查询回显补充

为保证前端统一执行态展示与结果回写，`aiImageGen` 节点在以下查询接口中需要保持一致的字段回显口径：

1. `GET /api/v1/executions/:id`
2. `GET /api/v1/tasks`
3. `GET /api/v1/tasks/:id`

当 `nodeType = aiImageGen` 时，单个 task 至少应返回：

- `prompt`
- `referenceFileIds`
- `imageSize`
- `aspectRatio`
- `resultFileId`
- `resultFile`
- `currentStep`
- `currentAttemptNo`
- `retryCount`
- `maxRetries`
- `maxAttempts`
- `lastErrorCode`
- `lastErrorMessage`

补充要求：

1. `referenceFileIds` 顺序必须与创建执行时的前端组内顺序保持一致。
2. 当任务已完成并成功落库时，`resultFileId` 与 `resultFile` 必须可查询。
3. 当任务处于失败或重试中时，前端仍应能通过 `currentAttemptNo / retryCount / lastErrorCode / lastErrorMessage` 获取运行态。
4. AI 生图节点与白模节点、单图节点共用同一查询主接口，不单独新增专用查询接口。

## 10. ͼƬת�Ｐ徒诘憬涌诓钩?
为冻结 `aiImageToPly` 节点第一版的接口边界，`POST /api/v1/executions` 与相关查询接口补充如下。

### 10.1 创建执行请求

图片转模型节点固定使用以下请求结构：

- `nodeType = aiImageToPly`
- `taskType = image-to-ply`
- `executionMode = legacy-grouped-task`
- group 输入结构：`groupId + sourceFileId`

请求体示例：

```json
{
  "userId": "user-demo",
  "nodeType": "aiImageToPly",
  "taskType": "image-to-ply",
  "executionMode": "legacy-grouped-task",
  "nodeId": "node-004",
  "nodeTitle": "图片转模型",
  "groups": [
    {
      "groupId": "group-1",
      "sourceFileId": "file_source_1"
    },
    {
      "groupId": "group-2",
      "sourceFileId": "file_source_2"
    }
  ]
}
```

### 10.2 创建阶段固定规则

图片转模型节点在创建阶段固定遵循以下规则：

1. 每个 group 必须包含 `sourceFileId`
2. 每个 group 必须且只能有 1 张输入图片
3. 所有 `sourceFileId` 必须存在且文件状态为 `ready`
4. Worker 执行时会先将输入图片上传到 RunningHub，再将上传返回 `fileName` 写入工作流节点 `1.image`
5. 当前固定 provider 为 `runninghub`
6. 当前固定工作流编号为 `2014519004714508290`

### 10.3 创建阶段入库映射

图片转模型节点在创建阶段固定映射为：

1. 创建 1 条 `ExecutionRun`
2. 每个 group 创建 1 条独立 `ExecutionTask`
3. 每条任务的 `input` 至少包含：
   - `sourceFileId`
   - `workflowId`
   - `workflowTemplateKey`
4. 一期固定为单输入、单输出、单 `ply` 结果模式

### 10.4 执行查询回显要求

当 `nodeType = aiImageToPly` 时，执行详情查询、任务详情查询至少应回显：

- `sourceFileId`
- `inputFile`
- `workflowId`
- `providerTaskId`
- `providerClientId`
- `resultFileId`
- `resultFile`

说明：

1. `aiImageToPly` 一期固定使用 RunningHub 工作流 `2014519004714508290`
2. 查询回显需要支持运行期外部任务标识，便于联调与排障
3. 结果文件必须能回显到统一查询接口中，便于前端统一运行态展示与结果回写

### 10.5 共享常量唯一来源

图片转模型节点的一期共享常量与内部映射类型固定定义在：

- `backend/shared/src/constants/aiImageToPly.ts`

该文件作为以下概念的唯一来源：

- `nodeType = aiImageToPly`
- `taskType = image-to-ply`
- `executionMode = legacy-grouped-task`
- `provider = runninghub`
- `workflowId = 2014519004714508290`
- `workflowTemplateKey = sharp-image-to-ply-v1`
- `inputNodeId = 1`
- `inputFieldName = image`
- `outputFileType = ply`
- RunningHub 创建返回内部映射类型
- RunningHub 查询结果内部映射类型

后续 API、Worker、测试与文档更新时，不应重复定义以上常量或另起命名版本。

### 11.4 创建接口当前已落地的入库映射

当前 `aiMultiViewRestore` 创建接口已落地以下入库映射规则：

1. 创建 1 条 `ExecutionRun`
2. 每个 group 创建 1 条独立 `ExecutionTask`
3. 每条任务固定写入 `provider = runninghub`
4. 当前创建阶段 `model = null`，等待 Worker 实际执行时补充 provider 侧运行信息
5. 每条任务 `input` 固定包含：
   - `renderFileId`
   - `referenceFileId`
   - `workflowId`
   - `workflowTemplateKey`
   - `renderInputNodeId`
   - `renderInputFieldName`
   - `referenceInputNodeId`
   - `referenceInputFieldName`
   - `outputNodeId`
   - `outputFileType`

说明：

1. `aiMultiViewRestore` 创建阶段只负责协议校验、文件校验与任务入库
2. RunningHub 实际上传与工作流创建由 Worker 执行阶段负责
3. 当前该节点继续复用统一 `providers.runninghub` 配置，不新增独立 provider 配置项

### 10.6 创建接口当前已落地的入库映射

当前 `aiImageToPly` 创建接口已落地以下入库映射规则：

1. 创建 1 条 `ExecutionRun`
2. 每个 group 创建 1 条独立 `ExecutionTask`
3. 每条任务固定写入 `provider = runninghub`
4. 当前创建阶段 `model = null`，等待 Worker 实际执行时补充 provider 侧运行信息
5. 每条任务 `input` 固定包含：
   - `inputFileId`
   - `sourceFileId`
   - `workflowId`
   - `workflowTemplateKey`
   - `workflowInputNodeId`
   - `workflowInputFieldName`
   - `outputFileType`

当前非法输入会按统一错误映射返回明确拦截结果：

- `INVALID_TASK_TYPE`
- `INVALID_EXECUTION_MODE`
- `INVALID_GROUPS`
- `INVALID_INPUT_FILE_ID:{index}`
- `FILE_NOT_FOUND:{fileId}`
## 图片转模型节点查询回显补充

当前 `aiImageToPly` 节点通过统一执行查询接口回显以下字段：

- `sourceFileId`
- `workflowId`
- `workflowTemplateKey`
- `providerTaskId`
- `providerClientId`
- `resultFileId`
- `resultFile`

## 多视角修复节点接口补充

为冻结 `aiMultiViewRestore` 节点第一版的接口边界，`POST /api/v1/executions` 与相关查询接口补充如下。

### 11.1 创建执行请求

多视角修复节点固定使用以下请求结构：

- `nodeType = aiMultiViewRestore`
- `taskType = multi-view-restore`
- `executionMode = legacy-grouped-task`
- group 输入结构：`groupId + renderFileId + referenceFileId`

请求体示例：

```json
{
  "userId": "user-demo",
  "nodeType": "aiMultiViewRestore",
  "taskType": "multi-view-restore",
  "executionMode": "legacy-grouped-task",
  "nodeId": "node-005",
  "nodeTitle": "多视角修复",
  "groups": [
    {
      "groupId": "group-1",
      "renderFileId": "file_render_1",
      "referenceFileId": "file_reference_1"
    }
  ]
}
```

说明：

1. 每个 group 必须同时提供 `renderFileId` 与 `referenceFileId`
2. 两个 fileId 都必须是后端已上传完成的图片文件
3. 当前固定 provider 为 `runninghub`
4. 当前固定复用全局 `providers.runninghub` 配置，不新增节点独立 provider 配置项

### 11.2 执行查询回显要求

当 `nodeType = aiMultiViewRestore` 时，执行详情查询、任务详情查询至少应回显：

- `renderFileId`
- `referenceFileId`
- `workflowId`
- `workflowTemplateKey`
- `providerTaskId`
- `providerClientId`
- `resultFileId`
- `resultFile`

说明：

1. `aiMultiViewRestore` 一期固定使用 RunningHub 工作流 `2014516111097729025`
2. 查询回显需要支持运行期外部任务标识，便于联调与排障
3. 结果文件必须能回显到统一查询接口中，便于前端统一运行态展示与结果回写

### 11.3 共享常量唯一来源

多视角修复节点的一期共享常量与内部映射类型固定定义在：

- `backend/shared/src/constants/aiMultiViewRestore.ts`

该文件作为以下概念的唯一来源：

- `nodeType = aiMultiViewRestore`
- `taskType = multi-view-restore`
- `executionMode = legacy-grouped-task`
- `provider = runninghub`
- `workflowId = 2014516111097729025`
- `workflowTemplateKey = multi-view-restore-v1`
- `renderInputNodeId = 124`
- `renderInputFieldName = image`
- `referenceInputNodeId = 102`
- `referenceInputFieldName = image`
- `outputNodeId = 127`
- `outputFileType = image`

后续 API、Worker、测试与文档更新时，不应重复定义以上常量或另起命名版本。

补充说明：

1. `resultFile` 使用统一 files 资产结构返回，模型文件当前 `fileType = ply`
2. `providerTaskId / providerClientId` 从最近一条 provider 阶段事件 payload 中提取
3. 前端无需为图片转模型节点新增专用查询接口

## 11. 图片转模型节点联调样例与回显补充

图片转模型节点当前联调样例统一保存在：

1. `backend/docs/examples/runninghub-upload-success.json`
2. `backend/docs/examples/runninghub-create-success.json`
3. `backend/docs/examples/runninghub-query-v2-success.json`
4. `backend/docs/examples/runninghub-failed-response.json`

这些样例用于说明以下接口阶段的外部返回：

1. RunningHub 上传接口返回 `data.fileName`
2. RunningHub 创建接口返回 `taskId / clientId / taskStatus / promptTips`
3. RunningHub 查询结果 V2 返回 `results[0].fileUrl / fileType / nodeId`

补充回显要求：

1. 执行详情查询应能让前端间接关联 RunningHub 创建结果
2. 前端至少可通过 `providerTaskId / providerClientId / resultFile` 做运行态展示与结果回写
3. `resultFile` 当前必须是统一 files 资产中的 `ply` 文件

补充说明：

1. 当前没有官方完整返回样例时，以 `backend/docs/examples/` 内部样例为准
2. 若真实联调返回与当前样例不一致，应先保留 provider 快照，再更新样例与文档

## 12. 多视角修复节点查询回显补充

当 `nodeType = aiMultiViewRestore` 时，统一执行查询接口当前至少回显以下字段：

1. `renderFileId`
2. `referenceFileId`
3. `workflowId`
4. `workflowTemplateKey`
5. `providerTaskId`
6. `providerClientId`
7. `resultFileId`
8. `resultFile`
9. `renderFile`
10. `referenceFile`

上述字段适用于：

1. 执行详情查询
2. 任务列表查询
3. 任务详情查询
