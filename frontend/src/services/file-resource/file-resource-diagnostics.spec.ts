import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import { FileResourceService } from './file-resource-service';
import { fileResourceDiagnostics } from './file-resource-diagnostics';
import { fileResourceLeaseManager } from './resource-lease-manager';

function createNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: 'node-diagnostics',
      display: '#00991',
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
    fileId: 'file-diagnostics',
    fileName: 'diagnostics.png',
    fileSize: 5,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    imageAsset: {
      assetId: 'file-diagnostics',
      source: 'remote',
      version: 1,
      variants: {
        original: {
          url: '/api/v1/files/file-diagnostics/download',
        },
      },
    },
    metadata: {},
    ...overrides,
  };
}

test('FileResourceDiagnostics records attempts fallback source failures and safe metadata', async () => {
  fileResourceDiagnostics.clear();
  fileResourceLeaseManager.clear();
  const service = new FileResourceService({
    fetchBlob: async () => {
      throw new TypeError('Failed to fetch');
    },
  });

  await assert.rejects(
    () => service.resolveFileResource(createNode(), {
      purpose: 'viewer-original',
      require: 'displayUrl',
      workflowId: 'workflow-diagnostics',
      authScope: 'account-a',
      owner: 'diagnostics-test',
    }),
    /Failed to fetch/,
  );

  const events = fileResourceDiagnostics.getEvents();
  assert.equal(events[0]?.event, 'attempt');
  assert.equal(events[0]?.purpose, 'viewer-original');
  assert.equal(events[0]?.workflowId, 'workflow-diagnostics');
  assert.equal(events[0]?.authScope, 'account-a');
  assert.equal(events[0]?.nodeId, 'node-diagnostics');
  assert.equal(events[0]?.fileId, 'file-diagnostics');
  assert.equal(typeof events[0]?.leaseId, 'string');
  assert.equal(events.some((event) => event.event === 'source-attempt' && event.source === 'registry-file'), true);
  assert.equal(events.some((event) => event.event === 'source-failed' && event.source === 'registry-file'), true);
  assert.equal(events.some((event) => event.event === 'source-attempt' && event.source === 'remote-download'), true);
  const remoteFailure = events.find((event) => event.event === 'source-failed' && event.source === 'remote-download');
  assert.equal(remoteFailure?.message, 'Failed to fetch');
  assert.deepEqual(remoteFailure?.fallbackChain, [
    'execution-runtime-file',
    'registry-file',
    'local-handle',
    'remote-download',
  ]);
  assert.equal(events[events.length - 1]?.event, 'failed');
  assert.equal(JSON.stringify(events).includes('Bearer '), false);

  fileResourceDiagnostics.clear();
  fileResourceLeaseManager.clear();
});

test('FileResourceDiagnostics redacts sensitive values and truncates oversized diagnostic text', () => {
  fileResourceDiagnostics.clear();

  const metadata = {
    purpose: 'viewer-original' as const,
    require: 'displayUrl' as const,
    workflowId: 'workflow-diagnostics',
    nodeId: 'node-diagnostics',
    fileId: 'file-diagnostics',
    backendFileId: 'backend-diagnostics',
    authScope: 'account-a',
    selectedSource: 'remote-download' as const,
    fallbackChain: ['remote-download' as const],
    leaseId: 'lease-diagnostics',
  };

  fileResourceDiagnostics.recordSourceFailed(
    metadata,
    'remote-download',
    `Bearer secret-token ${'x'.repeat(900)}`,
    {
      url: '/api/v1/files/file/download?token=secret-token',
      responseBody: JSON.stringify({
        accessToken: 'secret-token',
        message: 'x'.repeat(2000),
      }),
    },
  );

  const [event] = fileResourceDiagnostics.getEvents();
  assert.equal(event.event, 'source-failed');
  assert.equal(event.message?.includes('secret-token'), false);
  assert.equal(event.message?.includes('Bearer [REDACTED]'), true);
  assert.equal(event.message?.endsWith('...'), true);
  assert.equal(String(event.detail?.url).includes('secret-token'), false);
  assert.equal(String(event.detail?.url).includes('[REDACTED]]'), false);
  assert.equal(String(event.detail?.responseBody).includes('secret-token'), false);
  assert.equal(String(event.detail?.responseBody).length <= 1027, true);

  fileResourceDiagnostics.clear();
});
