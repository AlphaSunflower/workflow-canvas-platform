import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData } from '@/types';
import { getDefaultAIConfig } from '@/utils/node/create';
import { isAINodeData, isValidNodeType } from './guards';

function createStoryboardNode(): AINodeData {
  return {
    id: {
      value: 'storyboard-node-1',
      display: '#storyboard-node-1',
    },
    type: 'aiStoryboard',
    position: { x: 0, y: 0 },
    dimensions: { width: 1080, height: 760 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: {
      created: 1,
      updated: 1,
    },
    references: [],
    outputs: [],
    config: getDefaultAIConfig('aiStoryboard'),
    tasks: [],
  };
}

test('isAINodeData treats aiStoryboard as an AI node', () => {
  assert.equal(isAINodeData(createStoryboardNode()), true);
});

test('isValidNodeType accepts aiStoryboard', () => {
  assert.equal(isValidNodeType('aiStoryboard'), true);
});

test('isValidNodeType accepts aiImageInpaint', () => {
  assert.equal(isValidNodeType('aiImageInpaint'), true);
});
