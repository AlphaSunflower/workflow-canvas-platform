function isKeyboardInputElement(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.closest('.nokey')) {
        return true;
    }
    var nodeName = target.nodeName;
    return nodeName === 'INPUT'
        || nodeName === 'SELECT'
        || nodeName === 'TEXTAREA'
        || target.isContentEditable
        || target.closest('[contenteditable="true"]') !== null;
}
export function isIMEKeyboardEvent(event) {
    var nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
    return nativeEvent.isComposing === true || nativeEvent.key === 'Process';
}
export function shouldIgnoreGlobalKeyboardShortcut(event) {
    var _a, _b, _c;
    var nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
    var target = (_c = (_b = (_a = nativeEvent.composedPath) === null || _a === void 0 ? void 0 : _a.call(nativeEvent)) === null || _b === void 0 ? void 0 : _b[0]) !== null && _c !== void 0 ? _c : nativeEvent.target;
    return isIMEKeyboardEvent(event) || isKeyboardInputElement(target);
}
