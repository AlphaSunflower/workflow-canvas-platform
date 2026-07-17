/**
 * 节点工具函数
 * @module utils/node
 */

export type { NodeIdGenerator, NodeIdGeneratorResult } from '@/types';

export {
  isFileNodeType,
  isAINodeType,
  isFileNodeData,
  isAINodeData,
} from './type-guards';

export {
  getNodeTypeInfo,
  getNodeDisplayName,
  getNodeIcon,
  getNodeColor,
  getNodeCategory,
} from './info';

export {
  MAX_NODE_ID,
  NODE_ID_EXHAUSTED_ERROR,
  generateNodeId,
  parseNodeIdDisplay,
  createNodeIdGenerator,
} from './id';

export {
  createMonotonicNodeIdAllocator,
  createNodeIdAllocatorFromWorkflowMetadata,
  normalizeWorkflowNodeIdMetadata,
  getMaxNodeIdFromNodeMap,
  getMaxNodeIdFromCollection,
  type NodeIdAllocator,
  type NodeIdAllocationResult,
  type NodeIdBatchAllocationResult,
  type NodeIdAllocatorSnapshot,
} from './node-id-allocator';

export {
  calculateNodeSize,
  scaleNodeSize,
  clampNodeScale,
  normalizeRotation,
} from './size';

export {
  isNodeLocked,
  isNodeProcessing,
  isNodeCompleted,
  isNodeError,
  isNodeIdle,
  getNodeStatusText,
} from './status';

export {
  calculateDistance,
  calculateNodeCenter,
  doNodesOverlap,
  calculateRepulsion,
} from './position';

export {
  calculateFileNodeDimensions,
  buildFileNodeMediaLayoutPatch,
  createDefaultFileNodeData,
  createDefaultAINodeData,
  createSequentialNodeId,
  createAIImageInputGroup,
  createDefaultAIInputGroups,
  ensureAIImageInputGroups,
  ensureFixedAIInputGroups,
  normalizeAIImageGenInputHandle,
  normalizeAIImageGenOutputHandle,
  canAddReferenceToNode,
  getReferenceCount,
  getRemainingReferenceSlots,
  createNodeReference,
  createFileGroup,
  getDefaultAIConfig,
} from './create';

export {
  sortNodesByZIndex,
  bringToFront,
  sendToBack,
  getNodesInSelection,
} from './z-index';
