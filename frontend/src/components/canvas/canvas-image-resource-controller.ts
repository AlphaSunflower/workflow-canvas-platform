import type { Node } from 'reactflow';

import type { VisibleNodeMap, VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';
import { imageManager, resolveRenderableImageSrc } from '@/services/image/image-manager';
import { getFileNodeImageThumbnailUrl } from '@/services/image/image-asset';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import type { AnyNodeData, FileNodeData } from '@/types';

import {
  getCanvasImageDiagnosticsConfig,
  recordCanvasTraceEvent,
  recordCanvasRasterMetric,
} from '@/utils/performance';

import {
  buildCanvasRasterItemsFromBridge,
  cancelCanvasRasterBridgeResourceRequest,
  registerCanvasRasterBridgeNodes,
  requestCanvasRasterBridgeResource,
  type CanvasRasterImageNode,
} from './canvas-raster-image-resource-bridge';
import type {
  CanvasImageRasterItem,
  CanvasImageRasterResourceSnapshot,
} from './canvas-image-raster-draw';
import type { CanvasRenderPlan } from './canvas-render-plan';
import { canvasRasterReadyStore, type CanvasRasterReadyStore } from './canvas-raster-ready-store';
import {
  createCanvasRasterResourceScheduler,
  type CanvasRasterResourceCandidate,
  type CanvasRasterResourceScheduler,
  type CanvasRasterResourceSchedulerMetric,
  type CanvasRasterResourceSchedulerOptions,
} from './canvas-raster-resource-scheduler';
import {
  resolveCanvasImageResourcePriority,
  type CanvasImageResourcePriority,
} from './canvas-resource-priority';

function defaultScheduleReadySnapshotFrame(callback: () => void): number {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(() => callback());
  }

  return globalThis.setTimeout(callback, 16) as unknown as number;
}

function defaultCancelReadySnapshotFrame(frameId: number): void {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
    return;
  }

  globalThis.clearTimeout(frameId);
}

export interface CanvasImageResourceControllerUpdate {
  renderPlan: Pick<CanvasRenderPlan, 'rasterEligibleImageNodes' | 'renderedNodes'>;
  lodRasterEligibleImageNodes?: readonly CanvasRasterImageNode[];
  visibleNodes: VisibleNodeMap;
  activeImageNodeIdSet: ReadonlySet<string>;
  runtimeRegistrationRevision: number;
  deferResourceRequests?: boolean;
}

export interface CanvasImageResourceSnapshot {
  items: CanvasImageRasterItem[];
  resourceCandidates: CanvasRasterResourceCandidate[];
}

export interface CanvasImageResourceControllerMetricContext {
  itemCount: number;
  activeImageNodeCount: number;
  readyItemCount: number;
  loadingItemCount: number;
  unavailableItemCount: number;
}

export interface CanvasImageResourceControllerOptions {
  registerNodes?: CanvasRasterResourceSchedulerOptions['registerNodes'];
  requestNode?: CanvasRasterResourceSchedulerOptions['requestNode'];
  cancelNodeRequest?: CanvasRasterResourceSchedulerOptions['cancelNodeRequest'];
  scheduleFrame?: CanvasRasterResourceSchedulerOptions['scheduleFrame'];
  cancelFrame?: CanvasRasterResourceSchedulerOptions['cancelFrame'];
  passiveBatchSize?: number;
  importingBatchSize?: number;
  passiveMaxConcurrentRequests?: number;
  importingMaxConcurrentRequests?: number;
  onBatch?: (metric: CanvasRasterResourceSchedulerMetric) => void;
  readyStore?: CanvasRasterReadyStore;
}

function isCanvasRasterImageNode(
  node: Node<AnyNodeData>,
): node is CanvasRasterImageNode {
  return node.data.type === 'image';
}

