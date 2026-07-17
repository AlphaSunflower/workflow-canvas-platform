import test from 'node:test';
import assert from 'node:assert/strict';

import type { Workflow } from '@/types';
import { createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  createAuthoritativeWorkflowExportProjection,
  createAuthoritativeWorkflowSupplier,
  getAuthoritativeWorkflowFromRef,
} from './workflow-authoritative-workflow';

function createWorkflowWithGraph(): Workflow {
  const sourceNode = createDefaultAINodeData(
    createSequentialNodeId(12),
    { x: 120, y: 160 },
    'aiVideoGen',
  );

  const workflow = createEmptyWorkflow(
    'project-authoritative-workflow-supplier',
    'Authoritative Workflow Supplier',
  );
  return {
    ...workflow,
    nodes: {
      [sourceNode.id.value]: sourceNode,
    },
    connections: [{
      id: 'output-link-1',
      type: 'output-link',
      sourceId: sourceNode.id.value,
      targetId: 'node-output-1',
      sourceHandle: 'group-1:result',
      order: 0,
    }],
    viewport: {
      x: 36,
      y: 72,
      zoom: 1.25,
    },
    metadata: {
      ...workflow.metadata,
      nodeCount: 1,
      connectionCount: 1,
      lastNodeId: 12,
      usedNodeIds: ['12'],
    },
  };
}

test('getAuthoritativeWorkflowFromRef returns null when no workflow is loaded', () => {
  assert.equal(getAuthoritativeWorkflowFromRef({ current: null }), null);
});

test('createAuthoritativeWorkflowSupplier always reads the latest workflowRef.current', () => {
  const initialWorkflow = createWorkflowWithGraph();
  const updatedWorkflow: Workflow = {
    ...initialWorkflow,
    viewport: {
      x: 240,
      y: 96,
      zoom: 0.8,
    },
    metadata: {
      ...initialWorkflow.metadata,
      lastNodeId: 24,
      usedNodeIds: ['12', '24'],
    },
  };
  const workflowRef: { current: Workflow | null } = {
    current: initialWorkflow,
  };
  const supplier = createAuthoritativeWorkflowSupplier(workflowRef);

  const firstWorkflow = supplier();
  assert.equal(firstWorkflow, initialWorkflow);
  assert.equal(firstWorkflow?.viewport.x, 36);
  assert.equal(firstWorkflow?.metadata.lastNodeId, 12);

  workflowRef.current = updatedWorkflow;
  const secondWorkflow = supplier();

  assert.equal(secondWorkflow, updatedWorkflow);
  assert.equal(secondWorkflow?.viewport.x, 240);
  assert.equal(secondWorkflow?.metadata.lastNodeId, 24);
  assert.deepEqual(secondWorkflow?.metadata.usedNodeIds, ['12', '24']);
});

test('createAuthoritativeWorkflowSupplier preserves authoritative workflow graph and metadata by reference', () => {
  const workflow = createWorkflowWithGraph();
  const workflowRef: { current: Workflow | null } = {
    current: workflow,
  };
  const supplier = createAuthoritativeWorkflowSupplier(workflowRef);
  const authoritativeWorkflow = supplier();

  if (!authoritativeWorkflow) {
    throw new Error('expected authoritative workflow');
  }

  assert.equal(authoritativeWorkflow.nodes, workflow.nodes);
  assert.equal(authoritativeWorkflow.connections, workflow.connections);
  assert.equal(authoritativeWorkflow.viewport, workflow.viewport);
  assert.equal(authoritativeWorkflow.metadata, workflow.metadata);
});

test('createAuthoritativeWorkflowExportProjection preserves the authoritative graph while normalizing metadata and export timestamp', () => {
  const baseWorkflow = createWorkflowWithGraph();
  const workflow: Workflow = {
    ...baseWorkflow,
    metadata: {
      ...baseWorkflow.metadata,
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 0,
      usedNodeIds: [],
    },
  };
  const exportedAt = workflow.timestamp.updated + 500;
  const exportProjection = createAuthoritativeWorkflowExportProjection(workflow, exportedAt);

  assert.equal(exportProjection.nodes, workflow.nodes);
  assert.equal(exportProjection.connections, workflow.connections);
  assert.equal(exportProjection.viewport, workflow.viewport);
  assert.equal(exportProjection.metadata.nodeCount, 0);
  assert.equal(exportProjection.metadata.connectionCount, 0);
  assert.equal(exportProjection.metadata.lastNodeId, 12);
  assert.deepEqual(exportProjection.metadata.usedNodeIds, ['12']);
  assert.equal(exportProjection.timestamp.updated, exportedAt);
});
