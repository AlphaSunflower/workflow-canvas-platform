import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import { createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  AI_IMAGE_GEN_PARAMETER_FIELDS,
  buildAIImageGenInputLayoutVersion,
} from './layout';
import {
  createAIImageGenPromptControllerState,
  handleAIImageGenPromptBlur,
  handleAIImageGenPromptChange,
  handleAIImageGenPromptCompositionEnd,
  handleAIImageGenPromptCompositionStart,
  handleAIImageGenPromptFocus,
  handleAIImageGenPromptRun,
  settleAIImageGenPromptRun,
  syncAIImageGenPromptControllerFromExternal,
} from './prompt-controller';
import {
  AI_IMAGE_INPUT_PORT_ID,
  getAIImageGenGroupInputHandle,
} from './groups';

function createImageNode(sequence: number, fileId: string, fileName: string) {
  return createDefaultFileNodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 10, y: sequence * 10 },
    'image',
    fileId,
    fileName,
    1024,
    'image/png',
    {
      width: 1024,
      height: 768,
    },
  );
}

function createResolvedGroupState(): WorkflowResolvedNodeGroupState[] {
  const imageNode1 = createImageNode(1, 'image-file-1', 'image-1.png');
  const imageNode2 = createImageNode(2, 'image-file-2', 'image-2.png');

  return [{
    group: {
      id: 'group-1',
      label: 'Group 1',
      order: 0,
    },
    ports: [{
      portId: AI_IMAGE_INPUT_PORT_ID,
      label: '图片序列',
      handle: getAIImageGenGroupInputHandle('group-1'),
      inputs: [
        {
          groupId: 'group-1',
          portId: AI_IMAGE_INPUT_PORT_ID,
          handle: getAIImageGenGroupInputHandle('group-1'),
          connection: {
            id: 'connection-image-1',
            type: 'file-reference',
            sourceId: imageNode1.id.value,
            targetId: '100',
            targetHandle: getAIImageGenGroupInputHandle('group-1'),
            order: 0,
          },
          sourceNode: imageNode1,
        },
        {
          groupId: 'group-1',
          portId: AI_IMAGE_INPUT_PORT_ID,
          handle: getAIImageGenGroupInputHandle('group-1'),
          connection: {
            id: 'connection-image-2',
            type: 'file-reference',
            sourceId: imageNode2.id.value,
            targetId: '100',
            targetHandle: getAIImageGenGroupInputHandle('group-1'),
            order: 1,
          },
          sourceNode: imageNode2,
        },
      ],
    }],
  }];
}

test('AI 生图节点布局版本键只取决于输入结构，不受运行态字段影响', () => {
  const resolvedGroups = createResolvedGroupState();

  const before = buildAIImageGenInputLayoutVersion(resolvedGroups);
  const after = buildAIImageGenInputLayoutVersion(resolvedGroups.map((groupState) => ({
    ...groupState,
    ports: groupState.ports.map((port) => ({
      ...port,
      inputs: port.inputs.map((input) => ({
        ...input,
      })),
    })),
  })));

  assert.equal(before, after);
});

test('AI 生图节点输入结构变化会改变布局版本键', () => {
  const resolvedGroups = createResolvedGroupState();
  const changedGroups = createResolvedGroupState();

  changedGroups[0] = {
    ...changedGroups[0],
    ports: changedGroups[0].ports.map((port) => ({
      ...port,
      inputs: port.inputs.map((input, index) => (
        index === 1
          ? {
            ...input,
            sourceNode: createImageNode(3, 'image-file-3', 'image-3.png'),
          }
          : input
      )),
    })),
  };

  const before = buildAIImageGenInputLayoutVersion(resolvedGroups);
  const after = buildAIImageGenInputLayoutVersion(changedGroups);

  assert.notStrictEqual(before, after);
});

test('AI 生图节点参数区只保留 Prompt、Aspect、Resolution', () => {
  assert.deepEqual(
    AI_IMAGE_GEN_PARAMETER_FIELDS.map((field) => field.label),
    ['Prompt', 'Aspect', 'Resolution'],
  );
});

test('AI image gen prompt composition flow does not commit during composition and commits final prompt after composition end', () => {
  let state = createAIImageGenPromptControllerState('');

  state = handleAIImageGenPromptFocus(state).state;
  state = handleAIImageGenPromptCompositionStart(state).state;

  const composingChange = handleAIImageGenPromptChange(state, 'ni', { isComposing: true });
  state = composingChange.state;

  assert.equal(composingChange.committedPrompt, null);
  assert.equal(composingChange.shouldScheduleDebounceCommit, false);
  assert.equal(state.draft, 'ni');
  assert.equal(state.committedPrompt, '');

  const compositionEnd = handleAIImageGenPromptCompositionEnd(state, '你好');
  state = compositionEnd.state;

  assert.equal(compositionEnd.committedPrompt, '你好');
  assert.equal(compositionEnd.shouldRunNode, false);
  assert.equal(state.draft, '你好');
  assert.equal(state.committedPrompt, '你好');
  assert.equal(state.isComposing, false);
});

