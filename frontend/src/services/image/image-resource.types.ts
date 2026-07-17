import type { ImageAsset, ImageAssetVariant, ImageAssetVariantKind, NodeRenderTier } from '../../types/node.types';
import type { LoadedImageResource } from './image-loader';

export interface ResolvedImageVariant {
  kind: ImageAssetVariantKind;
  url: string;
  fromLegacy: boolean;
  asset?: ImageAssetVariant;
}

export interface ResolvedFileNodeImageAsset {
  asset: ImageAsset;
  thumbnail?: ResolvedImageVariant;
  original?: ResolvedImageVariant;
  preferred?: ResolvedImageVariant;
}

export interface ImageCanvasSelection {
  variant?: ResolvedImageVariant;
  preferred?: ResolvedImageVariant;
}

export type ImageCanvasResourcePolicy = 'thumbnail-only';
export type ImageResourceRole = 'canvas-thumbnail' | 'viewer-original';
export type ImageResourceStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ImageResourceReadyPhase = 'thumbnail-ready' | 'original-ready';
export type ImageResourcePhase = 'idle' | 'loading' | ImageResourceReadyPhase | 'error';
export type ImageResourcePlaceholder = 'hidden' | 'loading' | 'unavailable' | 'ready';
export type ImageResourceMode = 'canvas' | 'original';
export type ImageResourceRetryTrigger = 'visibility-enter' | 'near-viewport-enter' | 'display-change' | 'manual';
export type ImageVisibilityBucket = 'visible' | 'near' | 'far' | 'offscreen';
export type ImageVisibilityScoreBucket = 'cancel' | 'defer' | 'recover' | 'ready' | 'priority' | 'import-priority';
export type ImageVisibilityAreaBucket = 'none' | 'cancel' | 'defer' | 'ready';
export interface SerializableImageVisibilityState {
  isVisible: boolean;
  isNearViewport: boolean;
  displayWidth: number;
  displayHeight: number;
  visibilityBucket: ImageVisibilityBucket;
  visibilityScoreBucket: ImageVisibilityScoreBucket;
  visibilityAreaBucket: ImageVisibilityAreaBucket;
  visibleAreaRatio: number;
  viewportZoom: number;
  visibilityScore: number;
  centerDistance: number;
  isSelected: boolean;
  isRecentlyInteracted: boolean;
  isImporting: boolean;
  renderTier: NodeRenderTier;
}
export type ImageResourceEventKind =
  | 'register'
  | 'request-queued'
  | 'request-started'
  | 'load-succeeded'
  | 'load-failed'
  | 'release'
  | 'visibility-updated'
  | 'cooldown-released'
  | 'retry-scheduled';
export type ImageResourceEventClassification = 'current' | 'stale';
export type ImageResourceSwitchReason =
  | 'initial-register'
  | 'asset-changed'
  | 'source-changed'
  | 'state-reused'
  | 'release-reset'
  | 'ensure-state'
  | 'no-source';

export interface ImageViewerSelection {
  variant?: ResolvedImageVariant;
  requestedKind: ImageAssetVariantKind;
  requested?: ResolvedImageVariant;
}

export interface ImageVisibilityState {
  isVisible: boolean;
  isNearViewport: boolean;
  displayWidth: number;
  displayHeight: number;
  visibilityBucket?: ImageVisibilityBucket;
  visibilityScoreBucket?: ImageVisibilityScoreBucket;
  visibilityAreaBucket?: ImageVisibilityAreaBucket;
  visibleAreaRatio?: number;
  viewportZoom?: number;
  visibilityScore?: number;
  centerDistance?: number;
  isSelected?: boolean;
  isRecentlyInteracted?: boolean;
  isImporting?: boolean;
  renderTier?: NodeRenderTier;
}

export interface ImageResourceAutoRequestInput {
  mode: ImageResourceMode;
  src?: string;
  requestUrl?: string;
  status: ImageResourceStatus;
  visibility: Pick<ImageVisibilityState, 'isVisible' | 'isNearViewport'>;
}

export interface ImageResourcePlaceholderInput {
  status: ImageResourceStatus;
  visibility: Pick<ImageVisibilityState, 'isVisible' | 'isNearViewport'>;
  hasDisplaySource?: boolean;
}

