import type { RequestConfig } from '../client/http-client';
import { httpClient } from '../client/http-client';
import type { Result } from '@/types';

export interface StoryboardArrangeShotRequest {
  shotId: string;
  order: number;
  imageFileId: string;
}

export interface StoryboardArrangeRequest {
  workflowId: string;
  nodeId: string;
  nodeType: 'aiStoryboard';
  shots: StoryboardArrangeShotRequest[];
}

export interface StoryboardArrangeShotResponse {
  shotId: string;
  order: number;
  prompt: string;
}

export interface StoryboardArrangeResponse {
  shots: StoryboardArrangeShotResponse[];
  model: string;
  referenceCount: number;
  promptVersion: string;
}

export async function arrangeStoryboardShots(
  request: StoryboardArrangeRequest,
  config?: RequestConfig,
): Promise<Result<StoryboardArrangeResponse>> {
  return httpClient.post<StoryboardArrangeResponse>(
    '/api/v1/ai/storyboard-arrange',
    request,
    {
      timeout: 210000,
      ...config,
    },
  );
}

export const aiStoryboardApi = {
  arrangeStoryboardShots,
};
