# 代码质量评估与完整整改方案报告

## 文档信息

- 评估日期：`2026-05-06`
- 评估范围：`newworkflow2`
- 评估对象：
  - `frontend/`
  - `backend/`
  - 根级质量门与架构文档
- 目标：
  - 给出当前整体代码质量问题的完整评估
  - 给出可执行的、分阶段的、不会再制造新高耦合中心的整改方案
  - 明确最终层级架构、目录归属、门禁规则与验收标准

## 执行摘要

当前项目已经具备可运行、可验证、可回归的基础质量门，前后端 `verify` 均可通过，说明项目已经脱离“失控状态”，进入“可治理状态”。

但这并不代表结构质量已经健康。

本次评估确认：

- 后端整体分层和依赖方向明显优于前端
- 前端现有质量问题已经从“显式报错”转为“结构性集中”
- 主要风险不再是 lint/typecheck 失败，而是少数超大文件和跨层共享入口持续吸收职责
- 如果直接在现有结构上继续迭代功能，会继续加重以下问题：
  - `WorkflowContext` 一带继续成为事实上的应用中心
  - `Canvas` 继续承担节点业务规则
  - `types` 继续退化为全局业务类型池
  - `utils` 继续退化为业务规则回收站
  - 测试虽然可通过，但警告噪音会持续降低回归信号质量

本报告给出的整改方案不是“拆几个大文件”，而是一次正式的架构归位：

- 引入显式 `application` 层
- 保留 `types`，但收缩为稳定基础类型层
- 保留 `utils`，但收缩为技术基础工具层
- 把节点业务规则彻底回归 `nodes`
- 把执行编排彻底回归 `application`
- 把运行时机制彻底回归 `execution-runtime`
- 把 HTTP/WebSocket 彻底限定在 `api`
- 把浏览器基础设施彻底限定在 `services`
- 同时升级架构扫描与质量门，使同类问题在后续迭代中无法重新长出

## 当前基线

### 自动检查结果

本次本地执行结果：

- `frontend npm.cmd run verify`：通过
- `backend npm.cmd run verify`：通过
- `frontend npm.cmd run arch:report`：通过
- `backend npm.cmd run arch:report`：通过

### 前端当前架构报告摘要

- 扫描生产文件：`441`
- reverse dependency violations：`0`
- cross-layer violations：`0`
- cycles：`3`
- runtime cycles：`0`
- mixed cycles：`0`
- type-only cycles：`3`
- orphan candidates：`1`

当前 orphan candidate：

- `src/components/context/useExecutionRuntime.ts`

当前 type-only cycles：

1. `src/types/ai.types.ts`
   `src/types/execution-task-ref.types.ts`
   `src/types/node.types.ts`
   `src/types/task.types.ts`
2. `src/execution-runtime/execution-runtime.types.ts`
   `src/types/ai.execution.types.ts`
   `src/types/index.ts`
3. `src/execution-runtime/execution-output-commit.types.ts`
   `src/execution-runtime/node-execution-adapter.types.ts`

### 后端当前架构报告摘要

#### API

- 扫描文件：`105`
- cross-layer violations：`0`
- shared/src penetration：`0`
- cycles：`0`

#### Worker

- 扫描文件：`57`
- shared/src penetration：`0`
- cycles：`0`

### 当前热点文件规模

前端热点文件长度信号：

- `frontend/src/components/canvas/Canvas.tsx`：约 `3093` 行
- `frontend/src/components/context/coordinators/workflow-execution-coordinator.ts`：约 `2559` 行
- `frontend/src/services/image/image-manager.ts`：约 `1604` 行
- `frontend/src/execution-runtime/execution-runtime.store.ts`：约 `26102` 字节
- `frontend/src/nodes/shared/runtime.ts`：约 `35959` 字节

### 当前共享入口扇入信号

前端架构报告显示：

- `src/types/index.ts` inbound：`216`
- `src/utils/index.ts` inbound：`76`

额外文本检索显示：

- `from '@/types'`：`276` 处
- `from '@/utils'`：`75` 处

这说明当前前端的主要问题不是“门禁失败”，而是“共享入口和中心文件正在吸收过多职责”。

## 总体结论

### 结论一：后端质量显著好于前端

后端 API 和 Worker 的分层、依赖方向、循环控制、测试编排都已经比较稳定。当前整改的主战场是前端。

