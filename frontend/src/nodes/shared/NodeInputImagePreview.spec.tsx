import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  NodeInputImagePreview,
  nodeInputImagePreviewRuntime,
} from './NodeInputImagePreview';
import type { FileNodeData } from '@/types';
import type { UseImageResourceResult } from '@/hooks/image/useImageResource';

function createImageNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: 'node-input-preview',
      display: '#00001',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'file-node-input-preview',
    fileName: 'preview.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 1920,
      height: 1080,
    },
    imageAsset: {
      assetId: 'file-node-input-preview',
      source: 'local',
      version: 1,
      intrinsicSize: {
        width: 1920,
        height: 1080,
      },
      variants: {},
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
    lastRenderedImageElement: {
      src?: string;
      alt?: string;
      className?: string;
      draggable?: boolean | string;
      tagName?: string;
    } | null;
    lastRenderedImage: {
      src?: string;
      alt?: string;
      className?: string;
      draggable?: boolean;
    } | null;
    appendChild: (child: unknown) => void;
    insertBefore: (child: unknown) => void;
    removeChild: (child: unknown) => void;
    addEventListener: (type: string, handler: EventListener) => void;
    removeEventListener: (type: string, handler: EventListener) => void;
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
  const container = {
    nodeType: 1,
    ownerDocument: null as unknown,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: [] as unknown[],
    lastRenderedImageElement: null as {
      src?: string;
      alt?: string;
      className?: string;
      draggable?: boolean | string;
      tagName?: string;
    } | null,
    get lastRenderedImage() {
      return snapshotImageElement(this.lastRenderedImageElement);
    },
    set lastRenderedImage(_value: {
      src?: string;
      alt?: string;
      className?: string;
      draggable?: boolean;
    } | null) {
      void _value;
    },
    appendChild(child: unknown) {
      this.childNodes.push(child);
      if (isImageLike(child)) {
        this.lastRenderedImageElement = child;
      }
    },
    insertBefore(child: unknown) {
      this.childNodes.unshift(child);
      if (isImageLike(child)) {
        this.lastRenderedImageElement = child;
      }
    },
    removeChild(child: unknown) {
      this.childNodes = this.childNodes.filter((entry) => entry !== child);
      if (isImageLike(child) && this.lastRenderedImageElement === child) {
        this.lastRenderedImageElement = null;
      }
    },
    addEventListener(type: string, handler: EventListener) {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, new Set());
      }
      documentListeners.get(type)?.add(handler);
    },
    removeEventListener(type: string, handler: EventListener) {
      documentListeners.get(type)?.delete(handler);
    },
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
    createElement: (tagName: string) => ({
      nodeType: 1,
      nodeName: tagName.toUpperCase(),
      tagName: tagName.toUpperCase(),
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: documentStub,
      style: {},
      childNodes: [] as unknown[],
      appendChild(child: unknown) {
        this.childNodes.push(child);
      },
      insertBefore(child: unknown) {
        this.childNodes.unshift(child);
      },
      removeChild(child: unknown) {
        this.childNodes = this.childNodes.filter((entry) => entry !== child);
      },
      setAttribute(name: string, value: string) {
        if (name === 'class') {
          (this as Record<string, unknown>).className = value;
          return;
        }
        if (name === 'draggable') {
          (this as Record<string, unknown>).draggable = value !== 'false';
          return;
        }
        (this as Record<string, unknown>)[name] = value;
      },
      removeAttribute(name: string) {
        if (name === 'class') {
          (this as Record<string, unknown>).className = '';
          return;
        }
        if (name === 'draggable') {
          (this as Record<string, unknown>).draggable = false;
          return;
        }
        delete (this as Record<string, unknown>)[name];
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      src: '',
      alt: '',
      className: '',
      draggable: false,
    }),
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
  container.ownerDocument = documentStub;

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

function isImageLike(value: unknown): value is {
  src?: string;
  alt?: string;
  className?: string;
  draggable?: boolean | string;
  tagName?: string;
} {
  return typeof value === 'object'
    && value !== null
    && 'src' in value
    && 'tagName' in value
    && value.tagName === 'IMG';
}

function snapshotImageElement(value: {
  src?: string;
  alt?: string;
  className?: string;
  draggable?: boolean | string;
  tagName?: string;
} | null): {
  src?: string;
  alt?: string;
  className?: string;
  draggable?: boolean;
} | null {
  if (!value) {
    return null;
  }

  return {
    src: value.src,
    alt: value.alt,
    className: value.className,
    draggable: value.draggable === true || value.draggable === 'true',
  };
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createImageResourceResult(
  overrides: Partial<UseImageResourceResult> = {},
): UseImageResourceResult {
  return {
    src: undefined,
    status: 'idle',
    phase: 'idle',
    error: undefined,
    preview: null,
    isVisible: true,
    isNearViewport: true,
    displayWidth: 0,
    displayHeight: 0,
    placeholder: 'hidden',
    request: async () => undefined,
    release: () => undefined,
    viewer: {
      activeVariantKind: undefined,
      resourcePolicy: 'thumbnail-only',
      resourceRole: 'canvas-thumbnail',
    },
    decoded: {
      kind: undefined,
      width: 0,
      height: 0,
      estimatedBytes: 0,
    },
    debug: {
      resourcePolicy: 'thumbnail-only',
      resourceRole: 'canvas-thumbnail',
      requestKey: undefined,
      preferredUrl: undefined,
      lastEventKind: undefined,
      lastEventAt: undefined,
      lastEventClassification: undefined,
      lastAttemptedUrl: undefined,
      lastEventReason: undefined,
      lastSwitchReason: undefined,
      retryCount: undefined,
      cooldownUntil: undefined,
      retryTrigger: undefined,
    },
    shouldAutoRequest: false,
    requestUrl: undefined,
    reportRenderableFailure: () => undefined,
    ...overrides,
  };
}

function createProtectedResourceResult(
  overrides: Partial<{
    resolvedUrl?: string;
    loading: boolean;
    error?: string;
  }> = {},
): {
  resolvedUrl?: string;
  loading: boolean;
  error?: string;
} {
  return {
    resolvedUrl: undefined,
    loading: false,
    error: undefined,
    ...overrides,
  };
}

test('NodeInputImagePreview prefers runtime thumbnail from useImageResource for image source nodes', async () => {
  const dom = installDom();
  const node = createImageNode();
  const originalUseImageResource = nodeInputImagePreviewRuntime.useImageResource;
  const originalUseProtectedResourceUrl = nodeInputImagePreviewRuntime.useProtectedResourceUrl;

  try {
    nodeInputImagePreviewRuntime.useImageResource = (() => createImageResourceResult({
      src: 'blob:runtime-thumbnail',
      status: 'ready',
      phase: 'thumbnail-ready',
      placeholder: 'ready',
      requestUrl: 'blob:runtime-thumbnail',
    })) as typeof nodeInputImagePreviewRuntime.useImageResource;
    nodeInputImagePreviewRuntime.useProtectedResourceUrl = (() => createProtectedResourceResult()) as typeof nodeInputImagePreviewRuntime.useProtectedResourceUrl;

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        React.createElement(NodeInputImagePreview, {
          sourceNode: node,
          alt: 'runtime-preview',
          className: 'node-input-preview',
          draggable: true,
          fallback: React.createElement('span', null, 'fallback'),
        }),
      );
      await flushEffects();
    });

    assert.deepEqual(dom.container.lastRenderedImage, {
      src: 'blob:runtime-thumbnail',
      alt: 'runtime-preview',
      className: 'node-input-preview',
      draggable: true,
    });

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    nodeInputImagePreviewRuntime.useImageResource = originalUseImageResource;
    nodeInputImagePreviewRuntime.useProtectedResourceUrl = originalUseProtectedResourceUrl;
    dom.cleanup();
  }
});

test('NodeInputImagePreview falls back to protected remote thumbnail src when runtime image resource is unavailable', async () => {
  const dom = installDom();
  const node = createImageNode();
  const originalUseImageResource = nodeInputImagePreviewRuntime.useImageResource;
  const originalUseProtectedResourceUrl = nodeInputImagePreviewRuntime.useProtectedResourceUrl;

  try {
    nodeInputImagePreviewRuntime.useImageResource = (() => createImageResourceResult({
      status: 'error',
      phase: 'error',
      placeholder: 'unavailable',
    })) as typeof nodeInputImagePreviewRuntime.useImageResource;
    nodeInputImagePreviewRuntime.useProtectedResourceUrl = (() => createProtectedResourceResult({
      resolvedUrl: 'blob:remote-thumbnail',
    })) as typeof nodeInputImagePreviewRuntime.useProtectedResourceUrl;

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        React.createElement(NodeInputImagePreview, {
          sourceNode: node,
          src: '/api/v1/files/file-node-input-preview/thumbnail',
          alt: 'remote-preview',
          fallback: React.createElement('span', null, 'fallback'),
        }),
      );
      await flushEffects();
    });

    assert.equal(dom.container.lastRenderedImage?.src, 'blob:remote-thumbnail');
    assert.equal(dom.container.lastRenderedImage?.alt, 'remote-preview');

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    nodeInputImagePreviewRuntime.useImageResource = originalUseImageResource;
    nodeInputImagePreviewRuntime.useProtectedResourceUrl = originalUseProtectedResourceUrl;
    dom.cleanup();
  }
});

test('NodeInputImagePreview renders fallback when neither runtime thumbnail nor explicit src is available', async () => {
  const dom = installDom();
  const node = createImageNode();
  const originalUseImageResource = nodeInputImagePreviewRuntime.useImageResource;
  const originalUseProtectedResourceUrl = nodeInputImagePreviewRuntime.useProtectedResourceUrl;

  try {
    nodeInputImagePreviewRuntime.useImageResource = (() => createImageResourceResult({
      status: 'error',
      phase: 'error',
      placeholder: 'unavailable',
    })) as typeof nodeInputImagePreviewRuntime.useImageResource;
    nodeInputImagePreviewRuntime.useProtectedResourceUrl = (() => createProtectedResourceResult()) as typeof nodeInputImagePreviewRuntime.useProtectedResourceUrl;

    let fallbackRenderCount = 0;
    const Fallback = (): JSX.Element => {
      fallbackRenderCount += 1;
      return React.createElement('span', null, 'fallback');
    };

    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        React.createElement(NodeInputImagePreview, {
          sourceNode: node,
          alt: 'missing-preview',
          fallback: React.createElement(Fallback),
        }),
      );
      await flushEffects();
    });

    assert.equal(dom.container.lastRenderedImage, null);
    assert.equal(fallbackRenderCount > 0, true);

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    nodeInputImagePreviewRuntime.useImageResource = originalUseImageResource;
    nodeInputImagePreviewRuntime.useProtectedResourceUrl = originalUseProtectedResourceUrl;
    dom.cleanup();
  }
});
