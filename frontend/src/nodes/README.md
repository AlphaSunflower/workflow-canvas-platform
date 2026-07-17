## Nodes Contract

`src/nodes` is the only legal AI node entry in this project.

### 1. Entry Rules

All AI nodes must be registered through:

- `src/nodes/types.ts`
- `src/nodes/registry.ts`
- `src/nodes/index.ts`

Do not reintroduce:

- `components/node/nodeTypes.ts`
- `components/node/ai/*`
- any AI node wrapper registered outside `src/nodes`

### 2. NodeDefinition

Every AI node must provide a `NodeDefinition`.

Required fields:

- `type`
- `stage`
- `displayName`
- `icon`
- `color`
- `description`
- `menu`
- `defaultSize`
- `defaultConfig`
- `component`
- `validateConnection`
- `execution`

Optional fields:

- `inputGroups`
- `resolveInputGroups`
- `drop`
- `actions`
- `createNodeData`
- `defaultInputGroups`

Placeholder nodes and full nodes use the same registry. The difference is definition shape, not entry path.

`menu` is the only supported source of truth for node creation menu visibility.

- `menu.order`: creation order in the canvas context menu
- `menu.group`: menu grouping
- `menu.visible?: boolean`: explicit visibility switch; `false` hides the node from creation menus
- `menu.contexts?: ('canvas')[]`: optional menu context allowlist; when omitted, current menus treat the node as visible by default

Do not reuse `stage` to control whether a node appears in the right-click creation menu.

### 3. Shared Input Group Protocol

Use the shared group contract from:

- `src/nodes/types.ts`
- `src/nodes/shared/connection.ts`
- `src/nodes/shared/group-query.ts`
- `src/nodes/shared/groups.ts`

Handle format is always:

- `groupId:portId`

Examples:

- `group-1:images`
- `group-2:image`
- `group-3:render`
- `group-3:reference`
- `group-5:result`

Do not introduce raw `groupId` handles in new code.

### 4. Shared Node Action Contract

Node-internal UI actions must be declared on the node definition and dispatched through the shared node-action entry.

Shared files:

- `src/nodes/types.ts`
- `src/nodes/shared/node-actions.ts`
- `src/components/context/workflow-context.types.ts`

Contract rules:

- Declare node-internal actions through `NodeDefinition.actions`.
- Use `NodeActionDefinition.id` as the only stable action identifier.
- UI components dispatch through `actions.runNodeAction({ nodeId, actionId, targetId, options })`.
- `targetId` is required only when the action definition sets `targetRequired: true`.
- Validation belongs in `NodeActionDefinition.validate`, not in ad-hoc component branches.
- Node-specific public `WorkflowContext` actions are not allowed for new nodes.

`NodeActionOnlyExecutionAdapter` is the supported execution boundary for workbench-style nodes that do not map to one generic backend execution request. `aiStoryboard` is the current reference implementation:

- internal actions are declared in `src/nodes/ai-storyboard/runtime.ts`
- UI dispatches through `runNodeAction`
- runtime adapter exposes `mode: 'node-action-only'`

### 5. Shared Runtime Protocol

Connection, drag-drop, execution, and output write-back are shared capabilities.

Shared files:

- `src/nodes/shared/connection.ts`
- `src/nodes/shared/drop.ts`
- `src/nodes/shared/runtime.ts`
- `src/execution-runtime/**`

`WorkflowContext` only dispatches by definition and maintains generic orchestration utilities. `Canvas` only consumes registered definitions and shared adapters.

### 6. WorkflowContext Boundary

`WorkflowContext` is allowed to provide:

- generic workflow persistence and runtime snapshot sync
- generic `runNodeAction` dispatch
- shared execution polling, task-ref persistence, notification, and auth gates
- thin service injection needed by node-domain runners

`WorkflowContext` must not:

- expose new node-specific public actions
- add `node.type === ...` feature branches for new nodes
- host node-specific drop logic, resize logic, or output reconcile fallbacks
- become the long-term owner of node business rules

If a node needs custom orchestration, land node-domain services under `src/nodes/<node-name>/` first and keep the context layer as a thin adapter only.

### 7. Ownership Boundary

Common-layer files:

- `src/nodes/types.ts`
- `src/nodes/registry.ts`
- `src/nodes/index.ts`
- `src/nodes/shared/*`
- `src/components/canvas/Canvas.tsx`
- `src/components/context/WorkflowContext.tsx`
- `src/utils/node/create.ts`
- `src/utils/workflow/runtime.ts`
- `src/utils/validators/node-validators.ts`
- `src/utils/validators/workflow-validators.ts`

Single-node owners should only edit:

- `src/nodes/<node-name>/**`

If a node needs a new shared capability, raise it first and land the common-layer change separately.

### 8. Recommended Node Folder Shape

Current nodes may still be simple, but the preferred shape is:

```text
src/nodes/<node-name>/
  index.tsx
  component.tsx
  groups.ts
  runtime.ts
  drop.ts
  constants.ts
```

Workbench-style or contract-heavy nodes may additionally carry:

```text
src/nodes/<node-name>/
  ...base files
  *.service.ts
  *.runner.ts
  *.spec.ts
```

Keep private logic inside the node folder. Do not push node-specific behavior into `Canvas.tsx` or `WorkflowContext.tsx`.