export interface ResolveImageResourcePhaseInput {
  mode: ImageResourceMode;
  status: ImageResourceStatus;
  src?: string;
  activeVariantKind?: ImageAssetVariantKind;
  cooldownUntil?: number;
  loadedAt?: number;
  hasDecodedResource?: boolean;
}

const READY_PHASE_BY_VARIANT: Record<ImageAssetVariantKind, ImageResourceReadyPhase> = {
  thumbnail: 'thumbnail-ready',
  original: 'original-ready',
};

export function resolveImageResourcePhase(input: ResolveImageResourcePhaseInput): ImageResourcePhase {
  if (input.status === 'error') {
    return 'error';
  }

  const hasDisplayResource = Boolean(
    input.src &&
    (
      input.status === 'ready' ||
      typeof input.loadedAt === 'number' ||
      input.hasDecodedResource
    )
  );

  if (hasDisplayResource) {
    if (input.activeVariantKind) {
      return READY_PHASE_BY_VARIANT[input.activeVariantKind];
    }

    return input.mode === 'original' ? 'original-ready' : 'thumbnail-ready';
  }

  if (input.status === 'loading') {
    return 'loading';
  }

  return 'idle';
}

export function isImageResourceDisplayReadyPhase(
  phase: ImageResourcePhase | undefined,
  status?: ImageResourceStatus
): boolean {
  if (!phase) {
    return status === 'ready';
  }

  return phase === 'thumbnail-ready' || phase === 'original-ready';
}

export function shouldAutoRequestImageResource(input: ImageResourceAutoRequestInput): boolean {
  if (input.mode === 'original') {
    return false;
  }

  if (!input.src && !input.requestUrl) {
    return false;
  }

  if (!input.visibility.isVisible && !input.visibility.isNearViewport) {
    return false;
  }

  if (input.requestUrl && input.src && input.requestUrl !== input.src) {
    return true;
  }

  return input.status === 'idle';
}

export function resolveImageResourcePlaceholder(
  input: ImageResourcePlaceholderInput
): ImageResourcePlaceholder {
  if (!input.visibility.isVisible && !input.visibility.isNearViewport) {
    return 'hidden';
  }

  if (input.status === 'loading' && !input.hasDisplaySource) {
    return 'loading';
  }

  if (input.status === 'error') {
    return 'unavailable';
  }

  return 'ready';
}

export interface ImageResourceState {
  nodeId: string;
  mode: ImageResourceMode;
  resourcePolicy: ImageCanvasResourcePolicy;
  resourceRole: ImageResourceRole;
  src?: string;
  status: ImageResourceStatus;
  phase: ImageResourcePhase;
  error?: string;
  requestedAt?: number;
  loadedAt?: number;
  activeVariantKind?: ImageAssetVariantKind;
  decodedResource?: LoadedImageResource;
  requestKey?: string;
  requestUrl?: string;
  preferredUrl?: string;
  lastEventKind?: ImageResourceEventKind;
  lastEventAt?: number;
  lastEventClassification?: ImageResourceEventClassification;
  lastAttemptedUrl?: string;
  lastEventReason?: string;
  lastSwitchReason?: ImageResourceSwitchReason;
  lastRetryAt?: number;
  retryCount?: number;
  cooldownUntil?: number;
  retryTrigger?: ImageResourceRetryTrigger;
  visibility: ImageVisibilityState;
}

export interface ImageVisibilityReconcileEntry {
  nodeId: string;
  mode: ImageResourceMode;
  stateKey: string;
  previous: ImageVisibilityState;
  next: ImageVisibilityState;
}

export interface ImageResourceViewerState {
  activeVariantKind?: ImageAssetVariantKind;
  resourcePolicy: ImageCanvasResourcePolicy;
  resourceRole: ImageResourceRole;
}

export interface ImageResourceDecodedState {
  kind?: LoadedImageResource['decoded'];
  width: number;
  height: number;
  estimatedBytes: number;
}

