function isKeyboardInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('.nokey')) {
    return true;
  }

  const nodeName = target.nodeName;
  return nodeName === 'INPUT'
    || nodeName === 'SELECT'
    || nodeName === 'TEXTAREA'
    || target.isContentEditable
    || target.closest('[contenteditable="true"]') !== null;
}

export function isIMEKeyboardEvent(event: KeyboardEvent | React.KeyboardEvent): boolean {
  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
  return nativeEvent.isComposing === true || nativeEvent.key === 'Process';
}

export function shouldIgnoreGlobalKeyboardShortcut(event: KeyboardEvent | React.KeyboardEvent): boolean {
  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
  const target = nativeEvent.composedPath?.()?.[0] ?? nativeEvent.target;

  return isIMEKeyboardEvent(event) || isKeyboardInputElement(target);
}
