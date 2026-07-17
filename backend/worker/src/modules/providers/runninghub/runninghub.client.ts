import fs from "node:fs/promises";
import path from "node:path";

import {
  createRunningHubBackpressureError,
  createRunningHubNetworkError,
  createRunningHubProviderError,
  createRunningHubTimeoutError,
  createRunningHubValidationError,
} from "./runninghub.errors.ts";
import {
  parseRunningHubCreateTaskResponse,
  parseRunningHubQueryTaskResultResponse,
  parseRunningHubTaskStatusResponse,
  parseRunningHubUploadResponse,
} from "./runninghub.parser.ts";
import type {
  RunningHubCreateTaskInput,
  RunningHubCreateTaskResult,
  RunningHubFileUploadInput,
  RunningHubQueryTaskInput,
  RunningHubQueryTaskResult,
  RunningHubTaskStatusResult,
  RunningHubUploadedFileResult,
} from "./runninghub.types.ts";

export interface RunningHubClientOptions {
  apiKey: string | null;
  apiBaseUrl: string;
  snapshotDir: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 180_000;

function tryDetectBackpressureResponse(responseText: string): {
  providerCode: string;
  responseBody: string;
} | null {
  if (!responseText) {
    return null;
  }

  if (responseText.includes("task_queue_maxed")) {
    return {
      providerCode: "task_queue_maxed",
      responseBody: responseText,
    };
  }

  try {
    const parsed = JSON.parse(responseText) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const root = parsed as Record<string, unknown>;
    const message = typeof root.msg === "string" ? root.msg.trim() : null;
    const providerCode =
      typeof root.providerCode === "string" ? root.providerCode.trim() : null;
    const errorCode =
      typeof root.errorCode === "string" ? root.errorCode.trim() : null;

    if (
      message === "task_queue_maxed"
      || providerCode === "task_queue_maxed"
      || errorCode === "task_queue_maxed"
    ) {
      return {
        providerCode: "task_queue_maxed",
        responseBody: responseText,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export class RunningHubClient {
  private readonly apiKey: string | null;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly snapshotDir: string;

  constructor(options: RunningHubClientOptions) {
    this.apiKey = options.apiKey;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.snapshotDir = options.snapshotDir;
  }

  isConfigured(): boolean {
    return Boolean(
      this.apiKey
      && this.apiKey.trim().length > 0
      && this.apiBaseUrl
      && this.apiBaseUrl.trim().length > 0,
    );
  }

  assertConfigured(): void {
    if (!this.apiKey) {
      throw createRunningHubValidationError("未配置 RunningHub API Key。", {
        configKey: "providers.runninghub.apiKey",
      });
    }

    if (!this.apiBaseUrl) {
      throw createRunningHubValidationError("未配置 RunningHub API Base URL。", {
        configKey: "providers.runninghub.apiBaseUrl",
      });
    }
  }

  async uploadFile(input: RunningHubFileUploadInput): Promise<RunningHubUploadedFileResult> {
    this.assertConfigured();

    if (!input.fileName.trim()) {
      throw createRunningHubValidationError("RunningHub 上传文件名不能为空。");
    }

    const formData = new FormData();
    const blob = new Blob([input.fileBuffer], {
      type: input.mimeType || "application/octet-stream",
    });
    formData.append("file", blob, input.fileName);
    formData.append("apiKey", this.apiKey as string);

    const { responseText, snapshotPath } = await this.requestText({
      url: `${this.apiBaseUrl}/task/openapi/upload`,
      method: "POST",
      body: formData,
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "runninghub-upload",
      snapshotRequestBody: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.fileBuffer.byteLength,
      },
    });

    return parseRunningHubUploadResponse({
      responseText,
      snapshotPath,
    });
  }

  async createWorkflowTask(
    input: RunningHubCreateTaskInput,
  ): Promise<RunningHubCreateTaskResult> {
    this.assertConfigured();

    if (!input.workflowId.trim()) {
      throw createRunningHubValidationError("RunningHub workflowId 不能为空。");
    }

    if (!Array.isArray(input.nodeInfoList) || input.nodeInfoList.length === 0) {
      throw createRunningHubValidationError("RunningHub nodeInfoList 至少需要一项。");
    }

    const payload = {
      apiKey: this.apiKey as string,
      workflowId: input.workflowId,
      nodeInfoList: input.nodeInfoList,
    };

    const { responseText, snapshotPath } = await this.requestText({
      url: `${this.apiBaseUrl}/task/openapi/create`,
      method: "POST",
      jsonBody: payload,
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "runninghub-create-task",
      snapshotRequestBody: payload,
    });

    return parseRunningHubCreateTaskResponse({
      responseText,
      snapshotPath,
    });
  }

  async queryTaskResultV2(
    input: RunningHubQueryTaskInput,
  ): Promise<RunningHubQueryTaskResult> {
    this.assertConfigured();

    if (!input.taskId.trim()) {
      throw createRunningHubValidationError("RunningHub taskId 不能为空。");
    }

    const payload = {
      taskId: input.taskId,
    };

    const { responseText, snapshotPath } = await this.requestText({
      url: `${this.apiBaseUrl}/openapi/v2/query`,
      method: "POST",
      jsonBody: payload,
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "runninghub-query-result-v2",
      snapshotRequestBody: payload,
    });

    return parseRunningHubQueryTaskResultResponse({
      responseText,
      snapshotPath,
    });
  }

  async queryTaskStatus(
    input: RunningHubQueryTaskInput,
  ): Promise<RunningHubTaskStatusResult> {
    this.assertConfigured();

    if (!input.taskId.trim()) {
      throw createRunningHubValidationError("RunningHub taskId 不能为空。");
    }

    const payload = {
      apiKey: this.apiKey as string,
      taskId: input.taskId,
    };

    const { responseText, snapshotPath } = await this.requestText({
      url: `${this.apiBaseUrl}/task/openapi/status`,
      method: "POST",
      jsonBody: payload,
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "runninghub-query-status",
      snapshotRequestBody: payload,
    });

    return parseRunningHubTaskStatusResponse({
      responseText,
      snapshotPath,
    });
  }

  private async requestText(input: {
    url: string;
    method: "POST";
    jsonBody?: Record<string, unknown>;
    body?: string | FormData;
    timeoutMs?: number;
    snapshotLabel: string;
    snapshotRequestBody: unknown;
  }): Promise<{ responseText: string; snapshotPath: string }> {
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let responseText = "";
    let snapshotPath = "";

    try {
      const headers: Record<string, string> = {};
      let body = input.body;

      if (input.jsonBody) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(input.jsonBody);
      }

      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await this.fetchImpl(input.url, {
        method: input.method,
        headers,
        body,
        signal: controller.signal,
      });

      responseText = await response.text();
      snapshotPath = await this.saveResponseSnapshot({
        label: input.snapshotLabel,
        url: input.url,
        method: input.method,
        requestBody: input.snapshotRequestBody,
        responseText,
        status: response.status,
      });

      if (!response.ok) {
        const backpressure = tryDetectBackpressureResponse(responseText);

        if (backpressure) {
          throw createRunningHubBackpressureError(
            "RunningHub 队列繁忙，等待后端重新调度。",
            backpressure.providerCode,
            {
              url: input.url,
              responseBody: backpressure.responseBody,
              snapshotPath,
              httpStatus: response.status,
            },
          );
        }

        throw createRunningHubProviderError(
          `RunningHub 调用失败，HTTP 状态码 ${response.status}。`,
          String(response.status),
          {
            url: input.url,
            responseBody: responseText,
            snapshotPath,
          },
        );
      }

      return {
        responseText,
        snapshotPath,
      };
    } catch (error) {
      if (this.isExecutionError(error)) {
        throw error;
      }

      if (this.isAbortError(error)) {
        throw createRunningHubTimeoutError(timeoutMs, {
          url: input.url,
          snapshotPath: snapshotPath || undefined,
        });
      }

      throw createRunningHubNetworkError("RunningHub 网络请求失败。", {
        url: input.url,
        cause: error instanceof Error ? error.message : "NETWORK_ERROR",
        responseBody: responseText || undefined,
        snapshotPath: snapshotPath || undefined,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async saveResponseSnapshot(input: {
    label: string;
    url: string;
    method: string;
    requestBody: unknown;
    responseText: string;
    status: number;
  }): Promise<string> {
    await fs.mkdir(this.snapshotDir, { recursive: true });

    const safeLabel = input.label.replace(/[^a-zA-Z0-9-_]/g, "-");
    const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${safeLabel}.json`;
    const absolutePath = path.join(this.snapshotDir, fileName);

    await fs.writeFile(
      absolutePath,
      JSON.stringify(
        {
          provider: "runninghub",
          url: input.url,
          method: input.method,
          status: input.status,
          requestBody: input.requestBody,
          responseText: input.responseText,
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    return absolutePath;
  }

  private isAbortError(error: unknown): boolean {
    return (
      (error instanceof Error && error.name === "AbortError")
      || ((error as { name?: string } | null | undefined)?.name === "AbortError")
    );
  }

  private isExecutionError(error: unknown): boolean {
    return Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && "message" in error
      && "retryable" in error,
    );
  }
}