### 结论二：前端目前处于“质量门可通过，但结构债务仍高”的状态

现有前端质量系统已经足以阻止明显退化，但仍不足以阻止以下问题继续增长：

- 大文件继续膨胀
- 业务逻辑继续向通用层聚集
- 全局 barrel 继续掩盖真实耦合
- 类型和工具层继续吸纳业务语义
- 测试噪音继续降低回归判断质量

### 结论三：本次整改必须是“架构归位”，不能只是“拆文件”

如果只是把超大文件拆成多个 helper 文件，但不改变职责边界，最终只会得到：

- 新的 mega-facade
- 新的 mega-registry
- 新的 mega-utils
- 新的共享类型池

这类拆分不会降低耦合，只会把问题从一个文件复制到多个文件。

## 主要问题清单

### P0：前端应用编排职责仍然集中

核心问题文件：

- `frontend/src/components/context/coordinators/workflow-execution-coordinator.ts`
- `frontend/src/components/context/WorkflowContext.tsx`
- `frontend/src/components/context/workflow-provider-sources.ts`

问题表现：

- 节点执行流程仍然由应用上下文附近的大协调器主导
- 协调器内部仍按 `node.type` 做显式分支
- 鉴权、通知、任务订阅、执行参数构建、节点特化规则混在一起
- `WorkflowContext` 虽然已有拆分，但仍是事实上的应用中心

直接风险：

- 新增任一节点能力时，仍倾向于回到该区域改代码
- 上下文层继续膨胀
- 回归面不断扩大
- 无法证明节点逻辑真正归属于节点域

### P0：Canvas 仍承担节点业务职责

核心问题文件：

- `frontend/src/components/canvas/Canvas.tsx`
- `frontend/src/components/canvas/node-renderers.tsx`

问题表现：

- 画布层仍做节点创建兜底
- 画布层仍维护节点视觉元数据
- 画布层仍承担部分节点类型知识
- renderer 注册与节点绑定逻辑仍和画布层耦合

直接风险：

- `Canvas.tsx` 继续扩大
- 新节点接入路径不唯一
- 通用画布层与节点业务边界模糊

### P0：`types` 与 `utils` 当前仍承担了错误的架构角色

相关文件：

- `frontend/src/types/index.ts`
- `frontend/src/utils/index.ts`

问题表现：

- `types` 目前不是“稳定基础类型层”，而是“全局业务类型汇总层”
- `utils` 目前不是“技术基础工具层”，而是“业务规则回收层”
- 这两个入口把真实依赖方向压平了

直接风险：

- 领域所有权丢失
- 类型循环和伪基础层依赖持续存在
- 通用导入入口掩盖真实耦合

### P1：节点规则并未完全回归节点域

相关目录：

- `frontend/src/nodes/**`
- `frontend/src/execution-runtime/**`
- `frontend/src/components/context/**`
- `frontend/src/components/canvas/**`

问题表现：

- 节点动作契约、运行时适配器、UI 组件已经初步建立
- 但节点相关特化逻辑仍散落在 context、canvas、runtime 多层
- 节点域尚未成为唯一规则归属地

### P1：测试结果可通过，但测试信号质量不够高

相关文件：

- `frontend/src/auth/AuthProvider.spec.tsx`
- `frontend/src/hooks/image/useImageResource.spec.ts`
- `frontend/scripts/run-tests.mjs`

问题表现：

- 存在 React `act` 警告
- 存在废弃测试 API
- 测试环境搭建不统一
- 测试脚本会生成临时和兼容产物

直接风险：

- 真回归更容易被噪音掩盖
- 测试维护成本持续增加

### P1：前端存在多处二级中心文件

代表文件：

- `frontend/src/services/image/image-manager.ts`
- `frontend/src/execution-runtime/execution-runtime.store.ts`
- `frontend/src/nodes/shared/runtime.ts`
- `frontend/src/services/workflow-file-normalizer.ts`
- `frontend/src/services/backendExecutionService.ts`

问题表现：

- 这些文件虽然没有 `Canvas.tsx` 那么显眼，但已经具备继续膨胀成新中心文件的条件

### P2：生成产物与临时文件治理不彻底

相关路径：

- `frontend/dist`
- `frontend/dist-tests`
- `frontend/.test-temp`
- `frontend/*.log`

问题表现：

- 产物与源码混在工作树里
- 影响检索、评估和理解效率

## 根因分析

