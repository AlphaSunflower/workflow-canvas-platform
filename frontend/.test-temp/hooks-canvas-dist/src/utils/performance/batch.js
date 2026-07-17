// ==============================================
// 🔒 LOCKED: 批量处理
// @module utils/performance/batch
// 最后锁定时间：2026-03-25
// 说明：提供数组分块和批量处理功能
// 依赖层：无
// ==============================================
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
/**
 * 将数组分块
 * @description 将大数组分割成多个小块
 * @template T - 数组元素类型
 * @param array - 原数组
 * @param chunkSize - 每块大小
 * @returns 分块后的二维数组
 *
 * @example
 * const chunks = chunkArray([1, 2, 3, 4, 5], 2);
 * // chunks: [[1, 2], [3, 4], [5]]
 */
export function chunkArray(array, chunkSize) {
    var chunks = [];
    for (var i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}
/**
 * 批量处理项目
 * @description 将项目分批处理，避免一次性处理过多
 * @template T - 输入类型
 * @template R - 输出类型
 * @param items - 要处理的项目列表
 * @param batchSize - 每批大小
 * @param processor - 处理函数
 * @returns 所有批次的处理结果
 *
 * @example
 * const results = await processInBatches(
 *   items,
 *   10,
 *   async (batch) => processBatch(batch)
 * );
 */
export function processInBatches(items, batchSize, processor) {
    return __awaiter(this, void 0, void 0, function () {
        var batches, results, _i, batches_1, batch, batchResults;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    batches = chunkArray(items, batchSize);
                    results = [];
                    _i = 0, batches_1 = batches;
                    _a.label = 1;
                case 1:
                    if (!(_i < batches_1.length)) return [3 /*break*/, 4];
                    batch = batches_1[_i];
                    return [4 /*yield*/, processor(batch)];
                case 2:
                    batchResults = _a.sent();
                    results.push.apply(results, batchResults);
                    _a.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, results];
            }
        });
    });
}
