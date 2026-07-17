# 后端对接文档空间

本目录用于集中沉淀 `newworkflow2` 的后端对接协议、数据模型与接口规范。

目标：

- 把前后端共同语言固定下来，避免并行开发期间重复返工。
- 所有涉及任务编号、任务记录、文件来源、节点回传、快照关联、任务历史的后端需求统一在此处定稿。
- 文档先行，后端代码实现可以按本文档并行推进。

当前文档范围：

- 任务主记录与任务编号规范
- 节点任务批量创建接口
- 节点执行状态与结果回传接口
- 文件节点来源与生成信息规范
- 工作流快照与任务历史关联规范

文档索引：

- [00-overview.md](./00-overview.md)
- [01-domain-models.md](./01-domain-models.md)
- [02-task-apis.md](./02-task-apis.md)
- [02a-task-lifecycle-rules.md](./02a-task-lifecycle-rules.md)
- [02b-ai-execution-apis.md](./02b-ai-execution-apis.md)
- [03-file-node-metadata.md](./03-file-node-metadata.md)
- [04-snapshot-and-history.md](./04-snapshot-and-history.md)
- [04a-snapshot-storage-design.md](./04a-snapshot-storage-design.md)
- [05-open-questions-and-decisions.md](./05-open-questions-and-decisions.md)
