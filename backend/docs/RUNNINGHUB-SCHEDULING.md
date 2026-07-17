# RunningHub 本地调度规则

## 1. 文档目的

本文档定义当前后端对 RunningHub 类任务的统一本地调度规则，用于约束：

- 本地并发上限
- 本地排队顺序
- 槽位释放后的补位规则
- `task_queue_maxed` 的处理语义
- 与非 RunningHub 任务的隔离关系

如与节点专项文档存在冲突，以本文档为准。

## 2. 适用范围

当前适用于所有 `provider = runninghub` 的后端执行任务，至少包括：

- `aiImageToPly`
- `aiMultiViewRestore`

本期只覆盖单 worker 进程内调度，不覆盖多 worker / 多进程 / 分布式调度。

## 3. 本地并发上限

同一 RunningHub API Key 在本地调度层的最大并发数固定为 `3`。

约束如下：

1. 任意时刻最多只有 3 个 RunningHub 任务进入真正的 provider 执行阶段
2. 超过 3 个的 RunningHub 任务必须停留在本地 `queued`
3. 本地调度层不得继续把第 4 个及以后的 RunningHub 任务直接发送到 RunningHub

本地并发上限的目标是避免由于后端超发导致 RunningHub 返回 `task_queue_maxed`。

## 4. 排队顺序

RunningHub 本地队列采用 FIFO 规则，排序键固定为：

1. `createdAt` 升序
2. `groupOrder` 升序

解释：

- 更早创建的任务优先执行
- 同一批 grouped 任务在创建时间相同或相近时，按 group 顺序执行

当前不引入额外优先级字段，不做抢占，不做节点类型间差异化优先级。

## 5. 状态流转规则

RunningHub 任务的本地状态流转固定如下：

1. 创建成功后进入 `queued`
2. 仅当本地 RunningHub 槽位可用时，任务才允许从 `queued` 进入 `processing`
3. 若本地无可用槽位，任务保持 `queued`
4. 任务成功、失败或显式释放槽位后，调度器立即尝试补位下一条 `queued` 任务

补位规则：

- 补位目标必须是当前队列中排序最靠前的 RunningHub `queued` 任务
- 补位应尽量即时触发，而不是固定等待下一轮长间隔轮询

## 6. 与其他 Provider 的关系

RunningHub 本地调度只限制 RunningHub 自身。

固定规则如下：

1. 非 RunningHub 任务不受 RunningHub 本地 3 并发限制影响
2. RunningHub 队列已满时，不应阻塞老张等其他 provider 的任务继续执行
3. 后端允许不同 provider 在各自并发规则下并行推进

## 7. task_queue_maxed 处理语义

`task_queue_maxed` 固定定义为 RunningHub provider 背压，不作为普通业务失败直接终结。

处理规则：

1. 若 RunningHub 返回 `task_queue_maxed`，说明 provider 当前拒绝接收新的任务
2. 后端应将其归类为 `provider backpressure`
3. 当前任务不得直接进入最终失败
4. 当前任务应释放已占用的本地 RunningHub 槽位
5. 当前任务应重新回到本地等待队列，按既定规则继续排队
6. 允许配置短退避，避免立即再次撞满 provider
7. 无论 `task_queue_maxed` 出现在 HTTP 2xx 业务响应，还是非 2xx HTTP 响应体中，都按同一背压语义处理

说明：

- 该错误的语义是“平台暂时忙”，不是“输入非法”或“工作流配置永久错误”
- 因此其处理方式应更接近本地背压重排队，而不是直接消耗掉一次普通业务失败机会

## 8. 本期明确不做

当前明确不做：

- 多 worker / 多实例之间共享 RunningHub 并发槽位
- 分布式锁
- 跨机器统一调度中心
- 针对不同 RunningHub workflow 分别设置独立并发池
- 基于用户、项目或节点类型的优先级调度
- 抢占式调度

## 9. 验收口径

本地调度完成后，至少应满足：

1. 前端一次发起超过 3 个 RunningHub 请求时，后端不会把超过 3 个任务同时发送到 RunningHub
2. 第 4 个及以后任务保持 `queued`
3. 槽位释放后会按 `createdAt + groupOrder` 补位
4. 非 RunningHub 任务不会因 RunningHub 队列已满而被阻塞
5. `task_queue_maxed` 会被识别为 provider 背压而不是普通最终失败

