# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Workflow Canvas Platform — a collaborative visual workflow editor built on ReactFlow. Users arrange images, videos, and 3D models on a canvas, connect them to AI services (image generation, video generation, 3D reconstruction), and manage AI task execution in a visual node-graph interface. Codebase is in English; product UI is in Chinese.

## Tech Stack

- **Frontend**: React 18 + Vite 5 + TailwindCSS 3 + ReactFlow 11 + Zustand + TanStack Query + PixiJS
- **Backend**: Node.js/TypeScript (executed via `tsx`) — API server (port 3100) + Worker (port 3200) + shared types
- **Database**: PostgreSQL (primary), legacy JSON store fallback (explicit opt-in only)
- **Storage**: Local file storage with S3-compatible option

## Commands

### Unified Quality Gate (run from project root `newworkflow2/`)

```powershell
.\verify-quality.ps1        # PowerShell
verify-quality.cmd           # CMD
```

Runs fail-fast in order: frontend typecheck → lint → arch:check → test → backend typecheck → lint → arch:check → test.

### Frontend (from `frontend/`)

```bash
npm run dev          # Vite dev server on port 3000
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint with --max-warnings 0
npm test             # node:test pipeline via scripts/run-tests.mjs
npm run arch:report  # Architecture rule scanning (report-only)
npm run arch:check   # Architecture rule enforcement (blocking)
npm run verify       # Full quality gate: typecheck + lint + arch:check + test
```

### Backend (from `backend/`)

```bash
npm run start        # Start backend via scripts/start-backend.mjs --start
npm run dev          # Start backend in dev mode
npm run typecheck    # Typecheck shared, api, and worker sequentially
npm run lint         # ESLint on api/src, worker/src, shared/src
npm test             # Local-scope tests (default)
npm run test:env     # Environment-scope tests
npm run test:db      # PostgreSQL-backed E2E tests (requires BACKEND_TEST_DATABASE_URL)
npm run verify       # Full backend quality gate
npm run verify:db    # Typecheck + DB tests
npm run init-db      # Initialize database schema
npm run check-config # Validate config loading
npm run admin-web:dev # Admin panel dev server on port 3300
```

### Running a Single Test

Frontend: Tests are `frontend/src/**/*.spec.ts[x]` (source-adjacent) and `frontend/tests/*.test.mjs` (root-level entrypoints). The custom runner at `frontend/scripts/run-tests.mjs` discovers and executes them via `node:test`.

Backend: Tests are in `backend/tests/`. Use `npm test` from `backend/` for local-scope tests. DB-backed tests require `BACKEND_TEST_DATABASE_URL` or `DATABASE_URL` env var.

## Architecture

### Frontend Layer Structure

Dependency direction flows downward — lower layers must not import from higher layers:

```
components/, hooks/, App.tsx          ← UI rendering and interaction
auth/, components/context/, execution-runtime/  ← session state, workflow runtime
services/                             ← domain logic (file binding, execution, protected resources)
api/                                  ← HTTP/WebSocket transport, token injection
```

**Key constraints:**
- `nodes/`, `execution-runtime/`, `services/`, `utils/` must NOT import from `components/context`
- `nodes/` must NOT import from `components/canvas` or `components/node/*` implementations
- Core/runtime layers must use precise module imports, not barrel exports (`@/services`, `@/hooks`, etc.)
- `WorkflowContext` is an orchestration layer — do not add node-specific logic there

### Backend Layer Structure

```
main/composition → controller → service → repository/shared-contracts
```

**Key constraints:**
- `service -> dto` is forbidden
- `service -> controller` is forbidden
- Business source files must not import `shared/src/**` directly
- Dependency wiring belongs in composition root

### Backend Sub-packages

- `backend/api/` (`@newworkflow/backend-api`) — HTTP/WebSocket API server
- `backend/worker/` (`@newworkflow/backend-worker`) — async task execution worker
- `backend/shared/` (`@newworkflow/backend-shared`) — shared types, constants, protocol definitions

### Canvas Image Delivery

Canvas rendering is thumbnail-first. Upgrades to preview only when display size crosses a threshold, with hysteresis to prevent ping-pong. Original/download resources are reserved for viewer and export paths. Remote protected images require authenticated blob fetches — never mount raw browser `src` when auth is required.

### Auth Model

- `AuthProvider` is the single source of truth for session state
- Access token in memory, refresh token in localStorage
- HTTP client auto-injects `Authorization: Bearer <accessToken>` and handles 401 refresh single-flight
- WebSocket reads token from session state (not URL params)
- Roles: `member` (own resources only) and `admin` (can inspect any resource)

### Persistence

Backend is the source of truth for workflow canvas persistence. Frontend local JSON import/export is an auxiliary archive path only. Files start upload scheduling immediately after entering the canvas with content-hash precheck. Canvas save uses debounce (800ms–1500ms) with single-flight guard for concurrent saves.

## Protected Review Paths

Changes to these paths require tracked issue references, tests, and extra scrutiny:

- `frontend/src/components/context/**`
- `frontend/src/components/canvas/**`
- `frontend/src/execution-runtime/**`
- `frontend/src/services/workflow-file-normalizer.ts`
- `frontend/src/services/backendExecutionService.ts`
- `frontend/src/services/workflow-upload-scheduler.ts`
- `frontend/src/services/image/**`
- `frontend/src/nodes/ai-storyboard/**`
- `frontend/src/nodes/shared/**`

## ESLint Key Rules

**Frontend** (`.eslintrc.cjs`):
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/explicit-function-return-type`: warn (off in test files)
- `@typescript-eslint/no-unused-vars`: error (ignore `_` prefix)
- `no-console`: warn (allows `warn` and `error`)
- `prefer-const`: error, `no-var`: error

**Backend** (`eslint.config.mjs`): Flat config format with same core rules (no-unused-vars, no-var, prefer-const).

## Dev Server Setup

- Frontend: `http://127.0.0.1:3000`
- Backend API: `http://127.0.0.1:3100`
- Vite proxies `/api` → `http://127.0.0.1:3100` and `/ws` → `ws://127.0.0.1:3100`
- Admin panel: `http://127.0.0.1:3300` (via `npm run admin-web:dev`)
- Optional env overrides: `VITE_API_BASE_URL`, `VITE_WS_URL`

## Quality Gate Rules

Before changing code:
- Identify whether the change touches a protected path
- Add or update tests before changing observable behavior
- No new `any` or `as any` in production code
- No broad `eslint-disable` comments
- No unbounded retry or polling loops
- No persistence fields without save/hydrate/reload tests
- No execution payload fields without backend shared contract updates

New nodes must include: type/task ownership, handle contracts, persistence behavior, execution payload contract, and tests. New execution paths must include: shared request/response types, validation, payload builder, task history, retry behavior, and tests.

## Documentation References

- `frontend/ARCHITECTURE.md` — detailed frontend architecture
- `backend/README.md` — backend documentation index and scope
- `docs/architecture-layer-rules.md` — dependency rules and cycle governance
- `quality-gate-rules.md` — quality gate requirements and admission rules
- `backend-docs/` — backend design documents (domain models, APIs, task lifecycle)
- `spec.md` — full product specification (Chinese)

---

# CLAUDE.md（中文版）

本文件为 Claude Code (claude.ai/code) 在此仓库中工作提供指导。

## 项目概述

Workflow Canvas Platform — 基于 ReactFlow 构建的协作式可视化工作流编辑器。用户在画布上排列图片、视频和 3D 模型，将其连接到 AI 服务（图像生成、视频生成、3D 重建），并在可视化的节点图界面中管理 AI 任务执行。代码库使用英文编写；产品界面使用中文。

## 技术栈

- **前端**: React 18 + Vite 5 + TailwindCSS 3 + ReactFlow 11 + Zustand + TanStack Query + PixiJS
- **后端**: Node.js/TypeScript（通过 `tsx` 执行）— API 服务器（端口 3100）+ Worker（端口 3200）+ 共享类型
- **数据库**: PostgreSQL（主要），旧版 JSON 存储回退（仅显式启用）
- **存储**: 本地文件存储，支持 S3 兼容选项

## 命令

### 统一质量门禁（从项目根目录 `newworkflow2/` 运行）

```powershell
.\verify-quality.ps1        # PowerShell
verify-quality.cmd           # CMD
```

按顺序快速失败执行：前端类型检查 → 代码检查 → 架构检查 → 测试 → 后端类型检查 → 代码检查 → 架构检查 → 测试。

### 前端（从 `frontend/`）

```bash
npm run dev          # Vite 开发服务器，端口 3000
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint，--max-warnings 0
npm test             # 通过 scripts/run-tests.mjs 的 node:test 流水线
npm run arch:report  # 架构规则扫描（仅报告）
npm run arch:check   # 架构规则强制执行（阻断）
npm run verify       # 完整质量门禁：类型检查 + 代码检查 + 架构检查 + 测试
```

### 后端（从 `backend/`）

```bash
npm run start        # 通过 scripts/start-backend.mjs --start 启动后端
npm run dev          # 以开发模式启动后端
npm run typecheck    # 按顺序类型检查 shared、api 和 worker
npm run lint         # 对 api/src、worker/src、shared/src 执行 ESLint
npm test             # 本地范围测试（默认）
npm run test:env     # 环境范围测试
npm run test:db      # PostgreSQL 支持的端到端测试（需要 BACKEND_TEST_DATABASE_URL）
npm run verify       # 完整后端质量门禁
npm run verify:db    # 类型检查 + 数据库测试
npm run init-db      # 初始化数据库模式
npm run check-config # 验证配置加载
npm run admin-web:dev # 管理面板开发服务器，端口 3300
```

### 运行单个测试

前端：测试文件位于 `frontend/src/**/*.spec.ts[x]`（源文件旁）和 `frontend/tests/*.test.mjs`（根级入口）。自定义运行器 `frontend/scripts/run-tests.mjs` 通过 `node:test` 发现并执行测试。

