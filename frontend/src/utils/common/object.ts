// ==============================================
// 🔒 LOCKED: 对象操作工具
// @module utils/common/object
// 最后锁定时间：2026-03-25
// 说明：提供深拷贝、深比较、对象操作等功能
// 依赖层：无
// ==============================================

/** 最大递归深度 */
export const MAX_RECURSION_DEPTH = 100;

/**
 * 深拷贝选项
 */
export interface DeepCloneOptions {
  /** 最大递归深度 */
  maxDepth?: number;
}

/**
 * 深拷贝错误
 */
export class DeepCloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepCloneError';
  }
}

/**
 * 深拷贝
 * @description 深度克隆对象，支持循环引用检测
 * @template T - 值类型
 * @param value - 要克隆的值
 * @param options - 克隆选项
 * @returns 克隆后的值
 * 
 * @example
 * const original = { a: 1, b: { c: 2 } };
 * const cloned = deepClone(original);
 * // cloned 是完全独立的副本
 */
export function deepClone<T>(value: T, options?: DeepCloneOptions): T {
  const maxDepth = options?.maxDepth ?? MAX_RECURSION_DEPTH;
  
  const clone = <U>(val: U, depth: number, visited: Map<unknown, unknown>): U => {
    // 深度检查
    if (depth > maxDepth) {
      throw new DeepCloneError(`Maximum recursion depth (${maxDepth}) exceeded in deepClone`);
    }

    // 基本类型直接返回
    if (val === null || typeof val !== 'object') {
      return val;
    }

    // 循环引用检查
    if (visited.has(val)) {
      return visited.get(val) as U;
    }

    // 数组处理
    if (Array.isArray(val)) {
      const cloned: unknown[] = [];
      visited.set(val, cloned);
      for (let i = 0; i < val.length; i++) {
        cloned[i] = clone(val[i], depth + 1, visited);
      }
      return cloned as U;
    }

    // Date处理
    if (val instanceof Date) {
      return new Date(val.getTime()) as U;
    }

    // Map处理
    if (val instanceof Map) {
      const cloned = new Map();
      visited.set(val, cloned);
      val.forEach((v, k) => {
        cloned.set(clone(k, depth + 1, visited), clone(v, depth + 1, visited));
      });
      return cloned as U;
    }

    // Set处理
    if (val instanceof Set) {
      const cloned = new Set();
      visited.set(val, cloned);
      val.forEach(v => {
        cloned.add(clone(v, depth + 1, visited));
      });
      return cloned as U;
    }

    // RegExp处理
    if (val instanceof RegExp) {
      return new RegExp(val.source, val.flags) as U;
    }

    // Error处理
    if (val instanceof Error) {
      const cloned = new (val.constructor as ErrorConstructor)(val.message) as U;
      (cloned as Error).stack = val.stack;
      (cloned as Error).name = val.name;
      return cloned;
    }

    // ArrayBuffer处理
    if (typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer) {
      return val.slice(0) as U;
    }

    // DataView处理
    if (typeof DataView !== 'undefined' && val instanceof DataView) {
      return new DataView(val.buffer.slice(0), val.byteOffset, val.byteLength) as U;
    }

    // TypedArray处理
    if (ArrayBuffer.isView(val) && !(val instanceof DataView)) {
      const TypedArrayConstructor = (val as unknown as { constructor: TypedArrayConstructor }).constructor;
      return new TypedArrayConstructor(val as unknown as ArrayLike<number>) as U;
    }

    // 普通对象处理
    const cloned = {} as U;
    visited.set(val, cloned);
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        (cloned as Record<string, unknown>)[key] = clone(val[key], depth + 1, visited);
      }
    }
    return cloned;
  };

  return clone(value, 0, new Map());
}

/** TypedArray构造器接口 */
interface TypedArrayConstructor {
  new (array: ArrayLike<number>): ArrayBufferView;
}

/**
 * 深比较选项
 */
export interface DeepEqualOptions {
  /** 最大递归深度 */
  maxDepth?: number;
}

