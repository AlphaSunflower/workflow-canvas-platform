/**
 * 节点层级管理工具
 * @module utils/node/z-index
 * @description 提供节点z-index排序和层级调整功能
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
/**
 * 按z-index排序节点
 * @param nodes - 节点数组
 * @returns 排序后的节点数组（新数组）
 */
export function sortNodesByZIndex(nodes) {
    return __spreadArray([], nodes, true).sort(function (a, b) { return a.zIndex - b.zIndex; });
}
/**
 * 将指定节点移到最前
 * @param nodes - 节点数组
 * @param targetId - 目标节点ID值
 * @returns 更新后的节点数组
 */
export function bringToFront(nodes, targetId) {
    var maxZ = Math.max.apply(Math, __spreadArray(__spreadArray([], nodes.map(function (n) { return n.zIndex; }), false), [0], false));
    return nodes.map(function (node) {
        return node.id.value === targetId
            ? __assign(__assign({}, node), { zIndex: maxZ + 1 }) : node;
    });
}
/**
 * 将指定节点移到最后
 * @param nodes - 节点数组
 * @param targetId - 目标节点ID值
 * @returns 更新后的节点数组
 */
export function sendToBack(nodes, targetId) {
    var minZ = Math.min.apply(Math, __spreadArray(__spreadArray([], nodes.map(function (n) { return n.zIndex; }), false), [0], false));
    return nodes.map(function (node) {
        return node.id.value === targetId
            ? __assign(__assign({}, node), { zIndex: minZ - 1 }) : node;
    });
}
/**
 * 获取选择框内的节点
 * @param nodes - 节点数组
 * @param selectionBox - 选择框（起点和终点）
 * @returns 选择框内的节点数组
 */
export function getNodesInSelection(nodes, selectionBox) {
    var minX = Math.min(selectionBox.start.x, selectionBox.end.x);
    var maxX = Math.max(selectionBox.start.x, selectionBox.end.x);
    var minY = Math.min(selectionBox.start.y, selectionBox.end.y);
    var maxY = Math.max(selectionBox.start.y, selectionBox.end.y);
    return nodes.filter(function (node) {
        var nodeMinX = node.position.x;
        var nodeMaxX = node.position.x + node.dimensions.width;
        var nodeMinY = node.position.y;
        var nodeMaxY = node.position.y + node.dimensions.height;
        return nodeMinX >= minX && nodeMaxX <= maxX &&
            nodeMinY >= minY && nodeMaxY <= maxY;
    });
}
