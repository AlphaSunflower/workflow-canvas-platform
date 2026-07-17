# 领域模型

## 1. 文档目的

本文档定义后端一期的核心业务边界、核心对象和对象之间的关系，作为数据库设计、接口设计、调度设计和后台设计的共同基础。

## 2. 系统定位

当前后端是一个“面向用户的画布执行与资产持久化平台”。

后端一期负责：

- 账户认证与会话管理（MVP）
- 管理员账户管理（MVP）
- Workflow 画布持久化
- 节点执行请求管理
- 外部平台调用
- API Key 池与并发调度
- 输入/输出文件资产管理
- 执行历史、事件、审计

后端一期明确不负责：

- 独立后台前端
- 项目/成员关系
- 多租户隔离
- 复杂 RBAC / ABAC
- 工作流 DAG 编排
- 下游节点自动触发

当前一期真实开发以白模渲染节点为先，命名统一以 `backend/shared/src/constants` 与 `backend/shared/src/types` 中定义为准。

补充说明：

- 当前阶段 `Workflow` 继续作为画布持久化实体
- `projectId` 继续保留，但本轮不扩展复杂项目域
- 前端本地 JSON 导入导出降级为辅助能力，不再是主持久化路径

## 3. 核心业务动作

当前系统最核心的业务动作是：

`用户从前端触发一次节点执行`

这次动作进入后端后，会被正式化为：

1. 一条 workflow 画布保存记录
2. 一条顶层执行记录
3. 一条或多条实际执行任务
4. 若任务失败，则出现多次执行尝试
5. 若任务成功，则生成输出文件资产与任务历史摘要

## 4. 核心实体

### 4.0 画布 Workflow

表示用户在前端编辑的完整画布实体，也是当前阶段后端的画布真源。

最小字段建议：

- `workflow_id`
- `project_id`
- `owner_user_id`
- `title`
- `description`
- `nodes`
- `connections`
- `viewport`
- `metadata`
- `created_at`
- `updated_at`
- `last_run_at`

职责：

- 持久化完整画布节点、连接、视口与元数据
- 承载画布与文件、执行、任务历史之间的聚合关系
- 作为任务历史与文件引用的主查询入口

### 4.1 执行主记录 ExecutionRun

表示一次用户点击执行动作。

它是用户侧历史列表的顶层对象。

最小字段建议：

- `run_id`
- `run_no`
- `user_id`
- `workflow_id`
- `node_type`
- `node_id`
- `node_title`
- `task_type`
  取值统一引用：`model-render-transfer`
- `execution_mode`
  取值统一引用：`legacy-grouped-task`
- `provider`
- `status`
  取值：`queued | processing | completed | failed | cancelled`
- `created_at`
- `started_at`
- `completed_at`
- `request_payload`
- `result_summary`

职责：

- 表示用户发起的一次完整节点执行
- 明确归属于一个 workflow
- 聚合该次执行下的全部任务
- 提供用户历史主视角

### 4.2 执行任务 ExecutionTask

表示一次实际可调度的任务单元。

一条 `ExecutionRun` 可对应：

- 单任务节点：1 条任务
- grouped 节点：多条任务

最小字段建议：

- `task_id`
- `task_no`
- `run_id`
- `user_id`
- `workflow_id`
- `group_id` 可空
- `group_order` 可空
- `node_id`
- `node_type`
- `step_type`
  白模渲染执行步骤统一取值：`lineart | depth | final`
- `provider`
- `model`
- `status`
  取值：`queued | processing | completed | failed | cancelled`
- `current_attempt_no`
- `retry_count`
- `max_retries`
- `created_at`
- `started_at`
- `completed_at`
- `last_error_code`
- `last_error_message`

职责：

- 参与调度
- 占用 API Key 并发资源
- 承载重试逻辑
- 与输入输出文件建立关系
- 形成 task 级历史主记录

### 4.3 任务尝试 TaskAttempt

表示任务的一次真实执行尝试。

为什么需要它：

- 自动重试不能覆盖掉上一次失败信息
- 需要完整记录第 1 次、第 2 次、第 3 次尝试的行为
- 后台需要能查看每次失败发生了什么

最小字段建议：

- `attempt_id`
- `task_id`
- `attempt_no`
- `status`
- `progress`
- `started_at`
- `completed_at`
- `error_code`
- `error_message`
- `provider_request_meta`
- `provider_response_meta`

