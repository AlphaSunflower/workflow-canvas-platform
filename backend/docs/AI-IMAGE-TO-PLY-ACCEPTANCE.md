# 图片转模型节点一期联调验收与发布准备

## 1. 文档目的

本文档用于对一期目标“图片转模型节点真实运行”进行验收收口，明确：

- 当前一期验收范围
- 已完成的自动化验证
- 仍需执行的真实人工联调项
- 当前可交付结论
- 已知问题与发布前注意事项

本文档对应的一期唯一业务边界文档为：

- `backend/docs/AI-IMAGE-TO-PLY.md`

## 2. 一期验收目标

一期验收目标不是完成完整的 3D 资产平台，而是确认以下链路已经具备可交付条件：

1. 前端图片转模型节点可以提交 grouped 输入
2. 后端可以接收输入文件并创建真实执行任务
3. Worker 可以按 RunningHub 链路执行：
   - 上传输入图片
   - 创建工作流任务
   - 轮询查询结果 V2
   - 下载 `ply` 文件
   - 落库并回写 `resultFileId`
4. grouped 多任务可以并发执行
5. 失败任务可以按规则自动重试
6. `promptTips` 异常、结果为空、非 `ply` 返回等异常可以被明确判定
7. 最终结果、步骤事件、错误信息可查询

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

1. 本地自动化测试不依赖真实 `providers.runninghub.apiKey`
2. 真实人工联调必须填写有效 `providers.runninghub.apiKey`
3. `providerSnapshotDir` 必须保留，用于沉淀首次真实联调快照

## 4. 当前自动化验收证据

当前仓库中，图片转模型节点已具备以下自动化证据来源：

### 4.1 创建请求校验与入库映射

对应测试文件：

- `backend/tests/ai-image-to-ply.create.spec.ts`

覆盖内容：

1. `nodeType = aiImageToPly`
2. `taskType = image-to-ply`
3. `executionMode = legacy-grouped-task`
4. 每个 group 必须有且仅有 1 个 `sourceFileId`
5. 非法 `taskType / executionMode / groups / sourceFileId` 会被明确拦截
6. 每条 `ExecutionTask.input` 会固定写入：
   - `sourceFileId`
   - `workflowId`
   - `workflowTemplateKey`
   - `workflowInputNodeId`
   - `workflowInputFieldName`
   - `outputFileType`

### 4.2 RunningHub 客户端解析与错误分类

对应测试文件：

- `backend/tests/providers.runninghub.spec.ts`
- `backend/tests/runninghub-prompt-tips.spec.ts`

覆盖内容：

1. Bearer 鉴权头与请求体组装
2. 上传返回 `data.fileName` 解析
3. 创建返回 `taskId / clientId / taskStatus / promptTips` 解析
4. 查询结果 V2 返回 `taskStatus / results` 解析
5. `promptTips.result = false`
6. `promptTips.error` 非空
7. `promptTips.node_errors` 非空
8. 非法 `promptTips` JSON 保留原文与 `invalid_json`
9. `PROVIDER_ERROR / INVALID_RESPONSE / NETWORK_ERROR` 分类

### 4.3 工作流模板映射

对应测试文件：

- `backend/tests/runninghub-workflow-template.spec.ts`

覆盖内容：

1. 工作流模板可从 `backend/runninghub/sharp_api.json` 正常读取
2. 固定校验节点 `1` 存在
3. 固定校验字段 `image` 存在
4. 可生成合法 `nodeInfoList`
5. 模板缺失、节点缺失、字段缺失时会明确失败

### 4.4 图片转模型执行器

对应测试文件：

- `backend/tests/ai-image-to-ply.executor.spec.ts`
- `backend/tests/files.ply.spec.ts`

覆盖内容：

1. 上传输入图片到 RunningHub
2. 生成 `nodeInfoList`
3. 创建 RunningHub 任务
4. 轮询查询结果 V2
5. `results[0].fileUrl` 为空时失败
6. `results[0].fileType != ply` 时失败
7. `ply` 文件下载、保存、注册到统一 files 体系
8. `resultFileId`、事件、落库结果回填

### 4.5 grouped 多任务并发、查询回显与重试

对应测试文件：

- `backend/tests/ai-image-to-ply.e2e.spec.ts`
- `backend/tests/executions.query.spec.ts`
- `backend/tests/queue.retry.spec.ts`

覆盖内容：

1. 一次创建多个 group 子任务
2. grouped 多任务并发执行
3. 成功 group 与失败 group 可同时存在
4. `providerTaskId / providerClientId / workflowId / workflowTemplateKey / resultFile` 可查询回显
5. RunningHub 可重试失败会自动重试 2 次，总尝试 3 次
6. 非 `ply` 结果会明确失败，且不会误判为成功

## 5. 对一期要求的覆盖结论

按一期目标逐项对照，当前自动化证据覆盖情况如下：

### 5.1 已通过自动化验证

- grouped 多任务创建
- grouped 多任务并发执行
- RunningHub 上传、创建、查询结果 V2 解析
- `promptTips` 早失败拦截
- `results[0]` 为空或缺失 URL 场景
- 非 `ply` 结果拦截
- `ply` 下载与落库
- 查询接口回显 provider 任务标识与结果文件
- 失败自动重试
- 最终失败判定

### 5.2 仍需真实人工联调确认

