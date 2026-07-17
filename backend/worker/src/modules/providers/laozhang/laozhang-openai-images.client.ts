import fs from "node:fs/promises";
import path from "node:path";

import {
  WHITE_MODEL_RENDER_DEFAULT_TIMEOUT_MS,
  type ExecutionError,
} from "@newworkflow/backend-shared";
import {
  createLaozhangNetworkError,
  createLaozhangProviderError,
  createLaozhangTimeoutError,
  createLaozhangValidationError,
} from "./laozhang.errors.ts";
import {
  inferOpenAIImageMimeTypeFromUrl,
  parseLaozhangOpenAIImagesResponse,
} from "./laozhang-openai-images.parser.ts";
import {
  buildLaozhangRequestDiagnostics,
  type LaozhangRequestPhase,
} from "./laozhang-request-diagnostics.ts";
import { createLaozhangLongTimeoutFetch } from "./laozhang-long-timeout-fetch.ts";
import type {
  LaozhangOpenAIImagesEditInput,
  LaozhangOpenAIImagesGenerateInput,
  LaozhangOpenAIImagesSuccessResult,
} from "./laozhang-openai-images.types.ts";

export interface LaozhangOpenAIImagesClientOptions {
  apiKey: string | null;
  apiBaseUrl: string;
  snapshotDir: string;
  fetchImpl?: typeof fetch;
}

interface LaoZhangOpenAIImagesSnapshotInput {
  label: string;
  request: {
    url: string;
    method: "POST" | "GET";
    headers?: Record<string, string>;
    payload?: unknown;
    formDataEntries?: Array<{ key: string; value: string }>;
  };
  response: {
    status: number;
    responseText: string;
  };
}

export class LaozhangOpenAIImagesClient {
  private readonly apiKey: string | null;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly snapshotDir: string;

  constructor(options: LaozhangOpenAIImagesClientOptions) {
    this.apiKey = options.apiKey;
    this.apiBaseUrl = options.apiBaseUrl.trim().replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? createLaozhangLongTimeoutFetch();
    this.snapshotDir = options.snapshotDir;

    if (!this.apiBaseUrl) {
      throw new Error("Laozhang Sora2Official API base URL is required.");
    }
  }

  async generateImage(
    input: LaozhangOpenAIImagesGenerateInput,
  ): Promise<LaozhangOpenAIImagesSuccessResult> {
    this.assertConfigured();
    this.assertGenerateInput(input);

    const endpoint = `${this.apiBaseUrl}/images/generations`;
    const payload = {
      model: input.model,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
    };
    const timeoutMs = input.timeoutMs ?? WHITE_MODEL_RENDER_DEFAULT_TIMEOUT_MS;

    return this.withTimeout(timeoutMs, async (controller) => {
      let responseText = "";
      let snapshotPath = "";
      let phase: LaozhangRequestPhase = "before-fetch";
      let httpStatus: number | undefined;
      const startedAtMs = Date.now();

      try {
        phase = "fetch";
        const response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        phase = "response-received";
        httpStatus = response.status;
        phase = "body-read";
        responseText = await response.text();
        phase = "snapshot-write";
        snapshotPath = await this.saveResponseSnapshot({
          label: input.snapshotLabel ?? "laozhang-openai-images-generate-response",
          request: {
            url: endpoint,
            method: "POST",
            headers: {
              Authorization: "Bearer ***",
              "Content-Type": "application/json",
            },
            payload,
          },
          response: {
            status: response.status,
            responseText,
          },
        });

        if (!response.ok) {
          throw createLaozhangProviderError(
            `Laozhang Sora2Official image generation request failed with HTTP status ${response.status}.`,
            String(response.status),
            {
              responseBody: responseText,
              snapshotPath,
            },
          );
        }

        phase = "parse-response";
        const parsed = parseLaozhangOpenAIImagesResponse({
          responseText,
          snapshotPath,
        });

        if (parsed.kind === "base64") {
          return {
            imageBase64: parsed.imageBase64,
            mimeType: parsed.mimeType,
            rawResponse: parsed.rawResponse,
            responseText: parsed.responseText,
            snapshotPath: parsed.snapshotPath,
          };
        }

        return this.downloadImageUrl({
          url: parsed.url,
          timeoutMs,
          parentSnapshotPath: parsed.snapshotPath,
        });
      } catch (error) {
        this.throwNormalizedError(error, {
          timeoutMs,
          apiUrl: endpoint,
          responseText,
          snapshotPath,
          startedAtMs,
          phase,
          method: "POST",
          httpStatus,
        });
      }
    });
  }

  async editImage(_input: LaozhangOpenAIImagesEditInput): Promise<LaozhangOpenAIImagesSuccessResult> {
    throw createLaozhangValidationError("Laozhang Sora2Official image edit is not implemented yet.");
  }

  private assertConfigured(): void {
    if (!this.apiKey) {
      throw createLaozhangValidationError("LAOZHANG_SORA2OFFICIAL_API_KEY is not configured.");
    }
  }

