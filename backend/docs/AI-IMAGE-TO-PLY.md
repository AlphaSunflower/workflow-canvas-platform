# 图片转模型节点设计

## 1. 文档目的

本文档用于冻结 `aiImageToPly` 节点第一版的真实后端执行边界，覆盖：

- 节点协议
- RunningHub 接口边界
- 输入输出规则
- 成功失败判定
- 一期不做项

如与更早讨论记录冲突，以本文档为准。

## 2. 一期目标

图片转模型节点第一版的唯一目标是：

- 让前端 `aiImageToPly` 节点能够通过后端真实调用 RunningHub 工作流
- 每个 group 接收 1 张图片
- 每个 group 产出 1 个 `ply` 模型文件
- 结果进入当前统一的 run / task / file / event / retry 体系

当前固定配置如下：

- 节点类型：`aiImageToPly`
- 任务类型：`image-to-ply`
- 执行模式：`legacy-grouped-task`
- Provider：`runninghub`
- 工作流编号：`2014519004714508290`
- 模板 key：`sharp-image-to-ply-v1`
- 模板文件：`backend/runninghub/sharp_api.json`

## 3. 工作流映射

当前工作流模板对应关系固定为：

- 输入节点：工作流节点 `1`
- 输入字段：`image`
- 输出目标：当前工作流主输出
- 一期输出文件类型：`ply`

说明：

- 一期按“单输入、单输出、单结果文件”工作流处理
- 一期默认 RunningHub 查询结果仅取主结果
- 若后续工作流演化为多输出节点，必须补充结果定位规则后再扩展
- 正式运行只允许读取 `backend/runninghub/sharp_api.json`
- 不再依赖 `backend/` 外的 RunningHub 工作流文件

## 4. RunningHub 接口边界

### 4.1 文件上传接口

输入图片必须先上传至 RunningHub。

固定规则：

1. 后端先从本地文件资产系统读取输入图片
2. 调用 RunningHub 上传接口
3. 从上传返回中提取 `data.fileName`
4. 将该值写入工作流输入节点 `1.image`

当前模板来源固定为：

- `backend/runninghub/sharp_api.json`
- 模板 key：`sharp-image-to-ply-v1`

### 4.2 高级工作流创建接口

任务创建固定使用 RunningHub 高级工作流创建接口。

固定请求要点：

- 传入 `apiKey`
- 传入 `workflowId = 2014519004714508290`
- 传入 `nodeInfoList`

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
- `sourceFileId`

一期规则：

- 每个 group 必须且只能有 1 个输入图片
- 所有 `sourceFileId` 必须指向已上传完成的后端图片文件

### 5.2 group 输出

每个 group 固定输出：

- 1 个 `ply` 模型文件

结果落地要求：

- 必须下载到后端本地存储
- 必须登记为统一文件资产
- 必须生成后端 `resultFileId`

## 6. 执行链路

单个 group 的固定执行链路为：

1. 读取 `sourceFileId`
2. 上传输入图片到 RunningHub
3. 获取上传返回 `fileName`
4. 构造 `nodeInfoList`
5. 调用 RunningHub 高级工作流创建接口
6. 解析 `taskId / taskStatus / clientId / promptTips`
7. 校验 `promptTips`
8. 轮询 RunningHub 查询任务结果 V2 接口
9. 查询成功后取得主结果文件 URL
10. 校验结果文件类型为 `ply`
11. 下载结果文件
12. 保存结果文件并回填 `resultFileId`

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
2. 能拿到结果文件 URL
3. 结果文件类型为 `ply`
4. 模型文件下载成功
5. 后端文件落库成功
6. `resultFileId` 成功写回任务记录

### 8.2 失败判定

以下任一情况发生时，单个 group 视为失败：

- 输入图片上传 RunningHub 失败
- RunningHub 创建任务失败
- `promptTips` 明确报错
- 结果查询失败
- 结果终态为失败
- 查询返回结果为空
- 查询结果文件类型不是 `ply`
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
- 查询结果明确返回非 `ply`

