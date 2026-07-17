# 多人并行开发与首批招聘工作规划

Last updated: 2026-04-23

## 目标

本文件用于把项目从“单人 + Codex 开发维护”过渡到“负责人主导 + 2 名新人并行开发”的可控状态。

本规划分为两部分：

1. 招聘前必须完整完成的任务清单。这部分由当前负责人使用 Codex 推进，目标是让项目具备接纳新人、拆分任务、自动验证、可控合并的基础。
2. 首批 2 名招聘人员的需求、招聘测试方式、入职后的任务安排和协作边界。

当前基本原则：

- 先建设可并行开发的底座，再扩大功能开发。
- 新人不直接接管核心架构和高风险路径。
- 所有任务必须有边界、验收标准、测试结果和 review。
- 允许使用 AI 辅助开发，但必须能解释、验证和修正 AI 输出。
- 项目负责人保留架构、契约、保护路径、合并和发布的最终控制权。

---

# 第一部分：招聘前必须完成的任务清单

## 完成定义

招聘前准备完成，不代表所有技术债都已清零，而是必须达到以下状态：

- 项目已经具备 Git 分支、PR、review 和质量门禁流程。
- 新人可以按文档完成本地启动、测试、提交和 PR。
- 高风险路径有明确保护规则。
- 任务可以被拆成独立工作包，且能避免两个人同时修改同一核心文件。
- 前后端契约、持久化字段、新节点、新执行路径都有明确变更规则。
- 至少准备好首批新人 2 周内可执行的低风险任务池。

## 0. 招聘前基线冻结

目标：在引入新人前形成一个可追踪、可回滚、可对比的项目基线。

- [ ] 运行根目录质量门禁：`.\verify-quality.ps1`。
- [ ] 记录最新通过结果，更新或新增招聘前基线记录文档。
- [ ] 确认当前 P0 问题全部关闭，P1/P2 问题仍在 `quality-baseline-issues.md` 中可追踪。
- [ ] 明确招聘前不再插入大功能，只接受协作底座、质量治理、文档和必要架构清债。
- [ ] 给招聘前阶段建立一个独立里程碑名称，例如 `M0-team-ready-foundation`。

验收标准：

- 根质量门禁通过。
- 招聘前基线文档可指向具体日期和命令结果。
- 后续任何新人任务都可以以该基线作为回归对照。

## 1. Git 与代码平台基础

目标：把项目从本地目录管理变成多人可协作的版本控制系统。

- [ ] 在 `newworkflow2` 项目根目录初始化或确认 Git 仓库。
- [ ] 选择代码平台：GitHub、GitLab、Gitee 任一即可。
- [ ] 建立默认稳定分支：`main`。
- [ ] 禁止直接向 `main` 推送代码。
- [ ] 建立分支命名规范：
  - `feature/<issue-id>-<short-name>`
  - `fix/<issue-id>-<short-name>`
  - `docs/<issue-id>-<short-name>`
  - `chore/<issue-id>-<short-name>`
- [ ] 建立提交信息规范：
  - `feat: ...`
  - `fix: ...`
  - `test: ...`
  - `docs: ...`
  - `refactor: ...`
  - `chore: ...`
- [ ] 创建或更新 `.gitignore`，至少排除：

```gitignore
node_modules/
dist/
dist-tests/
.test-temp/
.tmp/
*.log
*.err.log
backend/data/
backend/storage/
backend/config/backend.config.json
frontend/.env*
backend/.env*
```

- [ ] 确认真实密钥、运行数据、构建产物、依赖目录不会入库。
- [ ] 如果已有运行数据需要保留，移动到本地备份目录，不作为源码仓库内容提交。

验收标准：

- 新仓库首次提交不包含 `node_modules`、`dist`、`dist-tests`、真实配置、后端运行数据和存储 blob。
- `main` 分支只接受 PR/MR 合并。
- 从干净仓库 clone 后，能按文档安装依赖和运行质量门禁。

## 2. PR、Issue 与 Review 流程

目标：让每个任务都能被边界化、验收化和 review 化。

