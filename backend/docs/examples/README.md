# 联调样例目录说明

本目录用于保存后端联调样例与内部脱敏快照。

当前包含以下文件：

1. `laozhang-success-response.json`
2. `laozhang-failed-response.json`
3. `ai-image-gen-success-response.json`
4. `ai-image-gen-failed-response.json`

## 样例来源

这些样例代表当前代码已兼容、已测试覆盖的内部标准结构，不代表官方文档承诺格式。

具体说明如下：

1. `laozhang-success-response.json`
   - 基于解析器和测试整理的通用成功结构样例
2. `laozhang-failed-response.json`
   - 基于解析器和测试整理的通用失败结构样例
3. `ai-image-gen-failed-response.json`
   - 来自仓库中真实失败快照并已脱敏
4. `ai-image-gen-success-response.json`
   - 当前为内部解析结构样例，待首次真实 AI 生图联调后替换为真实脱敏成功快照
5. `runninghub-upload-success.json`
   - 基于 RunningHub 上传解析实现与测试整理的脱敏成功样例
6. `runninghub-create-success.json`
   - 基于用户提供的真实 RunningHub 创建成功返回并完成脱敏整理
7. `runninghub-query-v2-success.json`
   - 基于 RunningHub 查询结果 V2 解析实现与执行器测试整理的脱敏成功样例
8. `runninghub-failed-response.json`
   - 基于 RunningHub `promptTips` 失败场景与错误归一化实现整理的脱敏失败样例
9. `runninghub-multi-view-restore-node-info-list.json`
   - 多视角修复双输入模板映射成功样例，说明 `124.image` 与 `102.image` 的 nodeInfoList 装配结果
10. `runninghub-multi-view-restore-create-success.json`
   - 多视角修复节点 RunningHub 创建成功响应脱敏样例
11. `runninghub-multi-view-restore-query-success.json`
   - 多视角修复节点查询结果成功样例，包含命中 `nodeId = 127` 的结果图
12. `runninghub-multi-view-restore-failed-response.json`
   - 多视角修复节点失败响应样例，用于说明 `promptTips` 异常和输出节点不匹配排障入口

## 脱敏要求

保存真实联调快照时，必须脱敏以下内容：

1. API Key
2. 原始输入图片完整 `base64`
3. 返回图片完整 `base64`
4. 用户标识、任务编号、路径中的敏感信息
5. 不应外泄的业务提示词内容

建议处理方式：

1. 保留字段结构
2. 长 `base64` 内容替换为 `...SANITIZED_BASE64...`
3. 路径改为相对描述或占位值
4. 敏感文本改为通用示例值

RunningHub 样例额外要求：

1. 上传样例至少保留 `code / msg / data.fileName`
2. 创建样例至少保留 `taskId / clientId / taskStatus / promptTips`
3. 查询结果 V2 样例至少保留 `taskId / status / results[0].fileUrl / results[0].fileType / results[0].nodeId`
4. 若保存 webhook 样例，必须单独标注其不是本期主链路返回，避免与创建返回、查询返回混淆

## 后续更新规则

首次真实 AI 生图联调完成后，应执行以下动作：

1. 复制真实成功响应快照
2. 完成脱敏
3. 覆盖 `ai-image-gen-success-response.json` 或新增带版本后缀的真实样例
4. 在 `backend/docs/AI-IMAGE-GEN.md` 中补充更新时间与来源说明

首次真实 RunningHub 联调完成后，应额外执行以下动作：

1. 覆盖或新增真实脱敏的上传成功样例
2. 覆盖或新增真实脱敏的查询结果 V2 成功样例
3. 如拿到真实 provider 失败响应，替换当前内部推导失败样例
4. 在 `backend/docs/AI-IMAGE-TO-PLY.md` 中补充样例更新时间、来源与差异说明
