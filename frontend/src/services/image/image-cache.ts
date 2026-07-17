import type { ImageResourceMode, ImageResourceStatus } from './image-resource.types';

export type ImageCacheEntryKind = 'resource-state' | 'object-url';
export type ImageCacheEvictionReason = 'stale-invisible' | 'stale-original' | 'over-limit';
export type ImageDecodedResourceKind = 'bitmap' | 'image' | 'display-url';
export type ImageResourcePool = 'canvas' | 'original';
export type ImageCacheTier = 'thumbnail' | 'original' | 'unknown';

export interface ImageCacheEntry {
  key: string;
  nodeId: string;
  kind: ImageCacheEntryKind;
  mode?: ImageResourceMode;
  url?: string;
  status?: ImageResourceStatus;
  createdAt: number;
  loadedAt?: number;
  lastAccessAt: number;
  refCount: number;
  isVisible: boolean;
  isNearViewport: boolean;
  byteSize: number;
  decodedKind?: ImageDecodedResourceKind;
  pool?: ImageResourcePool;
  tier?: ImageCacheTier;
}

export interface ImageCacheEntryInput {
  key: string;
  nodeId: string;
  kind: ImageCacheEntryKind;
  mode?: ImageResourceMode;
  url?: string;
  status?: ImageResourceStatus;
  loadedAt?: number;
  lastAccessAt?: number;
  refCount?: number;
  isVisible?: boolean;
  isNearViewport?: boolean;
  byteSize?: number;
  decodedKind?: ImageDecodedResourceKind;
  pool?: ImageResourcePool;
  tier?: ImageCacheTier;
}

export interface ImageCacheEviction {
  key: string;
  nodeId: string;
  kind: ImageCacheEntryKind;
  mode?: ImageResourceMode;
  reason: ImageCacheEvictionReason;
}

export interface ImageCachePolicy {
  maxResourceEntries: number;
  maxOriginalEntries: number;
  maxThumbnailEntries: number;
  maxCanvasBytes: number;
  maxOriginalBytes: number;
  maxThumbnailBytes: number;
  invisibleReleaseAfterMs: number;
  nearViewportReleaseAfterMs: number;
  recentlyLoadedCanvasProtectionMs: number;
  protectedCanvasEntryHeadroom: number;
  protectedCanvasByteHeadroom: number;
}

export interface ImageCacheStats {
  entryCount: number;
  resourceEntryCount: number;
  objectUrlEntryCount: number;
  originalEntryCount: number;
  canvasResourceEntryCount: number;
  visibleEntryCount: number;
  nearViewportEntryCount: number;
  totalBytes: number;
  originalBytes: number;
  canvasBytes: number;
  thumbnailEntryCount: number;
  thumbnailBytes: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  revocationCount: number;
  decodedReleaseCount: number;
  retryAttemptCount: number;
  retrySuppressedCount: number;
  retryRecoveredCount: number;
}

export interface ImageCacheBudgetSnapshot {
  maxResourceEntries: number;
  maxOriginalEntries: number;
  maxThumbnailEntries: number;
  maxCanvasBytes: number;
  maxOriginalBytes: number;
  maxThumbnailBytes: number;
  canvasByteUsageRatio: number;
  originalByteUsageRatio: number;
  thumbnailByteUsageRatio: number;
}

export interface ImageCacheSnapshot {
  policy: ImageCachePolicy;
  stats: ImageCacheStats;
  budget: ImageCacheBudgetSnapshot;
  entries: ImageCacheEntry[];
}

export type ImageCacheEvictionMode = 'soft' | 'normal' | 'full';

interface ImageCacheMutableStats {
  entryCount: number;
  resourceEntryCount: number;
  objectUrlEntryCount: number;
  originalEntryCount: number;
  canvasResourceEntryCount: number;
  visibleEntryCount: number;
  nearViewportEntryCount: number;
  totalBytes: number;
  originalBytes: number;
  canvasBytes: number;
  thumbnailEntryCount: number;
  thumbnailBytes: number;
}