- [ ] 新增 `docs/development-workflow.md`，说明：
  - issue 创建规则
  - 分支创建规则
  - 开发流程
  - 本地验证流程
  - PR 提交流程
  - review 和合并规则
  - AI 使用披露规则
- [ ] 新增 issue 模板，至少包含：
  - 背景
  - 目标
  - 可改范围
  - 禁止范围
  - 实现要求
  - 验收标准
  - 必跑命令
  - 风险说明
- [ ] 新增 PR 模板，至少包含：
  - 改动内容
  - 影响范围
  - 测试结果
  - 风险点
  - 是否触碰保护路径
  - AI 使用说明
  - 后续遗留问题
- [ ] 新增 `CODEOWNERS` 或同类机制。
- [ ] 设置规则：所有保护路径必须由项目负责人 review。
- [ ] 设置规则：新人不能自行合并 PR。
- [ ] 设置规则：一个 PR 尽量只解决一个 issue。
- [ ] 设置规则：PR 目标周期为 1 到 3 天，避免长期分支。

验收标准：

- 能用模板创建一个完整 issue。
- 能用模板创建一个完整 PR。
- 保护路径变更会自动要求负责人 review，或至少在流程文档中强制规定。

## 3. CI 与质量门禁接入

目标：把现有本地质量门禁变成合并前强制检查。

- [ ] 将现有根质量门禁接入代码平台 CI。
- [ ] CI 至少执行：
  - frontend `npm run typecheck`
  - frontend `npm run lint`
  - frontend `npm test`
  - backend `npm run typecheck`
  - backend `npm test`
- [ ] 如果使用 Windows runner，优先复用 `verify-quality.cmd` 或 `verify-quality.ps1`。
- [ ] 如果使用 Linux runner，需要补充等价脚本，避免依赖 `npm.cmd`。
- [ ] CI 失败时阻止合并。
- [ ] CI 日志要能定位失败阶段。
- [ ] 新增 `docs/ci-quality-gate.md`，说明本地 gate 和 CI gate 的关系。
- [ ] 明确默认 gate 不包含真实 Provider、真实密钥、人工验收测试。

验收标准：

- 任意 PR 都会自动跑质量门禁。
- CI 失败不能合并。
- 本地命令和 CI 命令在文档中一致。

## 4. 保护路径治理

目标：避免新人或并行任务直接冲击核心复杂区域。

- [ ] 新增 `docs/protected-paths.md`。
- [ ] 将以下路径列为保护路径：
  - `frontend/src/components/context/**`
  - `frontend/src/components/canvas/**`
  - `frontend/src/execution-runtime/**`
  - `frontend/src/services/image/**`
  - `frontend/src/services/workflow-file-normalizer.ts`
  - `frontend/src/services/backendExecutionService.ts`
  - `frontend/src/services/workflow-upload-scheduler.ts`
  - `frontend/src/nodes/ai-storyboard/**`
  - `frontend/src/nodes/shared/**`
  - `backend/shared/src/**`
  - `backend/api/src/modules/workflows/**`
  - `backend/api/src/modules/files/**`
  - `backend/api/src/modules/executions/**`
  - `backend/worker/src/modules/executors/**`
  - `backend/worker/src/modules/queue/**`
  - `backend/worker/src/modules/providers/**`
- [ ] 规定保护路径变更必须满足：
  - 有 issue ID。
  - 有测试或明确测试缺口说明。
  - 有影响范围说明。
  - 有负责人 review。
  - 不引入 `any`、`as any`、宽泛 `eslint-disable`。
  - 不引入无边界轮询、重试、调度循环。
- [ ] 规定 `WorkflowContext.tsx` 和 `Canvas.tsx` 不再接收新增业务逻辑。
- [ ] 新功能若必须触碰核心大文件，必须优先设计抽取点。

验收标准：

- 新人能从文档明确知道哪些文件不能随意改。
- 任意保护路径变更都能追踪到 issue、测试和 review。

## 5. 核心大文件拆分路线

目标：降低多人开发时的文件冲突和行为冲突风险。

当前必须治理的两个核心文件：

- `frontend/src/components/context/WorkflowContext.tsx`
- `frontend/src/components/canvas/Canvas.tsx`