### 根因一：缺少显式应用层

目前前端虽然有 `components/context/coordinators`，但目录语义仍属于 UI 上下文区域。  
实际上这些文件承担的是“应用用例层”职责。

没有显式 `application` 层时，最自然的结果就是：

- 上下文层吸收业务编排
- hook 吸收业务编排
- component 吸收业务编排

### 根因二：通用层没有被严格限制为“通用”

`Canvas`、`WorkflowContext`、`types`、`utils`、`services` 中都混入了不同程度的业务语义。  
一旦通用层拥有业务知识，它就会不可避免地成为耦合汇聚点。

### 根因三：历史治理偏向“先让门禁通过”

项目已经成功完成了从“基线不稳”到“质量门可运行”的恢复。  
这一步是必要的，但副作用是：

- 更优先处理了 fail-fast 问题
- 还没有彻底完成最终边界归位

### 根因四：共享入口掩盖了真实依赖图

`@/types` 和 `@/utils` 让很多模块看起来“只依赖通用层”，但实际上是通过 barrel 间接依赖了大量业务概念。

## 最终目标架构

### 目录分层定义

#### `components/`

职责：

- 页面壳层
- 画布壳层
- 对话框、表单、可视 UI
- React Flow 接线与渲染组合

禁止：

- 直接调 HTTP
- 直接做节点业务决策
- 直接做执行参数拼装

#### `hooks/`

职责：

- UI 交互状态组合
- 事件适配
- 视图层状态桥接

禁止：

- HTTP 调用
- 节点类型分支
- 工作流执行编排

#### `application/`

职责：

- 工作流保存、切换、执行、导入导出等用例
- 权限前置校验
- 通知策略
- 任务订阅策略
- 共享编排

禁止：

- JSX
- 直接定义节点业务规则

#### `nodes/`

职责：

- 节点元数据
- 节点组件
- 节点动作
- 节点执行参数构建
- 节点输入输出规则
- 节点分组与拖放规则

要求：

- 任何 `node.type` 相关逻辑只能在这里或节点运行时适配器内

#### `execution-runtime/`

职责：

- 通用执行 store
- 通用轮询
- 通用输出提交框架
- 通用运行时 patch 机制
- 通用适配器接口

禁止：

- 节点具体业务分支
- 节点 UI 知识

#### `services/`

职责：

- 浏览器文件处理
- 图片加载与缓存
- 本地归档
- 对象 URL 和运行时资源

禁止：

- HTTP 传输
- 工作流业务编排

#### `api/`

职责：

- HTTP 请求
- WebSocket 请求
- 认证 token 注入
- 传输错误映射

禁止：

- 执行业务决策
- 工作流状态回写

#### `contracts/`

职责：

- 业务共享契约
- DTO
- 工作流、执行、节点公共契约
- 纯类型接口

禁止：

- React
- 副作用

#### `types/`

职责：

- 稳定基础类型层

允许：

- `Result`
- branded IDs
- `Timestamp`
- `Position`
- `Dimensions`
- `BoundingBox`
- 基础错误模型

禁止：

- 工作流结构
- 节点配置
- 认证业务类型
- 执行业务类型
- API payload

#### `utils/`

职责：

- 技术基础工具层

允许：

- `utils/common/`
- `utils/logger/`
- `utils/performance/`

禁止：

- 工作流语义
- 节点语义
- 执行语义
- `node.type`
- `Workflow`
- `AINodeData`

## 完整整改方案

### 阶段 0：先升级规则与门禁

目标：

- 先定义未来不可退化的边界

执行项：

1. 更新 `docs/architecture-layer-rules.md`
2. 把 `application` 正式加入分层
3. 明确 `types` 为稳定基础层
4. 明确 `utils` 为技术基础工具层
5. 升级 `frontend/scripts/check-arch.mjs`
6. 将以下类别纳入阻断：
   - reverse dependency
   - cross-layer violation
   - runtime cycle
   - mixed cycle
   - type-only cycle
   - orphan candidate
   - root barrel import
7. 增加新的阻断扫描：
   - `components/**`、`hooks/**`、`application/**` 中禁止 `node.type ===`
   - 生产代码中禁止 `from '@/types'`
   - 生产代码中禁止 `from '@/utils'`
8. 增加文件预算门禁：
   - 业务实现文件上限 `500` 行
   - registry / index 文件上限 `200` 行

阶段完成标准：

