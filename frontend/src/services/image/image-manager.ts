import type {
  ImageCanvasResourcePolicy,
  ImageResourceReadModel,
  ImageResourceEventClassification,
  ImageResourceFailureReport,
  ImageResourceMode,
  ImageResourceRequest,
  ImageResourceRetryTrigger,
  ImageResourceState,
  ImageResourceSwitchReason,
  ImageVisibilityReconcileEntry,
  ImageVisibilityState,
  ImageResourceRole,
  ResolvedFileNodeImageAsset,
} from './image-resource.types';
import {
  createImageResourceReadModel,
  getResolvedImageAssetSignature,
  resolveImageResourcePhase,
} from './image-resource.types';
import { ImageCache, type ImageCacheEviction, type ImageCacheEvictionMode, type ImageCacheSnapshot, type ImageCacheTier } from './image-cache';
import {
  loadImageResource,
  resolveCanvasLoadStrategy,
  type ImageLoadStrategy,
  type ImageResourceLoadOptions,
  type LoadedImageResource,
} from './image-loader';
import {
  resolveImageCacheBudget,
  type ImageCacheBudgetContext,
  type ImageCacheBudgetProfile,
} from './image-cache-budget';
import { isProtectedResourceUrl } from '@/services/protected-resource';
import type { ImageCachePolicy } from './image-cache';
import { getImageVariantUrls } from './image-asset';
import { createImageVisibilityBatcher, type ImageVisibilityBatcher } from './image-visibility-batcher';
import {
  recordCanvasImageManagerEmit,
  recordCanvasTraceEvent,
} from '@/utils/performance';

type Listener = () => void;

interface ImageManagerOptions {
  loadImageResource?: (url: string, strategy?: ImageLoadStrategy, options?: ImageResourceLoadOptions) => Promise<LoadedImageResource>;
  now?: () => number;
  cache?: ImageCache;
  createObjectUrl?: (file: File) => string;
  revokeObjectUrl?: (url: string) => void;
  canvasLoadStrategy?: ImageLoadStrategy;
  enableCanvasDisplayUrlLoading?: boolean;
  enableVisibilityScoring?: boolean;
  canvasResourcePolicy?: ImageCanvasResourcePolicy;
  scheduleMicrotaskImpl?: (callback: () => void) => void;
  scheduleNotificationImpl?: (callback: () => void) => number | void;
  cancelNotificationImpl?: (handle: number) => void;
}

interface ImageManagerFeatureFlags {
  canvasDisplayUrlLoading: boolean;
  visibilityScoring: boolean;
  canvasResourcePolicy: ImageCanvasResourcePolicy;
}

interface InflightRequestEntry {
  requestKey: string;
  src: string;
  promise: Promise<void>;
}

interface FailedResourceEntry {
  attempts: number;
  lastFailedAt: number;
  cooldownUntil: number;
}

type ImageResourceStateDraft = Omit<ImageResourceState, 'phase' | 'resourcePolicy' | 'resourceRole'> & {
  resourcePolicy?: ImageCanvasResourcePolicy;
  resourceRole?: ImageResourceRole;
};

export interface ImageManagerDebugSnapshot {
  features: ImageManagerFeatureFlags;
  cache: ImageCacheSnapshot;
  cacheBudget?: {
    profile: ImageCacheBudgetProfile;
    context: ImageCacheBudgetContext;
  };
  states: ImageResourceState[];
  trackedAssets: number;
  failedUrlGroups: number;
  subscriptions: {
    total: number;
    canvas: number;
    original: number;
    nodesWithSubscribers: number;
  };
  inflightRequests: Array<{
    key: string;
    requestKey?: string;
    src?: string;
  }>;
  objectUrls: Array<{
    nodeId: string;
    url: string;
  }>;
  decodedResources: Array<{
    key: string;
    nodeId: string;
    mode: ImageResourceMode;
    src: string;
    decoded: LoadedImageResource['decoded'];
    estimatedBytes: number;
  }>;
}

const DEFAULT_VISIBILITY: ImageVisibilityState = {
  isVisible: true,
  isNearViewport: true,
  displayWidth: 0,
  displayHeight: 0,
  centerDistance: Number.POSITIVE_INFINITY,
  isSelected: false,
  isRecentlyInteracted: false,
  isImporting: false,
};

const FAILURE_COOLDOWN_MS = 3_000;
const FAILURE_MAX_RETRY_ATTEMPTS = 3;
const FAILURE_RETRY_RESET_MS = 15_000;
const CACHE_POLICY_AFTER_READY_DELAY_MS = 120;
const VISIBILITY_SIZE_BUCKET_PX = 16;
const VISIBILITY_ZOOM_BUCKET = 0.025;
const VISIBILITY_SCORE_BUCKET = 0.025;
const VISIBILITY_CENTER_BUCKET_PX = 64;
const CANVAS_DECODE_TARGET_SCALE = 2;
const CANVAS_DECODE_MIN_EDGE_PX = 256;
const CANVAS_DECODE_MAX_EDGE_PX = 2048;

export function resolveRenderableImageSrc(
  state: Pick<ImageResourceState, 'src' | 'decodedResource'>
): string | undefined {
  const decodedSrc = state.decodedResource?.src;
  if (decodedSrc) {
    return decodedSrc;
  }

  const rawSrc = state.src;
  if (!rawSrc || isProtectedResourceUrl(rawSrc)) {
    return undefined;
  }

  return rawSrc;
}

function isVisibilityScoringEnabled(envValue: string | undefined = import.meta.env?.VITE_IMAGE_VISIBILITY_SCORING): boolean {
  return envValue !== 'false';
}

function resolveImageResourceRole(mode: ImageResourceMode): ImageResourceRole {
  return mode === 'original'
    ? 'viewer-original'
    : 'canvas-thumbnail';
}

