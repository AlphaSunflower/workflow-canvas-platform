# 白模渲染节点第一版设计

## 1. 文档目的

本文档用于固化第一版最先打通的真实节点能力：

- 前端节点：`aiModelRenderTransfer`
- 中文名称：白模图迁移渲染

第一版目标不是完成完整后台平台，而是先让该节点在前后端联通后能够真实调用外部服务运行。

本文档是后端一期当前唯一正式边界文档。

如果与 `backend/` 下其他规划性文档存在冲突，以本文档为准。

## 2. 第一版目标

当 `backend` 启动后，前端白模渲染节点应具备以下能力：

1. 用户在前端为节点准备输入
2. 前端将执行所需图片注册到后端，获得 `fileId`
3. 前端发起节点执行
4. 后端按 group 拆分任务并并行执行
5. 后端真实调用老张 API 中介平台
6. 后端接收并保存中间产物与最终产物
7. 前端收到真实状态、真实进度和最终图片结果
8. 对同一张白模图自动复用已生成的中间产物

### 2.1 一期当前负责

第一版只负责支撑白模渲染节点真实运行所必需的最小后端能力：

1. 输入图片注册、上传、去重、分配 `fileId`
2. 按 group 创建和执行任务
3. 调用老张 API 中介平台完成真实图片生成
4. 保存线稿图、深度图、最终结果图
5. 对同一张白模图自动复用中间产物
6. 回传任务状态、步骤事件、重试进度和最终结果
7. 提供完成以上能力所需的最小 API、Worker、数据库与共享协议

### 2.2 一期明确不做

第一版明确不做以下内容：

1. 登录系统与账号体系
2. 独立后台前端页面
3. 多节点同时接入
4. 多平台接入与平台切换
5. 节点参数开放配置
6. 画布布局保存与画布快照
7. 项目、成员、权限模型
8. 自动工作流编排与节点下游自动触发
9. 复杂统计、运营分析与存储治理策略

## 3. 对应前端节点

当前前端已有对应节点：

- 节点类型：`aiModelRenderTransfer`
- 任务类型：`model-render-transfer`
- 执行模式：`legacy-grouped-task`

该节点当前前端结构已经符合第一版真实接入的基本要求：

1. 支持 grouped 输入
2. 每组固定两张输入图
3. 多组可并行执行

## 4. 输入输出规则

### 4.1 每个 group 的输入

每个 group 固定有两张输入图：

1. 白模图
2. 风格参考图

其中：

- 白模图是主输入
- 风格参考图是风格参考输入

### 4.2 每个 group 的输出

每个 group 最终输出一张图片：

1. 最终渲染结果图

### 4.3 中间产物

每个 group 在执行过程中会产生两类中间产物：

1. 线稿图
2. 深度图

这两个中间产物需要保留，并且对于同一张白模图可复用。

## 5. 节点内部执行链

这个节点不是单次 API 调用节点，而是一个后端内部三阶段编排节点。

每个 group 的执行流程固定如下：

### 第一步：线稿图生成

输入：

- 白模图

输出：

- 线稿图

### 第二步：深度图生成

输入：

- 白模图

输出：

- 深度图

### 第三步：最终结果图生成

当线稿图和深度图都完成后，再发起最终生成。

最终生成的图片输入顺序必须固定为：

1. 风格参考图
2. 线稿图
3. 深度图
4. 白模图

这个顺序是正式协议的一部分，不允许在实现时随意调整。

### 5.4 成功、失败与重试判定

#### 成功判定

只有同时满足以下条件，当前 group 才算成功：

1. 最终生成步骤正常收到返回图片
2. 返回图片可被后端成功解析和 base64 解码
3. 最终图片已成功保存为后端文件资产
4. 当前任务结果已正确关联到该最终图片

只要未完成以上四项中的任意一项，都不能算成功。

#### 单次尝试失败判定

以下情况任意一种出现，当前 attempt 视为失败：

1. 线稿图步骤未返回可用图片
2. 深度图步骤未返回可用图片
3. 最终生成步骤未返回可用图片
4. 上游接口超时、网络错误、非 200 响应
5. 上游响应格式不符合预期，无法解析出图片
6. 返回的图片 base64 无法解码
7. 图片成功返回但保存文件资产失败