职责：

- 保存一次尝试的完整执行痕迹
- 为重试与排查提供基础数据

### 4.4 任务事件 TaskEvent

表示任务生命周期中的有序事件流。

最小字段建议：

- `event_id`
- `task_id`
- `attempt_no`
- `event_type`
- `status`
- `progress`
- `message`
- `payload`
- `created_at`

职责：

- 驱动前端实时状态展示
- 驱动后台详情时间线
- 记录重试、错误、取消等关键事件

### 4.5 物理文件 FileBlob

表示去重后的物理文件实体。

设计目的：

- 按内容哈希去重
- 支持跨用户共用同一份物理文件
- 降低重复上传和重复存储成本

最小字段建议：

- `blob_id`
- `sha256`
- `size`
- `storage_key`
- `preview_key`
- `thumbnail_key`
- `created_at`

### 4.6 逻辑文件 FileAsset

表示用户侧可见的逻辑文件资产。

设计目的：

- 不同用户可以有各自独立的 `fileId`
- 物理内容可共用
- 历史和权限归属清晰

最小字段建议：

- `file_id`
- `user_id`
- `blob_id`
- `workflow_bindings`
- `original_name`
- `display_name`
- `mime_type`
- `file_type`
- `source_type`
  取值统一引用：`input | intermediate | output`
- `created_at`

### 4.7 任务文件关系 TaskFileLink

表示任务与文件资产的关联。

最小字段建议：

- `id`
- `task_id`
- `file_id`
- `workflow_id`
- `role`
  取值统一引用：`input | reference | intermediate | output`
- `order_index`
- `source_handle`
- `group_id`

职责：

- 记录文件在任务中的角色
- 记录顺序关系
- 记录 grouped 场景下的归属
- 支撑 workflow 级文件回溯

### 4.7A WorkflowFileBinding

表示 workflow 与 file asset 之间的逻辑绑定关系。

最小字段建议：

- `workflow_id`
- `file_id`
- `owner_user_id`
- `node_ids`
- `usage_count`
- `created_at`
- `updated_at`

职责：

- 表示某个文件当前被哪些节点引用
- 支撑画布保存时只持久化后端文件引用
- 在解绑时只解除关系，不删除物理文件

### 4.8 中间产物 IntermediateArtifact

表示可复用的中间产物记录。

当前一期主要服务白模渲染节点，记录同一白模图对应的：

- 线稿图
- 深度图

最小字段建议：

- `artifact_id`
- `source_blob_id`
- `artifact_type`
  取值统一引用：`lineart | depth`
- `file_id`
- `provider`
- `model`
- `pipeline_version`
- `prompt_version`
- `status`
- `created_at`
- `last_used_at`

职责：

- 支撑中间产物复用
- 通过版本字段避免误复用
- 支撑并发生成中的去重锁

### 4.9 平台 Key ProviderKey

表示外部平台的一个 API Key 配置。

最小字段建议：

- `key_id`
- `provider`
- `encrypted_secret`
- `status`
  取值：`enabled | disabled | circuit_open`
- `max_concurrency`
- `priority`
- `failure_count`
- `created_at`
- `updated_at`

职责：

- 提供平台访问凭据
- 限制并发
- 支撑后台运营管理

### 4.10 Key 租约 ProviderKeyLease

表示某次任务尝试占用了某个 Key 的并发槽位。

最小字段建议：

- `lease_id`
- `key_id`
- `task_id`
- `attempt_no`
- `leased_at`
- `released_at`
- `status`

职责：

- 严格控制每个 Key 的并发数
- 记录资源占用情况
- 支持超时与异常释放

### 4.11 审计日志 AuditLog

表示管理员或系统关键操作日志。

示例：

- 管理员创建用户
- 管理员禁用用户
- 管理员新增 Key
- 管理员启停 Key
- 管理员重置密码

### 4.12 用户 User

表示后端中的真实登录账户。

当前仅定义两类角色：

- `member`
- `admin`

当前仅定义两类状态：

- `enabled`
- `disabled`

最小字段建议：

- `user_id`
- `email`
- `password_hash`
- `display_name`
- `role`
- `status`
- `created_at`
- `updated_at`
- `last_login_at`

职责：