招聘前不要求一次性完成全部拆分，但必须完成拆分路线和第一批可执行抽取任务。

### 5.1 `WorkflowContext.tsx` 治理

- [ ] 编写 `docs/workflow-context-decomposition-plan.md`。
- [ ] 标记当前职责：
  - session/action glue
  - workflow save/load
  - execution launch
  - execution output commit
  - storyboard orchestration
  - notification handling
  - runtime sync
  - file upload dependency promotion
- [ ] 确定保留在 context 内的最小职责。
- [ ] 确定需要抽出的 service/helper：
  - workflow save service
  - execution action facade
  - storyboard execution facade
  - output commit coordinator
  - notification adapter
  - runtime sync helper
- [ ] 为每个抽取点建立 issue。
- [ ] 至少完成 1 个低风险抽取示范，并补测试。
- [ ] 规定后续新人只能在抽取后的 service/helper 内工作，不能直接新增 context 分支。

验收标准：

- 有拆分路线文档。
- 有第一批 issue。
- 至少完成一个抽取示范 PR。

### 5.2 `Canvas.tsx` 治理

- [ ] 编写 `docs/canvas-decomposition-plan.md`。
- [ ] 标记当前职责：
  - ReactFlow 事件装配
  - drag/drop
  - selection
  - edge mutation
  - resize
  - viewport sync
  - image visibility
  - raster layer coordination
  - context menu
  - hotkeys
- [ ] 确定保留在 Canvas 内的最小职责。
- [ ] 确定需要抽出的 helper/hook/service：
  - drag interaction coordinator
  - drop target resolver
  - selection action helper
  - edge mutation helper
  - viewport sync helper
  - canvas image scheduling facade
  - context menu builder
- [ ] 为每个抽取点建立 issue。
- [ ] 至少完成 1 个低风险抽取示范，并补测试。
- [ ] 规定后续新人不能直接在 Canvas 内追加复杂业务判断。

验收标准：

- 有拆分路线文档。
- 有第一批 issue。
- 至少完成一个抽取示范 PR。

## 6. 前后端契约治理

目标：避免多人开发时后端字段、前端消费、执行 payload 各自漂移。

- [ ] 新增 `docs/api-contract-policy.md`。
- [ ] 规定接口字段变更顺序：
  - 先改共享类型或契约文档。
  - 再改后端 producer。
  - 再改前端 consumer。
  - 最后补契约/集成测试。
- [ ] 明确当前短期契约来源：
  - `backend/shared/src/types/**`
  - `backend/docs/API-SPEC.md`
  - frontend API service mirror types
- [ ] 明确中期目标：
  - 前端直接消费 shared package，或
  - 使用 OpenAPI/生成式 client，减少手写 mirror type。
- [ ] 给 `QBL-CONTRACT-001` 制定落地子任务。
- [ ] 新增“执行路径变更清单”：
  - request type
  - response type
  - task history behavior
  - event behavior
  - ownership/auth behavior
  - frontend adapter
  - backend executor
  - tests
- [ ] 新增“持久化字段变更清单”：
  - save
  - normalize
  - hydrate
  - reload compatibility
  - runtime-only cleanup
  - tests

验收标准：

- 新接口或字段不能绕过契约文档。
- 新执行路径有固定 checklist。
- 新持久化字段有固定 checklist。

## 7. 后端数据库与 Repository 准备

目标：在招聘后端新人前，先把数据库改造的边界设计清楚，避免新人直接在业务层散写数据访问逻辑。

- [ ] 新增 `backend/docs/database-migration-plan.md`。
- [ ] 明确当前 JSON Store 的数据集合：
  - accounts
  - workflows
  - workflow files
  - executions
  - tasks/events
  - files/storage index
  - intermediate artifacts
- [ ] 明确目标数据库优先级：
  - 第一阶段优先 PostgreSQL 或 SQLite/PostgreSQL 双策略。
  - Redis/队列可以后置，除非任务调度已需要跨进程扩展。
  - 对象存储可以后置，先保留本地 storage adapter 抽象。
- [ ] 定义 Repository 分层规范：

```txt
Controller -> Service -> Repository -> Storage/DB
```