后端：测试文件位于 `backend/tests/`。从 `backend/` 使用 `npm test` 运行本地范围测试。数据库支持的测试需要 `BACKEND_TEST_DATABASE_URL` 或 `DATABASE_URL` 环境变量。

## 架构

### 前端层级结构

依赖方向自上而下 — 低层不得从高层导入：

```
components/, hooks/, App.tsx          ← UI 渲染和交互
auth/, components/context/, execution-runtime/  ← 会话状态、工作流运行时
services/                             ← 领域逻辑（文件绑定、执行、受保护资源）
api/                                  ← HTTP/WebSocket 传输、令牌注入
```

**关键约束：**
- `nodes/`、`execution-runtime/`、`services/`、`utils/` 不得从 `components/context` 导入
- `nodes/` 不得从 `components/canvas` 或 `components/node/*` 实现导入
- 核心/运行时层必须使用精确的模块导入，而不是桶导出（`@/services`、`@/hooks` 等）
- `WorkflowContext` 是编排层 — 不要在此添加节点特定逻辑

### 后端层级结构

```
main/composition → controller → service → repository/shared-contracts
```

**关键约束：**
- 禁止 `service -> dto` 导入
- 禁止 `service -> controller` 导入
- 业务源文件不得直接导入 `shared/src/**`
- 依赖注入属于组合根

### 后端子包

- `backend/api/`（`@newworkflow/backend-api`）— HTTP/WebSocket API 服务器
- `backend/worker/`（`@newworkflow/backend-worker`）— 异步任务执行 Worker
- `backend/shared/`（`@newworkflow/backend-shared`）— 共享类型、常量、协议定义

### 画布图像交付

画布渲染以缩略图为主。仅当显示尺寸超过阈值时才升级到预览，并使用滞后机制防止来回切换。原始/下载资源保留给查看器和导出路径。远程受保护图像需要经过认证的 blob 获取 — 需要认证时绝不能直接挂载浏览器原始 `src`。

### 认证模型

- `AuthProvider` 是会话状态的唯一真实来源
- 访问令牌存储在内存中，刷新令牌存储在 localStorage
- HTTP 客户端自动注入 `Authorization: Bearer <accessToken>` 并处理 401 刷新单飞机制
- WebSocket 从会话状态读取令牌（非 URL 参数）
- 角色：`member`（仅自有资源）和 `admin`（可检查任何资源）

### 持久化

后端是工作流画布持久化的唯一真实来源。前端本地 JSON 导入/导出仅作为辅助归档路径。文件在进入画布后立即开始上传调度，并带有内容哈希预检查。画布保存使用防抖（800ms–1500ms）和单飞机制防止并发保存。

## 受保护审查路径

更改这些路径需要关联的 issue 引用、测试和额外审查：

- `frontend/src/components/context/**`
- `frontend/src/components/canvas/**`
- `frontend/src/execution-runtime/**`
- `frontend/src/services/workflow-file-normalizer.ts`
- `frontend/src/services/backendExecutionService.ts`
- `frontend/src/services/workflow-upload-scheduler.ts`
- `frontend/src/services/image/**`
- `frontend/src/nodes/ai-storyboard/**`
- `frontend/src/nodes/shared/**`

## ESLint 关键规则

**前端**（`.eslintrc.cjs`）：
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/explicit-function-return-type`: warn（测试文件关闭）
- `@typescript-eslint/no-unused-vars`: error（忽略 `_` 前缀）
- `no-console`: warn（允许 `warn` 和 `error`）
- `prefer-const`: error，`no-var`: error

**后端**（`eslint.config.mjs`）：扁平配置格式，相同核心规则（no-unused-vars、no-var、prefer-const）。

## 开发服务器设置

- 前端：`http://127.0.0.1:3000`
- 后端 API：`http://127.0.0.1:3100`
- Vite 代理 `/api` → `http://127.0.0.1:3100`，`/ws` → `ws://127.0.0.1:3100`
- 管理面板：`http://127.0.0.1:3300`（通过 `npm run admin-web:dev`）
- 可选环境变量覆盖：`VITE_API_BASE_URL`、`VITE_WS_URL`

## 质量门禁规则

更改代码前：
- 确认更改是否涉及受保护路径
- 在更改可观察行为之前添加或更新测试
- 生产代码中不允许新的 `any` 或 `as any`
- 不允许宽泛的 `eslint-disable` 注释
- 不允许无界重试或轮询循环
- 持久化字段必须有 save/hydrate/reload 测试
- 执行负载字段必须有后端共享合约更新

新节点必须包含：类型/任务所有权、handle 契约、持久化行为、执行负载契约和测试。新执行路径必须包含：共享请求/响应类型、验证、负载构建器、任务历史、重试行为和测试。

## 文档参考

- `frontend/ARCHITECTURE.md` — 详细前端架构
- `backend/README.md` — 后端文档索引和范围
- `docs/architecture-layer-rules.md` — 依赖规则和循环治理
- `quality-gate-rules.md` — 质量门禁要求和准入规则
- `backend-docs/` — 后端设计文档（领域模型、API、任务生命周期）
- `spec.md` — 完整产品规格说明（中文）
