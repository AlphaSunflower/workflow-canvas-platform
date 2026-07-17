import type {
  AdminExecutionListQuery,
  AdminFileListQuery,
  AdminStorageIssueListQuery,
  AdminUserListQuery,
  AdminWorkflowListQuery,
} from "@newworkflow/backend-shared";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function readString(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function readInteger(value: string | null): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePage(page: number | undefined): number {
  return page && page > 0 ? page : DEFAULT_PAGE;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || pageSize < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(pageSize, MAX_PAGE_SIZE);
}

function readPaging(searchParams: URLSearchParams): {
  page: number;
  pageSize: number;
} {
  return {
    page: normalizePage(readInteger(searchParams.get("page"))),
    pageSize: normalizePageSize(readInteger(searchParams.get("pageSize"))),
  };
}

export function parseAdminFileListQuery(requestUrl: URL): AdminFileListQuery {
  const searchParams = requestUrl.searchParams;
  return {
    ...readPaging(searchParams),
    userId: readString(searchParams.get("userId")),
    status: readString(searchParams.get("status")) as AdminFileListQuery["status"],
    fileType: readString(searchParams.get("fileType")),
    sourceType: readString(searchParams.get("sourceType")),
    q: readString(searchParams.get("q")),
  };
}

export function parseAdminExecutionListQuery(requestUrl: URL): AdminExecutionListQuery {
  const searchParams = requestUrl.searchParams;
  return {
    ...readPaging(searchParams),
    userId: readString(searchParams.get("userId")),
    workflowId: readString(searchParams.get("workflowId")),
    status: readString(searchParams.get("status")) as AdminExecutionListQuery["status"],
    nodeType: readString(searchParams.get("nodeType")),
    taskType: readString(searchParams.get("taskType")),
  };
}

export function parseAdminWorkflowListQuery(requestUrl: URL): AdminWorkflowListQuery {
  const searchParams = requestUrl.searchParams;
  return {
    ...readPaging(searchParams),
    ownerUserId: readString(searchParams.get("ownerUserId")),
    groupId: readString(searchParams.get("groupId")),
    q: readString(searchParams.get("q")),
  };
}

export function parseAdminUserListQuery(requestUrl: URL): AdminUserListQuery {
  const searchParams = requestUrl.searchParams;
  return {
    ...readPaging(searchParams),
    role: readString(searchParams.get("role")) as AdminUserListQuery["role"],
    status: readString(searchParams.get("status")) as AdminUserListQuery["status"],
    q: readString(searchParams.get("q")),
  };
}

export function parseAdminStorageIssueListQuery(requestUrl: URL): AdminStorageIssueListQuery {
  const searchParams = requestUrl.searchParams;
  return {
    ...readPaging(searchParams),
    severity: readString(searchParams.get("severity")) as AdminStorageIssueListQuery["severity"],
    type: readString(searchParams.get("type")),
  };
}
