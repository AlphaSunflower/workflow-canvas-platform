import fs from "node:fs/promises";
import path from "node:path";

import {
  AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_DEFAULT_RESOLUTION,
  AI_VIDEO_GEN_DEFAULT_SIZE,
  AI_VIDEO_GEN_DEFAULT_TIMEOUT_MS,
  AI_VIDEO_GEN_MAX_REFERENCE_COUNT,
  AI_VIDEO_GEN_PROVIDER,
  ERROR_CATEGORIES,
  ERROR_CODES,
  RETRYABLE_ERROR_CODES,
} from "@newworkflow/backend-shared";
import type { ExecutionError } from "@newworkflow/backend-shared";
import {
  parseLaozhangVeoContentResponse,
  parseLaozhangVeoCreateResponse,
  parseLaozhangVeoStatusResponse,
} from "./laozhang-veo.parser.ts";
import type {
  LaozhangVeoContentResult,
  LaozhangVeoCreateVideoInput,
  LaozhangVeoCreateVideoResult,
  LaozhangVeoDownloadVideoInput,
  LaozhangVeoDownloadedVideoResult,
  LaozhangVeoQueryVideoInput,
  LaozhangVeoTaskStatusResult,
} from "./laozhang-veo.types.ts";

export interface LaozhangVeoClientOptions {
  apiKey: string | null;
  apiBaseUrl: string;
  snapshotDir: string;
  fetchImpl?: typeof fetch;
}

function isRetryableCode(code: ExecutionError["code"]): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
}

function createValidationError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.validationError,
    message,
    category: ERROR_CATEGORIES.common,
    retryable: false,
    provider: AI_VIDEO_GEN_PROVIDER,
    details,
  };
}

function createTimeoutError(
  timeoutMs: number,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.timeout,
    message: `Laozhang Veo request timed out after ${timeoutMs}ms.`,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.timeout),
    provider: AI_VIDEO_GEN_PROVIDER,
    details,
  };
}

function createNetworkError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.networkError,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.networkError),
    provider: AI_VIDEO_GEN_PROVIDER,
    details,
  };
}

function createProviderError(
  message: string,
  providerCode?: string,
  details?: Record<string, unknown>,
  retryable = true,
): ExecutionError {
  return {
    code: ERROR_CODES.providerError,
    message,
    category: retryable ? ERROR_CATEGORIES.providerRetryable : ERROR_CATEGORIES.provider,
    retryable,
    provider: AI_VIDEO_GEN_PROVIDER,
    providerCode,
    details,
  };
}

function createBackpressureError(
  message: string,
  providerCode: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    ...createProviderError(message, providerCode, details, true),
    details: {
      ...details,
      backpressure: true,
    },
  };
}

function createHttpError(input: {
  status: number;
  url: string;
  responseBody?: string;
  snapshotPath?: string;
}): ExecutionError {
  const details = {
    url: input.url,
    responseBody: input.responseBody,
    snapshotPath: input.snapshotPath,
    httpStatus: input.status,
  };

  if (input.status === 429) {
    return createBackpressureError(
      "Laozhang Veo rate limit or queue pressure.",
      String(input.status),
      details,
    );
  }

  if (input.status >= 500) {
    return createProviderError(
      `Laozhang Veo HTTP ${input.status}.`,
      String(input.status),
      details,
      true,
    );
  }

  if (input.status === 400) {
    return createValidationError("Laozhang Veo rejected request parameters.", details);
  }

  if (input.status === 401 || input.status === 402 || input.status === 403) {
    return {
      code: ERROR_CODES.forbidden,
      message: `Laozhang Veo authorization or billing failure: HTTP ${input.status}.`,
      category: ERROR_CATEGORIES.provider,
      retryable: false,
      provider: AI_VIDEO_GEN_PROVIDER,
      providerCode: String(input.status),
      details,
    };
  }

  return createProviderError(
    `Laozhang Veo HTTP ${input.status}.`,
    String(input.status),
    details,
    false,
  );
}

function isExecutionError(error: unknown): error is ExecutionError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "message" in error
    && "retryable" in error,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError")
    || ((error as { name?: string } | null | undefined)?.name === "AbortError")
  );
}

export class LaozhangVeoClient {
  private readonly apiKey: string | null;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly snapshotDir: string;

  constructor(options: LaozhangVeoClientOptions) {
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
      throw createValidationError("LAOZHANG_API_KEY is not configured.", {
        configKey: "providers.laozhang.apiKey",
      });
    }

