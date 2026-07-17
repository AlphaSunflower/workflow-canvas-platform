import type { Node } from 'reactflow';

import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';
import {
  imageManager,
  resolveRenderableImageSrc,
} from '@/services/image/image-manager';
import { getFileNodeImageThumbnailUrl, resolveFileNodeImageAsset } from '@/services/image/image-asset';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import type { ImageResourceState, ResolvedFileNodeImageAsset } from '@/services/image/image-resource.types';
import type { AnyNodeData, FileNodeData } from '@/types';

import {
  buildCanvasImageRasterItems,
  type CanvasImageRasterItem,
  type CanvasImageRasterResourceSnapshot,
} from './canvas-image-raster-draw';

export interface CanvasRasterBridgeSnapshot {
  state: ImageResourceState;
  renderableSrc?: string;
  preferredUrl?: string;
  resolvedAsset: ResolvedFileNodeImageAsset;
}

export type CanvasRasterImageNode = Node<AnyNodeData> & { data: FileNodeData & { type: 'image' } };

function resolveCanvasBridgeRegistration(
  node: Pick<FileNodeData, 'id' | 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>
): {
  preferredUrl?: string;
  resolvedAsset: ResolvedFileNodeImageAsset;
} {
  const runtimeThumbnailEntry = imageThumbnailRuntimeStore.get(node.id.value);
  const runtimeThumbnailUrl = runtimeThumbnailEntry?.status === 'ready'
    ? runtimeThumbnailEntry.objectUrl
    : undefined;
  const baseResolvedAsset = resolveFileNodeImageAsset(node);

  if (!runtimeThumbnailUrl) {
    return {
      preferredUrl: getFileNodeImageThumbnailUrl(node),
      resolvedAsset: baseResolvedAsset,
    };
  }

  return {
    preferredUrl: runtimeThumbnailUrl,
    resolvedAsset: {
      ...baseResolvedAsset,
      thumbnail: {
        kind: 'thumbnail',
        url: runtimeThumbnailUrl,
        fromLegacy: false,
        asset: baseResolvedAsset.thumbnail?.asset,
      },
      preferred: {
        kind: 'thumbnail',
        url: runtimeThumbnailUrl,
        fromLegacy: false,
        asset: baseResolvedAsset.thumbnail?.asset,
      },
    },
  };
}

export function getCanvasRasterBridgeSnapshot(node: Pick<FileNodeData, 'id' | 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>): CanvasRasterBridgeSnapshot {
  const { preferredUrl, resolvedAsset } = resolveCanvasBridgeRegistration(node);
  const state = imageManager.getState(node.id.value, 'canvas');

  return {
    state,
    renderableSrc: resolveRenderableImageSrc(state),
    preferredUrl,
    resolvedAsset,
  };
}

function buildImageManagerResourceSnapshot(nodeId: string): CanvasImageRasterResourceSnapshot {
  const state = imageManager.getState(nodeId, 'canvas');
  return {
    src: resolveRenderableImageSrc(state),
    resourceSrc: state.requestUrl ?? state.src ?? state.preferredUrl,
    status: state.status,
    decodedResource: state.decodedResource
      ? {
        src: state.decodedResource.src,
        width: state.decodedResource.width,
        height: state.decodedResource.height,
        decoded: state.decodedResource.decoded,
      }
      : undefined,
  };
}

function buildRuntimeThumbnailResourceSnapshot(
  node: Pick<FileNodeData, 'id'>,
): CanvasImageRasterResourceSnapshot | undefined {
  const runtimeThumbnail = imageThumbnailRuntimeStore.get(node.id.value);
  if (runtimeThumbnail?.status !== 'ready' || !runtimeThumbnail.objectUrl) {
    return undefined;
  }

  return {
    src: runtimeThumbnail.objectUrl,
    resourceSrc: runtimeThumbnail.objectUrl,
    status: 'ready',
  };
}

function isRenderableReadyResourceSnapshot(
  snapshot: CanvasImageRasterResourceSnapshot | undefined,
): snapshot is CanvasImageRasterResourceSnapshot {
  return snapshot?.status === 'ready' && Boolean(snapshot.decodedResource?.src ?? snapshot.src);
}

export function registerCanvasRasterBridgeNodes(
  rasterEligibleImageNodes: readonly CanvasRasterImageNode[],
): string[] {
  const registeredNodeIds: string[] = [];

  rasterEligibleImageNodes.forEach((node) => {
    const { preferredUrl, resolvedAsset } = resolveCanvasBridgeRegistration(node.data);

    imageManager.register({
      nodeId: node.id,
      mode: 'canvas',
      resolvedAsset,
      preferredUrl,
    });
    registeredNodeIds.push(node.id);
  });

  return registeredNodeIds;
}

export function requestCanvasRasterBridgeResource(nodeId: string): Promise<void> {
  return imageManager.request(nodeId, 'canvas');
}

export function cancelCanvasRasterBridgeResourceRequest(nodeId: string): void {
  imageManager.cancelRequest(nodeId, 'canvas');
}

export function reportCanvasRasterImageLoadFailure(
  nodeId: string,
  attemptedSrc: string,
  reason = 'Canvas raster image failed to load',
): void {
  imageManager.reportRenderableSourceFailure(nodeId, attemptedSrc, 'canvas', reason);
}

export function buildCanvasRasterItemsFromBridge(
  rasterEligibleImageNodes: readonly CanvasRasterImageNode[],
  visibleNodes: VisibleNodeMap,
  activeImageNodeIdSet: ReadonlySet<string>,
  resourceSnapshots?: ReadonlyMap<string, CanvasImageRasterResourceSnapshot>,
): CanvasImageRasterItem[] {
  const rasterEligibleNodeIds = new Set(rasterEligibleImageNodes.map((node) => node.id));
  const rasterEligibleImageNodesById = new Map(rasterEligibleImageNodes.map((node) => [node.id, node]));
  return buildCanvasImageRasterItems({
    nodes: rasterEligibleImageNodes,
    visibleNodes,
    rasterEligibleNodeIds,
    activeImageNodeIdSet,
    getResourceState: (nodeId): CanvasImageRasterResourceSnapshot => {
      const providedSnapshot = resourceSnapshots?.get(nodeId);
      if (isRenderableReadyResourceSnapshot(providedSnapshot)) {
        return providedSnapshot;
      }

      const managerSnapshot = buildImageManagerResourceSnapshot(nodeId);
      if (isRenderableReadyResourceSnapshot(managerSnapshot)) {
        return managerSnapshot;
      }

      const node = rasterEligibleImageNodesById.get(nodeId);
      const runtimeThumbnailSnapshot = node
        ? buildRuntimeThumbnailResourceSnapshot(node.data)
        : undefined;
      if (runtimeThumbnailSnapshot) {
        return runtimeThumbnailSnapshot;
      }

      return providedSnapshot ?? managerSnapshot;
    },
  });
}
