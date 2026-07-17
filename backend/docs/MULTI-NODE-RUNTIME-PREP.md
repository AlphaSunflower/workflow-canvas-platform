# 多节点真实运行接入准备说明

## 1. 目的

本文档用于在当前后端已经跑通白模渲染节点的基础上，整理“为其他节点接入后端真实运行支持”前的准备状态、现有可复用能力、当前硬编码点，以及建议的最小落地顺序。

本文档不是替代现有正式协议，而是作为进入第二个节点开发前的实现准备说明。

相关基线文档：

- `docs/WHITE-MODEL-RENDER-V1.md`
- `docs/API-SPEC.md`
- `docs/EXECUTION-AND-RETRY.md`
- `docs/BACKEND-NODE-PARALLEL-DEVELOPMENT-SPEC.md`

## 2. 当前后端已经具备的可复用能力

当前后端虽然只正式支持白模渲染节点，但下面这些能力已经具备明显复用价值：

### 2.1 文件资产链路

- 文件注册
- 去重上传
- 逻辑文件与物理 blob 绑定
- 文件元数据查询
- 文件原始内容读取

对应实现：

- `api/src/modules/files/files.repository.ts`
- `api/src/modules/files/files.service.ts`
- `api/src/modules/files/files.controller.ts`

### 2.2 执行主链路

- `ExecutionRun` 创建
- `ExecutionTask` 创建
- 任务排队
- Worker 轮询领取
- 完成/失败状态回写
- 事件流记录

对应实现：

- `api/src/modules/executions/executions.repository.ts`
- `worker/src/modules/queue/queue.service.ts`
- `worker/src/modules/execution-events/execution-event.service.ts`
- `worker/src/modules/execution-run/execution-run.service.ts`

### 2.3 重试能力

- 固定最大重试次数
- 重试间隔策略
- 错误标准化
- 重试事件回传

对应实现：

- `worker/src/modules/retry/retry-policy.service.ts`

### 2.4 存储能力

- base64 结果落盘
- 本地存储适配
- 存储元数据返回

对应实现：

- `worker/src/modules/storage/storage.service.ts`
- `worker/src/modules/storage/local-storage.adapter.ts`

### 2.5 Provider 调用封装

当前已具备一个外部图片生成 Provider 的封装样板：

- 请求构造
- 返回解析
- 错误分类
- 响应快照

对应实现：

- `worker/src/modules/providers/laozhang/*`

### 2.6 查询接口

当前已具备 run / task / event 查询接口，可继续复用统一查询入口：

