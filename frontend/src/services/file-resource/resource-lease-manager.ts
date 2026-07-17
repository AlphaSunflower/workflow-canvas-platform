import {
  createFileResourceManifestKey,
  fileManifestStore,
  type FileManifestStore,
} from './file-manifest-store';
import type {
  FileResourceLease,
  FileResourceLeaseAcquireOptions,
  FileResourceLeaseReason,
  FileResourceLeaseSnapshot,
  FileResourceManifestKey,
} from './file-resource.types';

interface ResourceLeaseManagerOptions {
  defaultTtlMs?: number | null;
  getNow?: () => number;
  createLeaseId?: () => string;
  manifestStore?: FileManifestStore;
}

function normalizeLeaseIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function createDefaultLeaseIdFactory(): () => string {
  let sequence = 0;
  return (): string => {
    sequence += 1;
    return `file-resource-lease-${sequence}`;
  };
}

function normalizeTtl(
  ttlMs: number | null | undefined,
  defaultTtlMs: number | null,
): number | null {
  const candidate = ttlMs === undefined ? defaultTtlMs : ttlMs;
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    ? candidate
    : null;
}

export class ResourceLeaseManager {
  private readonly leases = new Map<string, FileResourceLease>();
  private readonly createLeaseId: () => string;
  private readonly getNow: () => number;
  private readonly defaultTtlMs: number | null;
  private readonly manifestStore: FileManifestStore;

  constructor(options: ResourceLeaseManagerOptions = {}) {
    this.createLeaseId = options.createLeaseId ?? createDefaultLeaseIdFactory();
    this.getNow = options.getNow ?? (() => Date.now());
    this.defaultTtlMs = normalizeTtl(options.defaultTtlMs, null);
    this.manifestStore = options.manifestStore ?? fileManifestStore;
  }

  acquireLease(
    key: FileResourceManifestKey,
    reason: FileResourceLeaseReason,
    owner: string,
    options: FileResourceLeaseAcquireOptions = {},
  ): FileResourceLease {
    const now = this.getNow();
    const ttlMs = normalizeTtl(options.ttlMs, this.defaultTtlMs);
    const leaseId = this.createUniqueLeaseId(key, now);
    const lease: FileResourceLease = {
      leaseId,
      key,
      nodeId: key.nodeId,
      fileId: key.fileId,
      reason,
      owner,
      acquiredAt: now,
      expiresAt: ttlMs ? now + ttlMs : null,
      releasedAt: null,
    };

    this.leases.set(leaseId, lease);
    this.syncManifestLeaseCount(key);
    return lease;
  }

  releaseLease(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) {
      return false;
    }

    this.leases.delete(leaseId);
    this.syncManifestLeaseCount(lease.key);
    return true;
  }

  releaseOwner(owner: string): number {
    let releasedCount = 0;
    const affectedKeys: FileResourceManifestKey[] = [];

    Array.from(this.leases.values()).forEach((lease) => {
      if (lease.owner !== owner) {
        return;
      }

      this.leases.delete(lease.leaseId);
      affectedKeys.push(lease.key);
      releasedCount += 1;
    });
    this.syncUniqueKeys(affectedKeys);
    return releasedCount;
  }

  expireStaleLeases(now = this.getNow()): number {
    let expiredCount = 0;
    const affectedKeys: FileResourceManifestKey[] = [];

    Array.from(this.leases.values()).forEach((lease) => {
      if (lease.expiresAt === null || lease.expiresAt > now) {
        return;
      }

      this.leases.delete(lease.leaseId);
      affectedKeys.push(lease.key);
      expiredCount += 1;
    });
    this.syncUniqueKeys(affectedKeys);
    return expiredCount;
  }

  isLeased(key: FileResourceManifestKey): boolean {
    return this.getLeaseCount(key) > 0;
  }

  getLeaseCount(key: FileResourceManifestKey): number {
    const resourceKey = createFileResourceManifestKey(key);
    let count = 0;

    this.leases.forEach((lease) => {
      if (createFileResourceManifestKey(lease.key) === resourceKey) {
        count += 1;
      }
    });

    return count;
  }

  getLeaseSnapshot(): FileResourceLeaseSnapshot {
    const leasedKeys = new Set<string>();
    const leases = Array.from(this.leases.values());
    leases.forEach((lease) => {
      leasedKeys.add(createFileResourceManifestKey(lease.key));
    });

    return {
      leases,
      leasedResourceCount: leasedKeys.size,
    };
  }

  clear(): void {
    const affectedKeys = Array.from(this.leases.values(), (lease) => lease.key);
    this.leases.clear();
    this.syncUniqueKeys(affectedKeys);
  }

  private syncUniqueKeys(keys: FileResourceManifestKey[]): void {
    const seen = new Set<string>();
    keys.forEach((key) => {
      const manifestKey = createFileResourceManifestKey(key);
      if (seen.has(manifestKey)) {
        return;
      }

      seen.add(manifestKey);
      this.syncManifestLeaseCount(key);
    });
  }

  private syncManifestLeaseCount(key: FileResourceManifestKey): void {
    this.manifestStore.upsert({
      key,
      leaseCount: this.getLeaseCount(key),
    });
  }

  private createUniqueLeaseId(key: FileResourceManifestKey, now: number): string {
    const fallbackPrefix = `file-resource-lease-${normalizeLeaseIdPart(key.nodeId)}-${normalizeLeaseIdPart(key.fileId)}-${now}`;
    const rawLeaseId = this.createLeaseId().trim();
    const baseLeaseId = rawLeaseId.length > 0 ? rawLeaseId : fallbackPrefix;
    let leaseId = baseLeaseId;
    let suffix = 1;

    while (this.leases.has(leaseId)) {
      suffix += 1;
      leaseId = `${baseLeaseId}-${suffix}`;
    }

    return leaseId;
  }
}

export const fileResourceLeaseManager = new ResourceLeaseManager();
