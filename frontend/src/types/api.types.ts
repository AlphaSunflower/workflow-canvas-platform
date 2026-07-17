import type { Result, UUID, ProjectRole } from './base.types';
import type {
  AdminCreateUserRequest as AccountAdminCreateUserRequest,
  AdminResetUserPasswordRequest as AccountAdminResetUserPasswordRequest,
  AuthApi as AccountAuthApi,
  AuthTokenBundle,
  AuthUserProfile,
  LoginRequest as AccountLoginRequest,
  RefreshRequest as AccountRefreshRequest,
  RegisterRequest as AccountRegisterRequest,
  UpdateCurrentUserPasswordRequest as AccountUpdateCurrentUserPasswordRequest,
  UpdateCurrentUserRequest as AccountUpdateCurrentUserRequest,
  UpdateUserStatusRequest as AccountUpdateUserStatusRequest,
  UserApi as AccountUserApi,
} from './auth-api.types';
import type { FileInfo, ChunkUpload, ChunkUploadInit, FileFilter, FileSort } from './file.types';
import type { Workflow, Template } from './workflow.types';
import type {
  WorkflowManagerGroupSummary,
  WorkflowManagerItem,
  WorkflowManagerList,
} from './workflow-manager.types';
import type { AITask, AIStreamChunk, AITaskProgress, AIAgent, AIAgentSession } from './ai.types';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
  timestamp: number;
}

export interface ApiErrorResponse {
  code: number;
  message: string;
  errors?: Array<{ field: string; message: string }>;
  timestamp: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalPages: number;
}

// Legacy aliases retained while frontend auth migrates onto ./auth-api.types.
export type AuthTokens = AuthTokenBundle;
export type LoginRequest = AccountLoginRequest;
export type RegisterRequest = AccountRegisterRequest;
export type RefreshTokenRequest = AccountRefreshRequest;
export type User = AuthUserProfile;
export type UpdateUserRequest = AccountUpdateCurrentUserRequest;
export type ChangePasswordRequest = AccountUpdateCurrentUserPasswordRequest;

export interface Project {
  id: UUID;
  name: string;
  description: string;
  ownerId: UUID;
  memberCount: number;
  nodeCount: number;
  status: 'active' | 'archived' | 'deleted';
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDetail extends Project {
  members: ProjectMember[];
  workflowId: UUID;
}

export interface ProjectMember {
  id: UUID;
  userId: UUID;
  userName: string;
  userEmail: string;
  userAvatar?: string;
  role: ProjectRole;
  joinedAt: number;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
}

export interface AddProjectMemberRequest {
  userId: UUID;
  role: ProjectRole;
}

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
  status?: 'active' | 'archived';
  search?: string;
}

export interface FileUploadParams {
  projectId: UUID;
  file: File;
  onProgress?: (progress: number) => void;
}

export type WorkflowFileSyncStatus =
  | 'waiting'
  | 'hashing'
  | 'registering'
  | 'uploading'
  | 'ready'
  | 'failed';

export interface ChunkUploadInitResponse {
  fileId: UUID;
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

export interface FileListParams extends FileFilter, FileSort {
  page?: number;
  pageSize?: number;
  projectId?: UUID;
}

export interface CreateAITaskRequest {
  type: AITask['type'];
  provider?: AITask['provider'];
  model?: AITask['model'];
  nodeId: string;
  projectId: UUID;
  input: AITask['input'];
  priority?: AITask['priority'];
  retryCount?: number;
  maxRetries?: number;
  timeout?: number;
  idempotencyKey?: string;
}

export interface AITaskListParams {
  projectId?: UUID;
  nodeId?: string;
  status?: AITask['status'][];
  page?: number;
  pageSize?: number;
}

export interface ApiClient {
  get<T>(url: string, params?: Record<string, unknown>): Promise<Result<T>>;
  post<T>(url: string, data?: unknown): Promise<Result<T>>;
  put<T>(url: string, data?: unknown): Promise<Result<T>>;
  patch<T>(url: string, data?: unknown): Promise<Result<T>>;
  delete<T>(url: string): Promise<Result<T>>;
  upload(url: string, file: File, onProgress?: (progress: number) => void): Promise<Result<FileInfo>>;
}

export type WSMessageType =
  | 'workflow_update'
  | 'ai-stream'
  | 'task_progress'
  | 'task_completed'
  | 'task_failed'
  | 'chat_stream'
  | 'cursor_move'
  | 'user_join'
  | 'user_leave'
  | 'subscribe-task'
  | 'unsubscribe-task'
  | 'ping'
  | 'pong';

export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  userId?: UUID;
}

export interface WSWorkflowUpdatePayload {
  operation: string;
  data: unknown;
}

export interface WSTaskProgressPayload extends AITaskProgress {}

export interface WSChatStreamPayload extends AIStreamChunk {}

export interface WSCursorMovePayload {
  x: number;
  y: number;
  userName: string;
  userColor: string;
}

export interface WSUserJoinPayload {
  userId: UUID;
  userName: string;
  userAvatar?: string;
}

export interface WSUserLeavePayload {
  userId: UUID;
}

export interface WebSocketClient {
  connect: () => Promise<Result<void>>;
  disconnect: () => void;
  isConnected: () => boolean;
  getStatus: () => 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
  setAuthTokenProvider: (provider: (() => string | null) | null) => void;
  subscribe: <T>(type: WSMessageType, handler: (msg: WebSocketMessage<T>) => void) => () => void;
  send: <T>(type: WSMessageType, payload: T) => void;
}

