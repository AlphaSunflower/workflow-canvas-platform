# 后端节点并行开发与融合规范

## 1. 文档目的

本文档用于约束当前后端在“多个节点后端逻辑并行开发”场景下的开发方式、文件边界、协议复用规则和融合要求。

当前你准备开启两个并行开发线程，分别开发两个节点的后端逻辑，并最终与现有后端融合。  
本规范的目标不是限制开发速度，而是避免以下问题：

- 两个线程各自定义一套执行模型，最终无法合并
- 两个线程同时修改同一批核心文件，导致大量冲突
- 新节点直接复制白模逻辑，形成后续不可维护的分叉实现
- API、Worker、文件资产、事件流、错误码、任务状态出现多套命名

本文档是并行开发时的正式协作规范。  
如与零散口头约定冲突，以本文档为准。

## 2. 当前后端基线

当前后端已经具备以下基础能力：

- `backend/api/`
  对外 HTTP API
- `backend/worker/`
  任务消费、调度、执行、重试
- `backend/shared/`
  共享常量、类型、执行协议
- `backend/docs/`
  现有正式设计文档

当前已正式跑通的节点基线为：

- 白模渲染节点 `aiModelRenderTransfer`

当前白模节点已经提供了并行开发新节点时必须复用的基础设施：

- 文件注册与文件上传
- 执行创建接口
- run / task 查询接口
- Worker 调度与重试
- 外部 provider 调用封装
- 中间产物缓存机制
- 任务事件流
- 结果文件回写

因此，后续新节点开发的原则不是“另起一套后端”，而是“基于现有后端框架新增节点执行能力”。

## 3. 总体原则

### 3.1 必须复用现有后端骨架

两个并行线程都必须基于当前 `backend/` 目录下的现有 API、Worker、Shared 结构开发。  
不得在 `backend/` 外新建独立后端实现。  
不得为单个节点单独复制一份 API 服务或 Worker 服务。

### 3.2 必须复用统一领域模型

所有新节点都必须复用当前共享领域模型，不允许各自定义一套新的：

- 任务状态
- 步骤类型
- 错误分类
- 文件来源类型
- 执行返回结构
- 事件类型命名风格

共享定义应统一维护在：

- `backend/shared/src/constants/*`
- `backend/shared/src/types/*`

### 3.3 新节点属于“新增执行能力”，不是“新增系统”

后续节点开发应理解为：

- 新增一种 `nodeType`
- 新增一种对应的执行输入校验
- 新增一种对应的 Worker 执行器
- 复用已有执行调度、任务记录、事件记录、文件管理、结果查询能力

不得把新节点开发理解为重新造：

- 一套新的任务系统
- 一套新的文件系统
- 一套新的事件系统
- 一套新的调度系统

### 3.4 并行开发必须尽量减少核心共享文件冲突

两个线程必须优先在各自节点专属文件中开发。  
只有在确实需要扩展共享协议时，才修改共享核心文件。

推荐思路是：

- 线程 A 主要新增节点 A 相关文件
- 线程 B 主要新增节点 B 相关文件
- 对共享文件的修改收敛在少量、可预期的注册入口

## 4. 并行开发的分层要求

并行开发时，后端改动分为四层：

### 4.1 共享协议层

职责：

- 节点类型常量
- 执行状态与步骤类型
- API DTO
- 错误码
- 默认参数常量

目录：

- `backend/shared/src/constants/`
- `backend/shared/src/types/`

要求：

- 这里的修改必须最谨慎
- 命名必须统一
- 不能出现节点 A 一套、节点 B 一套的重复结构

### 4.2 API 接入层

职责：

- 接收前端执行请求
- 校验输入
- 创建 run / task
- 查询执行状态与结果

目录：

- `backend/api/src/modules/executions/`

要求：

- 当前建议继续走统一 `executions` 模块
- 不建议为每个节点复制一套 controller/service/repository
- 节点差异主要体现在 DTO 校验与任务创建逻辑映射

### 4.3 Worker 执行层

职责：

- 消费任务
- 路由到具体节点执行器
- 调用 provider
- 写入事件
- 回写结果

目录：

- `backend/worker/src/modules/executors/`
- `backend/worker/src/modules/providers/`
- `backend/worker/src/modules/intermediate/`
- `backend/worker/src/modules/storage/`
- `backend/worker/src/modules/retry/`

要求：

- 每个节点应新增自己的执行器文件
- 能复用的 provider、storage、retry、event 逻辑必须复用
- 不允许把节点专属逻辑塞回 queue 主流程中硬编码

