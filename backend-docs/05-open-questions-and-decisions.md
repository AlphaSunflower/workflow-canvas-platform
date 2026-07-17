# 决策记录与待补充项

## 1. 已定决策

### 1.1 taskNo 必须由后端生成

状态：已确认

原因：

- 全局唯一
- 支持并发批量建任务
- 便于任务历史与人工检索

### 1.2 createdAt / startedAt / completedAt 三者都保留

状态：已确认

要求：

- 三个时间字段都属于任务正式字段
- 节点产物文件也要保存这三个任务时间

### 1.3 文件来源只保留两类

状态：已确认

值域：

- `imported`
- `node-output`

补充：

- `imported` 仅表示本地导入

### 1.4 历史数据无需兼容

状态：已确认

要求：

- 可以直接采用全新协议
- 不需要为旧数据设计兼容逻辑

### 1.5 文件节点属性入口

状态：已确认

交互：

- 右键节点本体
- 弹出菜单
- 点击“属性”
- 打开小窗口显示完整信息

### 1.6 快照写接口使用 relatedTaskIds

状态：已确认

规则：

- 保存快照时，请求体提交 `relatedTaskIds`
- 后端根据任务主记录扩展生成 `relatedTasks`
- 读接口返回 `relatedTasks` 与完整 `tasks`

原因：

- 写接口更轻
- 任务关联信息以服务端任务主记录为准
- 避免前端提交冗余节点来源字段

## 2. 后端开发启动前的待补充项

以下事项暂不阻塞文档定稿，但后端实现时应同步明确：

### 2.1 任务编号日序列持久化方案

建议：

- 使用数据库序列表或编号表
- 按日期维度加锁生成
- 不要依赖内存计数

### 2.2 任务状态流转约束

建议最小状态机：

- `queued -> processing -> completed`
- `queued -> processing -> failed`
- `queued -> cancelled`
- `processing -> cancelled`

### 2.3 任务结果摘要生成规则

建议后端在回传结果时同时固化：

- `outputSummary.fileCount`
- `outputSummary.fileIds`
- `outputSummary.textPreview`
- `outputSummary.dataKeys`

### 2.4 任务历史页后续扩展字段

建议预留但不强制：

- `executorType`
- `provider`
- `model`
- `retryCount`
- `durationMs`

## 3. 本文档与前端类型的关系

当前文档以以下前端文件为基线：

- `frontend/src/types/task.types.ts`
- `frontend/src/types/file.types.ts`
- `frontend/src/types/workflow.types.ts`
- `frontend/src/types/snapshot.types.ts`

后端实现过程中，如果发现字段需要调整，应先更新文档，再同步调整前端类型，避免两边漂移。
