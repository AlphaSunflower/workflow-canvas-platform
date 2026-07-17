import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useProtectedResourceUrl } from './useProtectedResourceUrl';

function installDom(): {
  container: {
    nodeType: number;
    ownerDocument: unknown;
    nodeName: string;
    tagName: string;
    namespaceURI: string;
    childNodes: unknown[];
    textContent: string;
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
    textContent: '',
    appendChild(child: unknown) {
      this.childNodes.push(child);
      if (isTextLike(child)) {
        this.textContent = child.textContent ?? '';
      }
    },
    insertBefore(child: unknown) {
      this.childNodes.unshift(child);
      if (isTextLike(child)) {
        this.textContent = child.textContent ?? '';
      }
    },
    removeChild(child: unknown) {
      this.childNodes = this.childNodes.filter((entry) => entry !== child);
      if (isTextLike(child) && this.textContent === (child.textContent ?? '')) {
        this.textContent = '';
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
      textContent: '',
      appendChild(child: unknown) {
        this.childNodes.push(child);
        if (isTextLike(child)) {
          this.textContent = child.textContent ?? '';
        }
      },
      insertBefore(child: unknown) {
        this.childNodes.unshift(child);
        if (isTextLike(child)) {
          this.textContent = child.textContent ?? '';
        }
      },
      removeChild(child: unknown) {
        this.childNodes = this.childNodes.filter((entry) => entry !== child);
      },
      setAttribute(name: string, value: string) {
        (this as Record<string, unknown>)[name] = value;
      },
      removeAttribute(name: string) {
        delete (this as Record<string, unknown>)[name];
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
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

function isTextLike(value: unknown): value is { textContent?: string } {
  return typeof value === 'object' && value !== null && 'textContent' in value;
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function HookProbe({ url }: { url?: string }): JSX.Element {
  const state = useProtectedResourceUrl(url, {
    enabled: Boolean(url),
  });

  return React.createElement(
    'div',
    null,
    JSON.stringify({
      resolvedUrl: state.resolvedUrl ?? null,
      loading: state.loading,
      error: state.error ?? null,
      isEphemeral: state.isEphemeral,
    }),
  );
}

test('useProtectedResourceUrl returns plain blob URL without loading reset', async () => {
  const dom = installDom();

  try {
    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        React.createElement(HookProbe, {
          url: 'blob:task-history-thumbnail',
        }),
      );
      await flushEffects();
    });

    assert.equal(
      dom.container.textContent.includes('"resolvedUrl":"blob:task-history-thumbnail"'),
      true,
    );
    assert.equal(dom.container.textContent.includes('"isEphemeral":true'), true);
    assert.equal(dom.container.textContent.includes('"loading":false'), true);
    assert.equal(dom.container.textContent.includes('"error":null'), true);

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    dom.cleanup();
  }
});
