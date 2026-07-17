import type { Node } from 'reactflow';

import type { AnyNodeData, FileNodeData, Position, Viewport } from '@/types';
import { isFileNodeData } from '@/utils';
import type { NodeDropTarget } from '@/nodes/types';
import {
  findDropTargetFromDropzoneElement,
  findDropzoneElementFromElement,
  NODE_DROPZONE_SELECTOR,
} from '@/nodes/shared/drop';

import type {
  CanvasNodeSpatialIndex,
  SpatialNodeSnapshot,
} from './canvas-node-spatial-index';
import { getCanvasActiveNodeState } from './canvas-active-node-state';

export interface CanvasHitTestResult {
  node: Node<FileNodeData>;
  snapshot: SpatialNodeSnapshot;
}

interface GenericCanvasHitTestResult {
  node: Node<AnyNodeData>;
  snapshot: SpatialNodeSnapshot;
}

export interface CanvasHitTestOptions {
  clientPosition: Position;
  viewport: Viewport;
  nodes: Array<Node<AnyNodeData>>;
  spatialIndex: CanvasNodeSpatialIndex;
  containerBounds?: Pick<DOMRect, 'left' | 'top'>;
  excludedNodeIds?: ReadonlySet<string>;
}

export interface CanvasDropTargetResolutionOptions {
  clientPosition: Position;
  viewport: Viewport;
  nodes: Array<Node<AnyNodeData>>;
  spatialIndex: CanvasNodeSpatialIndex;
  containerBounds?: Pick<DOMRect, 'left' | 'top'>;
  documentLike?: Pick<Document, 'elementFromPoint'> & Partial<Pick<Document, 'elementsFromPoint'>>;
  canvasRoot?: ParentNode | null;
  excludedNodeIds?: ReadonlySet<string>;
}

export interface CanvasDropTargetResolution {
  dropTarget: NodeDropTarget;
  dropzone: HTMLElement;
}

export function screenPointToFlowPosition(
  position: Position,
  viewport: Viewport,
  containerBounds: Pick<DOMRect, 'left' | 'top'> = { left: 0, top: 0 }
): Position {
  const zoom = viewport.zoom || 1;
  const paneX = position.x - containerBounds.left;
  const paneY = position.y - containerBounds.top;
  return {
    x: (paneX - viewport.x) / zoom,
    y: (paneY - viewport.y) / zoom,
  };
}

export function hitTestCanvasNode(options: CanvasHitTestOptions): CanvasHitTestResult | null {
  const genericHit = getCanvasHitTestCandidates(options)[0] ?? null;
  if (!genericHit || !isFileNodeData(genericHit.node.data)) {
    return null;
  }

  return {
    node: genericHit.node as Node<FileNodeData>,
    snapshot: genericHit.snapshot,
  };
}

function getCanvasHitTestCandidates(options: CanvasHitTestOptions): GenericCanvasHitTestResult[] {
  const flowPosition = screenPointToFlowPosition(
    options.clientPosition,
    options.viewport,
    options.containerBounds,
  );
  const candidateIds = options.spatialIndex.queryPoint(flowPosition.x, flowPosition.y);
  if (candidateIds.length === 0) {
    return [];
  }

  const nodeById = new Map(options.nodes.map((node) => [node.id, node] as const));
  const candidates = candidateIds
    .filter((nodeId) => !options.excludedNodeIds?.has(nodeId))
    .map((nodeId) => {
      const node = nodeById.get(nodeId);
      const snapshot = options.spatialIndex.getNodeSnapshot(nodeId);
      if (!node || !snapshot) {
        return null;
      }

      return {
        node,
        snapshot,
      };
    })
    .filter((entry): entry is GenericCanvasHitTestResult => Boolean(entry));

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((left, right) => compareCanvasHitCandidates(left.node, right.node));
  return candidates;
}

export function resolveCanvasDropTarget(
  options: CanvasDropTargetResolutionOptions
): CanvasDropTargetResolution | null {
  const documentLike = options.documentLike;
  if (!documentLike) {
    return null;
  }

  const elementStack = getHitTestElementStack(documentLike, options.clientPosition);
  const dropzoneCandidates = new Map<string, HTMLElement>();

  elementStack.forEach((element) => {
    const dropzone = findDropzoneElementFromElement(element);
    if (!dropzone || !isDropzoneInsideCanvasRoot(dropzone, options.canvasRoot)) {
      return;
    }

    if (dropzone.dataset.nodeId && options.excludedNodeIds?.has(dropzone.dataset.nodeId)) {
      return;
    }

    dropzoneCandidates.set(getDropzoneKey(dropzone), dropzone);
  });

  const hitNodes = getCanvasHitTestCandidates(options);
  hitNodes.forEach((hitNode) => {
    const nodeDropzones = getCanvasNodeDropzones({
      nodeId: hitNode.node.id,
      canvasRoot: options.canvasRoot,
    });
    const preciseDropzone = findPreciseDropzoneAtPoint(nodeDropzones, options.clientPosition);
    if (preciseDropzone) {
      dropzoneCandidates.set(getDropzoneKey(preciseDropzone), preciseDropzone);
    }
  });

  const dropzoneEntries = Array.from(dropzoneCandidates.values())
    .map((dropzone) => {
      const dropTarget = findDropTargetFromDropzoneElement(dropzone);
      if (!dropTarget) {
        return null;
      }

      return {
        dropzone,
        dropTarget,
      };
    })
    .filter((entry): entry is CanvasDropTargetResolution => Boolean(entry));

  if (dropzoneEntries.length === 0) {
    return null;
  }

  dropzoneEntries.sort((left, right) => compareDropTargetResolutions(left, right));
  return dropzoneEntries[0] ?? null;
}