- 作为文件、执行、任务的真实归属主体
- 为认证中间层提供身份来源
- 承载管理员账户管理能力

### 4.13 刷新会话 RefreshSession

表示一个 refresh token 对应的服务端会话记录。

最小字段建议：

- `session_id`
- `user_id`
- `token_hash`
- `status`
  取值：`active | rotated | revoked | expired`
- `issued_at`
- `expires_at`
- `rotated_from_id`
- `revoked_at`
- `revoked_reason`

职责：

- 支撑 refresh token 轮换
- 支撑 logout 注销当前会话
- 支撑禁用用户后拒绝续期

## 5A. Workflow Backendization 规则

### 5A.1 文件进入画布即上传

- 文件被加入画布后立即进入上传调度
- 上传前先做哈希与后端预检
- 已存在 blob 时直接复用，不重复上传

### 5A.2 任务依赖文件优先

- 若执行触发时仍有未上传文件，优先上传当前任务依赖的文件
- 未被当前任务依赖的文件可延后上传

### 5A.3 历史按 workflow 聚合

- `ExecutionRun` 负责一次执行入口
- `ExecutionTask` 负责每条 task 的历史摘要
- `TaskEvent` 负责细粒度事件流
- 前端历史主查询按 `workflow_id` 聚合

## 5. 编号体系

建议保留两级业务编号。

### 5.1 runNo

表示一次用户点击执行的业务编号。

建议格式：

- `RUN-YYYYMMDD-000001`

### 5.2 taskNo

表示一次实际任务的业务编号。

建议格式：

- `TASK-YYYYMMDD-000001`

## 6. 当前统一命名

为避免后续 API、Worker、数据库出现多套命名，一期统一以共享常量为准。

### 6.1 任务类型与执行模式

- 节点类型：`aiModelRenderTransfer`
- 任务类型：`model-render-transfer`
- 执行模式：`legacy-grouped-task`
- 节点类型：`aiImageGen`
- 任务类型：`image-gen`
- 执行模式：`legacy-grouped-task`
- 节点类型：`aiImageHd`
- 任务类型：`image-hd`
- 执行模式：`legacy-grouped-task`
- 节点类型：`aiFloorplanColorize`
- 任务类型：`floorplan-colorize`
- 执行模式：`legacy-grouped-task`

### 6.2 主状态枚举

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

### 6.3 白模渲染步骤枚举

- `lineart`
- `depth`
- `final`

### 6.4 文件来源类型

- `input`
- `intermediate`
- `output`

### 6.5 文件用途类型

- `image`
- `unknown`

### 6.6 任务文件角色

- `input`
- `reference`
- `intermediate`
- `output`

### 6.7 中间产物类型

- `lineart`
- `depth`

## 7. 成功语义

一期成功判定规则已经确认：

- 只要外部平台正常返回产物，且后端成功接收到该产物并落库，就视为任务成功

因此成功必须同时满足：

1. 平台返回了有效产物
2. 后端成功接收该产物
3. 后端成功保存该产物
4. 后端成功生成输出文件资产

## 8. 失败语义

以下情况均不算成功：

- 平台请求超时
- 平台返回错误
- 平台返回结构异常，未得到产物
- 产物下载失败
- 后端保存产物失败

任务是否最终失败，要看自动重试是否已经用尽。

## 9. 重试语义

一期固定规则：

- `max_retries = 2`
- 每条任务最大总尝试次数 = `3`

默认可重试错误：

- 超时
- 网络错误
- 平台瞬时错误
- 返回结构异常但没有产物
- 产物 base64 解码失败
- 产物存储失败

默认不可重试错误：

- 输入校验失败
- 权限或禁止访问
- 用户主动取消

## 10. 状态模型

执行主记录与任务主状态统一使用：

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

重试过程不新增主状态，而是通过：

- `TaskAttempt`
- `TaskEvent`
- `current_attempt_no`
- `retry_count`

来表达。

账户域状态补充：

- 用户状态：`enabled | disabled`
- refresh session 状态：`active | rotated | revoked | expired`

## 11. 实时可视化要求

后端必须能向前端和后台提供足够清晰的状态字段，用于展示：

- 当前状态
- 当前尝试次数
- 最大尝试次数
- 当前进度
- 最近一次提示信息
- 最近一次错误
- 最终结果

## 12. 白模渲染固定版本常量