export const DEFAULT_IMAGE_CACHE_POLICY: ImageCachePolicy = {
  maxResourceEntries: 256,
  maxOriginalEntries: 16,
  maxThumbnailEntries: 96,
  maxCanvasBytes: 768 * 1024 * 1024,
  maxOriginalBytes: 192 * 1024 * 1024,
  maxThumbnailBytes: 640 * 1024 * 1024,
  invisibleReleaseAfterMs: 12_000,
  nearViewportReleaseAfterMs: 18_000,
  recentlyLoadedCanvasProtectionMs: 30_000,
  protectedCanvasEntryHeadroom: 16,
  protectedCanvasByteHeadroom: 128 * 1024 * 1024,
};

function normalizePolicy(policy: ImageCachePolicy): ImageCachePolicy {
  return {
    maxResourceEntries: Math.max(0, Math.round(policy.maxResourceEntries)),
    maxOriginalEntries: Math.max(0, Math.round(policy.maxOriginalEntries)),
    maxThumbnailEntries: Math.max(0, Math.round(policy.maxThumbnailEntries)),
    maxCanvasBytes: Math.max(0, Math.round(policy.maxCanvasBytes)),
    maxOriginalBytes: Math.max(0, Math.round(policy.maxOriginalBytes)),
    maxThumbnailBytes: Math.max(0, Math.round(policy.maxThumbnailBytes)),
    invisibleReleaseAfterMs: Math.max(0, Math.round(policy.invisibleReleaseAfterMs)),
    nearViewportReleaseAfterMs: Math.max(0, Math.round(policy.nearViewportReleaseAfterMs)),
    recentlyLoadedCanvasProtectionMs: Math.max(0, Math.round(policy.recentlyLoadedCanvasProtectionMs)),
    protectedCanvasEntryHeadroom: Math.max(0, Math.round(policy.protectedCanvasEntryHeadroom)),
    protectedCanvasByteHeadroom: Math.max(0, Math.round(policy.protectedCanvasByteHeadroom)),
  };
}

function arePoliciesEqual(left: ImageCachePolicy, right: ImageCachePolicy): boolean {
  return left.maxResourceEntries === right.maxResourceEntries &&
    left.maxOriginalEntries === right.maxOriginalEntries &&
    left.maxThumbnailEntries === right.maxThumbnailEntries &&
    left.maxCanvasBytes === right.maxCanvasBytes &&
    left.maxOriginalBytes === right.maxOriginalBytes &&
    left.maxThumbnailBytes === right.maxThumbnailBytes &&
    left.invisibleReleaseAfterMs === right.invisibleReleaseAfterMs &&
    left.nearViewportReleaseAfterMs === right.nearViewportReleaseAfterMs &&
    left.recentlyLoadedCanvasProtectionMs === right.recentlyLoadedCanvasProtectionMs &&
    left.protectedCanvasEntryHeadroom === right.protectedCanvasEntryHeadroom &&
    left.protectedCanvasByteHeadroom === right.protectedCanvasByteHeadroom;
}

export class ImageCache {
  private readonly entries = new Map<string, ImageCacheEntry>();
  private readonly now: () => number;
  private policy: ImageCachePolicy;
  private readonly resourceKeys = new Set<string>();
  private readonly originalResourceKeys = new Set<string>();
  private readonly canvasResourceKeys = new Set<string>();
  private readonly thumbnailResourceKeys = new Set<string>();
  private readonly invisibleOriginalCandidateKeys = new Set<string>();
  private readonly staleInvisibleCanvasCandidateKeys = new Set<string>();
  private readonly overLimitCandidateKeys = new Set<string>();
  private readonly mutableStats: ImageCacheMutableStats = {
    entryCount: 0,
    resourceEntryCount: 0,
    objectUrlEntryCount: 0,
    originalEntryCount: 0,
    canvasResourceEntryCount: 0,
    visibleEntryCount: 0,
    nearViewportEntryCount: 0,
    totalBytes: 0,
    originalBytes: 0,
    canvasBytes: 0,
    thumbnailEntryCount: 0,
    thumbnailBytes: 0,
  };

  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private revocationCount = 0;
  private decodedReleaseCount = 0;
  private retryAttemptCount = 0;
  private retrySuppressedCount = 0;
  private retryRecoveredCount = 0;