## 10. 一期不做项

当前明确不做：

- webhook 回调接入
- `netWssUrl` 接入
- 多输出节点工作流
- 多格式模型输出切换
- 节点参数开放
- RunningHub 多工作流切换
- provider 上传缓存复用
- 针对图片转模型节点单独设计另一套任务体系

## 11. 文档状态

本文档为 `aiImageToPly` 节点第一版正式边界文档。

只要该节点仍处于一期范围内，开发应严格以本文档为准。

## 12. 创建接口当前实现补充

当前 `POST /api/v1/executions` 已接入 `aiImageToPly` 的创建校验与入库映射，固定规则如下：

1. `nodeType` 必须为 `aiImageToPly`
2. `taskType` 必须为 `image-to-ply`
3. `executionMode` 必须为 `legacy-grouped-task`
4. `groups` 至少 1 组
5. 每个 group 必须提供且仅提供 1 个 `sourceFileId`
6. 所有 `sourceFileId` 必须在后端文件系统中存在且状态为 `ready`

当前每条 `ExecutionTask.input` 固定写入以下字段：

- `inputFileId`
- `sourceFileId`
- `workflowId`
- `workflowTemplateKey`
- `workflowInputNodeId`
- `workflowInputFieldName`
- `outputFileType`

其中固定值来源统一引用共享常量文件：

- `backend/shared/src/constants/aiImageToPly.ts`

## 13. RunningHub 客户端当前实现补充

当前 Worker 已新增独立 RunningHub provider 客户端，路径如下：

- `backend/worker/src/modules/providers/runninghub/runninghub.client.ts`
- `backend/worker/src/modules/providers/runninghub/runninghub.parser.ts`
- `backend/worker/src/modules/providers/runninghub/runninghub.errors.ts`
- `backend/worker/src/modules/providers/runninghub/runninghub.types.ts`

当前已封装的接口能力：

1. 文件上传接口
2. 高级工作流任务创建接口
3. 查询任务结果 V2 接口
4. 查询任务状态接口

当前固定封装规则：

1. 鉴权统一使用 `Authorization: Bearer <apiKey>`
2. 上传接口额外透传 `apiKey`
3. 创建接口请求体固定包含 `apiKey / workflowId / nodeInfoList`
4. 状态查询请求体固定包含 `apiKey / taskId`
5. 结果查询 V2 当前固定按 `taskId` 查询
6. 每次请求都会落原始请求/响应快照到 `providerSnapshotDir`

## 14. 工作流模板映射当前实现补充

当前 Worker 已新增 RunningHub 工作流模板服务：

- `backend/worker/src/modules/providers/runninghub/runninghub-workflow-template.service.ts`
- `backend/worker/src/modules/providers/runninghub/runninghub-workflow-template.types.ts`

当前固定模板装配规则：

1. 默认模板 key 为 `sharp-image-to-ply-v1`
2. 默认模板文件为 `backend/runninghub/sharp_api.json`
3. 固定校验输入节点 `1` 存在
4. 固定校验节点 `1.inputs.image` 存在
5. 构造 `nodeInfoList` 时仅写入一项：
   - `nodeId = 1`
   - `fieldName = image`
   - `fieldValue = RunningHub 上传返回 fileName`

当前每次构造完成后，都会将 `nodeInfoList` 快照保存到 `providerSnapshotDir`，用于联调排障与样例补齐。

## 15. promptTips 校验当前实现补充

当前 RunningHub 创建返回中的 `promptTips` 已在创建后第一时间做解析与早失败校验。

当前处理规则如下：

1. 优先保留原始 `promptTips` 字符串
2. 尝试宽松解析 `promptTips` JSON
3. 解析成功时提取：
   - `result`
   - `error`
   - `outputs_to_execute`
   - `node_errors`