function resolvePlannedImageNodes(
  renderPlan: Pick<CanvasRenderPlan, 'rasterEligibleImageNodes' | 'renderedNodes'>,
  lodRasterEligibleImageNodes?: readonly CanvasRasterImageNode[],
): CanvasRasterImageNode[] {
  if (lodRasterEligibleImageNodes) {
    return [...lodRasterEligibleImageNodes];
  }

  const renderedImageNodesById = new Map<string, CanvasRasterImageNode>();
  renderPlan.renderedNodes.forEach((node) => {
    if (isCanvasRasterImageNode(node)) {
      renderedImageNodesById.set(node.id, node);
    }
  });

  return renderPlan.rasterEligibleImageNodes.map((node) => (
    renderedImageNodesById.get(node.id) ??
    ({
      ...node,
      data: {
        ...node.data,
      } as FileNodeData & { type: 'image' },
    } as CanvasRasterImageNode)
  ));
}

function buildWeakImageContentFingerprint(node: CanvasRasterImageNode): string {
  return [
    node.data.fileName,
    node.data.fileSize,
    node.data.mimeType,
    node.data.metadata?.width ?? '',
    node.data.metadata?.height ?? '',
    node.data.imageAsset?.intrinsicSize?.width ?? '',
    node.data.imageAsset?.intrinsicSize?.height ?? '',
  ].join('|');
}

function buildRasterResourceSignature(node: CanvasRasterImageNode): string {
  const thumbnailVariant = node.data.imageAsset?.variants.thumbnail;
  const originalVariant = node.data.imageAsset?.variants.original;
  const runtimeThumbnail = imageThumbnailRuntimeStore.get(node.data.id.value);
  const readyRuntimeThumbnail = runtimeThumbnail?.status === 'ready' && runtimeThumbnail.objectUrl
    ? runtimeThumbnail
    : null;
  return [
    node.id,
    buildWeakImageContentFingerprint(node),
    node.data.fileId,
    node.data.thumbnailUrl ?? '',
    node.data.imageAsset?.version ?? '',
    thumbnailVariant?.url ?? '',
    thumbnailVariant?.width ?? '',
    thumbnailVariant?.height ?? '',
    originalVariant?.url ?? '',
    originalVariant?.width ?? '',
    originalVariant?.height ?? '',
    readyRuntimeThumbnail ? 'ready' : '',
    readyRuntimeThumbnail?.objectUrl ?? '',
    readyRuntimeThumbnail?.width ?? '',
    readyRuntimeThumbnail?.height ?? '',
    readyRuntimeThumbnail?.mimeType ?? '',
  ].join('|');
}

export interface ShouldScheduleCanvasImageResourceOptions {
  node: CanvasRasterImageNode;
  priority: CanvasImageResourcePriority;
  visibility?: VisibleNodeState;
  hasReadyRuntimeThumbnail?: boolean;
  hasCanvasRequestSource?: boolean;
}

function isCanvasImageResourceOwnerEligible(node: CanvasRasterImageNode): boolean {
  if (node.data.imageResourceOwner === 'raster') {
    return true;
  }

  if (node.data.imageResourceOwner === 'dom' && node.data.renderTier === 'full') {
    return true;
  }

  return false;
}

function isPromotedImportingResource(priority: CanvasImageResourcePriority): boolean {
  return priority.active ||
    priority.tier === 'selected' ||
    priority.tier === 'hovered' ||
    priority.tier === 'active' ||
    priority.tier === 'recent';
}

function hasReadyRuntimeThumbnail(node: CanvasRasterImageNode): boolean {
  const runtimeThumbnail = imageThumbnailRuntimeStore.get(node.data.id.value);
  return runtimeThumbnail?.status === 'ready' && Boolean(runtimeThumbnail.objectUrl);
}

function hasCanvasImageRequestSource(
  node: CanvasRasterImageNode,
  readyRuntimeThumbnail = hasReadyRuntimeThumbnail(node),
): boolean {
  if (readyRuntimeThumbnail) {
    return true;
  }

  if (getFileNodeImageThumbnailUrl(node.data)) {
    return true;
  }

  const state = imageManager.getState(node.id, 'canvas');
  return Boolean(state.requestUrl ?? state.src ?? state.preferredUrl);
}

