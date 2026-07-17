export function throttle(fn, limit) {
    var inThrottle = false;
    var lastArgs = null;
    var timeoutId = null;
    var throttled = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (!inThrottle) {
            fn.apply(void 0, args);
            inThrottle = true;
            timeoutId = setTimeout(function () {
                inThrottle = false;
                timeoutId = null;
                if (lastArgs) {
                    throttled.apply(void 0, lastArgs);
                    lastArgs = null;
                }
            }, limit);
        }
        else {
            lastArgs = args;
        }
    };
    throttled.cancel = function () {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        inThrottle = false;
        lastArgs = null;
    };
    throttled.flush = function () {
        if (lastArgs) {
            fn.apply(void 0, lastArgs);
            lastArgs = null;
        }
    };
    return throttled;
}