4. 当 `result = false` 时，立即判定为 provider 创建失败
5. 当 `error` 非空时，立即判定为 provider 创建失败
6. 当 `node_errors` 非空时，立即判定为 provider 创建失败
7. 当 `promptTips` 非法 JSON 时，不会导致解析器崩溃，但会保留原文与 `invalid_json` 解析状态

当前保留字段包括：

- `taskId`
- `clientId`
- `taskStatus`
- `promptTips`
- `promptTipsSummary`

## 16. 图片转模型执行器当前实现补充

当前 Worker 已新增 `AIImageToPlyTaskExecutor`：

- `backend/worker/src/modules/executors/ai-image-to-ply.executor.ts`
- `backend/worker/src/modules/executors/ai-image-to-ply.types.ts`

当前单个 group 的执行流程为：

1. 读取后端输入图片文件
2. 上传图片到 RunningHub
3. 基于模板服务生成 `nodeInfoList`
4. 调用 RunningHub 高级工作流创建接口
5. 校验创建返回与 `promptTips`
6. 查询 RunningHub 结果 V2
7. 提取首个结果文件
8. 校验结果 URL 存在
9. 校验结果类型为 `ply`
10. 下载模型文件
11. 保存模型文件到后端存储
12. 注册结果文件并回填 `resultFileId`

当前执行器已接入统一执行器注册表，运行时会记录步骤事件、产物接收事件与结果落库事件。

## 17. 图片转模型执行器轮询规则补充

当前 `AIImageToPlyTaskExecutor` 已补齐 RunningHub 结果轮询闭环，当前固定规则如下：

1. 创建任务成功后，Worker 会按固定轮询间隔持续调用 RunningHub 结果查询 V2 接口
2. 查询结果 V2 当前兼容两类返回结构：
   - 包裹结构：`code / msg / data`
   - 平铺结构：`taskId / status / results`
3. 查询返回中的 `taskStatus` 与 `status` 会被统一识别为 provider 任务状态
4. 只要返回中出现有效 `results`，即进入结果文件 URL、类型、下载与落库链路
5. 当 provider 状态明确为失败或取消时，执行器立即判定本次尝试失败
6. 当 provider 返回成功状态但结果文件 URL 缺失时，判定为结果协议异常
7. 当返回结果文件类型不是 `ply` 时，判定为非重试型失败
8. 当下载结果文件失败时，判定为可重试失败
9. 当超过最大轮询次数仍未拿到结果文件时，判定为轮询超时失败
10. 轮询过程中会持续写入 `task_progress` 事件，供查询接口与前端展示当前进度
## 18. 图片转模型节点事件与查询回显补充

当前 `aiImageToPly` 节点已完整接入统一任务事件流、自动重试与执行详情查询，当前规则如下：

1. 队列层统一负责 `task_queued`、`task_started`、`task_retry_scheduled`、`task_retry_started`、`task_failed`、`task_completed`
2. 图片转模型执行器统一使用 `final` 步骤
3. 执行器会补充记录以下阶段消息：
   - 上传开始
   - 上传完成
   - RunningHub 创建开始
   - RunningHub 创建完成
   - 结果轮询中
   - 结果下载与保存中
   - `task_artifact_received`
   - `step_final_started`
   - `step_final_completed`
4. 查询接口当前会为 `aiImageToPly` 任务回显以下字段：
   - `sourceFileId`
   - `workflowId`
   - `workflowTemplateKey`
   - `providerTaskId`
   - `providerClientId`
   - `resultFileId`
   - `resultFile`
5. `providerTaskId / providerClientId` 当前从最近一条包含 provider 标识的任务事件 payload 中提取
6. 前端可直接基于统一查询接口显示运行进度、当前 attempt、失败原因与最终模型文件
## 19. Worker 总装配与端到端闭环补充

当前 `aiImageToPly` 节点已经接入 Worker 默认执行装配，当前闭环如下：

