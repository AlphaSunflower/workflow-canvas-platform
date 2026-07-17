# 节点并行开发规范

## 1. 目标

本规范用于约束 `newworkflow2/frontend` 后续 AI 节点的并行开发方式，确保多人协作基于当前新架构进行，而不是回到旧的 `components/node` 入口链路。

当前节点体系已经满足以下前提：

- `src/nodes` 是 AI 节点的唯一注册入口
- `Canvas` 只从 `src/nodes` 获取 `nodeTypes` 和节点定义
- `WorkflowContext` 按 `NodeDefinition.execution` 做统一调度
- 输入组、拖拽挂载、运行、输出回写都已有共享协议
- 旧 `components/node/ai` 与旧 `components/node/nodeTypes.ts` 兼容链路已删除

## 2. 唯一入口原则

后续所有 AI 节点都必须通过 `src/nodes` 进入系统。

唯一合法入口：

- `src/nodes/index.ts`
- `src/nodes/registry.ts`
- `src/nodes/types.ts`

禁止再引入或恢复以下旧链路：

- `src/components/node/nodeTypes.ts`
- `src/components/node/ai/*`
- 任何通过 `components/node` 注册 AI 节点的方式

判断标准：

- 节点创建来源必须是 `getNodeDefinition(...)` / `nodeTypes`
- 节点组件映射必须由 `src/nodes/registry.ts` 生成
- `Canvas.tsx` 不允许再出现 AI 节点专属包装层
- 节点创建菜单必须由 `NodeDefinition.menu` 驱动，不允许在 `Canvas.tsx` 内单独追加节点创建项

## 3. 当前目录基线

当前 AI 节点目录：

```text
src/nodes/
  ai-image-gen/
    component.tsx
    drop.ts
    groups.ts
    index.tsx
    runtime.ts
  ai-model-render-transfer/
    index.tsx
  ai-image-to-ply/
    index.tsx
  ai-multi-view-restore/
    index.tsx
  ai-image-hd/
    index.tsx
  ai-video-gen/
    index.tsx
  shared/
    NodeShell.tsx
    config.ts
    connection.ts
    drop.ts
    group-query.ts
    groups.ts
    runtime.ts
  index.ts
  registry.ts
  types.ts
  README.md
```

当前 `components/node` 只保留文件节点展示层，不再承担 AI 节点注册职责。

## 4. 节点注册契约

每个 AI 节点都必须提供 `NodeDefinition`，定义位于 `src/nodes/types.ts`。

必需字段：

- `type`
- `stage`
- `displayName`
- `icon`
- `color`
- `description`
- `menu`
- `defaultSize`
- `defaultConfig`
- `component`
- `validateConnection`
- `execution`

按需字段：

- `inputGroups`
- `resolveInputGroups`
- `drop`
- `createNodeData`
- `defaultInputGroups`

定义差异说明：

- “占位节点”和“完整节点”只是 `stage`、`component`、`execution` 等定义差异
- 二者都必须通过同一套 registry 注册
- `aiImageGen` 已是正式注册节点，不再是例外入口

菜单规则说明：

- `menu.order`：右键创建菜单中的排序
- `menu.group`：菜单分组
- `menu.visible?: boolean`：显式隐藏/显示；设为 `false` 时不出现在创建菜单
- `menu.contexts?: ('canvas')[]`：菜单可见上下文白名单；当前画布右键菜单仅识别 `canvas`

约束：

- 不要再复用 `stage` 控制节点是否出现在右键创建菜单
- 新节点进入右键菜单的标准路径是：定义 `NodeDefinition.menu` 后注册到 `src/nodes/registry.ts`
- `Canvas.tsx` 只消费共享菜单构建入口，不承担单节点菜单特例拼装

## 5. 输入组共享协议

### 5.1 共享 schema

输入组协议由以下结构组成：

- `NodeInputGroupCapability`
- `NodeInputGroupDefinition`
- `NodePortDefinition`
- `NodeResolvedInputGroupState`
- `NodeResolvedPortInput`

