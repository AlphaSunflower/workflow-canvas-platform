# 多视角修复节点一期联调验收与发布准备

## 1. 文档目的

本文档用于对一期目标“多视角修复节点真实运行”进行验收收口，明确：

- 当前一期验收范围
- 已完成的自动化验证
- 仍需执行的真实人工联调项
- 当前可交付结论
- 已知问题与发布前注意事项

本文档对应的唯一业务边界文档为：

- `backend/docs/AI-MULTI-VIEW-RESTORE.md`

## 2. 一期验收目标

一期验收目标不是完成完整的图像编辑平台，而是确认以下链路已经具备可交付条件：

1. 前端多视角修复节点可以提交 grouped 双输入任务
2. 后端可以接收每组 `renderFileId + referenceFileId` 并创建真实执行任务
3. Worker 可以按 RunningHub 链路执行：
   - 上传渲染图
   - 上传原视角参考图
   - 生成双输入 `nodeInfoList`
   - 创建工作流任务
   - 轮询查询结果 V2
   - 优先提取 `nodeId = 127` 的结果图
   - 下载结果图并落库
4. grouped 多任务可以并发执行
5. 单个 group 失败不会阻断其他 group 完成
6. 失败任务可按规则自动重试 2 次，总尝试 3 次
7. 查询接口可以回显输入、provider 任务标识、结果文件与事件过程

## 3. 最小联调配置

当前推荐使用统一配置文件：

- `backend/config/backend.config.json`

最小联调配置如下：

```json
{
  "runtime": {
    "nodeEnv": "development",
    "host": "127.0.0.1"
  },
  "services": {
    "api": {
      "port": 3100
    },
    "worker": {
      "port": 3200,
      "pollIntervalMs": 5000
    }
  },
  "providers": {
    "runninghub": {
      "apiKey": "YOUR_RUNNINGHUB_API_KEY",
      "apiBaseUrl": "https://www.runninghub.cn"
    }
  },
  "paths": {
    "providerSnapshotDir": "data/provider-snapshots"
  }
}
```

说明：

1. 自动化测试不依赖真实 `providers.runninghub.apiKey`
2. 真实人工联调必须填写有效 `providers.runninghub.apiKey`
3. `providerSnapshotDir` 必须保留，用于沉淀首次联调快照和样例

## 4. 当前自动化验收证据

### 4.1 创建请求校验与入库映射

对应测试文件：

- `backend/tests/ai-multi-view-restore.create.spec.ts`

覆盖内容：

1. `nodeType = aiMultiViewRestore`
2. `taskType = multi-view-restore`
3. `executionMode = legacy-grouped-task`
4. 每个 group 必须同时提供 `renderFileId` 与 `referenceFileId`
5. 同组两个文件不能相同
6. `ExecutionTask.input` 固定写入：
   - `renderFileId`
   - `referenceFileId`
   - `workflowId`
   - `workflowTemplateKey`
   - `renderInputNodeId`
   - `renderInputFieldName`
   - `referenceInputNodeId`
   - `referenceInputFieldName`
   - `outputNodeId`
   - `outputFileType`

### 4.2 RunningHub 模板装配与双输入映射

对应测试文件：

- `backend/tests/runninghub-workflow-template.spec.ts`

覆盖内容：

1. 双输入模板可从 `backend/runninghub/multi-view-restore_api.json` 读取
2. 节点 `124.image` 与 `102.image` 必须存在
3. 输出节点 `127` 必须存在
4. 能稳定生成合法双输入 `nodeInfoList`
5. 缺模板、缺节点、缺字段时会明确失败

### 4.3 多视角修复执行器

对应测试文件：

- `backend/tests/ai-multi-view-restore.executor.spec.ts`

覆盖内容：

1. 双输入上传
2. 双输入 `nodeInfoList` 生成
3. RunningHub 创建任务
4. 查询结果优先匹配 `nodeId = 127`
5. 未命中 `127` 且仅一个结果时允许回退
6. 未命中 `127` 且多个结果时明确失败
7. 结果图下载、保存、注册到统一 files 体系
8. `resultFileId`、事件、落库结果回填

