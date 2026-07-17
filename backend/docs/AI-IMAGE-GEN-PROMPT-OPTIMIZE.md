# AI 生图节点提示词优化文档

## 1. 功能定位

`AI 提示词优化` 是 AI 生图节点编辑态的手动辅助能力。

它基于用户当前预输入的 `prompt`，以及可选参考图片，将简短想法、局部修改、风格改写、商品图、角色设定、海报、建筑室内、UI/图标、分镜/视频镜头等需求，优化为可直接用于 AI 生成的高质量中文提示词。

该能力只负责生成并回填文本，不创建执行任务，不写入输出图片，也不进入正式生图执行链。

## 2. 触发边界

当前版本固定支持以下场景：

1. 只能由用户手动点击前端节点中的 `AI 提示词优化` 按钮触发
2. 节点类型必须是 `aiImageGen`
3. 节点配置中的 `inputGroups.length` 必须严格等于 `1`
4. 唯一输入组可提供 `0~5` 张输入图片
5. 节点共享 `prompt` 不能为空

以下情况禁止触发：

1. 节点存在第 2 个输入组
2. 唯一输入组图片数量超过 5 张
3. `prompt` 为空
4. 当前已有提示词优化请求进行中

注意：无图片时按纯文本优化处理，不允许假装看到了图片；有图片时图片只作为视觉上下文参与提示词优化。

## 3. 与正式生图执行链的关系

`AI 提示词优化` 与正式 AI 生图执行链完全解耦。

它不会进入以下链路：

1. 不会创建 `ExecutionRun`
2. 不会创建 `ExecutionTask`
3. 不会进入 Worker 执行器
4. 不会写入图片输出
5. 不会进入 `ExecutionRuntimeStore` 的生图任务执行流程

它只做一次同步后端调用，并返回优化后的文本结果。

## 4. 后端接口合同

接口地址：

- `POST /api/v1/ai/prompt-optimize`

请求体：

```json
{
  "workflowId": "workflow-1",
  "nodeId": "node-1",
  "nodeType": "aiImageGen",
  "prompt": "把室内空间改成更温暖的日式自然风",
  "referenceFileIds": ["file-1", "file-2"]
}
```

纯文本优化时：

```json
{
  "workflowId": "workflow-1",
  "nodeId": "node-1",
  "nodeType": "aiImageGen",
  "prompt": "一张适合电商首图的运动水杯产品图",
  "referenceFileIds": []
}
```

请求约束：

1. `nodeType` 固定为 `aiImageGen`
2. `prompt` 必须为非空字符串
3. `referenceFileIds.length` 必须在 `0~5`
4. 非空 `referenceFileIds` 必须指向当前用户可访问的图片文件

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "optimizedPrompt": "优化后的中文提示词",
    "model": "gemini-2.5-flash",
    "referenceCount": 2,
    "promptVersion": "ai-image-gen-optimize-v2"
  },
  "timestamp": 1710000000000
}
```

响应字段说明：

1. `optimizedPrompt`：回填到节点共享 `prompt` 的最终文本
2. `model`：本次使用的多模态理解模型
3. `referenceCount`：本次实际送入模型的参考图数量
4. `promptVersion`：当前提示词协议版本

## 5. 老张多模态调用规则

当前固定调用老张 OpenAI 兼容接口：

- `POST /v1/chat/completions`

请求体中的 `messages` 规则：

1. 第一个消息固定为 system prompt
2. 第二个消息固定为 user message
3. user message 内容结构为 `文本说明 + 可选图片数组`
4. 图片通过 `image_url.url = data:image/jpeg;base64,...` 传入
5. 图片顺序必须与唯一输入组中的当前顺序完全一致

图片预处理规则：

1. 所有参考图统一转为 JPEG
2. 统一转为 `data:image/jpeg;base64,...`
3. 单图时最大边长 1024
4. 多图时最大边长 768
5. 无图时不执行图片预处理，直接走文本优化

## 6. 系统提示词协议

基础 system prompt 固定描述为：

```text
你是一个专业的多模态提示词工程师，负责把用户的简短想法、草稿描述或带参考图的修改需求，优化成可直接用于 AI 生成的高质量中文提示词。你需要先判断用户真实意图，再选择合适写法：文生图、参考图改写、局部重绘、角色设定、商品图、海报设计、场景氛围、建筑室内、UI/图标、分镜或视频镜头等都要能适配。输出必须是中文纯文本，不要解释、不要标题、不要列表编号、不要 Markdown。
```

当存在参考图时，会追加参考图系统提示，要求模型将图片作为视觉上下文，识别主体、构图、姿态、材质、光线、色彩、风格、镜头、空间关系和需要保留的身份特征。

该文本属于冻结协议，修改时必须同步更新 `promptVersion` 与相关测试。

## 7. 前端回填行为

前端点击 `AI 提示词优化` 后，行为顺序如下：

1. 读取节点当前文本框中的最新 `promptDraft`
2. 若本地草稿尚未防抖提交，先同步到节点配置
3. 收集唯一输入组中的图片后端 `fileId`，无图时传空数组
4. 调用 `/api/v1/ai/prompt-optimize`
5. 成功后同时回填本地文本框草稿与 `data.config.prompt`

并发保护规则：

1. 请求进行中按钮禁用
2. 新请求会取消前一个请求
3. 只有最后一次请求结果允许回填

## 8. 自动化测试范围

当前功能的自动化测试应至少覆盖：

1. 后端 API 成功与失败映射
2. 文本-only 优化可用
3. 0~5 张参考图数量约束
4. 系统提示词与版本号冻结
5. 图片顺序严格保持
6. `data:image/jpeg;base64,...` 组装正确
7. 前端按钮启用/禁用条件
8. 回填逻辑与最后一次响应保护

## 9. AI Storyboard 共用底层补充

当前 `AI 提示词优化` 与 `aiStoryboard` 的 `一键AI智能排序与写运镜` 共用同一个老张多模态调用底层：

- `backend/api/src/modules/ai/providers/laozhang-vision.client.ts`

边界说明：

1. 提示词优化使用固定 system prompt，并在有参考图时追加固定参考图核心指令。
2. Storyboard 编排不使用 system prompt，全部内容放在单条 user 多模态消息中。
3. 两者都只做同步多模态大模型调用，不进入 execution runtime。
4. Storyboard 的图片生成与视频生成仍分别复用现有 `image-gen` / `video-gen` 执行链。
