# 多视角修复节点设计

## 1. 文档目的

本文档用于冻结 `aiMultiViewRestore` 节点第一版的真实后端执行边界，覆盖：

- 节点协议
- RunningHub 接口边界
- 输入输出规则
- 成功失败判定
- 一期不做项

如与更早讨论记录冲突，以本文档为准。

## 2. 一期目标

多视角修复节点第一版的唯一目标是：

- 让前端 `aiMultiViewRestore` 节点能够通过后端真实调用 RunningHub 工作流
- 每个 group 固定接收 2 张图片输入：
  - 1 张渲染图
  - 1 张原视角参考图
- 每个 group 固定产出 1 张结果图片
- 结果进入当前统一的 run / task / file / event / retry 体系

当前固定配置如下：

- 节点类型：`aiMultiViewRestore`
- 任务类型：`multi-view-restore`
- 执行模式：`legacy-grouped-task`
- Provider：`runninghub`
- 工作流编号：`2014516111097729025`
- 模板 key：`multi-view-restore-v1`
- 模板文件：`backend/runninghub/multi-view-restore_api.json`

## 3. 工作流映射

当前 RunningHub 工作流映射关系固定为：

- 渲染图输入节点：`124`
- 渲染图输入字段：`image`
- 原视角参考图输入节点：`102`
- 原视角参考图输入字段：`image`
- 输出目标优先节点：`127`
- 一期输出文件类型：`image`

说明：

- 一期按“双输入、单输出、单结果图”工作流处理
- 一期结果提取优先以输出节点 `127` 为目标
- 若后续工作流演化为多输出节点，必须补充结果定位规则后再扩展
- 正式运行只允许读取 `backend/runninghub/multi-view-restore_api.json`
- 不再依赖 `backend/` 外的 RunningHub 工作流文件

## 4. RunningHub 接口边界

### 4.1 文件上传接口

两个输入图片都必须先上传至 RunningHub。

固定规则：

1. 后端先从本地文件资产系统分别读取渲染图与原视角参考图
2. 分别调用 RunningHub 上传接口
3. 分别从上传返回中提取 `data.fileName`
4. 将渲染图上传结果写入工作流节点 `124.image`
5. 将原视角参考图上传结果写入工作流节点 `102.image`

当前模板来源固定为：

- `backend/runninghub/multi-view-restore_api.json`
- 模板 key：`multi-view-restore-v1`

### 4.2 高级工作流创建接口

任务创建固定使用 RunningHub 高级工作流创建接口。

固定请求要点：

- 传入 `apiKey`
- 传入 `workflowId = 2014516111097729025`
- 传入双输入 `nodeInfoList`

固定创建返回解析字段：

- `taskId`
- `taskStatus`
- `clientId`
- `promptTips`

### 4.3 查询任务结果 V2 接口

一期主轮询接口固定为 RunningHub 查询任务结果 V2 接口。

固定解析字段：

- `status`
- `errorCode`
- `errorMessage`
- `results`
- `clientId`
- `promptTips`

当前主轮询策略：

- 不接 webhook
- 不接 `netWssUrl`
- 不以状态查询接口作为主闭环依据
- 统一由 Worker 主动轮询结果 V2 接口

### 4.4 状态查询接口

RunningHub 状态查询接口当前仅作为辅助诊断接口保留，不作为一期主执行链路依赖。

## 5. 输入输出规则

### 5.1 group 输入

每个 group 固定包含：

- `groupId`
- `renderFileId`
- `referenceFileId`

一期规则：

- 每个 group 必须且只能有 1 张渲染图
- 每个 group 必须且只能有 1 张原视角参考图
- 所有输入文件都必须指向已上传完成的后端图片文件

### 5.2 group 输出

每个 group 固定输出：

- 1 张结果图片

结果落地要求：

- 必须下载到后端本地存储
- 必须登记为统一文件资产
- 必须生成后端 `resultFileId`

## 6. 执行链路

单个 group 的固定执行链路为：

1. 读取 `renderFileId`
2. 读取 `referenceFileId`
3. 上传渲染图到 RunningHub
4. 上传原视角参考图到 RunningHub
5. 构造双输入 `nodeInfoList`
6. 调用 RunningHub 高级工作流创建接口
7. 解析 `taskId / taskStatus / clientId / promptTips`
8. 校验 `promptTips`
9. 轮询 RunningHub 查询任务结果 V2 接口
10. 优先匹配输出节点 `127` 的结果图
11. 下载结果图片
12. 保存结果图片并回填 `resultFileId`

## 7. promptTips 规则

创建任务成功后，后端必须对 `promptTips` 做宽松解析，并同时保留原始字符串。

建议解析字段：

- `result`
- `error`
- `outputs_to_execute`
- `node_errors`

一期固定处理规则：

- `result = false`：直接判定创建失败
- `error` 非空：直接判定创建失败
- `node_errors` 非空：直接判定创建失败
- `promptTips` 无法解析：不立即失败，但必须记录快照

## 8. 成功与失败判定

### 8.1 成功判定

当且仅当同时满足以下条件时，单个 group 视为成功：

1. RunningHub 结果查询返回成功终态
2. 能拿到目标结果图 URL
3. 结果图下载成功
4. 后端文件落库成功
5. `resultFileId` 成功写回任务记录

### 8.2 失败判定

以下任一情况发生时，单个 group 视为失败：

- 渲染图上传 RunningHub 失败
- 原视角参考图上传 RunningHub 失败
- RunningHub 创建任务失败
- `promptTips` 明确报错
- 结果查询失败
- 结果终态为失败
- 查询返回结果为空
- 未匹配到目标输出节点结果
- 文件下载失败
- 文件保存失败

## 9. 重试规则

当前固定重试策略：

- 自动重试 2 次
- 总尝试次数 3 次

