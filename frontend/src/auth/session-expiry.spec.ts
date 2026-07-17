import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS,
  MIN_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS,
  computeAccessTokenExpiresAt,
  computeRefreshAt,
  computeRefreshDelayMs,
  computeRefreshLeadTimeMs,
  shouldRefreshNow,
} from './session-expiry';

test('computeAccessTokenExpiresAt uses expiresIn seconds relative to now', () => {
  assert.equal(
    computeAccessTokenExpiresAt(3600, 1_000),
    3_601_000,
  );
});

test('computeRefreshLeadTimeMs uses 5 minutes for normal one-hour access tokens', () => {
  assert.equal(
    computeRefreshLeadTimeMs(3600),
    DEFAULT_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS,
  );
});

test('computeRefreshLeadTimeMs shrinks the lead time for short-lived access tokens', () => {
  assert.equal(
    computeRefreshLeadTimeMs(30),
    MIN_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS,
  );
});

test('computeRefreshAt schedules proactive refresh before expiry', () => {
  const expiresAt = computeAccessTokenExpiresAt(3600, 10_000);
  assert.equal(
    computeRefreshAt(expiresAt, 3600),
    expiresAt - DEFAULT_ACCESS_TOKEN_REFRESH_LEAD_TIME_MS,
  );
});

test('computeRefreshDelayMs and shouldRefreshNow switch once refresh window is reached', () => {
  const refreshAt = 55_000;

  assert.equal(computeRefreshDelayMs(refreshAt, 50_000), 5_000);
  assert.equal(shouldRefreshNow(refreshAt, 50_000), false);
  assert.equal(computeRefreshDelayMs(refreshAt, 55_000), 0);
  assert.equal(shouldRefreshNow(refreshAt, 55_000), true);
  assert.equal(computeRefreshDelayMs(refreshAt, 60_000), 0);
  assert.equal(shouldRefreshNow(refreshAt, 60_000), true);
});