### 4.4 查询回显与重试

对应测试文件：

- `backend/tests/executions.query.spec.ts`
- `backend/tests/queue.retry.spec.ts`

覆盖内容：

1. 查询接口回显：
   - `renderFileId`
   - `referenceFileId`
   - `workflowId`
   - `workflowTemplateKey`
   - `providerTaskId`
   - `providerClientId`
   - `resultFile`
2. 失败后自动重试 2 次，总尝试 3 次
3. 上传、创建、轮询、下载阶段事件可查

### 4.5 端到端闭环

对应测试文件：

- `backend/tests/ai-multi-view-restore.e2e.spec.ts`

覆盖内容：

1. 从创建任务到 Worker 自动消费形成闭环
2. 3 个 group 并发执行
3. 2 个 group 成功，1 个 group 失败
4. 成功 group 结果图能下载并落库
5. 失败 group 不阻断其他 group 完成
6. run 汇总状态、任务状态与事件流正确更新

## 5. 对一期要求的覆盖结论

### 5.1 已通过自动化验证

- 双输入 grouped 创建
- 双输入模板映射
- RunningHub 创建与查询解析
- `nodeId = 127` 优先提取
- 回退取唯一结果规则
- 多结果且未命中 127 时失败
- 结果图下载与落库
- 查询回显输入、provider 标识与结果文件
- 自动重试
- grouped 并发与端到端闭环

### 5.2 仍需真实人工联调确认

- 真实 RunningHub key 与真实工作流连通性
- 至少 2 组真实双输入图片的成功链路
- 真实 `promptTips` 异常场景
- 真实结果为空场景
- 真实输出节点 127 命中情况
- 首次真实成功/失败快照沉淀

## 6. 建议的真实联调输入

建议至少准备以下两组输入：

### 6.1 基础成功组

- 渲染图 A
- 原视角参考图 A

用途：

- 验证单 group 成功闭环
- 产出首个真实成功快照

### 6.2 grouped 并发组

- 渲染图 B + 原视角参考图 B
- 渲染图 C + 原视角参考图 C

用途：

- 验证 grouped 并发执行
- 验证多个 group 独立产出结果图

## 7. 建议覆盖的真实联调场景

1. 单 group 成功执行
2. grouped 双任务并发执行
3. RunningHub 上传失败
4. RunningHub 创建失败
5. `promptTips` 异常
6. 查询结果为空
7. 输出结果未命中 127
8. 结果图下载与落库成功

## 8. 当前已知问题

### 8.1 尚未完成首轮真实 RunningHub 人工联调

当前已经完成：

- 模拟 provider 的自动化闭环测试
- 事件、重试、查询回显测试
- grouped 并发与失败隔离测试

当前尚未完成：

- 真实 RunningHub 平台人工联调
- 真实成功/失败快照沉淀

### 8.2 自动化证据与真实联调证据需明确区分

当前自动化测试足以证明后端逻辑闭环成立，但不能直接替代真实 RunningHub 平台签收。

## 9. 发布前建议

建议按以下顺序完成发布前收尾：

1. 填写真实 `backend/config/backend.config.json`
2. 执行手工联调清单
3. 沉淀首份真实成功/失败样例
4. 回填 `backend/docs/examples/`
5. 复跑多视角修复自动化测试
6. 记录最终联调结论

## 10. 当前验收结论

基于当前仓库内已具备的自动化证据，可以给出当前阶段结论：

- 多视角修复节点后端核心能力已具备进入一期真实联调验收的条件
- 双输入映射、上传、创建、轮询、结果提取、落库、查询回显、重试和 grouped 并发都已有自动化证据支撑
- 但“真实 RunningHub 联调已完成”这一项当前还不能签收，因为尚未沉淀真实平台快照

因此当前状态建议定义为：

- `可进入一期真实 RunningHub 联调验收阶段`
- `尚未达到最终发布签收`
