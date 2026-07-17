import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import React, { act } from 'react';

import {
  resolveImageResourcePlaceholder,
  shouldAutoRequestCanvasImageResource,
} from './useImageResource';
import { useViewerImageResource } from './useViewerImageResource';
import { useImageResource, type UseImageResourceResult } from './useImageResource';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import { resolveFileNodeImageAsset } from '@/services/image/image-asset';
import type { FileNodeData } from '@/types';
import { imageManager } from '@/services/image/image-manager';
import {
  clearExecutionOutputRuntimeResources,
  ensureExecutionOutputRuntimeResource,
} from '@/services/execution-output-runtime-sync';
import {
  fileManifestStore,
  fileResourceLeaseManager,
} from '@/services/file-resource';

function createNodeData(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: 'node-image-resource',
      display: '#00001',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 120 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'file-image-resource',
    fileName: 'image.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 2048,
      height: 1280,
    },
    imageAsset: {
      assetId: 'file-image-resource',
      source: 'local',
      version: 1,
      intrinsicSize: {
        width: 2048,
        height: 1280,
      },
      variants: {
        thumbnail: {
          url: 'blob:thumb',
          width: 512,
          height: 320,
        },
        original: {
          url: 'blob:original-image-resource',
          width: 2048,
          height: 1280,
        },
      },
    },
    ...overrides,
  };
}

function installDom(): {
  container: {
    nodeType: number;
    ownerDocument: unknown;
    nodeName: string;
    tagName: string;
    namespaceURI: string;
    childNodes: unknown[];
    addEventListener: (type: string, handler: EventListener) => void;
    removeEventListener: (type: string, handler: EventListener) => void;
    appendChild: () => void;
    insertBefore: () => void;
    removeChild: () => void;
  };
  cleanup: () => void;
} {
  const documentListeners = new Map<string, Set<EventListener>>();
  const body = {
    nodeType: 1,
    nodeName: 'BODY',
    tagName: 'BODY',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: null as unknown,
    style: { overflow: '' },
    childNodes: [] as unknown[],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    appendChild: () => undefined,
    insertBefore: () => undefined,
    removeChild: () => undefined,
  };
  const documentStub = {
    nodeType: 9,
    body,
    documentElement: {
      nodeType: 1,
      nodeName: 'HTML',
      tagName: 'HTML',
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: null as unknown,
    },
    createElement: () => ({ nodeType: 1 }),
    createTextNode: (text: string) => ({
      nodeType: 3,
      nodeName: '#text',
      textContent: text,
      nodeValue: text,
      ownerDocument: documentStub,
    }),
    getElementById: () => null,
    addEventListener: (type: string, handler: EventListener) => {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, new Set());
      }
      documentListeners.get(type)?.add(handler);
    },
    removeEventListener: (type: string, handler: EventListener) => {
      documentListeners.get(type)?.delete(handler);
    },
    visibilityState: 'visible',
  };
  const windowStub = {
    document: documentStub,
    HTMLElement: function HTMLElement() {
      return undefined;
    },
    HTMLIFrameElement: function HTMLIFrameElement() {
      return undefined;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => undefined,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance: globalThis.performance,
  };
  body.ownerDocument = documentStub;
  documentStub.documentElement.ownerDocument = documentStub;
  const container = {
    nodeType: 1,
    ownerDocument: documentStub,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: [] as unknown[],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    appendChild: () => undefined,
    insertBefore: () => undefined,
    removeChild: () => undefined,
  };

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;
  const previousActEnvironment = (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowStub,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentStub,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'node',
    },
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return {
    container,
    cleanup: () => {
      if (typeof previousWindow === 'undefined') {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }
      if (typeof previousDocument === 'undefined') {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
      if (typeof previousNavigator === 'undefined') {
        Reflect.deleteProperty(globalThis, 'navigator');
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: previousNavigator,
        });
      }
      if (typeof previousActEnvironment === 'undefined') {
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      } else {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          value: previousActEnvironment,
        });
      }
    },
  };
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(
  predicate: () => boolean,
  maxAttempts = 10,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await flushEffects();
    });
  }
}