- 新规则先以 report 模式验证
- 再切为 enforce 模式

### 阶段 1：修测试基座，恢复有效信号

目标：

- 让测试输出重新成为可靠信号

执行项：

1. 新建 `src/test-support/react/**`
2. 抽统一 DOM / root / flush / act 环境
3. 改造 `auth/AuthProvider.spec.tsx`
4. 统一替换 `react-dom/test-utils`
5. 整理其他自建 DOM 测试
6. 修改 `frontend/scripts/run-tests.mjs`
7. 移除根级 `dist-tests` 持久兼容产物策略

阶段完成标准：

- `frontend npm test` 无 React `act` 警告
- `frontend npm test` 无 deprecated 警告
- 测试环境基座唯一

### 阶段 2：收缩 `types` 为稳定基础层

目标：

- 保留 `types`
- 清空其业务层语义

执行项：

1. 删除 `src/types/index.ts`
2. 保留基础类型文件
3. 将业务类型迁移到对应契约层或节点层
4. 逐步替换所有 `from '@/types'`

迁移方向：

- `workflow*` -> `contracts/workflow/**`
- `node.types.ts` -> `nodes/shared/contracts/**`
- `file.types.ts` -> `contracts/files/**`
- `task / ai / execution` -> `contracts/execution/**`
- `auth-api / api.types` -> `contracts/api/**`
- `archive types` -> `contracts/archive/**`

阶段完成标准：

- `src/types/**` 只剩基础稳定类型
- `from '@/types'` 清零
- 现有 3 个 type-only cycles 清零

### 阶段 3：收缩 `utils` 为技术基础工具层

目标：

- 保留 `utils`
- 让其不再承载业务规则

执行项：

1. 删除 `src/utils/index.ts`
2. 保留并收紧：
   - `utils/common/`
   - `utils/logger/`
   - `utils/performance/`
3. 迁出：
   - `utils/node/**` -> `nodes/shared/**`
   - `utils/workflow/**` -> `contracts/workflow/**` 或 `application/workflow/**`
   - `utils/validators/**` -> `contracts/validation/**` 与 `nodes/**/validation.ts`
4. 替换所有 `from '@/utils'`

阶段完成标准：

- `from '@/utils'` 清零
- `utils/**` 中不存在业务语义
- `utils/**` 不依赖任何业务层

### 阶段 4：引入显式 `application` 层

目标：

- 把当前藏在 context 区域里的应用编排显式化

新增目录建议：

- `src/application/workflow/`
- `src/application/workflow-persistence/`
- `src/application/workflow-files/`
- `src/application/workflow-canvas/`
- `src/application/workflow-execution/`

执行项：

1. 拆 `workflow-execution-coordinator.ts`
2. 拆 `workflow-persistence-coordinator.ts`
3. 拆 `workflow-file-actions.ts`
4. 拆 `workflow-file-sync-coordinator.ts`
5. 删除 `components/context/coordinators/`
6. 精简 `WorkflowContext.tsx`
7. 删除 `useExecutionRuntime.ts`

阶段完成标准：

- `components/context` 只剩 provider 和 context 契约
- 应用编排全部落入 `application/**`

### 阶段 5：把节点业务彻底回归 `nodes`

目标：

- 所有节点特有规则都只有一个归属地

执行项：

1. 统一每个节点目录结构
2. 把 `node.type` 特化逻辑迁入节点动作和节点执行适配器
3. 规范 `nodes/shared/**` 为共享节点规则层
4. 拆 `nodes/shared/runtime.ts`
5. 保持 `nodes/registry.ts` 只做 metadata lookup

阶段完成标准：

- `components/**`、`hooks/**`、`application/**` 中不再出现节点业务分支
- 新节点接入只改节点目录与小型 registry

### 阶段 6：把 `Canvas` 降级为纯壳层

目标：

- 让画布重新只做画布

执行项：

1. 把节点创建用例迁出 `Canvas.tsx`
2. 把节点视觉元数据迁出 `Canvas.tsx`
3. 把 renderer registry 迁到 `nodes/renderers/**`
4. 把未知节点回退逻辑改为显式失败
5. 拆 `node-renderers.tsx`

阶段完成标准：

- `Canvas.tsx` 不再知道具体节点业务规则
- `Canvas.tsx` 只组合画布相关子层

### 阶段 7：清理 `services` / `api` 边界

目标：

- 基础设施与传输彻底分离

