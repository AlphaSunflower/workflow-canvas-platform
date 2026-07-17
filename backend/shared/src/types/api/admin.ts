import type { ExecutionStatus } from "../execution.ts";
import type {
  ExecutionRunDetailResponseData,
  ExecutionTaskQueryItem,
} from "./execution-query.ts";
import type { FileAssetResponse } from "./files.ts";
import type { UserItemResponseData } from "./users.ts";
import type {
  WorkflowDetailResponseData,
  WorkflowSummaryItem,
} from "./workflows.ts";

export interface AdminPageQuery {
  page?: number;
  pageSize?: number;
}

export interface AdminFileListQuery extends AdminPageQuery {
  userId?: string;
  status?: "pending_upload" | "ready";
  fileType?: string;
  sourceType?: string;
  q?: string;
}

export interface AdminExecutionListQuery extends AdminPageQuery {
  userId?: string;
  workflowId?: string;
  status?: ExecutionStatus;
  nodeType?: string;
  taskType?: string;
}

export interface AdminWorkflowListQuery extends AdminPageQuery {
  ownerUserId?: string;
  groupId?: string;
  q?: string;
}

export interface AdminUserListQuery extends AdminPageQuery {
  role?: "member" | "admin";
  status?: "enabled" | "disabled";
  q?: string;
}

export interface AdminStorageIssueListQuery extends AdminPageQuery {
  severity?: "warning" | "error";
  type?: string;
}

export interface AdminPagedResponse<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminOverviewResponseData {
  files: {
    total: number;
    ready: number;
    pendingUpload: number;
  };
  executions: {
    totalRuns: number;
    queuedTasks: number;
    processingTasks: number;
    failedTasks: number;
  };
  workflows: {
    total: number;
  };
  users: {
    total: number;
    admins: number;
    members: number;
    disabled: number;
  };
  storage: {
    issueCount: number;
  };
}

export interface AdminFileUsageWorkflowItem {
  workflowId: string;
  workflowName: string | null;
  ownerUserId: string | null;
  nodeId: string | null;
  role: string;
}

export interface AdminFileUsageTaskItem {
  taskId: string;
  taskNo: string | null;
  runId: string | null;
  runNo: string | null;
  workflowId: string | null;
  nodeType: string | null;
  role: string;
}

export interface AdminFileUsageResponseData {
  file: FileAssetResponse;
  workflows: AdminFileUsageWorkflowItem[];
  tasks: AdminFileUsageTaskItem[];
}

export interface AdminStorageIssueItem {
  id: string;
  type: string;
  severity: "warning" | "error";
  fileId: string | null;
  blobId: string | null;
  storageKey: string | null;
  message: string;
}

export interface AdminExecutionListItem {
  runId: string;
  runNo: string;
  userId: string | null;
  workflowId: string | null;
  projectId: string | null;
  nodeType: string;
  taskType: string;
  executionMode: string;
  status: ExecutionStatus;
  totalTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminExecutionDetailResponseData extends ExecutionRunDetailResponseData {
  inputFiles: FileAssetResponse[];
  outputFiles: FileAssetResponse[];
}

export interface AdminWorkflowDetailResponseData extends WorkflowDetailResponseData {
  files: FileAssetResponse[];
  tasks: ExecutionTaskQueryItem[];
}

export type AdminFileListResponseData = AdminPagedResponse<FileAssetResponse>;
export type AdminExecutionListResponseData = AdminPagedResponse<AdminExecutionListItem>;
export type AdminWorkflowListResponseData = AdminPagedResponse<WorkflowSummaryItem>;
export type AdminUserListResponseData = AdminPagedResponse<UserItemResponseData>;
export type AdminStorageIssueListResponseData = AdminPagedResponse<AdminStorageIssueItem>;
