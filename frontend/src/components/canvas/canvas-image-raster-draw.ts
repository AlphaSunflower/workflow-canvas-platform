import type { Node } from 'reactflow';

import type { ImageResourceState } from '@/services/image/image-resource.types';
import type { AnyNodeData, FileNodeData, Viewport } from '@/types';
import { isFileNodeData } from '@/utils';

import type { VisibleNodeMap, VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';

export type CanvasImageRasterStatus =
  | 'ready'
  | 'loading'
  | 'unavailable'
  | 'viewport-hidden'
  | 'cluster';

export interface CanvasImageRasterResourceSnapshot {
  src?: string;
  resourceSrc?: string;
  status: ImageResourceState['status'];
  decodedResource?: Pick<NonNullable<ImageResourceState['decodedResource']>, 'src' | 'width' | 'height' | 'decoded'>;
}

export interface CanvasImageRasterItem {
  kind?: 'image' | 'cluster';
  nodeId: string;
  fileName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  status: CanvasImageRasterStatus;
  src?: string;
  resourceSrc?: string;
  clusterCount?: number;
  clusterNodeIds?: string[];
}

export interface BuildCanvasImageRasterItemsOptions {
  nodes: readonly Node<AnyNodeData>[];
  visibleNodes: VisibleNodeMap;
  rasterEligibleNodeIds: ReadonlySet<string>;
  activeImageNodeIdSet?: ReadonlySet<string>;
  getResourceState: (nodeId: string) => CanvasImageRasterResourceSnapshot;
}

export interface CanvasImageRasterDrawOptions {
  items: CanvasImageRasterItem[];
  viewport: Viewport;
  canvasSize: {
    width: number;
    height: number;
  };
  devicePixelRatio?: number;
  startIndex?: number;
  clear?: boolean;
  maxDurationMs?: number;
  now?: () => number;
  resolveImage: (src: string) => CanvasImageSource | undefined;
  onImagePainted?: (item: Pick<CanvasImageRasterItem, 'nodeId' | 'src'> & { src: string }) => void;
}

const NODE_RADIUS = 12;
const DEFAULT_LOD_MIN_SCREEN_AREA = 16;
const DEFAULT_SIMPLE_CLIP_SCREEN_AREA = 96 * 96;

export interface CanvasImageRasterDrawResult {
  itemCount: number;
  visitedItemCount: number;
  drawnItemCount: number;
  placeholderItemCount: number;
  cacheMissItemCount: number;
  lodSkippedItemCount: number;
  deferredItemCount: number;
  nextStartIndex: number;
  budgetExhausted: boolean;
}

export function resolveCanvasImageRasterSource(
  state: CanvasImageRasterResourceSnapshot
): string | undefined {
  if (state.decodedResource?.src) {
    return state.decodedResource.src;
  }

  if (state.src) {
    return state.src;
  }

  return undefined;
}

export function resolveCanvasImageRasterStatus(options: {
  node: FileNodeData;
  visibility: VisibleNodeState;
  resource: CanvasImageRasterResourceSnapshot;
  src?: string;
}): CanvasImageRasterStatus {
  if (options.node.status === 'error' || options.resource.status === 'error') {
    return 'unavailable';
  }

  if (!options.visibility.isVisible && !options.visibility.isNearViewport) {
    return 'viewport-hidden';
  }

  if (options.src && options.resource.status === 'ready') {
    return 'ready';
  }

  if (options.node.status === 'pending' || options.node.status === 'processing') {
    return 'loading';
  }

  if (options.resource.status === 'loading') {
    return 'loading';
  }

  return options.src ? 'loading' : 'unavailable';
}

export function shouldRasterizeCanvasImageNode(options: {
  node: Node<AnyNodeData>;
  visibility?: VisibleNodeState;
  rasterEligibleNodeIds: ReadonlySet<string>;
  activeImageNodeIdSet?: ReadonlySet<string>;
}): options is {
  node: Node<FileNodeData>;
  visibility: VisibleNodeState;
  rasterEligibleNodeIds: ReadonlySet<string>;
  activeImageNodeIdSet?: ReadonlySet<string>;
} {
  if (!isFileNodeData(options.node.data) || options.node.data.type !== 'image') {
    return false;
  }

  if (!options.visibility) {
    return false;
  }

  if (!options.rasterEligibleNodeIds.has(options.node.id)) {
    return false;
  }

  if (options.activeImageNodeIdSet?.has(options.node.id)) {
    return false;
  }

  return options.node.data.imageResourceOwner !== 'none';
}

export function buildCanvasImageRasterItems({
  nodes,
  visibleNodes,
  rasterEligibleNodeIds,
  activeImageNodeIdSet,
  getResourceState,
}: BuildCanvasImageRasterItemsOptions): CanvasImageRasterItem[] {
  const items: CanvasImageRasterItem[] = [];

  nodes.forEach((node) => {
    const visibility = visibleNodes.get(node.id);
    const candidate = { node, visibility, rasterEligibleNodeIds, activeImageNodeIdSet };
    if (!shouldRasterizeCanvasImageNode(candidate)) {
      return;
    }

    const { node: imageNode, visibility: imageVisibility } = candidate;
    const resource = getResourceState(imageNode.id);
    const src = resolveCanvasImageRasterSource(resource);
    items.push({
      nodeId: imageNode.id,
      fileName: imageNode.data.fileName,
      x: imageNode.position.x,
      y: imageNode.position.y,
      width: imageNode.data.dimensions.width,
      height: imageNode.data.dimensions.height,
      rotation: imageNode.data.rotation,
      status: resolveCanvasImageRasterStatus({
        node: imageNode.data,
        visibility: imageVisibility,
        resource,
        src,
      }),
      src,
      resourceSrc: resource.resourceSrc,
    });
  });

  return items;
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const resolvedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.lineTo(x + width - resolvedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
  context.lineTo(x + width, y + height - resolvedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height);
  context.lineTo(x + resolvedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
  context.lineTo(x, y + resolvedRadius);
  context.quadraticCurveTo(x, y, x + resolvedRadius, y);
  context.closePath();
}

function fillPlaceholder(
  context: CanvasRenderingContext2D,
  item: CanvasImageRasterItem,
  width: number,
  height: number
): void {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  if (item.status === 'unavailable') {
    gradient.addColorStop(0, '#7f1d1d');
    gradient.addColorStop(1, '#450a0a');
  } else if (item.status === 'loading') {
    gradient.addColorStop(0, '#1f2937');
    gradient.addColorStop(1, '#111827');
  } else if (item.status === 'viewport-hidden') {
    gradient.addColorStop(0, '#27272a');
    gradient.addColorStop(1, '#18181b');
  } else {
    gradient.addColorStop(0, '#52525b');
    gradient.addColorStop(1, '#27272a');
  }

  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(244, 244, 245, 0.74)';
  context.font = `${Math.max(12, Math.min(32, width / 8))}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const label = item.status === 'unavailable'
    ? '!'
    : item.status === 'viewport-hidden'
      ? 'OFF'
      : item.status === 'loading'
        ? '...'
        : '';
  context.fillText(label, width / 2, height / 2);
}

export function shouldDrawCanvasImageRasterPlaceholder(
  item: CanvasImageRasterItem,
  hasResolvedImage: boolean,
): boolean {
  if (item.kind === 'cluster' || item.status === 'cluster') {
    return false;
  }

  if (hasResolvedImage) {
    return false;
  }

  if (item.status === 'ready' && item.src) {
    return false;
  }

  return true;
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number
): void {
  if (width <= 0 || height <= 0) {
    return;
  }

  const sourceWidthCandidate = 'naturalWidth' in image
    ? image.naturalWidth
    : 'videoWidth' in image
      ? image.videoWidth
      : 'width' in image
        ? Number(image.width)
        : width;
  const sourceHeightCandidate = 'naturalHeight' in image
    ? image.naturalHeight
    : 'videoHeight' in image
      ? image.videoHeight
      : 'height' in image
        ? Number(image.height)
        : height;
  const sourceWidth = Number.isFinite(sourceWidthCandidate)
    ? Math.max(1, Number(sourceWidthCandidate))
    : width;
  const sourceHeight = Number.isFinite(sourceHeightCandidate)
    ? Math.max(1, Number(sourceHeightCandidate))
    : height;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    context.drawImage(image, 0, 0, width, height);
    return;
  }

  const targetAspect = width / height;
  const sourceAspect = sourceWidth / sourceHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceDrawWidth = sourceWidth;
  let sourceDrawHeight = sourceHeight;

  if (sourceAspect > targetAspect) {
    sourceDrawWidth = sourceHeight * targetAspect;
    sourceX = (sourceWidth - sourceDrawWidth) / 2;
  } else if (sourceAspect < targetAspect) {
    sourceDrawHeight = sourceWidth / targetAspect;
    sourceY = (sourceHeight - sourceDrawHeight) / 2;
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceDrawWidth,
    sourceDrawHeight,
    0,
    0,
    width,
    height,
  );
}

function fillCluster(
  context: CanvasRenderingContext2D,
  item: CanvasImageRasterItem,
  width: number,
  height: number,
  image?: CanvasImageSource,
): void {
  roundRectPath(context, 0, 0, width, height, Math.max(6, Math.min(width, height) * 0.16));
  context.clip();
  if (image) {
    drawCoverImage(context, image, width, height);
    context.fillStyle = 'rgba(15, 23, 42, 0.46)';
    context.fillRect(0, 0, width, height);
  } else {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#334155');
    gradient.addColorStop(1, '#0f172a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  context.fillStyle = 'rgba(248, 250, 252, 0.94)';
  context.font = `${Math.max(12, Math.min(28, width * 0.28))}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(item.clusterCount ?? 1), width / 2, height / 2);
}

export function drawCanvasImageRasterLayer(
  context: CanvasRenderingContext2D,
  {
    items,
    viewport,
    canvasSize,
    devicePixelRatio = 1,
    startIndex = 0,
    clear = true,
    maxDurationMs,
    now = (): number => performance.now(),
    resolveImage,
    onImagePainted,
  }: CanvasImageRasterDrawOptions
): CanvasImageRasterDrawResult {
  const pixelRatio = Math.max(1, devicePixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (clear) {
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);
  }

  const startedAt = now();
  const resolvedStartIndex = Math.max(0, Math.min(startIndex, items.length));
  let visitedItemCount = 0;
  let drawnItemCount = 0;
  let placeholderItemCount = 0;
  let cacheMissItemCount = 0;
  let lodSkippedItemCount = 0;
  let nextStartIndex = items.length;
  let budgetExhausted = false;

  for (let index = resolvedStartIndex; index < items.length; index += 1) {
    if (
      maxDurationMs !== undefined &&
      visitedItemCount > 0 &&
      now() - startedAt >= maxDurationMs
    ) {
      nextStartIndex = index;
      budgetExhausted = true;
      break;
    }

    const item = items[index]!;
    visitedItemCount += 1;
    const zoom = viewport.zoom || 1;
    const screenX = item.x * zoom + viewport.x;
    const screenY = item.y * zoom + viewport.y;
    const screenWidth = item.width * zoom;
    const screenHeight = item.height * zoom;

    if (
      screenWidth <= 0 ||
      screenHeight <= 0 ||
      screenX > canvasSize.width ||
      screenY > canvasSize.height ||
      screenX + screenWidth < 0 ||
      screenY + screenHeight < 0
    ) {
      continue;
    }

    if (screenWidth * screenHeight < DEFAULT_LOD_MIN_SCREEN_AREA) {
      lodSkippedItemCount += 1;
      continue;
    }

    context.save();
    context.translate(screenX + screenWidth / 2, screenY + screenHeight / 2);
    if (item.rotation) {
      context.rotate((item.rotation * Math.PI) / 180);
    }
    context.translate(-screenWidth / 2, -screenHeight / 2);
    if (item.rotation || screenWidth * screenHeight >= DEFAULT_SIMPLE_CLIP_SCREEN_AREA) {
      roundRectPath(context, 0, 0, screenWidth, screenHeight, NODE_RADIUS * zoom);
      context.clip();
    }

    const image = (item.status === 'ready' || item.status === 'cluster') && item.src
      ? resolveImage(item.src)
      : undefined;

    if (item.kind === 'cluster' || item.status === 'cluster') {
      fillCluster(context, item, screenWidth, screenHeight, image);
      drawnItemCount += 1;
    } else if (image) {
      drawCoverImage(context, image, screenWidth, screenHeight);
      drawnItemCount += 1;
      if (item.src) {
        onImagePainted?.({
          nodeId: item.nodeId,
          src: item.src,
        });
      }
    } else if (shouldDrawCanvasImageRasterPlaceholder(item, false)) {
      fillPlaceholder(context, item, screenWidth, screenHeight);
      placeholderItemCount += 1;
    } else if (item.status === 'ready' && item.src) {
      cacheMissItemCount += 1;
    }

    context.restore();
  }

  const deferredItemCount = budgetExhausted
    ? Math.max(0, items.length - nextStartIndex)
    : 0;

  return {
    itemCount: items.length,
    visitedItemCount,
    drawnItemCount,
    placeholderItemCount,
    cacheMissItemCount,
    lodSkippedItemCount,
    deferredItemCount,
    nextStartIndex: budgetExhausted ? nextStartIndex : 0,
    budgetExhausted,
  };
}