- `GET /api/v1/executions/:id`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:id`
- `GET /api/v1/tasks/:id/events`

## 3. 当前不适合直接扩展新节点的硬编码点

虽然上面的基础设施可以复用，但当前代码仍然存在明显“白模节点特化”，直接继续叠加新节点会快速变得不可维护。

### 3.1 共享协议仍然绑定白模节点

当前执行创建请求与查询结构都还是白模专属：

- `shared/src/types/api/executions.ts`
- `shared/src/types/api/execution-query.ts`

典型问题：

- `CreateExecutionRequest` 的 `nodeType` 被写死为 `aiModelRenderTransfer`
- `groups` 被写死为 `whiteModelFileId + styleReferenceFileId`
- 任务查询结果被写死返回 `whiteModelFile / styleReferenceFile / resultFile`

这意味着第二个节点一旦输入结构不同，就不能直接复用现有 DTO。

### 3.2 API 创建链路仍然只接受白模节点

当前执行创建接口仍是白模专属校验：

- `api/src/modules/executions/executions.dto.ts`
- `api/src/modules/executions/executions.controller.ts`
- `api/src/modules/executions/executions.service.ts`

典型问题：

- `nodeType`
- `taskType`
- `executionMode`
- group 输入字段

都仍然是白模固定值。

### 3.3 任务存储模型仍然绑定白模输入字段

当前 `ExecutionTaskRecord` 中直接包含：

- `whiteModelFileId`
- `styleReferenceFileId`

对应实现：

- `api/src/modules/executions/executions.repository.ts`

这会导致：

- 每增加一个输入结构不同的节点，就要继续在任务表记录上新增一组专属字段
- 查询层也会被迫继续堆节点特化字段

### 3.4 Worker 调度入口仍然只认识白模执行器

当前 Worker 入口和队列服务仍直接依赖白模执行器：

- `worker/src/app.ts`
- `worker/src/modules/queue/queue.service.ts`

典型问题：

- `QueueTaskExecutor` 输入类型还是 `WhiteModelRenderExecutorInput`
- 默认执行器直接是 `WhiteModelRenderExecutor`
- 没有基于 `nodeType` 的执行器注册与路由层

### 3.5 中间产物服务仍然是白模特化包装

虽然中间产物仓储和锁本身有复用价值，但当前 service 入口还是白模专属：

- `worker/src/modules/intermediate/intermediate-artifact.service.ts`

典型问题：

- 入口方法名是 `resolveWhiteModelArtifacts`
- 缓存键构造直接绑定白模常量
- provider/model/pipeline/prompt 版本都直接从白模常量取值

### 3.6 重试错误归一化中仍有白模错误码

当前重试层仍然识别若干白模专属运行时错误字符串：

- `worker/src/modules/retry/retry-policy.service.ts`

这意味着新增节点后，如果继续靠字符串判断运行时错误，维护成本会越来越高。

## 4. 新增其他节点前建议先完成的最小抽象

根据当前实现状态，不建议一上来重写整个后端，而建议先做下面几步“注册式抽象”。

### 4.1 先把任务输入从“白模字段”抽成“节点负载”

建议目标：

- `ExecutionTaskRecord` 保留通用字段
- 节点专属输入统一收敛到 `taskPayload`
- 文件输入统一用角色化结构表达，而不是继续写死字段名

最小可行方案：

- 新增 `taskPayload`
- 新增 `inputFiles` 或 `fileRefs`
- 保留现有白模字段一小段兼容期，随后逐步迁移

不建议继续做法：

- 再为每个节点往 `ExecutionTaskRecord` 中加一组 `<node>FileId`

### 4.2 API 层改成“节点注册表 + 节点校验器”

建议把 `executions` 模块改成：

- 统一 controller
- 统一 service
- 按 `nodeType` 查找对应校验器 / task builder

建议新增：

- `api/src/modules/executions/execution-node.registry.ts`
- 每个节点自己的 DTO 校验与 payload 构造文件

目标是：

- 白模节点继续走现有接口
- 新节点只新增注册项，不复制整套 executions 模块

### 4.3 Worker 层改成“执行器注册表 + 按 nodeType 路由”

建议把当前 `QueueService -> WhiteModelRenderExecutor` 的直接依赖改成：

- `QueueService -> ExecutorRegistry -> NodeExecutor`

建议目标接口：

- 输入是通用任务记录
- 路由依据是 `nodeType`
- 每个节点自己负责解释自己的 `taskPayload`

这样新增节点时，只需要：

- 新增执行器文件
- 注册到统一执行器注册表

而不是修改队列主流程的大段 if/else。

### 4.4 查询层改成通用输入输出视图

当前查询结构中的：

- `whiteModelFile`
- `styleReferenceFile`

应逐步演化为更通用的结构，例如：

- `inputFiles[]`
- `outputFiles[]`
- `resultFiles[]`

或至少增加：

- `inputFileRefs[]`

然后对白模节点继续做兼容映射。

否则新增节点后：

- 查询接口
- 前端状态展示
- 任务详情页

都会被节点特化字段拖住。

### 4.5 中间产物服务抽成通用 artifact API

建议保留当前仓储与锁机制，但把 service 改成：

- 通用 `resolveArtifacts`
- 节点自己传入缓存键要素
- 白模节点只是一种调用方式

这样后续如果别的节点也有：

- 预处理图
- 遮罩图
- 草图图
- 深度图

就可以继续复用同一套机制。

## 5. 建议的最小实施顺序

为了降低对白模现有链路的回归风险，建议按下面顺序推进。

### 第一步

补共享层与任务层抽象：

- 给任务记录补 `nodeType`
- 给任务记录补通用 `taskPayload`
- 给共享类型补节点注册所需的通用类型

### 第二步

补 Worker 注册式路由：

- 新建执行器注册表
- 让白模执行器先接入注册表
- 保证白模测试仍全部通过

### 第三步

补 API 注册式创建：

- 执行创建接口按 `nodeType` 路由校验器
- 白模节点先迁入注册表模式
- 新节点随后只新增注册项

### 第四步

补查询层通用返回：

- 引入通用输入文件引用结构
- 保留白模兼容字段一段时间
- 等前端改完后再收口

### 第五步

新增第一个非白模节点：

- 节点常量
- 节点 DTO
- 节点执行器
- 节点测试
- 节点文档

## 6. 当前阶段不建议做的事

在没有具体节点需求落地前，当前不建议直接做这些大改：

- 重写整个 `files.repository.ts`
- 重写整个 `executions.repository.ts`
- 重写整个 `queue.service.ts` 主流程
- 一次性设计完整 DAG/工作流编排系统
- 为新节点单独新建第二套查询接口

当前更合理的目标是：

- 在不破坏白模链路的前提下，把白模专属硬编码收敛到节点注册与节点执行器内部

## 7. 第二个节点接入前的完成判定

在真正开始写第二个节点执行器前，至少建议满足：

1. Worker 已能基于 `nodeType` 路由执行器
2. 任务记录不再只能表达白模输入
3. 执行创建接口不再只接受白模固定 DTO
4. 查询接口至少有一个通用输入文件表示法
5. 白模节点原有单测、重试测试、端到端测试仍通过

达到这一步后，再接入其他节点，后续实现才会是“新增节点能力”，而不是“继续复制白模分支”。
