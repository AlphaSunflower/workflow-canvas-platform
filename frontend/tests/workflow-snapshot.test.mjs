import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWorkflowRelatedTaskIds,
} from '../dist-tests/src/utils/workflow/snapshot-links.js';

function createWorkflow() {
  return {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Snapshot Workflow',
    nodes: {},
    connections: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 0,
      canvasSize: {
        width: 4000,
        height: 4000,
      },
      relatedTasks: [
        {
          taskId: 'task-1',
          taskNo: 'TASK-20260403-000001',
          batchId: 'batch-1',
          nodeId: '2',
          nodeDisplayId: '#00002',
          nodeType: 'aiImageGen',
        },
        {
          taskId: 'task-2',
          taskNo: 'TASK-20260403-000002',
          batchId: 'batch-1',
          nodeId: '2',
          nodeDisplayId: '#00002',
          nodeType: 'aiImageGen',
        },
      ],
      usedNodeIds: [],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 2,
    },
  };
}

test('collectWorkflowRelatedTaskIds returns stable task ids for snapshot saving', () => {
  const workflow = createWorkflow();

  assert.deepEqual(collectWorkflowRelatedTaskIds(workflow), ['task-1', 'task-2']);
});

test('collectWorkflowRelatedTaskIds dedupes repeated related task refs by task id', () => {
  const workflow = createWorkflow();
  workflow.metadata.relatedTasks = [
    workflow.metadata.relatedTasks[0],
    workflow.metadata.relatedTasks[0],
    workflow.metadata.relatedTasks[1],
  ];

  assert.deepEqual(collectWorkflowRelatedTaskIds(workflow), ['task-1', 'task-2']);
});

test('collectWorkflowRelatedTaskIds returns an empty array when workflow has no related tasks', () => {
  const workflow = createWorkflow();
  workflow.metadata.relatedTasks = [];

  assert.deepEqual(collectWorkflowRelatedTaskIds(workflow), []);
});
