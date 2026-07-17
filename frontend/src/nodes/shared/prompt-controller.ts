export interface NodePromptControllerState {
  draft: string;
  committedPrompt: string;
  isFocused: boolean;
  isComposing: boolean;
  pendingRunPrompt: string | null;
  shouldRunAfterComposition: boolean;
}

export interface NodePromptControllerResult {
  state: NodePromptControllerState;
  committedPrompt: string | null;
  shouldScheduleDebounceCommit: boolean;
  shouldRunNode: boolean;
}

function createPromptControllerResult(
  state: NodePromptControllerState,
  options?: {
    committedPrompt?: string | null;
    shouldScheduleDebounceCommit?: boolean;
    shouldRunNode?: boolean;
  },
): NodePromptControllerResult {
  return {
    state,
    committedPrompt: options?.committedPrompt ?? null,
    shouldScheduleDebounceCommit: options?.shouldScheduleDebounceCommit ?? false,
    shouldRunNode: options?.shouldRunNode ?? false,
  };
}

export function createNodePromptControllerState(
  prompt = '',
): NodePromptControllerState {
  return {
    draft: prompt,
    committedPrompt: prompt,
    isFocused: false,
    isComposing: false,
    pendingRunPrompt: null,
    shouldRunAfterComposition: false,
  };
}

export function syncNodePromptControllerFromExternal(
  state: NodePromptControllerState,
  nextPrompt: string,
): NodePromptControllerResult {
  if (state.isFocused && state.isComposing) {
    return createPromptControllerResult(state);
  }

  if (state.draft === nextPrompt && state.committedPrompt === nextPrompt) {
    return createPromptControllerResult(state);
  }

  return createPromptControllerResult({
    ...state,
    draft: nextPrompt,
    committedPrompt: nextPrompt,
  });
}

export function handleNodePromptFocus(
  state: NodePromptControllerState,
): NodePromptControllerResult {
  return createPromptControllerResult({
    ...state,
    isFocused: true,
  });
}

export function handleNodePromptCompositionStart(
  state: NodePromptControllerState,
): NodePromptControllerResult {
  return createPromptControllerResult({
    ...state,
    isComposing: true,
  });
}

export function handleNodePromptChange(
  state: NodePromptControllerState,
  nextPrompt: string,
  options?: {
    isComposing?: boolean;
  },
): NodePromptControllerResult {
  const nextState: NodePromptControllerState = {
    ...state,
    draft: nextPrompt,
  };

  if (options?.isComposing || state.isComposing) {
    return createPromptControllerResult(nextState);
  }

  return createPromptControllerResult(nextState, {
    shouldScheduleDebounceCommit: true,
  });
}

export function handleNodePromptCompositionEnd(
  state: NodePromptControllerState,
  nextPrompt: string,
): NodePromptControllerResult {
  const shouldCommit = nextPrompt !== state.committedPrompt;
  const shouldRunNode = state.shouldRunAfterComposition && !shouldCommit;

  return createPromptControllerResult({
    ...state,
    draft: nextPrompt,
    committedPrompt: shouldCommit ? nextPrompt : state.committedPrompt,
    isComposing: false,
    pendingRunPrompt: state.shouldRunAfterComposition && shouldCommit
      ? nextPrompt
      : shouldRunNode
        ? null
        : state.pendingRunPrompt,
    shouldRunAfterComposition: false,
  }, {
    committedPrompt: shouldCommit ? nextPrompt : null,
    shouldRunNode,
  });
}

export function handleNodePromptBlur(
  state: NodePromptControllerState,
  nextPrompt: string,
): NodePromptControllerResult {
  const nextState: NodePromptControllerState = {
    ...state,
    draft: nextPrompt,
    isFocused: false,
  };

  if (state.isComposing) {
    return createPromptControllerResult(nextState);
  }

  if (nextPrompt === state.committedPrompt) {
    return createPromptControllerResult(nextState);
  }

  return createPromptControllerResult({
    ...nextState,
    committedPrompt: nextPrompt,
  }, {
    committedPrompt: nextPrompt,
  });
}

export function handleNodePromptRun(
  state: NodePromptControllerState,
): NodePromptControllerResult {
  if (state.isComposing) {
    return createPromptControllerResult({
      ...state,
      shouldRunAfterComposition: true,
    });
  }

  if (state.draft === state.committedPrompt) {
    return createPromptControllerResult({
      ...state,
      pendingRunPrompt: null,
      shouldRunAfterComposition: false,
    }, {
      shouldRunNode: true,
    });
  }

  return createPromptControllerResult({
    ...state,
    committedPrompt: state.draft,
    pendingRunPrompt: state.draft,
    shouldRunAfterComposition: false,
  }, {
    committedPrompt: state.draft,
  });
}

export function settleNodePromptRun(
  state: NodePromptControllerState,
  committedPrompt: string,
): NodePromptControllerResult {
  if (state.pendingRunPrompt === null) {
    return createPromptControllerResult(state);
  }

  if (state.pendingRunPrompt !== committedPrompt) {
    return createPromptControllerResult(state);
  }

  return createPromptControllerResult({
    ...state,
    committedPrompt,
    pendingRunPrompt: null,
  }, {
    shouldRunNode: true,
  });
}