test('shouldAutoRequestCanvasImageResource leaves canvas requests to CanvasImageResourceController', () => {
  assert.equal(shouldAutoRequestCanvasImageResource({
    status: 'idle',
    isVisible: true,
    isNearViewport: true,
    src: 'blob:thumb',
  }, 'canvas'), false);

  assert.equal(shouldAutoRequestCanvasImageResource({
    status: 'idle',
    isVisible: false,
    isNearViewport: false,
    src: 'blob:thumb',
  }, 'canvas'), false);

  assert.equal(shouldAutoRequestCanvasImageResource({
    status: 'idle',
    isVisible: true,
    isNearViewport: true,
    src: 'blob:original',
  }, 'original'), false);
});

test('resolveImageResourcePlaceholder exposes stable loading and unavailable semantics', () => {
  assert.equal(resolveImageResourcePlaceholder({
    status: 'loading',
    isVisible: true,
    isNearViewport: true,
  }), 'loading');

  assert.equal(resolveImageResourcePlaceholder({
    status: 'error',
    isVisible: true,
    isNearViewport: true,
  }), 'unavailable');

  assert.equal(resolveImageResourcePlaceholder({
    status: 'idle',
    isVisible: false,
    isNearViewport: false,
  }), 'hidden');
});

test('useImageResource and useViewerImageResource are callable hook exports with split responsibilities', () => {
  assert.equal(typeof useImageResource, 'function');
  assert.equal(typeof useViewerImageResource, 'function');
});

test('canvas runtime thumbnail stays isolated from persisted asset resolution inputs', () => {
  imageThumbnailRuntimeStore.clearAll();
  const node = createNodeData({
    thumbnailUrl: '/api/v1/files/file-image-resource/thumbnail',
  });
  imageThumbnailRuntimeStore.upsert(node.id.value, {
    objectUrl: 'blob:runtime-thumb',
    status: 'ready',
  });
  const resolvedAsset = resolveFileNodeImageAsset(node);

  assert.equal(imageThumbnailRuntimeStore.getUrl(node.id.value), 'blob:runtime-thumb');
  assert.equal(resolvedAsset.thumbnail?.url, 'blob:thumb');
  assert.equal(resolvedAsset.original?.url, 'blob:original-image-resource');
  imageThumbnailRuntimeStore.clearAll();
});

test('viewer original source can be supplied by original source registry without touching thumbnail runtime store', () => {
  imageOriginalSourceRegistry.clear();
  imageThumbnailRuntimeStore.clearAll();
  const node = createNodeData();
  const file = new File(['original'], 'original.png', { type: 'image/png' });
  imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, file);

  const objectUrl = imageOriginalSourceRegistry.getOrCreateObjectUrl(node.id.value, node.fileId);

  assert.equal(typeof objectUrl, 'string');
  assert.equal(imageThumbnailRuntimeStore.get(node.id.value), null);
  imageOriginalSourceRegistry.clear();
});

test('useImageResource original mode consumes resolver-provided source instead of direct registry fallback', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageOriginalSourceRegistry.clear();

  try {
    const node = createNodeData({
      id: { value: 'node-original-registry', display: '#00991' },
      fileId: 'file-original-registry',
      imageAsset: {
        assetId: 'file-original-registry',
        source: 'remote',
        version: 1,
        variants: {
          original: {
            url: '/api/v1/files/file-original-registry/download',
          },
        },
      },
    });
    const snapshots: Array<{ requestUrl?: string; src?: string; status: string }> = [];

    const TestHarness = (): null => {
      const resource = useImageResource(node, 'original', {
        enabled: true,
        sourceUrl: 'blob:resolver-original-1',
        useExternalSource: true,
      });

      snapshots.push({
        requestUrl: resource.requestUrl,
        src: resource.src,
        status: resource.status,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });

    assert.equal(snapshots[snapshots.length - 1]?.requestUrl, 'blob:resolver-original-1');

    await act(async () => {
      imageOriginalSourceRegistry.registerLocalFile(
        node.id.value,
        node.fileId,
        new File(['runtime-original'], 'runtime-original.png', { type: 'image/png' }),
      );
      await flushEffects();
      await flushEffects();
    });

    assert.equal(snapshots[snapshots.length - 1]?.requestUrl, 'blob:resolver-original-1');

    await act(async () => {
      root.unmount();
    });
  } finally {
    imageManager.clearAll();
    imageOriginalSourceRegistry.clear();
    dom.cleanup();
  }
});

