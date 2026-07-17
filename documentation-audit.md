# 文档维护准备说明（基于当前代码实况）

> 更新时间：2026-03-27  
> 审核范围：`newworkflow2/` 全仓库（重点为 `frontend/`）  
> 目的：在正式重写文档前，先建立“当前项目真实状态”的基线，避免继续按早期规划稿维护文档。

---

## 1. 当前仓库真实状态

### 1.1 仓库范围

当前仓库**只有前端项目落地实现**：

- 根目录文档：`spec.md`、`tasks.md`、`checklist.md`
- 实际代码：`frontend/`
- **不存在**后端代码目录、数据库迁移、Docker Compose、Go 服务端实现

### 1.2 当前可运行项目

当前真正可运行的是一个：

- Vite 5
- React 18
- TypeScript 5
- ReactFlow 11

的单页前端画布应用。

### 1.3 已验证状态

已在当前代码上验证：

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run build` ✅

---

## 2. 当前架构基线

### 2.1 应用入口

当前入口链路：

`main.tsx`  
→ `App.tsx`  
→ `WorkflowProvider`  
→ `ReactFlowProvider`  
→ `Canvas + Toolbar + StatusBar`

### 2.2 当前运行时“真源”

当前编辑态的真实数据源已经不是旧文档描述的 Zustand Store，而是：

- **ReactFlow 内部运行时状态**：`nodes / edges / viewport`
- `useWorkflow` 负责：
  - 初始化工作流
  - 接收运行时快照
  - 保存/导出/导入
- `WorkflowProvider` 仅暴露：
  - `workflow`
  - `notification`
  - `contextMenu`

### 2.3 当前实际分层

更贴近现状的描述应为：

1. **UI / ReactFlow 运行时层**
   - `components/`
   - ReactFlow 节点、画布、工具栏、状态栏
2. **Hook / Context 层**
   - `hooks/`
   - `components/context/`
3. **纯工具与模型层**
   - `types/`
   - `constants/`
   - `utils/`
4. **轻量 API / side-effect 层**
   - `api/`
   - `services/file/file-service.ts`

### 2.4 已被清理/降级的旧架构

以下内容已不再是当前主链路：

- Zustand stores（`src/stores` 已移除）
- 旧的 canvas/node/workflow 历史 hooks 主链
- 大部分 legacy service 目录

但配置中仍保留了一些历史痕迹：

- `vite.config.ts` 仍有 `@stores` alias
- `tsconfig.json` 仍有 `@stores/*` path alias

---

## 3. 当前功能实况

### 3.1 已接入主界面的核心能力

当前主界面中，实际可见且已接入的能力包括：

- ReactFlow 画布
- 右键菜单
- 文件拖拽导入到画布
- 文件节点创建（image / video / ply）
- AI 节点创建（aiChat / aiImageGen / aiVideoGen / aiImageToPly / aiImageRestore）
- group 节点创建
- 节点连线
- 文件节点删除 / 旋转 / 缩放
- 迷你地图显示、尺寸切换、显隐
- 工具栏缩放、适应视图、保存
- 状态栏节点数 / 连线数 / 缩放比显示
- 工作流快照同步、导出/导入基础能力

### 3.2 已存在但未真正接入主流程的能力

代码中有定义，但**目前不是主界面真实工作流的一部分**：

- API 层（`workflowApi` / `fileApi` / `aiApi`）
- WebSocket 客户端
- React Query Provider（已挂载，但当前业务未实际使用 query/mutation）
- `useFileUpload`
- `useAITask`
- `useAIStream`
- `useAIConfig`
- `PropertyPanel`
- `ShortcutPanel`
- `AIProcessingOverlay`
- `FileDropZone`

这些更适合在文档中标记为：

- “已定义但未接入”
- “预留接口/预研实现”
- “独立能力，尚未并入主 runtime”

### 3.3 当前明显未实现或仅为占位的内容

以下内容不能再按“已完成”写入文档：

- 后端服务
- 用户认证/项目管理
- 真正的文件上传后端联调
- AI 任务真实执行链路
- 实时协作（Yjs / y-websocket）
- 3D 预览链路
- Undo / Redo 真正实现（当前工具栏仅日志占位）
- 完整属性面板/快捷键/通知中心工作流
- 组节点完整交互逻辑

---

## 4. 与现有文档的偏差评估

### 4.1 必须重写

#### `spec.md`

状态：**严重过时**

主要问题：

- 仍按“完整平台”描述，覆盖后端、数据库、部署、权限、协作等
- 技术栈与当前仓库不一致（Go / Yjs / Three.js / React Player / Radix UI 等）
- MVP 完成状态与当前代码不匹配

#### `tasks.md`

状态：**严重过时**

主要问题：

- 仍按全栈路线拆任务
- 大量任务已被删除、降级或根本未落地
- 不再能作为实际开发清单

#### `checklist.md`

状态：**严重过时**

主要问题：

- 仍包含后端、数据库、部署、生产环境验收项
- 与当前仅前端仓库状态不符

#### `frontend/ARCHITECTURE.md`

状态：**严重过时**

主要问题：

- 仍写成“四层 + Zustand + Stores + 多 Service”
- 与当前“ReactFlow runtime + WorkflowProvider + utils/file-service”结构不符
- 目录树中包含大量已删除目录

#### `frontend/docs/hooks-api.md`

状态：**严重过时**

主要问题：

- 仍文档化已删除 hooks：
  - `useCanvas`
  - `useMinimap`
  - `useNodeSelection`
  - `useNodeOperations`
  - `useNodeRepulsion`
  - `useNodeIdGenerator`
  - `useWorkflowHistory`
  - `useClipboard`
  - `useConnection`
  - `useKeyboardShortcuts`
  - `useDragDrop`

#### `frontend/docs/missing-definitions.md`

状态：**应归档或删除**

主要问题：

- 基于旧 stores 体系编写
- 指向已删除目录和旧组件关系
- 已不具备当前维护价值

### 4.2 需要复核后再决定是否重写

以下文档和当前目录/类型体系仍有一定对应关系，但必须重新核对导出与使用情况：

- `frontend/docs/constants-api.md`
- `frontend/docs/types-api.md`
- `frontend/docs/utils-api.md`

建议处理方式：

- 不直接信任旧文档
- 以当前源码导出为准重新生成/重写
- 文档中增加“是否已接入主界面”标记

### 4.3 可保留但需整理

#### `frontend/doc/change-log.md`

状态：**可保留**

但存在问题：

- 中英混杂
- 部分文本存在乱码/编码问题
- 应补成统一中文叙述，并明确“runtime-chain cleanup”后的新基线

---

## 5. 文档维护建议顺序

建议按以下顺序修订，而不是一次性全改：

### P0：先建立“当前项目说明”

优先新增/重写：

1. 项目现状说明（仓库当前只包含前端）
2. 前端运行方式
3. 当前功能边界
4. 当前架构说明

### P1：清理明显错误文档

处理：

1. 重写 `frontend/ARCHITECTURE.md`
2. 重写或归档 `frontend/docs/hooks-api.md`
3. 删除/归档 `frontend/docs/missing-definitions.md`

### P2：收敛根目录规划文档

处理：

1. 将 `spec.md` 改为“产品愿景 / 远期规划”，不要再冒充当前实现
2. 将 `tasks.md` 改为“现阶段前端任务清单”
3. 将 `checklist.md` 改为“当前前端验收清单”

### P3：补充 API / 模块说明

处理：

1. 补充当前节点体系说明
2. 补充 Canvas runtime 数据流说明
3. 标注哪些 Hook/API 已接入、哪些只是保留接口

---

## 6. 后续写文档时的统一口径

后续所有文档应遵守以下原则：

### 6.1 区分三种状态

每个模块都要明确标注：

- **已实现并接入主界面**
- **已定义但未接入**
- **规划中 / 未实现**

### 6.2 不再把规划稿写成现状

例如以下内容，只有在仓库真实存在时才可写为“当前架构”：

- Go 后端
- PostgreSQL / Redis / MinIO
- 用户系统
- 项目系统
- 实时协作
- 任务队列

### 6.3 当前“源码真相”优先级

当前维护文档时，建议以下文件作为事实来源：

- 入口与运行方式  
  - `frontend/package.json`
  - `frontend/src/main.tsx`
  - `frontend/src/App.tsx`

- 当前 runtime 主链  
  - `frontend/src/components/context/WorkflowContext.tsx`
  - `frontend/src/hooks/workflow/useWorkflow.ts`
  - `frontend/src/components/canvas/Canvas.tsx`
  - `frontend/src/components/workflow/Toolbar.tsx`
  - `frontend/src/components/ui/StatusBar.tsx`

- 节点体系  
  - `frontend/src/types/base.types.ts`
  - `frontend/src/types/node.types.ts`
  - `frontend/src/components/node/nodeTypes.ts`
  - `frontend/src/constants/node.constants.ts`

- 文件/AI/工具层  
  - `frontend/src/services/file/file-service.ts`
  - `frontend/src/api/`
  - `frontend/src/utils/`

---

## 7. 结论

当前最重要的结论只有两点：

1. **仓库当前真实状态是“前端画布原型/前端应用”，不是 spec.md 中描述的完整平台。**
2. **后续维护文档必须先围绕 ReactFlow runtime 主链重建基线，再决定哪些规划内容保留为 roadmap。**