- [ ] 为每个核心数据域设计 repository interface：
  - AccountRepository
  - WorkflowRepository
  - WorkflowFileRepository
  - ExecutionRepository
  - TaskHistoryRepository
  - FileAssetRepository
  - IntermediateArtifactRepository
- [ ] 定义 migration 目录和命名规则。
- [ ] 定义测试数据库策略：
  - 本地 automated test 不能依赖真实生产库。
  - 测试使用临时库、内存库或隔离目录。
  - 数据库测试必须可重复运行。
- [ ] 定义从 JSON Store 到数据库的迁移/回滚策略。
- [ ] 准备后端新人可执行的第一批 repository/test 任务。

验收标准：

- 后端数据库改造有明确文档。
- 新人可以按 repository interface 做局部实现。
- 业务层不能直接绕过 repository 操作数据库。

## 8. 后端监控面板前置设计

目标：先定义监控指标和 API，再让新人分别做后端 metrics 与前端面板。

- [ ] 新增 `backend/docs/monitoring-dashboard-spec.md`。
- [ ] 定义第一版监控指标：
  - API health
  - Worker health
  - Worker polling status
  - RunningHub active/max/available/queued
  - provider backpressure latest event
  - task success/failure/retry counts
  - recent failed tasks
  - slow tasks
  - storage usage summary
  - provider snapshot cleanup status
  - current config redaction summary
- [ ] 定义 metrics API：
  - `GET /api/v1/admin/monitoring/overview`
  - `GET /api/v1/admin/monitoring/tasks`
  - `GET /api/v1/admin/monitoring/providers`
  - `GET /api/v1/admin/monitoring/storage`
- [ ] 明确权限：第一阶段仅 admin 可访问。
- [ ] 明确敏感信息：API Key、token、真实密钥不得返回前端。
- [ ] 定义前端监控面板第一版页面结构。
- [ ] 准备后端新人任务：metrics DTO、service、tests。
- [ ] 准备前端新人任务：admin dashboard UI、api client、loading/error states。

验收标准：

- 监控面板不是先做 UI，而是先完成指标模型和权限边界。
- 两名新人可以按同一份 spec 分头开发前后端。

## 9. 新节点和新功能开发模板

目标：后续增加功能时，不再把逻辑塞进 `WorkflowContext.tsx` 或 `Canvas.tsx`。

- [ ] 新增 `frontend/docs/new-node-development-template.md`。
- [ ] 新增 `backend/docs/new-execution-path-template.md`。
- [ ] 新节点必须包含：
  - node type
  - task type
  - input handle contract
  - output handle contract
  - frontend component
  - frontend runtime adapter
  - drop/group behavior
  - persistence behavior
  - backend request/response type
  - backend executor
  - task history behavior
  - tests
  - docs
- [ ] 新执行路径必须包含：
  - request DTO
  - response DTO
  - validation
  - auth/ownership behavior
  - queue behavior
  - retry behavior
  - terminal state behavior
  - output artifact handling
  - frontend adapter
  - backend tests
  - frontend tests
- [ ] 明确禁止：
  - 新节点直接在 `WorkflowContext.tsx` 内新增特殊执行分支。
  - 新节点绕过共享执行 contract。
  - 新持久化字段没有 hydrate/reload 测试。

验收标准：

- 新功能任务可以按模板拆分。
- 新人做新节点时不需要理解全项目核心链路才能开工。

## 10. 本地开发和新人入门文档

目标：降低新人入场后的反复提问和环境问题成本。

- [ ] 新增 `docs/local-setup.md`。
- [ ] 文档覆盖：
  - Node 版本要求。
  - frontend 依赖安装。
  - backend/shared 依赖安装。
  - backend/api 依赖安装。
  - backend/worker 依赖安装。
  - backend config 示例复制方式。
  - 前端启动方式。
  - 后端启动方式。
  - 质量门禁运行方式。
  - 单测定向运行方式。
  - 常见端口：3000、3100、3200。
  - 常见问题排查。
- [ ] 新增 `docs/onboarding.md`。
- [ ] onboarding 文档覆盖：
  - 项目定位。
  - 当前技术栈。
  - 目录结构。
  - 核心业务链路。
  - 保护路径。
  - 新人第一周任务流程。
  - AI 使用要求。
  - PR 要求。
