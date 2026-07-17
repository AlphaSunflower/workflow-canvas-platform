import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import { fileManifestStore, fileResourceLeaseManager } from './file-resource';
import { imageOriginalSourceRegistry } from './image/image-original-source-registry';
import {
  clearBackendFileBindingCache,
  clearRuntimeNodeFileSources,
  getFileBlobFromNode,
  registerRuntimeNodeFileSource,
} from './backendFileService';
import {
  clearLocalArchiveFileRegistry,
  collectEmbeddedLocalArchiveAssets,
  getRegisteredLocalArchiveFileByNode,
  registerLocalArchiveFile,
  restoreEmbeddedLocalArchiveAssets,
} from './local-workflow-assets';
import { extractWorkflowFromLocalArchive } from './local-workflow-archive';

function createFileNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();

  return {
    id: {
      value: 'node-boundary',
      display: '#99999',
    },
    type: 'ply',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 180 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'file-boundary',
    fileName: 'mesh-output.ply',
    fileSize: 64,
    mimeType: 'application/octet-stream',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {},
    ...overrides,
  };
}

function resetState(): void {
  clearRuntimeNodeFileSources();
  clearBackendFileBindingCache();
  clearLocalArchiveFileRegistry();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
}

test('backend file upload path prefers runtime node file source over local archive registry', async () => {
  resetState();
  const node = createFileNode();
  const runtimeFile = new File([new Uint8Array([1, 2, 3])], 'runtime.ply', {
    type: 'application/octet-stream',
  });
  const archiveFile = new File([new Uint8Array([9, 9, 9])], 'archive.ply', {
    type: 'application/octet-stream',
  });

  registerRuntimeNodeFileSource(node.id.value, node.fileId, runtimeFile);
  registerLocalArchiveFile(node.id.value, node.fileId, archiveFile);

  const resolved = await getFileBlobFromNode(node);

  assert.equal(resolved, runtimeFile);
  resetState();
});

test('backend file upload path can restore from local archive registry through the unified resolver', async () => {
  resetState();
  const node = createFileNode();
  const archiveFile = new File([new Uint8Array([7, 7, 7])], 'archive-only.ply', {
    type: 'application/octet-stream',
  });

  registerLocalArchiveFile(node.id.value, node.fileId, archiveFile);

  const resolved = await getFileBlobFromNode(node);

  assert.equal(resolved, archiveFile);
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId), archiveFile);
  assert.equal(fileManifestStore.get({
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  })?.hasLocalFile, true);
  resetState();
});

test('local archive registry keeps same node file resources isolated by workflow scope', async () => {
  resetState();
  const node = createFileNode();
  const workflowAFile = new File([new Uint8Array([1])], 'workflow-a.ply', {
    type: 'application/octet-stream',
  });
  const workflowBFile = new File([new Uint8Array([2])], 'workflow-b.ply', {
    type: 'application/octet-stream',
  });

  registerLocalArchiveFile(node.id.value, node.fileId, workflowAFile, {
    workflowId: 'workflow-a',
  });
  registerLocalArchiveFile(node.id.value, node.fileId, workflowBFile, {
    workflowId: 'workflow-b',
  });

  assert.equal(getRegisteredLocalArchiveFileByNode(node, {
    workflowId: 'workflow-a',
  })?.name, 'workflow-a.ply');
  assert.equal(getRegisteredLocalArchiveFileByNode(node, {
    workflowId: 'workflow-b',
  })?.name, 'workflow-b.ply');

  clearLocalArchiveFileRegistry({
    workflowId: 'workflow-a',
  });

  assert.equal(getRegisteredLocalArchiveFileByNode(node, {
    workflowId: 'workflow-a',
  }), null);
  assert.equal(getRegisteredLocalArchiveFileByNode(node, {
    workflowId: 'workflow-b',
  })?.name, 'workflow-b.ply');
  resetState();
});

test('backend file upload path rejects preview-only image nodes without runtime file or original source', async () => {
  resetState();
  const now = Date.now();
  const node = createFileNode({
    type: 'image',
    fileName: 'thumbnail-only.png',
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
    imageAsset: {
      assetId: 'thumbnail-only-image',
      source: 'local',
      version: 1,
      variants: {
        thumbnail: {
          url: 'blob:thumb-only',
        },
      },
    },
    thumbnailUrl: 'blob:thumb-only',
  });

  await assert.rejects(
    () => getFileBlobFromNode(node),
    (error) => (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      error.message === 'Failed to locate an original file source to upload.'
    ),
  );
  resetState();
});

test('embedded local archive source metadata migrates filename-only originalPath to display name', async () => {
  resetState();
  const node = createFileNode({
    fileName: 'legacy-name.png',
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      originalPath: 'legacy-name.png',
      localSource: {
        status: 'available',
        referenceId: 'fs-handle-legacy',
        kind: 'file-system-access',
        permissionState: 'granted',
      },
      importedAt: 1710000000000,
    },
  });
  const file = new File([new Uint8Array([1, 2, 3])], 'legacy-name.png', {
    type: 'image/png',
  });

  registerLocalArchiveFile(node.id.value, node.fileId, file);

  const result = await collectEmbeddedLocalArchiveAssets({
    id: 'workflow-archive-source-migration',
    projectId: 'project-archive-source-migration',
    name: 'Archive Source Migration',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
  });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  const asset = result.data[0];
  const source = asset.metadata?.source as Record<string, unknown>;
  const localSource = source.localSource as Record<string, unknown>;
  assert.equal(source.sourceDisplayName, 'legacy-name.png');
  assert.equal('originalPath' in source, false);
  assert.equal(localSource.status, 'linked');
  assert.equal(localSource.referenceId, 'fs-handle-legacy');
  assert.equal(asset.metadata?.localSourceBoundary, 'runtime-only-archive');
  assert.equal(asset.metadata?.localSourceScope, 'archive-import-runtime');
  resetState();
});

test('embedded local archive restore marks imported source as runtime-only archive source', async () => {
  resetState();
  const node = createFileNode({
    fileName: 'archived.png',
    mimeType: 'image/png',
    type: 'image',
    metadata: {
      width: 256,
      height: 128,
    },
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: 'archived.png',
      localSource: {
        status: 'linked',
        referenceId: 'fs-handle-archive',
        kind: 'file-system-access',
      },
      importedAt: 1710000000000,
    },
  });

  const result = await restoreEmbeddedLocalArchiveAssets({
    format: 'newworkflow-local-archive',
    version: 1,
    savedAt: 1710000000000,
    workflow: {
      id: 'workflow-archive-restore',
      projectId: 'project-archive-restore',
      name: 'Archive Restore',
      nodes: {
        [node.id.value]: node,
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 1,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: {
        created: 1710000000000,
        updated: 1710000000000,
      },
    },
    embeddedAssets: [{
      id: `${node.id.value}:${node.fileId}`,
      nodeId: node.id.value,
      fileId: node.fileId,
      kind: 'image',
      fileName: 'archived.png',
      mimeType: 'image/png',
      size: 3,
      encoding: 'base64',
      data: btoa(String.fromCharCode(4, 5, 6)),
      width: 256,
      height: 128,
      metadata: {
        localSourceBoundary: 'runtime-only-archive',
      },
      createdAt: 1710000000000,
      updatedAt: 1710000000001,
    }],
  });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  const restoredNode = result.data.nodes[node.id.value] as FileNodeData;
  assert.equal(restoredNode.source.type, 'imported');
  assert.equal(restoredNode.source.sourceDisplayName, 'archived.png');
  assert.equal(restoredNode.source.localSource?.status, 'runtime-only');
  assert.equal(restoredNode.source.localSource?.kind, 'runtime');
  assert.equal(restoredNode.source.localSource?.referenceId, undefined);
  const restoredFile = getRegisteredLocalArchiveFileByNode(restoredNode, {
    workflowId: 'workflow-archive-restore',
  });
  assert.equal(restoredFile?.name, 'archived.png');
  assert.equal(imageOriginalSourceRegistry.getFile(restoredNode.id.value, restoredNode.fileId, {
    workflowId: 'workflow-archive-restore',
  }), restoredFile);
  const manifest = fileManifestStore.get({
    workflowId: 'workflow-archive-restore',
    nodeId: restoredNode.id.value,
    fileId: restoredNode.fileId,
    variant: 'original',
  });
  assert.equal(manifest?.hasLocalFile, true);
  assert.equal(manifest?.status, 'local-only');
  resetState();
});

test('extractWorkflowFromLocalArchive clears only imported workflow archive resources and preserves other workflow leased originals', async () => {
  resetState();
  const importedNode = createFileNode({
    id: {
      value: 'node-shared',
      display: '#00002',
    },
    fileId: 'file-shared',
    fileName: 'imported.ply',
  });
  const otherWorkflowFile = new File([new Uint8Array([8])], 'other-workflow.ply', {
    type: 'application/octet-stream',
  });
  const staleImportedFile = new File([new Uint8Array([9])], 'stale-imported.ply', {
    type: 'application/octet-stream',
  });
  registerLocalArchiveFile(importedNode.id.value, importedNode.fileId, otherWorkflowFile, {
    workflowId: 'workflow-other',
  });
  registerLocalArchiveFile(importedNode.id.value, importedNode.fileId, staleImportedFile, {
    workflowId: 'workflow-imported',
  });
  imageOriginalSourceRegistry.registerLocalFile(importedNode.id.value, importedNode.fileId, otherWorkflowFile, {
    workflowId: 'workflow-other',
  });
  fileResourceLeaseManager.acquireLease({
    workflowId: 'workflow-other',
    nodeId: importedNode.id.value,
    fileId: importedNode.fileId,
    variant: 'original',
  }, 'viewer', 'viewer-other-workflow');

  const result = await extractWorkflowFromLocalArchive({
    format: 'newworkflow-local-archive',
    version: 1,
    savedAt: 1710000000000,
    workflow: {
      id: 'workflow-imported',
      projectId: 'project-imported',
      name: 'Imported Workflow',
      nodes: {
        [importedNode.id.value]: importedNode,
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 1,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: {
        created: 1710000000000,
        updated: 1710000000000,
      },
    },
    embeddedAssets: [{
      id: `${importedNode.id.value}:${importedNode.fileId}`,
      nodeId: importedNode.id.value,
      fileId: importedNode.fileId,
      kind: 'ply',
      fileName: 'imported.ply',
      mimeType: 'application/octet-stream',
      size: 1,
      encoding: 'base64',
      data: btoa(String.fromCharCode(1)),
      metadata: {
        localSourceBoundary: 'runtime-only-archive',
      },
      createdAt: 1710000000000,
      updatedAt: 1710000000001,
    }],
  });

  assert.equal(result.success, true);
  assert.equal(getRegisteredLocalArchiveFileByNode(importedNode, {
    workflowId: 'workflow-imported',
  })?.name, 'imported.ply');
  assert.equal(getRegisteredLocalArchiveFileByNode(importedNode, {
    workflowId: 'workflow-other',
  })?.name, 'other-workflow.ply');
  assert.equal(imageOriginalSourceRegistry.getFile(importedNode.id.value, importedNode.fileId, {
    workflowId: 'workflow-other',
  }), otherWorkflowFile);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    workflowId: 'workflow-other',
    nodeId: importedNode.id.value,
    fileId: importedNode.fileId,
    variant: 'original',
  }), 1);
  resetState();
});
