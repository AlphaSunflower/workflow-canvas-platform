# 性能护栏

本文档约束画布后端化 MVP 的性能边界，目标是先把高频链路稳定住，避免文件同步、画布保存、任务历史写入在单机 JSON Store 模式下失控。

## 1. 适用范围

- 文件入画布即上传
- 画布保存/读取主链路
- 执行创建前文件就绪调度
- 按画布查询任务历史与事件流

## 2. 前端护栏

### 2.1 文件哈希与上传

- 文件进入画布后立即进入上传调度，但必须先做本地去重与后端 register 预检。
- 哈希计算必须放在 Worker 中，避免阻塞主线程。
- 单标签页默认哈希并发建议值：`2`
- 单标签页默认上传并发建议值：`2-3`
- 相同文件内容在同一会话内必须单飞，避免重复哈希、重复 register、重复 upload。
- 任务触发时，只允许提升“当前任务依赖文件”的优先级，不允许无上限抢占全部队列。

### 2.2 画布保存

- 画布保存必须走 debounce，基线窗口：`800ms-1500ms`
- 同一画布同一时刻只允许一个保存请求在飞行中。
- 若保存期间有新快照进入，只保留最新一次 trailing save。
- 保存前必须检查节点依赖文件是否已完成同步；存在 `waiting/hash/register/upload` 状态时阻止提交。
- 画布列表接口只返回 summary，完整 Workflow 仅在详情接口返回。

### 2.3 前端内存与 URL 生命周期

- Blob 预览必须通过 object URL 管理器统一创建与释放。
- 节点删除、文件解绑、组件卸载后必须回收不再使用的 object URL。
- 画布持久化内容禁止包含浏览器 `File` 对象、`blob:` URL、临时本地状态。

## 3. 后端护栏

### 3.1 分片与锁

- Workflow 采用 `workflowId` 分片存储，禁止回退到单大 JSON 文件。
- 每个 workflow 仅锁自己的 `workflow.json`、`files.json`、`task-history` 分片。
- 文件库锁与账户库锁分离，避免跨域全局锁竞争。
- 锁文件必须具备超时与陈旧锁清理逻辑。

### 3.2 原子写与追加写

- `index.json`、`workflow.json`、`files-store.json` 等覆盖式文件必须采用临时文件 + rename 原子写。
- 任务事件流使用 JSONL 追加写，不重写全量事件文件。
- 高频运行态事件仅写必要字段，避免把大对象重复写入 JSONL。

### 3.3 文件库存储

- 二进制上传为主协议，JSON base64 仅保留兼容路径。
- 物理文件采用内容寻址布局：`storage/blobs/{sha256-prefix}/{sha256}.{ext}`
- 同内容文件不重复落盘，只新增 file asset 归属记录。
- 解除 workflow 文件绑定时只删关系，不删物理 blob，不删 file asset。

### 3.4 查询与分页

- 画布列表、任务历史列表必须分页。
- 任务事件接口允许独立分页与排序，避免一次性返回整条长历史。
- 列表接口默认返回摘要字段；大字段如完整输入、完整事件流只在详情或事件接口读取。

## 4. 存储布局基线

```text
backend/data/
  accounts-store.json
  storage-index.json
  files/
    files-store.json
  workflows/
    index.json
    {workflowId}/
      workflow.json
      files.json
      task-history/
        index.json
        events/
          {taskId}.jsonl

backend/storage/
  blobs/
    {sha256-prefix}/
      {sha256}.{ext}
```

说明：

- `task-history` 分片按 workflow 懒初始化，不在系统启动时预建空画布目录。
- `files.json` 仅保存 workflow 与 file 的绑定关系，不作为文件真源。

## 5. 日志与观测约束

- 默认日志只记录 id、状态、耗时、错误码，不打印整份 workflow 或大体积二进制内容。
- 单条日志不应直接输出 base64 文件内容、完整任务事件流、完整节点大对象。
- provider snapshot 属于排障材料，必须单独落盘，不混入常规结构化日志。

## 6. 当前不做

- 多实例分布式锁
- 海量历史归档与冷热分层
- 画布协同编辑冲突合并
- 物理文件垃圾回收与引用计数回收

## 7. 演进触发条件

出现以下任一情况时，应优先升级存储层，而不是继续堆叠 JSON Store：

- 单工作流画布 JSON 长期超过 `1-2 MB`
- 单 workflow 任务历史长期超过 `10k` 条
- 单机高频保存导致锁等待明显增长
- 文件并发上传长期超过当前单机磁盘吞吐可承受范围
