# Node ID Allocation

## Scope

This document freezes the node id allocation rules for the frontend canvas runtime.
It only covers canvas node numbering semantics and metadata meaning.
It does not change backend task id generation rules.

## Core Rules

- Node ids are allocated per workflow canvas.
- A node id can only be issued once within the same canvas.
- Deleted node ids must not be reused.
- Empty gaps left by deleted nodes are expected and valid.
- Even if all nodes are deleted, the next new node id must still start from `lastNodeId + 1`.
- A brand-new empty workflow may start allocation from `1`.

## Metadata Semantics

### `metadata.lastNodeId`

- Meaning: the highest node sequence that has ever been issued inside the workflow.
- This is a historical high-water mark, not the highest node id currently present on the canvas.
- This value must be monotonic and must never decrease because nodes were deleted.

### `metadata.usedNodeIds`

- Meaning: historical node ids known to have been issued in this workflow.
- Old workflow data may contain incomplete values.
- Loading logic must normalize this field together with current nodes and `lastNodeId`.

### `metadata.releasedNodeIds`

- This field is kept only for backward compatibility with older frontend logic.
- Released ids must not be reused for new node allocation.
- New allocation logic must ignore this field as an allocation source.

## Old Workflow Normalization

When loading or importing an existing workflow, frontend logic must normalize node id metadata with:

- `metadata.lastNodeId`
- the maximum numeric id among current workflow nodes
- the maximum numeric id inside `usedNodeIds`

The normalized `lastNodeId` must be the maximum of these values.

## Non-goals For This Round

- No backend id generation changes
- No task id or run id changes
- No changes to node display format such as `#00001`
- No hole-filling or id recycling strategy

## Acceptance Baseline

- Deleting node `#00001` and creating a new node must not recreate `#00001`.
- Deleting all nodes and creating a new node must not reset numbering back to `1`.
- Loading old workflow data must preserve monotonic node numbering after normalization.

## Regression Coverage

Automatic coverage must include:

- monotonic single allocation
- monotonic batch allocation
- delete one node then create again without id reuse
- delete all nodes then create again without resetting to `1`
- imported old workflow metadata normalization
- save and reload continuity based on preserved `lastNodeId`

Manual verification should follow `frontend/tests/manual/node-id-regression-checklist.md`.
