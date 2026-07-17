/**
 * 鑺傜偣ID鐢熸垚鍣? * @module utils/node/id
 * @description 鎻愪緵鑺傜偣ID鐢熸垚鍜岀鐞嗗姛鑳? */

import type { NodeIdGenerator, NodeIdGeneratorResult } from '@/types';
import {
  generateNodeId,
  MAX_NODE_ID,
  NODE_ID_EXHAUSTED_ERROR,
} from './node-id.shared';

export {
  generateNodeId,
  MAX_NODE_ID,
  NODE_ID_EXHAUSTED_ERROR,
} from './node-id.shared';

/**
 * 浠庢樉绀哄瓧绗︿覆瑙ｆ瀽鑺傜偣ID搴忓垪鍙? * @param display - 鑺傜偣ID鏄剧ず瀛楃涓诧紙濡?#00001锛? * @returns 搴忓垪鍙锋垨null锛堣В鏋愬け璐ユ椂锛? */
export function parseNodeIdDisplay(display: string): number | null {
  const match = display.match(/^#(\d{5})$/);
  if (!match) {
    return null;
  }

  return parseInt(match[1], 10);
}

/**
 * 鍒涘缓鑺傜偣ID鐢熸垚鍣ㄥ疄渚? * @returns 鑺傜偣ID鐢熸垚鍣? * @description 鏀寔ID鍥炴敹閲嶇敤锛岄伩鍏岻D鑰楀敖
 */
export function createNodeIdGenerator(initialLastIssued: number = 0): NodeIdGenerator {
  let lastIssued = Math.max(0, Math.floor(initialLastIssued));

  return {
    next(): NodeIdGeneratorResult {
      if (lastIssued >= MAX_NODE_ID) {
        return {
          success: false,
          error: NODE_ID_EXHAUSTED_ERROR,
        };
      }

      lastIssued += 1;
      return {
        success: true,
        nodeId: generateNodeId(lastIssued),
      };
    },

    release(id: string): void {
      void id;
    },

    getLastIssued(): number {
      return lastIssued;
    },

    getAvailableCount(): number {
      return MAX_NODE_ID - lastIssued;
    },

    isExhausted(): boolean {
      return lastIssued >= MAX_NODE_ID;
    },
  };
}
