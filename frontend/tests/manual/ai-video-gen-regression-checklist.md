# AI Video Gen 联调回归清单

## 自动化验证

- 前端执行 `npm.cmd run typecheck`
- 前端执行定向测试：
  - `TEST_FILE=runtime.spec.js npm.cmd test`
  - `TEST_FILE=ai-video-gen.adapter.spec.js npm.cmd test`
  - `TEST_FILE=execution-output-commit.service.spec.js npm.cmd test`
- 后端执行 `npm.cmd run typecheck`
- 后端执行定向测试：
  - `node --experimental-transform-types ./src/modules/executions/nodes/ai-video-gen.node.spec.ts`
  - `node --experimental-transform-types ./src/modules/providers/laozhang/laozhang-veo.client.spec.ts`
  - `node --experimental-transform-types ./src/modules/executors/ai-video-gen.executor.spec.ts`

## 手工联调场景

- 多组多图成功
  - 新建 `aiVideoGen` 节点
  - 配置 2 个 group
  - `group-1` 接 2 张参考图，`group-2` 接 1 张参考图
  - 填写 prompt，模型选择 `veo-3.1-landscape-fast-fl`，时长保持 `8s`
  - 运行后确认每个 group 都产生独立视频结果节点，并连接到对应 `result` 输出口

- 部分失败
  - 构造 2 个 group，其中一组使用无效后端文件，或让后端主动返回失败
  - 确认前端最终提示为“部分完成”
  - 确认成功组正常回写视频节点，失败组保留错误状态，不发生串组

- 取消轮询
  - 运行节点后立即点击取消
  - 确认前端状态进入已取消
  - 确认提示语义为“已停止前端轮询，后端任务可能仍在执行”
  - 确认不会继续自动回写新增结果

- 保存与重载
  - 视频结果节点已回写后保存工作流
  - 刷新或重载工作流
  - 确认 `aiVideoGen` 节点参数、group 结构、视频节点和 output-link 均正确恢复

- 视频节点回显
  - 确认结果节点类型为 `video`
  - 确认节点预览可播放
  - 确认双击后 viewer 可打开
  - 确认元数据中的 `duration` 为 `8`

## 重点观察指标

- 同一 run 下每个 task 的 `groupId`、`groupOrder`、`resultFileId` 是否一一对应
- `/api/v1/executions/:runId` 查询结果中的 `resultFile.fileType` 是否为 `video`
- 前端回写后新建节点的 `type` 是否为 `video`
- 视频节点 `previewUrl` 是否存在且可播放

## 剩余风险

- 当前只覆盖 `duration=8`，后续接入其他时长或其他服务商模型时，需要重新校验共享常量、前端选项和后端校验
- 老张 Veo 接口返回体若后续字段变化，`laozhang-veo.parser.ts` 和对应 client spec 需要同步更新
- 取消语义当前仍是“停止本项目轮询”，不会真实取消供应商任务，可能出现后端继续执行但前端不再追踪的尾部结果
- 当前前端全量 `npm.cmd test` 仍被一个与本任务无关的既有用例 `frontend/tests/task-history.test.mjs` 阻塞，本次未扩 scope 处理
