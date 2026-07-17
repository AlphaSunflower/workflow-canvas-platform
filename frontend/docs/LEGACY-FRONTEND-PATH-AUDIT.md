# Legacy Frontend Path Audit

本文档用于审计当前前端中仍然保留的旧任务、旧快照、本地存档相关主路径残留，作为后续“清理旧逻辑残留”任务的执行基线。

## 审计范围

- `WorkflowContext.tsx`
- `api/index.ts`
- `types/api.types.ts`
- `services/index.ts`
- `services/local-workflow-archive.ts`
- `services/local-workflow-assets.ts`
- `useImageResource.ts`

## 审计结论总览

当前残留分成三类：

### 可删

- `snapshotApi` 对外默认导出
  - 文件：`src/api/index.ts`
  - 原因：当前画布主持久化已经切到 `/api/v1/workflows`
  - 风险：继续暴露会让调用方误以为快照仍是主保存入口

- `taskApi` 对外默认导出
  - 文件：`src/api/index.ts`
  - 原因：任务历史查询已切到 workflow-scoped task history API
  - 风险：继续暴露会让执行链路回流到旧 `/api/v1/tasks`

- `SnapshotApi`、`TaskApi` 在公共 API 类型面的默认保留
  - 文件：`src/types/api.types.ts`
  - 原因：当前仅为兼容残留，不应继续作为主接口契约

### 待改造

- 保存主链路仍先写 `snapshotApi` 再写 `workflowApi`
  - 文件：`src/components/context/WorkflowContext.tsx`
  - 调用点：
    - `persistWorkflowWithSnapshot()`
    - `createWorkflowSnapshot()`
    - `loadWorkflowSnapshot()`
  - 现状：画布保存前仍会调用 `snapshotApi.create(createSnapshotRequest(...))`
  - 影响：同一次保存存在 workflow + snapshot 双路径，增加复杂度并引入旧模型依赖
  - 处理建议：改为仅以 `/api/v1/workflows` 为真源，快照逻辑降级或废弃

- 执行运行态仍由前端写旧 `/api/v1/tasks`
  - 文件：`src/components/context/WorkflowContext.tsx`
  - 调用点：
    - `createTaskRecords()` -> `taskApi.createBatch`
    - `updateTaskRecordStatus()` -> `taskApi.updateStatus`
    - `reportTaskRecordResult()` -> `taskApi.reportResult`
    - `runSingleDefinitionNode()`
    - `runGroupedDefinitionNode()`
    - `runMockDefinitionNode()`
  - 现状：前端仍在创建 task record、推进状态、回写结果
  - 影响：前端仍扮演任务持久化写入方，与后端 execution/task-history 真源模型冲突
  - 处理建议：切到 execution + workflow task history 真源，只消费后端数据

- `relatedTasks` 仍绑定旧 `TaskRecord` / `WorkflowSnapshotTaskRef`
  - 文件：
    - `src/components/context/WorkflowContext.tsx`
    - `src/components/context/workflow-context.types.ts`
    - `src/types/workflow.types.ts`
    - `src/utils/workflow/snapshot-links.ts`
  - 现状：节点任务引用、metadata.relatedTasks、latestSnapshot 都来自旧快照/任务模型
  - 影响：workflow metadata 仍承载旧任务快照心智
  - 处理建议：改造为最小运行引用，或直接用 workflow-scoped task history 查询替代

- `workflow-context.types.ts` 仍把旧快照行为定义为正式 action
  - 字段：
    - `createWorkflowSnapshot`
    - `loadWorkflowSnapshot`
    - `latestSnapshot`
    - `relatedTasks`
  - 影响：类型层继续暗示旧快照模型是核心能力
  - 处理建议：在主链路清理完成后收缩或移除

### 暂保留

- 本地导入/导出能力
  - 文件：
    - `src/components/workflow/Toolbar.tsx`
    - `src/components/context/WorkflowContext.tsx`
    - `src/services/local-workflow-archive.ts`
  - 现状：已降级为辅助能力，不再是主持久化路径
  - 保留原因：仍有辅助归档、离线备份价值
  - 约束：不得再参与主持久化、主任务历史、主文件真源

- `local-workflow-assets.ts` 的嵌入资产恢复能力
  - 文件：
    - `src/services/local-workflow-assets.ts`
    - `src/hooks/image/useImageResource.ts`
    - `src/services/file-export.ts`
  - 现状：仍用于本地 archive 导入后恢复浏览器 `File` / object URL
  - 保留原因：本地辅助导入导出仍依赖它
  - 风险：`useImageResource.ts`、`backendFileService.ts` 仍会碰本地注册表，需要避免继续污染主运行链路
  - 处理建议：继续保留，但必须隔离到“本地辅助模式”

