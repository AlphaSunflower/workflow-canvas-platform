import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebSocketClient } from './index';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.();
    });
  }

  send(): void {
    // no-op
  }

  close(code = 1000, reason = 'closed'): void {
    this.onclose?.({ code, reason });
  }
}

test('websocket client reconnects with token from auth token provider instead of URL search params', async () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  const originalWindow = globalThis.window;
  FakeWebSocket.instances.length = 0;

  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  });
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: ((callback: () => void) => {
      callback();
      return 1;
    }) as typeof setTimeout,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin: 'http://localhost:3000',
        search: '?token=stale-token-from-url',
      },
    },
  });

  try {
    const client = createWebSocketClient({
      url: 'ws://localhost:3100/ws',
      reconnectAttempts: 1,
      reconnectInterval: 1,
      heartbeatInterval: 60_000,
    });

    let nextToken = 'fresh-token-1';
    client.setAuthTokenProvider(() => nextToken);

    const connectResult = await client.connect();
    assert.equal(connectResult.success, true);
    assert.equal(FakeWebSocket.instances[0]?.url, 'ws://localhost:3100/ws?token=fresh-token-1');

    nextToken = 'fresh-token-2';
    FakeWebSocket.instances[0]?.close(1006, 'network interrupted');

    assert.equal(FakeWebSocket.instances[1]?.url, 'ws://localhost:3100/ws?token=fresh-token-2');
    client.disconnect();
  } finally {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: OriginalWebSocket,
    });
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: originalSetTimeout,
    });
    if (originalWindow === undefined) {
      // @ts-expect-error restore optional global
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});