#### 自动重试判定

第一版自动重试规则固定如下：

1. 单次 attempt 失败后自动进入重试
2. 自动重试次数固定为 2 次
3. 总尝试次数最多为 3 次
4. 任意一次 attempt 只要成功收到并落库最终图片，任务立即转为成功，不再继续重试
5. 三次 attempt 都未成功收到并落库最终图片，则该 group 最终失败

## 6. 并发规则

### 6.1 group 间并发

不同 group 之间并行执行。

也就是说：

- 一个节点中有多组输入时，每组作为独立任务并发运行

### 6.2 group 内并发

同一个 group 内：

- 线稿图生成
- 深度图生成

这两步应并行执行。

最终结果图生成必须等待前两步都完成后才能开始。

## 7. 中间产物复用规则

### 7.1 复用对象

允许复用的只有两类中间产物：

1. 线稿图
2. 深度图

### 7.2 复用依据

复用判断必须基于：

- 白模图内容本身

不允许基于：

- 文件名
- 用户侧逻辑 `fileId`
- 前端节点本地状态

建议以后端物理文件唯一标识为主：

- `file_blob.id`
  或
- `sha256`

### 7.3 复用行为

对于同一张白模图：

1. 如果线稿图已存在，则直接复用线稿图
2. 如果深度图已存在，则直接复用深度图
3. 如果只命中其中一个，则只补生成另一个
4. 最终结果图不做复用，因为它还依赖风格参考图

### 7.3.1 部分命中规则

中间产物复用必须支持部分命中：

1. 线稿图命中、深度图未命中时，只补生成深度图
2. 深度图命中、线稿图未命中时，只补生成线稿图
3. 两者都命中时，两个中间产物都直接复用
4. 两者都未命中时，分别创建处理中记录并进入生成

### 7.4 保留策略

第一版中间产物长期保留。

### 7.5 版本隔离

为了避免以后修改提示词后错误复用旧中间产物，建议缓存键中包含：

1. 白模图 `blob_id`
2. 中间产物类型
3. `pipeline_version`
4. `prompt_version`
5. `provider`
6. `model`

### 7.6 去重锁规则

为了避免相同白模图在并发任务下重复生成相同中间产物，一期必须增加缓存键级锁：

1. 锁粒度为单个中间产物缓存键
2. 线稿图和深度图分别独立加锁
3. 命中 `ready` 缓存时直接复用并更新 `last_used_at`
4. 未命中时先创建 `processing` 记录，再由当前任务负责生成
5. 其他并发任务在同一缓存键上必须等待，不能重复创建第二份相同中间产物
6. 生成成功后将记录更新为 `ready`
7. 生成失败后将记录更新为 `failed`

## 8. 第一版平台参数固定规则

虽然老张平台存在多个可选参数，但白模渲染节点第一版固定为：

### 8.1 aspectRatio

固定为：

- 自适应

实现方式：

- 不传 `aspectRatio` 字段

### 8.2 imageSize

固定为：

- `1K`

说明：

- 这些参数后续给其他节点开放
- 白模渲染节点第一版不从前端暴露这些参数

## 9. 固定提示词

第一版白模渲染节点的三段提示词全部由后端内置管理，不从前端传入。

### 9.1 线稿图提示词

```text
生成该输入图片的清晰线稿图，黑线白底，尽量保留结构与边缘。
```

### 9.2 深度图提示词

```text
生成该输入图片的深度图（depth map），灰度表现深度关系，结构清晰。
```

### 9.3 最终生成提示词

```text
图2、图3、图4是同一个空间的不同表现形式,图2是线稿图，图3是深度图,图4是白模图；另有图1是风格参考图
请参考风格图与图234的空间信息，生成一张效果图
要求硬装表面都按照图1的风格补全，同时严格按照图234的空间信息不改变，图中代表家具的小体块维持白模状态
画面比例维持图4比例不变
```

## 10. 老张 API 接口约束

### 10.1 平台信息

- 平台：老张 API 中介平台
- 模型：Gemini 生图模型
- 调用方式：同步返回
- 返回格式：图片 base64

