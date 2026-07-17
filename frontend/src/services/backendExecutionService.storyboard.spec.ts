import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly } from './backendExecutionService';

test('backendExecutionService maps aiStoryboard image-gen requests like aiImageGen while preserving nodeType', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-storyboard-image',
    nodeType: 'aiStoryboard',
    taskType: 'image-gen',
    executionMode: 'node-action-only',
    nodeId: 'node-storyboard',
    nodeTitle: 'AI Storyboard',
    prompt: '  storyboard image prompt  ',
    imageSize: ' 2K ',
    aspectRatio: ' 16:9 ',
    groups: [
      {
        groupId: 'shot-1',
        referenceFileIds: [' file-a ', 'file-b', '   '],
      },
    ],
  });

  assert.deepEqual(requestBody, {
    workflowId: 'workflow-storyboard-image',
    nodeType: 'aiStoryboard',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-storyboard',
    nodeTitle: 'AI Storyboard',
    prompt: '  storyboard image prompt  ',
    imageSize: '2K',
    aspectRatio: '16:9',
    groups: [
      {
        groupId: 'shot-1',
        referenceFileIds: ['file-a', 'file-b'],
      },
    ],
  });
});

test('backendExecutionService maps aiStoryboard video-gen requests like aiVideoGen while preserving nodeType', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-storyboard-video',
    nodeType: 'aiStoryboard',
    taskType: 'video-gen',
    executionMode: 'node-action-only',
    nodeId: 'node-storyboard',
    nodeTitle: 'AI Storyboard',
    prompt: '  storyboard video prompt  ',
    model: 'veo-3.1-landscape-fast-fl',
    duration: 8,
    aspectRatio: '9:16',
    resolution: '1080p',
    groups: [
      {
        groupId: 'shot-1',
        referenceFileIds: [' file-a ', ' file-b '],
      },
    ],
  });

  assert.deepEqual(requestBody, {
    workflowId: 'workflow-storyboard-video',
    nodeType: 'aiStoryboard',
    taskType: 'video-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-storyboard',
    nodeTitle: 'AI Storyboard',
    prompt: 'storyboard video prompt',
    model: 'veo-3.1-fast-generate-preview',
    duration: 8,
    aspectRatio: '9:16',
    resolution: '1080p',
    size: '1080x1920',
    groups: [
      {
        groupId: 'shot-1',
        referenceFileIds: ['file-a', 'file-b'],
      },
    ],
  });
});

test('backendExecutionService preserves legacy grouped mode for non-storyboard grouped requests', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-image-gen',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-image-gen',
    nodeTitle: 'AI Image Gen',
    prompt: '  image prompt  ',
    imageSize: ' 1K ',
    aspectRatio: ' auto ',
    groups: [
      {
        groupId: 'group-1',
        referenceFileIds: [' file-a '],
      },
    ],
  });

  assert.equal(requestBody.executionMode, 'legacy-grouped-task');
});

test('backendExecutionService preserves official image-gen auto aspect ratio and quality', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-image-gen-official',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-image-gen',
    nodeTitle: 'AI Image Gen',
    prompt: 'official image prompt',
    model: ' gpt-image-2-official ',
    imageSize: ' 2K ',
    aspectRatio: ' auto ',
    quality: ' high ',
    groups: [
      {
        groupId: 'group-1',
        referenceFileIds: [' file-a '],
      },
    ],
  });

  assert.deepEqual(requestBody, {
    workflowId: 'workflow-image-gen-official',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-image-gen',
    nodeTitle: 'AI Image Gen',
    prompt: 'official image prompt',
    model: 'gpt-image-2-official',
    imageSize: '2K',
    aspectRatio: 'auto',
    quality: 'high',
    groups: [
      {
        groupId: 'group-1',
        referenceFileIds: ['file-a'],
      },
    ],
  });
});

test('backendExecutionService drops image-gen quality outside official model', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-image-gen',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-image-gen',
    nodeTitle: 'AI Image Gen',
    prompt: 'image prompt',
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '16:9',
    quality: 'high',
    groups: [
      {
        groupId: 'group-1',
        referenceFileIds: ['file-a'],
      },
    ],
  });

  assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'quality'), false);
});

test('backendExecutionService omits size parameters for default GPT Image 2 image-gen requests', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-image-gen',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-image-gen',
    nodeTitle: 'AI Image Gen',
    prompt: 'image prompt',
    model: 'gpt-image-2',
    imageSize: '4K',
    aspectRatio: '16:9',
    groups: [
      {
        groupId: 'group-1',
        referenceFileIds: [],
      },
    ],
  });

  const imageGenRequestBody = requestBody as {
    model?: string;
    imageSize?: string;
    aspectRatio?: string;
  };

  assert.equal(imageGenRequestBody.model, 'gpt-image-2');
  assert.equal(Object.prototype.hasOwnProperty.call(imageGenRequestBody, 'imageSize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(imageGenRequestBody, 'aspectRatio'), false);
});