- [ ] 修订或归档明显过期、乱码、与现实技术栈冲突的旧文档。
- [ ] 明确 `spec.md`、`tasks.md` 中旧 Go/Redis/MinIO 等内容属于历史规划还是未来目标，避免新人误读。

验收标准：

- 新人能按 `docs/local-setup.md` 独立启动项目。
- 新人能按 `docs/onboarding.md` 理解第一周工作边界。
- 旧文档不会误导新人以为当前后端是 Go 项目。

## 11. 首批新人任务池准备

目标：招聘完成后不临时想任务，避免新人直接碰核心风险区。

### 11.1 前端/质量方向任务池

- [ ] 补齐某个 service 的单元测试。
- [ ] 修复一个非保护路径 lint/test warning。
- [ ] 为一个 node adapter 增加行为测试。
- [ ] 根据已有 spec 补一个小型 admin dashboard UI skeleton。
- [ ] 整理一个前端 docs 文件，修正过期路径。
- [ ] 为 protected resource 或 image service 补边界测试。
- [ ] 提取一个已经设计好的低风险 helper，不改变行为。

### 11.2 后端/数据与监控方向任务池

- [ ] 为一个 repository interface 编写测试 fixture。
- [ ] 为 monitoring overview API 编写 DTO 和单元测试。
- [ ] 为现有 execution query 增加无行为变化的测试覆盖。
- [ ] 补一个 provider error mapping 测试。
- [ ] 整理 backend docs 中的启动和配置说明。
- [ ] 给 database migration plan 补字段表格。
- [ ] 为 storage adapter 增加边界测试。

验收标准：

- 至少准备 10 个新人任务。
- 每个任务都有可改范围、禁止范围、验收标准和必跑命令。
- 新人前两周不需要直接修改核心大文件。

## 12. 招聘前最终验收

完成以上任务后，招聘前必须做一次最终验收：

- [ ] 从干净 clone 安装依赖并启动项目。
- [ ] 运行根质量门禁。
- [ ] 创建一个测试 issue。
- [ ] 创建一个测试分支。
- [ ] 创建一个测试 PR。
- [ ] 验证 PR 模板生效。
- [ ] 验证 CI 生效。
- [ ] 验证保护路径 review 规则生效，或至少在流程文档中被明确强制。
- [ ] 验证新人任务池可直接派发。
- [ ] 更新本文件的完成状态或另建执行追踪表。

---

# 第二部分：首批 2 人招聘与后续安排规划

## 招聘总原则

当前招聘对象主要是高校毕业生，因此不能按成熟工程师标准要求“立即独立负责模块”。招聘标准应从“已经会多少”转为“能否在文档、AI、测试、review 约束下稳定成长和交付”。

核心筛选标准：

- 学习速度。
- 工程纪律。
- 代码理解能力。
- 测试意识。
- AI 协作能力。
- 沟通和风险暴露能力。

不优先筛选：

- 八股背诵能力。
- 花哨 demo。
- 只会用 AI 生成代码但解释不清。
- 自称全栈但没有工程边界意识。

## 首批招聘结构

计划先招聘 2 人。

建议结构：

1. 前端/工程质量方向校招生 1 人。
2. 后端/数据与监控方向校招生 1 人。

如果只能先到岗 1 人，优先顺序：

1. 前端/工程质量方向。
2. 后端/数据与监控方向。

原因：

- 当前项目最大复杂度集中在前端画布、节点、执行运行时、图片资源和 Storyboard。
- 后端接下来会进入数据库、监控、真实业务能力建设，需要第二名新人承接可边界化的后端任务。
- 功能型工程师不适合最先招聘；底座未稳时扩功能会放大技术债。

## 岗位 1：前端/工程质量方向校招生

### 定位

协助项目负责人推进前端质量建设、测试补齐、节点和 service 层整理、监控面板前端、低风险功能实现。

### 必须能力