  constructor(policy: Partial<ImageCachePolicy> = {}, now: () => number = Date.now) {
    this.policy = normalizePolicy({
      ...DEFAULT_IMAGE_CACHE_POLICY,
      ...policy,
    });
    this.now = now;
  }

  upsert(entry: ImageCacheEntryInput): ImageCacheEntry {
    const existing = this.entries.get(entry.key);
    const now = this.now();
    const hasIdentityChanged =
      !existing ||
      existing.kind !== entry.kind ||
      existing.mode !== entry.mode ||
      existing.url !== entry.url;

    const nextEntry: ImageCacheEntry = {
      key: entry.key,
      nodeId: entry.nodeId,
      kind: entry.kind,
      mode: entry.mode,
      url: entry.url,
      status: entry.status,
      createdAt: hasIdentityChanged ? now : existing.createdAt,
      loadedAt: entry.loadedAt ?? existing?.loadedAt,
      lastAccessAt: entry.lastAccessAt ?? existing?.lastAccessAt ?? now,
      refCount: entry.refCount ?? existing?.refCount ?? 1,
      isVisible: entry.isVisible ?? existing?.isVisible ?? true,
      isNearViewport: entry.isNearViewport ?? existing?.isNearViewport ?? true,
      byteSize: entry.byteSize ?? existing?.byteSize ?? 0,
      decodedKind: entry.decodedKind ?? existing?.decodedKind,
      pool: entry.pool ?? existing?.pool,
      tier: entry.tier ?? existing?.tier ?? 'unknown',
    };

    if (existing) {
      this.removeEntryFromIndexes(existing);
      this.applyEntryStats(existing, -1);
    }

    this.entries.set(entry.key, nextEntry);
    this.applyEntryStats(nextEntry, 1);
    this.indexEntry(nextEntry);
    return nextEntry;
  }

  get(key: string): ImageCacheEntry | undefined {
    return this.entries.get(key);
  }

  remove(key: string): ImageCacheEntry | undefined {
    const existing = this.entries.get(key);
    if (!existing) {
      return undefined;
    }

    this.entries.delete(key);
    this.removeEntryFromIndexes(existing);
    this.applyEntryStats(existing, -1);
    return existing;
  }

  clear(): void {
    this.entries.clear();
    this.resourceKeys.clear();
    this.originalResourceKeys.clear();
    this.canvasResourceKeys.clear();
    this.thumbnailResourceKeys.clear();
    this.invisibleOriginalCandidateKeys.clear();
    this.staleInvisibleCanvasCandidateKeys.clear();
    this.overLimitCandidateKeys.clear();
    this.mutableStats.entryCount = 0;
    this.mutableStats.resourceEntryCount = 0;
    this.mutableStats.objectUrlEntryCount = 0;
    this.mutableStats.originalEntryCount = 0;
    this.mutableStats.canvasResourceEntryCount = 0;
    this.mutableStats.visibleEntryCount = 0;
    this.mutableStats.nearViewportEntryCount = 0;
    this.mutableStats.totalBytes = 0;
    this.mutableStats.originalBytes = 0;
    this.mutableStats.canvasBytes = 0;
    this.mutableStats.thumbnailEntryCount = 0;
    this.mutableStats.thumbnailBytes = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
    this.revocationCount = 0;
    this.decodedReleaseCount = 0;
    this.retryAttemptCount = 0;
    this.retrySuppressedCount = 0;
    this.retryRecoveredCount = 0;
  }