### 4.4 文档与验收层

职责：

- 节点开发文档
- 接口补充
- 错误码补充
- 联调样例补充

目录：

- `backend/docs/`
- `backend/docs/examples/`

要求：

- 每个新节点都必须补文档
- 不允许只改代码不写协议与验收说明

## 5. 两个并行线程的推荐文件边界

为了减少冲突，建议按“节点专属文件归属”开发。

### 5.1 可各自独立新增的文件

这类文件最适合两个线程并行开发：

- `backend/shared/src/constants/<node>.ts`
- `backend/worker/src/modules/executors/<node>.executor.ts`
- `backend/worker/src/modules/executors/<node>.types.ts`
- `backend/tests/<node>.*.spec.ts`
- `backend/docs/<NODE-NAME>.md`

如果某个节点需要专属 provider 封装，也可新增：

- `backend/worker/src/modules/providers/<provider>/<node>.*.ts`

### 5.2 必须谨慎修改的共享文件

以下文件属于高冲突文件，两个线程都可能需要改，但必须控制改动范围：

- `backend/shared/src/constants/execution.ts`
- `backend/shared/src/types/execution.ts`
- `backend/shared/src/types/api/executions.ts`
- `backend/api/src/modules/executions/executions.dto.ts`
- `backend/api/src/modules/executions/executions.service.ts`
- `backend/api/src/modules/executions/executions.controller.ts`
- `backend/worker/src/modules/queue/queue.service.ts`
- `backend/worker/src/modules/execution-run/execution-run.service.ts`

原则：

- 只做“注册式扩展”
- 不做大范围重写
- 不把白模专属硬编码复制成更多 if/else 堆积

### 5.3 当前不建议并行同时重构的文件

以下文件如果要大改，建议单线程集中处理，不适合多个线程同时重构：

- `backend/api/src/modules/executions/executions.repository.ts`
- `backend/api/src/modules/files/files.repository.ts`
- `backend/worker/src/modules/queue/queue.service.ts`
- `backend/worker/src/modules/storage/storage.service.ts`

原因：

- 这些文件是当前执行主链核心
- 同时修改非常容易引发融合冲突
- 一旦逻辑分叉，后续排障成本很高

## 6. 新节点必须对齐的统一能力

每个新节点接入后端时，必须对齐以下统一能力。

### 6.1 执行主记录模型

所有节点都必须继续复用：

- `runId`
- `runNo`
- `taskId`
- `taskNo`
- `nodeType`
- `status`
- `createdAt`
- `startedAt`
- `completedAt`

不得为新节点单独设计另一套任务编号体系。

### 6.2 统一任务状态

所有节点必须使用统一任务状态：

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

如确实需要新增状态，必须先补共享常量与文档，不允许节点私有状态直接写入数据库。

### 6.3 统一步骤事件流

所有节点都必须支持步骤级事件记录。  
事件命名应沿用当前风格：

- `step_xxx_started`
- `step_xxx_completed`
- `step_cache_hit`
- `task_started`
- `task_completed`
- `task_failed`

如果新节点步骤不同，只允许扩展步骤名，不允许另起完全不同的事件体系。

### 6.4 统一错误分类

所有节点都必须继续复用统一错误分类：

- Provider 错误
- 网络错误
- 协议解析错误
- 输入文件错误
- 结果保存错误
- 未知错误

节点专属错误码可以新增，但必须挂在统一错误体系下。

### 6.5 统一文件资产处理

所有节点的输入、输出、中间产物都必须继续通过现有文件资产体系落库和落盘。  
不得让新节点绕开 `files` 模块直接写一套私有文件索引。

### 6.6 统一查询接口风格

所有节点最终都应尽量继续通过统一执行查询接口返回状态和结果。  
不建议为每个节点单独提供一套完全不同的状态查询接口。

## 7. 新节点的标准接入方式

每个新节点后端开发应按以下顺序接入。

### 7.1 定义节点常量与共享类型

新增内容应包括：

- 节点类型常量
- 默认参数常量
- 必要的步骤类型补充
- 节点执行请求结构
- 节点结果结构

建议位置：

- `backend/shared/src/constants/<node>.ts`
- `backend/shared/src/types/api/<node>.ts`

### 7.2 扩展执行创建接口

在统一 `executions` 模块中完成：

- 输入 DTO 校验
- 节点类型识别
- 任务记录创建
- 统一 run / task 写入

要求：

- 只扩展，不复制整套 `executions` 模块

### 7.3 新增 Worker 执行器

为每个节点新增一个专属执行器：