- TypeScript 基础。
- React 基础。
- 能读懂组件、hooks、service 层代码。
- 基本 Git 使用能力。
- 能按要求写单元测试或行为测试。
- 能独立阅读文档并复述任务目标。
- 能使用 AI 辅助，但必须能解释生成结果。

### 加分能力

- 做过可视化编辑器、流程图、白板、低代码、ReactFlow 类项目。
- 做过复杂前端状态管理。
- 用过 TanStack Query、Zustand、Vite、Tailwind。
- 写过测试。
- 能做基础 UI/交互实现。

### 初期可负责

- 非核心组件维护。
- service/helper 测试补齐。
- node adapter 测试。
- admin/monitoring dashboard UI。
- 文档整理。
- 低风险 helper 抽取。
- 新节点模板化实现中的前端外围部分。

### 初期禁止独立负责

- `WorkflowContext.tsx` 主体逻辑。
- `Canvas.tsx` 主体逻辑。
- `execution-runtime` 主链路重构。
- `ai-storyboard` 执行逻辑迁移。
- 持久化字段设计。
- 前后端契约设计。

## 岗位 2：后端/数据与监控方向校招生

### 定位

协助项目负责人推进后端数据库改造、Repository 层、监控指标 API、任务历史和 Provider 外围测试。

### 必须能力

- TypeScript 或 Node.js 基础。
- HTTP API 基础。
- 异步编程基础。
- 基本数据结构和数据库概念。
- 能写单元测试。
- 能阅读 DTO、service、repository 风格代码。
- 能使用 AI 辅助，但必须能验证和解释。

### 加分能力

- 用过 PostgreSQL、SQLite、Redis 任一。
- 做过任务队列、异步任务、状态机。
- 做过第三方 API 集成。
- 做过文件上传、对象存储、鉴权。
- 熟悉日志、监控、健康检查。

### 初期可负责

- Repository interface 测试。
- metrics DTO 和 API。
- admin monitoring 后端接口。
- execution query 测试。
- storage adapter 测试。
- provider error mapping 测试。
- 数据库 migration 草案实现。
- 后端文档补齐。

### 初期禁止独立负责

- 数据库总体选型。
- 任务调度核心规则。
- Provider 并发和 backpressure 规则。
- 鉴权和权限模型重构。
- 生产部署和密钥管理。
- API contract 的最终定义。

## 共同要求

两名新人都必须接受以下规则：

- 不直接向 `main` 提交。
- 不无 issue 改代码。
- 不绕过测试。
- 不自行合并 PR。
- 不随意修改保护路径。
- 不把新业务逻辑塞进核心大文件。
- 不提交无法解释的 AI 代码。
- 遇到契约、持久化、鉴权、执行、文件资产、任务调度问题必须先暴露风险。

## 一票否决项

- 使用 AI 生成代码但解释不清。
- 不愿意写测试。
- 不愿意看文档。
- 遇到问题不报告，私自扩大修改范围。
- 对 review 抵触。
- 不能按模板说明改动、风险和验证结果。
- 修改核心路径但没有 issue、测试和说明。

## 招聘测试流程

建议流程分为 5 步。

### 1. 简历筛选

关注：

- 是否有完整项目经历。
- 是否用过 TypeScript、React、Node.js 中至少一种。
- 是否用过 Git。
- 是否写过测试。
- 是否能读英文技术文档。
- 是否有持续学习痕迹。

不重点关注：

- 简历关键词堆砌。
- 纯课程作业数量。
- 与本项目无关的算法竞赛成绩。

### 2. 限时作业，允许使用 AI

时长：2 到 4 小时。

交付内容必须包含：

- 代码改动。
- 改动说明。
- 验证方式。
- 风险点。
- AI 使用说明。
- 哪些地方仍不确定。

评分重点：

- 是否能读懂任务。
- 是否控制改动范围。
- 是否能写测试。
- 是否能解释代码。
- 是否能识别 AI 输出风险。

### 3. 技术面试

建议使用真实项目片段，不做纯八股面试。

面试内容：

- 给一段项目文档，让候选人 10 分钟后说明模块关系。
- 给一段小代码，让候选人指出风险。
- 追问如果改这个功能，需要补哪些测试。
- 追问如果 AI 给出一个看似可用方案，如何验证。
- 追问遇到不确定契约时会怎么处理。

