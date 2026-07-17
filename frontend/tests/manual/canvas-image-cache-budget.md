# Canvas Image Cache Budget Manual Check

## Enable Debugging

Open the page in development mode and run:

```js
window.__CANVAS_IMAGE_PERF_ENABLE__({ autoReport: true })
```

Disable with:

```js
window.__CANVAS_IMAGE_PERF_DISABLE__()
```

## Read Metrics

Current summary:

```js
window.__CANVAS_IMAGE_PERF_SUMMARY__()
```

Image manager snapshot:

```js
window.__IMAGE_MANAGER_DEBUG__?.()
```

## Key Fields

For `window.__CANVAS_IMAGE_PERF_SUMMARY__().cache`:

- `budgetScene`: expected values are `default`, `dragging`, `importing`, and `idle`.
- `budgetTier`: expected values are `low`, `medium`, and `high`.
- `budgetDensity`: expected values are `small`, `medium`, and `large`.
- `thumbnailEntryLimit`, `resourceEntryLimit`, and `originalEntryLimit`: current dynamic entry limits.
- `maxThumbnailBytes`, `maxCanvasBytes`, and `maxOriginalBytes`: current byte budgets.
- `thumbnailByteUsageRatio`, `canvasByteUsageRatio`, and `originalByteUsageRatio`: budget usage ratios.
- `hitCount` and `missCount`: memory cache hits and misses.
- `evictionCount` and `decodedReleaseCount`: eviction and decoded resource release volume.

For `window.__CANVAS_IMAGE_PERF_SUMMARY__().memorySummary`:

- `latestSample.usedJSHeapSize`: latest sampled heap usage.
- `maxUsedJSHeapSize`: maximum heap usage in the sample window.
- `maxLongTaskDurationSinceLastSample`: whether memory pressure correlates with long tasks.

For `window.__CANVAS_IMAGE_PERF_SUMMARY__().longTaskSummary`:

- `count`: long task count.
- `maxDurationMs`: maximum long task duration.

## Validation Matrix

1. Before import on an empty canvas.
2. During large image import and active dragging.
3. After import completes and the canvas remains idle.
4. After repeated pan/zoom that moves the same image cluster offscreen and back onscreen.
5. After browser refresh with persistent thumbnail/preview cache available.
6. After resource version or hash changes and old persistent cache entries should be ignored.
7. After local source restoration succeeds through FSA.
8. After local source restoration fails or permission is denied.

## Expected Results

- `budgetScene` follows the current interaction: `importing`, `dragging`, then `idle`.
- Thumbnail entries stay protected for near-viewport or recently successful nodes.
- Stable viewport does not show repeated ready -> release -> request-started loops for the same thumbnail.
- Offscreen return reuses memory or persistent cache where possible and reduces real network requests.
- raster/DOM position remains consistent after drag end; no image stays painted at an old canvas position.
- A visible image must always correspond to a clickable/selectable node, not a stale raster-only remnant.
- Persistent thumbnail or preview cache failures fall back to network without breaking node rendering.
- FSA local original recovery does not count as thumbnail cache success; viewer original priority is validated separately.
- Denied or unavailable FSA does not prevent backend thumbnail, preview, or download fallback.
- Heap and long task metrics remain within the existing release baseline.

## Evidence To Record

- Build or branch:
- Dataset size and formats:
- Cache summary before import:
- Cache summary during dragging:
- Cache summary after idle:
- Offscreen return request count:
- raster/DOM consistency result:
- Refresh persistent cache behavior:
- Version or hash invalidation behavior:
- FSA restore result:
- FSA denied or unsupported result:
- Remaining anomalies:
