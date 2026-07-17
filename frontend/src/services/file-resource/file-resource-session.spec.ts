import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileInfo, FileNodeData } from '@/types';
import {
  cacheBackendFileBinding,
  clearBackendFileBindingCache,
  getCachedBackendFileBinding,
} from '@/services/backendFileService';
import {
  clearExecutionOutputRuntimeResources,
  ensureExecutionOutputRuntimeResource,
  getExecutionOutputRuntimeStatus,
  registerExecutionOutputNodeRuntimeSource,
} from '@/services/execution-output-runtime-sync';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import { clearAllImageResources } from '@/services/image/image-node';
import {
  clearProtectedResourceCache,
  protectedResourceService,
} from '@/services/protected-resource';
import { clearFileResourceSessionState } from './file-resource-session';
import { fileManifestStore } from './file-manifest-store';
import { fileResourceLeaseManager } from './resource-lease-manager';

function createNode(): Pick<FileNodeData, 'id' | 'fileId' | 'fileSize'> {
  return {
    id: {
      value: 'node-session-resource',
      display: '#80001',
    },
    fileId: 'file-session-resource',
    fileSize: 13,
  };
}

function createFileInfo(fileId: string): FileInfo {
  return {
    id: fileId,
    name: `${fileId}.png`,
    originalName: `${fileId}.png`,
    size: 4,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: `hash-${fileId}`,
    path: `/api/v1/files/${fileId}/download`,
    thumbnailPath: `/api/v1/files/${fileId}/thumbnail`,
    metadata: {
      width: 64,
      height: 64,
    },
    source: {
      type: 'node-output',
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function resetSessionResourceState(): void {
  clearExecutionOutputRuntimeResources({ force: true });
  clearProtectedResourceCache();
  clearBackendFileBindingCache();
  clearAllImageResources({
    forceOriginals: true,
  });
  fileResourceLeaseManager.clear();
  fileManifestStore.clear();
}

test('clearFileResourceSessionState clears account-scoped file resource caches manifests and leases', async () => {
  resetSessionResourceState();
  const node = createNode();
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revokedUrls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/files/runtime-session/download' || url === '/api/v1/files/protected-session/download') {
        return new Response(new Blob(['data'], { type: 'image/png' }), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return new Response('missing', { status: 404 });
    },
  });
  URL.createObjectURL = (): string => 'blob:session-resource';
  URL.revokeObjectURL = (url: string): void => {
    revokedUrls.push(url);
  };

  try {
    cacheBackendFileBinding(node, {
      backendFileId: 'backend-session-resource',
      sha256: 'sha-session-resource',
      size: node.fileSize,
      updatedAt: Date.now(),
    }, {
      workflowId: 'workflow-session',
      authScope: 'account-old',
    });
    imageOriginalSourceRegistry.registerLocalFile(
      node.id.value,
      node.fileId,
      new File(['original'], 'original.png', { type: 'image/png' }),
      {
        workflowId: 'workflow-session',
        authScope: 'account-old',
      },
    );
    const lease = fileResourceLeaseManager.acquireLease({
      workflowId: 'workflow-session',
      nodeId: node.id.value,
      fileId: node.fileId,
      authScope: 'account-old',
      variant: 'original',
    }, 'viewer', 'viewer-session');
    registerExecutionOutputNodeRuntimeSource('node-runtime-session', 'runtime-session', {
      workflowId: 'workflow-session',
    });
    await ensureExecutionOutputRuntimeResource(createFileInfo('runtime-session'));
    const protectedHandle = await protectedResourceService.acquireObjectUrl('/api/v1/files/protected-session/download');
    assert.ok(protectedResourceService.getDebugSnapshot().length > 0);
    assert.equal(getExecutionOutputRuntimeStatus('runtime-session'), 'ready');
    assert.equal(Boolean(getCachedBackendFileBinding(node, {
      workflowId: 'workflow-session',
      authScope: 'account-old',
    })), true);
    assert.equal(Boolean(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
      workflowId: 'workflow-session',
      authScope: 'account-old',
    })), true);
    assert.equal(fileResourceLeaseManager.getLeaseCount({
      workflowId: 'workflow-session',
      nodeId: node.id.value,
      fileId: node.fileId,
      authScope: 'account-old',
      variant: 'original',
    }), 1);
    assert.equal(fileManifestStore.get({
      workflowId: 'workflow-session',
      nodeId: node.id.value,
      fileId: node.fileId,
      authScope: 'account-old',
      variant: 'original',
    }) !== null, true);

    clearFileResourceSessionState();

    assert.equal(getCachedBackendFileBinding(node, {
      workflowId: 'workflow-session',
      authScope: 'account-old',
    }), null);
    assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
      workflowId: 'workflow-session',
      authScope: 'account-old',
    }), null);
    assert.equal(getExecutionOutputRuntimeStatus('runtime-session'), 'idle');
    assert.equal(protectedResourceService.getDebugSnapshot().length, 0);
    assert.equal(fileManifestStore.get({
      workflowId: 'workflow-session',
      nodeId: node.id.value,
      fileId: node.fileId,
      authScope: 'account-old',
      variant: 'original',
    }), null);
    assert.equal(fileResourceLeaseManager.getLeaseCount({
      workflowId: 'workflow-session',
      nodeId: node.id.value,
      fileId: node.fileId,
      authScope: 'account-old',
      variant: 'original',
    }), 0);
    assert.equal(fileResourceLeaseManager.releaseLease(lease.leaseId), false);
    assert.ok(revokedUrls.includes('blob:session-resource'));

    protectedHandle.release();
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    resetSessionResourceState();
  }
});
