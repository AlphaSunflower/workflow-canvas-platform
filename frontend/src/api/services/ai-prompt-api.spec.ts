import test from 'node:test';
import assert from 'node:assert/strict';

import type { Result } from '@/types';
import { createError } from '@/utils';
import { httpClient } from '../client/http-client';
import { aiPromptApi } from './ai-prompt-api';

test('aiPromptApi.optimizeAIImageGenPrompt posts fixed endpoint with request body and default timeout', async () => {
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
        optimizedPrompt: '优化后的提示词',
        model: 'gemini-2.5-flash',
        referenceCount: 2,
        promptVersion: 'ai-image-gen-optimize-v2',
      },
    } as Result<T>;
  };

  try {
    const abortController = new AbortController();
    const result = await aiPromptApi.optimizeAIImageGenPrompt({
      workflowId: 'workflow-1',
      nodeId: 'node-1',
      nodeType: 'aiImageGen',
      prompt: '改成欧式风格',
      referenceFileIds: ['file-1', 'file-2'],
    }, {
      signal: abortController.signal,
    });

    assert.equal(result.success, true);
    assert.deepEqual(postCalls, [{
      path: '/api/v1/ai/prompt-optimize',
      payload: {
        workflowId: 'workflow-1',
        nodeId: 'node-1',
        nodeType: 'aiImageGen',
        prompt: '改成欧式风格',
        referenceFileIds: ['file-1', 'file-2'],
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

test('aiPromptApi.optimizeAIImageGenPrompt preserves failed result for caller-side error handling', async () => {
  const originalPost = httpClient.post.bind(httpClient);
  const expectedError = createError('AI_TASK_ERROR', 'Prompt optimize failed', {
    module: 'ai-prompt-api.spec',
    operation: 'optimizeAIImageGenPrompt',
    timestamp: Date.now(),
  });

  httpClient.post = async <T>() => ({
    success: false,
    error: expectedError,
  }) as Result<T>;

  try {
    const result = await aiPromptApi.optimizeAIImageGenPrompt({
      workflowId: 'workflow-2',
      nodeId: 'node-2',
      nodeType: 'aiImageGen',
      prompt: '提示词',
      referenceFileIds: ['file-1'],
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.message, 'Prompt optimize failed');
    assert.equal(result.error?.code, 'AI_TASK_ERROR');
  } finally {
    httpClient.post = originalPost;
  }
});
