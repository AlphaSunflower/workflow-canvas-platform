export { httpClient, createHttpClient } from './client/http-client';
export type { HttpClientConfig, RequestConfig } from './client/http-client';

export { websocketClient, createWebSocketClient } from './websocket';
export type { WebSocketConfig, WebSocketStatus } from './websocket';

export {
  authApi,
  applyAuthTokenBundle,
  login,
  logout,
  me,
  refresh,
  register,
  setAuthAccessToken,
} from './services/auth-api';
export {
  usersApi,
  getCurrentUser,
  updateCurrentUser,
  updateCurrentUserPassword,
  listUsers,
  createUser,
  updateUserStatus,
  resetUserPassword,
} from './services/users-api';
export { fileApi, getFileFormat, getFileType, isSupportedFormat } from './services/file-api';

export {
  aiPromptApi,
  optimizeAIImageGenPrompt,
} from './services/ai-prompt-api';
export type {
  AIImageGenPromptOptimizeRequest,
  AIImageGenPromptOptimizeResponse,
} from './services/ai-prompt-api';
export {
  aiStoryboardApi,
  arrangeStoryboardShots,
  arrangeStoryboardFromStory,
} from './services/ai-storyboard-api';
export type {
  StoryboardArrangeRequest,
  StoryboardArrangeResponse,
  StoryboardArrangeShotRequest,
  StoryboardArrangeShotResponse,
  StoryboardCreationType,
  StoryboardStoryArrangeRequest,
} from './services/ai-storyboard-api';

export { workflowApi, aiApi } from './services/workflow-api';
