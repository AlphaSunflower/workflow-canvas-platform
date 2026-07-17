var PREVIEW_UPGRADE_MIN_VISIBILITY_SCORE = 0.52;
var PREVIEW_UPGRADE_REQUEUE_VISIBILITY_SCORE = 0.62;
var PREVIEW_UPGRADE_MIN_VISIBLE_AREA_RATIO = 0.18;
var PREVIEW_UPGRADE_CANCEL_VISIBILITY_SCORE = 0.18;
var PREVIEW_UPGRADE_CANCEL_VISIBLE_AREA_RATIO = 0.04;
var IMPORT_PREVIEW_UPGRADE_MIN_VISIBLE_AREA_RATIO = 0.02;
var PRIORITY_VISIBILITY_SCORE = 0.8;
var DISPLAY_SIZE_BUCKET_STEP = 96;
export function deriveVisibilityBucketState(input) {
    var visibilityBucket = resolveVisibilityBucket(input);
    var visibilityScoreBucket = resolveVisibilityScoreBucket(input);
    var visibilityAreaBucket = resolveVisibilityAreaBucket(input.visibleAreaRatio);
    return {
        visibilityBucket: visibilityBucket,
        visibilityScoreBucket: visibilityScoreBucket,
        visibilityAreaBucket: visibilityAreaBucket,
        displayWidthBucket: resolveDisplayBucket(input.displayWidth),
        displayHeightBucket: resolveDisplayBucket(input.displayHeight),
    };
}
export function shouldEmitVisibilityDiff(previous, next) {
    if (!previous) {
        return true;
    }
    return previous.visibilityBucket !== next.visibilityBucket ||
        previous.visibilityScoreBucket !== next.visibilityScoreBucket ||
        previous.visibilityAreaBucket !== next.visibilityAreaBucket ||
        previous.displayWidthBucket !== next.displayWidthBucket ||
        previous.displayHeightBucket !== next.displayHeightBucket;
}
function resolveVisibilityBucket(input) {
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
function resolveVisibilityScoreBucket(input) {
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
function resolveVisibilityAreaBucket(visibleAreaRatio) {
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
export function resolveDisplayBucket(value) {
    return Math.max(0, Math.round(Math.max(0, value) / DISPLAY_SIZE_BUCKET_STEP));
}
