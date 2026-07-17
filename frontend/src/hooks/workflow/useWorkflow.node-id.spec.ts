import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData, Workflow } from '@/types';
import { createSequentialNodeId, createDefaultAINodeData } from '@/utils/node/create';
import { createNodeIdAllocatorFromWorkflowMetadata } from '@/utils/node/node-id-allocator';
import {
  buildWorkflowWithRuntime,
  createEmptyWorkflow,
  normalizeWorkflowForUseWorkflow,
  type WorkflowRuntimeSnapshot,
} from './useWorkflow';

function createAiNode(sequence: number) {
  return createDefaultAINodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 10, y: sequence * 10 },
    'aiImageGen',
  );
}

function createRuntimeSnapshot(nodeIds: number[]): WorkflowRuntimeSnapshot {
  const nodes = Object.fromEntries(nodeIds.map((nodeId) => {
    const node = createAiNode(nodeId);
    return [node.id.value, node] as const;
  }));

  return {
    nodes,
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function createImageRuntimeNode(): FileNodeData {
  return {
    id: createSequentialNodeId(1),
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 150 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: 1, updated: 1 },
    fileId: 'file-1',
    fileName: 'image.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 1,
    },
    imageAsset: {
      assetId: 'file-1',
      source: 'local',
      version: 1,
      intrinsicSize: {
        width: 800,
        height: 600,
      },
      variants: {
        thumbnail: { url: 'blob:runtime-thumb' },
        original: { url: 'blob:runtime-original' },
      },
    },
    thumbnailUrl: 'blob:runtime-thumb',
    previewUrl: 'runtime:image-preview-should-strip',
    metadata: {
      width: 800,
      height: 600,
    },
  };
}

test('buildWorkflowWithRuntime keeps lastNodeId after all nodes are deleted', () => {
  const workflow = createEmptyWorkflow('project-1', 'Workflow A');
  const withNode = buildWorkflowWithRuntime(workflow, createRuntimeSnapshot([1]), 10);
  const afterDeleteAll = buildWorkflowWithRuntime(withNode, createRuntimeSnapshot([]), 20);

  assert.equal(withNode.metadata.lastNodeId, 1);
  assert.equal(afterDeleteAll.metadata.lastNodeId, 1);
});

test('deleting a node and creating again continues from historical max instead of reusing old id', () => {
  const workflow = createEmptyWorkflow('project-1', 'Workflow B');
  const withNodes = buildWorkflowWithRuntime(workflow, createRuntimeSnapshot([1, 2]), 10);
  const afterDelete = buildWorkflowWithRuntime(withNodes, createRuntimeSnapshot([2]), 20);
  const allocator = createNodeIdAllocatorFromWorkflowMetadata(afterDelete.metadata, afterDelete.nodes);
  const next = allocator.next();

  assert.equal(afterDelete.metadata.lastNodeId, 2);
  assert.equal(next.nodeId?.value, '3');
});

test('normalizeWorkflowForUseWorkflow keeps historical lastNodeId for old imported workflow data', () => {
  const importedWorkflow: Workflow = {
    ...createEmptyWorkflow('project-1', 'Imported Workflow'),
    nodes: {
      '2': createAiNode(2),
    },
    metadata: {
      ...createEmptyWorkflow('project-1', 'Imported Workflow').metadata,
      lastNodeId: 1,
      usedNodeIds: ['1', '7'],
      releasedNodeIds: ['1'],
    },
  };

  const normalized = normalizeWorkflowForUseWorkflow(importedWorkflow);
  const allocator = createNodeIdAllocatorFromWorkflowMetadata(normalized.metadata, normalized.nodes);
  const next = allocator.next();

  assert.equal(normalized.metadata.lastNodeId, 7);
  assert.equal(next.nodeId?.value, '8');
});

