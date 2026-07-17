import test from 'node:test';
import assert from 'node:assert/strict';

import {
  backendFileService,
  cacheBackendFileBinding,
  clearBackendFileBindingCache,
  getCachedBackendFileBinding,
  registerInpaintMaskFile,
} from './backendFileService';

function createRegisterResponse(fileId: string, uploadRequired = true): Response {
  return new Response(JSON.stringify({
    code: 200,
    message: 'ok',
    data: {
      uploadRequired,
      uploadId: uploadRequired ? `upload-${fileId}` : undefined,
      fileId,
      file: {
        fileId,
        userId: 'user-a',
        blobId: null,
        originalName: 'inpaint-mask-node-1.png',
        displayName: 'inpaint-mask-node-1.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'input',
        sha256: 'sha-mask',
        size: 10,
        extension: 'png',
        width: null,
        height: null,
        duration: null,
        status: uploadRequired ? 'pending_upload' : 'ready',
        createdAt: new Date(0).toISOString(),
      },
    },
    timestamp: Date.now(),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createUploadResponse(fileId: string): Response {
  return new Response(JSON.stringify({
    code: 200,
    message: 'ok',
    data: {
      uploadId: `upload-${fileId}`,
      fileId,
      file: {
        fileId,
        userId: 'user-a',
        blobId: 'blob-1',
        originalName: 'inpaint-mask-node-1.png',
        displayName: 'inpaint-mask-node-1.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'input',
        sha256: 'sha-mask',
        size: 10,
        extension: 'png',
        width: null,
        height: null,
        duration: null,
        status: 'ready',
        createdAt: new Date(0).toISOString(),
      },
    },
    timestamp: Date.now(),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('backend file binding cache is isolated by workflow and auth scope', () => {
  clearBackendFileBindingCache();
  const node = {
    id: {
      value: 'node-binding-scope',
      display: '#BIND',
    },
    fileId: 'local-binding-scope',
  };

  cacheBackendFileBinding(node, {
    backendFileId: 'backend-workflow-a',
    sha256: 'sha-workflow-a',
    size: 1,
    updatedAt: 1,
  }, {
    workflowId: 'workflow-a',
    authScope: 'user-a',
  });
  cacheBackendFileBinding(node, {
    backendFileId: 'backend-workflow-b',
    sha256: 'sha-workflow-b',
    size: 2,
    updatedAt: 2,
  }, {
    workflowId: 'workflow-b',
    authScope: 'user-a',
  });

  assert.equal(getCachedBackendFileBinding(node, {
    workflowId: 'workflow-a',
    authScope: 'user-a',
  })?.backendFileId, 'backend-workflow-a');
  assert.equal(getCachedBackendFileBinding(node, {
    workflowId: 'workflow-b',
    authScope: 'user-a',
  })?.backendFileId, 'backend-workflow-b');
  assert.equal(getCachedBackendFileBinding(node, {
    workflowId: 'workflow-a',
    authScope: 'user-b',
  }), null);
  assert.equal(getCachedBackendFileBinding(node), null);
  clearBackendFileBindingCache();
});

test('registerInpaintMaskFile registers and uploads a canvas exported PNG without creating a canvas node', async () => {
  clearBackendFileBindingCache();
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    url: string;
    body: unknown;
    contentType: string;
    uploadId: string;
  }> = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      requests.push({
        url,
        body: init?.body,
        contentType: headers?.['Content-Type'] ?? '',
        uploadId: headers?.['X-Upload-Id'] ?? '',
      });

      if (url === '/api/v1/files/register') {
        return createRegisterResponse('mask-file-1');
      }

      if (url === '/api/v1/files/upload') {
        return createUploadResponse('mask-file-1');
      }

      return new Response('not found', { status: 404 });
    },
  });

  try {
    const maskBlob = new Blob(['mask-png'], { type: 'image/png' });
    const maskFileId = await registerInpaintMaskFile('node-1', maskBlob);

    assert.equal(maskFileId, 'mask-file-1');
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, '/api/v1/files/register');
    assert.equal(requests[1]?.url, '/api/v1/files/upload');
    assert.equal(requests[1]?.uploadId, 'upload-mask-file-1');
    assert.ok(requests[1]?.body instanceof File);

    const registerBody = JSON.parse(String(requests[0]?.body)) as Record<string, unknown>;
    assert.equal(registerBody.originalName, 'inpaint-mask-node-1.png');
    assert.equal(registerBody.displayName, 'inpaint-mask-node-1.png');
    assert.equal(registerBody.mimeType, 'image/png');
    assert.equal(registerBody.fileType, 'image');
    assert.equal(registerBody.sourceType, 'input');
    assert.equal((requests[1]?.body as File).name, 'inpaint-mask-node-1.png');
    assert.equal((requests[1]?.body as File).type, 'image/png');
    assert.equal(requests[1]?.contentType, 'image/png');
    assert.equal(backendFileService.getRuntimeNodeFileSource('node-1', 'mask-file-1'), null);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    clearBackendFileBindingCache();
  }
});

test('registerInpaintMaskFile reuses sha256 cache without re-uploading the same mask content', async () => {
  clearBackendFileBindingCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);

      if (url === '/api/v1/files/register') {
        return createRegisterResponse('mask-file-cache', false);
      }

      return new Response('unexpected upload', { status: 500 });
    },
  });

  try {
    const firstFileId = await registerInpaintMaskFile(
      'node-cache',
      new File(['same-mask'], 'raw-mask.png', { type: 'image/png' }),
    );
    const secondFileId = await registerInpaintMaskFile(
      'node-cache',
      new File(['same-mask'], 'raw-mask-again.png', { type: 'image/png' }),
    );

    assert.equal(firstFileId, 'mask-file-cache');
    assert.equal(secondFileId, 'mask-file-cache');
    assert.deepEqual(urls, ['/api/v1/files/register']);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    clearBackendFileBindingCache();
  }
});

test('registerInpaintMaskFile respects an already aborted execution signal', async () => {
  clearBackendFileBindingCache();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => registerInpaintMaskFile(
      'node-abort',
      new Blob(['mask'], { type: 'image/png' }),
      { signal: controller.signal },
    ),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});
