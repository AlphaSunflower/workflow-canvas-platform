import test from 'node:test';
import assert from 'node:assert/strict';

import type { Workflow } from '@/types';
import { createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import { createDraftWorkflowIdentity } from '@/services/workflow-session';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils';
import { materializeWorkflowSession, shouldUseBackendDefaultWorkflowName } from './workflow-materialization';

function createPersistedWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const now = Date.now();
  return {
    ...createEmptyWorkflow('project-materialize', 'Explicit Name'),
    ...createDraftWorkflowIdentity(),
    id: 'workflow-persisted',
    persistedWorkflowId: 'workflow-persisted',
    version: 3,
    ownerUserId: 'user-1',
    groupId: null,
    workflowGroupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    persistenceState: 'persisted',
    hasMaterializedCanvas: true,
    timestamp: {
      created: now - 1000,
      updated: now,
    },
    ...overrides,
  };
}

test('shouldUseBackendDefaultWorkflowName treats frontend draft placeholder as unnamed', () => {
  const draft = createEmptyWorkflow('project-default-name', '未命名工作流');
  assert.equal(shouldUseBackendDefaultWorkflowName(draft), true);
  assert.equal(shouldUseBackendDefaultWorkflowName({
    ...draft,
    name: '用户自定义名称',
  }), false);
  assert.equal(shouldUseBackendDefaultWorkflowName({
    ...draft,
    isAutoNamed: true,
    name: 'Anything',
  }), true);
});

test('materializeWorkflowSession creates blank record without forcing frontend placeholder name and then persists current content', async () => {
  const draft = createEmptyWorkflow('project-materialize', '未命名工作流');
  const node = createDefaultAINodeData(createSequentialNodeId(1), { x: 100, y: 120 }, 'aiImageGen');
  draft.nodes = {
    [node.id.value]: node,
  };
  draft.metadata.nodeCount = 1;

  const calls: Array<{ kind: 'blank' | 'persist'; payload: unknown }> = [];
  let committedWorkflow: Workflow | null = null;

  const savedWorkflow = await materializeWorkflowSession({
    getCurrentWorkflow: () => draft,
    createBlankWorkflow: async (request) => {
      calls.push({ kind: 'blank', payload: request });
      return createPersistedWorkflow({
        id: 'workflow-new',
        persistedWorkflowId: 'workflow-new',
        name: '新建画布',
        isAutoNamed: true,
        version: 1,
      });
    },
    persistWorkflow: async (workflow) => {
      calls.push({ kind: 'persist', payload: workflow });
      return createPersistedWorkflow({
        ...workflow,
        id: 'workflow-new',
        persistedWorkflowId: 'workflow-new',
        version: 2,
        name: '新建画布',
        isAutoNamed: true,
      });
    },
    commitWorkflow: (workflow) => {
      committedWorkflow = workflow;
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    kind: 'blank',
    payload: {
      projectId: 'project-materialize',
      groupId: null,
      viewport: draft.viewport,
      metadata: draft.metadata,
      timestamp: draft.timestamp.updated,
    },
  });
  assert.equal(calls[1]?.kind, 'persist');
  assert.equal((calls[1]?.payload as Workflow).id, 'workflow-new');
  assert.equal((calls[1]?.payload as Workflow).persistedWorkflowId, 'workflow-new');
  assert.equal((calls[1]?.payload as Workflow).persistenceState, 'persisted');
  assert.equal(Object.keys((calls[1]?.payload as Workflow).nodes).length, 1);
  assert.equal(savedWorkflow.id, 'workflow-new');
  assert.equal(savedWorkflow.version, 2);
  const committedWorkflowId = committedWorkflow === null
    ? null
    : (committedWorkflow as Workflow).id;
  assert.equal(committedWorkflowId, 'workflow-new');
});

test('materializeWorkflowSession returns persisted workflow immediately when current workflow is already materialized', async () => {
  const persisted = createPersistedWorkflow();
  let createCalled = false;
  let persistCalled = false;

  const result = await materializeWorkflowSession({
    getCurrentWorkflow: () => persisted,
    createBlankWorkflow: async () => {
      createCalled = true;
      return persisted;
    },
    persistWorkflow: async () => {
      persistCalled = true;
      return persisted;
    },
    commitWorkflow: () => undefined,
  });

  assert.equal(result, persisted);
  assert.equal(createCalled, false);
  assert.equal(persistCalled, false);
});