export function shouldScheduleCanvasImageResource({
  node,
  priority,
  visibility,
  hasReadyRuntimeThumbnail: readyRuntimeThumbnail = hasReadyRuntimeThumbnail(node),
  hasCanvasRequestSource = hasCanvasImageRequestSource(node, readyRuntimeThumbnail),
}: ShouldScheduleCanvasImageResourceOptions): boolean {
  if (!isCanvasImageResourceOwnerEligible(node)) {
    return false;
  }

  if (!hasCanvasRequestSource) {
    return false;
  }

  if (!priority.importing) {
    return true;
  }

  if (isPromotedImportingResource(priority)) {
    return true;
  }

  return Boolean(readyRuntimeThumbnail && visibility?.isVisible);
}

function isReadyItem(item: CanvasImageRasterItem): boolean {
  return item.status === 'ready';
}

function isLoadingItem(item: CanvasImageRasterItem): boolean {
  return item.status === 'loading';
}

function isUnavailableItem(item: CanvasImageRasterItem): boolean {
  return item.status === 'unavailable';
}

function shouldCommitReadyRasterItem(
  item: CanvasImageRasterItem,
  visibleNodes: VisibleNodeMap,
): boolean {
  const visibility = visibleNodes.get(item.nodeId);
  return item.status === 'ready' &&
    Boolean(item.src) &&
    Boolean(visibility?.isVisible || (visibility?.isNearViewport && !visibility.isImporting));
}

function hasCommittableReadyRasterItems(
  items: readonly CanvasImageRasterItem[],
  visibleNodes: VisibleNodeMap,
): boolean {
  return items.some((item) => shouldCommitReadyRasterItem(item, visibleNodes));
}

export function buildCanvasImageResourceSnapshot({
  renderPlan,
  lodRasterEligibleImageNodes,
  visibleNodes,
  activeImageNodeIdSet,
  runtimeRegistrationRevision: _runtimeRegistrationRevision,
  deferResourceRequests = false,
}: CanvasImageResourceControllerUpdate): CanvasImageResourceSnapshot {
  const rasterEligibleImageNodes = resolvePlannedImageNodes(renderPlan, lodRasterEligibleImageNodes);
  const items = buildCanvasRasterItemsFromBridge(
    rasterEligibleImageNodes,
    visibleNodes,
    activeImageNodeIdSet,
  );
  const resourceCandidates = deferResourceRequests
    ? []
    : rasterEligibleImageNodes
      .reduce<CanvasRasterResourceCandidate[]>((candidates, node) => {
        const visibility = visibleNodes.get(node.id);
        const priority = resolveCanvasImageResourcePriority({
          node,
          visibility,
          activeImageNodeIdSet,
        });

        if (!shouldScheduleCanvasImageResource({ node, priority, visibility })) {
          return candidates;
        }

        candidates.push({
          node,
          active: priority.active,
          importing: priority.importing,
          priorityRank: priority.rank,
          priorityScore: priority.score,
          resourceSignature: buildRasterResourceSignature(node),
        });
        return candidates;
      }, []);

  return {
    items,
    resourceCandidates,
  };
}

export function buildCanvasImageResourceMetricContext(
  items: readonly CanvasImageRasterItem[],
  activeImageNodeIdSet: ReadonlySet<string>,
): CanvasImageResourceControllerMetricContext {
  return {
    itemCount: items.length,
    activeImageNodeCount: activeImageNodeIdSet.size,
    readyItemCount: items.filter(isReadyItem).length,
    loadingItemCount: items.filter(isLoadingItem).length,
    unavailableItemCount: items.filter(isUnavailableItem).length,
  };
}

function buildResourceCandidatesSignature(
  candidates: readonly CanvasRasterResourceCandidate[],
): string {
  return candidates
    .map((candidate) => [
      candidate.node.id,
      candidate.resourceSignature,
      candidate.active ? 'active' : 'passive',
      candidate.importing ? 'importing' : 'stable',
      candidate.priorityRank ?? '',
      Math.round((candidate.priorityScore ?? 0) * 10),
    ].join(':'))
    .join('|');
}

