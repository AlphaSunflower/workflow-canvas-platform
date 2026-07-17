import test from 'node:test';
import assert from 'node:assert/strict';

import type { Result, Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import { httpClient } from '../client/http-client';
import { workflowApi } from './workflow-api';

function createWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const now = Date.now();

  return {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Workflow A',
    nodes: {},
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 0,
      canvasSize: { width: 1920, height: 1080 },
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

function createWorkflowDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workflowId: 'workflow-new',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    workflow: {
      id: 'workflow-new',
      projectId: 'project-1',
      name: 'Latest Workflow',
      nodes: {},
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 0,
        connectionCount: 0,
        lastNodeId: 0,
        canvasSize: { width: 1920, height: 1080 },
      },
      timestamp: 1712707200000,
      version: 2,
    },
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    ...overrides,
  };
}

test('workflowApi.listManaged returns account-scoped management payload', async () => {
  const originalGet = httpClient.get.bind(httpClient);
  const requestedPaths: string[] = [];

  httpClient.get = async <T>(path: string) => {
    requestedPaths.push(path);

    return {
      success: true,
      data: {
        items: [
          {
            workflowId: 'workflow-1',
            projectId: 'project-1',
            ownerUserId: 'user-1',
            name: 'Workflow One',
            groupId: null,
            containerKey: '__ungrouped__',
            isAutoNamed: true,
            nodeCount: 0,
            connectionCount: 0,
            timestamp: 1712707200000,
            version: 1,
            createdAt: '2026-04-09T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
          },
        ],
        groups: [
          {
            groupId: 'group-1',
            ownerUserId: 'user-1',
            name: 'Group One',
            workflowCount: 1,
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    } as Result<T>;
  };

  try {
    const result = await workflowApi.listManaged();
    assert.equal(result.success, true);
    assert.deepEqual(requestedPaths, ['/api/v1/workflows/manage']);
    assert.equal(result.data?.items[0]?.workflowId, 'workflow-1');
    assert.equal(result.data?.items[0]?.persistenceState, 'persisted');
    assert.equal(result.data?.groups[0]?.groupId, 'group-1');
  } finally {
    httpClient.get = originalGet;
  }
});

test('workflowApi.getById loads workflow detail directly by workflowId', async () => {
  const originalGet = httpClient.get.bind(httpClient);
  const requestedPaths: string[] = [];

  httpClient.get = async <T>(path: string) => {
    requestedPaths.push(path);

    return {
      success: true,
      data: createWorkflowDetail(),
    } as Result<T>;
  };

  try {
    const result = await workflowApi.getById('workflow-new');
    assert.equal(result.success, true);
    assert.deepEqual(requestedPaths, ['/api/v1/workflows/workflow-new']);
    assert.equal(result.data?.id, 'workflow-new');
    assert.equal(result.data?.ownerUserId, 'user-1');
    assert.equal(result.data?.containerKey, '__ungrouped__');
    assert.equal(result.data?.persistenceState, 'persisted');
  } finally {
    httpClient.get = originalGet;
  }
});

test('workflowApi.createBlank posts blank workflow payload and hydrates persisted result', async () => {
  const originalPost = httpClient.post.bind(httpClient);
  const postCalls: Array<{ path: string; payload: unknown }> = [];

  httpClient.post = async <T>(path: string, payload?: unknown) => {
    postCalls.push({ path, payload });
    return {
      success: true,
      data: createWorkflowDetail({
        workflowId: 'workflow-blank',
        isAutoNamed: true,
        workflow: {
          ...createWorkflowDetail().workflow,
          id: 'workflow-blank',
          name: '新建画布',
          version: 1,
        },
      }),
    } as Result<T>;
  };

  try {
    const result = await workflowApi.createBlank({
      projectId: 'project-blank',
      groupId: null,
      viewport: { x: 12, y: 24, zoom: 0.8 },
      metadata: { nodeCount: 0 },
      timestamp: 1712707200000,
    });

    assert.equal(result.success, true);
    assert.deepEqual(postCalls, [{
      path: '/api/v1/workflows/blank',
      payload: {
        projectId: 'project-blank',
        groupId: null,
        viewport: { x: 12, y: 24, zoom: 0.8 },
        metadata: { nodeCount: 0 },
        timestamp: 1712707200000,
      },
    }]);
    assert.equal(result.data?.id, 'workflow-blank');
    assert.equal(result.data?.persistedWorkflowId, 'workflow-blank');
    assert.equal(result.data?.persistenceState, 'persisted');
    assert.equal(result.data?.isAutoNamed, true);
  } finally {
    httpClient.post = originalPost;
  }
});

test('workflowApi.save uses POST for non-persisted workflow and PUT for persisted workflow', async () => {
  const originalPost = httpClient.post.bind(httpClient);
  const originalPut = httpClient.put.bind(httpClient);
  const postPaths: string[] = [];
  const putPaths: string[] = [];

  httpClient.post = async <T>(path: string) => {
    postPaths.push(path);
    return {
      success: true,
      data: createWorkflowDetail({
        workflowId: 'workflow-created',
        workflow: {
          ...createWorkflowDetail().workflow,
          id: 'workflow-created',
          name: 'Created Workflow',
          version: 1,
        },
      }),
    } as Result<T>;
  };

  httpClient.put = async <T>(path: string) => {
    putPaths.push(path);
    return {
      success: true,
      data: createWorkflowDetail({
        workflowId: 'workflow-updated',
        workflow: {
          ...createWorkflowDetail().workflow,
          id: 'workflow-updated',
          name: 'Updated Workflow',
          version: 3,
        },
      }),
    } as Result<T>;
  };

  try {
    const createResult = await workflowApi.save(createWorkflow({
      id: 'workflow-created',
      version: undefined,
      persistenceState: 'draft',
    }));
    const updateResult = await workflowApi.save(createWorkflow({
      id: 'workflow-updated',
      version: 2,
      ownerUserId: 'user-1',
      persistenceState: 'persisted',
    }));

    assert.equal(createResult.success, true);
    assert.equal(updateResult.success, true);
    assert.deepEqual(postPaths, ['/api/v1/workflows']);
    assert.deepEqual(putPaths, ['/api/v1/workflows/workflow-updated']);
  } finally {
    httpClient.post = originalPost;
    httpClient.put = originalPut;
  }
});

test('workflowApi.save persists the normalized workflow graph payload on update', async () => {
  const originalPut = httpClient.put.bind(httpClient);
  const putCalls: Array<{ path: string; payload: unknown }> = [];
  const sourceNode = createDefaultAINodeData(
    createSequentialNodeId(1),
    { x: 120, y: 160 },
    'aiImageGen',
  );
  const workflowToSave = createWorkflow({
    id: 'workflow-persisted',
    version: 4,
    ownerUserId: 'user-1',
    persistenceState: 'persisted',
    nodes: {
      [sourceNode.id.value]: sourceNode,
    },
    connections: [{
      id: 'connection-1',
      type: 'output-link',
      sourceId: sourceNode.id.value,
      targetId: 'node-output-1',
      sourceHandle: 'group-1:result',
      order: 0,
    }],
    viewport: { x: 48, y: 24, zoom: 0.85 },
    metadata: {
      nodeCount: 1,
      connectionCount: 1,
      lastNodeId: 1,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: ['1'],
      releasedNodeIds: [],
    },
  });

  httpClient.put = async <T>(path: string, payload?: unknown) => {
    putCalls.push({ path, payload });
    return {
      success: true,
      data: createWorkflowDetail({
        workflowId: 'workflow-persisted',
        workflow: {
          ...createWorkflowDetail().workflow,
          id: 'workflow-persisted',
          name: workflowToSave.name,
          nodes: workflowToSave.nodes,
          connections: workflowToSave.connections,
          viewport: workflowToSave.viewport,
          metadata: workflowToSave.metadata,
          timestamp: workflowToSave.timestamp.updated,
          version: 5,
        },
      }),
    } as Result<T>;
  };

  try {
    const result = await workflowApi.save(workflowToSave);
    assert.equal(result.success, true);
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0]?.path, '/api/v1/workflows/workflow-persisted');

    const payload = putCalls[0]?.payload as Record<string, unknown>;
    assert.equal(payload.projectId, workflowToSave.projectId);
    assert.equal(payload.name, workflowToSave.name);
    assert.deepEqual(payload.connections, workflowToSave.connections);
    assert.deepEqual(payload.viewport, workflowToSave.viewport);
    assert.deepEqual(payload.metadata, workflowToSave.metadata);
    assert.equal(payload.version, 4);
    assert.equal(typeof payload.timestamp, 'number');

    const nodes = payload.nodes as Record<string, unknown>;
    assert.deepEqual(Object.keys(nodes), [sourceNode.id.value]);
    assert.deepEqual(
      nodes[sourceNode.id.value],
      workflowToSave.nodes[sourceNode.id.value],
    );
  } finally {
    httpClient.put = originalPut;
  }
});

test('workflowApi.moveToGroup updates workflow via explicit group endpoint', async () => {
  const originalPatch = httpClient.patch.bind(httpClient);
  const patchCalls: Array<{ path: string; payload: unknown }> = [];

  httpClient.patch = async <T>(path: string, payload?: unknown) => {
    patchCalls.push({ path, payload });

    return {
      success: true,
      data: createWorkflowDetail({
        workflowId: 'workflow-new',
        groupId: 'group-1',
        containerKey: 'group-1',
      }),
    } as Result<T>;
  };

  try {
    const result = await workflowApi.moveToGroup('workflow-new', 'group-1');
    assert.equal(result.success, true);
    assert.deepEqual(patchCalls, [{
      path: '/api/v1/workflows/workflow-new/group',
      payload: { groupId: 'group-1' },
    }]);
    assert.equal(result.data?.groupId, 'group-1');
    assert.equal(result.data?.containerKey, 'group-1');
  } finally {
    httpClient.patch = originalPatch;
  }
});

test('workflowApi.rename updates workflow name via explicit rename endpoint', async () => {
  const originalPatch = httpClient.patch.bind(httpClient);
  const patchCalls: Array<{ path: string; payload: unknown }> = [];

  httpClient.patch = async <T>(path: string, payload?: unknown) => {
    patchCalls.push({ path, payload });

    return {
      success: true,
      data: createWorkflowDetail({
        workflowId: 'workflow-rename',
        workflow: {
          ...createWorkflowDetail().workflow,
          id: 'workflow-rename',
          name: 'Renamed Workflow',
          version: 4,
        },
      }),
    } as Result<T>;
  };

  try {
    const result = await workflowApi.rename('workflow-rename', 'Renamed Workflow');
    assert.equal(result.success, true);
    assert.deepEqual(patchCalls, [{
      path: '/api/v1/workflows/workflow-rename/name',
      payload: { name: 'Renamed Workflow' },
    }]);
    assert.equal(result.data?.id, 'workflow-rename');
    assert.equal(result.data?.name, 'Renamed Workflow');
    assert.equal(result.data?.version, 4);
  } finally {
    httpClient.patch = originalPatch;
  }
});
