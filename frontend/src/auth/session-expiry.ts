export const DEFAULT_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS = 5 * 60 * 1000;
export const MIN_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS = 5 * 1000;
export const MIN_ACCESS_TOKEN_REFRESH_DELAY_MS = 1 * 1000;

const SHORT_LIVED_ACCESS_TOKEN_LEAD_RATIO = 0.1;

function normalizeDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return durationMs;
}

function clampRefreshLeadTimeMs(ttlMs: number): number {
  const normalizedTtlMs = normalizeDurationMs(ttlMs);

  if (normalizedTtlMs <= MIN_ACCESS_TOKEN_REFRESH_DELAY_MS) {
    return 0;
  }

  const desiredLeadTimeMs = Math.min(
    DEFAULT_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS,
    Math.max(
      MIN_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS,
      Math.floor(normalizedTtlMs * SHORT_LIVED_ACCESS_TOKEN_LEAD_RATIO),
    ),
  );

  return Math.min(
    desiredLeadTimeMs,
    normalizedTtlMs - MIN_ACCESS_TOKEN_REFRESH_DELAY_MS,
  );
}

export function computeAccessTokenExpiresAt(expiresInSeconds: number, now = Date.now()): number {
  return now + normalizeDurationMs(expiresInSeconds * 1000);
}

export function computeRefreshLeadTimeMs(expiresInSeconds: number): number {
  return clampRefreshLeadTimeMs(expiresInSeconds * 1000);
}

export function computeRefreshAt(expiresAt: number, expiresInSeconds: number): number {
  return Math.max(
    0,
    expiresAt - computeRefreshLeadTimeMs(expiresInSeconds),
  );
}

export function computeRefreshDelayMs(refreshAt: number, now = Date.now()): number {
  return normalizeDurationMs(refreshAt - now);
}

export function shouldRefreshNow(refreshAt: number, now = Date.now()): boolean {
  return computeRefreshDelayMs(refreshAt, now) === 0;
}
