import type { ImageCachePolicy } from './image-cache';
import { DEFAULT_IMAGE_CACHE_POLICY } from './image-cache';

export type ImageCacheBudgetDeviceTier = 'low' | 'medium' | 'high';
export type ImageCacheBudgetScene = 'default' | 'dragging' | 'importing' | 'import-dragging' | 'idle';

export interface ImageCacheBudgetDeviceSnapshot {
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
}

export interface ImageCacheBudgetContext {
  imageNodeCount: number;
  importingNodeCount?: number;
  isImporting?: boolean;
  isDragging?: boolean;
  isIdle?: boolean;
  device?: ImageCacheBudgetDeviceSnapshot;
}

export interface ImageCacheBudgetProfile {
  tier: ImageCacheBudgetDeviceTier;
  scene: ImageCacheBudgetScene;
  density: 'small' | 'medium' | 'large';
  imageNodeCount: number;
  importingNodeCount: number;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  jsHeapSizeLimit?: number;
}

export interface ImageCacheBudgetResult {
  policy: ImageCachePolicy;
  profile: ImageCacheBudgetProfile;
}

const MB = 1024 * 1024;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scalePolicy(
  policy: ImageCachePolicy,
  scale: {
    maxResourceEntries?: number;
    maxOriginalEntries?: number;
    maxThumbnailEntries?: number;
    maxCanvasBytes?: number;
    maxOriginalBytes?: number;
    maxThumbnailBytes?: number;
    invisibleReleaseAfterMs?: number;
    nearViewportReleaseAfterMs?: number;
    recentlyLoadedCanvasProtectionMs?: number;
    protectedCanvasEntryHeadroom?: number;
    protectedCanvasByteHeadroom?: number;
  }
): ImageCachePolicy {
  return {
    maxResourceEntries: Math.round(policy.maxResourceEntries * (scale.maxResourceEntries ?? 1)),
    maxOriginalEntries: Math.round(policy.maxOriginalEntries * (scale.maxOriginalEntries ?? 1)),
    maxThumbnailEntries: Math.round(policy.maxThumbnailEntries * (scale.maxThumbnailEntries ?? 1)),
    maxCanvasBytes: Math.round(policy.maxCanvasBytes * (scale.maxCanvasBytes ?? 1)),
    maxOriginalBytes: Math.round(policy.maxOriginalBytes * (scale.maxOriginalBytes ?? 1)),
    maxThumbnailBytes: Math.round(policy.maxThumbnailBytes * (scale.maxThumbnailBytes ?? 1)),
    invisibleReleaseAfterMs: Math.round(policy.invisibleReleaseAfterMs * (scale.invisibleReleaseAfterMs ?? 1)),
    nearViewportReleaseAfterMs: Math.round(policy.nearViewportReleaseAfterMs * (scale.nearViewportReleaseAfterMs ?? 1)),
    recentlyLoadedCanvasProtectionMs: Math.round(
      policy.recentlyLoadedCanvasProtectionMs * (scale.recentlyLoadedCanvasProtectionMs ?? 1)
    ),
    protectedCanvasEntryHeadroom: Math.round(
      policy.protectedCanvasEntryHeadroom * (scale.protectedCanvasEntryHeadroom ?? 1)
    ),
    protectedCanvasByteHeadroom: Math.round(
      policy.protectedCanvasByteHeadroom * (scale.protectedCanvasByteHeadroom ?? 1)
    ),
  };
}

export function resolveImageCacheBudgetDeviceTier(
  device: ImageCacheBudgetDeviceSnapshot = {}
): ImageCacheBudgetDeviceTier {
  const deviceMemory = device.deviceMemoryGb ?? 0;
  const concurrency = device.hardwareConcurrency ?? 0;
  const heapLimitMb = typeof device.jsHeapSizeLimit === 'number'
    ? device.jsHeapSizeLimit / MB
    : undefined;

  if (
    (deviceMemory > 0 && deviceMemory <= 4) ||
    (concurrency > 0 && concurrency <= 4) ||
    (typeof heapLimitMb === 'number' && heapLimitMb > 0 && heapLimitMb < 1536)
  ) {
    return 'low';
  }

  if (
    deviceMemory >= 12 ||
    concurrency >= 12 ||
    (typeof heapLimitMb === 'number' && heapLimitMb >= 3072)
  ) {
    return 'high';
  }

  if (deviceMemory > 0 && deviceMemory < 6) {
    return 'low';
  }

  return 'medium';
}