test('useImageResource separates preview processing state from resource no-source state while runtime thumbnail is still pending', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();

  try {
    const node = createNodeData({
      imageAsset: {
        assetId: 'file-runtime-pending',
        source: 'local',
        version: 1,
        intrinsicSize: {
          width: 2048,
          height: 1280,
        },
        variants: {},
      },
    });
    imageThumbnailRuntimeStore.upsert(node.id.value, {
      sessionId: 'session-runtime-pending',
      status: 'loading',
    });

    const snapshots: Array<{
      requestUrl?: string;
      status: string;
      placeholder: string;
      src?: string;
      previewStatus?: string;
    }> = [];
    let latestRequest: (() => Promise<void>) | null = null;
    let latestPreviewStatus: string | undefined;

    const TestHarness = (): null => {
      const resource = useImageResource(node, 'canvas', {
        enabled: true,
      });
      latestRequest = resource.request;
      latestPreviewStatus = resource.preview?.status;

      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        placeholder: resource.placeholder,
        src: resource.src,
        previewStatus: resource.preview?.status,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });

    const finalSnapshot = snapshots[snapshots.length - 1];

    assert.equal(finalSnapshot?.requestUrl, undefined);
    assert.equal(finalSnapshot?.status, 'error');
    assert.equal(finalSnapshot?.placeholder, 'unavailable');
    assert.equal(finalSnapshot?.src, undefined);
    assert.equal(finalSnapshot?.previewStatus, 'processing');
    assert.equal(latestPreviewStatus, 'processing');
    assert.equal(imageManager.getState(node.id.value, 'canvas').status, 'error');
    assert.equal(imageManager.getState(node.id.value, 'canvas').lastEventKind, 'register');

    await act(async () => {
      await latestRequest?.();
      await flushEffects();
    });

    assert.equal(imageManager.getState(node.id.value, 'canvas').lastEventReason, 'request skipped: no image source available');

    await act(async () => {
      root.unmount();
    });
  } finally {
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    dom.cleanup();
  }
});

test('useViewerImageResource uses existing runtime original file without refetching download', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = () => `blob:viewer-runtime-original-${++objectUrlIndex}`;
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
        status: 200,
      });
    },
  });

  try {
    const node = createNodeData({
      id: { value: 'node-viewer-runtime', display: '#01001' },
      fileId: 'file-viewer-runtime',
      source: {
        type: 'node-output',
        producerNodeId: 'ai-1',
      },
      imageAsset: {
        assetId: 'file-viewer-runtime',
        source: 'remote',
        version: 1,
        variants: {
          thumbnail: {
            url: '/api/v1/files/file-viewer-runtime/thumbnail',
          },
          original: {
            url: '/api/v1/files/file-viewer-runtime/download',
          },
        },
      },
    });

    await ensureExecutionOutputRuntimeResource({
      id: node.fileId,
      name: 'viewer-runtime.png',
      originalName: 'viewer-runtime.png',
      size: 3,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: 'hash-viewer-runtime',
      path: '/api/v1/files/file-viewer-runtime/download',
      metadata: {
        width: 512,
        height: 512,
      },
      source: {
        type: 'node-output',
      },
      timestamp: {
        created: 1,
        updated: 1,
      },
    });
    fetchCalls.length = 0;

    const snapshots: Array<{ requestUrl?: string; status: string; src?: string }> = [];

    const TestHarness = (): null => {
      const resource = useViewerImageResource(node, true);
      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        src: resource.src,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });

    assert.equal(fetchCalls.length, 0);
    assert.equal(
      snapshots.some((snapshot) => snapshot.requestUrl?.startsWith('blob:viewer-runtime-original-')),
      true,
    );
    assert.equal(fileResourceLeaseManager.getLeaseCount({
      nodeId: node.id.value,
      fileId: node.fileId,
      variant: 'original',
    }), 1);

    await act(async () => {
      root.unmount();
    });
    assert.equal(fileResourceLeaseManager.getLeaseCount({
      nodeId: node.id.value,
      fileId: node.fileId,
      variant: 'original',
    }), 0);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
    dom.cleanup();
  }
});