共享定义位置：

- `src/nodes/types.ts`
- `src/nodes/shared/connection.ts`
- `src/nodes/shared/group-query.ts`
- `src/nodes/shared/groups.ts`

### 5.2 handle 规则

多组节点统一句柄格式：

- `groupId:portId`

示例：

- `group-1:images`
- `group-2:image`
- `group-3:render`
- `group-3:reference`
- `group-5:result`

约束：

- 不允许再使用裸 `groupId` 作为正式运行期 handle
- 旧工作流的数据兼容迁移由 `normalizeWorkflowData(...)` 处理
- 新节点开发必须从第一天开始使用 `groupId:portId`

### 5.3 支持的模式

当前共享协议支持：

- 固定组：`mode: 'fixed'`
- 动态组：`mode: 'dynamic'`
- 无分组：`mode: 'none'`

可表达能力：

- 端口允许的文件类型
- 端口是否必填
- 端口最大连接数
- 端口是否保序
- 组最小/最大数量
- 组是否允许增删

### 5.4 查询与工具层

共享输入组工具已沉到：

- `src/nodes/shared/groups.ts`
- `src/nodes/shared/group-query.ts`

已覆盖的能力：

- 组初始化
- 组补齐与重排
- 组删除后重排
- handle 解析
- 端口连接统计
- 从 workflow connection 反推输入组状态

单节点开发时不得再在组件里手写新的 group 解析逻辑；如果已有共享函数能覆盖，必须直接复用。

## 6. 连接、拖拽、运行、输出回写协议

### 6.1 连接协议

连接规则共享入口：

- `src/nodes/shared/connection.ts`

统一原则：

- 当前阶段禁止 AI 节点之间互连
- 文件节点接入 AI 节点时，必须按端口 `accepts` 校验
- grouped 节点必须校验 `targetHandle`
- 超过端口上限必须拒绝
- 同一文件重复接入同一槽必须拒绝

### 6.2 拖拽挂载协议

拖拽协议共享入口：

- `src/nodes/shared/drop.ts`

节点通过 `NodeDefinition.drop` 接入。

可声明能力：

- 哪些拖入源合法
- `body` / `group` 两类落点语义
- `Shift` / `Ctrl` 批量挂载规则
- 拖拽后生成的组与连接计划

`Canvas.tsx` 不再承载节点私有拖拽算法。

### 6.3 运行协议

运行协议共享入口：

- `src/nodes/shared/runtime.ts`

当前统一支持三类执行模式：

- `mode: 'mock'`
- `mode: 'legacy-single-task'`
- `mode: 'legacy-grouped-task'`

`WorkflowContext` 只负责统一调度，不允许再加入节点类型分支。

### 6.4 输出回写协议

输出回写已经统一进入 shared runtime：

- `appendResolvedTaskOutputs(...)`
- `appendMockExecutionOutputs(...)`
- `createRuntimeOutputSnapshot(...)`

共享能力：

- 创建输出文件节点
- 写回 `output-link`
- 支持 `sourceHandle`
- 支持按 `group / port` 回写
- mock 与真实输出共用同一套回写协议

## 7. 公共层负责文件清单

以下文件属于公共层，默认由公共层负责人维护：

- `src/nodes/types.ts`
- `src/nodes/registry.ts`
- `src/nodes/index.ts`
- `src/nodes/shared/NodeShell.tsx`
- `src/nodes/shared/config.ts`
- `src/nodes/shared/connection.ts`
- `src/nodes/shared/drop.ts`
- `src/nodes/shared/group-query.ts`
- `src/nodes/shared/groups.ts`
- `src/nodes/shared/runtime.ts`
- `src/components/canvas/Canvas.tsx`
- `src/components/context/WorkflowContext.tsx`
- `src/utils/node/create.ts`
- `src/utils/workflow/runtime.ts`
- `src/utils/validators/node-validators.ts`
- `src/utils/validators/workflow-validators.ts`
- `scripts/run-tests.mjs`
- `src/nodes/README.md`
- `docs/node-parallel-development-spec.md`