白模渲染节点一期固定使用以下共享常量：

- `provider = laozhang`
- `model = gemini-3-pro-image-preview`
- `pipeline_version = v1`
- `prompt_version = v1`
- `imageSize = 1K`
- `aspectRatio = auto`
  实际请求表现为不传 `aspectRatio`

白模渲染固定提示词也统一收口到共享常量文件，不允许在 API、Worker、前端各自维护一份。

## 13. AI 生图固定版本常量

AI 生图节点一期固定使用以下共享常量：

- `provider = laozhang`
- `model = gemini-3-pro-image-preview`
- `pipeline_version = v1`
- `prompt_version = v1`
- `imageSize = 1K`
- `aspectRatio = auto`
  实际请求表现为不传 `aspectRatio`

AI 生图节点一期输入结构说明：

- 节点类型：`aiImageGen`
- 任务类型：`image-gen`
- 执行模式：`legacy-grouped-task`
- 节点级共享输入：`prompt`
- 节点级可选参数：`imageSize`
- 节点级可选参数：`aspectRatio`
- group 输入结构：`groupId + referenceFileIds`

其中：

1. `referenceFileIds` 长度范围固定为 `1~5`
2. `referenceFileIds` 顺序即真实传给外部平台的图片顺序
3. 一期不支持 `negativePrompt`
4. 一期不支持多结果图

## 14. 图片转模型节点固定版本常量

## 13. 平面图转彩平节点固定版本常量

平面图转彩平节点一期固定使用以下共享常量：

- `nodeType = aiFloorplanColorize`
- `taskType = floorplan-colorize`
- `executionMode = legacy-grouped-task`
- `provider = laozhang`
- `model = gemini-3-pro-image-preview`
- `pipelineVersion = v1`
- `promptVersion = v2`
- `defaultStylePreset = three-d-render`

平面图转彩平节点一期输入结构说明：

- 节点类型：`aiFloorplanColorize`
- 任务类型：`floorplan-colorize`
- 执行模式：`legacy-grouped-task`
- group 输入结构：`groupId + sourceFileId + stylePreset + imageSize + aspectRatio`

其中：
1. 每个 group 固定只能有 1 张输入平面图
2. `stylePreset` 当前仅支持 `three-d-render` 与 `photoreal-render`
3. `stylePreset` 缺失时按默认值 `three-d-render` 兼容
4. 前端只传 `stylePreset`，对应 prompt 由后端共享常量固定映射
5. 本期不开放前端自由输入 prompt

## 14. 图片转模型节点固定版本常量

图片转模型节点一期固定使用以下共享常量：

- `nodeType = aiImageToPly`
- `taskType = image-to-ply`
- `executionMode = legacy-grouped-task`
- `provider = runninghub`
- `workflowId = 2014519004714508290`
- `workflowTemplateKey = sharp-image-to-ply-v1`
- `inputNodeId = 1`
- `inputFieldName = image`
- `outputFileType = ply`

图片转模型节点一期输入结构说明：

- 节点类型：`aiImageToPly`
- 任务类型：`image-to-ply`
- 执行模式：`legacy-grouped-task`
- group 输入结构：`groupId + sourceFileId`

其中：
1. 每个 group 固定只能有 1 张输入图片
2. 输入图片先由后端上传到 RunningHub，再把返回 `fileName` 写入工作流节点 `1.image`

## 多视角修复节点一期共享常量与输入结构

多视角修复节点一期固定使用以下共享常量：

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

多视角修复节点一期输入结构说明：

- 节点类型：`aiMultiViewRestore`
- 任务类型：`multi-view-restore`
- 执行模式：`legacy-grouped-task`
- group 输入结构：`groupId + renderFileId + referenceFileId`

其中：
1. 每个 group 固定必须有 1 张渲染图和 1 张原视角参考图
2. 两张输入图都先由后端上传到 RunningHub
3. 渲染图上传返回 `fileName` 固定写入工作流节点 `124.image`
4. 原视角参考图上传返回 `fileName` 固定写入工作流节点 `102.image`
5. 该节点复用现有 `providers.runninghub` 配置，不新增独立 provider 配置项
3. 一期固定输出 1 个 `ply` 文件
4. RunningHub 创建返回、任务结果查询返回在共享层有唯一内部映射类型，供 API、Worker、测试统一引用
