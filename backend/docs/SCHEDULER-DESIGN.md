# 调度设计

## 1. 文档目的

本文档描述后端一期当前最小可用调度机制。

当前目标不是完整实现多平台、多 Key 池调度，而是先让：

1. API 创建出的任务进入待执行状态
2. Worker 启动后能持续拉起待执行任务
3. grouped 多任务可以并发执行
4. 同一任务不会被重复消费

## 2. 当前调度目标

一期当前调度器负责：

- 从执行存储中找到 `queued` 任务
- 按 FIFO 顺序领取任务
- 将任务状态推进为 `processing`
- 由 Worker 并发消费任务
- 成功后推进为 `completed`
- 失败后推进为 `failed`
- 记录开始、完成、失败等事件

## 3. 当前实现边界

当前调度层实现基于本地 JSON 执行存储，不依赖 Redis。

当前实际落地方式：

- 执行数据文件：`backend/data/executions-store.json`
- 执行存储锁文件：`backend/data/executions-store.lock`
- Worker 轮询周期：由 `BACKEND_WORKER_POLL_INTERVAL_MS` 控制
- Worker 最大并发：当前固定为 `4`

说明：

- 这是一期当前的最小实现
- 后续接数据库或消息队列时，调度语义保持不变

## 4. 队列模型

当前队列不单独维护独立消息表，而是直接基于 `execution_tasks.status` 实现：

- `queued`
  等待调度
- `processing`
  已被 Worker 领取
- `completed`
  已完成
- `failed`
  已失败

任务流程如下：

1. API 创建执行时写入 `ExecutionRun`
2. 为每个 group 写入 1 条 `ExecutionTask(status=queued)`
3. Worker 轮询时读取所有 `queued` 任务
4. 按创建时间和 `groupOrder` 做 FIFO 排序
5. 在领取瞬间将任务改为 `processing`
6. Worker 执行成功则写为 `completed`
7. Worker 执行失败则写为 `failed`

## 5. FIFO 规则

当前 FIFO 规则如下：

1. 优先按 `createdAt` 升序
2. 若 `createdAt` 相同，则按 `groupOrder` 升序

这样可以保证：

- 先创建的任务先执行
- 同一次 grouped 执行中的任务顺序稳定

## 6. 抢占保护

为了避免重复消费，同一任务在领取瞬间必须完成状态更新：

1. Worker 调用 `claimQueuedTasks`
2. 仓储只选取当前仍为 `queued` 的任务
3. 领取后立即把该任务写为 `processing`
4. 同一轮之后其他 Worker 再读取时，不能再次拿到该任务

当前最小实现的抢占保护建立在：

- 先过滤 `queued`
- 再原地更新为 `processing`
- 再持久化回同一份执行存储
- 对执行存储的读写通过锁文件串行化，避免并发完成时相互覆盖状态

## 7. 并发模型

当前 Worker 支持 grouped 多任务并发执行。

当前规则：

- 单个 Worker 进程最大并发固定为 `4`
- 轮询时根据剩余容量一次领取多条任务
- 领取后的任务通过 `Promise.all` 并发执行

这可以满足：

- 一个节点中的多个 group 独立并发执行
- 同一个 Worker 不会无限制拉满系统资源

## 8. 当前 Worker 执行行为

在真正节点执行器接入前，当前队列消费先走最小占位执行逻辑：

1. 领取任务
2. 记录 `task_started`
3. 写入一份调试产物到本地存储
4. 记录 `task_completed`
5. 更新 `ExecutionRun` 聚合状态

这一步的目的不是完成真实白模渲染，而是先打通：

- API 创建任务
- Worker 消费任务
- 状态推进
- 事件写入
- 并发与去重保护

## 9. 事件与状态推进

当前队列层至少写入以下事件：

- `task_queued`
- `task_started`
- `task_completed`
- `task_failed`

状态推进规则：

1. 初始创建：`queued`
2. 领取执行：`processing`
3. 成功完成：`completed`
4. 执行失败：`failed`

同时：

- 第一个任务开始时，`ExecutionRun` 从 `queued` 进入 `processing`
- 全部任务完成时，`ExecutionRun` 汇总进入 `completed`
- 只要最终有失败任务且全部结束，`ExecutionRun` 汇总进入 `failed`

## 10. 与重试的当前关系

当前任务 09 的范围只实现最小队列消费，不实现完整自动重试重入。

当前阶段：

- 队列会记录 `processing / completed / failed`
- 自动重试逻辑留给后续任务继续接入

但当前结构已经为重试预留了：

- `currentAttemptNo`
- `retryCount`
- `maxRetries`
- 任务事件流

## 11. 一期当前验收语义

对于当前队列基础设施，验收标准是：

1. API 创建的任务能被 Worker 拉起
2. 多个 group 能并发运行
3. 同一任务不会被重复消费

这三点成立，即表示最小调度机制已经打通。

## 12. 后续扩展方向

后续阶段再继续扩展：

- 自动重试重入
- 步骤级进度推进
- 真正的白模渲染执行器
- 多平台能力池
- Key 池并发与租约
- 更可靠的持久化队列
