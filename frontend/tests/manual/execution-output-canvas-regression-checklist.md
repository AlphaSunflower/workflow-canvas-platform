# Execution Output Canvas Regression Checklist

## Scope

Validate that real execution outputs are committed to the workflow graph and stay visible on the canvas:

- result file node creation
- output-link creation
- source node `outputs` update
- external-output hydration ordering
- stale ReactFlow instance writeback protection
- save and reload persistence
- historical missing-output reconcile

## Preconditions

- Start backend API and worker with valid provider configuration for at least one real execution node.
- Start frontend in development mode.
- Open DevTools Console and keep the Network tab available.
- Prepare a workflow with `aiImageGen` and `aiVideoGen` nodes that can run successfully.
- Prepare at least one workflow that previously showed “completed but no result node” if available.

## Automated Gate

Run these checks before manual release verification:

```powershell
cd D:\Project\newflow5\newworkflow2\frontend
npm.cmd run typecheck
$env:TEST_FILE='execution-output-commit.service.spec.js'; npm.cmd test
$env:TEST_FILE='execution-output-reconcile.service.spec.js'; npm.cmd test
$env:TEST_FILE='workflow-runtime-sync.spec.js'; npm.cmd test
$env:TEST_FILE='canvas-sync.spec.js'; npm.cmd test
$env:TEST_FILE='canvas-output-hydration.spec.js'; npm.cmd test
$env:TEST_FILE='WorkflowContext.persistence.spec.js'; npm.cmd test

cd D:\Project\newflow5\newworkflow2\backend\shared
npm.cmd run typecheck

cd D:\Project\newflow5\newworkflow2\backend\api
npm.cmd run typecheck
node --import tsx --test ./src/modules/executions/execution-query.service.spec.ts
```

## Manual Scenarios

### 1. Image Generation Output Commit

1. Open a workflow with an `aiImageGen` real execution node.
2. Connect valid inputs and run the node.
3. Wait until the backend run and task report `completed`.

Expected:

- A new image file node appears to the right of the source execution group.
- An `output-link` connects the source result handle to the new file node.
- The source AI node `outputs` contains the generated `resultFileId`.
- The result node preview loads and does not disappear after hover, pan, or zoom.

### 2. Video Generation Output Commit

1. Open a workflow with an `aiVideoGen` node.
2. Use a valid prompt and one group with one or two reference images.
3. Run the node and wait for completion.

Expected:

- A new video file node appears to the right of the matching input group.
- The result node type is `video`, not `image`.
- The result node is connected by an `output-link` using the matching `groupId:result` source handle.
- The video node can be selected and opened without breaking the link.

### 3. Save And Reload

1. After a result node appears, save the workflow.
2. Refresh or reopen the workflow.
3. Inspect the same source node and output node.

Expected:

- The result file node still exists.
- The `output-link` still exists and targets the same result node.
- The source node `outputs` still contains the result file id.
- `metadata.lastNodeId`, `metadata.nodeCount`, and `metadata.connectionCount` match the visible graph.

### 4. Stale Canvas Sync Guard

1. Trigger a real execution output commit.
2. Immediately pan or zoom the canvas while the output is hydrating.
3. Wait a few seconds and inspect the graph.

Expected:

- The new output node is not removed by a delayed ReactFlow instance sync.
- The `output-link` is not removed.
- There is no state where `metadata.lastNodeId` advances while the corresponding result node is missing.

### 5. Historical Missing Output Reconcile

1. Open a workflow where a backend run completed but no result node was placed on the canvas.
2. Wait for workflow load and reconcile to complete.
3. If auto reconcile does not trigger, rerun the affected node only after recording the loaded state.

Expected:

- Existing backend `resultFileId` is reconstructed into a file node and output-link without rerunning the provider task.
- Existing result nodes are not duplicated.
- Partially missing graphs are repaired: node-only, link-only, and source-output-only states converge to a complete graph.

### 6. Partial Group Success

1. Run a grouped node where at least one group succeeds and one group fails or is cancelled.
2. Wait until the run reaches a terminal state.

Expected:

- Successful groups create and link only their own result nodes.
- Failed groups do not create fake result nodes.
- Group handles are not crossed between outputs.

## Debug Checks

Use these observations when a result is missing:

- Query `GET /api/v1/executions/:runId` and verify `tasks[].resultFileId`.
- Query `GET /api/v1/workflows/:workflowId/executions/reconcile?nodeId=:nodeId` and verify it returns the latest completed run.
- Inspect the workflow graph after commit and verify:

```js
workflow.nodes[resultNodeId]
workflow.connections.filter((connection) => connection.type === 'output-link')
workflow.nodes[sourceNodeId].outputs
workflow.metadata.lastNodeId
```

## Release Record Template

- Build / branch:
- Browser / OS:
- Backend / worker process:
- Workflow id:
- Node types checked:
- Run ids:
- Image output result:
- Video output result:
- Save/reload result:
- Reconcile result:
- Network or provider errors:
- Remaining risks:

## Residual Risks

- Reconcile uses backend task `groupId` fallback handles such as `group-1:result` because older task records do not persist a separate output handle.
- Manual provider runs can fail for external API, quota, or network reasons; separate provider failure from frontend canvas commit failure by checking `resultFileId`.
- Development ReactFlow timing can differ from production builds, so at least one save/reload test should be repeated in a production preview before release.
