# RunningHub 调度手动压测清单

## 1. 目的

用于人工验证 RunningHub 本地调度是否满足以下规则：

- 同一 API Key 最多 3 并发
- 超额任务留在本地 `queued`
- 按 `createdAt + groupOrder` FIFO 补位
- `task_queue_maxed` 会重排队而不是最终失败
- 非 RunningHub 任务不被 RunningHub 排队阻塞

## 2. 前置条件

- 已在 `backend/config/backend.config.json` 中填写真实 `providers.runninghub.apiKey`
- 已确认 `providers.runninghub.maxConcurrency = 3`
- API 与 Worker 已正常启动
- 前端或脚本可一次性发起多组 RunningHub 任务
- 可访问 Worker `GET /healthz`
- 可查看 Worker 控制台日志

## 3. 基础并发验证

1. 一次性创建 10 个 RunningHub group 任务
2. 立即查看 Worker `/healthz`
3. 记录 `scheduling.runninghub.active / max / available / queued`
4. 预期：
   - `active = 3`
   - `max = 3`
   - `available = 0`
   - `queued >= 7`
5. 查看 Worker 日志，确认出现：
   - `Queue acquired provider slot`
   - `Queue skipped task because provider has no available slot`

## 4. FIFO 补位验证

1. 在基础并发验证后，等待最早创建的一组任务先完成
2. 查看 `/healthz` 与查询接口，确认只有最早的 queued 任务被补位
3. 若同一次创建中有多个 group，确认低 `groupOrder` 的任务先被补位
4. 预期：
   - 不会跳过更早创建的 queued 任务
   - 同批 group 会按 group 顺序推进

## 5. 非 RunningHub 不阻塞验证

1. 在 RunningHub 已经满 3 并发且仍有本地 queued 时
2. 再创建一个非 RunningHub 任务
3. 预期：
   - 非 RunningHub 任务可进入 `processing`
   - 不会因为 RunningHub 没槽位而一直停在 `queued`

## 6. 背压重排队验证

1. 在 RunningHub 被外部系统占满或可稳定复现 `task_queue_maxed` 的条件下发起任务
2. 查看 Worker 日志，确认出现：
   - `Queue encountered provider backpressure`
   - `Queue requeued task due to provider backpressure`
3. 查看查询接口或事件流，确认存在 `task_retry_scheduled`
4. 查看 `/healthz`，确认：
   - `lastBackpressureAt` 有值
   - `lastBackpressureCode = task_queue_maxed`
5. 预期：
   - 任务重新回到 `queued`
   - 不直接进入最终 `failed`
   - RunningHub 本地槽位被释放

## 7. 槽位释放验证

分别覆盖以下场景：

1. 任务成功完成
2. 任务普通失败
3. 任务执行器内部异常 throw

每种场景都检查：

- `providerConcurrency.providers.runninghub.active` 最终回到正确值
- `available` 会恢复
- 后续 queued 任务可以继续补位

## 8. stop 验证

1. Worker 正在处理 RunningHub 队列时主动停止 Worker
2. 停止后继续等待一个轮询周期以上
3. 预期：
   - 不再继续补位新的 queued 任务
   - 不再继续收到新的 dispatch kick 驱动补位

## 9. 结果记录

每次联调建议至少记录：

- 测试时间
- API Key 使用情况
- 创建任务数
- `/healthz` 截图或 JSON 片段
- Worker 日志关键行
- 是否出现 `task_queue_maxed`
- 是否满足 3 并发限制
- 是否满足 FIFO
- 是否存在异常现象与复现步骤
