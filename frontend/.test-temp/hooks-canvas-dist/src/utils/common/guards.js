// ==============================================
// LOCKED: 类型守卫
// @module utils/common/guards
// ==============================================
export function isString(value) {
    return typeof value === 'string';
}
export function isNumber(value) {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
}
export function isBoolean(value) {
    return typeof value === 'boolean';
}
export function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isArray(value) {
    return Array.isArray(value);
}
export function isFunction(value) {
    return typeof value === 'function';
}
export function isNull(value) {
    return value === null;
}
export function isUndefined(value) {
    return value === undefined;
}
export function isNullOrUndefined(value) {
    return value === null || value === undefined;
}
export function isEmpty(value) {
    if (isNullOrUndefined(value))
        return true;
    if (isString(value))
        return value.length === 0;
    if (isArray(value))
        return value.length === 0;
    if (isObject(value))
        return Object.keys(value).length === 0;
    return false;
}
export function isPosition(value) {
    return isObject(value) && isNumber(value.x) && isNumber(value.y);
}
export function isDimensions(value) {
    return isObject(value) && isNumber(value.width) && isNumber(value.height);
}
export function isBoundingBox(value) {
    return isPosition(value) && isDimensions(value);
}
export function isFileNodeData(node) {
    return node.type === 'image' || node.type === 'video' || node.type === 'ply';
}
export function isAINodeData(node) {
    return (node.type === 'aiImageGen' ||
        node.type === 'aiImageInpaint' ||
        node.type === 'aiVideoGen' ||
        node.type === 'aiImageToPly' ||
        node.type === 'aiStoryboard' ||
        node.type === 'aiMultiViewRestore' ||
        node.type === 'aiModelRenderTransfer' ||
        node.type === 'aiImageHd' ||
        node.type === 'aiFloorplanColorize');
}
export function isValidNodeType(value) {
    var validTypes = [
        'image',
        'video',
        'ply',
        'aiImageGen',
        'aiImageInpaint',
        'aiVideoGen',
        'aiImageToPly',
        'aiStoryboard',
        'aiMultiViewRestore',
        'aiModelRenderTransfer',
        'aiImageHd',
        'aiFloorplanColorize',
    ];
    return isString(value) && validTypes.includes(value);
}
export function isValidNodeStatus(value) {
    var validStatuses = ['idle', 'pending', 'processing', 'completed', 'error'];
    return isString(value) && validStatuses.includes(value);
}
export function isValidTaskStatus(value) {
    var validStatuses = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
    return isString(value) && validStatuses.includes(value);
}
