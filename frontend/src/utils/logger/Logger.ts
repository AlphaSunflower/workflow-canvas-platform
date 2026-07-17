/**
 * 鏃ュ織鍣ㄧ被
 * @module utils/logger/Logger
 * @description 鎻愪緵鏃ュ織璁板綍銆佸瓨鍌ㄣ€佽繃婊ゅ姛鑳? */

import type { LogLevel, LogEntry, LoggerConfig } from './types';
import { LOG_LEVELS } from './types';

/**
 * 鏃ュ織鍣? * @description 鐢ㄤ簬璁板綍鍜岀鐞嗘棩蹇楃殑鏍稿績绫? */
export class Logger {
  /** 鏃ュ織鍣ㄩ厤缃?*/
  private config: LoggerConfig;
  /** 鏃ュ織瀛樺偍 */
  private storage: LogEntry[] = [];

  /**
   * 鍒涘缓鏃ュ織鍣ㄥ疄渚?   * @param config - 閮ㄥ垎閰嶇疆
   */
  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? 'info',
      enableConsole: config.enableConsole ?? true,
      enableStorage: config.enableStorage ?? true,
      maxStorageSize: config.maxStorageSize ?? 1000,
      modules: config.modules,
    };
  }

  /**
   * 鍒ゆ柇鏄惁搴旇璁板綍鏃ュ織
   * @param level - 鏃ュ織绾у埆
   * @param module - 妯″潡鍚?   * @returns 鏄惁搴旇璁板綍
   */
  private shouldLog(level: LogLevel, module: string): boolean {
    if (this.config.modules && !this.config.modules.includes(module)) {
      return false;
    }
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * 鏍煎紡鍖栨椂闂存埑
   * @param timestamp - 鏃堕棿鎴?   * @returns ISO鏍煎紡瀛楃涓?   */
  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toISOString();
  }

  /**
   * 鍒涘缓鏃ュ織鏉＄洰
   * @param level - 鏃ュ織绾у埆
   * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
   * @param data - 闄勫姞鏁版嵁
   * @param error - 閿欒瀵硅薄
   * @returns 鏃ュ織鏉＄洰
   */
  private createEntry(
    level: LogLevel,
    module: string,
    operation: string,
    message: string,
    data?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      module,
      operation,
      message,
    };

    if (data) {
      entry.data = data;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  /**
   * 璁板綍鏃ュ織
   * @param entry - 鏃ュ織鏉＄洰
   */
  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level, entry.module)) {
      return;
    }

    if (this.config.enableConsole) {
      const prefix = `[${this.formatTimestamp(entry.timestamp)}][${entry.module}][${entry.operation}]`;
      const consoleMethod = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log';
      
      if (entry.error) {
        // eslint-disable-next-line no-console
        console[consoleMethod](prefix, entry.message, entry.data ?? '', entry.error);
      } else {
        // eslint-disable-next-line no-console
        console[consoleMethod](prefix, entry.message, entry.data ?? '');
      }
    }

    if (this.config.enableStorage) {
      this.storage.push(entry);
      if (this.storage.length > this.config.maxStorageSize) {
        this.storage.shift();
      }
    }
  }

  /**
   * 璁板綍璋冭瘯鏃ュ織
   * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
   * @param data - 闄勫姞鏁版嵁
   */
  debug(module: string, operation: string, message: string, data?: Record<string, unknown>): void {
    this.log(this.createEntry('debug', module, operation, message, data));
  }

  /**
   * 璁板綍淇℃伅鏃ュ織
   * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
   * @param data - 闄勫姞鏁版嵁
   */
  info(module: string, operation: string, message: string, data?: Record<string, unknown>): void {
    this.log(this.createEntry('info', module, operation, message, data));
  }

  /**
   * 璁板綍璀﹀憡鏃ュ織
   * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
   * @param data - 闄勫姞鏁版嵁
   */
  warn(module: string, operation: string, message: string, data?: Record<string, unknown>): void {
    this.log(this.createEntry('warn', module, operation, message, data));
  }

  /**
   * 璁板綍閿欒鏃ュ織
   * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
   * @param error - 閿欒瀵硅薄
   * @param data - 闄勫姞鏁版嵁
   */
  error(module: string, operation: string, message: string, error?: Error, data?: Record<string, unknown>): void {
    this.log(this.createEntry('error', module, operation, message, data, error));
  }

  /**
   * 鑾峰彇瀛樺偍鐨勬棩蹇?   * @returns 鏃ュ織鏉＄洰鏁扮粍
   */
  getStorage(): LogEntry[] {
    return [...this.storage];
  }

  /**
   * 娓呯┖瀛樺偍鐨勬棩蹇?   */
  clearStorage(): void {
    this.storage = [];
  }

  /**
   * 璁剧疆鏃ュ織绾у埆
   * @param level - 鏃ュ織绾у埆
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * 鏇存柊閰嶇疆
   * @param config - 閮ㄥ垎閰嶇疆
   */
  setConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

