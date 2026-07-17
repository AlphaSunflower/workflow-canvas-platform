import { AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP, AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP, AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT, AI_IMAGE_INPAINT_MIN_HEIGHT, AI_IMAGE_INPAINT_MIN_WIDTH, resolveAIImageInpaintEditorSize, } from '@/nodes/ai-image-inpaint/constants';
function resolvePositiveDimension(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : 0;
}
function resolveNodeBodyRect(node) {
    var dataWidth = resolvePositiveDimension(node.data.dimensions.width);
    var dataHeight = resolvePositiveDimension(node.data.dimensions.height);
    var nodeWidth = resolvePositiveDimension(node.width);
    var nodeHeight = resolvePositiveDimension(node.height);
    return {
        x: node.position.x,
        y: node.position.y,
        width: dataWidth > 0 ? dataWidth : nodeWidth,
        height: dataHeight > 0 ? dataHeight : nodeHeight,
    };
}
export function resolveCanvasNodeVisibilityRect(node) {
    var bodyRect = resolveNodeBodyRect(node);
    if (node.data.type !== 'aiImageInpaint') {
        return bodyRect;
    }
    var editorSize = resolveAIImageInpaintEditorSize({
        editorHeight: node.data.config.editorHeight,
        sourceWidth: node.data.config.maskSourceWidth,
        sourceHeight: node.data.config.maskSourceHeight,
    });
    var bodyWidth = Math.max(AI_IMAGE_INPAINT_MIN_WIDTH, bodyRect.width);
    var bodyHeight = Math.max(AI_IMAGE_INPAINT_MIN_HEIGHT, bodyRect.height);
    var bodyCenterX = bodyRect.x + bodyWidth / 2;
    var editorX = bodyCenterX - editorSize.width / 2;
    var left = Math.min(bodyRect.x, editorX);
    var right = Math.max(bodyRect.x + bodyWidth, editorX + editorSize.width);
    return {
        x: left,
        y: bodyRect.y
            - editorSize.height
            - AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP
            - AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP
            - AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
        width: right - left,
        height: bodyHeight
            + editorSize.height
            + AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP
            + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP
            + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
    };
}
