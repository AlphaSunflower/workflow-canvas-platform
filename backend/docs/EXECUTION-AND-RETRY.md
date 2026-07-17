# 执行与重试设计

## 1. 文档目的

本文档定义：

- 执行主链路
- 任务生命周期
- 成功与失败判定
- 自动重试规则
- 错误处理方式
- 进度与事件回传规范

当前文档描述的是一期当前已经落地的执行与重试行为。

## 2. 顶层执行模型

### 2.1 ExecutionRun

表示一次用户触发的节点执行主记录。

### 2.2 ExecutionTask

表示该次执行下的一条实际任务。

### 2.3 TaskAttempt

表示某条任务的一次真实执行尝试。

之所以必须拆成三层，是因为：

- 用户看到的是“一次执行”
- 调度器处理的是“一条任务”
- 重试发生在“某次尝试”

## 3. 成功判定

你已经明确的一期成功规则如下：

- 只要外部平台正常返回产物，并且后端成功接收到该产物并落库，就视为任务成功

因此成功必须满足：

1. 平台返回了有效产物
2. 后端接收到了该产物
3. 后端成功保存该产物
4. 后端成功生成输出文件资产

如果任一环节未完成，则该次尝试不算成功。

## 4. 失败判定

一次任务尝试失败的典型场景包括：

- 外部平台请求超时
- 外部平台返回错误
- 平台返回结构异常，没有有效产物
- 平台返回产物地址，但下载失败
- 后端保存产物失败

注意：

- 一次尝试失败，不等于任务最终失败
- 只有当可重试次数耗尽后，任务才进入最终失败状态

## 5. 自动重试规则

### 5.1 固定重试次数

一期按固定规则执行：

- `max_retries = 2`

含义：

- 第 1 次：初始执行
- 第 2 次：第一次重试
- 第 3 次：第二次重试

即每条任务最大总尝试次数为：

- `3`

### 5.2 重试间隔

建议默认值：

- 第一次重试前等待 `3` 秒
- 第二次重试前等待 `10` 秒

说明：

- 这是一期既定规则
- Worker 当前默认重试间隔已实现为 `3000ms`、`10000ms`
- 测试环境可通过 `RetryPolicyService` 注入更短间隔

### 5.3 默认可重试错误

一期默认可自动重试：

- `TIMEOUT`
- `NETWORK_ERROR`
- `PROVIDER_ERROR`
- `INVALID_RESPONSE`
- `STORAGE_ERROR`

### 5.4 默认不可重试错误

一期默认不自动重试：

- `VALIDATION_ERROR`
- `AUTH_ERROR`
- `CANCELLED`

## 6. 主状态模型

执行主记录与任务主状态统一使用：

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

说明：

- 不额外增加 `retrying` 主状态
- 重试中的语义通过事件和尝试编号体现

## 7. 尝试状态模型

建议尝试状态使用：

- `processing`
- `completed`
- `failed`
- `cancelled`

## 8. 生命周期规则

### 8.1 ExecutionRun 生命周期

1. 创建执行主记录，初始为 `queued`
2. 创建一条或多条任务，初始都为 `queued`
3. 当第一条任务真正开始执行时，主记录进入 `processing`
4. 当所有任务成功完成时，主记录进入 `completed`
5. 当所有任务结束，且至少一条任务最终失败时，主记录进入 `failed`
6. 如果用户取消，主记录进入 `cancelled`

### 8.2 ExecutionTask 生命周期

1. 创建任务，状态为 `queued`
2. 当第一次尝试开始时，任务变为 `processing`
3. 如果任一次尝试成功，任务变为 `completed`
4. 如果全部允许的尝试都失败，任务变为 `failed`
5. 如果被取消，任务变为 `cancelled`

当前已落地实现：

1. 创建任务时状态为 `queued`
2. 被 Worker 领取后写入 `task_started` 并进入 `processing`
3. 第 1 次尝试失败时写入 `task_retry_progress`、`task_retry_scheduled`
4. 第 2/3 次尝试开始时写入 `task_retry_started`
5. 任一次尝试成功后写入 `task_progress`、`task_completed`
6. 第 3 次仍失败时写入 `task_retry_progress`、`task_failed`

### 8.3 TaskAttempt 生命周期

