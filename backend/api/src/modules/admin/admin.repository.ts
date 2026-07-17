import fs from "node:fs/promises";
import path from "node:path";

import type {
  AdminExecutionDetailResponseData,
  AdminExecutionListItem,
  AdminExecutionListQuery,
  AdminExecutionListResponseData,
  AdminFileListQuery,
  AdminFileListResponseData,
  AdminFileUsageResponseData,
  AdminFileUsageTaskItem,
  AdminFileUsageWorkflowItem,
  AdminOverviewResponseData,
  AdminPagedResponse,
  AdminStorageIssueItem,
  AdminStorageIssueListQuery,
  AdminStorageIssueListResponseData,
  AdminUserListQuery,
  AdminUserListResponseData,
  AdminWorkflowDetailResponseData,
  AdminWorkflowListQuery,
  AdminWorkflowListResponseData,
  DatabaseConfig,
  DatabasePool,
  FileAssetResponse,
  ServiceEnv,
  WorkflowDetailResponseData,
  WorkflowSummaryItem,
  UserItemResponseData,
} from "@newworkflow/backend-shared";
import { queryPostgres } from "@newworkflow/backend-shared";
import type { ExecutionTaskQueryItem } from "@newworkflow/backend-shared/api";
import type {
  AccountUserRecord,
  AuditLogRecord,
} from "../auth/auth.repository.types.ts";
import type {
  FileAssetRecord,
  FileStore,
} from "../files/files.repository.types.ts";
import type {
  ExecutionRunRecord,
  ExecutionTaskRecord,
} from "../executions/execution-records.types.ts";
import type {
  ExecutionTaskFileLinkRecord,
} from "../executions/executions.repository.types.ts";
import type {
  StoredWorkflowDocument,
  WorkflowSummaryIndex,
} from "../workflows/workflow-storage.types.ts";
import type { ObjectStorageAdapter } from "../storage/object-storage.adapter.ts";
import { LocalObjectStorageAdapter } from "../storage/local-object-storage.adapter.ts";

type DbQueryRow = Record<string, unknown>;

interface AdminRepositoryOptions {
  env: ServiceEnv;
  rootDir: string;
  pool?: DatabasePool;
  objectStorage?: ObjectStorageAdapter;
}

interface AccountStore {
  users: AccountUserRecord[];
  auditLogs: AuditLogRecord[];
}

interface ExecutionStore {
  runs: ExecutionRunRecord[];
  tasks: ExecutionTaskRecord[];
  taskFileLinks?: ExecutionTaskFileLinkRecord[];
}

interface FileAssetDbRow extends DbQueryRow {
  id: string;
  user_id: string | null;
  blob_id: string | null;
  original_name: string;
  display_name: string;
  mime_type: string;
  file_type: FileAssetRecord["fileType"];
  source_type: FileAssetRecord["sourceType"];
  sha256: string | null;
  size: number | string | null;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: FileAssetRecord["status"];
  created_at: Date | string;
  thumbnail_ready?: boolean | null;
  thumbnail_width?: number | null;
  thumbnail_height?: number | null;
  preview_ready?: boolean | null;
  preview_width?: number | null;
  preview_height?: number | null;
}

