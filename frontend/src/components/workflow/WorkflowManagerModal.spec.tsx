import test from 'node:test';
import assert from 'node:assert/strict';

import type { Result } from '@/types';
import { workflowApi } from '@/api';
import type { WorkflowManagerList } from '@/types';
import { buildWorkflowManagerSections, loadManagedWorkflowById } from './workflow-manager-modal.shared';

function createManagerList(): WorkflowManagerList {
  return {
    items: [
      {
        workflowId: 'workflow-ungrouped-1',
        projectId: 'project-1',
        ownerUserId: 'user-1',
        name: 'Ungrouped B',
        groupId: null,
        containerKey: '__ungrouped__',
        isAutoNamed: false,
        nodeCount: 5,
        connectionCount: 4,
        timestamp: 100,
        version: 3,
        createdAt: 100,
        updatedAt: 400,
        persistenceState: 'persisted',
      },
      {
        workflowId: 'workflow-group-1',
        projectId: 'project-1',
        ownerUserId: 'user-1',
        name: 'Grouped C',
        groupId: 'group-b',
        containerKey: 'group-b',
        isAutoNamed: true,
        nodeCount: 7,
        connectionCount: 6,
        timestamp: 100,
        version: 4,
        createdAt: 100,
        updatedAt: 500,
        persistenceState: 'persisted',
      },
      {
        workflowId: 'workflow-ungrouped-2',
        projectId: 'project-1',
        ownerUserId: 'user-1',
        name: 'Ungrouped A',
        groupId: null,
        containerKey: '__ungrouped__',
        isAutoNamed: false,
        nodeCount: 1,
        connectionCount: 0,
        timestamp: 100,
        version: 1,
        createdAt: 100,
        updatedAt: 200,
        persistenceState: 'persisted',
      },
      {
        workflowId: 'workflow-group-2',
        projectId: 'project-1',
        ownerUserId: 'user-1',
        name: 'Grouped A',
        groupId: 'group-a',
        containerKey: 'group-a',
        isAutoNamed: false,
        nodeCount: 2,
        connectionCount: 1,
        timestamp: 100,
        version: 2,
        createdAt: 100,
        updatedAt: 300,
        persistenceState: 'persisted',
      },
    ],
    groups: [
      {
        groupId: 'group-b',
        ownerUserId: 'user-1',
        name: 'Zeta',
        workflowCount: 1,
        createdAt: 100,
        updatedAt: 500,
      },
      {
        groupId: 'group-a',
        ownerUserId: 'user-1',
        name: 'Alpha',
        workflowCount: 1,
        createdAt: 100,
        updatedAt: 300,
      },
    ],
    total: 4,
  };
}

test('buildWorkflowManagerSections returns ungrouped section first and sorts groups by name', () => {
  const sections = buildWorkflowManagerSections(createManagerList());

  assert.equal(sections.length, 3);
  assert.equal(sections[0]?.group, null);
  assert.deepEqual(
    sections[0]?.items.map((item) => item.workflowId),
    ['workflow-ungrouped-1', 'workflow-ungrouped-2'],
  );
  assert.equal(sections[1]?.group?.name, 'Alpha');
  assert.equal(sections[2]?.group?.name, 'Zeta');
});

test('buildWorkflowManagerSections keeps empty groups visible for management actions', () => {
  const sections = buildWorkflowManagerSections({
    items: [],
    groups: [{
      groupId: 'group-empty',
      ownerUserId: 'user-1',
      name: 'Empty',
      workflowCount: 0,
      createdAt: 100,
      updatedAt: 100,
    }],
    total: 0,
  });

  assert.equal(sections.length, 2);
  assert.equal(sections[0]?.group, null);
  assert.equal(sections[0]?.items.length, 0);
  assert.equal(sections[1]?.group?.groupId, 'group-empty');
  assert.equal(sections[1]?.items.length, 0);
});

test('loadManagedWorkflowById loads workflow detail through explicit workflowId path', async () => {
  const originalGetById = workflowApi.getById;
  const requestedIds: string[] = [];

  workflowApi.getById = async (workflowId: string) => {
    requestedIds.push(workflowId);
    return {
      success: true,
      data: {
        id: workflowId,
        projectId: 'project-open',
        name: 'Opened Workflow',
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
          created: 100,
          updated: 200,
        },
        persistedWorkflowId: workflowId,
        persistenceState: 'persisted',
        hasMaterializedCanvas: true,
      },
    } satisfies Result<Awaited<ReturnType<typeof loadManagedWorkflowById>>>;
  };

  try {
    const workflow = await loadManagedWorkflowById('workflow-open-1');
    assert.deepEqual(requestedIds, ['workflow-open-1']);
    assert.equal(workflow.id, 'workflow-open-1');
    assert.equal(workflow.name, 'Opened Workflow');
    assert.equal(workflow.persistenceState, 'persisted');
  } finally {
    workflowApi.getById = originalGetById;
  }
});