## 详细审计

### 1. WorkflowContext

#### 1.1 旧 snapshot 主路径残留

- `persistWorkflowWithSnapshot()`：
  - 先 `snapshotApi.create()`
  - 再 `workflowApi.save()`
- `createWorkflowSnapshot()`：
  - 仍主动创建 snapshot
- `loadWorkflowSnapshot()`：
  - 仍允许按 snapshotId 回填整份 workflow

判断：

- `persistWorkflowWithSnapshot()` 属于主链路阻塞项，必须优先改造
- `createWorkflowSnapshot()` / `loadWorkflowSnapshot()` 属于兼容残留，可在主链路切换后再收缩

#### 1.2 旧 task 主路径残留

- `createTaskRecords()`
- `updateTaskRecordStatus()`
- `reportTaskRecordResult()`
- 单任务执行、分组执行、mock 执行都依赖这些旧方法

判断：

- 这是执行主链路阻塞项，优先级高于本地导入导出清理

#### 1.3 本地存档残留

- `exportLocalArchive()`
- `importLocalArchive()`

判断：

- 已经不是主链路
- 可以保留，但要继续明确“辅助能力”边界

### 2. API 导出面

#### 2.1 `src/api/index.ts`

当前仍导出：

- `taskApi`
- `snapshotApi`

判断：

- 这两个导出都属于误导性暴露
- 待主链路切换完成后应移除默认出口

### 3. 类型面

#### 3.1 `src/types/api.types.ts`

当前仍保留：

- `TaskApi`
- `SnapshotApi`
- `TaskRecord`
- `CreateWorkflowSnapshotRequest`
- `WorkflowSnapshotDetail`

判断：

- 这些类型仍在多个模块中扩散
- 需要在任务与快照链路完成迁移后逐步收缩

#### 3.2 `src/components/context/workflow-context.types.ts`

当前状态字段仍包含：

- `latestSnapshot`
- `relatedTasks`

当前 action 仍包含：

- `createWorkflowSnapshot`
- `loadWorkflowSnapshot`

判断：

- 这是旧模型还挂在上下文契约层的直接证据

### 4. 本地存档与本地文件注册表

#### 4.1 `src/services/local-workflow-archive.ts`

用途：

- 构造本地 archive
- 解析 archive
- 恢复 embedded assets

判断：

- 当前不属于主链路
- 允许暂保留

#### 4.2 `src/services/local-workflow-assets.ts`

用途：

- 浏览器 `File` 注册表
- local archive embedded assets 采集与恢复

判断：

- 仍有辅助价值
- 但不应再被后端文件真源主链路依赖

#### 4.3 `src/hooks/image/useImageResource.ts`

残留点：

- original 模式下会回退到 `getRegisteredLocalWorkflowFile()`

判断：

- 这条回退仅应服务本地 archive 恢复场景
- 后续应加边界判断，避免常规后端模式下继续读取本地注册表

## 后续处理建议顺序

1. 优先清理 `WorkflowContext` 中 snapshot 主保存链路
2. 再清理 `WorkflowContext` 中 taskApi 写回链路
3. 然后收缩 `workflow-context.types.ts`、`api/index.ts`、`types/api.types.ts`
4. 最后隔离本地 archive / local asset 逻辑到辅助模式

## 当前分类清单

### 可删

- `src/api/index.ts` 中 `taskApi`
- `src/api/index.ts` 中 `snapshotApi`
- `src/types/api.types.ts` 中默认暴露的 `TaskApi`
- `src/types/api.types.ts` 中默认暴露的 `SnapshotApi`

### 待改造

- `WorkflowContext.persistWorkflowWithSnapshot`
- `WorkflowContext.createWorkflowSnapshot`
- `WorkflowContext.loadWorkflowSnapshot`
- `WorkflowContext.createTaskRecords`
- `WorkflowContext.updateTaskRecordStatus`
- `WorkflowContext.reportTaskRecordResult`
- `workflow-context.types.ts` 中的 `latestSnapshot`
- `workflow-context.types.ts` 中的 `relatedTasks`
- `workflow-context.types.ts` 中的 snapshot actions

### 暂保留

- `Toolbar` 本地导入/导出按钮
- `local-workflow-archive.ts`
- `local-workflow-assets.ts`
- `useImageResource.ts` 中仅用于 local archive 的回退逻辑