### 10.2 图片输入方式

图片通过 base64 编码后，放入：

- `contents[].parts[].inline_data`

### 10.3 文本输入方式

提示词通过：

- `parts[].text`

### 10.4 图片输出方式

平台返回的图片位于：

- `candidates[0].content.parts[0].inlineData.data`

为兼容中介平台可能出现的字段差异，一期客户端还需宽松支持：

- `inlineData`
- `inline_data`

并同时兼容其下的：

- `mimeType`
- `mime_type`

### 10.5 一期客户端封装要求

老张 API 客户端一期必须额外满足：

1. 使用 `Authorization: Bearer <API_KEY>`
2. 固定 `Content-Type: application/json`
3. 默认 `generationConfig.responseModalities = ["IMAGE"]`
4. 白模节点一期固定 `imageSize = 1K`
5. 白模节点一期固定不传 `aspectRatio`
6. 对成功响应保存原始响应快照，便于后续补齐平台返回样例
7. 对失败响应也保存原始响应快照，便于后续错误映射细化
8. 将错误明确分类为：
   - 超时错误
   - 网络错误
   - 平台错误
   - 响应解析错误

### 10.6 当前内部联调样例来源

由于当前没有官方返回示例文档，一期内部样例暂时采用以下来源固化：

- 当前老张 API 客户端实现：
  - `backend/worker/src/modules/providers/laozhang/laozhang.client.ts`
  - `backend/worker/src/modules/providers/laozhang/laozhang.parser.ts`
- 当前解析与错误分类测试：
  - `backend/tests/providers.laozhang.spec.ts`
- 当前内部样例文件：
  - `backend/docs/examples/laozhang-success-response.json`
  - `backend/docs/examples/laozhang-failed-response.json`

说明：

1. 这些样例是内部标准样例，不是官方文档原文
2. 它们代表当前代码已兼容、已测试覆盖的返回结构
3. 首次真实联调拿到成功/失败快照后，应以脱敏后的真实快照替换当前标准样例

### 10.7 当前成功响应解析规则

一期后端当前按如下顺序解析成功响应：

1. 先解析整个响应体为 JSON
2. 读取 `candidates[]`
3. 依次读取每个 candidate 下的 `content.parts[]`
4. 在 `parts[]` 中寻找图片数据对象
5. 兼容以下两种字段名：
   - `inlineData`
   - `inline_data`
6. 在图片对象中读取：
   - `data`
   - `mimeType` 或 `mime_type`
7. 只要任意一个 `part` 成功解析出图片 base64，即视为本次调用成功

当前成功路径不要求：

- 必须固定在 `parts[0]`
- 必须只有一个 `candidate`
- 必须只有一种大小写/命名风格

### 10.8 当前失败响应与错误归类规则

一期老张 API 客户端当前按以下规则归类：

1. 请求超时或 `AbortError`
   - 归类为 `TIMEOUT`
2. 请求发送失败、连接异常、DNS 异常、fetch 失败
   - 归类为 `NETWORK_ERROR`
3. HTTP 状态码非 200
   - 归类为 `PROVIDER_ERROR`
   - 同时保留 `providerCode`
4. 返回体不是合法 JSON
   - 归类为 `INVALID_RESPONSE`
5. 返回 JSON 合法，但未能从 `candidates[].content.parts[]` 中解析出图片 base64
   - 归类为 `INVALID_RESPONSE`

### 10.9 图片返回解析注意事项

一期开发与联调需要特别注意：

1. 返回图片是 base64 文本，不是文件 URL
2. 返回字段名可能出现驼峰与下划线两种写法
3. `mimeType` 可能不存在，当前默认兜底为 `image/png`
4. 成功收到 HTTP 200 不代表业务成功，仍需继续校验能否解析出图片 base64
5. 解析成功后才可进入落盘与文件资产保存流程
6. 若只拿到文本或空 `candidates`，应视为失败而不是成功
7. 成功与失败响应都应保存原始快照，供后续补齐真实联调样例

## 11. 老张 API 示例代码

以下示例代码为当前节点第一版接入时的参考调用方式，后端实现必须兼容其核心协议语义。

