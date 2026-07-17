import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import type { Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  createWorkflowSaveOrchestrator,
  materializeDraftWorkflowViaOrchestrator,
} from './workflow-save-orchestrator';

function createPersistedWorkflow(): Workflow {
  return {
    ...createEmptyWorkflow('project-save-orchestrator', 'Persisted Workflow'),
    id: 'workflow-save-orchestrator',
    persistedWorkflowId: 'workflow-save-orchestrator',
    persistenceState: 'persisted',
    hasMaterializedCanvas: true,
  };
}

function createDraftWorkflow(): Workflow {
  return createEmptyWorkflow('project-save-orchestrator', 'Draft Workflow');
}

test('workflow save orchestrator persists authoritative workflow through the single backend save pipeline', async () => {
  const persistedWorkflow = createPersistedWorkflow();
  const backendSavedWorkflow: Workflow = {
    ...persistedWorkflow,
    timestamp: {
      ...persistedWorkflow.timestamp,
      updated: persistedWorkflow.timestamp.updated + 10,
    },
  };
  const callOrder: string[] = [];
  const orchestrator = createWorkflowSaveOrchestrator({
    getAuthoritativeWorkflow: () => persistedWorkflow,
    materializeDraftWorkflow: async () => {
      callOrder.push('materialize');
      return persistedWorkflow;
    },
    persistWorkflow: async (workflowToSave) => {
      callOrder.push('persist-api');
      assert.equal(workflowToSave.id, persistedWorkflow.id);
      return backendSavedWorkflow;
    },
    commit: {
      commitPersistedWorkflow: (workflowToCommit) => {
        callOrder.push('commit');
        assert.equal(workflowToCommit, backendSavedWorkflow);
        return workflowToCommit;
      },
    },
  });

  const savedWorkflow = await orchestrator.saveAuthoritativeWorkflow({
    force: true,
    silent: false,
    reason: 'manual',
  });

  assert.equal(savedWorkflow, backendSavedWorkflow);
  assert.deepEqual(callOrder, ['persist-api', 'commit']);
});

test('workflow save orchestrator materializes draft workflows before real backend persistence', async () => {
  const draftWorkflow = createDraftWorkflow();
  const materializedWorkflow = createPersistedWorkflow();
  const backendSavedWorkflow: Workflow = {
    ...materializedWorkflow,
    timestamp: {
      ...materializedWorkflow.timestamp,
      updated: materializedWorkflow.timestamp.updated + 20,
    },
  };
  let currentWorkflow: Workflow | null = draftWorkflow;
  const callOrder: string[] = [];

  const orchestrator = createWorkflowSaveOrchestrator({
    getAuthoritativeWorkflow: () => currentWorkflow,
    materializeDraftWorkflow: async () => {
      callOrder.push('materialize');
      currentWorkflow = materializedWorkflow;
      return materializedWorkflow;
    },
    persistWorkflow: async (workflowToSave) => {
      callOrder.push('persist-api');
      assert.equal(workflowToSave.id, materializedWorkflow.id);
      return backendSavedWorkflow;
    },
    commit: {
      commitPersistedWorkflow: (workflowToCommit) => {
        callOrder.push('commit');
        assert.equal(workflowToCommit, backendSavedWorkflow);
        return workflowToCommit;
      },
    },
  });

  await orchestrator.saveAuthoritativeWorkflow({
    force: true,
    silent: true,
    reason: 'manual',
  });

  assert.deepEqual(callOrder, ['materialize', 'persist-api', 'commit']);
});

test('workflow save orchestrator resolves the latest authoritative workflow at auto-save execution time', async () => {
  const initialWorkflow = createPersistedWorkflow();
  const latestWorkflow: Workflow = {
    ...initialWorkflow,
    nodes: {
      'node-latest': createDefaultAINodeData(
        createSequentialNodeId(1),
        { x: 10, y: 20 },
        'aiImageGen',
      ),
    },
    metadata: {
      ...initialWorkflow.metadata,
      nodeCount: 1,
      lastNodeId: 1,
    },
  };
  let currentWorkflow: Workflow | null = initialWorkflow;
  const seenPersistedNodeKeys: string[][] = [];

  const orchestrator = createWorkflowSaveOrchestrator({
    getAuthoritativeWorkflow: () => currentWorkflow,
    materializeDraftWorkflow: async () => {
      throw new Error('should not materialize persisted workflow');
    },
    persistWorkflow: async (workflowToSave) => {
      seenPersistedNodeKeys.push(Object.keys(workflowToSave.nodes));
      return workflowToSave;
    },
    commit: {
      commitPersistedWorkflow: (workflowToCommit) => workflowToCommit,
    },
  });

  currentWorkflow = latestWorkflow;
  await orchestrator.saveAuthoritativeWorkflow({
    force: true,
    silent: true,
    reason: 'auto-fallback',
  });

  assert.deepEqual(seenPersistedNodeKeys, [['node-latest']]);
});

test('materializeDraftWorkflowViaOrchestrator reuses the real save orchestrator persistence hook for draft promotion', async () => {
  const draftWorkflow = createDraftWorkflow();
  const persistedWorkflow = createPersistedWorkflow();
  const committedWorkflows: Workflow[] = [];

  const result = await materializeDraftWorkflowViaOrchestrator({
    getAuthoritativeWorkflow: () => draftWorkflow,
    createBlankWorkflow: async () => persistedWorkflow,
    persistWorkflowViaApi: async (workflowToPersist) => ({
      ...workflowToPersist,
      persistedWorkflowId: persistedWorkflow.persistedWorkflowId,
      persistenceState: 'persisted',
      hasMaterializedCanvas: true,
    }),
    commitMaterializedWorkflow: (workflowToCommit) => {
      committedWorkflows.push(workflowToCommit);
    },
  });

  assert.equal(result.persistedWorkflowId, persistedWorkflow.persistedWorkflowId);
  assert.equal(committedWorkflows.length, 1);
  assert.equal(committedWorkflows[0]?.persistedWorkflowId, persistedWorkflow.persistedWorkflowId);
});