test('useViewerImageResource updates original request url when runtime original sync completes', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = () => `blob:viewer-runtime-late-${++objectUrlIndex}`;
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/files/file-viewer-late') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            fileId: 'file-viewer-late',
            originalName: 'viewer-late.png',
            displayName: 'viewer-late.png',
            mimeType: 'image/png',
            fileType: 'image',
            sourceType: 'output',
            sha256: 'hash-viewer-late',
            size: 3,
            extension: 'png',
            width: 512,
            height: 512,
            duration: null,
            status: 'ready',
            createdAt: new Date('2026-05-14T00:00:00.000Z').toISOString(),
            downloadUrl: '/api/v1/files/file-viewer-late/download',
            thumbnailUrl: '/api/v1/files/file-viewer-late/thumbnail',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/v1/files/file-viewer-late/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const node = createNodeData({
      id: { value: 'node-viewer-late', display: '#01002' },
      fileId: 'file-viewer-late',
      source: {
        type: 'node-output',
        producerNodeId: 'ai-2',
      },
      imageAsset: {
        assetId: 'file-viewer-late',
        source: 'remote',
        version: 1,
        variants: {
          thumbnail: {
            url: '/api/v1/files/file-viewer-late/thumbnail',
          },
          original: {
            url: '/api/v1/files/file-viewer-late/download',
          },
        },
      },
    });
    const snapshots: Array<{ requestUrl?: string; status: string; src?: string }> = [];

    const TestHarness = (): null => {
      const resource = useViewerImageResource(node, true);
      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        src: resource.src,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
      await flushEffects();
    });
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.requestUrl?.startsWith('blob:viewer-runtime-late-')),
    );

    assert.deepEqual(fetchCalls, [
      '/api/v1/files/file-viewer-late',
      '/api/v1/files/file-viewer-late/download',
    ]);
    assert.equal(fileResourceLeaseManager.getLeaseCount({
      nodeId: node.id.value,
      fileId: node.fileId,
      variant: 'original',
    }), 1);
    assert.equal(
      snapshots.some((snapshot) => snapshot.requestUrl === '/api/v1/files/file-viewer-late/download'),
      false,
    );
    assert.equal(
      snapshots.some((snapshot) => snapshot.requestUrl?.startsWith('blob:viewer-runtime-late-')),
      true,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
    dom.cleanup();
  }
});

test('useViewerImageResource falls back to remote download when local/runtime original is unavailable', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = () => `blob:viewer-remote-${++objectUrlIndex}`;
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/files/file-viewer-remote/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const node = createNodeData({
      id: { value: 'node-viewer-remote', display: '#01004' },
      fileId: 'file-viewer-remote',
      imageAsset: {
        assetId: 'file-viewer-remote',
        source: 'remote',
        version: 1,
        variants: {
          thumbnail: {
            url: '/api/v1/files/file-viewer-remote/thumbnail',
          },
          original: {
            url: '/api/v1/files/file-viewer-remote/download',
          },
        },
      },
    });
    const snapshots: Array<{ requestUrl?: string; status: string; src?: string }> = [];

    const TestHarness = (): null => {
      const resource = useViewerImageResource(node, true);
      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        src: resource.src,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.requestUrl?.startsWith('blob:viewer-remote-')),
    );

    assert.deepEqual(fetchCalls, ['/api/v1/files/file-viewer-remote/download']);
    assert.equal(
      snapshots.some((snapshot) => snapshot.requestUrl?.startsWith('blob:viewer-remote-')),
      true,
    );

    await act(async () => {
      root.unmount();
    });
    assert.equal(revokedUrls.includes('blob:viewer-remote-1'), true);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
    dom.cleanup();
  }
});

