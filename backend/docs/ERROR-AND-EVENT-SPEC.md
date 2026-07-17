# 错误码与事件规范

## 1. 文档目的

本文档统一定义后端执行链路中的错误分类、任务事件、重试规则与查询回显字段，保证 API、Worker 和前端对运行态的解释一致。

## 2. 错误分类

### 2.1 通用错误

- `UNKNOWN_ERROR`
- `INTERNAL_ERROR`
- `VALIDATION_ERROR`
- `NOT_FOUND`
- `FORBIDDEN`

### 2.2 文件错误

- `FILE_REGISTER_FAILED`
- `FILE_UPLOAD_FAILED`
- `FILE_HASH_MISMATCH`
- `FILE_DOWNLOAD_FAILED`
- `FILE_PREVIEW_FAILED`

### 2.3 执行创建错误

- `EXECUTION_CREATE_FAILED`
- `TASK_CREATE_FAILED`
- `TASK_CANCEL_FAILED`

### 2.4 执行过程错误

- `TIMEOUT`
- `NETWORK_ERROR`
- `PROVIDER_ERROR`
- `INVALID_RESPONSE`
- `ARTIFACT_DECODE_FAILED`
- `STORAGE_ERROR`
- `CANCELLED`

错误映射说明：

1. 老张 API 超时映射为 `TIMEOUT`
2. 网络、DNS、连接失败映射为 `NETWORK_ERROR`
3. 非 200 响应映射为 `PROVIDER_ERROR`
4. 响应结构无法解析图片映射为 `INVALID_RESPONSE`
5. `base64` 解码失败映射为 `ARTIFACT_DECODE_FAILED`
6. 落盘失败、读取失败映射为 `STORAGE_ERROR`

## 3. 错误对象结构

统一错误对象建议包含以下字段：

- `code`
- `message`
- `category`
- `retryable`
- `provider`
- `providerCode`
- `attemptNo`
- `details`

示例：

```json
{
  "code": "TIMEOUT",
  "message": "平台请求超时",
  "category": "provider_retryable",
  "retryable": true,
  "provider": "laozhang",
  "providerCode": "504",
  "attemptNo": 2,
  "details": {}
}
```

## 4. 重试规则

默认可重试错误：

- `TIMEOUT`
- `NETWORK_ERROR`
- `PROVIDER_ERROR`
- `INVALID_RESPONSE`
- `ARTIFACT_DECODE_FAILED`
- `STORAGE_ERROR`

默认不可重试错误：

- `VALIDATION_ERROR`
- `FORBIDDEN`
- `CANCELLED`
- `UNKNOWN_ERROR`

当前固定策略：

- `max_retries = 2`
- `max_attempts = 3`

## 5. 统一任务事件

统一任务事件类型如下：

- `task_queued`
- `task_started`
- `task_progress`
- `task_retry_scheduled`
- `task_retry_started`
- `task_retry_progress`
- `task_artifact_received`
- `task_completed`
- `task_failed`
- `task_cancelled`
- `step_lineart_started`
- `step_lineart_completed`
- `step_depth_started`
- `step_depth_completed`
- `step_final_started`
- `step_final_completed`
- `step_cache_hit`
- `step_cache_miss`

## 6. 节点差异化事件语义

### 6.1 白模渲染

白模渲染节点会产生以下步骤事件：

1. `lineart`
2. `depth`
3. `final`
4. `cache_hit / cache_miss`

### 6.2 图片高清化

图片高清化节点只使用：

1. `step_final_started`
2. `step_final_completed`

### 6.3 平面图转彩平

平面图转彩平节点只使用：

1. `step_final_started`
2. `step_final_completed`

### 6.4 AI 生图

AI 生图节点只使用：

1. `step_final_started`
2. `step_final_completed`

AI 生图节点不产生：

1. `lineart`
2. `depth`
3. `cache_hit / cache_miss`

## 7. 事件字段要求

每条事件至少包含：

- `eventId`
- `taskId`
- `runId`
- `attemptNo`
- `status`
- `phase`
- `stepType`
- `progress`
- `message`
- `payload`
- `timestamp`

### 7.1 典型 payload 约定

#### 单图节点 `step_final_started`

- `sourceFileId`
- `imageSize`
- `aspectRatio`

#### 单图节点 `step_final_completed`

- `resultFileId`
- `storageKey`

#### AI 生图节点 `step_final_started`

- `prompt`
- `referenceFileIds`
- `imageSize`
- `aspectRatio`

#### AI 生图节点 `step_final_completed`

- `resultFileId`
- `storageKey`