默认规则：

- 单节点负责人不要直接修改这些文件
- 如需修改，先提“公共层变更申请”
- 公共层改动应优先独立合并，再让节点分支同步

## 8. 单节点负责人边界

单节点负责人默认只修改本节点目录：

- `src/nodes/<own-node>/**`

允许负责内容：

- 节点定义
- 节点本地常量
- 节点 UI
- 节点输入组描述
- 节点连接规则实现
- 节点运行计划
- 节点 mock 输出描述
- 节点本地拆分文件

不允许直接做的事：

- 修改 `Canvas.tsx` 给自己加特例
- 修改 `WorkflowContext.tsx` 给自己加特例
- 恢复 `components/node` 旧入口
- 在节点目录外新建临时兼容包装
- 复制一份共享 group / runtime / connection 逻辑到节点私有目录
- 绕过 `NodeDefinition.menu`，直接在 `Canvas.tsx` 硬编码节点创建菜单

## 9. 新节点接入步骤

新增一个 AI 节点时，推荐按下面顺序执行：

1. 在 `src/nodes/<node-name>/` 新建节点目录
2. 输出 `NodeDefinition`
3. 实现 `component`
4. 实现 `validateConnection`
5. 实现 `execution`
6. 如需分组，接入 `inputGroups` 与 `resolveInputGroups`
7. 如需拖拽挂载，接入 `drop`
8. 在 `src/nodes/registry.ts` 注册
9. 跑 `npm.cmd run typecheck`
10. 跑 `npm.cmd test`

## 10. 当前节点冻结语义

| 节点 | type | 输入结构 | 上限 | 输出 |
| --- | --- | --- | --- | --- |
| 白模图迁移渲染 | `aiModelRenderTransfer` | 每组 2 槽：白模图、风格参考图 | 最多 10 组 | 每组 1 张图 |
| 图转模型 | `aiImageToPly` | 每组 1 槽：图片 | 最多 10 组 | 每组 1 个 `ply` |
| 多视角修复 | `aiMultiViewRestore` | 每组 2 槽：渲染图、原视角参考图 | 最多 10 组 | 每组 1 张图 |
| 图片高清化 | `aiImageHd` | 每组 1 槽：图片 | 最多 10 组 | 每组 1 张图 |
| 视频生成 | `aiVideoGen` | 单槽顺序输入图片 | 最多 10 张 | 1 个视频 |
| AI 生图 | `aiImageGen` | 动态组，每组 1 槽图片序列 | 最多 10 组，每组最多 5 张 | 每组 1 组结果输出 |

额外约束：

- `aiVideoGen` 输入顺序必须稳定
- `aiImageToPly` 只允许图片输入
- `aiMultiViewRestore` 当前只允许文件节点输入
- `aiModelRenderTransfer` 的提示词由后端固定
- `aiImageHd` 每组只处理 1 张图

## 11. 并行协作流程

### 11.1 开发前

1. 公共层负责人先确认共享契约已冻结
2. 单节点负责人只从稳定共享基线分支切出
3. 新增公共能力前先提申请，不要顺手改公共层

### 11.2 开发中

1. 节点分支只改自己目录
2. 公共层变更单独合并
3. 节点分支基于新公共层 rebase / merge
4. 每个节点提交前至少跑一次 `typecheck`

### 11.3 合并顺序

推荐顺序：

1. 公共层分支
2. 单节点分支
3. 回归 `typecheck`
4. 回归 `test`

## 12. 验收基线

每个节点分支合并前至少自检：

1. 节点能从右键菜单正常创建
2. 节点目录只从 `src/nodes` 接入
3. 合法连接可建立
4. 非法连接会报错
5. 如支持拖拽挂载，拖拽行为符合定义
6. 点击运行后状态流转正常
7. 如有输出，输出回写符合共享协议
8. 不修改公共层禁改文件
9. `npm.cmd run typecheck` 通过
10. `npm.cmd test` 通过