export function resolveImageCacheBudgetScene(context: ImageCacheBudgetContext): ImageCacheBudgetScene {
  const isImporting = Boolean(context.isImporting) || (context.importingNodeCount ?? 0) > 0;
  if (context.isDragging && isImporting) {
    return 'import-dragging';
  }

  if (context.isDragging) {
    return 'dragging';
  }

  if (isImporting) {
    return 'importing';
  }

  if (context.isIdle) {
    return 'idle';
  }

  return 'default';
}

function resolveDensity(imageNodeCount: number): ImageCacheBudgetProfile['density'] {
  if (imageNodeCount >= 180) {
    return 'large';
  }

  if (imageNodeCount >= 72) {
    return 'medium';
  }

  return 'small';
}

export function resolveImageCacheBudget(
  context: ImageCacheBudgetContext,
  basePolicy: ImageCachePolicy = DEFAULT_IMAGE_CACHE_POLICY
): ImageCacheBudgetResult {
  const imageNodeCount = Math.max(0, context.imageNodeCount);
  const importingNodeCount = Math.max(0, context.importingNodeCount ?? 0);
  const tier = resolveImageCacheBudgetDeviceTier(context.device);
  const scene = resolveImageCacheBudgetScene(context);
  const density = resolveDensity(imageNodeCount);
  const profile: ImageCacheBudgetProfile = {
    tier,
    scene,
    density,
    imageNodeCount,
    importingNodeCount,
    deviceMemoryGb: context.device?.deviceMemoryGb,
    hardwareConcurrency: context.device?.hardwareConcurrency,
    jsHeapSizeLimit: context.device?.jsHeapSizeLimit,
  };

  let policy = { ...basePolicy };
  let heapCanvasCap: number | undefined;
  let heapThumbnailCap: number | undefined;
  let heapOriginalCap: number | undefined;

  switch (tier) {
    case 'low':
      policy = scalePolicy(policy, {
        maxResourceEntries: 0.55,
        maxOriginalEntries: 0.5,
        maxThumbnailEntries: 0.52,
        maxCanvasBytes: 0.42,
        maxOriginalBytes: 0.38,
        maxThumbnailBytes: 0.42,
        protectedCanvasEntryHeadroom: 0.7,
        protectedCanvasByteHeadroom: 0.5,
        invisibleReleaseAfterMs: 0.75,
      });
      break;
    case 'medium':
      policy = scalePolicy(policy, {
        maxResourceEntries: 0.8,
        maxOriginalEntries: 0.8,
        maxThumbnailEntries: 0.82,
        maxCanvasBytes: 0.72,
        maxOriginalBytes: 0.72,
        maxThumbnailBytes: 0.72,
        protectedCanvasEntryHeadroom: 0.85,
        protectedCanvasByteHeadroom: 0.8,
      });
      break;
    default:
      break;
  }

  switch (density) {
    case 'medium':
      policy = scalePolicy(policy, {
        maxResourceEntries: 0.92,
        maxCanvasBytes: 0.9,
        maxThumbnailEntries: 0.92,
        maxThumbnailBytes: 0.9,
        maxOriginalEntries: 0.88,
        maxOriginalBytes: 0.88,
      });
      break;
    case 'large':
      policy = scalePolicy(policy, {
        maxResourceEntries: 0.8,
        maxCanvasBytes: 0.78,
        maxThumbnailEntries: 0.76,
        maxThumbnailBytes: 0.74,
        maxOriginalEntries: 0.72,
        maxOriginalBytes: 0.68,
        protectedCanvasEntryHeadroom: 0.78,
        protectedCanvasByteHeadroom: 0.72,
      });
      break;
    default:
      break;
  }

  switch (scene) {
    case 'dragging':
      policy = scalePolicy(policy, {
        maxResourceEntries: 0.88,
        maxCanvasBytes: 0.82,
        maxThumbnailEntries: 0.84,
        maxThumbnailBytes: 0.8,
        maxOriginalEntries: 0.7,
        maxOriginalBytes: 0.65,
        invisibleReleaseAfterMs: 0.66,
        nearViewportReleaseAfterMs: 1.15,
        recentlyLoadedCanvasProtectionMs: 1.25,
      });
      break;
    case 'importing':
      policy = scalePolicy(policy, {
        maxResourceEntries: 0.94,
        maxCanvasBytes: 0.88,
        maxThumbnailEntries: 0.9,
        maxThumbnailBytes: 0.86,
        maxOriginalEntries: 0.76,
        maxOriginalBytes: 0.7,
        invisibleReleaseAfterMs: 0.72,
        nearViewportReleaseAfterMs: 1.2,
        recentlyLoadedCanvasProtectionMs: 1.35,
      });
      break;
    case 'import-dragging':
      policy = scalePolicy(policy, {
        maxResourceEntries: 0.96,
        maxCanvasBytes: 0.92,
        maxThumbnailEntries: 0.94,
        maxThumbnailBytes: 0.9,
        maxOriginalEntries: 0.64,
        maxOriginalBytes: 0.58,
        invisibleReleaseAfterMs: 1.25,
        nearViewportReleaseAfterMs: 1.4,
        recentlyLoadedCanvasProtectionMs: 1.6,
        protectedCanvasEntryHeadroom: 1.2,
        protectedCanvasByteHeadroom: 1.15,
      });
      break;
    case 'idle':
      policy = scalePolicy(policy, {
        maxResourceEntries: 1.06,
        maxCanvasBytes: 1.04,
        maxThumbnailEntries: 1.08,
        maxThumbnailBytes: 1.06,
        maxOriginalEntries: 1.05,
        maxOriginalBytes: 1.04,
      });
      break;
    default:
      break;
  }

  if (typeof context.device?.jsHeapSizeLimit === 'number' && context.device.jsHeapSizeLimit > 0) {
    const heapLimitBytes = context.device.jsHeapSizeLimit;
    const heapCapRatio = scene === 'idle' ? 0.4 : 0.32;
    heapThumbnailCap = Math.round(heapLimitBytes * heapCapRatio * 0.42);
    heapCanvasCap = Math.round(heapLimitBytes * heapCapRatio * 0.5);
    heapOriginalCap = Math.round(heapLimitBytes * heapCapRatio * 0.22);

    policy.maxThumbnailBytes = Math.min(policy.maxThumbnailBytes, heapThumbnailCap);
    policy.maxCanvasBytes = Math.min(policy.maxCanvasBytes, heapCanvasCap);
    policy.maxOriginalBytes = Math.min(policy.maxOriginalBytes, heapOriginalCap);
  }

  policy.maxResourceEntries = clamp(policy.maxResourceEntries, 72, basePolicy.maxResourceEntries);
  policy.maxOriginalEntries = clamp(policy.maxOriginalEntries, 8, basePolicy.maxOriginalEntries);
  policy.maxThumbnailEntries = clamp(policy.maxThumbnailEntries, 24, basePolicy.maxThumbnailEntries);
  policy.maxCanvasBytes = clamp(policy.maxCanvasBytes, Math.min(160 * MB, heapCanvasCap ?? 160 * MB), basePolicy.maxCanvasBytes);
  policy.maxOriginalBytes = clamp(policy.maxOriginalBytes, Math.min(64 * MB, heapOriginalCap ?? 64 * MB), basePolicy.maxOriginalBytes);
  policy.maxThumbnailBytes = clamp(policy.maxThumbnailBytes, Math.min(128 * MB, heapThumbnailCap ?? 128 * MB), basePolicy.maxThumbnailBytes);
  policy.invisibleReleaseAfterMs = clamp(policy.invisibleReleaseAfterMs, 4_000, basePolicy.invisibleReleaseAfterMs);
  policy.nearViewportReleaseAfterMs = clamp(
    policy.nearViewportReleaseAfterMs,
    Math.max(policy.invisibleReleaseAfterMs, 8_000),
    Math.max(basePolicy.nearViewportReleaseAfterMs, policy.invisibleReleaseAfterMs)
  );
  policy.recentlyLoadedCanvasProtectionMs = clamp(
    policy.recentlyLoadedCanvasProtectionMs,
    8_000,
    basePolicy.recentlyLoadedCanvasProtectionMs
  );
  policy.protectedCanvasEntryHeadroom = clamp(
    policy.protectedCanvasEntryHeadroom,
    4,
    basePolicy.protectedCanvasEntryHeadroom
  );
  policy.protectedCanvasByteHeadroom = clamp(
    policy.protectedCanvasByteHeadroom,
    32 * MB,
    basePolicy.protectedCanvasByteHeadroom
  );

  return {
    policy,
    profile,
  };
}