function compareCanvasHitCandidates(
  left: Node<AnyNodeData>,
  right: Node<AnyNodeData>
): number {
  const leftActive = getCanvasActiveNodeState(left.id).activeState === 'active';
  const rightActive = getCanvasActiveNodeState(right.id).activeState === 'active';
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }

  const leftSelected = Boolean(left.selected);
  const rightSelected = Boolean(right.selected);
  if (leftSelected !== rightSelected) {
    return leftSelected ? -1 : 1;
  }

  const leftZIndex = typeof left.zIndex === 'number' ? left.zIndex : left.data.zIndex;
  const rightZIndex = typeof right.zIndex === 'number' ? right.zIndex : right.data.zIndex;
  if (leftZIndex !== rightZIndex) {
    return rightZIndex - leftZIndex;
  }

  return right.id.localeCompare(left.id);
}

function getHitTestElementStack(
  documentLike: Pick<Document, 'elementFromPoint'> & Partial<Pick<Document, 'elementsFromPoint'>>,
  clientPosition: Position
): Element[] {
  const elementsFromPoint = documentLike.elementsFromPoint?.(
    clientPosition.x,
    clientPosition.y,
  );
  if (Array.isArray(elementsFromPoint) && elementsFromPoint.length > 0) {
    return elementsFromPoint;
  }

  const singleElement = documentLike.elementFromPoint(clientPosition.x, clientPosition.y);
  return singleElement ? [singleElement] : [];
}

function isDropzoneInsideCanvasRoot(dropzone: HTMLElement, canvasRoot?: ParentNode | null): boolean {
  if (!canvasRoot) {
    return true;
  }

  const contains = (canvasRoot as { contains?: (this: ParentNode, node: globalThis.Node | null) => boolean }).contains;
  if (typeof contains === 'function') {
    return contains.call(canvasRoot, dropzone);
  }

  return true;
}

function getCanvasNodeDropzones(options: {
  nodeId: string;
  canvasRoot?: ParentNode | null;
}): HTMLElement[] {
  const searchRoot = options.canvasRoot;
  if (!searchRoot || typeof searchRoot.querySelectorAll !== 'function') {
    return [];
  }

  const escapedNodeId = escapeSelectorAttribute(options.nodeId);
  return Array.from(
    searchRoot.querySelectorAll<HTMLElement>(
      `${NODE_DROPZONE_SELECTOR}[data-node-id="${escapedNodeId}"]`,
    ),
  );
}

function findPreciseDropzoneAtPoint(
  dropzones: readonly HTMLElement[],
  clientPosition: Position
): HTMLElement | null {
  const candidates = dropzones
    .filter((dropzone) => pointIntersectsRect(dropzone.getBoundingClientRect(), clientPosition))
    .sort(compareDropzonePrecision);

  return candidates[0] ?? null;
}

function pointIntersectsRect(
  rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  point: Position
): boolean {
  return point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom;
}

function compareDropTargetResolutions(
  left: CanvasDropTargetResolution,
  right: CanvasDropTargetResolution
): number {
  const leftRank = getDropzoneSpecificityRank(left.dropTarget);
  const rightRank = getDropzoneSpecificityRank(right.dropTarget);
  if (leftRank !== rightRank) {
    return rightRank - leftRank;
  }

  return compareDropzonePrecision(left.dropzone, right.dropzone);
}

function compareDropzonePrecision(left: HTMLElement, right: HTMLElement): number {
  const leftRect = left.getBoundingClientRect();
  const rightRect = right.getBoundingClientRect();
  const leftArea = leftRect.width * leftRect.height;
  const rightArea = rightRect.width * rightRect.height;

  if (leftArea !== rightArea) {
    return leftArea - rightArea;
  }

  const leftDepth = getDomDepth(left);
  const rightDepth = getDomDepth(right);
  if (leftDepth !== rightDepth) {
    return rightDepth - leftDepth;
  }

  return left.dataset.nodeId?.localeCompare(right.dataset.nodeId ?? '') ?? 0;
}

function getDropzoneSpecificityRank(target: NodeDropTarget): number {
  return target.nodeType === 'group' ? 2 : 1;
}

function getDomDepth(element: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current) {
    depth += 1;
    current = current.parentElement;
  }

  return depth;
}

function getDropzoneKey(dropzone: HTMLElement): string {
  const nodeId = dropzone.dataset.nodeId ?? '';
  const nodeType = dropzone.dataset.nodeDropzone ?? '';
  const groupId = dropzone.dataset.groupId ?? '';
  return `${nodeId}|${nodeType}|${groupId}`;
}

function escapeSelectorAttribute(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
