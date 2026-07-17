import { NODE_TYPE_INFO } from '@/constants/node.constants';
export function getNodeTypeInfo(type) {
    return NODE_TYPE_INFO[type];
}
export function getNodeDisplayName(type) {
    var _a, _b;
    return (_b = (_a = NODE_TYPE_INFO[type]) === null || _a === void 0 ? void 0 : _a.displayName) !== null && _b !== void 0 ? _b : '未知节点';
}
export function getNodeIcon(type) {
    var _a, _b;
    return (_b = (_a = NODE_TYPE_INFO[type]) === null || _a === void 0 ? void 0 : _a.icon) !== null && _b !== void 0 ? _b : 'NODE';
}
export function getNodeColor(type) {
    var _a, _b;
    return (_b = (_a = NODE_TYPE_INFO[type]) === null || _a === void 0 ? void 0 : _a.color) !== null && _b !== void 0 ? _b : '#6B7280';
}
export function getNodeCategory(type) {
    var _a, _b;
    return (_b = (_a = NODE_TYPE_INFO[type]) === null || _a === void 0 ? void 0 : _a.category) !== null && _b !== void 0 ? _b : 'file';
}
