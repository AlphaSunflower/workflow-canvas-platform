import {
  AI_IMAGE_TO_PLY_NODE_TYPE,
  AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE,
  AI_IMAGE_TO_PLY_PROVIDER,
  EXECUTION_PHASES,
  EXECUTION_STATUSES,
} from "@newworkflow/backend-shared";
import type { ExecutionsRepository } from "../../../../api/src/modules/executions/executions.repository.types.ts";
import type { FilesRepository } from "../../../../api/src/modules/files/files.repository.types.ts";
import { WorkerFileAssetService } from "../files/worker-file-asset.service.ts";
import type { ProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { NoopProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { withProviderCallLog } from "../provider-call-logs/provider-call-logger.ts";
import { createRunningHubProviderError } from "../providers/runninghub/runninghub.errors.ts";
import { StorageService } from "../storage/storage.service.ts";
import type { StorageWriteResult } from "../storage/storage.types.ts";
import type {
  AIImageToPlyExecutorInput,
  AIImageToPlyExecutorResult,
} from "./ai-image-to-ply.types.ts";
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
    uploadedFileName: string;
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

interface AIImageToPlyTaskExecutorOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeProviderTaskStatus(value: string | null): string | null {
  return isNonEmptyString(value) ? value.trim().toUpperCase() : null;
}

function normalizeTaskInput(task: QueueTaskExecutorInput["task"]): AIImageToPlyExecutorInput {
  const taskInput = task.input ?? {};
  const sourceFileId = taskInput.sourceFileId ?? taskInput.inputFileId;
  const workflowId = taskInput.workflowId;
  const workflowTemplateKey = taskInput.workflowTemplateKey;

  if (!isNonEmptyString(sourceFileId)) {
    throw new Error("INVALID_AI_IMAGE_TO_PLY_TASK_INPUT");
  }

  if (!isNonEmptyString(workflowId)) {
    throw new Error("INVALID_AI_IMAGE_TO_PLY_TASK_INPUT");
  }

  if (!isNonEmptyString(workflowTemplateKey)) {
    throw new Error("INVALID_AI_IMAGE_TO_PLY_TASK_INPUT");
  }

  if (!isNonEmptyString(task.userId)) {
    throw new Error("INVALID_AI_IMAGE_TO_PLY_TASK_INPUT");
  }

  return {
    userId: task.userId.trim(),
    runId: task.runId,
    taskId: task.id,
    taskNo: task.taskNo,
    sourceFileId: sourceFileId.trim(),
    workflowId: workflowId.trim(),
    workflowTemplateKey: workflowTemplateKey.trim(),
  };
}

export class AIImageToPlyTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = AI_IMAGE_TO_PLY_NODE_TYPE;
  private readonly fileAssetService: WorkerFileAssetService;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly providerCallLogRepository: ProviderCallLogRepository;

  constructor(
    private readonly executionsRepository: ExecutionsRepository,
    private readonly filesRepository: FilesRepository,
    private readonly providerClient: RunningHubClientLike,
    private readonly workflowTemplateService: WorkflowTemplateServiceLike,
    private readonly storageService: StorageService,
    private readonly fetchImpl: typeof fetch = fetch,
    options?: AIImageToPlyTaskExecutorOptions,
    providerCallLogRepository: ProviderCallLogRepository = new NoopProviderCallLogRepository(),
  ) {
    this.fileAssetService = new WorkerFileAssetService(filesRepository);
    this.pollIntervalMs = Math.max(250, options?.pollIntervalMs ?? 3_000);
    this.maxPollAttempts = Math.max(1, options?.maxPollAttempts ?? 120);
    this.sleepImpl = options?.sleepImpl ?? (async (ms: number) => {
      await new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    });
    this.providerCallLogRepository = providerCallLogRepository;
  }

  async execute(input: QueueTaskExecutorInput): Promise<AIImageToPlyExecutorResult> {
    return this.executeTask(normalizeTaskInput(input.task));
  }

  async executeTask(input: AIImageToPlyExecutorInput): Promise<AIImageToPlyExecutorResult> {
    const sourceFile = await this.readFileOrThrow(input.sourceFileId, "SOURCE_FILE_NOT_FOUND");

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_final_started",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 10,
      message: "图片转模型执行开始。",
      payload: {
        sourceFileId: input.sourceFileId,
        workflowId: input.workflowId,
        workflowTemplateKey: input.workflowTemplateKey,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 15,
      message: "开始上传输入图片到 RunningHub。",
      payload: {
        sourceFileId: input.sourceFileId,
        workflowId: input.workflowId,
      },
    });

    const uploadResult = await this.uploadFileWithLog({
      input,
      fileName: `${input.taskNo}${this.resolveExtension(sourceFile.mimeType)}`,
      mimeType: sourceFile.mimeType,
      fileBuffer: sourceFile.buffer,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 25,
      message: "输入图片已上传到 RunningHub。",
      payload: {
        uploadedFileName: uploadResult.fileName,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 40,
      message: "开始创建 RunningHub 工作流任务。",
      payload: {
        workflowId: input.workflowId,
        workflowTemplateKey: input.workflowTemplateKey,
      },
    });

    const nodeInfoListResult = await this.workflowTemplateService.buildNodeInfoList({
      templateKey: input.workflowTemplateKey,
      uploadedFileName: uploadResult.fileName,
      snapshotLabel: `${input.taskNo}-node-info-list`,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 35,
      message: "工作流输入映射已生成。",
      payload: {
        nodeInfoList: nodeInfoListResult.nodeInfoList,
        snapshotPath: nodeInfoListResult.snapshotPath,
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
      progress: 50,
      message: "RunningHub 工作流任务已创建。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        taskStatus: createTaskResult.taskStatus,
        promptTips: createTaskResult.promptTips,
        promptTipsSummary: createTaskResult.promptTipsSummary,
      },
    });

    const queryTaskResult = await this.pollUntilResultReady({
      internalTaskId: input.taskId,
      taskNo: input.taskNo,
      providerTaskId: createTaskResult.taskId,
      providerClientId: createTaskResult.clientId,
    });

    const firstResult = queryTaskResult.results[0];

    if (!firstResult || !isNonEmptyString(firstResult.fileUrl)) {
      throw new Error("RUNNINGHUB_RESULT_FILE_URL_MISSING");
    }

    if (firstResult.fileType.trim().toLowerCase() !== AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE) {
      throw new Error("RUNNINGHUB_RESULT_FILE_TYPE_INVALID");
    }

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_artifact_received",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 70,
      message: "已从 RunningHub 收到模型结果地址。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        resultFileUrl: firstResult.fileUrl,
        resultFileType: firstResult.fileType,
        nodeId: firstResult.nodeId,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 80,
      message: "开始下载并保存模型文件。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        workflowId: input.workflowId,
        resultFileUrl: firstResult.fileUrl,
        resultFileType: firstResult.fileType,
      },
    });

    const downloadResult = await this.downloadResultFile(firstResult.fileUrl);
    const outputFileName = `${input.taskNo}.ply`;
    const savedResult = await this.storageService.saveBuffer({
      sourceType: "output",
      fileType: "ply",
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
      message: "图片转模型结果已下载并落库。",
      payload: {
        providerTaskId: createTaskResult.taskId,
        providerClientId: createTaskResult.clientId,
        taskStatus: queryTaskResult.taskStatus,
        resultFileId,
        resultFileUrl: firstResult.fileUrl,
        storageKey: savedResult.storageKey,
      },
    });

    return {
      providerTaskId: createTaskResult.taskId,
      providerClientId: createTaskResult.clientId,
      uploadedFileName: uploadResult.fileName,
      resultFileId,
      resultStorageKey: savedResult.storageKey,
      resultFileUrl: firstResult.fileUrl,
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
    results: Array<{
      fileUrl: string;
      fileType: string;
      nodeId: string | null;
      taskCostTime: number | null;
    }>;
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
          "RunningHub 任务执行失败。",
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
        progress: normalizedStatus === "SUCCESS" ? 80 : 65,
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
      "RunningHub 结果轮询超时，未在限定次数内拿到结果文件。",
      "RUNNINGHUB_RESULT_POLL_TIMEOUT",
      {
        providerTaskId: input.providerTaskId,
        maxPollAttempts: this.maxPollAttempts,
        pollIntervalMs: this.pollIntervalMs,
      },
    );
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
    input: AIImageToPlyExecutorInput;
    fileName: string;
    mimeType: string;
    fileBuffer: Buffer;
  }): ReturnType<RunningHubClientLike["uploadFile"]> {
    const snapshotLabel = `${input.input.taskNo}-upload`;
    return withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.input.taskId,
      stepType: "runninghub_upload",
      provider: AI_IMAGE_TO_PLY_PROVIDER,
      model: input.input.workflowId,
      requestSummary: {
        workflowTemplateKey: input.input.workflowTemplateKey,
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
    input: AIImageToPlyExecutorInput;
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
      provider: AI_IMAGE_TO_PLY_PROVIDER,
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
      provider: AI_IMAGE_TO_PLY_PROVIDER,
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
      fileType: "ply",
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
}