    if (!this.apiBaseUrl) {
      throw createValidationError("Laozhang Veo API base URL is not configured.", {
        configKey: "providers.laozhang.veo.apiBaseUrl",
      });
    }
  }

  async createVideoTask(
    input: LaozhangVeoCreateVideoInput,
  ): Promise<LaozhangVeoCreateVideoResult> {
    this.assertConfigured();

    const prompt = input.prompt.trim();
    if (!prompt) {
      throw createValidationError("Laozhang Veo prompt cannot be empty.");
    }

    const inputReferences = input.inputReferences ?? [];
    if (inputReferences.length > AI_VIDEO_GEN_MAX_REFERENCE_COUNT) {
      throw createValidationError("Laozhang Veo supports at most 2 input_reference files.", {
        count: inputReferences.length,
      });
    }

    const duration = typeof input.duration === "number" && Number.isFinite(input.duration)
      ? Math.trunc(input.duration)
      : AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS;
    const aspectRatio = input.aspectRatio ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;
    const resolution = input.resolution ?? AI_VIDEO_GEN_DEFAULT_RESOLUTION;
    const size = input.size ?? AI_VIDEO_GEN_DEFAULT_SIZE;

    const requestBodySnapshot = {
      model: input.model,
      prompt,
      seconds: String(duration),
      duration: String(duration),
      size,
      resolution,
      aspectRatio,
      metadata: input.metadata,
      inputReferences: inputReferences.map((item) => ({
        fileName: item.fileName,
        mimeType: item.mimeType,
        size: item.buffer.byteLength,
      })),
      referenceType: inputReferences.length > 1 ? "asset" : undefined,
      submittedReferences: inputReferences.map((item) => ({
        fieldName: inputReferences.length > 1 ? "referenceImages" : "input_reference",
        fileName: item.fileName,
        mimeType: item.mimeType,
        size: item.buffer.byteLength,
      })),
    };

    const formData = new FormData();
    formData.append("model", input.model);
    formData.append("prompt", prompt);
    formData.append("seconds", String(duration));
    formData.append("duration", String(duration));
    formData.append("size", size);
    formData.append("resolution", resolution);
    formData.append("aspectRatio", aspectRatio);
    if (input.metadata) {
      formData.append("metadata", input.metadata);
    }

    if (inputReferences.length > 1) {
      formData.append("referenceType", "asset");
      inputReferences.forEach((reference) => {
        formData.append(
          "referenceImages",
          new Blob([reference.buffer], {
            type: reference.mimeType || "application/octet-stream",
          }),
          reference.fileName,
        );
      });
    } else {
      const firstReference = inputReferences[0];
      if (firstReference) {
        formData.append(
          "input_reference",
          new Blob([firstReference.buffer], {
            type: firstReference.mimeType || "application/octet-stream",
          }),
          firstReference.fileName,
        );
      }
    }

    const { responseText, snapshotPath } = await this.requestText({
      url: `${this.apiBaseUrl}/videos`,
      method: "POST",
      body: formData,
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "laozhang-veo-create-video",
      snapshotRequestBody: requestBodySnapshot,
    });

    return parseLaozhangVeoCreateResponse({
      responseText,
      snapshotPath,
    });
  }

  async getVideoTask(
    input: LaozhangVeoQueryVideoInput,
  ): Promise<LaozhangVeoTaskStatusResult> {
    this.assertConfigured();

    const videoId = input.videoId.trim();
    if (!videoId) {
      throw createValidationError("Laozhang Veo videoId cannot be empty.");
    }

    const { responseText, snapshotPath } = await this.requestText({
      url: `${this.apiBaseUrl}/videos/${encodeURIComponent(videoId)}`,
      method: "GET",
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "laozhang-veo-query-video",
      snapshotRequestBody: {
        videoId,
      },
    });

    return parseLaozhangVeoStatusResponse({
      responseText,
      snapshotPath,
    });
  }

  async getVideoContent(
    input: LaozhangVeoQueryVideoInput,
  ): Promise<LaozhangVeoContentResult> {
    this.assertConfigured();

    const videoId = input.videoId.trim();
    if (!videoId) {
      throw createValidationError("Laozhang Veo videoId cannot be empty.");
    }

    const contentUrl = `${this.apiBaseUrl}/videos/${encodeURIComponent(videoId)}/content`;
    const binaryResult = await this.tryGetVideoContentAsBinary({
      url: contentUrl,
      videoId,
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "laozhang-veo-video-content",
    });

    if (binaryResult) {
      return {
        id: videoId,
        object: "video",
        created: null,
        createdAt: null,
        completedAt: null,
        status: "completed",
        progress: 100,
        model: null,
        prompt: null,
        url: null,
        videoUrl: null,
        duration: null,
        resolution: null,
        rawResponse: null,
        responseText: "",
        snapshotPath: binaryResult.snapshotPath,
        video: binaryResult,
      };
    }

    const { responseText, snapshotPath } = await this.requestText({
      url: contentUrl,
      method: "GET",
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel ?? "laozhang-veo-video-content",
      snapshotRequestBody: {
        videoId,
      },
    });

    return parseLaozhangVeoContentResponse({
      responseText,
      snapshotPath,
    });
  }

  async downloadVideo(
    input: LaozhangVeoDownloadVideoInput,
  ): Promise<LaozhangVeoDownloadedVideoResult> {
    const url = input.url.trim();
    if (!url) {
      throw createValidationError("Laozhang Veo video download URL cannot be empty.");
    }

    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? AI_VIDEO_GEN_DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let snapshotPath = "";

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        snapshotPath = await this.saveResponseSnapshot({
          label: input.snapshotLabel ?? "laozhang-veo-download-video",
          url,
          method: "GET",
          requestBody: null,
          responseText,
          status: response.status,
        });

        throw createHttpError({
          status: response.status,
          url,
          responseBody: responseText,
          snapshotPath,
        });
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType =
        response.headers.get("Content-Type")?.split(";")[0]?.trim()
        || "video/mp4";
      snapshotPath = await this.saveBinaryResponseSnapshot({
        label: input.snapshotLabel ?? "laozhang-veo-download-video",
        url,
        method: "GET",
        status: response.status,
        mimeType,
        byteLength: buffer.byteLength,
      });

      return {
        buffer,
        mimeType,
        size: buffer.byteLength,
        snapshotPath,
      };
    } catch (error) {
      if (isExecutionError(error)) {
        throw error;
      }

      if (isAbortError(error)) {
        throw createTimeoutError(timeoutMs, {
          url,
          snapshotPath: snapshotPath || undefined,
        });
      }

      throw createNetworkError("Laozhang Veo video download failed.", {
        url,
        cause: error instanceof Error ? error.message : ERROR_CODES.networkError,
        snapshotPath: snapshotPath || undefined,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async requestText(input: {
    url: string;
    method: "GET" | "POST";
    jsonBody?: Record<string, unknown>;
    body?: FormData;
    timeoutMs?: number;
    snapshotLabel: string;
    snapshotRequestBody: unknown;
  }): Promise<{ responseText: string; snapshotPath: string }> {
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? AI_VIDEO_GEN_DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let responseText = "";
    let snapshotPath = "";

    try {
      const headers: Record<string, string> = {};
      let body: string | FormData | undefined = input.body;

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
        throw createHttpError({
          status: response.status,
          url: input.url,
          responseBody: responseText,
          snapshotPath,
        });
      }

      return {
        responseText,
        snapshotPath,
      };
    } catch (error) {
      if (isExecutionError(error)) {
        throw error;
      }

      if (isAbortError(error)) {
        throw createTimeoutError(timeoutMs, {
          url: input.url,
          snapshotPath: snapshotPath || undefined,
        });
      }

      throw createNetworkError("Laozhang Veo network request failed.", {
        url: input.url,
        cause: error instanceof Error ? error.message : ERROR_CODES.networkError,
        responseBody: responseText || undefined,
        snapshotPath: snapshotPath || undefined,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async tryGetVideoContentAsBinary(input: {
    url: string;
    videoId: string;
    timeoutMs?: number;
    snapshotLabel: string;
  }): Promise<LaozhangVeoDownloadedVideoResult | null> {
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? AI_VIDEO_GEN_DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let snapshotPath = "";

    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await this.fetchImpl(input.url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      const mimeType =
        response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase()
        || "";

      if (!response.ok) {
        const responseText = await response.text();
        snapshotPath = await this.saveResponseSnapshot({
          label: input.snapshotLabel,
          url: input.url,
          method: "GET",
          requestBody: {
            videoId: input.videoId,
          },
          responseText,
          status: response.status,
        });

        throw createHttpError({
          status: response.status,
          url: input.url,
          responseBody: responseText,
          snapshotPath,
        });
      }

      if (!mimeType.startsWith("video/")) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      snapshotPath = await this.saveBinaryResponseSnapshot({
        label: input.snapshotLabel,
        url: input.url,
        method: "GET",
        status: response.status,
        mimeType: mimeType || "video/mp4",
        byteLength: buffer.byteLength,
      });

      return {
        buffer,
        mimeType: mimeType || "video/mp4",
        size: buffer.byteLength,
        snapshotPath,
      };
    } catch (error) {
      if (isExecutionError(error)) {
        throw error;
      }

      if (isAbortError(error)) {
        throw createTimeoutError(timeoutMs, {
          url: input.url,
          snapshotPath: snapshotPath || undefined,
        });
      }

      throw createNetworkError("Laozhang Veo content request failed.", {
        url: input.url,
        cause: error instanceof Error ? error.message : ERROR_CODES.networkError,
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
          provider: AI_VIDEO_GEN_PROVIDER,
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

  private async saveBinaryResponseSnapshot(input: {
    label: string;
    url: string;
    method: string;
    status: number;
    mimeType: string;
    byteLength: number;
  }): Promise<string> {
    await fs.mkdir(this.snapshotDir, { recursive: true });

    const safeLabel = input.label.replace(/[^a-zA-Z0-9-_]/g, "-");
    const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${safeLabel}.json`;
    const absolutePath = path.join(this.snapshotDir, fileName);

    await fs.writeFile(
      absolutePath,
      JSON.stringify(
        {
          provider: AI_VIDEO_GEN_PROVIDER,
          url: input.url,
          method: input.method,
          status: input.status,
          mimeType: input.mimeType,
          byteLength: input.byteLength,
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    return absolutePath;
  }
}
