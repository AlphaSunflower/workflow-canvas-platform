import type {
  AdminExecutionDetailResponseData,
  AdminExecutionListQuery,
  AdminExecutionListResponseData,
  AdminFileListQuery,
  AdminFileListResponseData,
  AdminFileUsageResponseData,
  AdminOverviewResponseData,
  AdminStorageIssueListQuery,
  AdminStorageIssueListResponseData,
  AdminUserListQuery,
  AdminUserListResponseData,
  AdminWorkflowDetailResponseData,
  AdminWorkflowListQuery,
  AdminWorkflowListResponseData,
} from "../../../shared/src/types/api/admin.ts";
import type {
  AuthSuccessResponseData,
  AuthUserProfile,
  LoginRequest,
} from "../../../shared/src/types/api/auth.ts";

export type {
  AdminExecutionDetailResponseData,
  AdminExecutionListItem,
  AdminExecutionListQuery,
  AdminExecutionListResponseData,
  AdminFileListQuery,
  AdminFileListResponseData,
  AdminFileUsageResponseData,
  AdminOverviewResponseData,
  AdminStorageIssueItem,
  AdminStorageIssueListQuery,
  AdminStorageIssueListResponseData,
  AdminUserListQuery,
  AdminUserListResponseData,
  AdminWorkflowDetailResponseData,
  AdminWorkflowListQuery,
  AdminWorkflowListResponseData,
} from "../../../shared/src/types/api/admin.ts";
export type { AuthSuccessResponseData, AuthUserProfile, LoginRequest } from "../../../shared/src/types/api/auth.ts";
export type { FileAssetResponse } from "../../../shared/src/types/api/files.ts";
export type { ExecutionTaskQueryItem } from "../../../shared/src/types/api/execution-query.ts";
export type { WorkflowSummaryItem } from "../../../shared/src/types/api/workflows.ts";
export type { UserItemResponseData } from "../../../shared/src/types/api/users.ts";

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: string;
  data?: T;
  timestamp?: number;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: number | string | null;
  readonly errorCode: string | null;

  constructor(message: string, options: { status: number; code?: number | string; errorCode?: string }) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.errorCode = options.errorCode ?? null;
  }
}

const AUTH_STORAGE_KEY = "newworkflow.admin.auth";

export interface StoredAuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUserProfile;
}

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envBaseUrl) {
    return envBaseUrl.replace(/\/$/, "");
  }

  return "";
}

function toQueryString(query: object | undefined): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  Object.entries(query as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    params.set(key, String(value));
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function readEnvelopeMessage(payload: unknown): {
  message: string;
  code?: number | string;
  errorCode?: string;
} {
  if (!payload || typeof payload !== "object") {
    return { message: "Request failed." };
  }

  const record = payload as Record<string, unknown>;
  return {
    message: typeof record.message === "string" ? record.message : "Request failed.",
    code: typeof record.code === "number" || typeof record.code === "string" ? record.code : undefined,
    errorCode: typeof record.error === "string" ? record.error : undefined,
  };
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

class AdminApiClient {
  private readonly baseUrl = resolveApiBaseUrl();
  private accessToken: string | null = null;

  setAccessToken(accessToken: string | null): void {
    this.accessToken = accessToken;
  }

  loadStoredSession(): StoredAuthSession | null {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StoredAuthSession;
      if (!parsed.accessToken || !parsed.user) {
        this.clearStoredSession();
        return null;
      }

      this.setAccessToken(parsed.accessToken);
      return parsed;
    } catch {
      this.clearStoredSession();
      return null;
    }
  }

  storeSession(session: StoredAuthSession): void {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    this.setAccessToken(session.accessToken);
  }

  clearStoredSession(): void {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    this.setAccessToken(null);
  }

  async login(request: LoginRequest): Promise<AuthSuccessResponseData> {
    const response = await this.post<AuthSuccessResponseData>("/api/v1/auth/login", request);
    this.storeSession({
      accessToken: response.tokens.accessToken,
      refreshToken: response.tokens.refreshToken,
      user: response.user,
    });
    return response;
  }

  async me(): Promise<AuthUserProfile> {
    return this.get<AuthUserProfile>("/api/v1/auth/me");
  }

  async getOverview(): Promise<AdminOverviewResponseData> {
    return this.get<AdminOverviewResponseData>("/api/v1/admin/overview");
  }

  async listFiles(query: AdminFileListQuery): Promise<AdminFileListResponseData> {
    return this.get<AdminFileListResponseData>("/api/v1/admin/files", query);
  }

  async getFile(fileId: string): Promise<AdminFileUsageResponseData> {
    return this.get<AdminFileUsageResponseData>(`/api/v1/admin/files/${encodeURIComponent(fileId)}`);
  }

  async listExecutions(query: AdminExecutionListQuery): Promise<AdminExecutionListResponseData> {
    return this.get<AdminExecutionListResponseData>("/api/v1/admin/executions", query);
  }

  async getExecution(runId: string): Promise<AdminExecutionDetailResponseData> {
    return this.get<AdminExecutionDetailResponseData>(`/api/v1/admin/executions/${encodeURIComponent(runId)}`);
  }

  async listWorkflows(query: AdminWorkflowListQuery): Promise<AdminWorkflowListResponseData> {
    return this.get<AdminWorkflowListResponseData>("/api/v1/admin/workflows", query);
  }

  async getWorkflow(workflowId: string): Promise<AdminWorkflowDetailResponseData> {
    return this.get<AdminWorkflowDetailResponseData>(`/api/v1/admin/workflows/${encodeURIComponent(workflowId)}`);
  }

  async listUsers(query: AdminUserListQuery): Promise<AdminUserListResponseData> {
    return this.get<AdminUserListResponseData>("/api/v1/admin/read/users", query);
  }

  async listStorageIssues(query: AdminStorageIssueListQuery): Promise<AdminStorageIssueListResponseData> {
    return this.get<AdminStorageIssueListResponseData>("/api/v1/admin/storage/issues", query);
  }

  private async get<T>(path: string, query?: object): Promise<T> {
    return this.request<T>("GET", `${path}${toQueryString(query)}`);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await parseJsonSafely(response);
    if (!response.ok) {
      const error = readEnvelopeMessage(payload);
      throw new ApiClientError(error.message, {
        status: response.status,
        code: error.code,
        errorCode: error.errorCode,
      });
    }

    const envelope = payload as ApiEnvelope<T> | null;
    if (!envelope || typeof envelope !== "object") {
      throw new ApiClientError("Invalid API response.", { status: response.status });
    }

    if (envelope.code !== 0 && envelope.code !== 200) {
      throw new ApiClientError(envelope.message ?? "API returned an error.", {
        status: response.status,
        code: envelope.code,
        errorCode: envelope.error,
      });
    }

    if (envelope.data === undefined) {
      throw new ApiClientError("API response has no data.", { status: response.status, code: envelope.code });
    }

    return envelope.data;
  }
}

export const adminApi = new AdminApiClient();

export function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 401 || error.status === 403);
}