1. API 创建 `aiImageToPly` 任务后，任务进入统一队列
2. Worker 默认执行器注册表已包含 `AIImageToPlyTaskExecutor`
3. Worker 轮询会自动消费 `aiImageToPly` 任务并执行 RunningHub 上传、创建、轮询、下载、落库全流程
4. grouped 多任务会按统一队列策略并发认领与执行
5. 单个 group 失败不会阻断其他 group 继续执行
6. 任务成功后会写回 `ply` 结果文件并更新 run 汇总状态
7. 任务失败后会写入最终失败原因，并按统一重试策略决定是否继续尝试

## 20. RunningHub 联调样例补充

当前内部样例文件如下：

1. `backend/docs/examples/runninghub-upload-success.json`
2. `backend/docs/examples/runninghub-create-success.json`
3. `backend/docs/examples/runninghub-query-v2-success.json`
4. `backend/docs/examples/runninghub-failed-response.json`

当前样例来源说明：

1. 上传成功样例基于 `backend/tests/providers.runninghub.spec.ts` 整理
2. 创建成功样例主体字段基于已确认的真实返回并完成脱敏
3. 查询结果 V2 成功样例基于 `backend/tests/providers.runninghub.spec.ts` 与 `backend/tests/ai-image-to-ply.executor.spec.ts` 整理
4. 失败样例当前基于 `promptTips.error` 场景整理，属于内部可复现实例，不代表官方文档穷尽了所有失败返回

补充说明：

1. 用户曾提供过一份 `TASK_END` webhook 结构，该结构不是本期主链路返回
2. 一期主链路只依赖上传接口、创建接口、查询结果 V2 接口与状态查询接口
3. webhook 与 `netWssUrl` 当前仅保留为后续扩展参考，不进入本期执行闭环

## 21. RunningHub 返回解析补充

### 21.1 上传成功样例关键字段

上传成功返回当前至少要求：

1. `code = 0`
2. `msg = success`
3. `data.fileName` 为非空字符串

若 `data.fileName` 缺失，当前实现直接判定为 `INVALID_RESPONSE`。

### 21.2 创建成功样例关键字段

创建成功返回当前至少要求：

1. `code = 0`
2. `msg = success`
3. `data.taskId`
4. `data.taskStatus`
5. `data.clientId`
6. `data.promptTips`

其中：

1. `taskId / taskStatus` 是创建阶段强校验字段
2. `clientId` 允许为空，但若存在会进入后续事件与查询回显
3. `promptTips` 原文必须保留到 provider 快照与任务阶段事件中，便于首次联调排障

### 21.3 查询结果 V2 成功样例关键字段

查询结果 V2 当前兼容两类结构：

1. 包裹结构：`code / msg / data`
2. 平铺结构：根对象直接包含 `taskId / status / results`

当前解析后统一映射以下字段：

1. `taskId`
2. `taskStatus`
3. `clientId`
4. `promptTips`
5. `errorCode`
6. `errorMessage`
7. `results`

## 22. promptTips 解析与早失败结论

当前 `promptTips` 解析目标字段固定为：

1. `result`
2. `error`
3. `outputs_to_execute`
4. `node_errors`

当前实现结论如下：

1. `result = false` 时，创建阶段立即失败，原始 provider 侧 `providerCode = PROMPT_TIPS_RESULT_FALSE`
2. `error` 非空时，创建阶段立即失败，原始 provider 侧 `providerCode = PROMPT_TIPS_ERROR`
3. `node_errors` 非空时，创建阶段立即失败，原始 provider 侧 `providerCode = PROMPT_TIPS_NODE_ERRORS`
4. `promptTips` 非法 JSON 时，不立即失败，保留 `parseStatus = invalid_json` 与原文

补充说明：

1. `promptTips` 的早失败属于 provider 创建阶段失败，目标是尽早拦截工作流配置错误
2. 这类失败进入统一重试策略时，仍会先经过后端统一错误归一化
3. 联调时应同时查看原始 `providerCode` 与任务最终 `lastErrorCode`

## 23. results[0] 取值约束

一期图片转模型节点当前按单输出处理，只取主结果 `results[0]`。

当前约束如下：

