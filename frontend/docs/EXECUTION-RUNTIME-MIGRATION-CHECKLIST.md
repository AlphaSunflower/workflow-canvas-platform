# 执行运行态迁移与性能验收清单

## 1. 文档目的

本文档用于约束所有真实后端节点的前端接入方式，避免把高频运行态重新塞回 `WorkflowContext`，并提供统一的迁移清单、测试清单与性能验收标准。

## 2. 已完成接入的节点

当前已完成统一执行运行态接入的节点：

1. 白模渲染节点
2. AI 生图节点

两者都统一使用：

1. `ExecutionRuntimeStore`
2. `ExecutionPollingManager`
3. 节点执行适配器
4. `ExecutionOutputCommitService`

## 3. 后续新节点最小接入清单

每个新节点至少需要完成以下四类工作。

### 3.1 适配器接入

必须新增节点执行适配器，并实现：

1. `validateExecution`
2. `createExecutionPayload`
3. `mapSnapshotToRuntimePatch`
4. `extractExecutionOutputs`

### 3.2 UI 接入

节点组件必须遵守以下规则：

1. 通过统一运行态 Hook 读取状态
2. 不得自行轮询
3. 不得自行写回输出
4. 布局版本键不得依赖执行进度、消息、错误字段

### 3.3 自动测试

至少补齐以下测试之一：

1. 适配器载荷测试
2. 适配器输出提取测试
3. 节点布局隔离测试
4. 结果回写去重测试

### 3.4 文档

至少补齐以下文档内容：

1. 节点输入输出说明
2. 执行请求字段说明
3. 运行态字段映射说明
4. 已知限制

## 4. AI 生图节点迁移结果

AI 生图节点本轮已完成以下改造：

1. 执行逻辑切换到 `ai-image-gen.adapter.ts`
2. 文件注册走统一后端文件链路
3. 状态轮询走统一 `ExecutionPollingManager`
4. 输出回写走统一 `ExecutionOutputCommitService`
5. 参数区收敛为 `Prompt / Aspect / Resolution`
6. 布局版本键只依赖输入结构

## 5. 自动测试清单

当前与统一执行运行态相关的核心测试包括：

### 5.1 基础设施

- `execution-runtime.store.spec.ts`
- `execution-polling-manager.spec.ts`
- `execution-output-commit.service.spec.ts`

### 5.2 白模渲染

- `ai-model-render-transfer/component.runtime.spec.tsx`

### 5.3 AI 生图

- `execution-runtime/adapters/ai-image-gen.adapter.spec.ts`
- `nodes/ai-image-gen/component.runtime.spec.tsx`
- `execution-output-commit.service.spec.ts`

## 6. 手动性能验收清单

每次新节点接入后，至少做以下人工验收：

### 6.1 基础链路

1. 前端可真实创建执行任务
2. 可看到 `queued / processing / completed / failed`
3. 结果能自动回写到输出端口

### 6.2 多 group 场景

1. 同一节点同时发起多个 group
2. 多个 group 状态独立推进
3. 已完成 group 不会重复追加输出

### 6.3 长轮询场景

1. 任务执行期间画布拖拽不卡顿
2. 任务执行期间画布缩放不卡顿
3. 节点选中切换不卡顿
4. 执行进度变化不触发 React Flow 布局重算

### 6.4 终态回写

1. 单个 group 完成后只回写一次
2. 重复轮询终态快照不会重复生成输出节点
3. 同一 `resultFileId` 在不同 grouped handle 上可分别回写

### 6.5 失败与重试

1. 可展示当前步骤
2. 可展示当前尝试次数
3. 可展示“正在重试第几次”
4. 最终失败后状态稳定，不触发整画布高频刷新

## 7. 通过标准

统一执行运行态迁移视为通过，至少满足：

1. 自动测试通过
2. `npm run typecheck` 通过
3. 节点运行时画布不再因执行进度高频重渲染
4. 后续新节点接入时不需要新写专属轮询主流程
5. 新节点只需扩展适配器与节点展示层
