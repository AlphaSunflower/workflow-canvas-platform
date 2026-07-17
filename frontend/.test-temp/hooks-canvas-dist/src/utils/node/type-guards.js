/**
 * 节点类型判断工具
 * @module utils/node/type-guards
 */
export function isFileNodeType(type) {
    return type === 'image' || type === 'video' || type === 'ply';
}
export function isAINodeType(type) {
    return (type === 'aiImageGen' ||
        type === 'aiImageInpaint' ||
        type === 'aiVideoGen' ||
        type === 'aiImageToPly' ||
        type === 'aiStoryboard' ||
        type === 'aiMultiViewRestore' ||
        type === 'aiModelRenderTransfer' ||
        type === 'aiImageHd' ||
        type === 'aiFloorplanColorize');
}
export function isFileNodeData(node) {
    return isFileNodeType(node.type);
}
export function isAINodeData(node) {
    return isAINodeType(node.type);
}
