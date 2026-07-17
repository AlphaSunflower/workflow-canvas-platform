import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData, Workflow } from '@/types';
import {
  assertExecutionFilesReady,
  ensureExecutionFilesReady,
} from './execution-file-readiness';

function createFileNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();

  return {
    id: {
      value: 'file-node-1',
      display: '#00001',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 180 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: 'local-file-1',
    fileName: 'example.png',
    fileSize: 2048,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 512,
      height: 512,
    },
    ...overrides,
  };
}

function createWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const now = Date.now();

  return {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Workflow',
    nodes: {},
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 0,
      canvasSize: {
        width: 1600,
        height: 900,
      },
      relatedTasks: [],
      usedNodeIds: [],
      releasedNodeIds: [],
    },
    timestamp: {
      created: now,
      updated: now,
    },
    ...overrides,
  };
}

test('ensureExecutionFilesReady returns backend file ids for ready scheduler results', async () => {
  const workflow = createWorkflow();
  const fileNode = createFileNode();
  const schedulerCalls: string[] = [];

  const result = await ensureExecutionFilesReady(workflow, [fileNode], {
    scheduler: {
      getNodeSnapshot: () => null,
      ensureReady: async (node) => {
        schedulerCalls.push(node.id.value);
        return 'backend-file-1';
      },
    },
  });

  assert.deepEqual(schedulerCalls, ['file-node-1']);
  assert.deepEqual(result.readyFileIds, ['backend-file-1']);
  assert.deepEqual(result.issues, []);
});

test('assertExecutionFilesReady throws file-level issues when scheduler reports failures', async () => {
  const workflow = createWorkflow();
  const fileNode = createFileNode({
    id: {
      value: 'file-node-2',
      display: '#00002',
    },
    fileId: 'local-file-2',
    fileName: 'broken.png',
  });

  const result = await ensureExecutionFilesReady(workflow, [fileNode], {
    scheduler: {
      getNodeSnapshot: () => ({
        key: 'task-1',
        workflowId: workflow.id,
        nodeId: 'file-node-2',
        localFileId: 'local-file-2',
        backendFileId: null,
        status: 'failed',
        priority: 'high',
        progress: 0,
        error: 'hash mismatch',
        sha256: null,
        updatedAt: Date.now(),
      }),
      ensureReady: async () => {
        throw new Error('hash mismatch');
      },
    },
  });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.nodeId, 'file-node-2');
  assert.equal(result.issues[0]?.message, 'hash mismatch');

  const threwExpectedError = (() => {
    try {
      assertExecutionFilesReady(workflow, result);
      return false;
    } catch (error) {
      return (
        typeof error === 'object'
        && error !== null
        && 'message' in error
        && typeof error.message === 'string'
        && /broken\.png: hash mismatch/.test(error.message)
      );
    }
  })();

  assert.equal(threwExpectedError, true);
});