  touch(key: string, refCountDelta = 0): void {
    const existing = this.entries.get(key);
    if (!existing) {
      return;
    }

    this.entries.set(key, {
      ...existing,
      lastAccessAt: this.now(),
      refCount: Math.max(0, existing.refCount + refCountDelta),
    });
    this.refreshCandidateKey(key);
  }

  recordHit(): void {
    this.hitCount += 1;
  }

  recordMiss(): void {
    this.missCount += 1;
  }

  recordEviction(count = 1): void {
    this.evictionCount += count;
  }

  recordRevocation(count = 1): void {
    this.revocationCount += count;
  }

  recordDecodedRelease(count = 1): void {
    this.decodedReleaseCount += count;
  }

  recordRetryAttempt(count = 1): void {
    this.retryAttemptCount += count;
  }

  recordRetrySuppressed(count = 1): void {
    this.retrySuppressedCount += count;
  }

  recordRetryRecovered(count = 1): void {
    this.retryRecoveredCount += count;
  }

  getPolicy(): ImageCachePolicy {
    return { ...this.policy };
  }

  setPolicy(policy: Partial<ImageCachePolicy>): boolean {
    const nextPolicy = normalizePolicy({
      ...this.policy,
      ...policy,
    });

    if (arePoliciesEqual(this.policy, nextPolicy)) {
      return false;
    }

    this.policy = nextPolicy;
    return true;
  }

  getStats(): ImageCacheStats {
    return {
      entryCount: this.mutableStats.entryCount,
      resourceEntryCount: this.mutableStats.resourceEntryCount,
      objectUrlEntryCount: this.mutableStats.objectUrlEntryCount,
      originalEntryCount: this.mutableStats.originalEntryCount,
      canvasResourceEntryCount: this.mutableStats.canvasResourceEntryCount,
      visibleEntryCount: this.mutableStats.visibleEntryCount,
      nearViewportEntryCount: this.mutableStats.nearViewportEntryCount,
      totalBytes: this.mutableStats.totalBytes,
      originalBytes: this.mutableStats.originalBytes,
      canvasBytes: this.mutableStats.canvasBytes,
      thumbnailEntryCount: this.mutableStats.thumbnailEntryCount,
      thumbnailBytes: this.mutableStats.thumbnailBytes,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      revocationCount: this.revocationCount,
      decodedReleaseCount: this.decodedReleaseCount,
      retryAttemptCount: this.retryAttemptCount,
      retrySuppressedCount: this.retrySuppressedCount,
      retryRecoveredCount: this.retryRecoveredCount,
    };
  }

  getBudgetSnapshot(): ImageCacheBudgetSnapshot {
    return {
      maxResourceEntries: this.policy.maxResourceEntries,
      maxOriginalEntries: this.policy.maxOriginalEntries,
      maxThumbnailEntries: this.policy.maxThumbnailEntries,
      maxCanvasBytes: this.policy.maxCanvasBytes,
      maxOriginalBytes: this.policy.maxOriginalBytes,
      maxThumbnailBytes: this.policy.maxThumbnailBytes,
      canvasByteUsageRatio: this.policy.maxCanvasBytes > 0
        ? this.mutableStats.canvasBytes / this.policy.maxCanvasBytes
        : 0,
      originalByteUsageRatio: this.policy.maxOriginalBytes > 0
        ? this.mutableStats.originalBytes / this.policy.maxOriginalBytes
        : 0,
      thumbnailByteUsageRatio: this.policy.maxThumbnailBytes > 0
        ? this.mutableStats.thumbnailBytes / this.policy.maxThumbnailBytes
        : 0,
    };
  }

  getSnapshot(): ImageCacheSnapshot {
    return {
      policy: this.getPolicy(),
      stats: this.getStats(),
      budget: this.getBudgetSnapshot(),
      entries: Array.from(this.entries.values()).sort((left, right) => left.lastAccessAt - right.lastAccessAt),
    };
  }

