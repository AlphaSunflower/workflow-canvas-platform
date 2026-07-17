# Architecture Layer Rules

This document defines the current architecture dependency rules for the codebase cleanup.  
The current phase is blocking for the rule categories already stabilized by Tasks 1-11.

## Scope

- frontend: `frontend/src`
- backend api: `backend/api/src`
- backend worker: `backend/worker/src`

## Frontend Rules

Target dependency direction:

- `components -> hooks/services/nodes/contracts/utils/constants/types`
- `hooks -> services/contracts/utils/constants/types`
- `services -> contracts/utils/constants/types`
- `execution-runtime -> contracts/services/utils/constants/types`
- `nodes -> contracts/services/utils/constants/types`

Restricted dependencies:

- `nodes -> components/context` is forbidden
- `execution-runtime -> components/context` is forbidden
- `services -> components/context` is forbidden
- `utils -> components/context` is forbidden
- `nodes/execution-runtime/services/utils -> non-UI components` should be treated as a violation
- `nodes -> components/canvas` is forbidden
- `nodes -> components/node/* implementation` is forbidden
- `nodes/execution-runtime -> hooks` should be treated as a violation when used as a contract source
- `src/nodes/**/*.tsx` is treated as node UI adapter surface during scanning; core node governance remains focused on `nodes/**/*.ts`

Cycle classification rules:

- `runtime cycle`: every participating loop can be closed through runtime imports only; this is the primary governance target
- `type-only cycle`: all edges inside the loop are `import type` or `export type`; this is reported but not a primary split target
- `mixed cycle`: the component contains both runtime and type-only edges, but the runtime-only subgraph is not itself strongly connected

High-risk cycle markers:

- root barrel participant: `src/services/index.ts`, `src/hooks/index.ts`, `src/components/context/index.ts`, `src/nodes/index.ts`
- side-effect index participant: `index.ts` or `index.tsx` with top-level executable registration or bootstrap logic
- singleton service participant: service/runtime module exporting instantiated singleton objects such as `export const foo = new ...`

Frontend cycle governance order:

- first reduce `runtimeCycles`
- then reduce `mixedCycles`, especially those with side-effect index or singleton markers
- reduce `typeOnlyCycles` when contract simplification is already underway
- do not over-split stable type modules only to force the total cycle count to zero

Current architectural intent:

- `components/context` is application UI orchestration, not a domain contract layer
- `nodes` should express node definitions, node logic, and runtime rules, not page-context ownership
- `execution-runtime` should depend on stable contracts, not UI-layer hooks or context modules
- node renderer `.tsx` files may compose UI concerns, but must not pull context ownership back into node core/runtime `.ts` modules

Canvas visibility ownership:

- `visibleNodes` supplies viewport visibility facts.
- `CanvasRenderPlan` is the only source for node DOM lifecycle, render tier, hidden edges, and raster eligibility.
- React Flow must keep `onlyRenderVisibleElements={false}`; dynamic React Flow clipping switches are forbidden.
- Dynamic-handle keepalive belongs in render plan / DOM windowing rules, not in React Flow visibility clipping.

## Backend Rules

Target dependency direction:

- `main/composition -> controller -> service -> repository/shared-contracts`
- worker: `main/app/composition -> service -> repository/shared-contracts`

Restricted dependencies:

- `service -> dto` is forbidden
- `service -> controller` is forbidden
- business source files must not import `shared/src/**` directly

Current architectural intent:

- dependency wiring belongs in composition root, not in service/controller/repository internals
- dto types belong to transport boundary, not application service contracts
- shared package internals must not become a cross-package public API surface

## Commands

Frontend report:

```bash
npm run arch:report
```

Frontend blocking check:

```bash
npm run arch:check
```

Backend report:

```bash
npm run arch:report
```

Backend blocking check:

```bash
npm run arch:check
```

Or from `newworkflow2/`:

```powershell
npm --prefix ./frontend run arch:report
npm --prefix ./frontend run arch:check
npm --prefix ./backend run arch:report
npm --prefix ./backend run arch:check
```

## Blocking Mode

Current blocking gate covers these categories:

- frontend reverse dependency violations into `components/context`
- frontend restricted cross-layer imports from `nodes/execution-runtime/services/utils`
- backend `service -> dto` and `service -> controller`
- backend `shared/src/**` penetration
- backend dependency cycles in API/Worker source

Current `verify` integration:

- frontend `verify`: `typecheck -> lint -> arch:check -> test`
- backend `verify`: `typecheck -> lint -> arch:check -> test`
- root `verify-quality.ps1`: invokes both frontend and backend architecture checks

Known temporary carve-out:

- frontend dependency cycles are still reported in `arch:report`, but are not yet fail-fast in `arch:check`
- reason: the remaining cycles are structural follow-up work and should be governed by `runtimeCycles` and high-risk mixed-cycle markers first, not by a blanket zero-cycle target
