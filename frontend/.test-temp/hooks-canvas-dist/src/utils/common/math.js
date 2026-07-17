// ==============================================
// 🔒 LOCKED: 数学计算工具
// @module utils/common/math
// 最后锁定时间：2026-03-25
// 说明：提供数值计算、几何计算、角度处理等功能
// 依赖层：无
// ==============================================
/**
 * 将数值限制在指定范围内
 * @description 确保数值在最小值和最大值之间
 * @param value - 原始值
 * @param min - 最小值
 * @param max - 最大值
 * @returns 限制后的值
 *
 * @example
 * clamp(150, 0, 100);
 * // 100
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
/**
 * 计算两点间距离
 * @description 计算二维平面上两点之间的欧几里得距离
 * @param x1 - 第一个点的X坐标
 * @param y1 - 第一个点的Y坐标
 * @param x2 - 第二个点的X坐标
 * @param y2 - 第二个点的Y坐标
 * @returns 距离
 *
 * @example
 * distance(0, 0, 3, 4);
 * // 5
 */
export function distance(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}
/**
 * 线性插值
 * @description 在两个值之间进行线性插值
 * @param start - 起始值
 * @param end - 结束值
 * @param t - 插值因子 (0-1)
 * @returns 插值结果
 *
 * @example
 * lerp(0, 100, 0.5);
 * // 50
 */
export function lerp(start, end, t) {
    return start + (end - start) * t;
}
/**
 * 反向线性插值
 * @description 计算值在范围内的比例位置
 * @param value - 当前值
 * @param start - 范围起始
 * @param end - 范围结束
 * @returns 比例位置 (0-1)
 */
export function inverseLerp(value, start, end) {
    if (start === end)
        return 0;
    return (value - start) / (end - start);
}
/**
 * 标准化角度到0-360度范围
 * @description 将任意角度转换为0-360度范围内的等效角度
 * @param angle - 角度（度）
 * @returns 标准化后的角度
 *
 * @example
 * normalizeAngle(450);
 * // 90
 */
export function normalizeAngle(angle) {
    angle = angle % 360;
    if (angle < 0)
        angle += 360;
    return angle;
}
/**
 * 角度转弧度
 * @description 将角度转换为弧度
 * @param degrees - 角度
 * @returns 弧度
 */
export function degreesToRadians(degrees) {
    return degrees * (Math.PI / 180);
}
/**
 * 弧度转角度
 * @description 将弧度转换为角度
 * @param radians - 弧度
 * @returns 角度
 */
export function radiansToDegrees(radians) {
    return radians * (180 / Math.PI);
}
/**
 * 判断点是否在矩形内
 * @description 检查点是否在指定矩形区域内
 * @param pointX - 点的X坐标
 * @param pointY - 点的Y坐标
 * @param rectX - 矩形左上角X坐标
 * @param rectY - 矩形左上角Y坐标
 * @param rectWidth - 矩形宽度
 * @param rectHeight - 矩形高度
 * @returns 是否在矩形内
 */
export function isPointInRect(pointX, pointY, rectX, rectY, rectWidth, rectHeight) {
    return (pointX >= rectX &&
        pointX <= rectX + rectWidth &&
        pointY >= rectY &&
        pointY <= rectY + rectHeight);
}
/**
 * 判断两个矩形是否相交
 * @description 检查两个矩形是否有重叠区域
 * @param rect1 - 第一个矩形 {x, y, width, height}
 * @param rect2 - 第二个矩形 {x, y, width, height}
 * @returns 是否相交
 */
export function rectsIntersect(rect1, rect2) {
    return (rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y);
}
/**
 * 计算矩形中心点
 * @description 计算矩形的中心坐标
 * @param x - 矩形左上角X坐标
 * @param y - 矩形左上角Y坐标
 * @param width - 矩形宽度
 * @param height - 矩形高度
 * @returns 中心点坐标 {x, y}
 */
export function getRectCenter(x, y, width, height) {
    return {
        x: x + width / 2,
        y: y + height / 2,
    };
}
/**
 * 计算两点之间的角度
 * @description 计算从第一点到第二点的角度（弧度）
 * @param x1 - 第一个点的X坐标
 * @param y1 - 第一个点的Y坐标
 * @param x2 - 第二个点的X坐标
 * @param y2 - 第二个点的Y坐标
 * @returns 角度（弧度）
 */
export function angleBetweenPoints(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
}
/**
 * 限制小数位数
 * @description 将数字保留指定小数位数
 * @param value - 原始值
 * @param decimals - 小数位数
 * @returns 限制后的值
 */
export function toFixed(value, decimals) {
    var factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
/**
 * 判断是否为整数
 * @description 检查数值是否为整数
 * @param value - 数值
 * @returns 是否为整数
 */
export function isInteger(value) {
    return Number.isInteger(value);
}
/**
 * 判断是否为偶数
 * @description 检查数值是否为偶数
 * @param value - 数值
 * @returns 是否为偶数
 */
export function isEven(value) {
    return value % 2 === 0;
}
/**
 * 判断是否为奇数
 * @description 检查数值是否为奇数
 * @param value - 数值
 * @returns 是否为奇数
 */
export function isOdd(value) {
    return value % 2 !== 0;
}
/**
 * 范围映射
 * @description 将值从一个范围映射到另一个范围
 * @param value - 原始值
 * @param inMin - 输入范围最小值
 * @param inMax - 输入范围最大值
 * @param outMin - 输出范围最小值
 * @param outMax - 输出范围最大值
 * @returns 映射后的值
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}
/**
 * 平滑步进
 * @description 在边缘之间进行平滑插值
 * @param edge0 - 下边缘
 * @param edge1 - 上边缘
 * @param x - 插值因子
 * @returns 平滑插值结果
 */
export function smoothStep(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}
import { CANVAS_DEFAULTS } from '@/constants/canvas.constants';
/**
 * 判断位置是否在画布范围内
 * @description 检查位置是否在画布边界内
 * @param position - 位置坐标
 * @returns 是否在画布内
 */
export function isWithinCanvas(position) {
    var halfWidth = CANVAS_DEFAULTS.width / 2;
    var halfHeight = CANVAS_DEFAULTS.height / 2;
    return (Math.abs(position.x) <= halfWidth &&
        Math.abs(position.y) <= halfHeight);
}
/**
 * 将位置限制在画布范围内
 * @description 将超出边界的位置限制在画布范围内
 * @param position - 原始位置
 * @returns 限制后的位置
 */
export function clampToCanvas(position) {
    var halfWidth = CANVAS_DEFAULTS.width / 2;
    var halfHeight = CANVAS_DEFAULTS.height / 2;
    return {
        x: clamp(position.x, -halfWidth, halfWidth),
        y: clamp(position.y, -halfHeight, halfHeight),
    };
}