  collectEvictions(mode: ImageCacheEvictionMode = 'normal'): ImageCacheEviction[] {
    const now = this.now();
    const evictions = new Map<string, ImageCacheEviction>();
    const isProtectedCanvasEntry = (entry: ImageCacheEntry): boolean => this.isProtectedCanvasEntry(entry, now);

    const addEvictions = (entries: ImageCacheEntry[], reason: ImageCacheEvictionReason, limit?: number): void => {
      const remaining = typeof limit === 'number' ? Math.max(0, limit) : Number.POSITIVE_INFINITY;
      let added = 0;

      for (const entry of entries) {
        if (added >= remaining || evictions.has(entry.key)) {
          continue;
        }

        evictions.set(entry.key, {
          key: entry.key,
          nodeId: entry.nodeId,
          kind: entry.kind,
          mode: entry.mode,
          reason,
        });
        added += 1;
      }
    };

    const addEvictionsByBytes = (entries: ImageCacheEntry[], reason: ImageCacheEvictionReason, byteOverflow: number): void => {
      let remainingBytes = Math.max(0, byteOverflow);

      for (const entry of entries) {
        if (remainingBytes <= 0 || evictions.has(entry.key)) {
          continue;
        }

        evictions.set(entry.key, {
          key: entry.key,
          nodeId: entry.nodeId,
          kind: entry.kind,
          mode: entry.mode,
          reason,
        });
        remainingBytes -= Math.max(entry.byteSize, 1);
      }
    };

    const invisibleOriginals = this.collectCandidateEntries(
      this.invisibleOriginalCandidateKeys,
      (entry) => (
        entry.mode === 'original' &&
        entry.status === 'ready' &&
        !entry.isVisible &&
        now - entry.lastAccessAt >= this.policy.invisibleReleaseAfterMs
      )
    );
    addEvictions(invisibleOriginals, 'stale-original');

    if (mode === 'soft') {
      return Array.from(evictions.values());
    }

    const invisibleCanvasEntries = this.collectCandidateEntries(
      this.staleInvisibleCanvasCandidateKeys,
      (entry) => (
        entry.mode === 'canvas' &&
        entry.status === 'ready' &&
        !entry.isVisible &&
        !entry.isNearViewport &&
        !isProtectedCanvasEntry(entry) &&
        now - entry.lastAccessAt >= this.policy.invisibleReleaseAfterMs
      )
    );
    addEvictions(invisibleCanvasEntries, 'stale-invisible');

    const originalOverflow = this.mutableStats.originalEntryCount - this.policy.maxOriginalEntries;
    if (originalOverflow > 0) {
      const candidates = this.collectCandidateEntries(
        this.overLimitCandidateKeys,
        (entry) => entry.mode === 'original' && !evictions.has(entry.key)
      );
      addEvictions(candidates, 'over-limit', originalOverflow);
    }

    const originalByteOverflow = this.mutableStats.originalBytes - this.policy.maxOriginalBytes;
    if (originalByteOverflow > 0) {
      const candidates = this.collectCandidateEntries(
        this.overLimitCandidateKeys,
        (entry) => entry.mode === 'original' && !evictions.has(entry.key)
      );
      addEvictionsByBytes(candidates, 'over-limit', originalByteOverflow);
    }

    const thumbnailEntries = this.collectEntriesByKeys(this.thumbnailResourceKeys);
    const protectedThumbnailEntries = thumbnailEntries.filter(isProtectedCanvasEntry);
    const effectiveThumbnailEntryLimit = protectedThumbnailEntries.length > this.policy.maxThumbnailEntries
      ? protectedThumbnailEntries.length + this.policy.protectedCanvasEntryHeadroom
      : this.policy.maxThumbnailEntries;
    const thumbnailOverflow = this.mutableStats.thumbnailEntryCount - effectiveThumbnailEntryLimit;
    if (thumbnailOverflow > 0) {
      const candidates = this.collectCandidateEntries(
        this.overLimitCandidateKeys,
        (entry) => entry.tier === 'thumbnail' && !evictions.has(entry.key) && !isProtectedCanvasEntry(entry)
      );
      addEvictions(candidates, 'over-limit', thumbnailOverflow);
    }

    const protectedThumbnailBytes = protectedThumbnailEntries.reduce((sum, entry) => sum + entry.byteSize, 0);
    const effectiveThumbnailByteLimit = protectedThumbnailBytes > this.policy.maxThumbnailBytes
      ? protectedThumbnailBytes + this.policy.protectedCanvasByteHeadroom
      : this.policy.maxThumbnailBytes;
    const thumbnailByteOverflow = this.mutableStats.thumbnailBytes - effectiveThumbnailByteLimit;
    if (thumbnailByteOverflow > 0) {
      const candidates = this.collectCandidateEntries(
        this.overLimitCandidateKeys,
        (entry) => entry.tier === 'thumbnail' && !evictions.has(entry.key) && !isProtectedCanvasEntry(entry)
      );
      addEvictionsByBytes(candidates, 'over-limit', thumbnailByteOverflow);
    }

    const canvasByteOverflow = this.mutableStats.canvasBytes - this.policy.maxCanvasBytes;
    if (canvasByteOverflow > 0) {
      const candidates = this.collectCandidateEntries(
        this.overLimitCandidateKeys,
        (entry) => entry.mode === 'canvas' && !evictions.has(entry.key) && !isProtectedCanvasEntry(entry)
      );
      addEvictionsByBytes(candidates, 'over-limit', canvasByteOverflow);
    }

    if (mode === 'normal') {
      return Array.from(evictions.values());
    }

    const resourceEntries = this.collectEntriesByKeys(this.resourceKeys);
    const protectedResourceEntries = resourceEntries.filter(isProtectedCanvasEntry);
    const effectiveResourceEntryLimit = protectedResourceEntries.length > this.policy.maxResourceEntries
      ? protectedResourceEntries.length + this.policy.protectedCanvasEntryHeadroom
      : this.policy.maxResourceEntries;
    const overflow = this.mutableStats.resourceEntryCount - effectiveResourceEntryLimit - evictions.size;
    if (overflow > 0) {
      const candidates = this.collectCandidateEntries(
        this.overLimitCandidateKeys,
        (entry) => !evictions.has(entry.key) && !isProtectedCanvasEntry(entry)
      );
      addEvictions(candidates, 'over-limit', overflow);
    }

    return Array.from(evictions.values());
  }