## 10. healthz 排障字段

Worker `GET /healthz` 当前会同时返回原始 `execution` / `queue` 健康信息，以及更易读的
`scheduling.runninghub` 摘要。

联调时优先关注以下字段：

1. `scheduling.runninghub.active`
   表示当前已占用的 RunningHub 本地槽位数
2. `scheduling.runninghub.max`
   表示当前 RunningHub 本地并发上限
3. `scheduling.runninghub.available`
   表示当前剩余可用槽位数
4. `scheduling.runninghub.queued`
   表示当前仍在本地排队等待 RunningHub 槽位的任务数
5. `scheduling.runninghub.lastBackpressureAt`
   表示最近一次收到 `task_queue_maxed` 的时间
6. `scheduling.runninghub.lastBackpressureCode`
   表示最近一次背压对应的 provider 错误码，正常应为 `task_queue_maxed`
7. `scheduling.runninghub.lastDispatchKickAt`
   表示最近一次触发补位调度的时间

如需看更细的内部排障信息，可继续查看：

1. `queue.lastProviderSkippedCount`
   表示最近一轮扫描中，有多少任务因 provider 无槽位被跳过
2. `queue.lastProviderSlotSkippedTaskId`
3. `queue.lastProviderSlotSkippedTaskNo`
4. `queue.lastProviderSlotSkippedProvider`
5. `queue.lastProviderSlotSkippedAt`
6. `queue.lastProviderBackpressure`
   记录最近一次 provider 背压对应的任务、错误码、错误消息和发生时间
7. `queue.queuedTaskCountByProvider`
   用于区分当前是 RunningHub 在排队，还是其他 provider 在排队

排障建议：

1. `active = max` 且 `queued > 0`
   说明任务正在本地排队等待槽位，属于正常本地限流
2. `lastBackpressureAt` 有值
   说明最近确实收到了 RunningHub 的 `task_queue_maxed`
3. `queued > 0` 但 `active < max`
   需要继续排查任务输入、claim 失败或其他执行异常，而不是单纯并发不足

## 11. 自动测试与手动压测入口

当前 RunningHub 调度相关回归测试入口包括：

1. `tests/queue.runninghub-concurrency.spec.ts`
   覆盖 10 个 RunningHub 任务最多只会同时 claim 3 个，以及非 RunningHub 不阻塞
2. `tests/queue.runninghub-fifo.spec.ts`
   覆盖按 `createdAt` 补位与同一创建时间下按 `groupOrder` 补位
3. `tests/queue.runninghub-backpressure.spec.ts`
   覆盖 `task_queue_maxed` 重排队、槽位释放与 stop 后不再补位
4. `tests/queue.provider-scheduler.spec.ts`
   覆盖 provider-aware 调度与健康快照
5. `tests/runninghub.task-queue-maxed.spec.ts`
   覆盖背压事件与查询侧可见性

手动压测清单见：

- `tests/manual/runninghub-scheduling-checklist.md`

## 12. 2026-04-07 真实联调结论

2026-04-07 已基于真实 RunningHub API Key 完成一轮混合联调验收，范围包括：

1. `aiImageToPly` 6 个 group
2. `aiMultiViewRestore` 6 个 group
3. 总计 12 个真实 RunningHub 任务

本轮真实联调确认：

1. Worker 侧 RunningHub `active` 峰值为 `3`
2. 超过 3 个任务时，后续任务保持本地 `queued`
3. 日志中持续出现 `Queue skipped task because provider has no available slot`
4. 槽位释放后会立即出现下一条 `Queue acquired provider slot`
5. 实际补位顺序符合 `createdAt + groupOrder`
6. 本轮未观察到 `task_queue_maxed`
7. `scheduling.runninghub.lastBackpressureCode` 最终为 `null`

本轮真实联调结论：

- RunningHub 本地调度逻辑已通过真实验收，具备发布条件

详细验收记录见：

- `backend/docs/RUNNINGHUB-SCHEDULING-ACCEPTANCE.md`