重试触发条件：

- Provider 调用失败
- 查询结果失败
- 下载失败
- 文件保存失败

不建议自动重试的场景：

- `promptTips` 明确表明工作流配置错误
- 查询结果明确与输出节点约定不匹配

## 10. 一期不做项

当前明确不做：

- webhook 回调接入
- `netWssUrl` 接入
- 多输出节点工作流
- RunningHub 多工作流切换
- 节点复杂参数开放
- 节点专属轮询体系
- 针对多视角修复节点单独设计另一套任务体系

## 11. 文档状态

本文档为 `aiMultiViewRestore` 节点第一版正式边界文档。

只要该节点仍处于一期范围内，开发应严格以本文档为准。

## 12. 创建接口当前实现补充

当前 `POST /api/v1/executions` 已接入 `aiMultiViewRestore` 的创建校验与入库映射，固定规则如下：

1. `nodeType` 必须为 `aiMultiViewRestore`
2. `taskType` 必须为 `multi-view-restore`
3. `executionMode` 必须为 `legacy-grouped-task`
4. `groups` 至少 1 组
5. 每个 group 必须同时提供 `renderFileId` 与 `referenceFileId`
6. 所有输入 fileId 都必须在后端文件系统中存在且状态为 `ready`
7. 同组渲染图与原视角参考图不能为同一文件

当前每条 `ExecutionTask.input` 固定写入以下字段：

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

其中固定值来源统一引用共享常量文件：

- `backend/shared/src/constants/aiMultiViewRestore.ts`

## 13. Worker 当前实现补充

当前 Worker 已实现 `aiMultiViewRestore` 专用执行器，执行顺序固定如下：

1. 读取 `renderFileId`
2. 读取 `referenceFileId`
3. 分别上传两张输入图到 RunningHub
4. 基于模板服务生成双输入 `nodeInfoList`
5. 创建 RunningHub 工作流任务
6. 轮询结果查询 V2 接口
7. 优先提取 `nodeId = 127` 的结果图
8. 若未命中 `127` 且仅返回 1 个结果，则回退取唯一结果并保留快照
9. 下载结果图并按图片资产落库
10. 回填 `resultFileId`

## 14. 事件与查询回显补充

当前 `aiMultiViewRestore` 已接入统一任务事件流、重试策略与查询回显，固定约束如下：

1. 统一使用 `final` 步骤
2. 统一记录 `step_final_started / step_final_completed`
3. 执行阶段会记录以下 `task_progress` 消息：
   - 渲染图上传开始与完成
   - 参考图上传开始与完成
   - 双输入 `nodeInfoList` 生成完成
   - RunningHub 工作流创建完成
   - 结果轮询中
   - 结果下载与保存中
4. 收到结果图地址后会记录 `task_artifact_received`
5. 失败重试统一沿用全局策略：最多 3 次尝试，总重试 2 次
6. 重试阶段统一记录：
   - `task_retry_scheduled`
   - `task_retry_started`
   - `task_failed`
   - `task_completed`

执行详情查询、任务详情查询当前至少会回显：

- `renderFileId`
- `referenceFileId`
- `workflowId`
- `workflowTemplateKey`
- `providerTaskId`
- `providerClientId`
- `resultFileId`
- `resultFile`
- `renderFile`
- `referenceFile`

## 15. 联调样例与验收入口

当前多视角修复节点已补齐以下内部联调样例：

1. `backend/docs/examples/runninghub-multi-view-restore-node-info-list.json`
2. `backend/docs/examples/runninghub-multi-view-restore-create-success.json`
3. `backend/docs/examples/runninghub-multi-view-restore-query-success.json`
4. `backend/docs/examples/runninghub-multi-view-restore-failed-response.json`

这些样例用于说明：

1. 双输入 `nodeInfoList` 如何映射到 `124.image` 与 `102.image`
2. RunningHub 创建成功响应的最小关键字段
3. 查询结果中优先命中 `nodeId = 127` 的提取规则
4. 失败响应与排障入口

一期验收与人工联调入口如下：

1. `backend/docs/AI-MULTI-VIEW-RESTORE-ACCEPTANCE.md`
2. `backend/tests/manual/ai-multi-view-restore-checklist.md`
## RunningHub 本地调度补充

`aiMultiViewRestore` 属于 RunningHub 类任务，其本地并发上限、排队顺序、即时补位规则与 `task_queue_maxed` 背压处理统一以 `backend/docs/RUNNINGHUB-SCHEDULING.md` 为准。

## 16. 2026-04-07 真实混合调度联调补充

2026-04-07 已在真实 RunningHub Key 下，把 `aiMultiViewRestore` 与 `aiImageToPly` 混合提交到同一 Worker 进行联调。

本轮和 `aiMultiViewRestore` 相关的真实结果如下：

1. `RUN-20260407-000034`
2. 共 6 个 `aiMultiViewRestore` group
3. 由于较早创建的 `aiImageToPly` run 先占满 3 个槽位，`aiMultiViewRestore` 首批 group 在本地 `queued`
4. 待较早 run 释放槽位后，`mvr-group-1 ~ mvr-group-6` 按 `groupOrder` 顺序依次补位

本轮真实结果统计：

1. 成功 `6`
2. 失败 `0`

本轮还确认：

1. 多视角修复节点在真实 RunningHub 混合负载下可正常排队
2. 查询事件流可完整回显：
   - `task_queued`
   - `task_started`
   - `task_progress`
   - `task_artifact_received`
   - `step_final_completed`
   - `task_completed`
3. 结果图优先命中 `nodeId = 127`
4. 未观察到因本地超发导致的 `task_queue_maxed`

详细联调结论见：

- `backend/docs/RUNNINGHUB-SCHEDULING-ACCEPTANCE.md`
