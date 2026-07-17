import type { RequestConfig } from '../client/http-client';
import { httpClient } from '../client/http-client';
import type { Result } from '@/types';

export interface AIImageGenPromptOptimizeRequest {
  workflowId: string;
  nodeId: string;
  nodeType: 'aiImageGen';
  prompt: string;
  referenceFileIds: string[];
}

export interface AIImageGenPromptOptimizeResponse {
  optimizedPrompt: string;
  model: string;
  referenceCount: number;
  promptVersion: string;
}

export async function optimizeAIImageGenPrompt(
  request: AIImageGenPromptOptimizeRequest,
  config?: RequestConfig,
): Promise<Result<AIImageGenPromptOptimizeResponse>> {
  return httpClient.post<AIImageGenPromptOptimizeResponse>(
    '/api/v1/ai/prompt-optimize',
    request,
    {
      timeout: 210000,
      ...config,
    },
  );
}

export const aiPromptApi = {
  optimizeAIImageGenPrompt,
};
