const REFRESH_TOKEN_STORAGE_KEY = 'newworkflow.auth.refresh-token';
const REFRESH_LOCK_STORAGE_KEY = 'newworkflow.auth.refresh-lock';

export interface SessionRefreshLockRecord {
  ownerTabId: string;
  requestId: string;
  acquiredAt: number;
  expiresAt: number;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStorageValue(key: string): string | null {
  if (!canUseStorage()) {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStorageValue(key: string, value: string): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, value);
}

function removeStorageValue(key: string): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(key);
}

function parseRefreshLockRecord(rawValue: string | null): SessionRefreshLockRecord | null {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<SessionRefreshLockRecord>;
    if (
      typeof parsed.ownerTabId !== 'string'
      || typeof parsed.requestId !== 'string'
      || typeof parsed.acquiredAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }

    return {
      ownerTabId: parsed.ownerTabId,
      requestId: parsed.requestId,
      acquiredAt: parsed.acquiredAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function getStoredRefreshToken(): string | null {
  const token = readStorageValue(REFRESH_TOKEN_STORAGE_KEY);
  return typeof token === 'string' && token.trim().length > 0 ? token : null;
}

export function setStoredRefreshToken(refreshToken: string): void {
  writeStorageValue(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
}

export function clearStoredSession(): void {
  removeStorageValue(REFRESH_TOKEN_STORAGE_KEY);
}

export function getStoredRefreshLock(): SessionRefreshLockRecord | null {
  return parseRefreshLockRecord(readStorageValue(REFRESH_LOCK_STORAGE_KEY));
}

export function getActiveRefreshLock(now = Date.now()): SessionRefreshLockRecord | null {
  const lockRecord = getStoredRefreshLock();

  if (!lockRecord) {
    return null;
  }

  if (lockRecord.expiresAt <= now) {
    removeStorageValue(REFRESH_LOCK_STORAGE_KEY);
    return null;
  }

  return lockRecord;
}

export function tryAcquireRefreshLock(lockRecord: SessionRefreshLockRecord, now = Date.now()): boolean {
  if (!canUseStorage()) {
    return true;
  }

  const activeLock = getActiveRefreshLock(now);
  if (activeLock && activeLock.ownerTabId !== lockRecord.ownerTabId) {
    return false;
  }

  writeStorageValue(REFRESH_LOCK_STORAGE_KEY, JSON.stringify(lockRecord));

  const confirmedLock = getStoredRefreshLock();
  return confirmedLock?.ownerTabId === lockRecord.ownerTabId
    && confirmedLock.requestId === lockRecord.requestId;
}

export function releaseRefreshLock(ownerTabId: string, requestId?: string): void {
  const activeLock = getStoredRefreshLock();

  if (!activeLock) {
    return;
  }

  if (activeLock.ownerTabId !== ownerTabId) {
    return;
  }

  if (typeof requestId === 'string' && activeLock.requestId !== requestId) {
    return;
  }

  removeStorageValue(REFRESH_LOCK_STORAGE_KEY);
}