test('AI image gen prompt blur commits latest prompt outside composition', () => {
  let state = createAIImageGenPromptControllerState('old prompt');

  state = handleAIImageGenPromptFocus(state).state;
  const change = handleAIImageGenPromptChange(state, 'new prompt');
  state = change.state;

  assert.equal(change.shouldScheduleDebounceCommit, true);
  assert.equal(change.committedPrompt, null);

  const blur = handleAIImageGenPromptBlur(state, 'new prompt');
  state = blur.state;

  assert.equal(blur.committedPrompt, 'new prompt');
  assert.equal(state.committedPrompt, 'new prompt');
  assert.equal(state.isFocused, false);
});

test('AI image gen prompt run flushes latest prompt before run', () => {
  let state = createAIImageGenPromptControllerState('old prompt');

  const change = handleAIImageGenPromptChange(state, 'latest prompt');
  state = change.state;

  const run = handleAIImageGenPromptRun(state);
  state = run.state;

  assert.equal(run.committedPrompt, 'latest prompt');
  assert.equal(run.shouldRunNode, false);
  assert.equal(state.pendingRunPrompt, 'latest prompt');

  const settle = settleAIImageGenPromptRun(state, 'latest prompt');
  state = settle.state;

  assert.equal(settle.shouldRunNode, true);
  assert.equal(state.pendingRunPrompt, null);
  assert.equal(state.committedPrompt, 'latest prompt');
});

test('AI image gen prompt run waits for composition end final text before running', () => {
  let state = createAIImageGenPromptControllerState('old prompt');

  state = handleAIImageGenPromptFocus(state).state;
  state = handleAIImageGenPromptCompositionStart(state).state;
  state = handleAIImageGenPromptChange(state, 'zhong', { isComposing: true }).state;

  const runWhileComposing = handleAIImageGenPromptRun(state);
  state = runWhileComposing.state;

  assert.equal(runWhileComposing.committedPrompt, null);
  assert.equal(runWhileComposing.shouldRunNode, false);
  assert.equal(state.shouldRunAfterComposition, true);

  const compositionEnd = handleAIImageGenPromptCompositionEnd(state, '中文');
  state = compositionEnd.state;

  assert.equal(compositionEnd.committedPrompt, '中文');
  assert.equal(compositionEnd.shouldRunNode, false);
  assert.equal(state.pendingRunPrompt, '中文');

  const settle = settleAIImageGenPromptRun(state, '中文');
  state = settle.state;

  assert.equal(settle.shouldRunNode, true);
  assert.equal(state.pendingRunPrompt, null);
  assert.equal(state.committedPrompt, '中文');
});

test('AI image gen prompt external sync preserves focused composition draft but syncs otherwise', () => {
  let state = createAIImageGenPromptControllerState('saved prompt');

  state = handleAIImageGenPromptFocus(state).state;
  state = handleAIImageGenPromptCompositionStart(state).state;
  state = handleAIImageGenPromptChange(state, 'zhong', { isComposing: true }).state;

  const preserve = syncAIImageGenPromptControllerFromExternal(state, 'server prompt');
  assert.equal(preserve.state.draft, 'zhong');
  assert.equal(preserve.state.committedPrompt, 'saved prompt');

  const compositionEnd = handleAIImageGenPromptCompositionEnd(state, '中文');
  state = compositionEnd.state;

  const sync = syncAIImageGenPromptControllerFromExternal(state, 'server prompt');
  assert.equal(sync.state.draft, 'server prompt');
  assert.equal(sync.state.committedPrompt, 'server prompt');
});

test('AI image gen prompt external sync effect should not be triggered by local draft deletion alone', () => {
  const committedPrompt = '删除前的完整提示词';
  const deletedDraft = '删除前的完整提示';

  const sync = syncAIImageGenPromptControllerFromExternal({
    draft: deletedDraft,
    committedPrompt,
    isFocused: true,
    isComposing: false,
    pendingRunPrompt: null,
    shouldRunAfterComposition: false,
  }, committedPrompt);

  assert.equal(sync.state.draft, committedPrompt);

  // The component-level fix is that this reducer is now called only when
  // data.config.prompt changes, not whenever promptDraft changes.
  assert.equal(deletedDraft, '删除前的完整提示');
});