test('useViewerImageResource falls back to backend download when original asset variant is absent', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = () => `blob:viewer-backend-only-${++objectUrlIndex}`;
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/files/backend-viewer-only/download') {
        return new Response(new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const node = createNodeData({
      id: { value: 'node-viewer-backend-only', display: '#01006' },
      fileId: 'file-viewer-backend-only',
      backendFileId: 'backend-viewer-only',
      imageAsset: {
        assetId: 'file-viewer-backend-only',
        source: 'remote',
        version: 1,
        variants: {
          thumbnail: {
            url: '/api/v1/files/backend-viewer-only/thumbnail',
          },
        },
      },
    });
    const snapshots: Array<{ requestUrl?: string; status: string; src?: string }> = [];

    const TestHarness = (): null => {
      const resource = useViewerImageResource(node, true);
      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        src: resource.src,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.requestUrl?.startsWith('blob:viewer-backend-only-')),
    );

    assert.deepEqual(fetchCalls, ['/api/v1/files/backend-viewer-only/download']);
    assert.equal(
      snapshots.some((snapshot) => snapshot.requestUrl === 'blob:viewer-backend-only-1'),
      true,
    );

    await act(async () => {
      root.unmount();
    });
    assert.equal(revokedUrls.includes('blob:viewer-backend-only-1'), true);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
    dom.cleanup();
  }
});

test('useViewerImageResource probes backend metadata before download when only thumbnail asset is present', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = () => `blob:viewer-probed-backend-${++objectUrlIndex}`;
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/files/file-viewer-thumbnail-only') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            fileId: 'backend-probed-viewer',
            originalName: 'viewer-probed.png',
            displayName: 'viewer-probed.png',
            mimeType: 'image/png',
            fileType: 'image',
            sourceType: 'input',
            sha256: 'hash-viewer-probed',
            size: 3,
            extension: 'png',
            width: 512,
            height: 512,
            duration: null,
            status: 'ready',
            createdAt: new Date('2026-05-14T00:00:00.000Z').toISOString(),
            downloadUrl: '/api/v1/files/backend-probed-viewer/download',
            thumbnailUrl: '/api/v1/files/backend-probed-viewer/thumbnail',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/v1/files/backend-probed-viewer/download') {
        return new Response(new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const node = createNodeData({
      id: { value: 'node-viewer-thumbnail-only', display: '#01007' },
      fileId: 'file-viewer-thumbnail-only',
      backendFileId: undefined,
      imageAsset: {
        assetId: 'file-viewer-thumbnail-only',
        source: 'remote',
        version: 1,
        variants: {
          thumbnail: {
            url: '/api/v1/files/file-viewer-thumbnail-only/thumbnail',
          },
        },
      },
    });
    const snapshots: Array<{ requestUrl?: string; status: string; src?: string }> = [];

    const TestHarness = (): null => {
      const resource = useViewerImageResource(node, true);
      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        src: resource.src,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
      await flushEffects();
    });
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.requestUrl?.startsWith('blob:viewer-probed-backend-')),
    );

    assert.deepEqual(fetchCalls, [
      '/api/v1/files/file-viewer-thumbnail-only',
      '/api/v1/files/backend-probed-viewer/download',
    ]);
    assert.equal(
      snapshots.some((snapshot) => snapshot.requestUrl === 'blob:viewer-probed-backend-1'),
      true,
    );

    await act(async () => {
      root.unmount();
    });
    assert.equal(revokedUrls.includes('blob:viewer-probed-backend-1'), true);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
    dom.cleanup();
  }
});