export class ImageManager {
  private readonly states = new Map<string, ImageResourceState>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly inflight = new Map<string, InflightRequestEntry>();
  private readonly assets = new Map<string, ResolvedFileNodeImageAsset>();
  private readonly objectUrls = new Map<string, string>();
  private readonly decodedResources = new Map<string, LoadedImageResource>();
  private readonly failedUrls = new Map<string, Map<string, FailedResourceEntry>>();
  private readonly failureHistory = new Map<string, Map<string, FailedResourceEntry>>();
  private readonly assetSignatures = new Map<string, string>();
  private readonly emptyStates = new Map<string, ImageResourceState>();
  private readonly preferredUrls = new Map<string, string | undefined>();
  private readonly requestSequence = new Map<string, number>();
  private readonly loadImageResourceImpl: (
    url: string,
    strategy?: ImageLoadStrategy,
    options?: ImageResourceLoadOptions,
  ) => Promise<LoadedImageResource>;
  private readonly now: () => number;
  private readonly cache: ImageCache;
  private readonly baseCachePolicy: ImageCachePolicy;
  private readonly createObjectUrlImpl: (file: File) => string;
  private readonly revokeObjectUrlImpl: (url: string) => void;
  private readonly canvasLoadStrategyOverride?: ImageLoadStrategy;
  private readonly features: ImageManagerFeatureFlags;
  private readonly visibilityBatcher: ImageVisibilityBatcher;
  private readonly scheduleNotificationImpl: (callback: () => void) => number | void;
  private readonly cancelNotificationImpl?: (handle: number) => void;
  private pendingNotificationKeys = new Set<string>();
  private notificationScheduled = false;
  private notificationScheduleToken = 0;
  private notificationHandle: number | undefined;
  private cacheBudgetContext: ImageCacheBudgetContext = {
    imageNodeCount: 0,
  };
  private cacheBudgetProfile?: ImageCacheBudgetProfile;
  private isApplyingCachePolicy = false;
  private isVisibilityUpdatesPaused = false;
  private cachePolicyTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(options: ImageManagerOptions = {}) {
    this.loadImageResourceImpl = options.loadImageResource ?? loadImageResource;
    this.now = options.now ?? Date.now;
    this.cache = options.cache ?? new ImageCache({}, this.now);
    this.baseCachePolicy = this.cache.getPolicy();
    this.createObjectUrlImpl = options.createObjectUrl ?? ((file): string => URL.createObjectURL(file));
    this.revokeObjectUrlImpl = options.revokeObjectUrl ?? ((url): void => URL.revokeObjectURL(url));
    this.canvasLoadStrategyOverride = options.canvasLoadStrategy;
    this.scheduleNotificationImpl = options.scheduleNotificationImpl ?? (
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback): void => queueMicrotask(callback)
    );
    this.cancelNotificationImpl = options.cancelNotificationImpl ?? (
      typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : undefined
    );
    this.features = {
      canvasDisplayUrlLoading: resolveCanvasLoadStrategy(
        options.canvasLoadStrategy,
        {
          displayUrlEnabled: options.enableCanvasDisplayUrlLoading,
        }
      ) === 'display-url',
      visibilityScoring: typeof options.enableVisibilityScoring === 'boolean'
        ? options.enableVisibilityScoring
        : isVisibilityScoringEnabled(),
      canvasResourcePolicy: options.canvasResourcePolicy ?? 'thumbnail-only',
    };
    this.visibilityBatcher = createImageVisibilityBatcher({
      onFlush: (entries) => {
        this.reconcileVisibilityUpdates(entries);
      },
      scheduleMicrotaskImpl: options.scheduleMicrotaskImpl,
    });
  }

  register(request: ImageResourceRequest): void {
    const mode = request.mode ?? 'canvas';
    const signature = getResolvedImageAssetSignature(request.resolvedAsset);
    const stateKey = this.getStateKey(request.nodeId, mode);
    const previousSignature = this.assetSignatures.get(stateKey);
    const assetChanged = previousSignature !== signature;
    const previousPreferredUrl = this.preferredUrls.get(stateKey);
    const preferredUrlChanged = previousPreferredUrl !== request.preferredUrl;

    this.assets.set(stateKey, request.resolvedAsset);
    this.assetSignatures.set(stateKey, signature);
    this.preferredUrls.set(stateKey, request.preferredUrl);

    if (assetChanged) {
      this.failedUrls.delete(stateKey);
      this.failureHistory.delete(stateKey);
    }

    const current = this.states.get(stateKey);
    const nextRequestUrl = this.resolveNextUrl(
      request.nodeId,
      mode,
      current?.src,
      request.preferredUrl,
      preferredUrlChanged
    );
    const shouldRetainCurrentDisplaySource = this.shouldRetainCurrentDisplaySourceDuringSourceSwitch(
      current,
      nextRequestUrl,
      mode,
      assetChanged,
    );
    const nextSrc = shouldRetainCurrentDisplaySource
      ? current?.src
      : nextRequestUrl;
    const nextActiveVariantKind = this.resolveVariantKind(request.resolvedAsset, nextSrc);
    const isStateReusable = Boolean(
      !assetChanged &&
      current?.src === nextSrc &&
      current?.requestUrl === nextRequestUrl
    );
    const nextSwitchReason = this.resolveRegisterSwitchReason(current, {
      assetChanged,
      preferredUrlChanged,
      nextSrc: nextRequestUrl,
    });
    const shouldInvalidateCurrentRequest = assetChanged || (
      preferredUrlChanged &&
      current?.requestUrl !== nextRequestUrl
    );
    const nextStatus = shouldRetainCurrentDisplaySource
      ? 'ready'
      : this.resolveNextStatus(
        current,
        nextSrc,
        nextRequestUrl,
        shouldInvalidateCurrentRequest
      );
    const nextError = nextSrc
      ? (isStateReusable ? current?.error : undefined)
      : 'No image source available';
    const nextRequestedAt = isStateReusable ? current?.requestedAt : undefined;
    const nextLoadedAt = current?.src === nextSrc ? current?.loadedAt : undefined;
    const nextRequestKey = isStateReusable ? current?.requestKey : undefined;
    const nextLastAttemptedUrl = isStateReusable ? current?.lastAttemptedUrl : undefined;
    const nextRetryCount = isStateReusable ? current?.retryCount : undefined;
    const nextCooldownUntil = isStateReusable ? current?.cooldownUntil : undefined;
    const nextRetryTrigger = isStateReusable ? current?.retryTrigger : undefined;
    const isRegisterNoop = Boolean(
      current &&
      current.nodeId === request.nodeId &&
      current.mode === mode &&
      current.src === nextSrc &&
      current.requestUrl === nextRequestUrl &&
      current.status === nextStatus &&
      current.error === nextError &&
      current.requestedAt === nextRequestedAt &&
      current.loadedAt === nextLoadedAt &&
      current.requestKey === nextRequestKey &&
      current.preferredUrl === request.preferredUrl &&
      current.activeVariantKind === nextActiveVariantKind &&
      current.lastAttemptedUrl === nextLastAttemptedUrl &&
      current.retryCount === nextRetryCount &&
      current.cooldownUntil === nextCooldownUntil &&
      current.retryTrigger === nextRetryTrigger
    );

    if (isRegisterNoop) {
      return;
    }

    const nextState = this.buildState({
      nodeId: request.nodeId,
      mode,
      resourcePolicy: current?.resourcePolicy ?? this.features.canvasResourcePolicy,
      resourceRole: current?.resourceRole ?? resolveImageResourceRole(mode),
      src: nextSrc,
      requestUrl: nextRequestUrl,
      status: nextStatus,
      error: nextError,
      requestedAt: nextRequestedAt,
      loadedAt: nextLoadedAt,
      activeVariantKind: nextActiveVariantKind,
      requestKey: nextRequestKey,
      preferredUrl: request.preferredUrl,
      lastEventKind: 'register',
      lastEventAt: this.now(),
      lastEventClassification: 'current',
      lastAttemptedUrl: nextLastAttemptedUrl,
      lastEventReason: this.buildRegisterEventReason(request.nodeId, mode, request.preferredUrl),
      lastSwitchReason: nextSwitchReason,
      retryCount: nextRetryCount,
      cooldownUntil: nextCooldownUntil,
      retryTrigger: nextRetryTrigger,
      visibility: current?.visibility ?? DEFAULT_VISIBILITY,
    });

    if (this.areStatesEqual(current, nextState)) {
      return;
    }

    if (!this.shouldRetainDecodedResource(current, nextSrc, nextRequestUrl, assetChanged)) {
      this.releaseDecodedResourceByKey(stateKey);
      nextState.decodedResource = undefined;
    } else if (current?.decodedResource) {
      nextState.decodedResource = current.decodedResource;
    }

    this.states.set(stateKey, nextState);
    this.syncCacheEntry(nextState);
    this.emit(request.nodeId, mode);
    this.applyCachePolicy();
  }

  getState(nodeId: string, mode: ImageResourceMode = 'canvas'): ImageResourceState {
    const stateKey = this.getStateKey(nodeId, mode);
    const current = this.states.get(stateKey);
    if (current) {
      return current;
    }

    const cached = this.emptyStates.get(stateKey);
    if (cached) {
      return cached;
    }

    const emptyState = this.createBaseState(nodeId, mode);
    this.emptyStates.set(stateKey, emptyState);
    return emptyState;
  }

  getResourceView(nodeId: string, mode: ImageResourceMode = 'canvas'): ImageResourceReadModel {
    return createImageResourceReadModel(this.getState(nodeId, mode));
  }

  getRenderableSrc(nodeId: string, mode: ImageResourceMode = 'canvas'): string | undefined {
    return resolveRenderableImageSrc(this.getState(nodeId, mode));
  }

  createDetachedState(nodeId: string, mode: ImageResourceMode = 'canvas'): ImageResourceState {
    return this.createBaseState(nodeId, mode);
  }

  updateVisibility(nodeId: string, visibility: ImageVisibilityState): void {
    const stateKey = this.getStateKey(nodeId, 'canvas');
    const current = this.states.get(stateKey) ?? this.createBaseState(nodeId, 'canvas');
    const nextVisibility = this.normalizeVisibility(visibility);

    const hasChanged =
      current.visibility.isVisible !== nextVisibility.isVisible ||
      current.visibility.isNearViewport !== nextVisibility.isNearViewport ||
      current.visibility.displayWidth !== nextVisibility.displayWidth ||
      current.visibility.displayHeight !== nextVisibility.displayHeight ||
      current.visibility.visibleAreaRatio !== nextVisibility.visibleAreaRatio ||
      current.visibility.viewportZoom !== nextVisibility.viewportZoom ||
      current.visibility.visibilityScore !== nextVisibility.visibilityScore ||
      current.visibility.centerDistance !== nextVisibility.centerDistance ||
      current.visibility.isSelected !== nextVisibility.isSelected ||
      current.visibility.isRecentlyInteracted !== nextVisibility.isRecentlyInteracted ||
      current.visibility.isImporting !== nextVisibility.isImporting;

    if (!hasChanged) {
      return;
    }

    this.releaseCooldownIfEligible(nodeId, 'canvas', current, nextVisibility);
    const latest = this.states.get(stateKey) ?? current;
    const preserveRecoveryEvent = latest.lastEventKind === 'cooldown-released';
    const hasVisibilityLifecycleChange =
      latest.visibility.isVisible !== nextVisibility.isVisible ||
      latest.visibility.isNearViewport !== nextVisibility.isNearViewport;

    this.states.set(stateKey, this.buildState({
      ...latest,
      visibility: nextVisibility,
      lastEventKind: preserveRecoveryEvent || !hasVisibilityLifecycleChange ? latest.lastEventKind : 'visibility-updated',
      lastEventAt: preserveRecoveryEvent || !hasVisibilityLifecycleChange ? latest.lastEventAt : this.now(),
      lastEventClassification: preserveRecoveryEvent || !hasVisibilityLifecycleChange ? latest.lastEventClassification : 'current',
      lastEventReason: preserveRecoveryEvent
        ? latest.lastEventReason
        : !hasVisibilityLifecycleChange
          ? latest.lastEventReason
          : this.buildVisibilityEventReason(nextVisibility),
    }));
    this.visibilityBatcher.schedule({
      nodeId,
      mode: 'canvas',
      stateKey,
      previous: latest.visibility,
      next: nextVisibility,
    });
  }

  subscribe(nodeId: string, listener: Listener, mode: ImageResourceMode = 'canvas'): () => void {
    const stateKey = this.getStateKey(nodeId, mode);
    const bucket = this.listeners.get(stateKey) ?? new Set<Listener>();
    bucket.add(listener);
    this.listeners.set(stateKey, bucket);

    return (): void => {
      const current = this.listeners.get(stateKey);
      if (!current) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(stateKey);
      }
    };
  }

  pauseCanvasVisibilityUpdates(): void {
    this.isVisibilityUpdatesPaused = true;
    this.visibilityBatcher.pause();
  }

  resumeCanvasVisibilityUpdates(options: { flush?: boolean } = {}): void {
    this.isVisibilityUpdatesPaused = false;
    this.visibilityBatcher.resume();
    if (options.flush) {
      this.flushVisibilityUpdates();
    }
  }

  isCanvasVisibilityUpdatesPaused(): boolean {
    return this.isVisibilityUpdatesPaused;
  }

  flushNotifications(): boolean {
    return this.flushPendingNotifications();
  }

  request(nodeId: string, mode: ImageResourceMode = 'canvas'): Promise<void> {
    const stateKey = this.getStateKey(nodeId, mode);
    const current = this.ensureState(nodeId, mode);
    const requestUrl = current?.requestUrl ?? current?.src;
    recordCanvasTraceEvent({
      type: 'imageManager.request',
      phase: 'instant',
      data: {
        nodeId,
        mode,
        status: current?.status,
        hasRequestUrl: Boolean(requestUrl),
        isVisible: current?.visibility.isVisible,
        isNearViewport: current?.visibility.isNearViewport,
      },
    });
    if (!requestUrl) {
      this.states.set(stateKey, this.buildState({
        nodeId,
        mode,
        status: 'error',
        error: 'No image source available',
        requestUrl: undefined,
        preferredUrl: this.preferredUrls.get(stateKey),
        lastEventKind: 'request-started',
        lastEventAt: this.now(),
        lastEventClassification: 'current',
        lastEventReason: 'request skipped: no image source available',
        lastSwitchReason: 'no-source',
        visibility: this.normalizeVisibility(current?.visibility ?? DEFAULT_VISIBILITY),
      }));
      this.syncCacheEntry(this.states.get(stateKey));
      this.emit(nodeId, mode);
      return Promise.resolve();
    }

    if (!current) {
      return Promise.resolve();
    }

    if (mode === 'canvas' && !current.visibility.isVisible && !current.visibility.isNearViewport) {
      return Promise.resolve();
    }

    if (this.isUrlCoolingDown(this.failedUrls.get(stateKey)?.get(requestUrl))) {
      const nextState = this.buildState({
        ...current,
        status: 'error',
        error: current.error ?? 'Image resource is cooling down after a recent failure',
        requestUrl,
        lastEventKind: 'request-queued',
        lastEventAt: this.now(),
        lastEventClassification: 'current',
        lastAttemptedUrl: requestUrl,
        lastEventReason: this.buildCooldownSuppressedRequestReason(requestUrl),
      });

      if (!this.areStatesEqual(current, nextState)) {
        this.states.set(stateKey, nextState);
        this.syncCacheEntry(nextState);
        this.emit(nodeId, mode);
      }
      return Promise.resolve();
    }

    if (current.status === 'ready') {
      this.cache.recordHit();
      this.cache.touch(stateKey);
      if (current.src === requestUrl) {
        return Promise.resolve();
      }
    }

    const inflightRequest = this.inflight.get(stateKey);
    if (
      inflightRequest &&
      inflightRequest.src === requestUrl &&
      current.status === 'loading' &&
      current.requestKey === inflightRequest.requestKey
    ) {
      this.cache.recordHit();
      this.cache.touch(stateKey);
      return inflightRequest.promise;
    }

    const requestKey = this.createRequestKey(nodeId, mode, requestUrl);
    return this.executeRequest(nodeId, mode, current, requestUrl, requestKey);
  }

  cancelRequest(nodeId: string, mode: ImageResourceMode = 'canvas'): void {
    const stateKey = this.getStateKey(nodeId, mode);
    const current = this.states.get(stateKey);
    const inflightRequest = this.inflight.get(stateKey);
    recordCanvasTraceEvent({
      type: 'imageManager.cancel',
      phase: 'instant',
      data: {
        nodeId,
        mode,
        hasCurrent: Boolean(current),
        hasInflight: Boolean(inflightRequest),
      },
    });
    if (!current) {
      if (inflightRequest) {
        this.inflight.delete(stateKey);
      }
      return;
    }

    if (!current?.requestKey && !inflightRequest) {
      return;
    }

    if (inflightRequest) {
      this.inflight.delete(stateKey);
    }

    const nextState = this.buildState({
      ...current,
      status: current.requestUrl ? 'idle' : current.status,
      requestedAt: undefined,
      requestKey: undefined,
      lastEventKind: 'request-queued',
      lastEventAt: this.now(),
      lastEventClassification: 'stale',
      lastAttemptedUrl: current.lastAttemptedUrl ?? inflightRequest?.src,
      lastEventReason: this.buildRequestCancelledReason(inflightRequest?.requestKey ?? current.requestKey),
    });

    if (this.areStatesEqual(current, nextState)) {
      return;
    }

    this.states.set(stateKey, nextState);
    this.syncCacheEntry(nextState);
    this.emit(nodeId, mode);
  }

  reportLoadFailure(
    nodeId: string,
    error?: string,
    startedAt = Date.now(),
    mode: ImageResourceMode = 'canvas',
    report: ImageResourceFailureReport = {}
  ): void {
    const stateKey = this.getStateKey(nodeId, mode);
    const current = this.states.get(stateKey);
    if (!current?.src && !current?.requestUrl) {
      return;
    }

    const attemptedUrl = report.attemptedUrl ?? current.lastAttemptedUrl ?? current.requestUrl ?? current.src;
    if (!attemptedUrl) {
      return;
    }
    const eventClassification = this.classifyFailureEvent(
      current.requestKey,
      report.requestKey,
      current.requestUrl ?? current.src,
      attemptedUrl
    );
    if (eventClassification === 'stale') {
      this.recordFailedUrl(stateKey, attemptedUrl);

      const nextState = this.buildState({
        ...current,
        lastEventKind: 'load-failed',
        lastEventAt: this.now(),
        lastEventClassification: 'stale',
        lastAttemptedUrl: attemptedUrl,
        lastEventReason: this.buildStaleLoadEventReason(
          'failure',
          report.requestKey ?? current.requestKey ?? 'unknown-request',
          attemptedUrl,
          error ?? report.reason
        ),
      });

      if (!this.areStatesEqual(current, nextState)) {
        this.states.set(stateKey, nextState);
        this.emit(nodeId, mode);
      }
      return;
    }

    const failureEntry = this.recordFailedUrl(stateKey, attemptedUrl);

    const nextState = this.buildState({
      ...current,
      status: 'error',
      error: error ?? 'Failed to load image resource',
      requestedAt: current.requestedAt ?? startedAt,
      decodedResource: undefined,
      requestKey: undefined,
      requestUrl: current.requestUrl ?? current.src,
      activeVariantKind: this.resolveVariantKind(this.assets.get(stateKey), current.requestUrl ?? current.src),
      lastEventKind: 'load-failed',
      lastEventAt: this.now(),
      lastEventClassification: 'current',
      lastAttemptedUrl: attemptedUrl,
      lastEventReason: this.buildFailureEventReason(
        report.requestKey ?? current.requestKey,
        attemptedUrl,
        error
      ),
      retryCount: failureEntry.attempts,
      cooldownUntil: failureEntry.cooldownUntil,
      retryTrigger: undefined,
    });

    if (this.areStatesEqual(current, nextState)) {
      return;
    }

    this.releaseDecodedResourceByKey(stateKey);
    this.states.set(stateKey, nextState);
    this.syncCacheEntry(nextState);
    this.emit(nodeId, mode);
  }

  reportRenderableSourceFailure(
    nodeId: string,
    attemptedSrc: string,
    mode: ImageResourceMode = 'canvas',
    reason = 'Renderable image source failed'
  ): void {
    const stateKey = this.getStateKey(nodeId, mode);
    const current = this.states.get(stateKey);
    if (!current || !attemptedSrc) {
      return;
    }

    const failedUrls = new Set<string>([attemptedSrc]);
    const decodedResourceMatches = current.decodedResource?.src === attemptedSrc;
    if (current.src === attemptedSrc || current.requestUrl === attemptedSrc || current.preferredUrl === attemptedSrc) {
      if (current.src) {
        failedUrls.add(current.src);
      }
      if (current.requestUrl) {
        failedUrls.add(current.requestUrl);
      }
      if (current.preferredUrl) {
        failedUrls.add(current.preferredUrl);
      }
    }

    let latestFailure: FailedResourceEntry | undefined;
    failedUrls.forEach((url) => {
      latestFailure = this.recordFailedUrl(stateKey, url);
    });

    if (decodedResourceMatches) {
      this.releaseDecodedResourceByKey(stateKey);
    }

    const nextRequestUrl = this.resolveNextUrl(nodeId, mode, undefined, this.preferredUrls.get(stateKey), true);
    const shouldPreserveActiveRequest = Boolean(
      current.status === 'loading' &&
      current.requestKey &&
      current.requestUrl &&
      current.requestUrl === nextRequestUrl &&
      attemptedSrc !== current.requestUrl
    );
    const nextState = this.buildState({
      ...current,
      src: nextRequestUrl,
      requestUrl: nextRequestUrl,
      status: shouldPreserveActiveRequest ? 'loading' : nextRequestUrl ? 'idle' : 'error',
      error: nextRequestUrl ? undefined : reason,
      requestedAt: shouldPreserveActiveRequest ? current.requestedAt : undefined,
      loadedAt: undefined,
      requestKey: shouldPreserveActiveRequest ? current.requestKey : undefined,
      decodedResource: undefined,
      activeVariantKind: this.resolveVariantKind(this.assets.get(stateKey), nextRequestUrl),
      lastEventKind: 'load-failed',
      lastEventAt: this.now(),
      lastEventClassification: 'current',
      lastAttemptedUrl: attemptedSrc,
      lastEventReason: this.buildRenderableSourceFailureReason(attemptedSrc, reason, nextRequestUrl),
      lastSwitchReason: nextRequestUrl ? 'source-changed' : 'no-source',
      retryCount: latestFailure?.attempts ?? current.retryCount,
      cooldownUntil: latestFailure?.cooldownUntil ?? current.cooldownUntil,
      retryTrigger: undefined,
    });

    if (this.areStatesEqual(current, nextState)) {
      return;
    }

    this.states.set(stateKey, nextState);
    this.syncCacheEntry(nextState);
    this.emit(nodeId, mode);

    if (
      mode === 'canvas' &&
      nextState.status === 'idle' &&
      nextState.requestUrl &&
      (nextState.visibility.isVisible || nextState.visibility.isNearViewport)
    ) {
      void this.request(nodeId, mode);
    }
  }

  private executeRequest(
    nodeId: string,
    mode: ImageResourceMode,
    current: ImageResourceState,
    requestUrl: string,
    requestKey: string
  ): Promise<void> {
    this.cache.recordMiss();

    const startedAt = this.now();
    const requestedUrl = requestUrl;
    const stateKey = this.getStateKey(nodeId, mode);
    const loadingState = this.buildState({
      ...current,
      status: 'loading',
      error: undefined,
      requestedAt: startedAt,
      requestKey,
      requestUrl: requestedUrl,
      preferredUrl: this.preferredUrls.get(stateKey),
      lastEventKind: 'request-started',
      lastEventAt: startedAt,
      lastEventClassification: 'current',
      lastAttemptedUrl: requestedUrl,
      lastEventReason: this.buildRequestEventReason(requestKey, requestedUrl),
    });
    this.states.set(stateKey, loadingState);
    this.syncCacheEntry(loadingState);
    this.emit(nodeId, mode);

    const requestPromise = this.loadImageResourceImpl(
      requestedUrl,
      this.resolveLoadStrategy(mode),
      {
        preferPersistentCache: this.shouldPersistLoadedResource(stateKey, requestedUrl, mode),
        persistentVersion: this.resolvePersistentVersion(stateKey, requestedUrl),
        ...this.resolveLoadResizeOptions(mode, current),
      },
    )
      .then((resource) => {
        const latest = this.states.get(stateKey);
        if (!this.isActiveRequest(latest, requestKey, requestedUrl)) {
          this.releaseDecodedResource(stateKey, resource);
          if (latest) {
            this.states.set(stateKey, this.buildState({
              ...latest,
              lastEventKind: 'load-succeeded',
              lastEventAt: this.now(),
              lastEventClassification: 'stale',
              lastAttemptedUrl: requestedUrl,
              lastEventReason: this.buildStaleLoadEventReason('success', requestKey, requestedUrl),
            }));
            recordCanvasTraceEvent({
              type: 'imageManager.ready',
              phase: 'instant',
              data: {
                nodeId,
                mode,
                stale: true,
                decoded: resource.decoded,
              },
            });
            this.emit(nodeId, mode);
          }
          return;
        }
        if (!latest) {
          this.releaseDecodedResource(stateKey, resource);
          return;
        }

        this.storeDecodedResource(stateKey, resource);
        const nextSrc = latest.requestUrl ?? requestedUrl;
        this.states.set(stateKey, this.buildState({
          ...latest,
          src: nextSrc,
          status: 'ready',
          error: undefined,
          retryTrigger: undefined,
          loadedAt: this.now(),
          decodedResource: resource,
          requestKey,
          requestUrl: nextSrc,
          activeVariantKind: this.resolveVariantKind(this.assets.get(stateKey), nextSrc),
          lastEventKind: 'load-succeeded',
          lastEventAt: this.now(),
          lastEventClassification: 'current',
          lastAttemptedUrl: requestedUrl,
          lastEventReason: this.buildLoadSucceededReason(requestKey, requestedUrl),
        }));
        this.syncCacheEntry(this.states.get(stateKey));
        recordCanvasTraceEvent({
          type: 'imageManager.ready',
          phase: 'end',
          durationMs: this.now() - startedAt,
          data: {
            nodeId,
            mode,
            decoded: resource.decoded,
            estimatedBytes: resource.estimatedBytes,
          },
        });
        this.emit(nodeId, mode);
        this.scheduleCachePolicyAfterReady(mode);
      })
      .catch((error: unknown) => {
        const latest = this.states.get(stateKey);
        if (!this.isActiveRequest(latest, requestKey, requestedUrl)) {
          this.reportLoadFailure(
            nodeId,
            error instanceof Error ? error.message : 'Failed to load image resource',
            startedAt,
            mode,
            {
              requestKey,
              attemptedUrl: requestedUrl,
              reason: error instanceof Error ? error.message : undefined,
              skipVisibilityFlush: true,
            }
          );
          return;
        }

        this.reportLoadFailure(
          nodeId,
          error instanceof Error ? error.message : 'Failed to load image resource',
          startedAt,
          mode,
          {
            requestKey,
            attemptedUrl: requestedUrl,
            reason: error instanceof Error ? error.message : undefined,
            skipVisibilityFlush: true,
          }
        );
      })
      .finally(() => {
        const inflightEntry = this.inflight.get(stateKey);
        if (inflightEntry?.requestKey === requestKey) {
          this.inflight.delete(stateKey);
        }
        const latest = this.states.get(stateKey);
        const shouldContinueFallbackRequest = Boolean(
          latest?.status === 'idle' &&
          latest.requestUrl &&
          latest.requestUrl !== requestedUrl &&
          (
            mode === 'original' ||
            latest.visibility.isVisible ||
            latest.visibility.isNearViewport
          )
        );
        if (shouldContinueFallbackRequest) {
          void this.request(nodeId, mode);
        }
      });

    this.inflight.set(stateKey, {
      requestKey,
      src: requestedUrl,
      promise: requestPromise,
    });
    return requestPromise;
  }

  release(nodeId: string, mode: ImageResourceMode = 'canvas'): void {
    const stateKey = this.getStateKey(nodeId, mode);
    const current = this.states.get(stateKey);
    if (!current) {
      return;
    }

    const nextSrc = mode === 'canvas'
      ? this.resolveNextUrl(nodeId, mode)
      : undefined;

    const nextState = this.buildState({
      nodeId,
      mode,
      src: nextSrc,
      requestUrl: nextSrc,
      status: nextSrc ? 'idle' : 'error',
      error: nextSrc ? undefined : current.error,
      requestedAt: undefined,
      loadedAt: undefined,
      activeVariantKind: nextSrc ? this.resolveVariantKind(this.assets.get(stateKey), nextSrc) : undefined,
      decodedResource: undefined,
      requestKey: undefined,
      preferredUrl: this.preferredUrls.get(stateKey),
      retryCount: 0,
      cooldownUntil: undefined,
      retryTrigger: undefined,
      lastEventKind: 'release',
      lastEventAt: this.now(),
      lastEventClassification: 'current',
      lastAttemptedUrl: current.lastAttemptedUrl,
      lastEventReason: this.buildReleaseEventReason(mode, nextSrc),
      lastSwitchReason: 'release-reset',
      visibility: this.normalizeVisibility(current.visibility),
    });

    this.failedUrls.delete(stateKey);
    this.releaseDecodedResourceByKey(stateKey);

    if (mode === 'original' && !nextSrc) {
      this.states.delete(stateKey);
      this.cache.remove(stateKey);
      this.emit(nodeId, mode);
      return;
    }

    this.states.set(stateKey, nextState);
    this.syncCacheEntry(nextState);
    this.emit(nodeId, mode);
  }

  clear(nodeId: string): void {
    this.flushVisibilityUpdates();
    this.removePendingNotificationsForNode(nodeId);
    this.releaseObjectUrl(nodeId);
    (['canvas', 'original'] as const).forEach((mode) => {
      const stateKey = this.getStateKey(nodeId, mode);
      this.releaseDecodedResourceByKey(stateKey);
      this.assets.delete(stateKey);
      this.states.delete(stateKey);
      this.inflight.delete(stateKey);
      this.failedUrls.delete(stateKey);
      this.failureHistory.delete(stateKey);
      this.assetSignatures.delete(stateKey);
      this.emptyStates.delete(stateKey);
      this.preferredUrls.delete(stateKey);
      this.requestSequence.delete(stateKey);
      this.cache.remove(stateKey);
      this.emit(nodeId, mode);
    });
  }

  createObjectUrl(nodeId: string, file: File): string {
    const current = this.objectUrls.get(nodeId);
    if (current) {
      this.revokeObjectUrlImpl(current);
      this.cache.remove(this.getObjectUrlKey(nodeId));
      this.cache.recordRevocation();
    }

    const url = this.createObjectUrlImpl(file);
    this.objectUrls.set(nodeId, url);
    this.cache.upsert({
      key: this.getObjectUrlKey(nodeId),
      nodeId,
      kind: 'object-url',
      url,
      refCount: 1,
      isVisible: true,
      isNearViewport: true,
    });
    return url;
  }

  touchObjectUrl(nodeId: string): void {
    if (!this.objectUrls.has(nodeId)) {
      return;
    }

    this.cache.touch(this.getObjectUrlKey(nodeId), 1);
  }

  releaseObjectUrl(nodeId: string): void {
    const entry = this.objectUrls.get(nodeId);
    if (!entry) {
      return;
    }

    this.revokeObjectUrlImpl(entry);
    this.objectUrls.delete(nodeId);
    this.cache.remove(this.getObjectUrlKey(nodeId));
    this.cache.recordRevocation();
  }

  syncNodeIds(activeNodeIds: Iterable<string>): void {
    this.flushVisibilityUpdates();
    const activeSet = new Set(activeNodeIds);
    Array.from(this.objectUrls.keys()).forEach((nodeId) => {
      if (!activeSet.has(nodeId)) {
        this.releaseObjectUrl(nodeId);
      }
    });

    Array.from(this.states.keys()).forEach((nodeId) => {
      const baseNodeId = this.getNodeIdFromStateKey(nodeId);
      if (!activeSet.has(baseNodeId)) {
        this.clear(baseNodeId);
      }
    });
  }

  clearAll(): void {
    this.isVisibilityUpdatesPaused = false;
    this.visibilityBatcher.cancel();
    this.cancelPendingNotifications();
    Array.from(this.objectUrls.keys()).forEach((nodeId) => {
      this.releaseObjectUrl(nodeId);
    });

    this.assets.clear();
    this.states.clear();
    this.inflight.clear();
    this.releaseAllDecodedResources();
    this.failedUrls.clear();
    this.failureHistory.clear();
    this.assetSignatures.clear();
    this.emptyStates.clear();
    this.preferredUrls.clear();
    this.requestSequence.clear();
    this.cache.clear();
  }

  getDebugSnapshot(): ImageManagerDebugSnapshot {
    this.flushVisibilityUpdates();
    const subscriptions = this.getSubscriptionDebugSnapshot();
    return {
      features: { ...this.features },
      cache: this.cache.getSnapshot(),
      cacheBudget: this.cacheBudgetProfile
        ? {
          profile: { ...this.cacheBudgetProfile },
          context: {
            ...this.cacheBudgetContext,
            device: this.cacheBudgetContext.device
              ? { ...this.cacheBudgetContext.device }
              : undefined,
          },
        }
        : undefined,
      states: Array.from(this.states.values()),
      trackedAssets: this.assets.size,
      failedUrlGroups: this.failedUrls.size,
      subscriptions,
      inflightRequests: Array.from(this.inflight.keys()).map((key) => {
        const state = this.states.get(key);
        const inflight = this.inflight.get(key);
        return {
          key,
          requestKey: inflight?.requestKey ?? state?.requestKey,
          src: inflight?.src ?? state?.src,
        };
      }),
      objectUrls: Array.from(this.objectUrls.entries()).map(([nodeId, url]) => ({
        nodeId,
        url,
      })),
      decodedResources: Array.from(this.decodedResources.entries()).map(([key, resource]) => {
        const [nodeId, mode] = key.split(':') as [string, ImageResourceMode];
        return {
          key,
          nodeId,
          mode,
          src: resource.src,
          decoded: resource.decoded,
          estimatedBytes: resource.estimatedBytes,
        };
      }),
    };
  }

  private getSubscriptionDebugSnapshot(): ImageManagerDebugSnapshot['subscriptions'] {
    let total = 0;
    let canvas = 0;
    let original = 0;

    this.listeners.forEach((bucket, stateKey) => {
      const count = bucket.size;
      total += count;
      if (stateKey.endsWith(':original')) {
        original += count;
      } else {
        canvas += count;
      }
    });

    return {
      total,
      canvas,
      original,
      nodesWithSubscribers: this.listeners.size,
    };
  }

  private buildState(state: ImageResourceStateDraft): ImageResourceState {
    return {
      ...state,
      resourcePolicy: state.resourcePolicy ?? this.features.canvasResourcePolicy,
      resourceRole: state.resourceRole ?? resolveImageResourceRole(state.mode),
      visibility: this.normalizeVisibility(state.visibility ?? DEFAULT_VISIBILITY),
      phase: resolveImageResourcePhase({
        mode: state.mode,
        status: state.status,
        src: state.src,
        activeVariantKind: state.activeVariantKind,
        cooldownUntil: state.cooldownUntil,
        loadedAt: state.loadedAt,
        hasDecodedResource: Boolean(state.decodedResource),
      }),
    };
  }

  private flushVisibilityUpdates(): void {
    if (this.isVisibilityUpdatesPaused) {
      return;
    }

    this.visibilityBatcher.flush();
  }

  private scheduleNotificationFlush(): void {
    if (this.notificationScheduled) {
      return;
    }

    this.notificationScheduled = true;
    const token = ++this.notificationScheduleToken;
    const handle = this.scheduleNotificationImpl(() => {
      if (token !== this.notificationScheduleToken) {
        return;
      }

      this.notificationHandle = undefined;
      this.notificationScheduled = false;
      this.flushPendingNotifications();
    });
    this.notificationHandle = typeof handle === 'number' ? handle : undefined;
  }

  private flushPendingNotifications(): boolean {
    if (this.pendingNotificationKeys.size === 0) {
      this.notificationScheduled = false;
      return false;
    }

    this.cancelScheduledNotification();
    const stateKeys = Array.from(this.pendingNotificationKeys);
    this.pendingNotificationKeys.clear();
    stateKeys.forEach((stateKey) => {
      this.notifyStateKey(stateKey);
    });
    return true;
  }

  private cancelScheduledNotification(): void {
    this.notificationScheduled = false;
    this.notificationScheduleToken += 1;
    if (typeof this.notificationHandle !== 'number') {
      return;
    }

    this.cancelNotificationImpl?.(this.notificationHandle);
    this.notificationHandle = undefined;
  }

  private cancelPendingNotifications(): void {
    this.cancelScheduledNotification();
    this.pendingNotificationKeys.clear();
  }

  private removePendingNotificationsForNode(nodeId: string): void {
    this.pendingNotificationKeys.delete(this.getStateKey(nodeId, 'canvas'));
    this.pendingNotificationKeys.delete(this.getStateKey(nodeId, 'original'));
  }

  private reconcileVisibilityUpdates(entries: ImageVisibilityReconcileEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    const emitTargets = new Map<string, ImageResourceMode>();
    let shouldApplyCachePolicy = false;

    entries.forEach((entry) => {
      const current = this.states.get(entry.stateKey);
      if (!current || current.mode !== entry.mode) {
        return;
      }

      this.syncCacheEntry(this.states.get(entry.stateKey));
      emitTargets.set(entry.nodeId, entry.mode);
      shouldApplyCachePolicy = true;
    });

    if (shouldApplyCachePolicy) {
      this.applyCachePolicy('soft');
    }

    emitTargets.forEach((mode, nodeId) => {
      this.emit(nodeId, mode);
    });
  }

  private createBaseState(
    nodeId: string,
    mode: ImageResourceMode,
    overrides: Partial<ImageResourceStateDraft> = {}
  ): ImageResourceState {
    return this.buildState({
      nodeId,
      mode,
      resourcePolicy: overrides.resourcePolicy ?? this.features.canvasResourcePolicy,
      resourceRole: overrides.resourceRole ?? resolveImageResourceRole(mode),
      status: 'idle',
      visibility: this.normalizeVisibility(overrides.visibility ?? DEFAULT_VISIBILITY),
      ...overrides,
    });
  }

  private normalizeVisibility(visibility: ImageVisibilityState): ImageVisibilityState {
    const displayWidth = this.roundVisibilityValue(visibility.displayWidth ?? DEFAULT_VISIBILITY.displayWidth, VISIBILITY_SIZE_BUCKET_PX);
    const displayHeight = this.roundVisibilityValue(visibility.displayHeight ?? DEFAULT_VISIBILITY.displayHeight, VISIBILITY_SIZE_BUCKET_PX);
    const viewportZoom = typeof visibility.viewportZoom === 'number'
      ? this.roundVisibilityValue(visibility.viewportZoom, VISIBILITY_ZOOM_BUCKET)
      : undefined;
    const visibilityScore = typeof visibility.visibilityScore === 'number'
      ? this.roundVisibilityValue(visibility.visibilityScore, VISIBILITY_SCORE_BUCKET)
      : undefined;
    const centerDistance = typeof visibility.centerDistance === 'number' && Number.isFinite(visibility.centerDistance)
      ? this.roundVisibilityValue(visibility.centerDistance, VISIBILITY_CENTER_BUCKET_PX)
      : visibility.centerDistance ?? DEFAULT_VISIBILITY.centerDistance;

    return {
      ...DEFAULT_VISIBILITY,
      ...visibility,
      displayWidth,
      displayHeight,
      viewportZoom,
      visibilityScore,
      centerDistance,
    };
  }

  private roundVisibilityValue(value: number, bucket: number): number {
    if (!Number.isFinite(value) || bucket <= 0) {
      return value;
    }

    return Math.round(value / bucket) * bucket;
  }

  private resolveNextUrl(
    nodeId: string,
    mode: ImageResourceMode,
    currentUrl?: string,
    preferredUrl?: string,
    preferredUrlChanged = false
  ): string | undefined {
    const stateKey = this.getStateKey(nodeId, mode);
    const asset = this.assets.get(stateKey);
    if (!asset) {
      return undefined;
    }

    const canvasPreferredUrl = preferredUrl ?? this.preferredUrls.get(stateKey);
    const candidates = this.getEligibleUrls(stateKey, asset, mode, canvasPreferredUrl);

    if (canvasPreferredUrl && candidates.includes(canvasPreferredUrl) && (preferredUrlChanged || currentUrl !== canvasPreferredUrl)) {
      return canvasPreferredUrl;
    }

    if (currentUrl && candidates.includes(currentUrl)) {
      return currentUrl;
    }

    return candidates[0];
  }

  private shouldRetainCurrentDisplaySourceDuringSourceSwitch(
    current: ImageResourceState | undefined,
    nextRequestUrl: string | undefined,
    mode: ImageResourceMode,
    _assetChanged: boolean,
  ): boolean {
    if (
      mode !== 'canvas' ||
      current?.status !== 'ready' ||
      !current.src ||
      !nextRequestUrl
    ) {
      return false;
    }

    return current.src !== nextRequestUrl;
  }

  private getStateKey(nodeId: string, mode: ImageResourceMode): string {
    return `${nodeId}:${mode}`;
  }

  private getObjectUrlKey(nodeId: string): string {
    return `object-url:${nodeId}`;
  }

  private getNodeIdFromStateKey(stateKey: string): string {
    const [nodeId] = stateKey.split(':');
    return nodeId;
  }

  private resolveNextStatus(
    current: ImageResourceState | undefined,
    nextSrc: string | undefined,
    nextRequestUrl: string | undefined,
    assetChanged: boolean,
  ): ImageResourceState['status'] {
    if (!nextSrc && !nextRequestUrl) {
      return 'error';
    }

    if (!current) {
      return 'idle';
    }

    if (assetChanged) {
      return 'idle';
    }

    if (current.src !== nextSrc) {
      return 'idle';
    }

    if (current.requestUrl !== nextRequestUrl) {
      return 'idle';
    }

    return current.status;
  }

  private areStatesEqual(
    current: ImageResourceState | undefined,
    next: ImageResourceState
  ): boolean {
    if (!current) {
      return false;
    }

    return current.nodeId === next.nodeId &&
      current.src === next.src &&
      current.requestUrl === next.requestUrl &&
      current.status === next.status &&
      current.phase === next.phase &&
      current.error === next.error &&
      current.requestedAt === next.requestedAt &&
      current.loadedAt === next.loadedAt &&
      current.requestKey === next.requestKey &&
      current.preferredUrl === next.preferredUrl &&
      current.activeVariantKind === next.activeVariantKind &&
      current.lastEventKind === next.lastEventKind &&
      current.lastEventAt === next.lastEventAt &&
      current.lastEventClassification === next.lastEventClassification &&
      current.lastAttemptedUrl === next.lastAttemptedUrl &&
      current.lastEventReason === next.lastEventReason &&
      current.lastSwitchReason === next.lastSwitchReason &&
      current.decodedResource?.src === next.decodedResource?.src &&
      current.decodedResource?.decoded === next.decodedResource?.decoded &&
      current.decodedResource?.estimatedBytes === next.decodedResource?.estimatedBytes &&
      current.visibility.isVisible === next.visibility.isVisible &&
      current.visibility.isNearViewport === next.visibility.isNearViewport &&
      current.visibility.displayWidth === next.visibility.displayWidth &&
      current.visibility.displayHeight === next.visibility.displayHeight &&
      current.visibility.visibleAreaRatio === next.visibility.visibleAreaRatio &&
      current.visibility.viewportZoom === next.visibility.viewportZoom &&
      current.visibility.visibilityScore === next.visibility.visibilityScore &&
      current.visibility.centerDistance === next.visibility.centerDistance &&
      current.visibility.isSelected === next.visibility.isSelected &&
      current.visibility.isRecentlyInteracted === next.visibility.isRecentlyInteracted &&
      current.visibility.isImporting === next.visibility.isImporting;
  }

  private emit(nodeId: string, mode: ImageResourceMode): void {
    const stateKey = this.getStateKey(nodeId, mode);
    const listeners = this.listeners.get(stateKey);
    if (!listeners || listeners.size === 0) {
      return;
    }

    this.pendingNotificationKeys.add(stateKey);
    this.scheduleNotificationFlush();
  }

  private notifyStateKey(stateKey: string): void {
    const [nodeId, mode = 'canvas'] = stateKey.split(':') as [string, ImageResourceMode];
    recordCanvasImageManagerEmit({ nodeId, mode });
    const current = this.states.get(stateKey);
    recordCanvasTraceEvent({
      type: 'imageManager.emit',
      phase: 'instant',
      data: {
        nodeId,
        mode,
        status: current?.status,
        phase: current?.phase,
        eventKind: current?.lastEventKind,
        isVisible: current?.visibility.isVisible,
        isNearViewport: current?.visibility.isNearViewport,
      },
    });
    this.listeners.get(stateKey)?.forEach((listener) => listener());
  }

  private ensureState(nodeId: string, mode: ImageResourceMode): ImageResourceState | undefined {
    const stateKey = this.getStateKey(nodeId, mode);
    const current = this.states.get(stateKey);
    if (current) {
      return current;
    }

    const nextSrc = this.resolveNextUrl(nodeId, mode);
    if (!nextSrc) {
      return undefined;
    }

    const nextState = this.buildState({
      nodeId,
      mode,
      src: nextSrc,
      requestUrl: nextSrc,
      status: 'idle',
      activeVariantKind: this.resolveVariantKind(this.assets.get(stateKey), nextSrc),
      decodedResource: undefined,
      preferredUrl: this.preferredUrls.get(stateKey),
      lastEventKind: 'register',
      lastEventAt: this.now(),
      lastEventClassification: 'current',
      lastEventReason: this.buildEnsureStateReason(nextSrc),
      lastSwitchReason: 'ensure-state',
      retryCount: 0,
      cooldownUntil: undefined,
      retryTrigger: undefined,
      visibility: this.normalizeVisibility(DEFAULT_VISIBILITY),
    });

    this.states.set(stateKey, nextState);
    return nextState;
  }

  private syncCacheEntry(state: ImageResourceState | undefined): void {
    if (!state) {
      return;
    }

    const stateKey = this.getStateKey(state.nodeId, state.mode);
    if (!state.src || state.status !== 'ready') {
      this.cache.remove(stateKey);
      return;
    }

    const tier = this.resolveCacheTier(state.activeVariantKind);
    const existingEntry = this.cache.get(stateKey);

    this.cache.upsert({
      key: stateKey,
      nodeId: state.nodeId,
      kind: 'resource-state',
      mode: state.mode,
      url: state.src,
      status: state.status,
      loadedAt: state.loadedAt,
      lastAccessAt: Math.max(
        existingEntry?.lastAccessAt ?? 0,
        state.loadedAt ?? 0,
        state.requestedAt ?? 0,
      ),
      isVisible: state.visibility.isVisible,
      isNearViewport: state.visibility.isNearViewport,
      byteSize: state.decodedResource?.estimatedBytes ?? 0,
      decodedKind: state.decodedResource?.decoded,
      pool: state.mode,
      tier,
    });
  }

  private applyCachePolicy(mode: ImageCacheEvictionMode = 'normal'): void {
    if (this.isApplyingCachePolicy) {
      return;
    }

    if (this.cacheBudgetProfile?.scene === 'import-dragging' && mode !== 'soft') {
      return;
    }

    this.isApplyingCachePolicy = true;

    try {
      const evictions = this.cache.collectEvictions(mode);
      if (evictions.length === 0) {
        return;
      }

      this.cache.recordEviction(evictions.length);

      evictions.forEach((eviction: ImageCacheEviction) => {
        if (eviction.kind === 'resource-state' && eviction.mode) {
          if (this.shouldSkipEvictionRelease(eviction)) {
            return;
          }

          this.release(eviction.nodeId, eviction.mode);
        }
      });
    } finally {
      this.isApplyingCachePolicy = false;
    }
  }

  private shouldSkipEvictionRelease(eviction: ImageCacheEviction): boolean {
    if (eviction.mode !== 'canvas') {
      return false;
    }

    const entry = this.cache.get(eviction.key);
    if (!entry || entry.tier !== 'thumbnail') {
      return false;
    }

    const state = this.states.get(eviction.key);
    if (!state || state.status !== 'ready' || state.activeVariantKind !== 'thumbnail') {
      return false;
    }

    const policy = this.cache.getPolicy();
    const now = this.now();
    return now - entry.lastAccessAt <= policy.nearViewportReleaseAfterMs ||
      (
        typeof entry.loadedAt === 'number' &&
        now - entry.loadedAt <= policy.recentlyLoadedCanvasProtectionMs
      );
  }

  private scheduleCachePolicyAfterReady(mode: ImageResourceMode = 'canvas'): void {
    const scene = this.cacheBudgetProfile?.scene;
    if (scene === 'dragging' || scene === 'importing' || scene === 'import-dragging') {
      return;
    }

    if (mode === 'original') {
      this.applyCachePolicy('normal');
      return;
    }

    if (this.cachePolicyTimer) {
      return;
    }

    this.cachePolicyTimer = setTimeout(() => {
      this.cachePolicyTimer = undefined;
      this.applyCachePolicy('full');
    }, CACHE_POLICY_AFTER_READY_DELAY_MS);
  }

  updateCacheBudgetContext(context: ImageCacheBudgetContext): void {
    const normalizedContext: ImageCacheBudgetContext = {
      imageNodeCount: Math.max(0, context.imageNodeCount),
      importingNodeCount: Math.max(0, context.importingNodeCount ?? 0),
      isImporting: Boolean(context.isImporting),
      isDragging: Boolean(context.isDragging),
      isIdle: Boolean(context.isIdle),
      device: context.device
        ? {
          deviceMemoryGb: context.device.deviceMemoryGb,
          hardwareConcurrency: context.device.hardwareConcurrency,
          jsHeapSizeLimit: context.device.jsHeapSizeLimit,
          totalJSHeapSize: context.device.totalJSHeapSize,
        }
        : undefined,
    };

    const previousContextSignature = JSON.stringify(this.cacheBudgetContext);
    const nextContextSignature = JSON.stringify(normalizedContext);
    if (previousContextSignature === nextContextSignature) {
      return;
    }

    this.cacheBudgetContext = normalizedContext;
    const result = resolveImageCacheBudget(normalizedContext, this.baseCachePolicy);
    this.cacheBudgetProfile = result.profile;
    const policyChanged = this.cache.setPolicy(result.policy);

    if (!policyChanged) {
      return;
    }

    if (
      result.profile.scene === 'dragging' ||
      result.profile.scene === 'importing' ||
      result.profile.scene === 'import-dragging'
    ) {
      this.applyCachePolicy('soft');
      return;
    }

    if (result.profile.scene === 'idle') {
      this.applyCachePolicy('full');
      return;
    }

    this.applyCachePolicy('normal');
  }

  private storeDecodedResource(stateKey: string, resource: LoadedImageResource): void {
    const current = this.decodedResources.get(stateKey);
    if (current && current !== resource) {
      this.releaseDecodedResource(stateKey, current);
    }

    this.decodedResources.set(stateKey, resource);
  }

  private releaseDecodedResourceByKey(stateKey: string): void {
    const resource = this.decodedResources.get(stateKey);
    if (!resource) {
      return;
    }

    this.releaseDecodedResource(stateKey, resource);
    const current = this.states.get(stateKey);
    if (current?.decodedResource === resource) {
      this.states.set(stateKey, this.buildState({
        ...current,
        decodedResource: undefined,
      }));
    }
  }

  private releaseDecodedResource(stateKey: string, resource: LoadedImageResource): void {
    const current = this.decodedResources.get(stateKey);
    if (current === resource) {
      this.decodedResources.delete(stateKey);
    }

    resource.handle?.close();
    if (resource.handle && resource.decoded !== 'display-url') {
      this.cache.recordDecodedRelease();
    }
  }

  private resolveLoadStrategy(mode: ImageResourceMode): ImageLoadStrategy {
    if (mode === 'canvas') {
      return resolveCanvasLoadStrategy(
        this.canvasLoadStrategyOverride,
        {
          displayUrlEnabled: this.features.canvasDisplayUrlLoading,
        }
      );
    }

    return 'decode';
  }

  private resolveLoadResizeOptions(
    mode: ImageResourceMode,
    state: ImageResourceState,
  ): ImageResourceLoadOptions {
    if (mode !== 'canvas' || this.resolveLoadStrategy(mode) !== 'decode') {
      return {};
    }

    const displayWidth = state.visibility.displayWidth;
    const displayHeight = state.visibility.displayHeight;
    if (displayWidth <= 0 || displayHeight <= 0) {
      return {};
    }

    return {
      resizeWidth: Math.min(
        CANVAS_DECODE_MAX_EDGE_PX,
        Math.max(CANVAS_DECODE_MIN_EDGE_PX, Math.ceil(displayWidth * CANVAS_DECODE_TARGET_SCALE)),
      ),
      resizeHeight: Math.min(
        CANVAS_DECODE_MAX_EDGE_PX,
        Math.max(CANVAS_DECODE_MIN_EDGE_PX, Math.ceil(displayHeight * CANVAS_DECODE_TARGET_SCALE)),
      ),
    };
  }

  private shouldPersistLoadedResource(
    stateKey: string,
    requestedUrl: string,
    mode: ImageResourceMode,
  ): boolean {
    if (!isProtectedResourceUrl(requestedUrl)) {
      return false;
    }

    if (mode !== 'canvas') {
      return false;
    }

    const asset = this.assets.get(stateKey);
    if (!asset) {
      return false;
    }

    return asset.thumbnail?.url === requestedUrl;
  }

  private resolvePersistentVersion(
    stateKey: string,
    requestedUrl: string,
  ): string | undefined {
    const asset = this.assets.get(stateKey);
    if (!asset) {
      return undefined;
    }

    const variant = asset.thumbnail?.url === requestedUrl
      ? asset.thumbnail
      : asset.original?.url === requestedUrl
        ? asset.original
        : undefined;
    if (!variant) {
      return undefined;
    }

    return [
      asset.asset.assetId ?? '',
      variant.kind,
      asset.asset.version,
      variant.asset?.updatedAt ?? '',
      variant.asset?.width ?? '',
      variant.asset?.height ?? '',
      requestedUrl,
    ].join('|');
  }

  private releaseAllDecodedResources(): void {
    Array.from(this.decodedResources.entries()).forEach(([stateKey, resource]) => {
      this.releaseDecodedResource(stateKey, resource);
    });
  }

  private resolveVariantKind(
    asset: ResolvedFileNodeImageAsset | undefined,
    src?: string
  ): ImageResourceState['activeVariantKind'] {
    if (!asset || !src) {
      return undefined;
    }

    if (asset.original?.url === src) {
      return 'original';
    }

    if (asset.thumbnail?.url === src) {
      return 'thumbnail';
    }

    return undefined;
  }

  private createRequestKey(nodeId: string, mode: ImageResourceMode, src?: string): string {
    const stateKey = this.getStateKey(nodeId, mode);
    const sequence = (this.requestSequence.get(stateKey) ?? 0) + 1;
    this.requestSequence.set(stateKey, sequence);
    return `${stateKey}:${sequence}:${src ?? 'no-src'}`;
  }

  private shouldRetainDecodedResource(
    current: ImageResourceState | undefined,
    nextSrc: string | undefined,
    nextRequestUrl: string | undefined,
    assetChanged: boolean
  ): boolean {
    if (!current?.decodedResource) {
      return false;
    }

    if (current.src !== nextSrc) {
      return false;
    }

    if (assetChanged && current.src === nextRequestUrl) {
      return false;
    }

    return true;
  }

  private resolveRegisterSwitchReason(
    current: ImageResourceState | undefined,
    options: {
      assetChanged: boolean;
      preferredUrlChanged: boolean;
      nextSrc?: string;
    }
  ): ImageResourceSwitchReason {
    if (!options.nextSrc) {
      return 'no-source';
    }

    if (!current) {
      return 'initial-register';
    }

    if (options.assetChanged) {
      return 'asset-changed';
    }

    if (current.src !== options.nextSrc) {
      return 'source-changed';
    }

    return 'state-reused';
  }

  private classifyFailureEvent(
    activeRequestKey: string | undefined,
    reportedRequestKey: string | undefined,
    activeUrl: string | undefined,
    attemptedUrl: string | undefined
  ): ImageResourceEventClassification {
    if (reportedRequestKey && !activeRequestKey) {
      return 'stale';
    }

    if (reportedRequestKey && activeRequestKey && reportedRequestKey !== activeRequestKey) {
      return 'stale';
    }

    if (attemptedUrl && activeUrl && attemptedUrl !== activeUrl) {
      return 'stale';
    }

    return 'current';
  }

  private buildRegisterEventReason(nodeId: string, mode: ImageResourceMode, preferredUrl?: string): string {
    return `register ${nodeId}:${mode}${preferredUrl ? ` preferred=${preferredUrl}` : ''}`;
  }

  private buildRequestCancelledReason(requestKey: string | undefined): string {
    return `request cancelled${requestKey ? ` key=${requestKey}` : ''}`;
  }

  private buildVisibilityEventReason(visibility: ImageVisibilityState): string {
    return `visibility visible=${visibility.isVisible} near=${visibility.isNearViewport} size=${visibility.displayWidth}x${visibility.displayHeight} ratio=${this.resolveVisibleAreaRatio(visibility).toFixed(3)} score=${(visibility.visibilityScore ?? this.computeVisibilityScore(visibility)).toFixed(3)} zoom=${(visibility.viewportZoom ?? 1).toFixed(3)} selected=${visibility.isSelected ? '1' : '0'} recent=${visibility.isRecentlyInteracted ? '1' : '0'} importing=${visibility.isImporting ? '1' : '0'} center=${visibility.centerDistance ?? Number.POSITIVE_INFINITY}`;
  }

  private computeVisibilityScore(visibility: ImageVisibilityState): number {
    const visibleAreaRatio = this.resolveVisibleAreaRatio(visibility);
    const zoomWeight = Math.max(0, Math.min(1, ((visibility.viewportZoom ?? 1) - 0.6) / 1.4));
    const selectedWeight = visibility.isSelected ? 1 : 0;
    const interactedWeight = visibility.isRecentlyInteracted ? 1 : 0;
    const importingWeight = visibility.isImporting ? 1 : 0;
    const nearViewportWeight = visibility.isNearViewport ? 1 : 0;
    const centerDistance = Number.isFinite(visibility.centerDistance)
      ? visibility.centerDistance ?? Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;
    const normalizedCenterDistance = Math.max(0, 1 - Math.min(centerDistance / Math.max(visibility.displayWidth, visibility.displayHeight, 1, 800), 1.5));

    return Math.max(0, Math.min(1,
      visibleAreaRatio * 0.5 +
      normalizedCenterDistance * 0.2 +
      zoomWeight * 0.1 +
      selectedWeight * 0.12 +
      interactedWeight * 0.06 +
      importingWeight * 0.18 +
      nearViewportWeight * 0.02
    ));
  }

  private resolveVisibleAreaRatio(visibility: ImageVisibilityState): number {
    if (typeof visibility.visibleAreaRatio === 'number') {
      return Math.max(0, Math.min(1, visibility.visibleAreaRatio));
    }

    if (visibility.isVisible) {
      return 1;
    }

    if (visibility.isNearViewport) {
      return 0.25;
    }

    return 0;
  }

  private resolveCacheTier(variantKind?: ImageResourceState['activeVariantKind']): ImageCacheTier {
    if (variantKind === 'thumbnail') {
      return 'thumbnail';
    }

    if (variantKind === 'original') {
      return 'original';
    }

    return 'unknown';
  }

  private buildRequestEventReason(requestKey: string, requestedUrl: string): string {
    return `request started ${requestKey} src=${requestedUrl}`;
  }

  private buildCooldownSuppressedRequestReason(requestedUrl: string): string {
    return `request suppressed during failure cooldown src=${requestedUrl}`;
  }

  private buildLoadSucceededReason(requestKey: string, requestedUrl: string): string {
    return `load succeeded ${requestKey} src=${requestedUrl}`;
  }

  private buildStaleLoadEventReason(
    outcome: 'success' | 'failure',
    requestKey: string,
    requestedUrl: string,
    reason?: string
  ): string {
    return `${outcome} ignored for stale request ${requestKey} src=${requestedUrl}${reason ? ` reason=${reason}` : ''}`;
  }

  private buildFailureEventReason(
    requestKey: string | undefined,
    attemptedUrl: string | undefined,
    error?: string
  ): string {
    return `load failed${requestKey ? ` ${requestKey}` : ''}${attemptedUrl ? ` src=${attemptedUrl}` : ''}${error ? ` reason=${error}` : ''}`;
  }

  private buildRenderableSourceFailureReason(
    attemptedUrl: string,
    reason: string,
    nextSrc?: string
  ): string {
    return `renderable source failed src=${attemptedUrl} reason=${reason}${nextSrc ? ` next=${nextSrc}` : ''}`;
  }

  private buildReleaseEventReason(mode: ImageResourceMode, nextSrc?: string): string {
    return `release ${mode}${nextSrc ? ` reset-to=${nextSrc}` : ''}`;
  }

  private buildEnsureStateReason(nextSrc?: string): string {
    return `ensure state${nextSrc ? ` src=${nextSrc}` : ''}`;
  }

  private getEligibleUrls(
    stateKey: string,
    asset: ResolvedFileNodeImageAsset,
    mode: ImageResourceMode,
    preferredUrl?: string
  ): string[] {
    const failed = this.failedUrls.get(stateKey);
    return getImageVariantUrls(asset, mode, preferredUrl)
      .filter((value) => !this.isUrlCoolingDown(failed?.get(value)));
  }

  private recordFailedUrl(stateKey: string, url: string): FailedResourceEntry {
    const bucket = this.failedUrls.get(stateKey) ?? new Map<string, FailedResourceEntry>();
    const historyBucket = this.failureHistory.get(stateKey) ?? new Map<string, FailedResourceEntry>();
    const now = this.now();
    const current = bucket.get(url) ?? historyBucket.get(url);
    const attempts = current && now - current.lastFailedAt <= FAILURE_RETRY_RESET_MS
      ? current.attempts + 1
      : 1;
    const next: FailedResourceEntry = {
      attempts,
      lastFailedAt: now,
      cooldownUntil: now + FAILURE_COOLDOWN_MS * Math.min(attempts, FAILURE_MAX_RETRY_ATTEMPTS),
    };
    bucket.set(url, next);
    historyBucket.set(url, next);
    this.failedUrls.set(stateKey, bucket);
    this.failureHistory.set(stateKey, historyBucket);
    return next;
  }

  private isUrlCoolingDown(entry: FailedResourceEntry | undefined): boolean {
    if (!entry) {
      return false;
    }

    if (entry.attempts >= FAILURE_MAX_RETRY_ATTEMPTS) {
      return true;
    }

    return this.now() < entry.cooldownUntil;
  }

  private releaseCooldownIfEligible(
    nodeId: string,
    mode: ImageResourceMode,
    current: ImageResourceState,
    visibility: ImageVisibilityState
  ): void {
    const stateKey = this.getStateKey(nodeId, mode);
    if (!this.assets.get(stateKey)) {
      return;
    }

    const retryTrigger = this.resolveRetryTrigger(current.visibility, visibility);
    if (!retryTrigger) {
      return;
    }

    const failed = this.failedUrls.get(stateKey);
    if (!failed || failed.size === 0) {
      return;
    }

    const now = this.now();
    let hasReleased = false;
    let hadSuppressedEntry = false;
    failed.forEach((entry) => {
      if (entry.attempts >= FAILURE_MAX_RETRY_ATTEMPTS) {
        hadSuppressedEntry = true;
        return;
      }

      if (entry.cooldownUntil > now) {
        hadSuppressedEntry = true;
        return;
      }

      hasReleased = true;
      this.cache.recordRetryRecovered();
    });

    if (!hasReleased) {
      this.cache.recordRetrySuppressed();
      return;
    }

    if (hadSuppressedEntry) {
      this.cache.recordRetrySuppressed();
    }

    if (failed.size === 0) {
      this.failedUrls.delete(stateKey);
    }

    const nextSrc = this.resolveNextUrl(nodeId, mode, undefined, this.preferredUrls.get(stateKey), true);
    const shouldResetToRetry = Boolean(
      nextSrc &&
      (
        nextSrc !== current.src ||
        current.status !== 'idle' ||
        current.requestUrl !== nextSrc
      )
    );
    if (!shouldResetToRetry || !nextSrc) {
      this.cache.recordRetrySuppressed();
      return;
    }

    this.cache.recordRetryAttempt();
    this.states.set(stateKey, this.buildState({
      ...current,
      src: nextSrc,
      status: 'idle',
      error: undefined,
      cooldownUntil: undefined,
      requestedAt: undefined,
      loadedAt: undefined,
      requestKey: undefined,
      requestUrl: nextSrc,
      activeVariantKind: this.resolveVariantKind(this.assets.get(stateKey), nextSrc),
      decodedResource: undefined,
      lastEventKind: 'cooldown-released',
      lastEventAt: now,
      lastEventClassification: 'current',
      lastAttemptedUrl: current.lastAttemptedUrl,
      lastEventReason: this.buildCooldownReleasedReason(retryTrigger, nextSrc),
      retryTrigger,
    }));
    this.releaseDecodedResourceByKey(stateKey);
    this.emit(nodeId, mode);
  }

  private resolveRetryTrigger(
    previous: ImageVisibilityState,
    next: ImageVisibilityState
  ): ImageResourceRetryTrigger | undefined {
    if (!previous.isVisible && next.isVisible) {
      return 'visibility-enter';
    }

    if (!previous.isNearViewport && next.isNearViewport) {
      return 'near-viewport-enter';
    }

    if (
      previous.displayWidth !== next.displayWidth ||
      previous.displayHeight !== next.displayHeight
    ) {
      return 'display-change';
    }

    return undefined;
  }

  private buildCooldownReleasedReason(trigger: ImageResourceRetryTrigger, nextSrc: string): string {
    return `cooldown released trigger=${trigger} retry-src=${nextSrc}`;
  }

  private isActiveRequest(
    state: ImageResourceState | undefined,
    requestKey: string,
    requestedUrl: string
  ): boolean {
    return Boolean(
      (state?.requestUrl ?? state?.src) &&
      (state.requestUrl ?? state.src) === requestedUrl &&
      state.requestKey &&
      state.requestKey === requestKey
    );
  }
}

export const imageManager = new ImageManager();

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (
    window as Window & {
      __IMAGE_MANAGER__?: ImageManager;
      __IMAGE_MANAGER_DEBUG__?: () => ImageManagerDebugSnapshot;
    }
  ).__IMAGE_MANAGER__ = imageManager;
  (
    window as Window & {
      __IMAGE_MANAGER__?: ImageManager;
      __IMAGE_MANAGER_DEBUG__?: () => ImageManagerDebugSnapshot;
    }
  ).__IMAGE_MANAGER_DEBUG__ = (): ImageManagerDebugSnapshot => imageManager.getDebugSnapshot();
}
