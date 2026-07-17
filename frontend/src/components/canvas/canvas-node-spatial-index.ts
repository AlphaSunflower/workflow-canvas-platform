import type { Node } from 'reactflow';
import type { AnyNodeData, Viewport } from '@/types';
import { resolveCanvasNodeVisibilityRect } from '@/hooks/canvas/node-visibility-rect';

export interface SpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialNodeSnapshot {
  id: string;
  rect: SpatialRect;
}

interface SpatialCellCoord {
  x: number;
  y: number;
}

interface SpatialIndexEntry {
  rect: SpatialRect;
  cellKeys: string[];
}

const DEFAULT_CELL_SIZE = 512;

function clampPositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeRect(rect: SpatialRect): SpatialRect {
  return {
    x: rect.x,
    y: rect.y,
    width: clampPositive(rect.width),
    height: clampPositive(rect.height),
  };
}

function buildViewportRect(
  viewport: Viewport,
  width: number,
  height: number,
  extraMargin = 0,
): SpatialRect {
  const zoom = viewport.zoom || 1;
  return {
    x: -viewport.x / zoom - extraMargin,
    y: -viewport.y / zoom - extraMargin,
    width: width / zoom + extraMargin * 2,
    height: height / zoom + extraMargin * 2,
  };
}

function rectsIntersect(left: SpatialRect, right: SpatialRect): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function toCellKey(coord: SpatialCellCoord): string {
  return `${coord.x}:${coord.y}`;
}

function resolveCellCoords(rect: SpatialRect, cellSize: number): SpatialCellCoord[] {
  const normalized = normalizeRect(rect);
  const maxX = normalized.x + Math.max(normalized.width, 1) - 1;
  const maxY = normalized.y + Math.max(normalized.height, 1) - 1;
  const startX = Math.floor(normalized.x / cellSize);
  const endX = Math.floor(maxX / cellSize);
  const startY = Math.floor(normalized.y / cellSize);
  const endY = Math.floor(maxY / cellSize);
  const coords: SpatialCellCoord[] = [];

  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) {
      coords.push({ x, y });
    }
  }

  return coords;
}

export function resolveNodeSpatialRect(node: Node<AnyNodeData>): SpatialRect {
  return resolveCanvasNodeVisibilityRect(node);
}

export class CanvasNodeSpatialIndex {
  private readonly cellSize: number;

  private readonly entryById = new Map<string, SpatialIndexEntry>();

  private readonly cellToNodeIds = new Map<string, Set<string>>();

  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = Math.max(64, Math.round(cellSize));
  }

  rebuild(nodes: Array<Node<AnyNodeData>>): void {
    this.entryById.clear();
    this.cellToNodeIds.clear();

    nodes.forEach((node) => {
      this.upsert(node.id, resolveNodeSpatialRect(node));
    });
  }

  upsert(nodeId: string, rect: SpatialRect): void {
    this.remove(nodeId);

    const normalized = normalizeRect(rect);
    const cellKeys = resolveCellCoords(normalized, this.cellSize).map(toCellKey);
    const entry: SpatialIndexEntry = {
      rect: normalized,
      cellKeys,
    };

    this.entryById.set(nodeId, entry);
    cellKeys.forEach((cellKey) => {
      const bucket = this.cellToNodeIds.get(cellKey) ?? new Set<string>();
      bucket.add(nodeId);
      this.cellToNodeIds.set(cellKey, bucket);
    });
  }

  remove(nodeId: string): void {
    const existing = this.entryById.get(nodeId);
    if (!existing) {
      return;
    }

    existing.cellKeys.forEach((cellKey) => {
      const bucket = this.cellToNodeIds.get(cellKey);
      if (!bucket) {
        return;
      }

      bucket.delete(nodeId);
      if (bucket.size === 0) {
        this.cellToNodeIds.delete(cellKey);
      }
    });

    this.entryById.delete(nodeId);
  }

  queryRect(rect: SpatialRect): string[] {
    const normalized = normalizeRect(rect);
    const candidateIds = new Set<string>();
    const cellKeys = resolveCellCoords(normalized, this.cellSize).map(toCellKey);

    cellKeys.forEach((cellKey) => {
      this.cellToNodeIds.get(cellKey)?.forEach((nodeId) => {
        const entry = this.entryById.get(nodeId);
        if (entry && rectsIntersect(entry.rect, normalized)) {
          candidateIds.add(nodeId);
        }
      });
    });

    return Array.from(candidateIds);
  }

  queryPoint(x: number, y: number): string[] {
    return this.queryRect({
      x,
      y,
      width: 1,
      height: 1,
    });
  }

  queryViewport(
    viewport: Viewport,
    containerSize: { width: number; height: number },
    overscan = 240,
  ): string[] {
    const nearViewportRect = buildViewportRect(viewport, containerSize.width, containerSize.height, overscan);
    return this.queryRect(nearViewportRect);
  }

  getNodeSnapshot(nodeId: string): SpatialNodeSnapshot | null {
    const entry = this.entryById.get(nodeId);
    if (!entry) {
      return null;
    }

    return {
      id: nodeId,
      rect: entry.rect,
    };
  }

  getNodeCount(): number {
    return this.entryById.size;
  }
}

export function createCanvasNodeSpatialIndex(cellSize = DEFAULT_CELL_SIZE): CanvasNodeSpatialIndex {
  return new CanvasNodeSpatialIndex(cellSize);
}
