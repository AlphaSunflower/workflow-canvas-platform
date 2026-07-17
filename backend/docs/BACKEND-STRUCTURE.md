# 后端结构蓝图

## 1. 文档目的

本文档定义 `backend/` 目录的职责划分，作为后续真正创建后端工程骨架时的实施蓝图。

## 2. 顶层目录

建议结构如下：

```text
backend/
  README.md
  docs/
  runninghub/
  api/
  worker/
  admin-web/
  shared/
  db/
  deploy/
  scripts/
  tests/
```

## 3. 各目录职责

### 3.1 docs

存放全部后端正式文档。

建议只放：

- 领域模型
- 接口规范
- 数据库设计
- 文件设计
- 执行/重试设计
- 调度设计
- 后台前端规范
- 错误码与事件规范

### 3.2 api

对外 API 服务。

职责：

- 认证与鉴权
- 账户注册、登录、refresh、logout、当前用户上下文
- Workflow 画布创建、保存、读取、列表摘要查询
- 文件注册/上传/查询
- 执行创建/取消/查询
- 任务详情/事件/尝试查询
- 管理员接口
- WebSocket / SSE 推送

建议内部模块：

- `auth`
- `users`
- `workflows`
- `files`
- `executions`
- `tasks`
- `admin`
- `realtime`

当前账户 MVP 仅覆盖：

- `member` / `admin` 两级角色
- 当前用户资料与密码管理
- 管理员账户管理
- Bearer Token 鉴权

当前不在 `api/` 层引入：

- 项目成员权限树
- 多租户隔离
- 复杂 RBAC

### 3.2A runninghub

存放后端正式运行依赖的 RunningHub 工作流模板。

当前用途：

- 作为 `aiImageToPly` 节点的一期正式模板来源
- 作为 `aiMultiViewRestore` 节点的一期正式模板来源
- 统一管理 RunningHub workflow JSON
- 避免正式运行依赖 `backend/` 外的模板文件

当前固定模板：

- 模板 key：`sharp-image-to-ply-v1`
- 文件：`runninghub/sharp_api.json`
- 工作流编号：`2014519004714508290`
- 输入节点：`1.image`
- 输出目标：SHARP 主输出

- 模板 key：`multi-view-restore-v1`
- 文件：`runninghub/multi-view-restore_api.json`
- 工作流编号：`2014516111097729025`
- 输入节点：
  - `124.image`
  - `102.image`
- 输出目标：`127`

### 3.3 worker

异步执行侧。

职责：

- 消费队列
- 申请 Key 租约
- 调用外部平台
- 保存产物
- 写入任务状态
- 调度重试

建议内部模块：

- `scheduler-consumer`
- `provider-adapters`
- `artifact-handler`
- `retry-handler`
- `storage`

当前一期 `storage` 模块职责：

- 统一本地文件存储目录规则
- 统一二进制写入与读取
- 统一 base64 转文件落盘
- 返回可直接写入数据库的存储元数据
- 为未来切换对象存储预留适配器边界

### 3.4 admin-web

独立后台前端。

职责：

- 管理员登录
- 总览仪表盘
- 用户管理
- 执行历史
- 任务详情
- Key 池管理

### 3.5 shared

后端共享层。

职责：

- 共享类型定义
- 错误码
- 事件类型
- DTO 协议
- 常量
- 公共工具

### 3.6 db

数据库层资源。

职责：

- 迁移脚本
- 初始化脚本
- 表结构说明

建议子目录：

- `migrations/`
- `schema/`
- `seeds/`

### 3.7 deploy

部署资源。

职责：

- docker compose
- 环境变量模板
- 本地开发依赖编排

### 3.8 scripts

脚本目录。

职责：

- 初始化环境
- 启动开发环境
- 构建
- 检查
- 清理临时数据

### 3.9 tests

后端整体测试目录。

职责：

- 集成测试
- 调度流程验证
- 文件去重验证
- 重试流程验证

## 4. 模块边界建议

### 4.1 auth 模块

负责：

- 注册
- 登录
- refresh
- logout
- token 校验
- 当前登录用户上下文恢复

### 4.2 users 模块

负责：

- 当前用户资料查询与更新
- 当前用户密码修改
- 创建用户
- 禁用/启用用户
- 重置密码
- 用户列表查询

### 4.3 files 模块

负责：

- 文件注册
- 哈希去重
- 上传
- 查询
- 下载
- 预览
- 按 `workflowId` 建立和解除逻辑绑定
- 将物理 blob 与逻辑 file asset 分层管理

### 4.4 workflows 模块

负责：

- 创建 workflow
- 保存完整画布快照
- 查询 workflow 列表摘要与详情
- 维护 workflow 与文件引用关系
- 汇总 workflow 级任务历史入口

### 4.5 executions 模块

负责：

- 创建执行主记录
- 取消执行
- 查询执行列表与详情
- 将执行入口显式绑定到 `workflowId`

### 4.6 tasks 模块

负责：

- 创建任务
- 查询任务详情
- 查询任务事件
- 查询任务尝试
- 汇总最终结果
- 提供按 `workflowId` 聚合的 task summary 查询
- 将 task event 独立为 JSONL 事件流

### 4.7 scheduler 模块

负责：

- 队列管理
- 按能力池调度
- 重试重入
- 并发控制

### 4.8 key-pool 模块

负责：

- Key 元数据管理
- Key 状态管理
- 并发槽位管理
- 熔断管理

### 4.9 providers 模块

负责：

- 屏蔽不同平台差异
- 统一执行接口
- 统一产物接收模型

### 4.10 storage 模块

负责：

- 输入图保存
- 中间产物保存
- 最终结果图保存
- Workflow 分片 JSON 持久化
- task event JSONL 追加写
- 按 `storageKey` 读取文件
- 统一落盘元数据
- 屏蔽本地存储与后续对象存储差异

### 4.11 admin 模块

负责：

- 总览统计
- 用户管理接口
- Key 池管理接口

## 5. 一期推荐推进顺序

建议按以下顺序真正建工程：

1. `shared`
2. `db`
3. `api/auth`
4. `api/users`
5. `api/files`
6. `api/executions`
7. `api/tasks`
8. `worker/storage`
9. `worker/scheduler-consumer`
10. `worker/provider-adapters`
11. `admin-web`

## 5A. Workflow Backendization 存储基线

为避免单文件膨胀与全局锁竞争，当前阶段推荐按下列目录分片：

```text
backend/data/
  workflows/
    index.json
    {workflowId}/
      workflow.json
      files.json
      tasks.json
      events/
        {taskId}.jsonl
  executions/
    runs/
      {runId}.json
  files/
    files-store.json

backend/storage/
  blobs/
    {sha256-prefix}/
      {sha256}.{ext}
```

补充约束：

- `index.json` 只存 workflow 摘要
- `workflow.json` 保存完整画布节点、连接、视口和元数据
- `files.json` 保存 workflow 关联文件引用摘要
- `tasks.json` 保存 workflow 聚合的 task summary
- `events/{taskId}.jsonl` 使用追加写，不重写全量历史
- 写入锁按 workflow、task、blob 等分片，不使用全局大锁

## 6. 一期不做的结构

一期不要求：

- 项目模块
- 快照模块
- 复杂插件系统
- 多租户隔离层
- 复杂 RBAC 权限子系统