test('buildWorkflowWithRuntime strips image runtime urls and preview fields before persistence state', () => {
  const workflow = createEmptyWorkflow('project-1', 'Workflow E');
  const nextWorkflow = buildWorkflowWithRuntime(workflow, {
    nodes: {
      '1': createImageRuntimeNode(),
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  const persistedNode = nextWorkflow.nodes['1'] as FileNodeData;
  assert.equal(persistedNode.previewUrl, undefined);
  assert.equal(persistedNode.thumbnailUrl, undefined);
  assert.equal(persistedNode.imageAsset?.variants.thumbnail?.url, undefined);
  assert.equal(persistedNode.imageAsset?.variants.original?.url, undefined);
});

test('normalizeWorkflowForUseWorkflow strips image runtime and blob urls from imported workflow nodes', () => {
  const workflow = createEmptyWorkflow('project-1', 'Workflow F');
  const normalized = normalizeWorkflowForUseWorkflow({
    ...workflow,
    nodes: {
      '1': {
        ...createImageRuntimeNode(),
        thumbnailUrl: 'runtime:image-thumbnail',
        imageAsset: {
          ...createImageRuntimeNode().imageAsset!,
          variants: {
            thumbnail: { url: 'runtime:image-thumbnail' },
            original: { url: 'blob:original' },
          },
        },
      },
    },
  });

  const normalizedNode = normalized.nodes['1'] as FileNodeData;
  assert.equal(normalizedNode.previewUrl, undefined);
  assert.equal(normalizedNode.thumbnailUrl, undefined);
  assert.equal(normalizedNode.imageAsset?.variants.thumbnail?.url, undefined);
  assert.equal(normalizedNode.imageAsset?.variants.original?.url, undefined);
});

test('normalizeWorkflowForUseWorkflow keeps linked local source metadata without remote fallback urls', () => {
  const workflow = createEmptyWorkflow('project-1', 'Workflow Linked Local');
  const normalized = normalizeWorkflowForUseWorkflow({
    ...workflow,
    nodes: {
      '1': {
        ...createImageRuntimeNode(),
        source: {
          type: 'imported',
          importMethod: 'local',
          sourceDisplayName: 'linked.png',
          localSource: {
            status: 'linked',
            referenceId: 'fs-handle-1',
          },
          importedAt: 1,
        },
        thumbnailUrl: '/api/v1/files/file-1/thumbnail',
        imageAsset: {
          ...createImageRuntimeNode().imageAsset!,
          source: 'remote',
          variants: {
            thumbnail: { url: '/api/v1/files/file-1/thumbnail' },
            original: { url: '/api/v1/files/file-1/download' },
          },
        },
      },
    },
  });

  const normalizedNode = normalized.nodes['1'] as FileNodeData;
  assert.equal(normalizedNode.source.localSource?.status, 'linked');
  assert.equal(normalizedNode.source.localSource?.referenceId, 'fs-handle-1');
  assert.equal(normalizedNode.thumbnailUrl, undefined);
  assert.equal(normalizedNode.imageAsset?.variants.thumbnail, undefined);
  assert.equal(normalizedNode.imageAsset?.variants.original, undefined);
});

test('SVR-2 baseline exposes commitPersistedWorkflow as state-level persisted result commit and removes hook-local save implementation', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const useWorkflowSource = readFileSync(
    `${cwd}/src/hooks/workflow/useWorkflow.ts`,
    'utf8',
  );

  assert.equal(
    useWorkflowSource.includes('commitPersistedWorkflow: (workflow: Workflow) => Workflow | null;'),
    true,
  );
  assert.equal(
    useWorkflowSource.includes('const commitPersistedWorkflow = useCallback((nextWorkflow: Workflow): Workflow | null => {'),
    true,
  );
  assert.equal(
    useWorkflowSource.includes('createWorkflowPersistence'),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('const save = useCallback('),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('const saveRuntimeSnapshot = useCallback('),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('const commitRuntimeSnapshot = useCallback('),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('const exportWorkflow = useCallback('),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('const importWorkflow = useCallback('),
    false,
  );
});
