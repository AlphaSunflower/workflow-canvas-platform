# 节点执行适配器接入规范

## 1. 文档目的

本文档定义真实后端节点接入统一执行运行态体系时的唯一合法方式。

目标是把节点差异收敛到适配器层，而不是继续把以下逻辑散落在 `WorkflowContext`、节点组件和临时 service 中：

- 轮询逻辑
- 快照映射逻辑
- 输出提取逻辑
- 节点专用执行请求拼装逻辑

## 2. 适用范围

本文档适用于所有需要真实后端执行的节点，包括但不限于：

- 白模渲染节点
- 单任务后端节点
- grouped 多任务节点
- 带中间步骤、重试和终态产物回写的节点

不适用于：

- 纯前端 mock 节点
- 本地同步计算节点
- 仅用于静态展示的节点

## 3. 核心原则

### 3.1 节点只描述差异，不接管全局执行流程

适配器只描述“这个节点如何执行”，不负责全局执行基础设施。

适配器负责：

- 输入校验
- 执行请求构建
- 快照到运行态 patch 的映射
- 终态输出提取

适配器不负责：

- 自己轮询
- 自己维护全局 Store
- 自己管理取消控制器
- 自己把结果写回工作流结构

### 3.2 所有真实后端节点必须有适配器

只要一个节点要接真实后端，就必须注册适配器。

禁止做法：

- 继续在 `WorkflowContext` 里写 `if (node.type === 'xxx')`
- 在节点组件中直接请求后端并轮询
- 在节点组件中直接拼接回写结果

### 3.3 适配器是唯一扩展入口

后续新增真实后端节点时，前端第一步应该是新增适配器并注册，而不是修改执行主流程。

## 4. 当前接口结构

统一适配器接口位于：

- [node-execution-adapter.types.ts](/D:/Project/newflow5/newworkflow2/frontend/src/execution-runtime/node-execution-adapter.types.ts)
- [node-execution.types.ts](/D:/Project/newflow5/newworkflow2/frontend/src/execution-runtime/node-execution.types.ts)

当前适配器需覆盖以下能力：

- `nodeType`
- `executionKind`
- `taskType`
- `validateExecution`
- `createExecutionPayload`
- `mapSnapshotToRuntimePatch`
- `extractExecutionOutputs`

## 5. 适配器职责明细

### 5.1 validateExecution

职责：

- 校验节点是否具备执行所需输入
- 返回统一的可展示失败原因

要求：

- 不能依赖 UI 临时状态
- 错误原因要可直接用于前端提示

### 5.2 createExecutionPayload

职责：

- 从节点当前输入构建后端执行请求
- 生成统一 payload，交给统一执行链路发起请求

要求：

- 节点组件不得自己拼 HTTP body
- grouped 节点要稳定产出 group 顺序和 output handle 映射

### 5.3 mapSnapshotToRuntimePatch

职责：

- 将后端 run/task 快照映射为前端运行态 patch
- 如果节点有自定义映射需求，在这里处理

要求：

- 只返回运行态 patch
- 不得在此处直接修改工作流结构

### 5.4 extractExecutionOutputs

职责：

- 从终态快照中提取结果文件
- 标注对应 `taskId / groupId / sourceHandle / groupOrder`

要求：

- 结果提取必须幂等
- 不得在此处直接 append 节点

## 6. grouped 节点额外要求

grouped 节点适配器必须显式支持：

- group 列表解析
- `groupId + groupOrder` 稳定映射
- 每组输入完整性校验
- group 级输出提取
- group 级 source handle 映射

禁止把 grouped 节点简化成“组件里自己循环调用后端”。

## 7. 白模节点作为首个接入样板

当前白模渲染节点适配器位于：

- [white-model-render.adapter.ts](/D:/Project/newflow5/newworkflow2/frontend/src/execution-runtime/adapters/white-model-render.adapter.ts)

它已经覆盖以下内容：

- 每组两张输入图校验
- grouped 请求构建
- group 输出 handle 映射
- 快照到运行态 patch 映射
- 终态图片提取

白模节点的意义是“首个接入样板”，不是“长期保留白模专用主流程”。

## 8. 注册与发现

统一注册表位于：

- [node-execution-adapter.registry.ts](/D:/Project/newflow5/newworkflow2/frontend/src/execution-runtime/node-execution-adapter.registry.ts)

统一导出入口位于：

- [index.ts](/D:/Project/newflow5/newworkflow2/frontend/src/execution-runtime/index.ts)

要求：

- 新节点适配器必须在统一入口注册
- 同一节点类型只能有一个有效适配器

## 9. 新节点接入步骤

后续新增一个真实后端节点时，必须按以下顺序接入：

1. 明确节点输入结构、执行类型和输出结构。
2. 新增节点执行适配器文件。
3. 实现输入校验、payload 构建、快照映射、输出提取。
4. 在统一注册表注册该适配器。
5. 节点 UI 只消费运行态 Hook，不再写轮询或回写逻辑。
6. 补自动测试和接入文档。

## 10. 最小验收标准

一个真实后端节点只有在满足以下条件时，才算完成规范接入：

- 存在正式适配器文件
- 已在统一注册表注册
- 节点组件不再自己轮询
- 节点组件不再自己请求执行详情
- 节点组件不再自己回写终态结果
- 结果通过 `ExecutionOutputCommitService` 回写
- 执行态通过 `ExecutionRuntimeStore` 读取

## 11. AI 生图节点接入补充

`aiImageGen` 节点现已按 grouped 节点规范接入统一执行适配器，适配器文件位于：

- [ai-image-gen.adapter.ts](/D:/Project/newflow5/newworkflow2/frontend/src/execution-runtime/adapters/ai-image-gen.adapter.ts)

当前约束如下：

1. `validateExecution` 必须校验 `prompt` 非空。
2. 至少需要一组有效图片输入。
3. 每组输入数量必须落在 `1~5`。
4. `createExecutionPayload` 必须通过统一文件注册服务拿到后端 `fileId`。
5. `referenceFileIds` 必须严格按当前组内连接顺序构造。
6. 节点级 `prompt / imageSize / aspectRatio` 必须写入统一执行请求。
7. `extractExecutionOutputs` 必须使用稳定的 `groupId -> outputHandle` 映射。

这意味着 AI 生图节点后续不应再在节点组件或 `WorkflowContext` 中自行拼装后端请求。
