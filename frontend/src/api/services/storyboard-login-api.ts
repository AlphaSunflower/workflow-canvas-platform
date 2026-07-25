import { httpClient } from '../client/http-client';
import type { Result } from '@/types';

export interface StoryboardLoginResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
  displayName: string;
}

export async function storyboardLogin(): Promise<Result<StoryboardLoginResponse>> {
  return httpClient.post<StoryboardLoginResponse>(
    '/api/v1/auth/storyboard-login',
    {},
    {
      timeout: 15000,
    },
  );
}
