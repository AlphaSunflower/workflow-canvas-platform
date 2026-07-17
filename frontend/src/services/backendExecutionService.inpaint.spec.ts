import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly } from './backendExecutionService';

test('backendExecutionService maps aiImageInpaint request fields and trims file ids', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-inpaint',
    nodeType: 'aiImageInpaint',
    taskType: 'image-inpaint',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-inpaint',
    nodeTitle: 'Image Inpaint',
    prompt: '  repaint the marked area  ',
    model: ' gemini-3-pro-image-preview ',
    imageSize: ' 2K ',
    aspectRatio: ' auto ',
    maskMode: 'strong-mask',
    groups: [
      {
        groupId: 'main',
        sourceFileId: ' source-file-1 ',
        maskFileId: ' mask-file-1 ',
      },
    ],
  });

  assert.deepEqual(requestBody, {
    workflowId: 'workflow-inpaint',
    nodeType: 'aiImageInpaint',
    taskType: 'image-inpaint',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-inpaint',
    nodeTitle: 'Image Inpaint',
    prompt: 'repaint the marked area',
    model: 'gemini-3-pro-image-preview',
    imageSize: '2K',
    maskMode: 'strong-mask',
    groups: [
      {
        groupId: 'main',
        sourceFileId: 'source-file-1',
        maskFileId: 'mask-file-1',
      },
    ],
  });
});
