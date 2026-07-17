// ==============================================
// 🔒 LOCKED: ID生成工具
// @module utils/common/id
// 最后锁定时间：2026-03-25
// 说明：提供UUID、短ID、数字ID生成功能
// 依赖层：无
// ==============================================

/**
 * 生成UUID v4
 * @description 生成符合RFC 4122标准的UUID v4
 * @returns UUID字符串
 * 
 * @example
 * const id = generateUUID();
 * // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateUUID(): string {
  // 优先使用原生crypto.randomUUID
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // 回退到polyfill
    }
  }

  // 使用crypto.getRandomValues polyfill
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return generateUUIDv4Polyfill();
  }

  // 最终回退方案
  return generateUUIDv4Fallback();
}

/**
 * UUID v4 Polyfill（使用crypto.getRandomValues）
 */
function generateUUIDv4Polyfill(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 设置版本号和变体
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hexDigits = '0123456789abcdef';
  let uuid = '';
  
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      uuid += '-';
    }
    uuid += hexDigits[bytes[i] >> 4] + hexDigits[bytes[i] & 0x0f];
  }
  
  return uuid;
}

/**
 * UUID v4 回退方案（使用Math.random）
 */
function generateUUIDv4Fallback(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randomPart = Math.random().toString(16).padStart(16, '0').slice(2, 16);
  
  const hex = timestamp + randomPart;
  
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 15)}-${((Math.random() * 4) | 8).toString(16)}${hex.slice(16, 18)}-${hex.slice(18, 30)}`;
}

/**
 * 生成短ID
 * @description 生成指定长度的随机字符串ID
 * @param length - ID长度，默认8
 * @returns 短ID字符串
 * 
 * @example
 * const shortId = generateShortId();
 * // "a1B2c3D4"
 */
export function generateShortId(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成数字ID
 * @description 基于时间戳和随机数生成唯一ID
 * @returns 数字ID字符串
 * 
 * @example
 * const numericId = generateNumericId();
 * // "lz1a2b3c4d"
 */
export function generateNumericId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * 创建单次执行函数
 * @description 确保函数只执行一次
 * @template T - 函数类型
 * @param fn - 原函数
 * @returns 只执行一次的函数
 * 
 * @example
 * const initOnce = once(() => {
 *   console.log('初始化');
 * });
 * 
 * initOnce(); // 输出: 初始化
 * initOnce(); // 不输出
 */
export function once<T extends (...args: unknown[]) => unknown>(fn: T): T {
  let called = false;
  let result: ReturnType<T>;
  
  return ((...args: Parameters<T>) => {
    if (!called) {
      called = true;
      result = fn(...args) as ReturnType<T>;
    }
    return result;
  }) as T;
}