- 读取输入文件
- 调用 provider
- 写入步骤事件
- 保存结果文件
- 回填结果 fileId

建议位置：

- `backend/worker/src/modules/executors/<node>.executor.ts`

### 7.4 挂接到统一调度入口

Worker 必须通过统一调度入口路由到对应执行器。  
建议做法是逐步引入“按 nodeType 路由执行器”的结构，而不是继续堆硬编码。

### 7.5 补测试与样例

至少补齐：

- 执行器单测
- provider 解析单测
- 任务创建接口测试
- 一份成功样例
- 一份失败样例

## 8. 并行开发时的融合规则

### 8.1 共享文件改动必须收敛

两个线程如果都需要改共享文件，必须遵循以下要求：

- 一次只加必要入口
- 不改动无关旧逻辑
- 不顺手重构核心流程
- 不修改另一线程未完成的节点专属文件

### 8.2 优先“新增文件”，少做“大文件内混写”

推荐：

- 新增节点常量文件
- 新增节点执行器文件
- 新增节点文档文件

不推荐：

- 在已有白模执行器中直接改成多节点混合大文件
- 在一个共享文件中堆多个节点的大段专属逻辑

### 8.3 融合顺序建议

建议最终合并顺序如下：

1. 先合并共享常量与共享类型
2. 再合并 API DTO 与执行创建扩展
3. 再合并各自节点执行器
4. 最后合并 Worker 路由入口

这样可以最大限度减少回滚与返工。

### 8.4 不允许回退现有白模链路

并行开发两个新节点时，不能破坏当前白模节点已经打通的链路。  
任何共享改动都必须满足：

- 白模节点仍可创建任务
- 白模节点仍可查询状态
- 白模节点仍可执行重试
- 白模节点仍可回写结果

## 9. 对两个并行线程的具体建议

如果当前准备并行开发两个节点，推荐按以下方式分工。

### 线程 A

负责：

- 节点 A 专属常量
- 节点 A API 输入映射
- 节点 A 执行器
- 节点 A 文档与测试

尽量不要负责：

- 大范围重构 `executions.repository.ts`
- 大范围重构 queue 核心流程

### 线程 B

负责：

- 节点 B 专属常量
- 节点 B API 输入映射
- 节点 B 执行器
- 节点 B 文档与测试

尽量不要负责：

- 大范围重构 `files.repository.ts`
- 大范围重构 storage 核心能力

### 共享整合线程

建议保留一个最终融合责任人，专门处理：

- 共享类型合并
- Worker 路由入口合并
- API 入口合并
- 最终联调

如果没有单独整合线程，则必须约定由其中一个线程承担最终融合责任。

## 10. 当前阶段允许与不允许的改动

### 10.1 当前允许

- 新增节点常量
- 新增节点执行器
- 新增节点 API 输入映射
- 新增节点 provider 调用封装
- 新增节点中间产物处理逻辑
- 新增节点文档与测试

### 10.2 当前不建议

- 重写整个 executions repository
- 重写整个 files repository
- 重写整个 queue service
- 在本轮同时推进后端并发调度架构重构
- 为新节点单独创建新的任务系统

### 10.3 当前明确不允许

- 绕开当前共享执行模型单独造 run/task 编号体系
- 绕开 files 模块私自落库文件索引
- 绕开统一执行查询接口另起一套节点私有查询体系
- 在 `backend/` 外另起一套平行后端实现

## 11. 文档更新要求

每新增一个真实后端节点，至少需要同步补以下文档之一：

- 新节点专属执行文档
- API-SPEC 中的节点执行请求补充
- ERROR-AND-EVENT-SPEC 中的步骤与错误补充
- examples 中的成功/失败样例

不允许仅靠口头描述保留节点协议。

## 12. 当前建议的最小执行策略

基于当前阶段目标，建议你现在这样推进：

1. 后端继续沿用当前统一 API 与 Worker 框架
2. 两个并行线程分别各自实现一个新节点的专属执行器与专属常量文件
3. 所有共享类型改动收敛到少量注册入口
4. 最后统一做一次融合与回归测试
5. 在白模节点不回退的前提下，再逐步抽象多节点执行器路由

## 13. 验收标准

当两个并行线程开发完成并融合后，应至少满足以下标准：

- 两个新节点都已并入当前 `backend/` 主框架
- 白模节点原有真实执行链路未被破坏
- 三个节点共用同一套 run / task / 文件 / 事件 / 重试体系
- 没有出现节点私有的一套编号体系、文件体系或查询体系
- 共享文件的修改仍然可读、可维护，没有演化成大量节点硬编码堆积