### 4. AI 代码 Review 测试

给候选人一段“AI 生成但存在问题”的代码，让他 review。

观察点：

- 能否发现类型逃逸。
- 能否发现未处理错误。
- 能否发现隐藏副作用。
- 能否发现缺测试。
- 能否发现和项目规则冲突的地方。

### 5. 1 到 2 周带薪试做

如果条件允许，最终录用前安排短期试做。

试做任务必须是低风险、可验证任务，例如：

- 前端候选人：给一个 service 或 adapter 补测试。
- 后端候选人：给一个 DTO/service/repository 草案补测试。
- 共同要求：提交 PR、跑测试、写风险说明。

## 作业题建议

### 前端方向作业

题目 A：为一个已有 service 补测试。

- 给定一个小型 service 文件。
- 要求补充边界测试。
- 不允许修改无关文件。
- 提交测试结果。

题目 B：为一个 mock monitoring API 做前端卡片组件。

- 要求 TypeScript 类型清晰。
- 要求 loading/error/empty 状态。
- 要求不接触 Canvas 和 WorkflowContext。

题目 C：Review 一个 AI 生成的 hook。

- 指出依赖数组风险。
- 指出资源释放问题。
- 指出缺少测试的地方。

### 后端方向作业

题目 A：为一个 repository interface 设计测试。

- 给定接口和内存实现。
- 要求覆盖 create/read/update/list/error case。
- 不接真实数据库。

题目 B：实现一个 monitoring overview DTO。

- 给定 mock queue/provider/storage 数据。
- 输出脱敏后的 overview response。
- 补测试。

题目 C：Review 一个 AI 生成的 API handler。

- 指出鉴权问题。
- 指出错误响应不一致。
- 指出未校验输入。
- 指出测试缺口。

## 评分表

建议总分 100 分。

| 维度 | 分值 | 说明 |
| --- | ---: | --- |
| 学习和理解速度 | 25 | 能否快速读懂任务、文档和代码上下文 |
| 工程纪律 | 25 | 是否控制范围、遵守模板、避免乱改 |
| 测试意识 | 20 | 是否主动补测试、能说明验证方式 |
| AI 协作能力 | 15 | 是否能正确使用、解释和审查 AI 输出 |
| 沟通和风险意识 | 15 | 是否能清楚说明风险、不确定性和阻塞 |

建议录用线：

- 80 分以上：优先录用。
- 70 到 79 分：可试做后决定。
- 70 分以下：不建议进入项目。

## 入职后 30/60/90 天安排

## 第 0 周：准备

负责人完成：

- 分配代码平台账号。
- 分配只读或受限权限。
- 提供 onboarding 文档。
- 提供本地开发文档。
- 分配第一个低风险 issue。

新人完成：

- clone 项目。
- 安装依赖。
- 跑通前后端启动。
- 跑通质量门禁。
- 阅读保护路径文档。
- 阅读 PR 模板。

## 第 1 到 2 周：低风险任务期

目标：验证新人是否能稳定遵守流程。

前端新人任务：

- 测试补齐。
- 文档修正。
- 小组件或 service 层任务。
- monitoring dashboard skeleton。

后端新人任务：

- repository 测试。
- monitoring DTO 测试。
- backend docs 修正。
- execution query 或 storage adapter 测试。

规则：

- 每人同时只允许 1 个进行中的 issue。
- 每个 PR 控制在小范围。
- 所有 PR 必须由负责人 review。
- 不允许独立触碰保护路径。

## 第 3 到 4 周：有限模块 ownership

目标：让新人开始承担小模块，但不接核心架构。

前端新人可逐步负责：

- admin/monitoring 前端页面。
- 某些非核心 service。
- 新节点模板中的 UI 部分。

后端新人可逐步负责：

- monitoring API 的局部模块。
- repository adapter 的局部实现。
- 非核心 query/service。

负责人继续负责：

- 架构边界。
- API contract。
- 数据模型。
- 保护路径 review。
- 合并。

## 第 2 个月：稳定并行

目标：形成两条不会互相冲突的开发线。

建议并行方式：