export type AuthApi = AccountAuthApi;
export type UserApi = AccountUserApi;

export interface ProjectApi {
  list: (params?: ProjectListParams) => Promise<Result<PaginatedResponse<Project>>>;
  get: (id: UUID) => Promise<Result<ProjectDetail>>;
  create: (req: CreateProjectRequest) => Promise<Result<Project>>;
  update: (id: UUID, req: UpdateProjectRequest) => Promise<Result<Project>>;
  delete: (id: UUID) => Promise<Result<void>>;
  getMembers: (id: UUID) => Promise<Result<ProjectMember[]>>;
  addMember: (projectId: UUID, req: AddProjectMemberRequest) => Promise<Result<ProjectMember>>;
  removeMember: (projectId: UUID, userId: UUID) => Promise<Result<void>>;
  updateMemberRole: (projectId: UUID, userId: UUID, role: ProjectRole) => Promise<Result<void>>;
}

export interface FileApi {
  upload: (params: FileUploadParams) => Promise<Result<FileInfo>>;
  initChunkUpload: (req: ChunkUploadInit) => Promise<Result<ChunkUploadInitResponse>>;
  uploadChunk: (chunk: Blob, upload: ChunkUpload, index: number) => Promise<Result<void>>;
  completeUpload: (upload: ChunkUpload) => Promise<Result<FileInfo>>;
  list: (params?: FileListParams) => Promise<Result<PaginatedResponse<FileInfo>>>;
  get: (id: UUID) => Promise<Result<FileInfo>>;
  download: (id: UUID) => Promise<Result<Blob>>;
  getDownloadUrl: (id: UUID) => Promise<Result<string>>;
  delete: (id: UUID) => Promise<Result<void>>;
}

export interface WorkflowApi {
  listManaged: () => Promise<Result<WorkflowManagerList>>;
  getById: (workflowId: UUID) => Promise<Result<Workflow>>;
  createBlank: (request: {
    id?: UUID;
    projectId?: UUID;
    name?: string;
    groupId?: UUID | null;
    viewport?: Workflow['viewport'];
    metadata?: Record<string, unknown>;
    timestamp?: number;
    version?: number;
  }) => Promise<Result<Workflow>>;
  create: (workflow: Workflow) => Promise<Result<Workflow>>;
  update: (workflow: Workflow) => Promise<Result<Workflow>>;
  rename: (workflowId: UUID, name: string) => Promise<Result<Workflow>>;
  delete: (workflowId: UUID) => Promise<Result<{ workflowId: UUID; deleted: true }>>;
  createGroup: (name?: string) => Promise<Result<WorkflowManagerGroupSummary>>;
  renameGroup: (groupId: UUID, name: string) => Promise<Result<WorkflowManagerGroupSummary>>;
  deleteGroup: (
    groupId: UUID,
  ) => Promise<Result<{ groupId: UUID; movedWorkflowCount: number; deleted: true }>>;
  moveToGroup: (workflowId: UUID, groupId: UUID | null) => Promise<Result<Workflow>>;
  save: (workflow: Workflow) => Promise<Result<Workflow>>;
  export: (workflowId: UUID) => Promise<Result<Blob>>;
  import: (file: File) => Promise<Result<Workflow>>;
}

export type {
  WorkflowManagerGroupSummary,
  WorkflowManagerItem,
  WorkflowManagerList,
};

export interface AIApi {
  createTask: (req: CreateAITaskRequest) => Promise<Result<AITask>>;
  getTask: (id: UUID) => Promise<Result<AITask>>;
  listTasks: (params?: AITaskListParams) => Promise<Result<PaginatedResponse<AITask>>>;
  cancelTask: (id: UUID) => Promise<Result<void>>;
  retryTask: (id: UUID) => Promise<Result<AITask>>;
  getTaskResult: (id: UUID) => Promise<Result<AITask['output']>>;
  subscribeTask: (id: UUID, handler: (chunk: AIStreamChunk) => void) => () => void;
}

export interface AgentApi {
  list: () => Promise<Result<AIAgent[]>>;
  get: (id: UUID) => Promise<Result<AIAgent>>;
  create: (agent: Omit<AIAgent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Result<AIAgent>>;
  update: (id: UUID, agent: Partial<AIAgent>) => Promise<Result<AIAgent>>;
  delete: (id: UUID) => Promise<Result<void>>;
  createSession: (agentId: UUID, nodeId: string) => Promise<Result<AIAgentSession>>;
  getSession: (sessionId: UUID) => Promise<Result<AIAgentSession>>;
  sendMessage: (sessionId: UUID, content: string, files?: UUID[]) => Promise<Result<AIAgentSession>>;
}

export interface TemplateApi {
  list: (category?: string) => Promise<Result<Template[]>>;
  get: (id: UUID) => Promise<Result<Template>>;
  create: (template: Omit<Template, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Result<Template>>;
  update: (id: UUID, template: Partial<Template>) => Promise<Result<Template>>;
  delete: (id: UUID) => Promise<Result<void>>;
  getCategories: () => Promise<Result<Array<{ id: string; name: string; count: number }>>>;
}

// Forward aliases for migration readability in auth-related modules.
export type AdminCreateUserRequest = AccountAdminCreateUserRequest;
export type UpdateUserStatusRequest = AccountUpdateUserStatusRequest;
export type AdminResetUserPasswordRequest = AccountAdminResetUserPasswordRequest;