  private readonly compareEvictionPriority = (left: ImageCacheEntry, right: ImageCacheEntry): number => {
    const rankDelta = this.getEvictionRank(left) - this.getEvictionRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    return left.lastAccessAt - right.lastAccessAt;
  };

  private getEvictionRank(entry: ImageCacheEntry): number {
    if (entry.kind === 'object-url') {
      return 10;
    }

    if (this.isProtectedCanvasEntry(entry, this.now())) {
      return 20;
    }

    if (entry.mode === 'original' && !entry.isVisible) {
      return 0;
    }

    if (entry.mode === 'original' && !entry.isNearViewport) {
      return 1;
    }

    if (entry.mode === 'canvas' && !entry.isVisible && !entry.isNearViewport) {
      return entry.tier === 'thumbnail' ? 4 : 3;
    }

    if (entry.mode === 'original') {
      return 5;
    }

    if (entry.tier === 'thumbnail' && !entry.isVisible) {
      return 6;
    }

    if (entry.tier === 'thumbnail' && !entry.isNearViewport) {
      return 7;
    }

    if (!entry.isVisible) {
      return entry.tier === 'thumbnail' ? 9 : 8;
    }

    if (!entry.isNearViewport) {
      return entry.tier === 'thumbnail' ? 11 : 10;
    }

    if (entry.tier === 'thumbnail') {
      return 13;
    }

    return 12;
  }

