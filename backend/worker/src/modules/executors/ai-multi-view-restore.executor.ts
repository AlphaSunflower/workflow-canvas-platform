import {
  AI_MULTI_VIEW_RESTORE_NODE_TYPE,
  AI_MULTI_VIEW_RESTORE_PROVIDER,
  EXECUTION_PHASES,
  EXECUTION_STATUSES,
} from "@newworkflow/backend-shared";
import type { ExecutionsRepository } from "../../../../api/src/modules/executions/executions.repository.types.ts";
import type { FilesRepository } from "../../../../api/src/modules/files/files.repository.types.ts";
import { WorkerFileAssetService } from "../files/worker-file-asset.service.ts";
import type { ProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { NoopProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { withProviderCallLog } from "../provider-call-logs/provider-call-logger.ts";
import {
  createRunningHubInvalidResponseError,
  createRunningHubProviderError,
} from "../providers/runninghub/runninghub.errors.ts";
import { StorageService } from "../storage/storage.service.ts";
import type { StorageWriteResult } from "../storage/storage.types.ts";
import type {
  AIMultiViewRestoreExecutorInput,
  AIMultiViewRestoreExecutorResult,
} from "./ai-multi-view-restore.types.ts";
import type {
  QueueTaskExecutor,
  QueueTaskExecutorInput,
} from "./queue-task-executor.types.ts";

interface RunningHubClientLike {
  uploadFile(input: {
    fileName: string;
    mimeType: string;
    fileBuffer: Buffer;
    snapshotLabel?: string;
  }): Promise<{
    fileName: string;
    snapshotPath?: string;
  }>;
  createWorkflowTask(input: {
    workflowId: string;
    nodeInfoList: Array<{
      nodeId: string;
      fieldName: string;
      fieldValue: string;
    }>;
    snapshotLabel?: string;
  }): Promise<{
    taskId: string;
    taskStatus: string;
    clientId: string | null;
    promptTips: string | null;
    promptTipsSummary: unknown;
    snapshotPath?: string;
  }>;
  queryTaskResultV2(input: {
    taskId: string;
    snapshotLabel?: string;
  }): Promise<{
    taskId: string | null;
    taskStatus: string | null;
    clientId: string | null;
    promptTips: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    results: Array<{
      fileUrl: string;
      fileType: string;
      nodeId: string | null;
      taskCostTime: number | null;
    }>;
    snapshotPath?: string;
  }>;
}

interface WorkflowTemplateServiceLike {
  buildNodeInfoList(input: {
    templateKey?: string;
    uploadedFileNames?: Record<string, string>;
    snapshotLabel?: string;
  }): Promise<{
    workflowId: string;
    nodeInfoList: Array<{
      nodeId: string;
      fieldName: string;
      fieldValue: string;
    }>;
    snapshotPath: string;
  }>;
}

interface AIMultiViewRestoreTaskExecutorOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

interface RunningHubResultFile {
  fileUrl: string;
  fileType: string;
  nodeId: string | null;
  taskCostTime: number | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeProviderTaskStatus(value: string | null): string | null {
  return isNonEmptyString(value) ? value.trim().toUpperCase() : null;
}

function normalizeTaskInput(
  task: QueueTaskExecutorInput["task"],
): AIMultiViewRestoreExecutorInput {
  const taskInput = task.input ?? {};
  const renderFileId = taskInput.renderFileId;
  const referenceFileId = taskInput.referenceFileId;
  const workflowId = taskInput.workflowId;
  const workflowTemplateKey = taskInput.workflowTemplateKey;
  const outputNodeId = taskInput.outputNodeId;

  if (
    !isNonEmptyString(renderFileId)
    || !isNonEmptyString(referenceFileId)
    || !isNonEmptyString(workflowId)
    || !isNonEmptyString(workflowTemplateKey)
    || !isNonEmptyString(outputNodeId)
    || !isNonEmptyString(task.userId)
  ) {
    throw new Error("INVALID_AI_MULTI_VIEW_RESTORE_TASK_INPUT");
  }

  return {
    userId: task.userId.trim(),
    runId: task.runId,
    taskId: task.id,
    taskNo: task.taskNo,
    renderFileId: renderFileId.trim(),
    referenceFileId: referenceFileId.trim(),
    workflowId: workflowId.trim(),
    workflowTemplateKey: workflowTemplateKey.trim(),
    outputNodeId: outputNodeId.trim(),
  };
}

export class AIMultiViewRestoreTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = AI_MULTI_VIEW_RESTORE_NODE_TYPE;
  private readonly executionsRepository: ExecutionsRepository;
  private readonly filesRepository: FilesRepository;
  private readonly fileAssetService: WorkerFileAssetService;
  private readonly providerClient: RunningHubClientLike;
  private readonly providerCallLogRepository: ProviderCallLogRepository;
  private readonly workflowTemplateService: WorkflowTemplateServiceLike;
  private readonly storageService: StorageService;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(
    executionsRepository: ExecutionsRepository,
    filesRepository: FilesRepository,
    providerClient: RunningHubClientLike,
    workflowTemplateService: WorkflowTemplateServiceLike,
    storageService: StorageService,
    fetchImpl: typeof fetch = fetch,
    options?: AIMultiViewRestoreTaskExecutorOptions,
    providerCallLogRepository: ProviderCallLogRepository = new NoopProviderCallLogRepository(),
  ) {
    this.executionsRepository = executionsRepository;
    this.filesRepository = filesRepository;
    this.fileAssetService = new WorkerFileAssetService(filesRepository);
    this.providerClient = providerClient;
    this.providerCallLogRepository = providerCallLogRepository;
    this.workflowTemplateService = workflowTemplateService;
    this.storageService = storageService;
    this.fetchImpl = fetchImpl;
    this.pollIntervalMs = Math.max(250, options?.pollIntervalMs ?? 3_000);
    this.maxPollAttempts = Math.max(1, options?.maxPollAttempts ?? 120);
    this.sleepImpl = options?.sleepImpl ?? (async (ms: number) => {
      await new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    });
  }

  async execute(input: QueueTaskExecutorInput): Promise<AIMultiViewRestoreExecutorResult> {
    return this.executeTask(normalizeTaskInput(input.task));
  }

  async executeTask(
    input: AIMultiViewRestoreExecutorInput,
  ): Promise<AIMultiViewRestoreExecutorResult> {
    const renderFile = await this.readFileOrThrow(input.renderFileId, "RENDER_FILE_NOT_FOUND");
    const referenceFile = await this.readFileOrThrow(
      input.referenceFileId,
      "REFERENCE_FILE_NOT_FOUND",
    );

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_final_started",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 5,
      message: "多视角修复执行开始。",
      payload: {
        renderFileId: input.renderFileId,
        referenceFileId: input.referenceFileId,
        workflowId: input.workflowId,
        workflowTemplateKey: input.workflowTemplateKey,
        outputNodeId: input.outputNodeId,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 10,
      message: "开始上传渲染图到 RunningHub。",
      payload: {
        renderFileId: input.renderFileId,
      },
    });

    const renderUploadResult = await this.uploadFileWithLog({
      input,
      inputKey: "render",
      fileName: `${input.taskNo}-render${this.resolveExtension(renderFile.mimeType)}`,
      mimeType: renderFile.mimeType,
      fileBuffer: renderFile.buffer,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 20,
      message: "渲染图已上传到 RunningHub。",
      payload: {
        renderUploadedFileName: renderUploadResult.fileName,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 25,
      message: "开始上传原视角参考图到 RunningHub。",
      payload: {
        referenceFileId: input.referenceFileId,
      },
    });

    const referenceUploadResult = await this.uploadFileWithLog({
      input,
      inputKey: "reference",
      fileName: `${input.taskNo}-reference${this.resolveExtension(referenceFile.mimeType)}`,
      mimeType: referenceFile.mimeType,
      fileBuffer: referenceFile.buffer,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 35,
      message: "原视角参考图已上传到 RunningHub。",
      payload: {
        referenceUploadedFileName: referenceUploadResult.fileName,
      },
    });

    const nodeInfoListResult = await this.workflowTemplateService.buildNodeInfoList({
      templateKey: input.workflowTemplateKey,
      uploadedFileNames: {
        render: renderUploadResult.fileName,
        reference: referenceUploadResult.fileName,
      },
      snapshotLabel: `${input.taskNo}-node-info-list`,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 45,
      message: "双输入 nodeInfoList 已生成。",
      payload: {
        nodeInfoList: nodeInfoListResult.nodeInfoList,
        snapshotPath: nodeInfoListResult.snapshotPath,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 50,
      message: "开始创建 RunningHub 多视角修复任务。",
      payload: {
        workflowId: input.workflowId,
        workflowTemplateKey: input.workflowTemplateKey,
      },
    });

    const createTaskResult = await this.createWorkflowTaskWithLog({
      input,
      nodeInfoList: nodeInfoListResult.nodeInfoList,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 55,
      message: "RunningHub 多视角修复任务已创建。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        taskStatus: createTaskResult.taskStatus,
        promptTips: createTaskResult.promptTips,
        promptTipsSummary: createTaskResult.promptTipsSummary,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 60,
      message: "开始轮询 RunningHub 多视角修复结果。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
      },
    });

    const queryTaskResult = await this.pollUntilResultReady({
      internalTaskId: input.taskId,
      taskNo: input.taskNo,
      providerTaskId: createTaskResult.taskId,
      providerClientId: createTaskResult.clientId,
    });

    const selectedResult = this.selectResultFile(
      queryTaskResult.results,
      input.outputNodeId,
      {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        taskStatus: queryTaskResult.taskStatus,
      },
    );

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_artifact_received",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 75,
      message: "已从 RunningHub 收到结果图地址。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        resultFileUrl: selectedResult.fileUrl,
        resultFileType: selectedResult.fileType,
        resultNodeId: selectedResult.nodeId,
        selectedBy: selectedResult.selectedBy,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 85,
      message: "开始下载并保存多视角修复结果图。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        resultFileUrl: selectedResult.fileUrl,
        resultNodeId: selectedResult.nodeId,
      },
    });

    const downloadResult = await this.downloadResultFile(selectedResult.fileUrl);
    const outputExtension = this.resolveImageExtension(
      selectedResult.fileType,
      downloadResult.mimeType,
    );
    const outputFileName = `${input.taskNo}-multi-view-restore${outputExtension}`;
    const savedResult = await this.storageService.saveBuffer({
      sourceType: "output",
      fileType: "image",
      originalName: outputFileName,
      mimeType: downloadResult.mimeType,
      buffer: downloadResult.buffer,
    });

    const resultFileId = await this.registerStoredAsset({
      userId: input.userId,
      stored: savedResult,
      buffer: downloadResult.buffer,
    });

    await this.executionsRepository.updateTaskResultFile(input.taskId, resultFileId);
    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_final_completed",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 95,
      message: "多视角修复结果图已下载并落库。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        taskStatus: queryTaskResult.taskStatus,
        resultFileId,
        resultFileUrl: selectedResult.fileUrl,
        resultNodeId: selectedResult.nodeId,
        storageKey: savedResult.storageKey,
      },
    });

    return {
      providerTaskId: createTaskResult.taskId,
      providerClientId: createTaskResult.clientId,
      renderUploadedFileName: renderUploadResult.fileName,
      referenceUploadedFileName: referenceUploadResult.fileName,
      resultFileId,
      resultStorageKey: savedResult.storageKey,
      resultFileUrl: selectedResult.fileUrl,
      resultNodeId: selectedResult.nodeId,
    };
  }

  private async pollUntilResultReady(input: {
    internalTaskId: string;
    taskNo: string;
    providerTaskId: string;
    providerClientId: string | null;
  }): Promise<{
    taskId: string | null;
    taskStatus: string | null;
    clientId: string | null;
    promptTips: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    results: RunningHubResultFile[];
  }> {
    for (let pollAttempt = 1; pollAttempt <= this.maxPollAttempts; pollAttempt += 1) {
      const queryTaskResult = await this.queryTaskResultWithLog({
        internalTaskId: input.internalTaskId,
        taskNo: input.taskNo,
        providerTaskId: input.providerTaskId,
        pollAttempt,
      });

      const normalizedStatus = normalizeProviderTaskStatus(queryTaskResult.taskStatus);

      if (queryTaskResult.results.length > 0) {
        return queryTaskResult;
      }

      if (this.isProviderFailureStatus(normalizedStatus)) {
        throw createRunningHubProviderError(
          "RunningHub 多视角修复任务执行失败。",
          queryTaskResult.errorCode ?? "RUNNINGHUB_TASK_FAILED",
          {
            providerTaskId: input.providerTaskId,
            providerClientId: queryTaskResult.clientId ?? input.providerClientId,
            taskStatus: queryTaskResult.taskStatus,
            errorCode: queryTaskResult.errorCode,
            errorMessage: queryTaskResult.errorMessage,
            promptTips: queryTaskResult.promptTips,
            snapshotPath: queryTaskResult.snapshotPath,
          },
        );
      }

      if (pollAttempt >= this.maxPollAttempts) {
        break;
      }

      await this.executionsRepository.appendTaskEvent({
        taskId: input.internalTaskId,
        eventType: "task_progress",
        status: EXECUTION_STATUSES[1],
        phase: EXECUTION_PHASES[1],
        stepType: "final",
        progress: normalizedStatus === "SUCCESS" ? 75 : 65,
        message: normalizedStatus === "SUCCESS"
          ? "RunningHub 已返回成功状态，等待结果文件。"
          : `RunningHub 任务处理中（第 ${pollAttempt} 次查询，当前状态：${normalizedStatus ?? "UNKNOWN"}）。`,
        payload: {
          providerTaskId: input.providerTaskId,
          providerClientId: queryTaskResult.clientId ?? input.providerClientId,
          taskStatus: queryTaskResult.taskStatus,
          pollAttempt,
          resultCount: queryTaskResult.results.length,
          errorCode: queryTaskResult.errorCode,
          errorMessage: queryTaskResult.errorMessage,
          snapshotPath: queryTaskResult.snapshotPath,
        },
      });

      await this.sleepImpl(this.pollIntervalMs);
    }

    throw createRunningHubProviderError(
      "RunningHub 多视角修复结果轮询超时，未在限定次数内拿到结果文件。",
      "RUNNINGHUB_RESULT_POLL_TIMEOUT",
      {
        providerTaskId: input.providerTaskId,
        maxPollAttempts: this.maxPollAttempts,
        pollIntervalMs: this.pollIntervalMs,
      },
    );
  }

  private selectResultFile(
    results: RunningHubResultFile[],
    outputNodeId: string,
    context: {
      providerTaskId: string;
      providerClientId: string | null;
      taskStatus: string | null;
    },
  ): RunningHubResultFile & { selectedBy: "output-node" | "first-result" } {
    const outputNodeResult = results.find((item) => item.nodeId === outputNodeId);

    if (outputNodeResult) {
      this.assertImageResult(outputNodeResult, context);
      return {
        ...outputNodeResult,
        selectedBy: "output-node",
      };
    }

    if (results.length === 1) {
      this.assertImageResult(results[0]!, context);
      return {
        ...results[0]!,
        selectedBy: "first-result",
      };
    }

    throw createRunningHubInvalidResponseError(
      `RunningHub 返回了多个结果，但未命中目标输出节点 ${outputNodeId}。`,
      {
        providerTaskId: context.providerTaskId,
        providerClientId: context.providerClientId,
        taskStatus: context.taskStatus,
        outputNodeId,
        results,
      },
    );
  }

  private assertImageResult(
    result: RunningHubResultFile,
    context: {
      providerTaskId: string;
      providerClientId: string | null;
      taskStatus: string | null;
    },
  ): void {
    if (!isNonEmptyString(result.fileUrl)) {
      throw new Error("RUNNINGHUB_RESULT_FILE_URL_MISSING");
    }

    const normalizedFileType = result.fileType.trim().toLowerCase();
    if (!this.isSupportedImageFileType(normalizedFileType)) {
      throw createRunningHubInvalidResponseError("RunningHub 返回结果文件类型不是图片。", {
        providerTaskId: context.providerTaskId,
        providerClientId: context.providerClientId,
        taskStatus: context.taskStatus,
        result,
      });
    }
  }

  private isSupportedImageFileType(fileType: string): boolean {
    return ["image", "png", "jpg", "jpeg", "webp"].includes(fileType);
  }

  private isProviderFailureStatus(status: string | null): boolean {
    return (
      status === "FAILED"
      || status === "FAILURE"
      || status === "CANCELLED"
      || status === "CANCELED"
    );
  }

  private async uploadFileWithLog(input: {
    input: AIMultiViewRestoreExecutorInput;
    inputKey: "render" | "reference";
    fileName: string;
    mimeType: string;
    fileBuffer: Buffer;
  }): ReturnType<RunningHubClientLike["uploadFile"]> {
    const snapshotLabel = `${input.input.taskNo}-upload-${input.inputKey}`;
    return withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.input.taskId,
      stepType: "runninghub_upload",
      provider: AI_MULTI_VIEW_RESTORE_PROVIDER,
      model: input.input.workflowId,
      requestSummary: {
        workflowTemplateKey: input.input.workflowTemplateKey,
        inputKey: input.inputKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.fileBuffer.byteLength,
        snapshotLabel,
      },
      call: async () => this.providerClient.uploadFile({
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileBuffer: input.fileBuffer,
        snapshotLabel,
      }),
      summarizeSuccess: (result) => ({
        responseSummary: {
          fileName: result.fileName,
          snapshotPath: result.snapshotPath ?? null,
        },
        httpStatus: null,
      }),
    });
  }

  private async createWorkflowTaskWithLog(input: {
    input: AIMultiViewRestoreExecutorInput;
    nodeInfoList: Array<{
      nodeId: string;
      fieldName: string;
      fieldValue: string;
    }>;
  }): ReturnType<RunningHubClientLike["createWorkflowTask"]> {
    const snapshotLabel = `${input.input.taskNo}-create-task`;
    return withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.input.taskId,
      stepType: "runninghub_create",
      provider: AI_MULTI_VIEW_RESTORE_PROVIDER,
      model: input.input.workflowId,
      requestSummary: {
        workflowTemplateKey: input.input.workflowTemplateKey,
        workflowId: input.input.workflowId,
        nodeInfoCount: input.nodeInfoList.length,
        snapshotLabel,
      },
      call: async () => this.providerClient.createWorkflowTask({
        workflowId: input.input.workflowId,
        nodeInfoList: input.nodeInfoList,
        snapshotLabel,
      }),
      summarizeSuccess: (result) => ({
        responseSummary: {
          providerTaskId: result.taskId,
          clientId: result.clientId,
          taskStatus: result.taskStatus,
          promptTipsSummary: result.promptTipsSummary,
          snapshotPath: result.snapshotPath ?? null,
        },
        httpStatus: null,
      }),
    });
  }

  private async queryTaskResultWithLog(input: {
    internalTaskId: string;
    taskNo: string;
    providerTaskId: string;
    pollAttempt: number;
  }): ReturnType<RunningHubClientLike["queryTaskResultV2"]> {
    const snapshotLabel = `${input.taskNo}-query-result-v2-${String(input.pollAttempt).padStart(3, "0")}`;
    return withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.internalTaskId,
      stepType: "runninghub_query",
      provider: AI_MULTI_VIEW_RESTORE_PROVIDER,
      model: "runninghub-query-v2",
      requestSummary: {
        providerTaskId: input.providerTaskId,
        pollAttempt: input.pollAttempt,
        snapshotLabel,
      },
      call: async () => this.providerClient.queryTaskResultV2({
        taskId: input.providerTaskId,
        snapshotLabel,
      }),
      summarizeSuccess: (result) => {
        const normalizedStatus = normalizeProviderTaskStatus(result.taskStatus);
        const failed = this.isProviderFailureStatus(normalizedStatus);
        return {
          responseSummary: {
            providerTaskId: result.taskId,
            clientId: result.clientId,
            taskStatus: result.taskStatus,
            resultCount: result.results.length,
            snapshotPath: result.snapshotPath ?? null,
          },
          httpStatus: null,
          success: !failed,
          errorCode: failed ? result.errorCode ?? "RUNNINGHUB_TASK_FAILED" : null,
          errorMessage: failed ? result.errorMessage ?? "RunningHub task failed." : null,
        };
      },
    });
  }

  private async readFileOrThrow(
    fileId: string,
    errorCode: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const content = await this.filesRepository.readFileContent(fileId);

    if (!content) {
      throw new Error(errorCode);
    }

    return content;
  }

  private async downloadResultFile(
    fileUrl: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const response = await this.fetchImpl(fileUrl);

    if (!response.ok) {
      throw new Error("RUNNINGHUB_RESULT_DOWNLOAD_FAILED");
    }

    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get("Content-Type")?.trim() || "application/octet-stream";

    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  }

  private async registerStoredAsset(input: {
    userId: string;
    stored: StorageWriteResult;
    buffer: Buffer;
  }): Promise<string> {
    return this.fileAssetService.registerStoredAsset({
      userId: input.userId,
      stored: input.stored,
      content: input.buffer,
      fileType: "image",
      sourceType: "output",
    });
  }

  private resolveExtension(mimeType: string): string {
    if (mimeType === "image/jpeg") {
      return ".jpg";
    }

    if (mimeType === "image/webp") {
      return ".webp";
    }

    return ".png";
  }

  private resolveImageExtension(fileType: string, mimeType: string): string {
    const normalizedFileType = fileType.trim().toLowerCase();

    if (normalizedFileType === "jpg" || normalizedFileType === "jpeg") {
      return ".jpg";
    }

    if (normalizedFileType === "webp") {
      return ".webp";
    }

    if (normalizedFileType === "png") {
      return ".png";
    }

    return this.resolveExtension(mimeType);
  }
}
