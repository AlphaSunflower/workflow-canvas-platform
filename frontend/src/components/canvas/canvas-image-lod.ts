import type { Viewport } from '@/types';

import type { CanvasImageRasterItem } from './canvas-image-raster-draw';
import type { CanvasRasterImageNode } from './canvas-raster-image-resource-bridge';

export type CanvasImageLodMode = 'cluster' | 'thumbnail' | 'detail';

export interface CanvasImageLodPlan {
  mode: CanvasImageLodMode;
  rasterEligibleImageNodes: CanvasRasterImageNode[];
  clusterItems: CanvasImageRasterItem[];
  sourceNodeCount: number;
  visibleNodeCount: number;
}

export interface BuildCanvasImageLodPlanOptions {
  nodes: readonly CanvasRasterImageNode[];
  readyItems?: readonly CanvasImageRasterItem[];
  viewport: Viewport;
  canvasSize: {
    width: number;
    height: number;
  };
  activeImageNodeIdSet?: ReadonlySet<string>;
  overscanPx?: number;
}

interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CLUSTER_MAX_ZOOM = 0.025;
const CLUSTER_MIN_GROUP_SIZE = 4;
const DETAIL_MIN_ZOOM = 0.45;
const DEFAULT_OVERSCAN_PX = 180;
const CLUSTER_CELL_SIZE_PX = 96;
const CLUSTER_ITEM_SIZE_PX = 58;

export function resolveCanvasImageLodMode(zoom: number): CanvasImageLodMode {
  const resolvedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  if (resolvedZoom <= CLUSTER_MAX_ZOOM) {
    return 'cluster';
  }

  if (resolvedZoom < DETAIL_MIN_ZOOM) {
    return 'thumbnail';
  }

  return 'detail';
}

function buildViewportWorldRect(
  viewport: Viewport,
  canvasSize: BuildCanvasImageLodPlanOptions['canvasSize'],
  overscanPx: number,
): WorldRect {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  return {
    x: (-viewport.x - overscanPx) / zoom,
    y: (-viewport.y - overscanPx) / zoom,
    width: (canvasSize.width + overscanPx * 2) / zoom,
    height: (canvasSize.height + overscanPx * 2) / zoom,
  };
}

function intersects(left: WorldRect, right: WorldRect): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function nodeRect(node: CanvasRasterImageNode): WorldRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: Math.max(1, node.data.dimensions.width),
    height: Math.max(1, node.data.dimensions.height),
  };
}

function filterVisibleLodNodes({
  nodes,
  viewport,
  canvasSize,
  activeImageNodeIdSet,
  overscanPx,
}: Required<Pick<BuildCanvasImageLodPlanOptions, 'nodes' | 'viewport' | 'canvasSize' | 'activeImageNodeIdSet' | 'overscanPx'>>): CanvasRasterImageNode[] {
  const viewportRect = buildViewportWorldRect(viewport, canvasSize, overscanPx);
  return nodes.filter((node) => (
    node.data.imageResourceOwner === 'raster' &&
    !activeImageNodeIdSet.has(node.id) &&
    intersects(nodeRect(node), viewportRect)
  ));
}

function buildReadyItemByNodeId(
  readyItems: readonly CanvasImageRasterItem[] = [],
): Map<string, CanvasImageRasterItem> {
  const itemsByNodeId = new Map<string, CanvasImageRasterItem>();
  readyItems.forEach((item) => {
    if (item.kind === 'cluster' || item.status !== 'ready' || !item.src) {
      return;
    }

    itemsByNodeId.set(item.nodeId, item);
  });
  return itemsByNodeId;
}

function buildClusterItems({
  nodes,
  readyItems,
  viewport,
}: {
  nodes: readonly CanvasRasterImageNode[];
  readyItems?: readonly CanvasImageRasterItem[];
  viewport: Viewport;
}): CanvasImageRasterItem[] {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const readyItemByNodeId = buildReadyItemByNodeId(readyItems);
  const groups = new Map<string, CanvasRasterImageNode[]>();

  nodes.forEach((node) => {
    const rect = nodeRect(node);
    const screenCenterX = (rect.x + rect.width / 2) * zoom + viewport.x;
    const screenCenterY = (rect.y + rect.height / 2) * zoom + viewport.y;
    const key = [
      Math.floor(screenCenterX / CLUSTER_CELL_SIZE_PX),
      Math.floor(screenCenterY / CLUSTER_CELL_SIZE_PX),
    ].join(':');
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  });

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, group]): CanvasImageRasterItem[] => {
      if (group.length < CLUSTER_MIN_GROUP_SIZE) {
        return group
          .map((node): CanvasImageRasterItem | null => {
            const readyItem = readyItemByNodeId.get(node.id);
            if (!readyItem?.src) {
              return null;
            }

            const rect = nodeRect(node);
            return {
              ...readyItem,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              rotation: node.data.rotation,
            };
          })
          .filter((item): item is CanvasImageRasterItem => item !== null);
      }

      const center = group.reduce((sum, node) => {
        const rect = nodeRect(node);
        return {
          x: sum.x + rect.x + rect.width / 2,
          y: sum.y + rect.y + rect.height / 2,
        };
      }, { x: 0, y: 0 });
      const centerX = center.x / group.length;
      const centerY = center.y / group.length;
      const size = CLUSTER_ITEM_SIZE_PX / zoom;
      const representative = group
        .map((node) => readyItemByNodeId.get(node.id))
        .find((item): item is CanvasImageRasterItem & { src: string } => Boolean(item?.src));

      return [{
        kind: 'cluster',
        nodeId: `cluster:${key}`,
        fileName: `${group.length} images`,
        x: centerX - size / 2,
        y: centerY - size / 2,
        width: size,
        height: size,
        rotation: 0,
        status: 'cluster',
        src: representative?.src,
        resourceSrc: representative?.resourceSrc,
        clusterCount: group.length,
        clusterNodeIds: group.map((node) => node.id),
      }];
    });
}

export function buildCanvasImageLodPlan({
  nodes,
  readyItems,
  viewport,
  canvasSize,
  activeImageNodeIdSet = new Set<string>(),
  overscanPx = DEFAULT_OVERSCAN_PX,
}: BuildCanvasImageLodPlanOptions): CanvasImageLodPlan {
  const mode = resolveCanvasImageLodMode(viewport.zoom);
  const visibleNodes = filterVisibleLodNodes({
    nodes,
    viewport,
    canvasSize,
    activeImageNodeIdSet,
    overscanPx,
  });

  if (mode === 'cluster') {
    return {
      mode,
      rasterEligibleImageNodes: [],
      clusterItems: buildClusterItems({
        nodes: visibleNodes,
        readyItems,
        viewport,
      }),
      sourceNodeCount: nodes.length,
      visibleNodeCount: visibleNodes.length,
    };
  }

  return {
    mode,
    rasterEligibleImageNodes: visibleNodes,
    clusterItems: [],
    sourceNodeCount: nodes.length,
    visibleNodeCount: visibleNodes.length,
  };
}
