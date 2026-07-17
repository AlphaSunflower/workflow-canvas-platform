# RunningHub 工作流模板目录

本目录存放后端正式运行依赖的 RunningHub 工作流模板文件。

当前已冻结的一期模板：

- 模板 key：`sharp-image-to-ply-v1`
- 文件名：`sharp_api.json`
- Provider：`runninghub`
- 工作流编号：`2014519004714508290`
- 用途：`aiImageToPly` 节点一期真实后端执行

- 模板 key：`multi-view-restore-v1`
- 文件名：`multi-view-restore_api.json`
- Provider：`runninghub`
- 工作流编号：`2014516111097729025`
- 用途：`aiMultiViewRestore` 节点一期真实后端执行

当前模板固定约束：

- 输入节点：`1`
- 输入字段：`image`
- 输出目标：SHARP 主输出
- 输出结果：单输入、单输出、单 `ply` 文件

- 输入节点：
  - `124.image`
  - `102.image`
- 输出目标：`127`
- 输出结果：双输入、单输出、单结果图

使用规则：

1. 正式运行只能读取 `backend/runninghub/` 下的模板
2. 不再依赖 `backend/` 外的工作流 JSON 文件
3. 后续若升级模板，不直接覆盖当前文件，应新增版本化模板 key

推荐版本命名方式：

- `sharp-image-to-ply-v1`
- `sharp-image-to-ply-v2`
- `multi-view-restore-v1`
- `multi-view-restore-v2`

后续若新增更多 RunningHub 工作流，也统一收口到本目录管理。
