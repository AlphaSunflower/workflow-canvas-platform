# 平面图转彩平节点设计

## 1. 文档目的

本文档用于固定平面图转彩平节点当前后端落地形态，覆盖：

- 节点协议
- 输入输出
- 执行链路
- 参数与提示词约束
- 自动化验证范围

当前文档对应节点：

- 前端节点类型：`aiFloorplanColorize`
- 任务类型：`floorplan-colorize`
- 执行模式：`legacy-grouped-task`

## 2. 节点目标

平面图转彩平节点是一个单图输入、单图输出节点。

每个 group 的目标是：

1. 接收 1 张平面图输入
2. 使用后端固定提示词调用老张 API
3. 允许前端选择 `stylePreset`、`imageSize` 与 `aspectRatio`
4. 生成 1 张彩平结果图
5. 返回任务状态、事件、结果文件与参数回显

## 3. 输入输出规则

### 3.1 group 输入

每个 group 固定包含：

- `groupId`
- `sourceFileId`

可选参数：

- `stylePreset`
- `imageSize`
- `aspectRatio`

创建阶段规则：

- 未传 `stylePreset` 时，后端自动补默认值 `three-d-render`
- 非法 `stylePreset` 在创建阶段直接拦截
- 归一化后的 `stylePreset` 会同时写入 `run.requestPayload` 与每条 `ExecutionTask.input`

### 3.2 group 输出

每个 group 固定输出：

- 1 张彩平结果图

当前没有中间产物，也没有缓存复用逻辑。

## 4. 参数规则

### 4.1 stylePreset

参数语义：

- `stylePreset` 用于选择后端固定提示词预设
- 前端只传预设枚举，不直接传完整 prompt
- 旧画布或旧请求缺失 `stylePreset` 时，按默认值兼容
- 本期不开放自定义 prompt 输入

支持值：

- `three-d-render`
- `photoreal-render`

前端展示文案：

- `three-d-render -> 3D渲染`
- `photoreal-render -> 写实渲染`

默认值：

- `three-d-render`

后端提示词映射：

- `three-d-render`
  - 将平面图转化为一张90度正上方俯视效果图。写实3D风格，展现墙体和家具的立体厚度。根据平面图生成现代风格效果鸟瞰图。柔和顶部漫射光，软阴影。图中元素保持不变。
- `photoreal-render`
  - 将这张平面图变成真实渲染风格图片，从顶部俯视房屋，将家具和地面变成写实风格，家具在地面上留下真实的阴影。背景保留白色。

适用说明：

- `three-d-render` 适合强调墙体、家具厚度和空间结构的彩平表达
- `photoreal-render` 适合强调材质、地面与家具真实阴影的写实俯视效果

### 4.2 imageSize

支持值：

- `1K`
- `2K`
- `4K`

默认值：

- `1K`

### 4.3 aspectRatio

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

- `backend/shared/src/constants/aiFloorplanColorize.ts`

当前固定值：

- `provider = laozhang`
- `model = gemini-3-pro-image-preview`
- `pipeline_version = v1`
- `prompt_version = v1`
- `executionMode = legacy-grouped-task`

固定提示词边界：

- 提示词由后端维护，前端只传 `stylePreset`
- 提示词按 `stylePreset -> prompt` 固定映射生成
- 本期固定仅支持 `three-d-render` 与 `photoreal-render`
- 本期不开放前端自由输入 prompt

## 6. 执行链路

执行创建阶段：

1. API 校验 `nodeType / taskType / executionMode`
2. 校验 `groups[].sourceFileId`
3. 校验 `stylePreset / imageSize / aspectRatio`
4. 将输入映射为任务 `input`

Worker 执行阶段：

1. 从 `ExecutionTask.input` 读取 `sourceFileId / stylePreset / imageSize / aspectRatio`
2. 通过单图公共 helper 读取输入文件
3. 由后端根据 `stylePreset` 选择固定 prompt
4. 记录 `step_final_started`
5. 调用老张 API 生图
6. 保存输出文件并回填 `resultFileId`
7. 记录 `step_final_completed`
8. 队列层负责完成态、失败态和重试事件

Worker 执行补充规则：

- `stylePreset` 缺失时，Worker 按默认值 `three-d-render` 兜底
- `stylePreset` 非法时，Worker 直接失败，不静默回退到其它 prompt
- 若 `stylePreset` 对应 prompt 映射缺失，Worker 直接失败
- `step_final_started` 事件 payload 会记录 `stylePreset` 与 `promptVersion`
- 执行器不再直接依赖空的 `AI_FLOORPLAN_COLORIZE_PROMPT`

## 7. 查询回显

执行查询与任务查询当前会回显：

- `inputFileId`
- `sourceFileId`
- `inputFile`
- `stylePreset`
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

- `tests/ai-floorplan-colorize.create.spec.ts`
  - 创建成功
  - 默认参数补全
  - 非法 `imageSize / aspectRatio`
  - 非法文件拦截
- `tests/ai-floorplan-colorize.executor.spec.ts`
  - 参数透传
  - 输出落库
  - 事件回填
- `tests/queue.basic.spec.ts`
  - grouped queue 成功路径
- `tests/queue.retry.spec.ts`
  - 最终失败路径

## 10. 已知风险

当前已知运行前置条件：

- 风格参数协议已冻结，但后端常量与执行器仍需按本协议补齐
- 在完成实现前，真实调用老张 API 仍可能因提示词未接入而失败
## 2026-04 StylePreset Addendum

- Frontend sends `stylePreset` only and must not send full prompt text.
- Supported presets are only `three-d-render` and `photoreal-render`.
- Default preset is `three-d-render`.
- Missing `stylePreset` from old canvases or old requests is normalized to the default preset.
- Legacy frontend placeholders `default / modern / warm` are normalized on the frontend to `three-d-render`.
- Worker resolves prompt from the fixed `stylePreset -> prompt` mapping.
- Invalid `stylePreset` must fail explicitly during create or execute, and must not silently fall back to a wrong prompt.

Added automated coverage:
- `tests/ai-floorplan-colorize.create.spec.ts`
  - default `stylePreset`
  - explicit `photoreal-render` persisted into `run.requestPayload` and `ExecutionTask.input`
  - invalid `stylePreset` rejected at create time
- `tests/ai-floorplan-colorize.executor.spec.ts`
  - different presets map to different prompts
  - default preset fallback in Worker
  - invalid preset fails explicitly in Worker
- `frontend/src/nodes/ai-floorplan-colorize/component.spec.tsx`
  - preset options, Chinese labels, default config, legacy placeholder normalization
- `frontend/src/components/context/WorkflowContext.floorplan-colorize.spec.tsx`
  - grouped payload propagation
  - request body propagation
  - runtime query echo for `stylePreset / imageSize / aspectRatio`

Minimal manual verification:
1. Create an `aiFloorplanColorize` node and connect one floorplan image.
2. Choose `3D渲染` and verify `groups[0].stylePreset = three-d-render` in the create request.
3. Choose `写实渲染` and verify `groups[0].stylePreset = photoreal-render` in the create request.
4. Query execution detail and verify `stylePreset`, `imageSize`, and `aspectRatio` are echoed back.
5. On success, verify the result image is committed back to the correct group output.
