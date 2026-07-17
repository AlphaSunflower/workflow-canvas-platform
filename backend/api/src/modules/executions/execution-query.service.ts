import type {
  ExecutionRunDetailResponseData,
  ExecutionTaskEventPayload,
  ExecutionTaskQueryItem,
  FileAssetResponse,
  TaskDetailResponseData,
  TaskEventsResponseData,
  TaskListQuery,
  TaskListResponseData,
  WorkflowExecutionReconcileRunResponseData,
} from "@newworkflow/backend-shared/api";
import type { ExecutionStatus } from "@newworkflow/backend-shared/execution";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import type { FilesRepository } from "../files/files.repository.types.ts";
import {
  WorkflowTaskHistoryRepository,
  type WorkflowTaskHistoryRecord,
} from "../workflows/workflow-task-history.repository.ts";
import type { WorkflowRepository } from "../workflows/workflow.repository.types.ts";
import type {
  ExecutionTaskEventRecord,
  ExecutionTaskRecord,
} from "./execution-records.types.ts";
import type { ExecutionsRepository } from "./executions.repository.types.ts";

interface TaskQueryHydrationOptions {
  includeProviderEventPayload?: boolean;
  filesById?: Map<string, FileAssetResponse>;
  hydrationMode?: "full" | "reconcile";
}

function toEventPayload(event: ExecutionTaskEventRecord): ExecutionTaskEventPayload {
  return {
    eventId: event.id,
    eventType: event.eventType,
    runId: event.runId,
    taskId: event.taskId,
    attemptNo: event.attemptNo,
    status: event.status,
    phase: event.phase,
    stepType: event.stepType,
    progress: event.progress,
    message: event.message,
    payload: event.payload,
    timestamp: event.createdAt,
  };
}

export class ExecutionQueryService {
  private readonly executionsRepository: ExecutionsRepository;
  private readonly filesRepository: FilesRepository;
  private readonly workflowRepository: WorkflowRepository;
  private readonly workflowTaskHistoryRepository: WorkflowTaskHistoryRepository;

  constructor(
    executionsRepository: ExecutionsRepository,
    filesRepository: FilesRepository,
    workflowRepository: WorkflowRepository,
    workflowTaskHistoryRepository: WorkflowTaskHistoryRepository,
  ) {
    this.executionsRepository = executionsRepository;
    this.filesRepository = filesRepository;
    this.workflowRepository = workflowRepository;
    this.workflowTaskHistoryRepository = workflowTaskHistoryRepository;
  }