export class CanvasImageResourceController {
  private readonly scheduler: CanvasRasterResourceScheduler;
  private readonly readyStore: CanvasRasterReadyStore;
  private readonly scheduleReadySnapshotFrame: NonNullable<CanvasRasterResourceSchedulerOptions['scheduleFrame']>;
  private readonly cancelReadySnapshotFrame: NonNullable<CanvasRasterResourceSchedulerOptions['cancelFrame']>;
  private latestUpdate: CanvasImageResourceControllerUpdate | null = null;
  private disposed = false;
  private readySnapshotFrameId: number | null = null;
  private lastResourceCandidatesSignature = '';

  private upsertReadyItems(items: readonly CanvasImageRasterItem[]): void {
    this.readyStore.upsert(items, {
      retainPreviousReady: true,
    });
  }

  constructor(options: CanvasImageResourceControllerOptions = {}) {
    this.readyStore = options.readyStore ?? canvasRasterReadyStore;
    this.scheduleReadySnapshotFrame = options.scheduleFrame ?? defaultScheduleReadySnapshotFrame;
    this.cancelReadySnapshotFrame = options.cancelFrame ?? defaultCancelReadySnapshotFrame;
    const requestNode = options.requestNode ?? requestCanvasRasterBridgeResource;
    this.scheduler = createCanvasRasterResourceScheduler({
      registerNodes: options.registerNodes ?? registerCanvasRasterBridgeNodes,
      requestNode: (nodeId) => Promise.resolve()
        .then(() => requestNode(nodeId))
        .finally(() => {
          this.scheduleReadySnapshotCommit();
        }),
      cancelNodeRequest: options.cancelNodeRequest ?? cancelCanvasRasterBridgeResourceRequest,
      scheduleFrame: options.scheduleFrame,
      cancelFrame: options.cancelFrame,
      passiveBatchSize: options.passiveBatchSize,
      importingBatchSize: options.importingBatchSize,
      passiveMaxConcurrentRequests: options.passiveMaxConcurrentRequests,
      importingMaxConcurrentRequests: options.importingMaxConcurrentRequests,
      onBatch: (metric) => {
        options.onBatch?.(metric);
      },
    });
  }

  update(update: CanvasImageResourceControllerUpdate): CanvasImageResourceSnapshot {
    this.disposed = false;
    this.latestUpdate = update;
    const snapshot = buildCanvasImageResourceSnapshot(update);
    const resourceCandidatesSignature = buildResourceCandidatesSignature(snapshot.resourceCandidates);
    if (resourceCandidatesSignature !== this.lastResourceCandidatesSignature) {
      this.lastResourceCandidatesSignature = resourceCandidatesSignature;
      recordCanvasTraceEvent({
        type: 'resource.batch',
        phase: 'instant',
        data: {
          itemCount: snapshot.items.length,
          candidateCount: snapshot.resourceCandidates.length,
          activeImageNodeCount: update.activeImageNodeIdSet.size,
          deferResourceRequests: Boolean(update.deferResourceRequests),
        },
      });
      this.scheduler.update(snapshot.resourceCandidates);
    }
    if (hasCommittableReadyRasterItems(snapshot.items, update.visibleNodes)) {
      this.scheduleReadySnapshotCommit();
    }
    return snapshot;
  }

  commitReadySnapshotFromUpdate(update: CanvasImageResourceControllerUpdate): void {
    if (this.disposed) {
      return;
    }

    const snapshot = buildCanvasImageResourceSnapshot({
      ...update,
      deferResourceRequests: true,
    });
    if (!hasCommittableReadyRasterItems(snapshot.items, update.visibleNodes)) {
      return;
    }

    this.latestUpdate = update;
    this.scheduleReadySnapshotCommit();
  }

  pauseRequests(): void {
    this.scheduler.pauseRequests();
  }

