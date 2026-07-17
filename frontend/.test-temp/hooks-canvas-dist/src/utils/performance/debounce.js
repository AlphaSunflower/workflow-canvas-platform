export function debounce(fn, delay) {
    var timeoutId = null;
    var lastArgs = null;
    var debounced = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        lastArgs = args;
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(function () {
            if (lastArgs) {
                fn.apply(void 0, lastArgs);
            }
            timeoutId = null;
            lastArgs = null;
        }, delay);
    };
    debounced.cancel = function () {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        lastArgs = null;
    };
    debounced.flush = function () {
        if (timeoutId && lastArgs) {
            clearTimeout(timeoutId);
            fn.apply(void 0, lastArgs);
            timeoutId = null;
            lastArgs = null;
        }
    };
    return debounced;
}
