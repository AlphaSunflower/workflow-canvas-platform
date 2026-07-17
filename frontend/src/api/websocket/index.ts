import type { Result, WebSocketMessage } from '../../types';
import { createModuleLogger, tryCatchAsync } from '../../utils';

const log = createModuleLogger('websocket-client');

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

export interface WebSocketConfig {
  url: string;
  reconnectAttempts: number;
  reconnectInterval: number;
  heartbeatInterval: number;
}

const DEFAULT_CONFIG: WebSocketConfig = {
  url: '',
  reconnectAttempts: 5,
  reconnectInterval: 3000,
  heartbeatInterval: 30000,
};

type MessageHandler = (message: WebSocketMessage) => void;
type AuthTokenProvider = (() => string | null) | null;

class WebSocketClientImpl {
  private config: WebSocketConfig;
  private ws: WebSocket | null = null;
  private status: WebSocketStatus = 'disconnected';
  private reconnectCount = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionVersion = 0;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private messageQueue: WebSocketMessage[] = [];
  private authTokenProvider: AuthTokenProvider = null;

  constructor(config: Partial<WebSocketConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setConfig(config: Partial<WebSocketConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  getStatus(): WebSocketStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  setAuthTokenProvider(provider: AuthTokenProvider): void {
    this.authTokenProvider = provider;
  }

  private getAuthToken(): string | null {
    try {
      const token = this.authTokenProvider?.();
      return typeof token === 'string' && token.trim().length > 0 ? token : null;
    } catch (error) {
      log.error('getAuthToken', 'Failed to resolve websocket auth token', error instanceof Error ? error : undefined);
      return null;
    }
  }

  private buildConnectionUrl(token: string): string {
    const targetUrl = new URL(this.config.url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    targetUrl.searchParams.set('token', token);
    return targetUrl.toString();
  }

  async connect(): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      if (this.status === 'connected' || this.status === 'connecting') {
        log.warn('connect', 'WebSocket already connected or connecting');
        return;
      }

      if (!this.config.url.trim()) {
        log.debug('connect', 'Skipped websocket connect because websocket url is not configured');
        return;
      }

      const token = this.getAuthToken();
      if (!token) {
        log.warn('connect', 'Skipped websocket connect because no auth token is available');
        return;
      }

      this.clearReconnectTimer();
      this.stopHeartbeat();
      this.status = 'connecting';
      const connectionVersion = ++this.connectionVersion;
      const url = this.buildConnectionUrl(token);

      log.info('connect', `Connecting to ${this.config.url}`);

      return new Promise<void>((resolve, reject) => {
        try {
          const socket = new WebSocket(url);
          this.ws = socket;

          socket.onopen = (): void => {
            if (!this.isActiveSocket(socket, connectionVersion)) {
              return;
            }

            this.status = 'connected';
            this.reconnectCount = 0;
            log.info('connect', 'WebSocket connected');
            this.startHeartbeat();
            this.flushMessageQueue();
            resolve();
          };

          socket.onmessage = (event): void => {
            if (!this.isActiveSocket(socket, connectionVersion)) {
              return;
            }

            this.handleMessage(event.data);
          };

          socket.onerror = (error): void => {
            if (!this.isActiveSocket(socket, connectionVersion)) {
              return;
            }

            log.error('connect', 'WebSocket error', undefined, { error });
          };

          socket.onclose = (event): void => {
            const wasConnecting = this.status === 'connecting';

            if (!this.isActiveSocket(socket, connectionVersion)) {
              return;
            }

            this.handleClose(event.code, event.reason, socket);
            if (wasConnecting) {
              reject(new Error(`Connection failed: ${event.reason}`));
            }
          };
        } catch (e) {
          if (this.connectionVersion === connectionVersion) {
            this.status = 'disconnected';
            this.ws = null;
          }
          reject(e);
        }
      });
    }, 'websocket-client', 'connect');
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.connectionVersion++;

    const socket = this.ws;
    this.ws = null;

    if (this.status === 'disconnected' || this.status === 'disconnecting') {
      if (socket) {
        this.detachSocket(socket);
      }
      this.status = 'disconnected';
      return;
    }

    log.info('disconnect', 'Disconnecting WebSocket');
    this.status = 'disconnecting';

    if (socket) {
      this.detachSocket(socket);
      socket.close(1000, 'Client disconnect');
    }

    this.status = 'disconnected';
  }

  subscribe(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    
    this.handlers.get(type)!.add(handler);

    return () => {
      const handlers = this.handlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(type);
        }
      }
    };
  }

  send(type: string, payload: unknown): void {
    const message: WebSocketMessage = {
      type,
      payload,
      timestamp: Date.now(),
    };

    if (this.status !== 'connected' || !this.ws) {
      log.warn('send', 'WebSocket not connected, queuing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
      log.debug('send', `Sent message: ${type}`);
    } catch (e) {
      log.error('send', 'Failed to send message', e instanceof Error ? e : undefined);
    }
  }

  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      log.debug('handleMessage', `Received message: ${message.type}`);

      const handlers = this.handlers.get(message.type);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(message);
          } catch (e) {
            log.error('handleMessage', 'Handler error', e instanceof Error ? e : undefined);
          }
        });
      }

      const wildcardHandlers = this.handlers.get('*');
      if (wildcardHandlers) {
        wildcardHandlers.forEach((handler) => {
          try {
            handler(message);
          } catch (e) {
            log.error('handleMessage', 'Wildcard handler error', e instanceof Error ? e : undefined);
          }
        });
      }
    } catch (e) {
      log.error('handleMessage', 'Failed to parse message', e instanceof Error ? e : undefined);
    }
  }

  private isActiveSocket(socket: WebSocket, connectionVersion: number): boolean {
    return this.ws === socket && this.connectionVersion === connectionVersion;
  }

  private detachSocket(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleClose(code: number, reason: string, socket: WebSocket): void {
    log.info('handleClose', `WebSocket closed: ${code} - ${reason}`);
    this.status = 'disconnected';
    this.stopHeartbeat();
    if (this.ws === socket) {
      this.ws = null;
    }

    if (code !== 1000 && this.reconnectCount < this.config.reconnectAttempts) {
      this.reconnectCount++;
      log.info('handleClose', `Reconnecting (${this.reconnectCount}/${this.config.reconnectAttempts})`);

      this.clearReconnectTimer();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect();
      }, this.config.reconnectInterval);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send('ping', { timestamp: Date.now() });
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.status === 'connected') {
      const message = this.messageQueue.shift();
      if (message && this.ws) {
        try {
          this.ws.send(JSON.stringify(message));
        } catch (e) {
          log.error('flushMessageQueue', 'Failed to send queued message', e instanceof Error ? e : undefined);
        }
      }
    }
  }
}

export const websocketClient = new WebSocketClientImpl();

export function createWebSocketClient(config: Partial<WebSocketConfig>): WebSocketClientImpl {
  return new WebSocketClientImpl(config);
}