- 使用真实 `RUNNINGHUB_API_KEY` 的外部平台连通
- 使用至少 2 组真实输入图片的成功链路
- grouped 多任务在真实 RunningHub 条件下的并发行为
- 真实上传失败场景
- 真实创建失败场景
- 真实 `promptTips` 异常场景
- 真实查询结果为空场景
- 真实 `ply` 下载与落库成功链路

## 6. 一期建议的真实联调输入

一期人工联调建议至少准备以下两组输入：

### 6.1 基础成功组

- 输入图片 A

用途：

- 验证单 group 完整成功链路
- 产出首个真实成功快照

### 6.2 grouped 并发组

- 输入图片 B
- 输入图片 C

用途：

- 验证 grouped 双任务并发执行
- 验证两个独立 group 各自产出独立 `ply` 结果

说明：

1. 输入图片建议选择结构清晰、主体明确的单图
2. 若 RunningHub 对输入图片尺寸、格式有隐含要求，应在首次真实联调后回填到节点文档

## 7. 一期建议覆盖的真实联调场景

真实人工联调至少覆盖以下场景：

1. 单 group 成功执行
2. grouped 双任务并发执行
3. RunningHub 上传失败
4. RunningHub 创建失败
5. `promptTips` 异常
6. RunningHub 结果为空
7. `ply` 下载与落库成功
8. 查询接口可回显结果文件、provider 任务标识、错误信息与 attempt

## 8. 当前已知问题

### 8.1 当前尚未完成首轮真实 RunningHub 人工联调

当前已完成：

- RunningHub 客户端模拟响应测试
- 执行器模拟联调测试
- grouped 并发与重试模拟测试

当前尚未完成：

- 使用真实 RunningHub Key 与真实输入图片进行首轮人工联调
- 生成并沉淀首个真实成功/失败脱敏快照

### 8.2 自动化证据与真实联调证据需要明确区分

当前仓库中的多数专项测试覆盖的是：

- provider mock
- 本地下载 mock
- 本地 Worker 队列与文件系统

这足以证明后端逻辑闭环成立，但不能直接替代真实 RunningHub 平台验收。

### 8.3 一期仍不支持取消 RunningHub 后端任务

当前前端取消仅停止前端等待与轮询，不会取消 RunningHub 侧已提交任务。

## 9. 一期发布准备建议

建议按以下顺序完成发布前收尾：

1. 填写真实 `backend/config/backend.config.json`
2. 执行手工联调清单
3. 沉淀真实上传、创建、查询成功与失败快照
4. 回填 `backend/docs/examples/`
5. 再执行一次图片转模型专项自动化测试
6. 记录最终验收结论

## 10. 当前验收结论

基于当前仓库内已具备的自动化证据，可以给出当前阶段结论：

- 图片转模型节点后端核心能力已经具备进入一期人工联调的条件
- 上传、创建、轮询、结果解析、`ply` 落库、grouped 并发、查询回显与重试逻辑都已有自动化证据支撑
- 但“真实后端联调已完成”这一验收项当前还不能签收，因为尚未记录真实 RunningHub 平台联调结果

因此当前状态建议定义为：

- `可进入一期真实 RunningHub 联调验收阶段`
- `尚未达到最终发布签收`

若要升级为“一期可发布成果”，还需要补齐以下最终签收动作：

1. 至少 2 组真实输入图片的人工联调记录
2. 至少 1 份真实成功快照与 1 份真实失败快照
3. RunningHub 关键失败场景的人工验收记录

## 11. 2026-04-06 回归验证记录

本次回归目标是确认此前的“任务创建失败”已被修复，图片转模型节点在未配置真实 `RUNNINGHUB_API_KEY` 时，失败点应后移到 Worker 执行阶段。

### 11.1 回归环境

- API: `http://127.0.0.1:3100`
- Worker: `http://127.0.0.1:3200`
- 配置文件: `backend/config/backend.config.json`
- RunningHub 配置状态: `providers.runninghub.apiKey` 为占位值，按设计视为未配置

### 11.2 实际回归步骤

1. 调用 `POST /api/v1/files/register`
2. 命中现有文件去重，返回可直接复用的 `fileId`
3. 调用 `POST /api/v1/executions`
4. 成功创建图片转模型执行任务
5. Worker 拉起任务并进入 `final` 步骤
6. 在首次调用 RunningHub 前置校验时失败

### 11.3 实际回归结果

- 文件注册成功，返回 `fileId = 96539eae-3295-4fb9-803e-26ef11658027`
- 执行创建成功，返回：
  - `runId = 9e97dd5c-f42a-4001-8c19-566aa8e5565e`
  - `taskId = 2893ad7d-4afe-478d-816d-f7fb0e254f6f`
- Worker 已成功消费任务
- 运行事件顺序符合预期：
  - `task_queued`
  - `task_started`
  - `step_final_started`
  - `task_progress`
  - `task_retry_progress`
  - `task_failed`
- 最终失败发生在执行阶段，而不是创建阶段
- 失败原因明确为：
  - `lastErrorCode = VALIDATION_ERROR`
  - `lastErrorMessage = 未配置 RUNNINGHUB_API_KEY。`

### 11.4 回归结论

- “卡在任务创建失败”这一问题本次回归未复现
- `sourceFileId` 创建链路已经打通，后端可以成功生成 `runId / taskId`
- 当前未填真实 key 时，系统行为已符合预期：
  - 创建成功
  - Worker 消费成功
  - RunningHub 调用前校验失败
  - 前端应展示为执行失败，而不是创建失败
