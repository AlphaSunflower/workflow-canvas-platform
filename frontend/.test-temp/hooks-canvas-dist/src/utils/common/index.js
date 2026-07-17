// ==============================================
// LOCKED: 通用工具统一导出
// @module utils/common
// ==============================================
export { generateUUID, generateShortId, generateNumericId, once, } from './id';
export { deepClone, deepEqual, pick, omit, merge, DeepCloneError, MAX_RECURSION_DEPTH, } from './object';
export { safeStringify, safeParse, truncate, capitalize, camelToSnake, snakeToCamel, camelToKebab, kebabToCamel, isEmptyString, randomString, escapeHtml, unescapeHtml, template, } from './string';
export { clamp, distance, lerp, inverseLerp, normalizeAngle, degreesToRadians, radiansToDegrees, isPointInRect, rectsIntersect, getRectCenter, angleBetweenPoints, toFixed, isInteger, isEven, isOdd, mapRange, smoothStep, isWithinCanvas, clampToCanvas, } from './math';
export { isString, isNumber, isBoolean, isObject, isArray, isFunction, isNull, isUndefined, isNullOrUndefined, isEmpty, isPosition, isDimensions, isBoundingBox, isFileNodeData, isAINodeData, isValidNodeType, isValidNodeStatus, isValidTaskStatus, } from './guards';
export { isIMEKeyboardEvent, shouldIgnoreGlobalKeyboardShortcut, } from './keyboard';
export { createRetryDecision, classifyRetryableError, isAbortLikeError, isTimeoutLikeError, normalizeRetryPolicy, runWithRetry, sleepWithAbort, withTimeout, } from './retry-policy';