interface ExecutionRunDbRow extends DbQueryRow {
  id: string;
  run_no: string;
  user_id: string | null;
  workflow_id: string | null;
  project_id: string | null;
  node_type: string;
  task_type: string;
  execution_mode: string;
  node_id: string | null;
  node_title: string | null;
  provider: string | null;
  status: AdminExecutionListItem["status"];
  total_task_count: number;
  completed_task_count: number;
  failed_task_count: number;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface WorkflowDbRow extends DbQueryRow {
  id: string;
  project_id: string;
  owner_user_id: string;
  name: string;
  group_id: string | null;
  container_key: string;
  is_auto_named: boolean;
  node_count: number;
  connection_count: number;
  timestamp: number | string;
  version: number;
  payload?: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface UserDbRow extends DbQueryRow {
  id: string;
  email: string;
  display_name: string;
  role: "member" | "admin";
  status: "enabled" | "disabled";
  last_login_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface StorageIssueBlobDbRow extends DbQueryRow {
  file_id: string;
  blob_id: string | null;
  original_storage_key: string | null;
  preview_storage_key: string | null;
  thumbnail_storage_key: string | null;
}

const FILE_SELECT_COLUMNS = `
  id::text,
  user_id,
  blob_id::text,
  original_name,
  display_name,
  mime_type,
  file_type,
  source_type,
  sha256,
  size,
  extension,
  width,
  height,
  duration,
  status,
  created_at,
  thumbnail_ready,
  thumbnail_width,
  thumbnail_height,
  preview_ready,
  preview_width,
  preview_height
`;

const RUN_SELECT_COLUMNS = `
  id::text,
  run_no,
  user_id,
  workflow_id,
  project_id,
  node_type,
  task_type,
  execution_mode,
  node_id,
  node_title,
  provider,
  status,
  total_task_count,
  completed_task_count,
  failed_task_count,
  created_at,
  started_at,
  completed_at
`;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function normalizePage(query: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

function paginate<T>(items: T[], query: { page?: number; pageSize?: number }): AdminPagedResponse<T> {
  const { page, pageSize, offset } = normalizePage(query);
  return {
    items: items.slice(offset, offset + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

function includesText(value: string | null | undefined, query: string): boolean {
  return (value ?? "").toLowerCase().includes(query.toLowerCase());
}

function toFileResponse(record: FileAssetRecord): FileAssetResponse {
  const thumbnailUrl = record.status === "ready" && record.fileType === "image" && record.thumbnailReady
    ? `/api/v1/files/${record.id}/thumbnail`
    : undefined;
  const previewUrl = record.status === "ready" && record.fileType === "image" && record.previewReady
    ? `/api/v1/files/${record.id}/preview`
    : undefined;
  const downloadUrl = record.status === "ready"
    ? `/api/v1/files/${record.id}/download`
    : undefined;

  return {
    fileId: record.id,
    userId: record.userId,
    blobId: record.blobId,
    originalName: record.originalName,
    displayName: record.displayName,
    mimeType: record.mimeType,
    fileType: record.fileType,
    sourceType: record.sourceType,
    sha256: record.sha256,
    size: record.size,
    extension: record.extension,
    width: record.width,
    height: record.height,
    duration: record.duration,
    status: record.status,
    createdAt: record.createdAt,
    downloadUrl,
    thumbnailUrl,
    previewUrl,
    thumbnailWidth: record.thumbnailWidth ?? undefined,
    thumbnailHeight: record.thumbnailHeight ?? undefined,
    previewWidth: record.previewWidth ?? undefined,
    previewHeight: record.previewHeight ?? undefined,
  };
}

function toFileRecord(row: FileAssetDbRow): FileAssetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    blobId: row.blob_id,
    originalName: row.original_name,
    displayName: row.display_name,
    mimeType: row.mime_type,
    fileType: row.file_type,
    sourceType: row.source_type,
    status: row.status,
    pendingUploadId: null,
    sha256: row.sha256,
    size: row.size === null ? null : Number(row.size),
    extension: row.extension,
    width: row.width,
    height: row.height,
    duration: row.duration,
    previewReady: row.preview_ready === true,
    previewWidth: row.preview_width ?? null,
    previewHeight: row.preview_height ?? null,
    thumbnailReady: row.thumbnail_ready === true,
    thumbnailWidth: row.thumbnail_width ?? null,
    thumbnailHeight: row.thumbnail_height ?? null,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
  };
}

function toExecutionListItem(run: ExecutionRunRecord): AdminExecutionListItem {
  return {
    runId: run.id,
    runNo: run.runNo,
    userId: run.userId,
    workflowId: run.workflowId,
    projectId: run.projectId,
    nodeType: run.nodeType,
    taskType: run.taskType,
    executionMode: run.executionMode,
    status: run.status,
    totalTaskCount: run.totalTaskCount,
    completedTaskCount: run.completedTaskCount,
    failedTaskCount: run.failedTaskCount,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function toExecutionDetailBase(run: ExecutionRunRecord): Omit<AdminExecutionDetailResponseData, "tasks" | "inputFiles" | "outputFiles"> {
  return {
    runId: run.id,
    runNo: run.runNo,
    userId: run.userId,
    workflowId: run.workflowId,
    projectId: run.projectId,
    nodeType: run.nodeType,
    taskType: run.taskType,
    executionMode: run.executionMode,
    nodeId: run.nodeId,
    nodeTitle: run.nodeTitle,
    provider: run.provider,
    status: run.status,
    totalTaskCount: run.totalTaskCount,
    completedTaskCount: run.completedTaskCount,
    failedTaskCount: run.failedTaskCount,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function toExecutionDetailBaseFromListItem(
  run: AdminExecutionListItem,
): Omit<AdminExecutionDetailResponseData, "tasks" | "inputFiles" | "outputFiles"> {
  return {
    ...run,
    nodeId: null,
    nodeTitle: null,
    provider: null,
  };
}

function toExecutionListItemFromRow(row: ExecutionRunDbRow): AdminExecutionListItem {
  return {
    runId: row.id,
    runNo: row.run_no,
    userId: row.user_id,
    workflowId: row.workflow_id,
    projectId: row.project_id,
    nodeType: row.node_type,
    taskType: row.task_type,
    executionMode: row.execution_mode,
    status: row.status,
    totalTaskCount: row.total_task_count,
    completedTaskCount: row.completed_task_count,
    failedTaskCount: row.failed_task_count,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
  };
}

function toWorkflowSummary(row: WorkflowDbRow): WorkflowSummaryItem {
  return {
    workflowId: row.id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    groupId: row.group_id,
    containerKey: row.container_key,
    isAutoNamed: row.is_auto_named,
    nodeCount: row.node_count,
    connectionCount: row.connection_count,
    timestamp: Number(row.timestamp),
    version: row.version,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

function isAccountUserRecord(row: AccountUserRecord | UserDbRow): row is AccountUserRecord {
  return "passwordHash" in row;
}

function toUserItem(row: AccountUserRecord | UserDbRow): UserItemResponseData {
  if (isAccountUserRecord(row)) {
    return {
      userId: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastLoginAt: toIsoString(row.last_login_at),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

function taskToQueryItem(task: ExecutionTaskRecord, run: ExecutionRunRecord | null): ExecutionTaskQueryItem {
  const input = task.input ?? {};
  const readString = (key: string): string | null =>
    typeof input[key] === "string" ? input[key] : null;
  const readStringArray = (key: string): string[] | null =>
    Array.isArray(input[key]) ? (input[key] as unknown[]).filter((item): item is string => typeof item === "string") : null;

  return {
    taskId: task.id,
    taskNo: task.taskNo,
    runId: task.runId,
    runNo: run?.runNo ?? null,
    workflowId: task.workflowId,
    projectId: task.projectId,
    nodeId: task.nodeId,
    nodeTitle: task.nodeTitle,
    nodeType: task.nodeType,
    taskType: task.taskType,
    groupId: task.groupId,
    groupOrder: task.groupOrder,
    provider: task.provider,
    model: task.model,
    status: task.status,
    currentStep: task.currentStep,
    currentAttemptNo: task.currentAttemptNo,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    maxAttempts: task.maxRetries + 1,
    lastErrorCode: task.lastErrorCode,
    lastErrorMessage: task.lastErrorMessage,
    resultFileId: task.resultFileId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    input,
    inputFileId: readString("inputFileId"),
    sourceFileId: readString("sourceFileId"),
    maskFileId: readString("maskFileId"),
    maskMode: readString("maskMode"),
    renderFileId: readString("renderFileId"),
    referenceFileId: readString("referenceFileId"),
    workflowTemplateKey: readString("workflowTemplateKey"),
    providerTaskId: readString("providerTaskId"),
    providerClientId: readString("providerClientId"),
    prompt: readString("prompt"),
    referenceFileIds: readStringArray("referenceFileIds"),
    stylePreset: readString("stylePreset"),
    imageSize: readString("imageSize"),
    aspectRatio: readString("aspectRatio"),
    quality: readString("quality"),
    providerRoute: readString("providerRoute"),
    providerModel: readString("providerModel"),
    resolvedSize: readString("resolvedSize"),
    whiteModelFileId: task.whiteModelFileId,
    styleReferenceFileId: task.styleReferenceFileId,
    inputFile: null,
    sourceFile: null,
    maskFile: null,
    renderFile: null,
    referenceFile: null,
    whiteModelFile: null,
    styleReferenceFile: null,
    resultFile: null,
  };
}

export class AdminRepository {
  private readonly env: ServiceEnv;
  private readonly rootDir: string;
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;
  private readonly objectStorage: ObjectStorageAdapter;

  constructor(options: AdminRepositoryOptions) {
    this.env = options.env;
    this.rootDir = options.rootDir;
    this.databaseConfig = options.env.database;
    this.pool = options.pool ?? null;
    this.objectStorage = options.objectStorage ?? new LocalObjectStorageAdapter(options.rootDir);
  }

  async getOverview(): Promise<AdminOverviewResponseData> {
    if (this.env.persistenceMode === "db") {
      return this.getDbOverview();
    }

    const [files, executions, accounts, workflows, storageIssues] = await Promise.all([
      this.readFileStore(),
      this.readExecutionStore(),
      this.readAccountStore(),
      this.readWorkflowSummaryIndex(),
      this.listStorageIssues({ page: 1, pageSize: 1_000 }),
    ]);
    const users = accounts.users;

    return {
      files: {
        total: files.files.length,
        ready: files.files.filter((file) => file.status === "ready").length,
        pendingUpload: files.files.filter((file) => file.status === "pending_upload").length,
      },
      executions: {
        totalRuns: executions.runs.length,
        queuedTasks: executions.tasks.filter((task) => task.status === "queued").length,
        processingTasks: executions.tasks.filter((task) => task.status === "processing").length,
        failedTasks: executions.tasks.filter((task) => task.status === "failed").length,
      },
      workflows: {
        total: workflows.items.length,
      },
      users: {
        total: users.length,
        admins: users.filter((user) => user.role === "admin").length,
        members: users.filter((user) => user.role === "member").length,
        disabled: users.filter((user) => user.status === "disabled").length,
      },
      storage: {
        issueCount: storageIssues.total,
      },
    };
  }

  async listFiles(query: AdminFileListQuery): Promise<AdminFileListResponseData> {
    if (this.env.persistenceMode === "db") {
      const files = await this.queryDbFiles(query);
      return paginate(files.map(toFileResponse), query);
    }

    const store = await this.readFileStore();
    const files = store.files.filter((file) => {
      return (!query.userId || file.userId === query.userId)
        && (!query.status || file.status === query.status)
        && (!query.fileType || file.fileType === query.fileType)
        && (!query.sourceType || file.sourceType === query.sourceType)
        && (!query.q || includesText(file.displayName, query.q) || includesText(file.originalName, query.q));
    });

    return paginate(files.map(toFileResponse), query);
  }

  async getFileUsage(fileId: string): Promise<AdminFileUsageResponseData | null> {
    const file = await this.findFile(fileId);
    if (!file) {
      return null;
    }

    if (this.env.persistenceMode === "db") {
      return {
        file,
        workflows: await this.queryDbFileWorkflowUsage(fileId),
        tasks: await this.queryDbFileTaskUsage(fileId),
      };
    }

    return {
      file,
      workflows: await this.queryJsonFileWorkflowUsage(fileId),
      tasks: await this.queryJsonFileTaskUsage(fileId),
    };
  }

  async listExecutions(query: AdminExecutionListQuery): Promise<AdminExecutionListResponseData> {
    if (this.env.persistenceMode === "db") {
      const runs = await this.queryDbRuns(query);
      return paginate(runs, query);
    }

    const store = await this.readExecutionStore();
    const runs = store.runs
      .filter((run) =>
        (!query.userId || run.userId === query.userId)
        && (!query.workflowId || run.workflowId === query.workflowId)
        && (!query.status || run.status === query.status)
        && (!query.nodeType || run.nodeType === query.nodeType)
        && (!query.taskType || run.taskType === query.taskType))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toExecutionListItem);

    return paginate(runs, query);
  }

  async getExecutionDetail(runId: string): Promise<AdminExecutionDetailResponseData | null> {
    if (this.env.persistenceMode === "db") {
      const list = await this.queryDbRuns({ page: 1, pageSize: 1_000 });
      const run = list.find((item) => item.runId === runId);
      if (!run) {
        return null;
      }

      const tasks = await this.queryDbRunTasks(runId);
      const files = await this.queryDbRunFiles(runId);
      return {
        ...toExecutionDetailBaseFromListItem(run),
        tasks,
        inputFiles: files.filter((item) => item.role !== "output").map((item) => item.file),
        outputFiles: files.filter((item) => item.role === "output").map((item) => item.file),
      };
    }

    const store = await this.readExecutionStore();
    const runRecord = store.runs.find((run) => run.id === runId);
    if (!runRecord) {
      return null;
    }

    const tasks = store.tasks
      .filter((task) => task.runId === runId)
      .map((task) => taskToQueryItem(task, runRecord));
    const links = (store.taskFileLinks ?? []).filter((link) =>
      tasks.some((task) => task.taskId === link.taskId));
    const fileIds = [...new Set([
      ...tasks.map((task) => task.resultFileId).filter((id): id is string => typeof id === "string"),
      ...links.map((link) => link.fileId),
    ])];
    const files = await this.findFiles(fileIds);
    const fileById = new Map(files.map((file) => [file.fileId, file]));

    return {
      ...toExecutionDetailBase(runRecord),
      tasks,
      inputFiles: links.filter((link) => link.role !== "output").map((link) => fileById.get(link.fileId)).filter((file): file is FileAssetResponse => Boolean(file)),
      outputFiles: [
        ...links.filter((link) => link.role === "output").map((link) => fileById.get(link.fileId)),
        ...tasks.map((task) => task.resultFileId ? fileById.get(task.resultFileId) : undefined),
      ].filter((file): file is FileAssetResponse => Boolean(file)),
    };
  }

  async listWorkflows(query: AdminWorkflowListQuery): Promise<AdminWorkflowListResponseData> {
    if (this.env.persistenceMode === "db") {
      const workflows = await this.queryDbWorkflows(query);
      return paginate(workflows, query);
    }

    const index = await this.readWorkflowSummaryIndex();
    const workflows = index.items
      .filter((workflow) =>
        (!query.ownerUserId || workflow.ownerUserId === query.ownerUserId)
        && (!query.groupId || workflow.groupId === query.groupId)
        && (!query.q || includesText(workflow.name, query.q)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return paginate(workflows, query);
  }

  async getWorkflowDetail(workflowId: string): Promise<AdminWorkflowDetailResponseData | null> {
    const detail = this.env.persistenceMode === "db"
      ? await this.queryDbWorkflowDetail(workflowId)
      : await this.readWorkflowDetail(workflowId);

    if (!detail) {
      return null;
    }

    const fileUsage = await this.queryJsonWorkflowFileIds(workflowId);
    const files = await this.findFiles(fileUsage);
    const executionStore = this.env.persistenceMode === "db" ? null : await this.readExecutionStore();

    return {
      ...detail,
      files,
      tasks: executionStore
        ? executionStore.tasks
            .filter((task) => task.workflowId === workflowId)
            .map((task) => taskToQueryItem(task, executionStore.runs.find((run) => run.id === task.runId) ?? null))
        : await this.queryDbWorkflowTasks(workflowId),
    };
  }

  async listUsers(query: AdminUserListQuery): Promise<AdminUserListResponseData> {
    if (this.env.persistenceMode === "db") {
      const rows = await this.queryDbUsers(query);
      return paginate(rows.map(toUserItem), query);
    }

    const store = await this.readAccountStore();
    const users = store.users
      .filter((user) =>
        (!query.role || user.role === query.role)
        && (!query.status || user.status === query.status)
        && (!query.q || includesText(user.email, query.q) || includesText(user.displayName, query.q)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(toUserItem);

    return paginate(users, query);
  }

  async listStorageIssues(query: AdminStorageIssueListQuery): Promise<AdminStorageIssueListResponseData> {
    const files = this.env.persistenceMode === "db"
      ? await this.queryDbFiles({})
      : (await this.readFileStore()).files;
    const issues: AdminStorageIssueItem[] = [];
    const dbBlobKeys = this.env.persistenceMode === "db"
      ? await this.queryDbStorageIssueBlobRows()
      : [];
    const dbBlobKeysByFileId = new Map(dbBlobKeys.map((row) => [row.file_id, row]));

    for (const file of files) {
      if (file.status === "ready" && !file.blobId) {
        issues.push({
          id: `file:${file.id}:missing-blob`,
          type: "missing_blob",
          severity: "error",
          fileId: file.id,
          blobId: null,
          storageKey: null,
          message: "Ready file asset has no blob reference.",
        });
      }

      if (file.status === "pending_upload") {
        issues.push({
          id: `file:${file.id}:pending-upload`,
          type: "pending_upload",
          severity: "warning",
          fileId: file.id,
          blobId: file.blobId,
          storageKey: null,
          message: "File upload is still pending.",
        });
      }

      if (this.env.persistenceMode === "db" && file.status === "ready" && file.blobId) {
        const blobKeys = dbBlobKeysByFileId.get(file.id);

        if (!blobKeys || !blobKeys.blob_id) {
          issues.push({
            id: `file:${file.id}:blob-record-missing`,
            type: "missing_blob",
            severity: "error",
            fileId: file.id,
            blobId: file.blobId,
            storageKey: null,
            message: "File asset references a blob record that does not exist.",
          });
          continue;
        }

        await this.appendMissingStorageObjectIssues(issues, file, blobKeys);
      }
    }

    return paginate(issues.filter((issue) =>
      (!query.severity || issue.severity === query.severity)
      && (!query.type || issue.type === query.type)), query);
  }

  private async appendMissingStorageObjectIssues(
    issues: AdminStorageIssueItem[],
    file: FileAssetRecord,
    blobKeys: StorageIssueBlobDbRow,
  ): Promise<void> {
    const keys: Array<{ kind: string; required: boolean; storageKey: string | null }> = [
      { kind: "original", required: true, storageKey: blobKeys.original_storage_key },
      { kind: "preview", required: file.previewReady, storageKey: blobKeys.preview_storage_key },
      { kind: "thumbnail", required: file.thumbnailReady, storageKey: blobKeys.thumbnail_storage_key },
    ];

    for (const item of keys) {
      if (!item.required) {
        continue;
      }

      if (!item.storageKey) {
        issues.push({
          id: `file:${file.id}:${item.kind}:missing-storage-variant`,
          type: "missing_storage_variant",
          severity: "error",
          fileId: file.id,
          blobId: file.blobId,
          storageKey: null,
          message: `Expected ${item.kind} variant is missing from file_blob_variants.`,
        });
        continue;
      }

      if (await this.storageObjectExists(item.storageKey)) {
        continue;
      }

      issues.push({
        id: `file:${file.id}:${item.kind}:missing-storage-object`,
        type: "missing_storage_object",
        severity: "error",
        fileId: file.id,
        blobId: file.blobId,
        storageKey: item.storageKey,
        message: `Referenced ${item.kind} storage object is missing from configured object storage.`,
      });
    }
  }

  private async storageObjectExists(storageKey: string): Promise<boolean> {
    try {
      return await this.objectStorage.exists(storageKey);
    } catch {
      return false;
    }
  }

  private async findFile(fileId: string): Promise<FileAssetResponse | null> {
    const files = await this.findFiles([fileId]);
    return files[0] ?? null;
  }

  private async findFiles(fileIds: string[]): Promise<FileAssetResponse[]> {
    if (fileIds.length === 0) {
      return [];
    }

    if (this.env.persistenceMode === "db") {
      const rows = await this.query<FileAssetDbRow>(
        `
          select ${FILE_SELECT_COLUMNS}
          from file_assets
          where id = any($1::uuid[])
        `,
        [fileIds],
      );
      return rows.rows.map((row) => toFileResponse(toFileRecord(row)));
    }

    const store = await this.readFileStore();
    const ids = new Set(fileIds);
    return store.files.filter((file) => ids.has(file.id)).map(toFileResponse);
  }

  private async getDbOverview(): Promise<AdminOverviewResponseData> {
    const result = await this.query<DbQueryRow>(
      `
        select
          (select count(*)::int from file_assets) as files_total,
          (select count(*)::int from file_assets where status = 'ready') as files_ready,
          (select count(*)::int from file_assets where status = 'pending_upload') as files_pending,
          (select count(*)::int from execution_runs) as runs_total,
          (select count(*)::int from execution_tasks where status = 'queued') as tasks_queued,
          (select count(*)::int from execution_tasks where status = 'processing') as tasks_processing,
          (select count(*)::int from execution_tasks where status = 'failed') as tasks_failed,
          (select count(*)::int from workflows) as workflows_total,
          (select count(*)::int from users) as users_total,
          (select count(*)::int from users where role = 'admin') as users_admins,
          (select count(*)::int from users where role = 'member') as users_members,
          (select count(*)::int from users where status = 'disabled') as users_disabled
      `,
    );
    const row = result.rows[0] ?? {};
    const storageIssues = await this.listStorageIssues({ page: 1, pageSize: 1 });

    return {
      files: {
        total: Number(row.files_total ?? 0),
        ready: Number(row.files_ready ?? 0),
        pendingUpload: Number(row.files_pending ?? 0),
      },
      executions: {
        totalRuns: Number(row.runs_total ?? 0),
        queuedTasks: Number(row.tasks_queued ?? 0),
        processingTasks: Number(row.tasks_processing ?? 0),
        failedTasks: Number(row.tasks_failed ?? 0),
      },
      workflows: {
        total: Number(row.workflows_total ?? 0),
      },
      users: {
        total: Number(row.users_total ?? 0),
        admins: Number(row.users_admins ?? 0),
        members: Number(row.users_members ?? 0),
        disabled: Number(row.users_disabled ?? 0),
      },
      storage: {
        issueCount: storageIssues.total,
      },
    };
  }

  private async queryDbFiles(query: AdminFileListQuery): Promise<FileAssetRecord[]> {
    const result = await this.query<FileAssetDbRow>(
      `
        select ${FILE_SELECT_COLUMNS}
        from file_assets
        order by created_at desc, id desc
      `,
    );

    return result.rows.map(toFileRecord).filter((file) =>
      (!query.userId || file.userId === query.userId)
      && (!query.status || file.status === query.status)
      && (!query.fileType || file.fileType === query.fileType)
      && (!query.sourceType || file.sourceType === query.sourceType)
      && (!query.q || includesText(file.displayName, query.q) || includesText(file.originalName, query.q)));
  }

  private async queryDbRuns(query: AdminExecutionListQuery): Promise<AdminExecutionListItem[]> {
    const result = await this.query<ExecutionRunDbRow>(
      `
        select ${RUN_SELECT_COLUMNS}
        from execution_runs
        order by created_at desc, id desc
      `,
    );

    return result.rows.map(toExecutionListItemFromRow).filter((run) =>
      (!query.userId || run.userId === query.userId)
      && (!query.workflowId || run.workflowId === query.workflowId)
      && (!query.status || run.status === query.status)
      && (!query.nodeType || run.nodeType === query.nodeType)
      && (!query.taskType || run.taskType === query.taskType));
  }

  private async queryDbWorkflows(query: AdminWorkflowListQuery): Promise<WorkflowSummaryItem[]> {
    const result = await this.query<WorkflowDbRow>(
      `
        select
          id,
          project_id,
          owner_user_id,
          name,
          group_id,
          container_key,
          is_auto_named,
          node_count,
          connection_count,
          timestamp,
          version,
          created_at,
          updated_at
        from workflows
        order by updated_at desc, id desc
      `,
    );

    return result.rows.map(toWorkflowSummary).filter((workflow) =>
      (!query.ownerUserId || workflow.ownerUserId === query.ownerUserId)
      && (!query.groupId || workflow.groupId === query.groupId)
      && (!query.q || includesText(workflow.name, query.q)));
  }

  private async queryDbUsers(query: AdminUserListQuery): Promise<UserDbRow[]> {
    const result = await this.query<UserDbRow>(
      `
        select
          id,
          email,
          display_name,
          role,
          status,
          last_login_at,
          created_at,
          updated_at
        from users
        order by created_at asc, id asc
      `,
    );

    return result.rows.filter((user) =>
      (!query.role || user.role === query.role)
      && (!query.status || user.status === query.status)
      && (!query.q || includesText(user.email, query.q) || includesText(user.display_name, query.q)));
  }

  private async queryDbStorageIssueBlobRows(): Promise<StorageIssueBlobDbRow[]> {
    const result = await this.query<StorageIssueBlobDbRow>(
      `
        select
          file_assets.id::text as file_id,
          file_blobs.id::text as blob_id,
          max(file_blob_variants.storage_key)
            filter (
              where file_blob_variants.variant = 'original'
                and file_blob_variants.variant_key = 'default'
            ) as original_storage_key,
          max(file_blob_variants.storage_key)
            filter (
              where file_blob_variants.variant = 'preview'
                and file_blob_variants.variant_key = 'default'
            ) as preview_storage_key,
          max(file_blob_variants.storage_key)
            filter (
              where file_blob_variants.variant = 'thumbnail'
                and file_blob_variants.variant_key = 'default'
            ) as thumbnail_storage_key
        from file_assets
        left join file_blobs on file_blobs.id = file_assets.blob_id
        left join file_blob_variants on file_blob_variants.blob_id = file_blobs.id
          and file_blob_variants.variant in ('original', 'preview', 'thumbnail')
        where file_assets.status = 'ready'
        group by file_assets.id, file_blobs.id
      `,
    );

    return result.rows;
  }

  private async queryDbFileWorkflowUsage(fileId: string): Promise<AdminFileUsageWorkflowItem[]> {
    const result = await this.query<DbQueryRow>(
      `
        select
          workflow_file_bindings.workflow_id,
          workflows.name as workflow_name,
          workflow_file_bindings.owner_user_id,
          workflow_file_bindings.node_id,
          workflow_file_bindings.role
        from workflow_file_bindings
        left join workflows on workflows.id = workflow_file_bindings.workflow_id
        where workflow_file_bindings.file_id = $1::uuid
        order by workflow_file_bindings.created_at asc
      `,
      [fileId],
    );

    return result.rows.map((row) => ({
      workflowId: String(row.workflow_id),
      workflowName: typeof row.workflow_name === "string" ? row.workflow_name : null,
      ownerUserId: typeof row.owner_user_id === "string" ? row.owner_user_id : null,
      nodeId: typeof row.node_id === "string" ? row.node_id : null,
      role: String(row.role ?? "unknown"),
    }));
  }

  private async queryDbFileTaskUsage(fileId: string): Promise<AdminFileUsageTaskItem[]> {
    const result = await this.query<DbQueryRow>(
      `
        select
          task_file_links.task_id::text,
          execution_tasks.task_no,
          execution_tasks.run_id::text,
          execution_runs.run_no,
          task_file_links.workflow_id,
          execution_tasks.node_type,
          task_file_links.role
        from task_file_links
        left join execution_tasks on execution_tasks.id = task_file_links.task_id
        left join execution_runs on execution_runs.id = execution_tasks.run_id
        where task_file_links.file_id = $1::uuid
        order by task_file_links.created_at asc
      `,
      [fileId],
    );

    return result.rows.map((row) => ({
      taskId: String(row.task_id),
      taskNo: typeof row.task_no === "string" ? row.task_no : null,
      runId: typeof row.run_id === "string" ? row.run_id : null,
      runNo: typeof row.run_no === "string" ? row.run_no : null,
      workflowId: typeof row.workflow_id === "string" ? row.workflow_id : null,
      nodeType: typeof row.node_type === "string" ? row.node_type : null,
      role: String(row.role ?? "unknown"),
    }));
  }

  private async queryDbRunTasks(runId: string): Promise<ExecutionTaskQueryItem[]> {
    const result = await this.query<DbQueryRow>(
      `
        select
          id::text,
          task_no,
          run_id::text,
          user_id,
          workflow_id,
          project_id,
          node_type,
          node_id,
          node_title,
          task_type,
          group_id,
          group_order,
          provider,
          model,
          input,
          status,
          current_step,
          current_attempt_no,
          retry_count,
          max_retries,
          last_error_code,
          last_error_message,
          result_file_id::text,
          created_at,
          started_at,
          completed_at
        from execution_tasks
        where run_id = $1::uuid
        order by created_at asc, task_no asc
      `,
      [runId],
    );

    return result.rows.map((row) => taskToQueryItem({
      id: String(row.id),
      taskNo: String(row.task_no),
      runId: String(row.run_id),
      userId: typeof row.user_id === "string" ? row.user_id : null,
      workflowId: typeof row.workflow_id === "string" ? row.workflow_id : null,
      projectId: typeof row.project_id === "string" ? row.project_id : null,
      nodeType: String(row.node_type),
      nodeId: typeof row.node_id === "string" ? row.node_id : null,
      nodeTitle: typeof row.node_title === "string" ? row.node_title : null,
      taskType: String(row.task_type) as ExecutionTaskRecord["taskType"],
      groupId: typeof row.group_id === "string" ? row.group_id : null,
      groupOrder: typeof row.group_order === "number" ? row.group_order : null,
      provider: typeof row.provider === "string" ? row.provider : null,
      model: typeof row.model === "string" ? row.model : null,
      input: row.input && typeof row.input === "object" && !Array.isArray(row.input) ? row.input as Record<string, unknown> : null,
      status: String(row.status) as ExecutionTaskRecord["status"],
      currentStep: typeof row.current_step === "string" ? row.current_step as ExecutionTaskRecord["currentStep"] : null,
      currentAttemptNo: Number(row.current_attempt_no ?? 0),
      retryCount: Number(row.retry_count ?? 0),
      maxRetries: Number(row.max_retries ?? 0),
      lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : null,
      lastErrorMessage: typeof row.last_error_message === "string" ? row.last_error_message : null,
      resultFileId: typeof row.result_file_id === "string" ? row.result_file_id : null,
      claimedBy: null,
      claimedAt: null,
      leaseUntil: null,
      heartbeatAt: null,
      attemptStartedAt: null,
      createdAt: toIsoString(row.created_at as Date | string) ?? new Date().toISOString(),
      startedAt: toIsoString(row.started_at as Date | string | null),
      completedAt: toIsoString(row.completed_at as Date | string | null),
      whiteModelFileId: null,
      styleReferenceFileId: null,
    }, null));
  }

  private async queryDbRunFiles(runId: string): Promise<Array<{ role: string; file: FileAssetResponse }>> {
    const result = await this.query<FileAssetDbRow & { role: string }>(
      `
        select
          task_file_links.role,
          ${FILE_SELECT_COLUMNS.split("\n").map((line) => line.trim()).filter(Boolean).map((column) => `file_assets.${column}`).join(",\n          ")}
        from task_file_links
        join execution_tasks on execution_tasks.id = task_file_links.task_id
        join file_assets on file_assets.id = task_file_links.file_id
        where execution_tasks.run_id = $1::uuid
        order by task_file_links.created_at asc
      `,
      [runId],
    );

    return result.rows.map((row) => ({
      role: row.role,
      file: toFileResponse(toFileRecord(row)),
    }));
  }

  private async queryDbWorkflowDetail(workflowId: string): Promise<WorkflowDetailResponseData | null> {
    const result = await this.query<WorkflowDbRow>(
      `
        select
          id,
          project_id,
          owner_user_id,
          name,
          group_id,
          container_key,
          is_auto_named,
          node_count,
          connection_count,
          timestamp,
          version,
          payload,
          created_at,
          updated_at
        from workflows
        where id = $1
        limit 1
      `,
      [workflowId],
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      workflowId: row.id,
      ownerUserId: row.owner_user_id,
      groupId: row.group_id,
      containerKey: row.container_key,
      isAutoNamed: row.is_auto_named,
      workflow: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload as WorkflowDetailResponseData["workflow"]
        : {
            projectId: row.project_id,
            name: row.name,
            nodes: {},
            connections: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            metadata: {},
            timestamp: Number(row.timestamp),
            version: row.version,
          },
      createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private async queryDbWorkflowTasks(workflowId: string): Promise<ExecutionTaskQueryItem[]> {
    const runs = await this.queryDbRuns({ workflowId, page: 1, pageSize: 1_000 });
    const tasks = await Promise.all(runs.map((run) => this.queryDbRunTasks(run.runId)));
    return tasks.flat();
  }

  private async queryJsonFileWorkflowUsage(fileId: string): Promise<AdminFileUsageWorkflowItem[]> {
    const index = await this.readWorkflowSummaryIndex();
    const workflows: AdminFileUsageWorkflowItem[] = [];

    for (const item of index.items) {
      const bindings = await this.readWorkflowBindings(item.workflowId);
      for (const binding of bindings) {
        if (binding.fileId !== fileId) {
          continue;
        }

        workflows.push({
          workflowId: item.workflowId,
          workflowName: item.name,
          ownerUserId: item.ownerUserId,
          nodeId: binding.nodeId,
          role: binding.role,
        });
      }
    }

    return workflows;
  }

  private async queryJsonFileTaskUsage(fileId: string): Promise<AdminFileUsageTaskItem[]> {
    const store = await this.readExecutionStore();
    const links = (store.taskFileLinks ?? []).filter((link) => link.fileId === fileId);

    return links.map((link) => {
      const task = store.tasks.find((item) => item.id === link.taskId) ?? null;
      const run = task ? store.runs.find((item) => item.id === task.runId) ?? null : null;
      return {
        taskId: link.taskId,
        taskNo: task?.taskNo ?? null,
        runId: task?.runId ?? null,
        runNo: run?.runNo ?? null,
        workflowId: link.workflowId ?? task?.workflowId ?? null,
        nodeType: task?.nodeType ?? null,
        role: link.role,
      };
    });
  }

  private async queryJsonWorkflowFileIds(workflowId: string): Promise<string[]> {
    if (this.env.persistenceMode === "db") {
      const result = await this.query<DbQueryRow>(
        `
          select file_id::text
          from workflow_file_bindings
          where workflow_id = $1
        `,
        [workflowId],
      );
      return result.rows.map((row) => String(row.file_id));
    }

    const bindings = await this.readWorkflowBindings(workflowId);
    return [...new Set(bindings.map((binding) => binding.fileId))];
  }

  private async readFileStore(): Promise<FileStore> {
    return this.readJson(path.join(this.rootDir, "data", "files", "files-store.json"), {
      blobs: [],
      files: [],
      pendingUploads: [],
    });
  }

  private async readExecutionStore(): Promise<ExecutionStore> {
    return this.readJson(path.join(this.rootDir, "data", "executions-store.json"), {
      runs: [],
      tasks: [],
      events: [],
      taskFileLinks: [],
    } as ExecutionStore);
  }

  private async readAccountStore(): Promise<AccountStore> {
    return this.readJson(path.join(this.rootDir, "data", "accounts-store.json"), {
      users: [],
      auditLogs: [],
    });
  }

  private async readWorkflowSummaryIndex(): Promise<WorkflowSummaryIndex> {
    return this.readJson(path.join(this.rootDir, "data", "workflows", "index.json"), {
      items: [],
    });
  }

  private async readWorkflowDetail(workflowId: string): Promise<WorkflowDetailResponseData | null> {
    const document = await this.readJson<StoredWorkflowDocument | null>(
      path.join(this.rootDir, "data", "workflows", workflowId, "workflow.json"),
      null,
    );

    if (!document) {
      return null;
    }

    return {
      workflowId: document.workflowId,
      ownerUserId: document.ownerUserId,
      groupId: document.groupId,
      containerKey: document.containerKey,
      isAutoNamed: document.isAutoNamed,
      workflow: document.workflow,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private async readWorkflowBindings(workflowId: string): Promise<Array<{
    fileId: string;
    nodeId: string | null;
    role: string;
  }>> {
    const document = await this.readJson<{ items?: Array<{ fileId?: unknown; nodeId?: unknown; role?: unknown }> }>(
      path.join(this.rootDir, "data", "workflows", workflowId, "files.json"),
      { items: [] },
    );

    return (document.items ?? []).flatMap((item) =>
      typeof item.fileId === "string"
        ? [{
            fileId: item.fileId,
            nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
            role: typeof item.role === "string" ? item.role : "unknown",
          }]
        : []);
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return fallback;
      }

      throw error;
    }
  }

  private async query<T extends DbQueryRow = DbQueryRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    if (this.pool) {
      return this.pool.query<T>(text, values);
    }

    return queryPostgres<T>(this.databaseConfig, text, values);
  }
}
