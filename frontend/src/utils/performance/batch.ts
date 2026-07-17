// ==============================================
// 🔒 LOCKED: 批量处理
// @module utils/performance/batch
// 最后锁定时间：2026-03-25
// 说明：提供数组分块和批量处理功能
// 依赖层：无
// ==============================================

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
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
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
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const batches = chunkArray(items, batchSize);
  const results: R[] = [];

  for (const batch of batches) {
    const batchResults = await processor(batch);
    results.push(...batchResults);
  }

  return results;
}