  private assertGenerateInput(input: LaozhangOpenAIImagesGenerateInput): void {
    if (!input.prompt.trim()) {
      throw createLaozhangValidationError("Laozhang Sora2Official image prompt is required.");
    }

    if (!input.model.trim()) {
      throw createLaozhangValidationError("Laozhang Sora2Official image model is required.");
    }

    if (!input.size.trim()) {
      throw createLaozhangValidationError("Laozhang Sora2Official image size is required.");
    }

    if (!input.quality.trim()) {
      throw createLaozhangValidationError("Laozhang Sora2Official image quality is required.");
    }
  }

  private async downloadImageUrl(input: {
    url: string;
    timeoutMs: number;
    parentSnapshotPath: string;
  }): Promise<LaozhangOpenAIImagesSuccessResult> {
    return this.withTimeout(input.timeoutMs, async (controller) => {
      let responseText = "";
      let phase: LaozhangRequestPhase = "before-fetch";
      let httpStatus: number | undefined;
      const startedAtMs = Date.now();

      try {
        phase = "fetch";
        const response = await this.fetchImpl(input.url, {
          method: "GET",
          signal: controller.signal,
        });

        phase = "response-received";
        httpStatus = response.status;
        if (!response.ok) {
          phase = "body-read";
          responseText = await response.text();
          throw createLaozhangProviderError(
            `Laozhang Sora2Official image download failed with HTTP status ${response.status}.`,
            String(response.status),
            {
              responseBody: responseText,
              snapshotPath: input.parentSnapshotPath,
              downloadUrl: input.url,
            },
          );
        }

        phase = "download-body";
        const arrayBuffer = await response.arrayBuffer();
        const imageBase64 = Buffer.from(arrayBuffer).toString("base64");
        const mimeType =
          response.headers.get("content-type")
          ?? inferOpenAIImageMimeTypeFromUrl(input.url);

        return {
          imageBase64,
          mimeType,
          rawResponse: {
            url: input.url,
            downloaded: true,
          },
          responseText: input.url,
          snapshotPath: input.parentSnapshotPath,
        };
      } catch (error) {
        this.throwNormalizedError(error, {
          timeoutMs: input.timeoutMs,
          apiUrl: input.url,
          responseText,
          snapshotPath: input.parentSnapshotPath,
          startedAtMs,
          phase,
          method: "GET",
          httpStatus,
        });
      }
    });
  }

  private async withTimeout<T>(
    timeoutMs: number,
    callback: (controller: AbortController) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      return await callback(controller);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private throwNormalizedError(
    error: unknown,
    context: {
      timeoutMs: number;
      apiUrl: string;
      responseText: string;
      snapshotPath: string;
      startedAtMs: number;
      phase: LaozhangRequestPhase;
      method: "GET" | "POST";
      httpStatus?: number;
    },
  ): never {
    const diagnostics = buildLaozhangRequestDiagnostics(error, {
      apiUrl: context.apiUrl,
      timeoutMs: context.timeoutMs,
      startedAtMs: context.startedAtMs,
      phase: context.phase,
      method: context.method,
      httpStatus: context.httpStatus,
      responseBodyBytes: context.responseText
        ? Buffer.byteLength(context.responseText, "utf8")
        : undefined,
      snapshotPath: context.snapshotPath || undefined,
    });

    if (this.isExecutionError(error)) {
      throw this.withExecutionDiagnostics(error, diagnostics, context.responseText);
    }

    if (this.isAbortError(error)) {
      throw createLaozhangTimeoutError(context.timeoutMs, {
        ...diagnostics,
      });
    }

    throw createLaozhangNetworkError("Laozhang Sora2Official image API network request failed.", {
      ...diagnostics,
      cause: error instanceof Error ? error.message : "NETWORK_ERROR",
      responseBody: context.responseText || undefined,
    });
  }

  private withExecutionDiagnostics(
    error: ExecutionError,
    diagnostics: Record<string, unknown>,
    responseText: string,
  ): ExecutionError {
    return {
      ...error,
      details: {
        ...error.details,
        ...diagnostics,
        ...(responseText && !error.details?.responseBody ? { responseBody: responseText } : {}),
      },
    };
  }

  private async saveResponseSnapshot(input: LaoZhangOpenAIImagesSnapshotInput): Promise<string> {
    await fs.mkdir(this.snapshotDir, { recursive: true });

    const safeLabel = input.label.replace(/[^a-zA-Z0-9-_]/g, "-");
    const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${safeLabel}.json`;
    const absolutePath = path.join(this.snapshotDir, fileName);

    await fs.writeFile(
      absolutePath,
      JSON.stringify(
        {
          provider: "laozhang-sora2official",
          request: input.request,
          response: input.response,
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

  private isExecutionError(error: unknown): error is ExecutionError {
    return Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && "message" in error
      && "retryable" in error,
    );
  }
}