1. 创建尝试记录
2. 尝试进入执行中
3. 持续回写进度
4. 尝试最终进入：
   - `completed`
   - `failed`
   - `cancelled`

## 9. 进度模型

后端必须给前端和后台返回足够明确的进度信息。

建议统一返回：

- `status`
- `phase`
- `attemptNo`
- `maxAttempts`
- `progress`
- `message`
- `errorInfo`

建议 `phase` 取值：

- `queued`
- `processing`
- `retrying`
- `completed`
- `failed`
- `cancelled`

说明：

- `status` 是主状态
- `phase` 是界面展示状态
- `attemptNo` 用于明确当前是第几次执行

## 10. 事件模型

建议统一事件类型：

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

每条事件建议至少带：

- `taskId`
- `runId`
- `attemptNo`
- `status`
- `progress`
- `message`
- `timestamp`

当前已落地事件包括：

- `task_queued`
- `task_started`
- `task_progress`
- `task_retry_scheduled`
- `task_retry_started`
- `task_retry_progress`
- `task_completed`
- `task_failed`
- `step_lineart_started`
- `step_lineart_completed`
- `step_depth_started`
- `step_depth_completed`
- `step_final_started`
- `step_final_completed`
- `step_cache_hit`
- `step_cache_miss`

## 11. 错误对象模型

建议统一错误对象结构：

```json
{
  "code": "TIMEOUT",
  "message": "平台请求超时",
  "category": "provider_retryable",
  "retryable": true,
  "provider": "example-provider",
  "providerCode": "504",
  "attemptNo": 2,
  "details": {}
}
```

建议字段：

- `code`
- `message`
- `category`
- `retryable`
- `provider`
- `providerCode`
- `attemptNo`
- `details`

## 12. 用户侧可见行为

前端应该能直接展示以下状态变化：

- 第 1 次执行中
- 第 1 次失败，准备第 2 次重试
- 第 2 次执行中
- 第 2 次失败，准备第 3 次重试
- 第 3 次执行中
- 最终失败

这要求后端持续返回：

- 当前尝试次数
- 总尝试次数
- 最新进度
- 最新错误摘要
- 最终失败信息

当前查询接口可稳定返回：

- `currentAttemptNo`
- `retryCount`
- `maxRetries`
- `maxAttempts`
- `currentStep`
- `lastErrorCode`
- `lastErrorMessage`

## 13. 最终失败规则

当所有允许的尝试都失败后：

1. 任务状态变为 `failed`
2. 将最终错误写回任务主记录
3. 发送最终失败事件
4. 重新计算执行主记录状态
5. 前端与后台看到稳定的失败结果

建议最终失败信息统一生成一条可读文案，例如：

- `任务在 3 次尝试后仍未正常接收到返回产物，执行失败。`

当前阶段说明：

- 队列基础设施已经接入自动重试主循环
- “重试后最终失败”的完整路径已落地并可查询
- 每次尝试的开始、失败、重试调度、重试开始、最终完成/失败都会进入事件流

## 14. 取消规则

如果用户取消：

1. 还未执行的任务直接进入 `cancelled`
2. 正在执行的尝试，如果平台支持取消，则发起取消
3. 不再进入后续重试
4. 所有占用的 Key 租约必须释放
5. 写入取消事件

## 15. 持久化要求

至少要满足：

- `execution_tasks` 保存任务最终状态和最新重试信息
- `task_attempts` 保存每次尝试
- `task_events` 保存有序事件流

任务层建议至少保存：

- `current_attempt_no`
- `retry_count`
- `max_retries`
- `last_error_code`
- `last_error_message`

尝试层建议至少保存：

- `attempt_no`
- `status`
- `progress`
- `error_code`
- `error_message`
- `started_at`
- `completed_at`

当前最小实现额外已落地：

- `ExecutionRun`
- `ExecutionTask`
- `TaskEvent`
- `executions-store.lock` 文件级互斥保护

并通过本地 JSON 执行存储支撑 Worker 调度与查询。

## 16. 一期不做的内容

一期不要求：

- 按不同节点类型配置不同重试策略
- 管理员手动回放某次旧尝试
- 基于产物质量的复杂成功校验
- 按平台错误类型动态调整退避