/**
 * 深比较
 * @description 深度比较两个值是否相等
 * @param a - 第一个值
 * @param b - 第二个值
 * @param options - 比较选项
 * @returns 是否相等
 * 
 * @example
 * deepEqual({ a: 1 }, { a: 1 }); // true
 * deepEqual([1, 2], [1, 2]); // true
 */
export function deepEqual(a: unknown, b: unknown, options?: DeepEqualOptions): boolean {
  const maxDepth = options?.maxDepth ?? MAX_RECURSION_DEPTH;
  
  const equal = (x: unknown, y: unknown, depth: number, visited: Map<unknown, Map<unknown, boolean>>): boolean => {
    // 深度检查
    if (depth > maxDepth) {
      console.warn(`Maximum recursion depth (${maxDepth}) exceeded in deepEqual, returning false`);
      return false;
    }

    // 引用相等
    if (x === y) return true;
    
    // 类型不同
    if (typeof x !== typeof y) return false;
    
    // null检查
    if (x === null || y === null) return x === y;

    // 基本类型
    if (typeof x !== 'object' || typeof y !== 'object') {
      return x === y;
    }

    // 循环引用检查
    const visitedX = visited.get(x);
    if (visitedX) {
      if (visitedX.has(y)) {
        return true;
      }
    } else {
      visited.set(x, new Map([[y, true]]));
    }

    // 数组比较
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (!equal(x[i], y[i], depth + 1, visited)) {
          return false;
        }
      }
      return true;
    }

    // Date比较
    if (x instanceof Date && y instanceof Date) {
      return x.getTime() === y.getTime();
    }

    // RegExp比较
    if (x instanceof RegExp && y instanceof RegExp) {
      return x.source === y.source && x.flags === y.flags;
    }

    // Map比较
    if (x instanceof Map && y instanceof Map) {
      if (x.size !== y.size) return false;
      for (const [key, value] of x) {
        if (!y.has(key) || !equal(value, y.get(key), depth + 1, visited)) {
          return false;
        }
      }
      return true;
    }

    // Set比较
    if (x instanceof Set && y instanceof Set) {
      if (x.size !== y.size) return false;
      for (const value of x) {
        if (!y.has(value)) {
          return false;
        }
      }
      return true;
    }

    // TypedArray比较
    if (ArrayBuffer.isView(x) && ArrayBuffer.isView(y)) {
      if (x.byteLength !== y.byteLength) return false;
      const viewX = new DataView(x.buffer, x.byteOffset, x.byteLength);
      const viewY = new DataView(y.buffer, y.byteOffset, y.byteLength);
      for (let i = 0; i < x.byteLength; i++) {
        if (viewX.getUint8(i) !== viewY.getUint8(i)) {
          return false;
        }
      }
      return true;
    }

    // 对象键比较
    const keysX = Object.keys(x as object);
    const keysY = Object.keys(y as object);

    if (keysX.length !== keysY.length) return false;

    for (const key of keysX) {
      if (!Object.prototype.hasOwnProperty.call(y, key)) {
        return false;
      }
      if (!equal((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key], depth + 1, visited)) {
        return false;
      }
    }

    return true;
  };

  return equal(a, b, 0, new Map());
}

/**
 * 提取对象属性
 * @description 从对象中提取指定的属性
 * @template T - 对象类型
 * @template K - 属性键类型
 * @param obj - 源对象
 * @param keys - 要提取的属性键数组
 * @returns 包含指定属性的新对象
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * 排除对象属性
 * @description 从对象中排除指定的属性
 * @template T - 对象类型
 * @template K - 属性键类型
 * @param obj - 源对象
 * @param keys - 要排除的属性键数组
 * @returns 排除指定属性后的新对象
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * 合并对象
 * @description 浅合并多个对象
 * @template T - 对象类型
 * @param target - 目标对象
 * @param sources - 源对象列表
 * @returns 合并后的对象
 */
export function merge<T extends object>(target: T, ...sources: Partial<T>[]): T {
  const result = { ...target };
  for (const source of sources) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        result[key] = source[key] as T[Extract<keyof T, string>];
      }
    }
  }
  return result;
}