执行项：

1. `services/` 根目录清理，只留基础设施子域
2. 拆 `backendExecutionService.ts`
3. 拆 `workflow-file-normalizer.ts`
4. 拆 `image-manager.ts`
5. 阻断 `services -> api`

阶段完成标准：

- `api` 只传输
- `services` 只基础设施
- 业务编排不再夹在二者之间

### 阶段 8：运行时与 store 去中心化

目标：

- 防止 `execution-runtime` 形成新的中心区

执行项：

1. 拆 `execution-runtime.store.ts`
2. 拆 `execution-output-commit.*`
3. 拆 `execution-output-reconcile.*`
4. 调整默认 adapter 注册位置

阶段完成标准：

- `execution-runtime` 只保留通用机制
- 不吸收节点业务逻辑

### 阶段 9：死代码与产物治理

目标：

- 把架构报告中的残留问题清到零

执行项：

1. 清零 orphan candidate
2. 删除无消费者导出
3. 清理临时产物策略
4. 明确 `.gitignore` 和生成文件边界

阶段完成标准：

- `orphanCandidates = 0`
- 工作区检索默认只命中源码

## 防止拆出新高耦合中心的机制

### 规则一：每个文件只能有一个责任轴

允许的责任轴：

- UI
- 应用用例
- 节点业务
- 执行运行时
- 基础设施
- 传输
- 契约
- 基础类型
- 基础工具

一个文件只能属于其一。

### 规则二：registry 只能是声明式映射

registry 文件：

- 小于 `200` 行
- 不允许放业务逻辑
- 不允许发请求
- 不允许做副作用初始化

### 规则三：通用层不得出现业务分支

以下目录不允许出现节点类型分支：

- `components/**`
- `hooks/**`
- `application/**`
- `services/**`
- `utils/**`

### 规则四：基础层不得承载业务语义

- `types/**` 不得承载业务模型
- `utils/**` 不得承载业务规则

### 规则五：禁止 root mega-barrel

以下入口必须删除或禁止继续使用：

- `@/types`
- `@/utils`

## 风险与实施顺序

### 推荐实施顺序

1. 门禁升级
2. 测试基座修复
3. `types` 收缩
4. `utils` 收缩
5. 引入 `application`
6. 节点业务回归 `nodes`
7. `Canvas` 降级
8. `services/api` 分离
9. `execution-runtime` 去中心化
10. 死代码与产物清理

### 原因

- 测试信号不修，后续重构没有可靠反馈
- `types/utils` 不收，后续迁移会继续走旧入口
- `application` 不立，业务编排没有正确归属地
- 节点业务不回归，`Canvas` 和 context 会继续吸收规则

## 最终门禁与验收标准

### 命令验收

必须全部通过：

1. `npm --prefix ./frontend run typecheck`
2. `npm --prefix ./frontend run lint`
3. `npm --prefix ./frontend run arch:check`
4. `npm --prefix ./frontend test`
5. `npm --prefix ./backend run verify`

### 结构验收

必须全部成立：

- `reverseDependencyViolations = 0`
- `crossLayerViolations = 0`
- `runtimeCycles = 0`
- `mixedCycles = 0`
- `typeOnlyCycles = 0`
- `orphanCandidates = 0`

### 内容验收

以下检索必须清零：

1. `from '@/types'`
2. `from '@/utils'`
3. `react-dom/test-utils`
4. `node.type ===` in `components/**`
5. `node.type ===` in `hooks/**`
6. `node.type ===` in `application/**`

### 文件预算验收

以下要求必须满足：

- 业务实现文件不超过 `500` 行
- registry / index 文件不超过 `200` 行
- 不再存在新的超大“总协调器”或“总工具”文件

## 本报告的最终判断

当前项目不是“质量差到不能维护”，而是“质量门已恢复，但结构治理尚未完成”。

本次整改的关键不是把所有大文件打散，而是把职责重新压回正确层级：

- `application` 管编排
- `nodes` 管节点规则
- `execution-runtime` 管通用运行时
- `services` 管浏览器基础设施
- `api` 管传输
- `contracts` 管业务契约
- `types` 管稳定基础类型
- `utils` 管技术基础工具

只有在这个边界稳定后，`Canvas.tsx`、`WorkflowContext`、`types/index.ts`、`utils/index.ts` 这类历史中心问题才算被真正解决，而不是被表面拆散。

