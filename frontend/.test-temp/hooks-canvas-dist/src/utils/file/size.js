// ==============================================
// 🔒 LOCKED: 文件大小工具
// @module utils/file/size
// 最后锁定时间：2026-03-25
// 说明：提供文件大小格式化、解析、计算等功能
// 依赖层：无
// ==============================================
/**
 * 格式化文件大小
 * @description 将字节数格式化为可读的字符串
 * @param bytes - 字节数
 * @param decimals - 小数位数，默认2
 * @returns 格式化后的字符串
 *
 * @example
 * formatFileSize(1024);
 * // "1 KB"
 *
 * formatFileSize(1536000, 2);
 * // "1.46 MB"
 */
export function formatFileSize(bytes, decimals) {
    if (decimals === void 0) { decimals = 2; }
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '0 B';
    }
    if (bytes === 0) {
        return '0 B';
    }
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var k = 1024;
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    var clampedI = Math.min(i, units.length - 1);
    var size = bytes / Math.pow(k, clampedI);
    return "".concat(size.toFixed(clampedI > 0 ? decimals : 0), " ").concat(units[clampedI]);
}
/**
 * 解析文件大小字符串
 * @description 将格式化的文件大小字符串解析为字节数
 * @param formatted - 格式化的字符串
 * @returns 字节数
 *
 * @example
 * parseFileSize('1.5 MB');
 * // 1572864
 */
export function parseFileSize(formatted) {
    var _a, _b;
    var match = formatted.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
    if (!match) {
        return 0;
    }
    var size = parseFloat(match[1]);
    var unit = ((_a = match[2]) !== null && _a !== void 0 ? _a : 'B').toUpperCase();
    var multipliers = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
        TB: 1024 * 1024 * 1024 * 1024,
    };
    return size * ((_b = multipliers[unit]) !== null && _b !== void 0 ? _b : 1);
}
/**
 * 计算文件总大小
 * @description 计算文件列表的总大小
 * @param files - 文件列表
 * @returns 总字节数
 */
export function calculateTotalSize(files) {
    return files.reduce(function (total, file) { return total + file.size; }, 0);
}
/**
 * 计算文件列表的平均大小
 * @param files - 文件列表
 * @returns 平均字节数
 */
export function calculateAverageSize(files) {
    if (files.length === 0)
        return 0;
    return calculateTotalSize(files) / files.length;
}
/**
 * 获取文件大小分类
 * @description 根据大小返回分类标签
 * @param bytes - 字节数
 * @returns 分类标签
 */
export function getFileSizeCategory(bytes) {
    var mb = bytes / (1024 * 1024);
    if (mb < 0.1)
        return 'tiny'; // < 100KB
    if (mb < 1)
        return 'small'; // < 1MB
    if (mb < 10)
        return 'medium'; // < 10MB
    if (mb < 100)
        return 'large'; // < 100MB
    return 'huge'; // >= 100MB
}
/**
 * 比较文件大小
 * @description 比较两个文件的大小
 * @param fileA - 第一个文件
 * @param fileB - 第二个文件
 * @returns 比较结果
 */
export function compareFileSize(fileA, fileB) {
    return fileA.size - fileB.size;
}
