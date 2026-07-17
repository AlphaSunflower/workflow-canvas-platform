import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNodePromptControllerState,
  handleNodePromptBlur,
  handleNodePromptChange,
  handleNodePromptCompositionEnd,
  handleNodePromptCompositionStart,
  handleNodePromptFocus,
  handleNodePromptRun,
  settleNodePromptRun,
  syncNodePromptControllerFromExternal,
} from './prompt-controller';

test('shared node prompt composition flow does not commit during composition and commits final prompt after composition end', () => {
  let state = createNodePromptControllerState('');

  state = handleNodePromptFocus(state).state;
  state = handleNodePromptCompositionStart(state).state;

  const composingChange = handleNodePromptChange(state, 'ni', { isComposing: true });
  state = composingChange.state;

  assert.equal(composingChange.committedPrompt, null);
  assert.equal(composingChange.shouldScheduleDebounceCommit, false);
  assert.equal(state.draft, 'ni');
  assert.equal(state.committedPrompt, '');

  const compositionEnd = handleNodePromptCompositionEnd(state, '你好');
  state = compositionEnd.state;

  assert.equal(compositionEnd.committedPrompt, '你好');
  assert.equal(compositionEnd.shouldRunNode, false);
  assert.equal(state.draft, '你好');
  assert.equal(state.committedPrompt, '你好');
  assert.equal(state.isComposing, false);
});

test('shared node prompt blur commits latest prompt outside composition', () => {
  let state = createNodePromptControllerState('old prompt');

  state = handleNodePromptFocus(state).state;
  const change = handleNodePromptChange(state, 'new prompt');
  state = change.state;

  assert.equal(change.shouldScheduleDebounceCommit, true);
  assert.equal(change.committedPrompt, null);

  const blur = handleNodePromptBlur(state, 'new prompt');
  state = blur.state;

  assert.equal(blur.committedPrompt, 'new prompt');
  assert.equal(state.committedPrompt, 'new prompt');
  assert.equal(state.isFocused, false);
});

test('shared node prompt run waits for composition end final text before running', () => {
  let state = createNodePromptControllerState('old prompt');

  state = handleNodePromptFocus(state).state;
  state = handleNodePromptCompositionStart(state).state;
  state = handleNodePromptChange(state, 'zhong', { isComposing: true }).state;

  const runWhileComposing = handleNodePromptRun(state);
  state = runWhileComposing.state;

  assert.equal(runWhileComposing.committedPrompt, null);
  assert.equal(runWhileComposing.shouldRunNode, false);
  assert.equal(state.shouldRunAfterComposition, true);

  const compositionEnd = handleNodePromptCompositionEnd(state, '中文');
  state = compositionEnd.state;

  assert.equal(compositionEnd.committedPrompt, '中文');
  assert.equal(compositionEnd.shouldRunNode, false);
  assert.equal(state.pendingRunPrompt, '中文');

  const settle = settleNodePromptRun(state, '中文');
  state = settle.state;

  assert.equal(settle.shouldRunNode, true);
  assert.equal(state.pendingRunPrompt, null);
  assert.equal(state.committedPrompt, '中文');
});

test('shared node prompt external sync preserves focused composition draft but syncs otherwise', () => {
  let state = createNodePromptControllerState('saved prompt');

  state = handleNodePromptFocus(state).state;
  state = handleNodePromptCompositionStart(state).state;
  state = handleNodePromptChange(state, 'zhong', { isComposing: true }).state;

  const preserve = syncNodePromptControllerFromExternal(state, 'server prompt');
  assert.equal(preserve.state.draft, 'zhong');
  assert.equal(preserve.state.committedPrompt, 'saved prompt');

  const compositionEnd = handleNodePromptCompositionEnd(state, '中文');
  state = compositionEnd.state;

  const sync = syncNodePromptControllerFromExternal(state, 'server prompt');
  assert.equal(sync.state.draft, 'server prompt');
  assert.equal(sync.state.committedPrompt, 'server prompt');
});