test('useViewerImageResource rebuilds viewer object url after renderable source failure', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = () => `blob:viewer-stale-${++objectUrlIndex}`;
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };

  try {
    const node = createNodeData({
      id: { value: 'node-viewer-stale', display: '#01005' },
      fileId: 'file-viewer-stale',
    });
    imageOriginalSourceRegistry.registerLocalFile(
      node.id.value,
      node.fileId,
      new File(['viewer-stale'], 'viewer-stale.png', { type: 'image/png' }),
    );
    const snapshots: Array<{ requestUrl?: string; status: string; src?: string }> = [];
    let latestReportFailure: UseImageResourceResult['reportRenderableFailure'] | null = null;

    const TestHarness = (): null => {
      const resource = useViewerImageResource(node, true);
      latestReportFailure = resource.reportRenderableFailure;
      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        src: resource.src,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.requestUrl === 'blob:viewer-stale-1'),
    );

    assert.equal(snapshots.some((snapshot) => snapshot.requestUrl === 'blob:viewer-stale-1'), true);

    await act(async () => {
      latestReportFailure?.('blob:viewer-stale-1', 'stale object url');
      await flushEffects();
      await flushEffects();
    });
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.requestUrl === 'blob:viewer-stale-2'),
    );

    assert.equal(revokedUrls.includes('blob:viewer-stale-1'), true);
    assert.equal(snapshots.some((snapshot) => snapshot.requestUrl === 'blob:viewer-stale-2'), true);

    await act(async () => {
      root.unmount();
    });
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
    dom.cleanup();
  }
});

test('useViewerImageResource keeps viewer handle stable across equivalent node rerenders', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = () => `blob:viewer-stable-${++objectUrlIndex}`;
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };

  try {
    const node = createNodeData({
      id: { value: 'node-viewer-stable', display: '#01008' },
      fileId: 'file-viewer-stable',
      renderTier: 'full',
      activeState: 'passive',
      imageResourceOwner: 'dom',
    });
    imageOriginalSourceRegistry.registerLocalFile(
      node.id.value,
      node.fileId,
      new File(['viewer-stable'], 'viewer-stable.png', { type: 'image/png' }),
    );
    const snapshots: Array<{ requestUrl?: string; status: string }> = [];
    let currentNode = node;

    const TestHarness = ({ resourceNode }: { resourceNode: FileNodeData }): null => {
      const resource = useViewerImageResource(resourceNode, true);
      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness, { resourceNode: currentNode }));
      await flushEffects();
      await flushEffects();
    });
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.requestUrl === 'blob:viewer-stable-1'),
    );

    currentNode = {
      ...node,
      renderTier: 'compact',
      activeState: 'active',
      activeReasons: ['hovered'],
      imageResourceOwner: 'raster',
    };
    await act(async () => {
      root.render(React.createElement(TestHarness, { resourceNode: currentNode }));
      await flushEffects();
      await flushEffects();
    });

    assert.equal(objectUrlIndex, 1);
    assert.equal(revokedUrls.includes('blob:viewer-stable-1'), false);
    assert.equal(
      snapshots.filter((snapshot) => snapshot.requestUrl === 'blob:viewer-stable-1').length > 0,
      true,
    );

    await act(async () => {
      root.unmount();
    });
    assert.equal(revokedUrls.includes('blob:viewer-stable-1'), true);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    clearExecutionOutputRuntimeResources();
    imageOriginalSourceRegistry.clear();
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
    dom.cleanup();
  }
});