- 前端新人负责 monitoring dashboard UI、前端测试和低风险节点外围。
- 后端新人负责 monitoring API、repository、数据库迁移的局部实现。
- 负责人负责 contract 和接口 spec。

关键规则：

- 前后端并行前必须先冻结 API contract。
- 后端先给 DTO 和 mock response。
- 前端基于 mock 或 API client 开发。
- 合并前跑统一质量门禁。

## 第 3 个月：功能扩展准备

目标：在底座稳定后，允许新人进入更明确的新功能开发。

前端新人可进入：

- 新节点 UI。
- 新节点 adapter。
- 监控面板完善。
- 画布外围 helper。

后端新人可进入：

- 新 execution path 的外围实现。
- 新 provider adapter 外围测试。
- 数据库 repository 实现。
- admin API 扩展。

仍然由负责人掌控：

- 状态机。
- 调度策略。
- 权限模型。
- 持久化格式。
- 核心画布行为。

## 两人并行开发的任务分配规则

允许并行：

- 一人做后端 metrics API，一人做前端 dashboard UI。
- 一人做 repository 测试，一人做前端 service 测试。
- 一人整理 backend docs，一人整理 frontend docs。

谨慎并行：

- 一人改后端 execution response，一人改前端 execution adapter。
- 条件是负责人先冻结契约。

禁止并行：

- 两人同时改 `WorkflowContext.tsx`。
- 两人同时改 `Canvas.tsx`。
- 一人改 shared type，另一人未同步就改 consumer。
- 一人改执行调度，另一人改执行输出提交。

## 负责人职责

负责人在首批 2 人阶段必须承担：

- 任务拆分。
- 架构决策。
- 保护路径 review。
- API contract 决策。
- 数据库模型决策。
- 发布和合并控制。
- 风险兜底。
- 新人培养和反馈。

负责人不应把以下职责下放给新人：

- 是否重构核心路径。
- 是否改变持久化格式。
- 是否改变执行状态机。
- 是否改变权限模型。
- 是否改变 Provider 并发规则。
- 是否合并 PR。

## 每周协作节奏

建议采用轻量节奏：

- 每日 10 分钟同步：
  - 昨天完成什么。
  - 今天做什么。
  - 是否阻塞。
  - 是否触碰契约或保护路径。
- 每周一次任务规划：
  - 确定本周 issue。
  - 确定可改范围。
  - 确定验收标准。
  - 确定必跑测试。
- 每周一次回顾：
  - 哪些任务冲突。
  - 哪些文档缺失。
  - 哪些测试不足。
  - 下周如何降低 review 成本。

## 首批 2 人阶段的成功标准

首批 2 人试运行 1 到 2 个月后，应达到：

- 新人可以独立完成低风险 issue。
- PR 能按模板说明改动、风险和测试。
- 质量门禁保持绿色。
- 保护路径没有无计划变更。
- 监控面板或数据库准备任务有实质进展。
- 项目负责人 review 成本下降，而不是上升。
- 新功能没有继续向核心大文件堆积。

## 失败信号

出现以下情况应立即收紧权限和任务范围：

- 新人频繁绕过 issue 改代码。
- PR 经常无法解释改动原因。
- AI 生成代码未经验证直接提交。
- 质量门禁经常被破坏。
- 核心路径出现无计划修改。
- 两人频繁修改同一文件。
- 文档和测试被认为是可省略项。
- 负责人 review 时间超过自己开发时间，且没有改善趋势。

## 后续扩招条件

不要在以下条件满足前招聘第 3 人：

- 首批 2 人能稳定提交小 PR。
- CI 和质量门禁稳定。
- 保护路径规则被严格执行。
- 数据库和监控方向至少一个形成可工作的模块边界。
- 新人任务池仍有足够任务。
- 负责人每周 review 成本可控。

第 3 人更适合招聘：

- 功能实现型前端，负责新节点和页面；或
- 测试/质量工程方向，负责 E2E、CI、回归测试。

不建议第 3 人优先招聘纯部署/运维校招生。生产部署、密钥、备份、回滚和安全风险较高，早期更适合由负责人掌控，或找有经验的外部顾问支持。

