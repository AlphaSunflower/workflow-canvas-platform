# RunningHub 本地调度真实联调验收

## 1. 文档目的

本文档记录 2026-04-07 基于真实 RunningHub API Key 的本地调度验收结论，用于回答：

- RunningHub 本地 3 并发限制是否真实生效
- 超过 3 个任务时是否在后端本地排队
- 槽位释放后是否按 `createdAt + groupOrder` 补位
- 是否仍因本地超发触发 `task_queue_maxed`
- 当前调度逻辑是否具备发布条件

## 2. 联调环境

- 配置文件：`backend/config/backend.config.json`
- RunningHub `apiBaseUrl`：`https://www.runninghub.cn`
- RunningHub `maxConcurrency`：`3`
- API：`http://127.0.0.1:3100`
- Worker：`http://127.0.0.1:3200`
- Worker `/healthz` 已启用 `queue` 与 `scheduling.runninghub` 摘要字段

## 3. 本次真实联调范围

本次验收使用真实后端执行，直接创建两条 RunningHub run：

1. `aiImageToPly`
   - `runNo = RUN-20260407-000033`
   - `runId = 32a0f32c-8f64-4612-ada7-326c0d769f9c`
   - 共 6 个 group
2. `aiMultiViewRestore`
   - `runNo = RUN-20260407-000034`
   - `runId = 329a3325-99b9-4fed-80a2-58e2f102262d`
   - 共 6 个 group

总计真实 RunningHub 任务数：`12`

## 4. 真实联调结果

### 4.1 本地 3 并发限制已真实生效

本次联调中，Worker 日志中出现的 RunningHub `active` 峰值为 `3`，未出现 `4` 或更高值。

对应证据：

- `backend/data/acceptance/runninghub-scheduling-backend.out.log`
- Worker `/healthz`
- 日志中多次出现：
  - `Queue acquired provider slot`
  - `providerConcurrency.active = 3`
  - `Queue skipped task because provider has no available slot`

结论：

- 真实 RunningHub 联调中，本地调度确实把并发限制在 `3`

### 4.2 超过 3 个任务时会留在本地 queued

首批启动顺序如下：

1. `TASK-20260407-000122`
2. `TASK-20260407-000123`
3. `TASK-20260407-000124`

其余 `TASK-20260407-000125` 到 `TASK-20260407-000133` 在前 3 个任务执行期间持续被本地跳过，日志中反复记录：

- `Queue skipped task because provider has no available slot`

结论：

- 第 4 个及后续 RunningHub 任务没有直接打到 RunningHub，而是保持本地排队

### 4.3 FIFO 补位按 createdAt + groupOrder 生效

两条 run 的创建时间如下：

1. `RUN-20260407-000033` 创建于 `2026-04-07T07:04:44.179Z`
2. `RUN-20260407-000034` 创建于 `2026-04-07T07:04:44.426Z`

实际启动顺序如下：

1. `TASK-20260407-000122` `ply-group-1`
2. `TASK-20260407-000123` `ply-group-2`
3. `TASK-20260407-000124` `ply-group-3`
4. `TASK-20260407-000125` `ply-group-4`
5. `TASK-20260407-000126` `ply-group-5`
6. `TASK-20260407-000127` `ply-group-6`
7. `TASK-20260407-000128` `mvr-group-1`
8. `TASK-20260407-000129` `mvr-group-2`
9. `TASK-20260407-000130` `mvr-group-3`
10. `TASK-20260407-000131` `mvr-group-4`
11. `TASK-20260407-000132` `mvr-group-5`
12. `TASK-20260407-000133` `mvr-group-6`

结论：

- 较早创建的 `aiImageToPly` run 先被完整消化
- 同一 run 内按 `groupOrder` 顺序补位
- 之后才开始补位较晚创建的 `aiMultiViewRestore`

### 4.4 槽位释放后可即时补位

日志中存在多次完整链路：

1. `Queue completed task`
2. `Queue released provider slot`
3. 紧接着出现下一条：
   - `Queue acquired provider slot`
   - `Queue claimed task`

例如：

- `TASK-20260407-000130` 完成后，立即补位 `TASK-20260407-000131`
- `TASK-20260407-000129` 完成后，立即补位 `TASK-20260407-000132`
- `TASK-20260407-000128` 完成后，立即补位 `TASK-20260407-000133`

结论：

- 补位不是固定等待下一个长轮询周期，而是能即时触发

### 4.5 本次真实联调未观察到 task_queue_maxed

本次联调中：

- Worker `/healthz` 最终 `scheduling.runninghub.lastBackpressureCode = null`
- 日志中未检索到 `task_queue_maxed`
- 日志中未出现 `Queue encountered provider backpressure`

结论：

- 本轮 12 个真实 RunningHub 任务没有因本地超发触发 `task_queue_maxed`

## 5. 前端可见运行态结论

本次真实联调对应的任务查询与事件流已验证前端所需状态字段可见：

- `task_queued`
- `task_started`
- `task_progress`
- `task_retry_scheduled`
- `task_retry_started`
- `task_failed`
- `task_completed`
- `step_final_started`
- `step_final_completed`
- `task_artifact_received`

结论：

- 前端可以基于统一查询接口展示 `queued / processing / completed / failed`

## 6. 本次联调中观察到的非调度问题

本次 12 个真实任务里：

- `aiMultiViewRestore`：`6/6` 完成
- `aiImageToPly`：`4/6` 完成，`2/6` 失败

失败样本：

1. `TASK-20260407-000124`
   - `lastErrorCode = UNKNOWN_ERROR`
   - `lastErrorMessage = terminated`
2. `TASK-20260407-000127`
   - `lastErrorCode = PROVIDER_ERROR`
   - `lastErrorMessage = RunningHub 任务执行失败。`
   - 经 3 次尝试后最终失败

这两条失败都发生在节点业务执行链路中，不是本地调度超发导致的 `task_queue_maxed`。

## 7. 验收结论

### 7.1 对 RunningHub 本地调度逻辑的结论

本次真实联调可以明确签收：

1. 任意时刻 RunningHub 本地 active 不超过 `3`
2. 超过 `3` 个任务时后端会稳定留在本地 `queued`
3. 槽位释放后会按 `createdAt + groupOrder` FIFO 补位
4. 本轮真实联调未再因本地超发触发 `task_queue_maxed`

结论：

- `RunningHub 本地调度逻辑具备发布条件`

### 7.2 对两个 RunningHub 节点整体发布的结论

虽然调度逻辑本身已通过真实验收，但两个业务节点整体发布结论需区分：

1. `aiMultiViewRestore`
   - 本轮 `6/6` 成功
   - 在本次样本下未观察到阻塞发布的问题
2. `aiImageToPly`
   - 本轮仍有 `2/6` 真实失败
   - 当前不能仅凭本次结果判断“节点整体已稳定可发布”

结论：

- `RunningHub 调度层已可发布`
- `aiImageToPly` 节点整体是否发布，仍需继续排查真实失败样本

## 8. 本次联调留档

建议保留以下证据文件：

- `backend/data/acceptance/runninghub-scheduling-backend.out.log`
- `RUN-20260407-000033`
- `RUN-20260407-000034`
- 失败任务事件：
  - `TASK-20260407-000124`
  - `TASK-20260407-000127`