```python
import requests
import base64

# Configuration
API_KEY = "sk-YOUR_API_KEY"  # Replace with your API Key
API_URL = "https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent"

# Request headers
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Build request payload
# Read and encode reference image
def encode_image(image_path):
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

# Reference image 1 (replace with your image path)
ref_image_1 = encode_image("image_1.jpg")
# Reference image 2 (replace with your image path)
ref_image_2 = encode_image("image_2.jpg")

payload = {
    "contents": [{
        "parts": [
            {"text": "A beautiful sunset over mountains"},
            {"inline_data": {"mime_type": "image/jpeg", "data": ref_image_1}},
            {"inline_data": {"mime_type": "image/jpeg", "data": ref_image_2}}
        ]
    }],
    "generationConfig": {
        "responseModalities": ["IMAGE"],
        "imageConfig": {
            "aspectRatio": "1:1",
            "imageSize": "4K"
        }
    }
}

# Send request
print("Generating image...")
response = requests.post(API_URL, headers=headers, json=payload, timeout=180)

if response.status_code != 200:
    print(f"Error: {response.status_code} - {response.text}")
    exit(1)

# Extract and save image
result = response.json()
image_data = result["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]

with open("output.png", "wb") as f:
    f.write(base64.b64decode(image_data))

print("✅ Image saved: output.png")
```

## 11.1 一期内部样例文件

当前仓库内已补充老张 API 一期内部标准样例：

- 成功样例：`backend/docs/examples/laozhang-success-response.json`
- 失败样例：`backend/docs/examples/laozhang-failed-response.json`
- 样例说明：`backend/docs/examples/README.md`

当前样例用途：

1. 开发解析器时对照结构
2. 联调时判断返回是否落在已知兼容范围
3. 排障时对照错误分类与解析路径

后续规则：

1. 当拿到首个真实成功快照时，脱敏后回写该目录
2. 当拿到首个真实失败快照时，脱敏后回写该目录
3. 新样例必须保留字段结构，不得只保留口头总结

## 12. 该节点第一版的后端实现要求

### 12.1 必须实现的通用能力

1. 输入文件注册与上传
2. 文件 base64 编解码
3. 同步调用外部平台
4. 返回图片保存为文件资产
5. 任务事件与重试记录

### 12.2 必须实现的节点专属能力

1. group 内三阶段编排
2. 线稿图与深度图并行生成
3. 中间产物自动复用
4. 相同白模图的处理中去重
5. 最终步骤固定输入顺序

## 13. 建议新增的数据对象

为了支撑中间产物复用，建议新增：

### intermediate_artifacts

建议字段：

1. `id`
2. `source_blob_id`
3. `artifact_type`
   - `lineart`
   - `depth`
4. `file_id`
5. `provider`
6. `model`
7. `pipeline_version`
8. `prompt_version`
9. `status`
10. `created_at`
11. `last_used_at`

用途：

1. 按白模图定位中间产物
2. 支撑缓存复用
3. 支撑后续版本切换

## 14. 执行器建议

建议在后端实现一个专用执行器：

- `WhiteModelRenderExecutor`

职责：

1. 接收一个 group 的白模图和风格参考图
2. 查询白模图是否已有线稿图缓存
3. 查询白模图是否已有深度图缓存
4. 对缺失项发起并行生成
5. 保存中间产物
6. 发起最终结果图生成
7. 保存最终产物
8. 汇总并返回结果

执行器一期还必须满足：

1. 线稿图和深度图对缺失项并行调用
2. 最终步骤严格按顺序传图：
   - 风格参考图
   - 线稿图
   - 深度图
   - 白模图
3. 最终产物保存后必须回填 `execution_tasks.result_file_id`
4. 三个阶段都必须写入步骤事件，供前端与后台查询

## 15. 事件建议

为了让前端和后台更好观察该节点内部步骤，建议增加以下步骤级事件：

1. `step_lineart_started`
2. `step_lineart_completed`
3. `step_depth_started`
4. `step_depth_completed`
5. `step_final_started`
6. `step_final_completed`
7. `step_cache_hit`
8. `step_cache_miss`

说明：

- 对外顶层任务状态仍然保持 `queued / processing / completed / failed / cancelled`
- 内部步骤通过事件体现

