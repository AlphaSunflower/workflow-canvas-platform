import type { ImageVisibilityAreaBucket, ImageVisibilityBucket, ImageVisibilityScoreBucket } from '@/services/image/image-resource.types';
import type { Viewport } from '@/types';

const PREVIEW_UPGRADE_MIN_VISIBILITY_SCORE = 0.52;
const PREVIEW_UPGRADE_REQUEUE_VISIBILITY_SCORE = 0.62;
const PREVIEW_UPGRADE_MIN_VISIBLE_AREA_RATIO = 0.18;
const PREVIEW_UPGRADE_CANCEL_VISIBILITY_SCORE = 0.18;
const PREVIEW_UPGRADE_CANCEL_VISIBLE_AREA_RATIO = 0.04;
const IMPORT_PREVIEW_UPGRADE_MIN_VISIBLE_AREA_RATIO = 0.02;
const PRIORITY_VISIBILITY_SCORE = 0.8;
const DISPLAY_SIZE_BUCKET_STEP = 192;
export const ZOOM_VISIBILITY_THROTTLE_MS = 120;
export const ZOOM_VISIBILITY_MIN_SCALE_DELTA = 0.08;
export const ZOOM_VISIBILITY_MIN_TRANSLATE_DELTA = 192;
const ZOOM_VISIBILITY_EPSILON = 0.001;

export interface VisibilityBucketInput {
  isVisible: boolean;
  isNearViewport: boolean;
  visibleAreaRatio: number;
  visibilityScore: number;
  centerDistance: number;
  viewportSpan: number;
  isSelected: boolean;
  isRecentlyInteracted: boolean;
  isImporting: boolean;
  displayWidth: number;
  displayHeight: number;
}

export interface VisibilityBucketState {
  visibilityBucket: ImageVisibilityBucket;
  visibilityScoreBucket: ImageVisibilityScoreBucket;
  visibilityAreaBucket: ImageVisibilityAreaBucket;
  displayWidthBucket: number;
  displayHeightBucket: number;
}

export interface IntermediateZoomVisibilityScheduleInput {
  lastScheduledViewport?: Viewport | null;
  nextViewport: Viewport;
  lastScheduledAt: number;
  now: number;
}

export function deriveVisibilityBucketState(input: VisibilityBucketInput): VisibilityBucketState {
  const visibilityBucket = resolveVisibilityBucket(input);
  const visibilityScoreBucket = resolveVisibilityScoreBucket(input);
  const visibilityAreaBucket = resolveVisibilityAreaBucket(input.visibleAreaRatio);

  return {
    visibilityBucket,
    visibilityScoreBucket,
    visibilityAreaBucket,
    displayWidthBucket: resolveDisplayBucket(input.displayWidth),
    displayHeightBucket: resolveDisplayBucket(input.displayHeight),
  };
}

export function shouldEmitVisibilityDiff(
  previous: VisibilityBucketState | undefined,
  next: VisibilityBucketState
): boolean {
  if (!previous) {
    return true;
  }

  return previous.visibilityBucket !== next.visibilityBucket ||
    previous.visibilityScoreBucket !== next.visibilityScoreBucket ||
    previous.visibilityAreaBucket !== next.visibilityAreaBucket ||
    previous.displayWidthBucket !== next.displayWidthBucket ||
    previous.displayHeightBucket !== next.displayHeightBucket;
}

export function hasViewportZoomChanged(
  previous: Viewport | null | undefined,
  next: Viewport
): boolean {
  return Boolean(previous && Math.abs(next.zoom - previous.zoom) >= ZOOM_VISIBILITY_EPSILON);
}

export function shouldScheduleIntermediateZoomVisibility({
  lastScheduledViewport,
  nextViewport,
  lastScheduledAt,
  now,
}: IntermediateZoomVisibilityScheduleInput): boolean {
  if (!lastScheduledViewport) {
    return true;
  }

  if (now - lastScheduledAt >= ZOOM_VISIBILITY_THROTTLE_MS) {
    return true;
  }

  const previousZoom = lastScheduledViewport.zoom || 1;
  const nextZoom = nextViewport.zoom || 1;
  const scaleDelta = Math.abs(Math.log(nextZoom / previousZoom));
  if (scaleDelta >= ZOOM_VISIBILITY_MIN_SCALE_DELTA) {
    return true;
  }

  const translateDelta = Math.hypot(
    nextViewport.x - lastScheduledViewport.x,
    nextViewport.y - lastScheduledViewport.y,
  );
  return translateDelta >= ZOOM_VISIBILITY_MIN_TRANSLATE_DELTA;
}

function resolveVisibilityBucket(input: Pick<VisibilityBucketInput, 'isVisible' | 'isNearViewport' | 'centerDistance' | 'viewportSpan'>): ImageVisibilityBucket {
  if (input.isVisible) {
    return 'visible';
  }

  if (input.isNearViewport) {
    return 'near';
  }

  if (Number.isFinite(input.centerDistance) && input.centerDistance <= Math.max(input.viewportSpan * 1.8, 1)) {
    return 'far';
  }

  return 'offscreen';
}

function resolveVisibilityScoreBucket(input: VisibilityBucketInput): ImageVisibilityScoreBucket {
  if (input.isImporting) {
    if (!input.isVisible && !input.isNearViewport) {
      return 'cancel';
    }

    if (input.visibleAreaRatio < IMPORT_PREVIEW_UPGRADE_MIN_VISIBLE_AREA_RATIO) {
      return 'defer';
    }

    return 'import-priority';
  }

  if (input.isSelected || input.isRecentlyInteracted) {
    return 'priority';
  }

  if (input.visibilityScore <= PREVIEW_UPGRADE_CANCEL_VISIBILITY_SCORE) {
    return 'cancel';
  }

  if (input.visibilityScore < PREVIEW_UPGRADE_MIN_VISIBILITY_SCORE) {
    return 'defer';
  }

  if (input.visibilityScore < PREVIEW_UPGRADE_REQUEUE_VISIBILITY_SCORE) {
    return 'recover';
  }

  if (input.visibilityScore >= PRIORITY_VISIBILITY_SCORE) {
    return 'priority';
  }

  return 'ready';
}

function resolveVisibilityAreaBucket(visibleAreaRatio: number): ImageVisibilityAreaBucket {
  if (visibleAreaRatio <= 0) {
    return 'none';
  }

  if (visibleAreaRatio <= PREVIEW_UPGRADE_CANCEL_VISIBLE_AREA_RATIO) {
    return 'cancel';
  }

  if (visibleAreaRatio < PREVIEW_UPGRADE_MIN_VISIBLE_AREA_RATIO) {
    return 'defer';
  }

  return 'ready';
}

export function resolveDisplayBucket(value: number): number {
  return Math.max(0, Math.round(Math.max(0, value) / DISPLAY_SIZE_BUCKET_STEP));
}