  async getExecutionRun(runId: string): Promise<ExecutionRunDetailResponseData | null> {
    const run = await this.executionsRepository.getExecutionRun(runId);

    if (!run) {
      return null;
    }

    const tasks = await this.executionsRepository.getTasksByRunId(runId);
    const hydratedTasks = await Promise.all(tasks.map((task) => this.toTaskQueryItem(task)));

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
      tasks: hydratedTasks,
    };
  }

  async getExecutionRunForActor(
    authenticated: AuthenticatedAccount,
    runId: string,
  ): Promise<ExecutionRunDetailResponseData | null> {
    const run = await this.executionsRepository.getExecutionRun(runId);

    if (!run) {
      return null;
    }

    if (!this.canAccessUserData(authenticated, run.userId)) {
      return null;
    }

    return this.getExecutionRun(runId);
  }

  async getLatestCompletedWorkflowNodeRunForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
    nodeId: string,
  ): Promise<WorkflowExecutionReconcileRunResponseData | null> {
    const workflow = await this.workflowRepository.findSummaryById(workflowId);

    if (!workflow || !this.canAccessWorkflow(authenticated, workflow.ownerUserId)) {
      return null;
    }

    const run = await this.executionsRepository.findLatestCompletedRunForWorkflowNode(
      workflowId,
      nodeId,
    );

    if (!run) {
      return null;
    }

    const tasks = await this.executionsRepository.getTasksByRunId(run.id);
    const filesById = await this.buildFilesByIdForTasks(tasks, { mode: "reconcile" });
    const hydratedTasks = await Promise.all(tasks.map((task) => this.toTaskQueryItem(task, {
      includeProviderEventPayload: false,
      filesById,
      hydrationMode: "reconcile",
    })));

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
      tasks: hydratedTasks,
    };
  }

  async listTasks(query: TaskListQuery): Promise<TaskListResponseData> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);
    const status = query.status as ExecutionStatus | undefined;

    const result = await this.executionsRepository.listTasks({
      runId: query.runId,
      userId: query.userId,
      status,
      page,
      pageSize,
    });

    const items = await Promise.all(result.items.map((task) => this.toTaskQueryItem(task)));

    return {
      items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async listTasksForActor(
    authenticated: AuthenticatedAccount,
    query: TaskListQuery,
  ): Promise<TaskListResponseData> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);
    const status = query.status as ExecutionStatus | undefined;
    const enforcedUserId = authenticated.user.role === "admin"
      ? query.userId
      : authenticated.user.userId;

    const result = await this.executionsRepository.listTasks({
      runId: query.runId,
      userId: enforcedUserId,
      status,
      page,
      pageSize,
    });

    const items = await Promise.all(result.items.map((task) => this.toTaskQueryItem(task)));

    return {
      items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async listWorkflowTasksForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
    query: TaskListQuery,
  ): Promise<TaskListResponseData | null> {
    const workflow = await this.workflowRepository.findSummaryById(workflowId);

    if (!workflow || !this.canAccessWorkflow(authenticated, workflow.ownerUserId)) {
      return null;
    }

    const result = await this.workflowTaskHistoryRepository.listTasks(workflowId, {
      runId: query.runId,
      status: query.status,
      nodeId: query.nodeId,
      nodeType: query.nodeType,
      taskType: query.taskType,
      page: this.parsePositiveInt(query.page, 1),
      pageSize: this.parsePositiveInt(query.pageSize, 20),
      sortBy: query.sortBy ?? "sequence",
      sortOrder: query.sortOrder ?? "desc",
    });

    const items = await Promise.all(
      result.items.map((task) => this.toTaskQueryItemFromHistory(task)),
    );

    return {
      items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async getTaskDetail(taskId: string): Promise<TaskDetailResponseData | null> {
    const task = await this.executionsRepository.getTaskById(taskId);

    if (!task) {
      return null;
    }

    const taskItem = await this.toTaskQueryItem(task);
    const recentEvents = await this.executionsRepository.getTaskEvents(taskId);

    return {
      ...taskItem,
      recentEvents: recentEvents.map(toEventPayload),
    };
  }

  async getTaskDetailForActor(
    authenticated: AuthenticatedAccount,
    taskId: string,
  ): Promise<TaskDetailResponseData | null> {
    const task = await this.executionsRepository.getTaskById(taskId);

    if (!task) {
      return null;
    }

    if (!this.canAccessUserData(authenticated, task.userId)) {
      return null;
    }

    return this.getTaskDetail(taskId);
  }

  async getWorkflowTaskDetailForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
    taskId: string,
  ): Promise<TaskDetailResponseData | null> {
    const workflow = await this.workflowRepository.findSummaryById(workflowId);

    if (!workflow || !this.canAccessWorkflow(authenticated, workflow.ownerUserId)) {
      return null;
    }

    const task = await this.workflowTaskHistoryRepository.getTaskById(workflowId, taskId);

    if (!task) {
      return null;
    }

    const taskItem = await this.toTaskQueryItemFromHistory(task);
    const recentEvents = await this.workflowTaskHistoryRepository.getTaskEvents(workflowId, taskId, {
      sortOrder: "desc",
      page: 1,
      pageSize: 50,
    });

    return {
      ...taskItem,
      recentEvents: recentEvents.items.map(toEventPayload),
    };
  }

  async getTaskEvents(taskId: string): Promise<TaskEventsResponseData | null> {
    const task = await this.executionsRepository.getTaskById(taskId);

    if (!task) {
      return null;
    }

    const events = await this.executionsRepository.getTaskEvents(taskId);

    return {
      messageType: "task_event",
      items: events.map(toEventPayload),
      total: events.length,
    };
  }

  async getTaskEventsForActor(
    authenticated: AuthenticatedAccount,
    taskId: string,
  ): Promise<TaskEventsResponseData | null> {
    const task = await this.executionsRepository.getTaskById(taskId);

    if (!task) {
      return null;
    }

    if (!this.canAccessUserData(authenticated, task.userId)) {
      return null;
    }

    return this.getTaskEvents(taskId);
  }

  async getWorkflowTaskEventsForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
    taskId: string,
    query: Pick<TaskListQuery, never> & {
      page?: number;
      pageSize?: number;
      sortOrder?: "asc" | "desc";
    },
  ): Promise<TaskEventsResponseData | null> {
    const workflow = await this.workflowRepository.findSummaryById(workflowId);

    if (!workflow || !this.canAccessWorkflow(authenticated, workflow.ownerUserId)) {
      return null;
    }

    const task = await this.workflowTaskHistoryRepository.getTaskById(workflowId, taskId);

    if (!task) {
      return null;
    }

    const events = await this.workflowTaskHistoryRepository.getTaskEvents(workflowId, taskId, {
      page: this.parsePositiveInt(query.page, 1),
      pageSize: this.parsePositiveInt(query.pageSize, 50),
      sortOrder: query.sortOrder ?? "asc",
    });

    return {
      messageType: "task_event",
      items: events.items.map(toEventPayload),
      total: events.total,
    };
  }

  private async toTaskQueryItem(
    task: ExecutionTaskRecord,
    options?: TaskQueryHydrationOptions,
  ): Promise<ExecutionTaskQueryItem> {
    const runNo = await this.resolveRunNo(task.runId);

    return this.toTaskQueryItemShape({
      sequence: undefined,
      taskId: task.id,
      taskNo: task.taskNo,
      runId: task.runId,
      runNo,
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
      lastErrorCode: task.lastErrorCode,
      lastErrorMessage: task.lastErrorMessage,
      resultFileId: task.resultFileId,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      durationMs: this.toDurationMs(task.startedAt, task.completedAt),
      input: task.input,
      whiteModelFileId: task.whiteModelFileId,
      styleReferenceFileId: task.styleReferenceFileId,
    }, options);
  }

  private async toTaskQueryItemFromHistory(
    task: WorkflowTaskHistoryRecord,
    options?: TaskQueryHydrationOptions,
  ): Promise<ExecutionTaskQueryItem> {
    const runNo = task.runNo ?? await this.resolveRunNo(task.runId);

    return this.toTaskQueryItemShape({
      sequence: task.sequence,
      taskId: task.taskId,
      taskNo: task.taskNo,
      runId: task.runId,
      runNo,
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
      lastErrorCode: task.lastErrorCode,
      lastErrorMessage: task.lastErrorMessage,
      resultFileId: task.resultFileId,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      durationMs: task.durationMs,
      input: task.input,
      whiteModelFileId: task.whiteModelFileId,
      styleReferenceFileId: task.styleReferenceFileId,
    }, options);
  }

  private async toTaskQueryItemShape(inputTask: {
    sequence?: number;
    taskId: string;
    taskNo: string;
    runId: string;
    runNo: string | null;
    workflowId: string | null;
    projectId: string | null;
    nodeId: string | null;
    nodeTitle: string | null;
    nodeType: string;
    taskType: string;
    groupId: string | null;
    groupOrder: number | null;
    provider: string | null;
    model: string | null;
    status: ExecutionStatus;
    currentStep: string | null;
    currentAttemptNo: number;
    retryCount: number;
    maxRetries: number;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    resultFileId: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs?: number | null;
    input: Record<string, unknown> | null;
    whiteModelFileId: string | null;
    styleReferenceFileId: string | null;
  }, options?: TaskQueryHydrationOptions): Promise<ExecutionTaskQueryItem> {
    const input = inputTask.input ?? {};
    const inputFileId = this.toOptionalString(input.inputFileId);
    const sourceFileId = this.toOptionalString(input.sourceFileId);
    const maskFileId = this.toOptionalString(input.maskFileId);
    const maskMode = this.toOptionalString(input.maskMode);
    const renderFileId = this.toOptionalString(input.renderFileId);
    const referenceFileId = this.toOptionalString(input.referenceFileId);
    const workflowTemplateKey = this.toOptionalString(input.workflowTemplateKey);
    const prompt = this.toOptionalString(input.prompt);
    const referenceFileIds = this.toOptionalStringArray(input.referenceFileIds);
    const stylePreset = this.toOptionalString(input.stylePreset);
    const imageSize = this.toOptionalString(input.imageSize);
    const aspectRatio = this.toOptionalString(input.aspectRatio);
    const quality = this.toOptionalString(input.quality);
    const providerRoute = this.toOptionalString(input.providerRoute);
    const providerModel = this.toOptionalString(input.providerModel);
    const resolvedSize = this.toOptionalString(input.resolvedSize);
    const inputFileLookupId = inputFileId ?? sourceFileId;
    const effectiveRunNo = inputTask.runNo ?? await this.resolveRunNo(inputTask.runId);
    const includeProviderEventPayload = options?.includeProviderEventPayload !== false;
    const hydrationMode = options?.hydrationMode ?? "full";
    const providerPayload = includeProviderEventPayload
      ? await this.resolveLatestProviderPayload(inputTask.taskId)
      : null;
    const providerTaskId = this.toOptionalString(providerPayload?.providerTaskId);
    const providerClientId = this.toOptionalString(providerPayload?.providerClientId);
    const fileLookupIds = hydrationMode === "reconcile"
      ? [inputTask.resultFileId]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
      : [
        inputFileId,
        sourceFileId,
        maskFileId,
        renderFileId,
        referenceFileId,
        inputTask.whiteModelFileId,
        inputTask.styleReferenceFileId,
        inputTask.resultFileId,
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0);
    const filesById = options?.filesById ?? await this.buildFilesById(fileLookupIds);
    const inputFile = hydrationMode === "reconcile"
      ? null
      : (inputFileLookupId ? filesById.get(inputFileLookupId) ?? null : null);
    const sourceFile = hydrationMode === "reconcile"
      ? null
      : (sourceFileId ? filesById.get(sourceFileId) ?? null : null);
    const maskFile = hydrationMode === "reconcile"
      ? null
      : (maskFileId ? filesById.get(maskFileId) ?? null : null);
    const renderFile = hydrationMode === "reconcile"
      ? null
      : (renderFileId ? filesById.get(renderFileId) ?? null : null);
    const referenceFile = hydrationMode === "reconcile"
      ? null
      : (referenceFileId ? filesById.get(referenceFileId) ?? null : null);
    const whiteModelFile = hydrationMode === "reconcile"
      ? null
      : (
        inputTask.whiteModelFileId
          ? filesById.get(inputTask.whiteModelFileId) ?? null
          : null
      );
    const styleReferenceFile = hydrationMode === "reconcile"
      ? null
      : (
        inputTask.styleReferenceFileId
          ? filesById.get(inputTask.styleReferenceFileId) ?? null
          : null
      );
    const resultFile = inputTask.resultFileId
      ? filesById.get(inputTask.resultFileId) ?? null
      : null;

    return {
      sequence: inputTask.sequence,
      taskId: inputTask.taskId,
      taskNo: inputTask.taskNo,
      runId: inputTask.runId,
      runNo: effectiveRunNo,
      workflowId: inputTask.workflowId,
      projectId: inputTask.projectId,
      nodeId: inputTask.nodeId,
      nodeTitle: inputTask.nodeTitle,
      nodeType: inputTask.nodeType,
      taskType: inputTask.taskType,
      groupId: inputTask.groupId,
      groupOrder: inputTask.groupOrder,
      provider: inputTask.provider,
      model: inputTask.model,
      status: inputTask.status,
      currentStep: inputTask.currentStep as ExecutionTaskQueryItem["currentStep"],
      currentAttemptNo: inputTask.currentAttemptNo,
      retryCount: inputTask.retryCount,
      maxRetries: inputTask.maxRetries,
      maxAttempts: inputTask.maxRetries + 1,
      lastErrorCode: inputTask.lastErrorCode,
      lastErrorMessage: inputTask.lastErrorMessage,
      resultFileId: inputTask.resultFileId,
      createdAt: inputTask.createdAt,
      startedAt: inputTask.startedAt,
      completedAt: inputTask.completedAt,
      durationMs: inputTask.durationMs ?? null,
      input: inputTask.input,
      inputFileId,
      sourceFileId,
      maskFileId,
      maskMode,
      renderFileId,
      referenceFileId,
      workflowTemplateKey,
      providerTaskId,
      providerClientId,
      prompt,
      referenceFileIds,
      stylePreset,
      imageSize,
      aspectRatio,
      quality,
      providerRoute,
      providerModel,
      resolvedSize,
      whiteModelFileId: inputTask.whiteModelFileId,
      styleReferenceFileId: inputTask.styleReferenceFileId,
      inputFile,
      sourceFile,
      maskFile,
      renderFile,
      referenceFile,
      whiteModelFile,
      styleReferenceFile,
      resultFile,
    };
  }

  private async resolveLatestProviderPayload(
    taskId: string,
  ): Promise<Record<string, unknown> | null> {
    const taskEvents = await this.executionsRepository.getTaskEvents(taskId);
    const latestProviderEvent = [...taskEvents]
      .reverse()
      .find((event) => event.payload && typeof event.payload === "object" && (
        typeof event.payload.providerTaskId === "string"
        || typeof event.payload.providerClientId === "string"
      ));

    return latestProviderEvent?.payload ?? null;
  }

  private async buildFilesById(fileIds: string[]): Promise<Map<string, FileAssetResponse>> {
    if (fileIds.length === 0) {
      return new Map();
    }

    const files = await this.filesRepository.findFilesByIds(fileIds);
    return new Map(files.map((file) => [file.fileId, file]));
  }

  private async buildFilesByIdForTasks(
    tasks: Array<Pick<
      ExecutionTaskRecord,
      "input" | "whiteModelFileId" | "styleReferenceFileId" | "resultFileId"
    >>,
    options?: {
      mode?: "full" | "reconcile";
    },
  ): Promise<Map<string, FileAssetResponse>> {
    const fileIdSet = new Set<string>();
    const mode = options?.mode ?? "full";

    tasks.forEach((task) => {
      if (mode === "reconcile") {
        if (typeof task.resultFileId === "string" && task.resultFileId.trim().length > 0) {
          fileIdSet.add(task.resultFileId);
        }
        return;
      }

      const input = task.input ?? {};
      const inputFileId = this.toOptionalString(input.inputFileId);
      const sourceFileId = this.toOptionalString(input.sourceFileId);
      const maskFileId = this.toOptionalString(input.maskFileId);
      const renderFileId = this.toOptionalString(input.renderFileId);
      const referenceFileId = this.toOptionalString(input.referenceFileId);

      [
        inputFileId,
        sourceFileId,
        maskFileId,
        renderFileId,
        referenceFileId,
        task.whiteModelFileId,
        task.styleReferenceFileId,
        task.resultFileId,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .forEach((fileId) => fileIdSet.add(fileId));
    });

    return this.buildFilesById(Array.from(fileIdSet));
  }

  private async resolveRunNo(runId: string): Promise<string | null> {
    const run = await this.executionsRepository.getExecutionRun(runId);
    return run?.runNo ?? null;
  }

  private parsePositiveInt(value: number | undefined, fallback: number): number {
    if (!value || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }

  private toOptionalString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toOptionalStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const normalized = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return normalized.length > 0 ? normalized : null;
  }

  private toDurationMs(
    startedAt: string | null,
    completedAt: string | null,
  ): number | null {
    if (!startedAt || !completedAt) {
      return null;
    }

    const startedAtMs = Date.parse(startedAt);
    const completedAtMs = Date.parse(completedAt);

    if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
      return null;
    }

    return Math.max(0, completedAtMs - startedAtMs);
  }

  private canAccessUserData(
    authenticated: AuthenticatedAccount,
    ownerUserId: string | null,
  ): boolean {
    if (authenticated.user.role === "admin") {
      return true;
    }

    return ownerUserId === authenticated.user.userId;
  }

  private canAccessWorkflow(
    authenticated: AuthenticatedAccount,
    ownerUserId: string,
  ): boolean {
    if (authenticated.user.role === "admin") {
      return true;
    }

    return ownerUserId === authenticated.user.userId;
  }
}