1. `results[0]` 必须存在
2. `results[0].fileUrl` 必须为非空字符串
3. `results[0].fileType` 必须为 `ply`
4. `results[0].nodeId` 当前只用于日志与排障，不作为前端输出路由依据
5. `results[0].taskCostTime` 当前只作为参考字段，不参与成功失败判定

当前实现的失败映射结论：

1. `results[0]` 缺失或 `fileUrl` 缺失，执行器抛出 `RUNNINGHUB_RESULT_FILE_URL_MISSING`，统一归一化为 `INVALID_RESPONSE`
2. `fileType != ply`，执行器抛出 `RUNNINGHUB_RESULT_FILE_TYPE_INVALID`，统一归一化为 `VALIDATION_ERROR`

## 24. ply 输出限制补充

一期当前明确限制如下：

1. 仅支持 `ply` 结果文件
2. 不支持 `obj / glb / fbx` 等其他模型格式
3. 不支持单任务多结果文件输出
4. 不支持多工作流切换
5. 不支持依据 `nodeId` 做多输出路由

若 RunningHub 工作流后续改为多输出或非 `ply` 输出，必须先更新共享常量、执行器校验、查询回显与前端适配器，再进入正式开发。

## 25. 一期联调结论与前端接入说明

当前联调结论：

1. 后端已具备上传、创建、结果轮询、下载、落库、查询回显全链路实现
2. 当前缺少的是官方文档级完整样例，因此本目录下的 RunningHub 样例文件是内部唯一参考
3. 真实联调时应优先沉淀 provider 快照，再回填到 `backend/docs/examples/`

前端节点接入说明：

1. 前端图片转模型节点应继续通过统一 grouped backend runtime 接入
2. 执行前先注册输入文件并拿到 `fileId`
3. 创建执行时只传 `groupId + sourceFileId`
4. 运行中通过统一执行查询接口读取 `providerTaskId / providerClientId / resultFile`
5. 成功后回写的是统一 files 资产中的 `ply` 文件引用

当前已知限制：

1. 前端取消仅停止前端等待与轮询，不会取消 RunningHub 后端任务
2. 一期不接 webhook
3. 一期不接 `netWssUrl`
4. 一期不做多结果输出与多格式模型输出
## RunningHub 本地调度补充

`aiImageToPly` 属于 RunningHub 类任务，其本地并发上限、排队顺序、即时补位规则与 `task_queue_maxed` 背压处理统一以 `backend/docs/RUNNINGHUB-SCHEDULING.md` 为准。

## 26. 2026-04-07 真实混合调度联调补充

2026-04-07 已在真实 RunningHub Key 下，把 `aiImageToPly` 与 `aiMultiViewRestore` 混合提交到同一 Worker 进行联调。

本轮和 `aiImageToPly` 相关的真实结果如下：

1. `RUN-20260407-000033`
2. 共 6 个 `aiImageToPly` group
3. 首批仅 `ply-group-1 ~ ply-group-3` 进入执行
4. `ply-group-4 ~ ply-group-6` 在本地排队，直到前面任务释放槽位后补位
5. 补位顺序符合 `groupOrder`

本轮真实结果统计：

1. 成功 `4`
2. 失败 `2`

失败样本：

1. `TASK-20260407-000124`
   - `lastErrorCode = UNKNOWN_ERROR`
   - `lastErrorMessage = terminated`
2. `TASK-20260407-000127`
   - `lastErrorCode = PROVIDER_ERROR`
   - `lastErrorMessage = RunningHub 任务执行失败。`
   - 已走满 3 次尝试

本轮结论需要区分：

1. 对调度层：
   - `aiImageToPly` 已确认受 RunningHub 本地 3 并发限制保护
   - 未因本地超发触发 `task_queue_maxed`
2. 对节点业务层：
   - 当前仍存在真实失败样本
   - 节点整体稳定性仍需继续排查失败根因

详细联调结论见：

- `backend/docs/RUNNINGHUB-SCHEDULING-ACCEPTANCE.md`