  private isProtectedCanvasEntry(entry: ImageCacheEntry, now: number): boolean {
    if (
      entry.kind !== 'resource-state' ||
      entry.mode !== 'canvas' ||
      entry.status !== 'ready' ||
      entry.tier !== 'thumbnail'
    ) {
      return false;
    }

      if (entry.isVisible || entry.isNearViewport) {
      return true;
    }

    if (now - entry.lastAccessAt <= this.policy.nearViewportReleaseAfterMs) {
      return true;
    }

    return typeof entry.loadedAt === 'number' &&
      now - entry.loadedAt <= this.policy.recentlyLoadedCanvasProtectionMs;
  }

  private applyEntryStats(entry: ImageCacheEntry, direction: 1 | -1): void {
    this.mutableStats.entryCount += direction;
    if (entry.kind === 'resource-state') {
      this.mutableStats.resourceEntryCount += direction;
      this.mutableStats.totalBytes += entry.byteSize * direction;

      if (entry.mode === 'original') {
        this.mutableStats.originalEntryCount += direction;
        this.mutableStats.originalBytes += entry.byteSize * direction;
      }

      if (entry.mode === 'canvas') {
        this.mutableStats.canvasResourceEntryCount += direction;
        this.mutableStats.canvasBytes += entry.byteSize * direction;
      }

      if (entry.tier === 'thumbnail') {
        this.mutableStats.thumbnailEntryCount += direction;
        this.mutableStats.thumbnailBytes += entry.byteSize * direction;
      }
    } else if (entry.kind === 'object-url') {
      this.mutableStats.objectUrlEntryCount += direction;
    }

    if (entry.isVisible) {
      this.mutableStats.visibleEntryCount += direction;
    }

    if (entry.isNearViewport) {
      this.mutableStats.nearViewportEntryCount += direction;
    }
  }

  private indexEntry(entry: ImageCacheEntry): void {
    if (entry.kind === 'resource-state') {
      this.resourceKeys.add(entry.key);
      if (entry.mode === 'original') {
        this.originalResourceKeys.add(entry.key);
      }
      if (entry.mode === 'canvas') {
        this.canvasResourceKeys.add(entry.key);
      }
      if (entry.tier === 'thumbnail') {
        this.thumbnailResourceKeys.add(entry.key);
      }
    }

    this.refreshCandidateKey(entry.key);
  }

  private removeEntryFromIndexes(entry: ImageCacheEntry): void {
    this.resourceKeys.delete(entry.key);
    this.originalResourceKeys.delete(entry.key);
    this.canvasResourceKeys.delete(entry.key);
    this.thumbnailResourceKeys.delete(entry.key);
    this.invisibleOriginalCandidateKeys.delete(entry.key);
    this.staleInvisibleCanvasCandidateKeys.delete(entry.key);
    this.overLimitCandidateKeys.delete(entry.key);
  }

  private refreshCandidateKey(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.kind !== 'resource-state') {
      this.invisibleOriginalCandidateKeys.delete(key);
      this.staleInvisibleCanvasCandidateKeys.delete(key);
      this.overLimitCandidateKeys.delete(key);
      return;
    }

    if (entry.mode === 'original' && entry.status === 'ready' && !entry.isVisible) {
      this.invisibleOriginalCandidateKeys.add(key);
    } else {
      this.invisibleOriginalCandidateKeys.delete(key);
    }

    if (entry.mode === 'canvas' && entry.status === 'ready' && !entry.isVisible && !entry.isNearViewport) {
      this.staleInvisibleCanvasCandidateKeys.add(key);
    } else {
      this.staleInvisibleCanvasCandidateKeys.delete(key);
    }

    this.overLimitCandidateKeys.add(key);
  }

  private collectEntriesByKeys(keys: Iterable<string>): ImageCacheEntry[] {
    const entries: ImageCacheEntry[] = [];
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  private collectCandidateEntries(
    keys: Iterable<string>,
    predicate: (entry: ImageCacheEntry) => boolean
  ): ImageCacheEntry[] {
    const entries: ImageCacheEntry[] = [];
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (!entry) {
        continue;
      }
      if (predicate(entry)) {
        entries.push(entry);
      }
    }

    return entries.sort(this.compareEvictionPriority);
  }
}