test('original viewer failure does not contaminate canvas thumbnail mode', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  imageOriginalSourceRegistry.clear();

  const node = createNodeData({
    id: { value: 'node-original-failure-isolated', display: '#01003' },
    fileId: 'file-original-failure-isolated',
    imageAsset: {
      assetId: 'file-original-failure-isolated',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-original-failure-isolated/thumbnail',
        },
        original: {
          url: '/api/v1/files/file-original-failure-isolated/download',
        },
      },
    },
  });
  const resolvedAsset = resolveFileNodeImageAsset(node);

  imageManager.register({
    nodeId: node.id.value,
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail?.url,
  });
  imageManager.register({
    nodeId: node.id.value,
    mode: 'original',
    resolvedAsset,
    preferredUrl: resolvedAsset.original?.url,
  });
  imageManager.reportLoadFailure(
    node.id.value,
    'original failed',
    Date.now(),
    'original',
    {
      attemptedUrl: resolvedAsset.original?.url,
    },
  );

  const canvasState = imageManager.getState(node.id.value, 'canvas');
  const originalState = imageManager.getState(node.id.value, 'original');

  assert.equal(canvasState.status, 'idle');
  assert.equal(canvasState.requestUrl, resolvedAsset.thumbnail?.url);
  assert.equal(originalState.status, 'error');
  assert.equal(originalState.requestUrl, resolvedAsset.original?.url);

  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  imageOriginalSourceRegistry.clear();
});

test('useImageResource switches canvas request url from persisted thumbnail to runtime thumbnail when runtime preview becomes ready', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();

  try {
    const node = createNodeData({
      thumbnailUrl: '/api/v1/files/file-image-resource/thumbnail',
    });
    const snapshots: Array<{
      requestUrl?: string;
      status: string;
      placeholder: string;
      src?: string;
    }> = [];

    const TestHarness = (): null => {
      const resource = useImageResource(node, 'canvas', {
        enabled: true,
      });

      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        placeholder: resource.placeholder,
        src: resource.src,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });

    assert.equal(
      snapshots.some((snapshot) => snapshot.requestUrl === 'blob:thumb'),
      true,
    );

    await act(async () => {
      imageThumbnailRuntimeStore.upsert(node.id.value, {
        sessionId: 'session-runtime-ready',
        objectUrl: 'blob:runtime-thumb-ready',
        status: 'ready',
      });
      await flushEffects();
    });

    const afterRuntimeReady = snapshots[snapshots.length - 1];
    assert.equal(afterRuntimeReady?.requestUrl, 'blob:runtime-thumb-ready');

    await act(async () => {
      root.unmount();
    });
  } finally {
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    dom.cleanup();
  }
});

test('useImageResource marks runtime thumbnail preprocessing failure as unavailable instead of keeping loading', async () => {
  const dom = installDom();
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();

  try {
    const node = createNodeData({
      imageAsset: {
        assetId: 'file-runtime-error',
        source: 'local',
        version: 1,
        intrinsicSize: {
          width: 2048,
          height: 1280,
        },
        variants: {},
      },
    });
    imageThumbnailRuntimeStore.upsert(node.id.value, {
      sessionId: 'session-runtime-error',
      status: 'error',
      error: 'thumbnail-unavailable',
    });

    const snapshots: Array<{
      requestUrl?: string;
      status: string;
      placeholder: string;
      src?: string;
      error?: string;
    }> = [];

    const TestHarness = (): null => {
      const resource = useImageResource(node, 'canvas', {
        enabled: true,
      });

      snapshots.push({
        requestUrl: resource.requestUrl,
        status: resource.status,
        placeholder: resource.placeholder,
        src: resource.src,
        error: resource.error,
      });
      return null;
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(React.createElement(TestHarness));
      await flushEffects();
      await flushEffects();
    });

    const finalSnapshot = snapshots[snapshots.length - 1];

    assert.equal(finalSnapshot?.requestUrl, undefined);
    assert.equal(finalSnapshot?.status, 'error');
    assert.equal(finalSnapshot?.placeholder, 'unavailable');
    assert.equal(finalSnapshot?.src, undefined);
    assert.equal(imageManager.getState(node.id.value, 'canvas').status, 'error');

    await act(async () => {
      root.unmount();
    });
  } finally {
    imageManager.clearAll();
    imageThumbnailRuntimeStore.clearAll();
    dom.cleanup();
  }
});
