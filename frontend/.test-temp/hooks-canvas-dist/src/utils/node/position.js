/**
 * 节点位置计算工具
 * @module utils/node/position
 * @description 提供节点位置、距离、碰撞检测等计算功能
 */
import { REPULSION_DEFAULTS } from '@/constants/node.constants';
/**
 * 计算两点之间的距离
 * @param pos1 - 第一个位置
 * @param pos2 - 第二个位置
 * @returns 两点间距离
 */
export function calculateDistance(pos1, pos2) {
    var dx = pos2.x - pos1.x;
    var dy = pos2.y - pos1.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    return Number.isFinite(distance) ? distance : 0;
}
/**
 * 计算节点中心点位置
 * @param node - 节点数据
 * @returns 节点中心点坐标
 */
export function calculateNodeCenter(node) {
    return {
        x: node.position.x + node.dimensions.width / 2,
        y: node.position.y + node.dimensions.height / 2,
    };
}
/**
 * 判断两个节点是否重叠
 * @param node1 - 第一个节点
 * @param node2 - 第二个节点
 * @returns 是否重叠
 */
export function doNodesOverlap(node1, node2) {
    return !(node1.position.x + node1.dimensions.width < node2.position.x ||
        node2.position.x + node2.dimensions.width < node1.position.x ||
        node1.position.y + node1.dimensions.height < node2.position.y ||
        node2.position.y + node2.dimensions.height < node1.position.y);
}
/**
 * 计算两个节点之间的排斥力向量
 * @param node1 - 第一个节点
 * @param node2 - 第二个节点
 * @param minDistance - 最小距离
 * @returns 排斥力向量或null（无重叠时）
 */
export function calculateRepulsion(node1, node2, minDistance) {
    if (minDistance === void 0) { minDistance = REPULSION_DEFAULTS.minDistance; }
    var center1 = calculateNodeCenter(node1);
    var center2 = calculateNodeCenter(node2);
    var combinedHalfWidth = (node1.dimensions.width + node2.dimensions.width) / 2;
    var combinedHalfHeight = (node1.dimensions.height + node2.dimensions.height) / 2;
    var overlapX = combinedHalfWidth - Math.abs(center2.x - center1.x);
    var overlapY = combinedHalfHeight - Math.abs(center2.y - center1.y);
    if (overlapX <= 0 || overlapY <= 0) {
        return null;
    }
    var dx = center2.x - center1.x;
    var dy = center2.y - center1.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var repulsionDistance = Math.max(minDistance, Math.min(overlapX, overlapY));
    return {
        dx: (dx / len) * repulsionDistance,
        dy: (dy / len) * repulsionDistance,
    };
}
