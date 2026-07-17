# 图片高清化节点设计

## 1. 文档目的

本文档用于固定图片高清化节点当前后端落地形态，覆盖：

- 节点协议
- 输入输出
- 执行链路
- 参数与提示词约束
- 自动化验证范围

当前文档对应节点：

- 前端节点类型：`aiImageHd`
- 任务类型：`image-hd`
- 执行模式：`legacy-grouped-task`

## 2. 节点目标

图片高清化节点是一个单图输入、单图输出节点。

每个 group 的目标是：

1. 接收 1 张已上传完成的输入图
2. 使用后端固定提示词调用老张 API
3. 允许前端选择 `imageSize` 与 `aspectRatio`
4. 生成 1 张输出图
5. 返回任务状态、事件、结果文件与参数回显

## 3. 输入输出规则

### 3.1 group 输入

每个 group 固定包含：

- `groupId`
- `sourceFileId`

可选参数：

- `imageSize`
- `aspectRatio`

### 3.2 group 输出

每个 group 固定输出：

- 1 张结果图

当前没有中间产物，也没有缓存复用逻辑。

## 4. 参数规则

### 4.1 imageSize

支持值：

- `1K`
- `2K`
- `4K`

默认值：

- `1K`

### 4.2 aspectRatio

支持值：

- `auto`
- `1:1`
- `16:9`
- `9:16`
- `4:3`
- `3:4`
- `21:9`
- `3:2`
- `2:3`
- `5:4`
- `4:5`

默认值：

- `auto`

说明：

- 当值为 `auto` 时，Worker 调用老张 API 时不透传 `aspectRatio`
- 其它值会原样透传给 provider

## 5. 固定常量

共享常量来源：

- `backend/shared/src/constants/aiImageHd.ts`

当前固定值：

- `provider = laozhang`
- `model = gemini-3-pro-image-preview`
- `pipeline_version = v1`
- `prompt_version = v1`
- `executionMode = legacy-grouped-task`

固定提示词：

- 当前仍为占位空字符串
- 正式联调前必须补齐

## 6. 执行链路

执行创建阶段：

1. API 校验 `nodeType / taskType / executionMode`
2. 校验 `groups[].sourceFileId`
3. 校验 `imageSize / aspectRatio`
4. 将输入映射为任务 `input`

Worker 执行阶段：

1. 从 `ExecutionTask.input` 读取 `sourceFileId / imageSize / aspectRatio`
2. 通过单图公共 helper 读取输入文件
3. 记录 `step_final_started`
4. 调用老张 API 生图
5. 保存输出文件并回填 `resultFileId`
6. 记录 `step_final_completed`
7. 队列层负责完成态、失败态和重试事件

## 7. 查询回显

执行查询与任务查询当前会回显：

- `inputFileId`
- `sourceFileId`
- `inputFile`
- `imageSize`
- `aspectRatio`
- `resultFileId`
- `resultFile`

前端按 `groupId / groupOrder / sourceHandle` 将结果写回输出口。

## 8. 事件与重试

当前典型事件：

- `task_queued`
- `task_started`
- `step_final_started`
- `step_final_completed`
- `task_progress`
- `task_completed`
- `task_retry_scheduled`
- `task_retry_started`
- `task_retry_progress`
- `task_failed`

当前固定策略：

- `max_retries = 2`
- `max_attempts = 3`

## 9. 自动化验证

当前已有自动化覆盖：

- `tests/ai-image-hd.create.spec.ts`
  - 创建成功
  - 默认参数补全
  - 非法 `imageSize / aspectRatio`
  - 非法文件拦截
- `tests/ai-image-hd.executor.spec.ts`
  - 参数透传
  - 输出落库
  - 事件回填
- `tests/queue.basic.spec.ts`
  - grouped queue 成功路径
- `tests/queue.retry.spec.ts`
  - 重试成功路径

## 10. 已知风险

当前已知运行前置条件：

- 固定提示词仍为空占位
- 未补提示词前，真实调用老张 API 会失败
