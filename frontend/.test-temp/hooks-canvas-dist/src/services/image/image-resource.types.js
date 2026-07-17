var READY_PHASE_BY_VARIANT = {
    thumbnail: 'thumbnail-ready',
    original: 'original-ready',
};
export function resolveImageResourcePhase(input) {
    if (input.status === 'error') {
        return 'error';
    }
    var hasDisplayResource = Boolean(input.src &&
        (input.status === 'ready' ||
            typeof input.loadedAt === 'number' ||
            input.hasDecodedResource));
    if (hasDisplayResource) {
        if (input.activeVariantKind) {
            return READY_PHASE_BY_VARIANT[input.activeVariantKind];
        }
        return input.mode === 'original' ? 'original-ready' : 'thumbnail-ready';
    }
    if (input.status === 'loading') {
        return 'loading';
    }
    return 'idle';
}
export function isImageResourceDisplayReadyPhase(phase, status) {
    if (!phase) {
        return status === 'ready';
    }
    return phase === 'thumbnail-ready' || phase === 'original-ready';
}
export function shouldAutoRequestImageResource(input) {
    if (input.mode === 'original') {
        return false;
    }
    if (!input.src && !input.requestUrl) {
        return false;
    }
    if (!input.visibility.isVisible && !input.visibility.isNearViewport) {
        return false;
    }
    if (input.requestUrl && input.src && input.requestUrl !== input.src) {
        return true;
    }
    return input.status === 'idle';
}
export function resolveImageResourcePlaceholder(input) {
    if (!input.visibility.isVisible && !input.visibility.isNearViewport) {
        return 'hidden';
    }
    if (input.status === 'loading' && !input.hasDisplaySource) {
        return 'loading';
    }
    if (input.status === 'error') {
        return 'unavailable';
    }
    return 'ready';
}
export function createImageResourceReadModel(state) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
        src: state.src,
        status: state.status,
        phase: state.phase,
        error: state.error,
        isVisible: state.visibility.isVisible,
        isNearViewport: state.visibility.isNearViewport,
        displayWidth: state.visibility.displayWidth,
        displayHeight: state.visibility.displayHeight,
        placeholder: resolveImageResourcePlaceholder({
            status: state.status,
            visibility: state.visibility,
            hasDisplaySource: Boolean(state.src),
        }),
        shouldAutoRequest: shouldAutoRequestImageResource({
            mode: state.mode,
            src: state.src,
            requestUrl: state.requestUrl,
            status: state.status,
            visibility: state.visibility,
        }),
        viewer: {
            activeVariantKind: state.activeVariantKind,
            resourcePolicy: state.resourcePolicy,
            resourceRole: state.resourceRole,
        },
        decoded: {
            kind: (_a = state.decodedResource) === null || _a === void 0 ? void 0 : _a.decoded,
            width: (_c = (_b = state.decodedResource) === null || _b === void 0 ? void 0 : _b.width) !== null && _c !== void 0 ? _c : 0,
            height: (_e = (_d = state.decodedResource) === null || _d === void 0 ? void 0 : _d.height) !== null && _e !== void 0 ? _e : 0,
            estimatedBytes: (_g = (_f = state.decodedResource) === null || _f === void 0 ? void 0 : _f.estimatedBytes) !== null && _g !== void 0 ? _g : 0,
        },
        debug: {
            resourcePolicy: state.resourcePolicy,
            resourceRole: state.resourceRole,
            requestKey: state.requestKey,
            preferredUrl: state.preferredUrl,
            lastEventKind: state.lastEventKind,
            lastEventAt: state.lastEventAt,
            lastEventClassification: state.lastEventClassification,
            lastAttemptedUrl: state.lastAttemptedUrl,
            lastEventReason: state.lastEventReason,
            lastSwitchReason: state.lastSwitchReason,
            retryCount: state.retryCount,
            cooldownUntil: state.cooldownUntil,
            retryTrigger: state.retryTrigger,
        },
    };
}
function buildResolvedImageVariantSignature(variant) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!variant) {
        return '';
    }
    return [
        variant.kind,
        variant.url,
        variant.fromLegacy ? 'legacy' : 'resolved',
        (_b = (_a = variant.asset) === null || _a === void 0 ? void 0 : _a.width) !== null && _b !== void 0 ? _b : '',
        (_d = (_c = variant.asset) === null || _c === void 0 ? void 0 : _c.height) !== null && _d !== void 0 ? _d : '',
        (_f = (_e = variant.asset) === null || _e === void 0 ? void 0 : _e.mimeType) !== null && _f !== void 0 ? _f : '',
        (_h = (_g = variant.asset) === null || _g === void 0 ? void 0 : _g.updatedAt) !== null && _h !== void 0 ? _h : '',
    ].join(':');
}
export function getResolvedImageAssetSignature(asset) {
    var _a, _b, _c, _d, _e;
    return [
        (_a = asset.asset.assetId) !== null && _a !== void 0 ? _a : '',
        asset.asset.source,
        asset.asset.version,
        (_c = (_b = asset.asset.intrinsicSize) === null || _b === void 0 ? void 0 : _b.width) !== null && _c !== void 0 ? _c : '',
        (_e = (_d = asset.asset.intrinsicSize) === null || _d === void 0 ? void 0 : _d.height) !== null && _e !== void 0 ? _e : '',
        buildResolvedImageVariantSignature(asset.thumbnail),
        buildResolvedImageVariantSignature(asset.original),
        buildResolvedImageVariantSignature(asset.preferred),
    ].join('|');
}
export function createImageResourceRegistrationKey(input) {
    var _a, _b;
    return [
        input.nodeId,
        (_a = input.mode) !== null && _a !== void 0 ? _a : 'canvas',
        (_b = input.preferredUrl) !== null && _b !== void 0 ? _b : '',
        getResolvedImageAssetSignature(input.resolvedAsset),
    ].join('|');
}