#### 重试调度事件

- `errorCode`
- `errorMessage`
- `nextAttemptNo`
- `delayMs`

## 8. 查询接口回显要求

为保证前端轮询与实时消息语义一致，查询接口必须返回足够的运行态字段。

统一要求：

1. `GET /api/v1/tasks/:id/events` 返回 `messageType = task_event`
2. 事件列表字段与实时消息字段保持一致
3. 任务详情与任务列表至少额外返回：
   - `currentAttemptNo`
   - `retryCount`
   - `maxRetries`
   - `maxAttempts`

### 8.1 白模渲染回显字段

- `whiteModelFileId`
- `styleReferenceFileId`
- `whiteModelFile`
- `styleReferenceFile`
- `resultFile`

### 8.2 单图节点回显字段

- `sourceFileId`
- `inputFile`
- `imageSize`
- `aspectRatio`
- `resultFile`

### 8.3 AI 生图回显字段

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

说明：

1. `referenceFileIds` 必须保持创建执行时的顺序
2. `resultFile` 用于前端终态输出回写
3. 重试字段用于前端展示“正在第几次尝试”和最终失败原因

## 9. 实时消息规范

统一实时消息类型：

- `task_event`

示例：

```json
{
  "type": "task_event",
  "payload": {
    "runId": "run_xxx",
    "taskId": "task_xxx",
    "attemptNo": 2,
    "status": "processing",
    "phase": "retrying",
    "progress": 35,
    "message": "第 2 次尝试执行中",
    "timestamp": 1770000000000
  }
}
```

## 10. 前端展示建议

节点与 group 级状态建议按以下优先级展示：

1. `message`
2. `status`
3. `attemptNo / maxAttempts`
4. `progress`
5. `errorInfo`

最终失败时建议明确展示“最终执行失败”。

## 11. AI 生图节点补充说明

AI 生图节点在本轮接入后，前端统一运行态相关要求如下：

1. 节点组件不得自写轮询循环
2. 状态通过统一运行态 Hook 读取
3. 输出通过统一结果回写服务提交
4. 同一 `completed task` 只允许提交一次
5. 相同 `resultFileId` 在不同 `groupId/outputHandle` 上允许分别回写

## 12. RunningHub 错误映射补充

图片转模型节点接入 RunningHub 后，当前错误分类规则补充如下：

1. RunningHub 请求超时映射为 `TIMEOUT`
2. 网络异常、连接失败、DNS 失败映射为 `NETWORK_ERROR`
3. HTTP 非 2xx 或 `code != 0` 映射为 `PROVIDER_ERROR`
4. 返回 JSON 结构缺字段、字段类型不符、无法解析结果映射为 `INVALID_RESPONSE`

当前 RunningHub 客户端与老张客户端保持同一错误对象结构：

- `code`
- `message`
- `category`
- `retryable`
- `provider = runninghub`
- `providerCode`
- `details`

首次联调期间，所有上传、创建、查询请求都应保留 provider 快照，供后续补齐真实成功/失败样例。

## 13. RunningHub promptTips 早失败规则补充

图片转模型节点在 RunningHub 创建成功返回后，当前增加以下早失败规则：

1. `promptTips.result = false` 映射为 `PROVIDER_ERROR`
2. `promptTips.error` 非空映射为 `PROVIDER_ERROR`
3. `promptTips.node_errors` 非空映射为 `PROVIDER_ERROR`

当前 `providerCode` 细分如下：

- `PROMPT_TIPS_RESULT_FALSE`
- `PROMPT_TIPS_ERROR`
- `PROMPT_TIPS_NODE_ERRORS`

说明：

1. 非法 `promptTips` JSON 不直接判失败
2. 非法 `promptTips` JSON 仍需保留原文与解析状态，供联调排障
3. 该规则的目标是尽早识别工作流配置错误，避免进入无意义轮询
## 图片转模型节点事件补充

当前 `aiImageToPly` 节点沿用统一重试与终态事件，并补充以下阶段型事件约定：

1. `step_final_started`
   - `sourceFileId`
   - `workflowId`
   - `workflowTemplateKey`
2. `task_progress`
   - 上传开始
   - 上传完成
   - RunningHub 创建开始
   - RunningHub 创建完成
   - 结果轮询中
   - 结果下载与保存中
3. `task_progress` 常见 payload 字段：
   - `providerTaskId`
   - `providerClientId`
   - `workflowId`
   - `workflowTemplateKey`
   - `taskStatus`
   - `pollAttempt`
   - `resultCount`
   - `resultFileUrl`
   - `resultFileType`

## 14. RunningHub 联调样例与错误映射补充

RunningHub 当前内部样例文件如下：

1. `backend/docs/examples/runninghub-upload-success.json`
2. `backend/docs/examples/runninghub-create-success.json`
3. `backend/docs/examples/runninghub-query-v2-success.json`
4. `backend/docs/examples/runninghub-failed-response.json`

这些样例的作用：

1. 作为首次联调期间的字段对照基线
2. 作为解析器与错误归一化的内部参考
3. 作为排查 `promptTips`、`results[0]`、`fileType` 约束问题的说明材料

RunningHub 当前错误映射需要区分两层：

1. provider 原始错误层
   - 例如 `providerCode = 40001`
   - 例如 `providerCode = PROMPT_TIPS_ERROR`
2. 统一执行错误层
   - 例如 `PROVIDER_ERROR`
   - 例如 `INVALID_RESPONSE`
   - 例如 `VALIDATION_ERROR`

## 15. RunningHub 结果约束对应的统一错误归类

图片转模型节点当前与 RunningHub 相关的关键失败归类如下：

1. 上传返回缺少 `data.fileName`
   - 统一归类为 `INVALID_RESPONSE`
2. 创建返回缺少 `taskId` 或 `taskStatus`
   - 统一归类为 `INVALID_RESPONSE`
3. `promptTips.result = false`
   - 原始 providerCode 为 `PROMPT_TIPS_RESULT_FALSE`
   - 统一归类为 `PROVIDER_ERROR`
4. `promptTips.error` 非空
   - 原始 providerCode 为 `PROMPT_TIPS_ERROR`
   - 统一归类为 `PROVIDER_ERROR`
5. `promptTips.node_errors` 非空
   - 原始 providerCode 为 `PROMPT_TIPS_NODE_ERRORS`
   - 统一归类为 `PROVIDER_ERROR`
6. 查询成功但 `results[0].fileUrl` 缺失
   - 执行器内部错误为 `RUNNINGHUB_RESULT_FILE_URL_MISSING`
   - 统一归类为 `INVALID_RESPONSE`
   - 当前可重试
7. 查询成功但 `results[0].fileType != ply`
   - 执行器内部错误为 `RUNNINGHUB_RESULT_FILE_TYPE_INVALID`
   - 统一归类为 `VALIDATION_ERROR`
   - 当前不可重试
8. 结果文件下载失败
   - 执行器内部错误为 `RUNNINGHUB_RESULT_DOWNLOAD_FAILED`
   - 统一归类为 `NETWORK_ERROR`
   - 当前可重试

## 16. 多视角修复节点事件补充

`aiMultiViewRestore` 当前沿用统一重试策略与统一事件流，固定事件补充如下：

1. 顶层步骤固定使用 `final`
2. 统一记录 `step_final_started`
3. 统一记录以下 `task_progress` 阶段消息：
   - 开始上传渲染图到 RunningHub
   - 渲染图已上传到 RunningHub
   - 开始上传原视角参考图到 RunningHub
   - 原视角参考图已上传到 RunningHub
   - 双输入 `nodeInfoList` 已生成
   - RunningHub 多视角修复任务已创建
   - RunningHub 任务处理中
   - 开始下载并保存多视角修复结果图
4. 收到结果文件地址后记录 `task_artifact_received`
5. 成功落库后记录 `step_final_completed`
6. 失败重试阶段统一记录：
   - `task_retry_scheduled`
   - `task_retry_started`
   - `task_failed`
   - `task_completed`

补充说明：

1. `promptTips` 非法 JSON 当前不直接归为失败
2. `promptTips` 非法 JSON 必须保留原文与 `parseStatus`
3. 若真实联调中拿到新的 provider 失败结构，应先补样例，再补错误映射文档
## RunningHub 背压补充

对于 RunningHub 类任务，`task_queue_maxed` 统一定义为 provider 背压，而不是普通业务失败。

当前文档口径如下：

1. `task_queue_maxed` 不应直接终结任务
2. `task_queue_maxed` 应释放当前本地 RunningHub 槽位
3. 任务应回到本地等待队列，继续按 FIFO 规则排队
4. RunningHub 的本地并发上限、排队顺序与补位规则统一以 `backend/docs/RUNNINGHUB-SCHEDULING.md` 为准
5. HTTP 2xx 业务响应与非 2xx HTTP 响应体中的 `task_queue_maxed` 都按 provider 背压处理
6. 查询事件中沿用 `task_retry_scheduled`，payload 需包含 `providerCode = task_queue_maxed` 与 `backpressure = true`