export interface ImageResourceDebugState {
  resourcePolicy: ImageCanvasResourcePolicy;
  resourceRole: ImageResourceRole;
  requestKey?: string;
  preferredUrl?: string;
  fileResourceDiagnostics?: unknown;
  lastEventKind?: ImageResourceEventKind;
  lastEventAt?: number;
  lastEventClassification?: ImageResourceEventClassification;
  lastAttemptedUrl?: string;
  lastEventReason?: string;
  lastSwitchReason?: ImageResourceSwitchReason;
  retryCount?: number;
  cooldownUntil?: number;
  retryTrigger?: ImageResourceRetryTrigger;
}

export interface ImageResourceReadModel {
  src?: string;
  status: ImageResourceStatus;
  phase: ImageResourcePhase;
  error?: string;
  isVisible: boolean;
  isNearViewport: boolean;
  displayWidth: number;
  displayHeight: number;
  placeholder: ImageResourcePlaceholder;
  shouldAutoRequest: boolean;
  viewer: ImageResourceViewerState;
  decoded: ImageResourceDecodedState;
  debug: ImageResourceDebugState;
}

export function createImageResourceReadModel(state: ImageResourceState): ImageResourceReadModel {
  return {
    src: state.src,
    status: state.status,
    phase: state.phase,
    error: state.error,
    isVisible: state.visibility.isVisible,
    isNearViewport: state.visibility.isNearViewport,
    displayWidth: state.visibility.displayWidth,
    displayHeight: state.visibility.displayHeight,
    placeholder: resolveImageResourcePlaceholder({
      status: state.status,
      visibility: state.visibility,
      hasDisplaySource: Boolean(state.src),
    }),
    shouldAutoRequest: shouldAutoRequestImageResource({
      mode: state.mode,
      src: state.src,
      requestUrl: state.requestUrl,
      status: state.status,
      visibility: state.visibility,
    }),
    viewer: {
      activeVariantKind: state.activeVariantKind,
      resourcePolicy: state.resourcePolicy,
      resourceRole: state.resourceRole,
    },
    decoded: {
      kind: state.decodedResource?.decoded,
      width: state.decodedResource?.width ?? 0,
      height: state.decodedResource?.height ?? 0,
      estimatedBytes: state.decodedResource?.estimatedBytes ?? 0,
    },
    debug: {
      resourcePolicy: state.resourcePolicy,
      resourceRole: state.resourceRole,
      requestKey: state.requestKey,
      preferredUrl: state.preferredUrl,
      lastEventKind: state.lastEventKind,
      lastEventAt: state.lastEventAt,
      lastEventClassification: state.lastEventClassification,
      lastAttemptedUrl: state.lastAttemptedUrl,
      lastEventReason: state.lastEventReason,
      lastSwitchReason: state.lastSwitchReason,
      retryCount: state.retryCount,
      cooldownUntil: state.cooldownUntil,
      retryTrigger: state.retryTrigger,
    },
  };
}

export interface ImageResourceRequest {
  nodeId: string;
  resolvedAsset: ResolvedFileNodeImageAsset;
  mode?: ImageResourceMode;
  preferredUrl?: string;
}

export interface ImageResourceFailureReport {
  requestKey?: string;
  attemptedUrl?: string;
  reason?: string;
  skipVisibilityFlush?: boolean;
}

function buildResolvedImageVariantSignature(variant?: ResolvedImageVariant): string {
  if (!variant) {
    return '';
  }

  return [
    variant.kind,
    variant.url,
    variant.fromLegacy ? 'legacy' : 'resolved',
    variant.asset?.width ?? '',
    variant.asset?.height ?? '',
    variant.asset?.mimeType ?? '',
    variant.asset?.updatedAt ?? '',
  ].join(':');
}

export function getResolvedImageAssetSignature(asset: ResolvedFileNodeImageAsset): string {
  return [
    asset.asset.assetId ?? '',
    asset.asset.source,
    asset.asset.version,
    asset.asset.intrinsicSize?.width ?? '',
    asset.asset.intrinsicSize?.height ?? '',
    buildResolvedImageVariantSignature(asset.thumbnail),
    buildResolvedImageVariantSignature(asset.original),
    buildResolvedImageVariantSignature(asset.preferred),
  ].join('|');
}

export function createImageResourceRegistrationKey(input: ImageResourceRequest): string {
  return [
    input.nodeId,
    input.mode ?? 'canvas',
    input.preferredUrl ?? '',
    getResolvedImageAssetSignature(input.resolvedAsset),
  ].join('|');
}