## 16. 第一版错误与重试规则

对白模渲染节点第一版，沿用通用规则：

1. 详细成功、失败、重试判定以第 5.4 节为准
2. 若当前 attempt 未成功收到并落库最终结果图，则自动重试
3. 自动重试次数固定为 2 次
4. 总尝试次数最多 3 次
5. 三次都未成功收到并落库最终结果图，则该 group 最终失败
5. 每次重试都需要向前端和后台回传：
   - 当前任务
   - 当前 attempt
   - 当前步骤
   - 当前进度
   - 当前错误

## 17. 第一版开发任务清单

### 17.1 协议冻结

1. 固化三段提示词
2. 固化默认参数：
   - `aspectRatio` 不传
   - `imageSize = 1K`
3. 固化最终步骤图片输入顺序

### 17.2 平台客户端

1. 封装老张 API 客户端
2. 封装 base64 图片输入输出
3. 封装统一超时与错误解析
4. 保存原始响应快照

### 17.3 文件链路

1. 输入图片注册与上传
2. 输出图片保存为文件资产
3. 中间产物保存为文件资产

### 17.4 白模渲染执行器

1. 查询线稿图缓存
2. 查询深度图缓存
3. 并行补全缺失中间产物
4. 最终图生成
5. 返回结果

### 17.5 中间产物复用

1. 新建 `intermediate_artifacts`
2. 引入缓存键与版本号
3. 增加处理中锁

### 17.6 执行记录

1. 每个 group 对应 1 条 `ExecutionTask`
2. 一个节点点击执行对应 1 条 `ExecutionRun`
3. group 内步骤通过事件记录

### 17.7 前端接入

1. 执行前注册白模图和风格图
2. 发起真实执行
3. 接收状态与结果
4. 回写最终图片到画布

## 18. 一期执行创建接口约束

为了支撑前端把 grouped 输入提交给后端，一期执行创建接口固定如下：

### 18.1 接口

- `POST /api/v1/executions`

### 18.2 当前只支持的节点

当前一期只接受：

1. `nodeType = aiModelRenderTransfer`
2. `taskType = model-render-transfer`
3. `executionMode = legacy-grouped-task`

### 18.3 请求体结构

请求体至少包含：

1. `userId` 可选
2. `nodeType`
3. `taskType`
4. `executionMode`
5. `groups`

其中 `groups` 为数组，每个元素固定包含：

1. `groupId`
2. `whiteModelFileId`
3. `styleReferenceFileId`

### 18.4 校验规则

后端当前必须执行以下校验：

1. `groups` 至少包含 1 组
2. 每个 group 必须同时有白模图和风格参考图
3. 每个传入 `fileId` 必须已在后端完成注册
4. 每个传入 `fileId` 必须处于 `ready` 状态

### 18.5 落库结果

一次成功的执行创建请求必须产生：

1. 1 条 `ExecutionRun`
2. 每个 group 1 条 `ExecutionTask`

例如：

- 2 个 group -> 1 条 `ExecutionRun` + 2 条 `ExecutionTask`
- 5 个 group -> 1 条 `ExecutionRun` + 5 条 `ExecutionTask`

### 18.6 返回要求

后端必须返回：

1. `runId`
2. `runNo`
3. 顶层状态 `queued`
4. 每个 group 对应的：
   - `taskId`
   - `taskNo`
   - `groupId`
   - `groupOrder`
   - `status`

## 19. 第一版明确不做的内容

第一版不要求：

1. 登录系统
2. 后台前端页面
3. 多个平台接入
4. 多节点同时接入
5. 节点参数开放配置
6. 画布布局保存与画布快照
7. 项目、成员、权限模型
8. 自动工作流编排与节点下游自动触发
9. 复杂统计、运营分析与存储治理策略

## 20. 当前还需要补充的信息

在进入实现前，仍建议补充以下内容：

1. 老张平台成功响应的完整 JSON 示例
2. 老张平台失败响应的完整 JSON 示例
3. 第一版最终图片默认保存格式
4. 三个步骤是否统一使用 `timeout=180`

如果以上都确认，则本节点已经具备进入后端接口设计和执行器设计阶段的条件。