  resumeRequests(): void {
    this.scheduler.resumeRequests();
  }

  cancelAll(): void {
    this.scheduler.cancelAll();
    this.latestUpdate = null;
    this.lastResourceCandidatesSignature = '';
    this.cancelReadySnapshotCommit();
  }

  dispose(): void {
    this.disposed = true;
    this.latestUpdate = null;
    this.lastResourceCandidatesSignature = '';
    this.cancelReadySnapshotCommit();
    this.scheduler.dispose();
    this.readyStore.clear();
  }

  private scheduleReadySnapshotCommit(): void {
    if (this.disposed || !this.latestUpdate || this.readySnapshotFrameId !== null) {
      return;
    }

    this.readySnapshotFrameId = this.scheduleReadySnapshotFrame(() => {
      this.readySnapshotFrameId = null;
      this.commitReadySnapshot();
    });
  }

  private cancelReadySnapshotCommit(): void {
    if (this.readySnapshotFrameId === null) {
      return;
    }

    this.cancelReadySnapshotFrame(this.readySnapshotFrameId);
    this.readySnapshotFrameId = null;
  }

  private commitReadySnapshot(): void {
    if (this.disposed || !this.latestUpdate) {
      return;
    }

    const rasterEligibleImageNodes = resolvePlannedImageNodes(
      this.latestUpdate.renderPlan,
      this.latestUpdate.lodRasterEligibleImageNodes,
    );
    const resourceSnapshots = new Map<string, CanvasImageRasterResourceSnapshot>();
    rasterEligibleImageNodes.forEach((node) => {
      const state = imageManager.getState(node.id, 'canvas');
      resourceSnapshots.set(node.id, {
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
      });
    });
    const items = buildCanvasRasterItemsFromBridge(
      rasterEligibleImageNodes,
      this.latestUpdate.visibleNodes,
      this.latestUpdate.activeImageNodeIdSet,
      resourceSnapshots,
    );
    const committableItems = items.filter((item) => (
      shouldCommitReadyRasterItem(item, this.latestUpdate!.visibleNodes)
    ));
    if (committableItems.length > 0) {
      this.upsertReadyItems(committableItems);
    }
  }
}

export function createCanvasImageResourceController(
  options: CanvasImageResourceControllerOptions = {},
): CanvasImageResourceController {
  return new CanvasImageResourceController(options);
}

export function recordCanvasImageResourceControllerBatch(
  metric: CanvasRasterResourceSchedulerMetric,
  context: CanvasImageResourceControllerMetricContext,
): void {
  if (!getCanvasImageDiagnosticsConfig().enabled) {
    return;
  }

  recordCanvasRasterMetric({
    reason: 'resources-requested',
    candidateNodeCount: metric.candidateNodeCount,
    itemCount: context.itemCount,
    registeredNodeCount: metric.registeredNodeCount,
    requestedNodeCount: metric.requestedNodeCount,
    activeImageNodeCount: context.activeImageNodeCount,
    readyItemCount: context.readyItemCount,
    loadingItemCount: context.loadingItemCount,
    unavailableItemCount: context.unavailableItemCount,
    durationMs: metric.durationMs,
  });
  recordCanvasTraceEvent({
    type: 'resource.batch',
    phase: 'end',
    durationMs: metric.durationMs,
      data: {
        candidateNodeCount: metric.candidateNodeCount,
        registeredNodeCount: metric.registeredNodeCount,
        requestedNodeCount: metric.requestedNodeCount,
        cancelledNodeCount: metric.cancelledNodeCount,
        candidateRemovedNodeCount: metric.candidateRemovedNodeCount,
        signatureChangedNodeCount: metric.signatureChangedNodeCount,
        reprioritizedNodeCount: metric.reprioritizedNodeCount,
        skippedReadyNodeCount: metric.skippedReadyNodeCount,
        itemCount: context.itemCount,
      readyItemCount: context.readyItemCount,
      loadingItemCount: context.loadingItemCount,
      unavailableItemCount: context.unavailableItemCount,
    },
  });
}
