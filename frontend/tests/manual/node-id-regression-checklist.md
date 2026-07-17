# Node ID Regression Checklist

## Goal

Verify that node ids are monotonic within a single canvas and never reused after deletion.

## Checklist

### Case 1: Delete one node, then create again

1. Create a new blank workflow.
2. Create one node and confirm id is `#00001`.
3. Delete `#00001`.
4. Create one new node.
5. Confirm the new node id is `#00002`, not `#00001`.

### Case 2: Delete all nodes, then create again

1. Create a new blank workflow.
2. Create three nodes and confirm ids are `#00001`, `#00002`, `#00003`.
3. Delete all nodes.
4. Create one new node.
5. Confirm the new node id is `#00004`.

### Case 3: Batch import gets continuous ids

1. Start from a workflow whose latest node id is known, for example `#00004`.
2. Batch import three files.
3. Confirm placeholder/imported nodes receive continuous ids `#00005`, `#00006`, `#00007`.
4. Delete one of these nodes.
5. Import one more file.
6. Confirm the new node id is `#00008`, not the deleted id.

### Case 4: Save, reload, and create again

1. Create several nodes until the latest id is known, for example `#00005`.
2. Delete all nodes.
3. Save the workflow.
4. Reload the workflow from backend or local archive.
5. Create one new node.
6. Confirm the new node id is `#00006`.

### Case 5: Import old workflow data

1. Prepare a workflow whose metadata has a higher historical `lastNodeId` than the current nodes on canvas.
2. Import the workflow.
3. Create a new node.
4. Confirm the new node id continues from the historical max id instead of the current visible max id.

## Pass Criteria

- No deleted node id is ever reused in the same canvas.
- Deleting all nodes does not reset numbering.
- Batch import always produces continuous fresh ids.
- Save and reload do not cause numbering to fall back to `#00001`.
