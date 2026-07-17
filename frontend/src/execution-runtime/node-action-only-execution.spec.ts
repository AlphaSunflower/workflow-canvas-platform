import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNodeActionOnlyExecutionRequest,
  NODE_ACTION_ONLY_EXECUTION_MODE,
} from './node-action-only-execution';

test('createNodeActionOnlyExecutionRequest formalizes node-action-only payload shape', () => {
  const request = createNodeActionOnlyExecutionRequest({
    actionIds: ['arrange', 'shot-image'],
    plan: {
      files: [],
      references: ['file-1'],
      config: {},
      prompt: 'storyboard prompt',
    },
  });

  assert.deepEqual(request, {
    boundary: NODE_ACTION_ONLY_EXECUTION_MODE,
    actionIds: ['arrange', 'shot-image'],
    plan: {
      files: [],
      references: ['file-1'],
      config: {},
      prompt: 'storyboard prompt',
    },
  });
});

test('createNodeActionOnlyExecutionRequest trims and deduplicates action ids', () => {
  const request = createNodeActionOnlyExecutionRequest({
    actionIds: [' arrange ', 'shot-image', '', 'shot-image', '  shot-video  '],
    plan: {
      files: [],
      references: [],
      config: {},
    },
  });

  assert.deepEqual(request.actionIds, ['arrange', 'shot-image', 'shot-video']);
});
