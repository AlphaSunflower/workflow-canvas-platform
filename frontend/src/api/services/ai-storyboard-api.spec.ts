import test from 'node:test';
import assert from 'node:assert/strict';

import type { Result } from '@/types';
import { createError } from '@/utils';
import { httpClient } from '../client/http-client';
import { aiStoryboardApi } from './ai-storyboard-api';

test('aiStoryboardApi.arrangeStoryboardShots posts fixed endpoint with request body and default timeout', async () => {
  const originalPost = httpClient.post.bind(httpClient);
  const postCalls: Array<{
    path: string;
    payload: unknown;
    config: unknown;
  }> = [];

  httpClient.post = async <T>(path: string, payload?: unknown, config?: unknown) => {
    postCalls.push({ path, payload, config });

    return {
      success: true,
      data: {
        shots: [
          {
            shotId: 'shot-b',
            order: 1,
            prompt: '中文运镜提示词',
          },
        ],
        model: 'gemini-3-flash-preview',
        referenceCount: 1,
        promptVersion: 'ai-storyboard-arrange-v1',
      },
    } as Result<T>;
  };

  try {
    const abortController = new AbortController();
    const result = await aiStoryboardApi.arrangeStoryboardShots({
      workflowId: 'workflow-1',
      nodeId: 'node-1',
      nodeType: 'aiStoryboard',
      shots: [
        {
          shotId: 'shot-b',
          order: 2,
          imageFileId: 'file-b',
        },
      ],
    }, {
      signal: abortController.signal,
    });

    assert.equal(result.success, true);
    assert.deepEqual(postCalls, [{
      path: '/api/v1/ai/storyboard-arrange',
      payload: {
        workflowId: 'workflow-1',
        nodeId: 'node-1',
        nodeType: 'aiStoryboard',
        shots: [
          {
            shotId: 'shot-b',
            order: 2,
            imageFileId: 'file-b',
          },
        ],
      },
      config: {
        timeout: 210000,
        signal: abortController.signal,
      },
    }]);
  } finally {
    httpClient.post = originalPost;
  }
});

test('aiStoryboardApi.arrangeStoryboardShots preserves failed result for caller-side error handling', async () => {
  const originalPost = httpClient.post.bind(httpClient);
  const expectedError = createError('AI_TASK_ERROR', 'Storyboard arrange failed', {
    module: 'ai-storyboard-api.spec',
    operation: 'arrangeStoryboardShots',
    timestamp: Date.now(),
  });

  httpClient.post = async <T>() => ({
    success: false,
    error: expectedError,
  }) as Result<T>;

  try {
    const result = await aiStoryboardApi.arrangeStoryboardShots({
      workflowId: 'workflow-2',
      nodeId: 'node-2',
      nodeType: 'aiStoryboard',
      shots: [
        {
          shotId: 'shot-a',
          order: 1,
          imageFileId: 'file-a',
        },
      ],
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.message, 'Storyboard arrange failed');
    assert.equal(result.error?.code, 'AI_TASK_ERROR');
  } finally {
    httpClient.post = originalPost;
  }
});
