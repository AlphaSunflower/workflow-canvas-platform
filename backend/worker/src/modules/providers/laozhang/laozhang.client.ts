import fs from "node:fs/promises";
import path from "node:path";

import {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  AI_IMAGE_GEN_MODEL,
  ERROR_CODES,
  WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE,
  WHITE_MODEL_RENDER_DEFAULT_TIMEOUT_MS,
  type SharedSupportedAspectRatio,
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
  parseLaozhangImageResponse,
  parseLaozhangOpenAIImageResponse,
} from "./laozhang.parser.ts";
import {
  buildLaozhangRequestDiagnostics,
  type LaozhangRequestPhase,
} from "./laozhang-request-diagnostics.ts";
import { createLaozhangLongTimeoutFetch } from "./laozhang-long-timeout-fetch.ts";
import { LaozhangOpenAIImagesClient } from "./laozhang-openai-images.client.ts";
import type {
  LaozhangAspectRatio,
  LaozhangGenerateImageInput,
  LaozhangGeminiGenerateImageInput,
  LaozhangImageSize,
  LaozhangOpenAIEditImageInput,
  LaozhangOpenAIImagesGenerateImageInput,
  LaozhangOpenAIParameterlessGenerateImageInput,
  LaozhangOpenAITextToImageInput,
  LaozhangRequestPart,
  LaozhangRequestPayload,
  LaozhangSuccessResult,
} from "./laozhang.types.ts";

export interface LaozhangClientOptions {
  apiKey: string | null;
  apiUrl: string;
  openaiApiBaseUrl: string;
  sora2OfficialApiKey?: string | null;
  sora2OfficialApiBaseUrl?: string;
  snapshotDir: string;
  fetchImpl?: typeof fetch;
}

interface LaoZhangSnapshotInput {
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

export class LaozhangClient {
  private readonly apiKey: string | null;
  private readonly apiUrl: string;
  private readonly openaiApiBaseUrl: string;
  private readonly sora2OfficialApiKey: string | null;
  private readonly sora2OfficialApiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly snapshotDir: string;
  private readonly openAIImagesClient: LaozhangOpenAIImagesClient;

  constructor(options: LaozhangClientOptions) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl.trim();
    this.openaiApiBaseUrl = options.openaiApiBaseUrl.trim().replace(/\/+$/, "");
    this.sora2OfficialApiKey = options.sora2OfficialApiKey ?? null;
    this.sora2OfficialApiBaseUrl = (options.sora2OfficialApiBaseUrl ?? "https://api.laozhang.ai/v1")
      .trim()
      .replace(/\/+$/, "");

    if (!this.apiUrl) {
      throw new Error("Laozhang API URL is required.");
    }

    if (!this.openaiApiBaseUrl) {
      throw new Error("Laozhang OpenAI API base URL is required.");
    }

    if (!this.sora2OfficialApiBaseUrl) {
      throw new Error("Laozhang Sora2Official API base URL is required.");
    }

    this.fetchImpl = options.fetchImpl ?? createLaozhangLongTimeoutFetch();
    this.snapshotDir = options.snapshotDir;
    this.openAIImagesClient = new LaozhangOpenAIImagesClient({
      apiKey: this.sora2OfficialApiKey,
      apiBaseUrl: this.sora2OfficialApiBaseUrl,
      snapshotDir: this.snapshotDir,
      fetchImpl: this.fetchImpl,
    });
  }

  private normalizeImageSize(input: LaozhangGeminiGenerateImageInput): LaozhangImageSize {
    return input.imageSize ?? WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE;
  }

  private normalizeAspectRatio(
    input: { aspectRatio?: SharedSupportedAspectRatio },
  ): LaozhangAspectRatio | undefined {
    if (!input.aspectRatio || input.aspectRatio === "auto") {
      return undefined;
    }

    return input.aspectRatio;
  }

  private getModel(input: LaozhangGenerateImageInput): string {
    return input.model ?? AI_IMAGE_GEN_MODEL;
  }

  assertSora2OfficialConfigured(): void {
    if (!this.sora2OfficialApiKey) {
      throw createLaozhangValidationError("LAOZHANG_SORA2OFFICIAL_API_KEY is not configured.");
    }

    if (!this.sora2OfficialApiBaseUrl) {
      throw createLaozhangValidationError("Laozhang Sora2Official API base URL is not configured.");
    }
  }

  private isOpenAIEditInput(
    input: LaozhangGenerateImageInput,
  ): input is LaozhangOpenAIEditImageInput {
    return this.getModel(input) === "gpt-image-2-vip" && input.images.length > 0;
  }

  private isOpenAITextToImageInput(
    input: LaozhangGenerateImageInput,
  ): input is LaozhangOpenAITextToImageInput {
    return this.getModel(input) === "gpt-image-2-vip" && input.images.length === 0;
  }

  private isOpenAIParameterlessImageInput(
    input: LaozhangGenerateImageInput,
  ): input is LaozhangOpenAIParameterlessGenerateImageInput {
    return this.getModel(input) === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
  }

  private isOpenAIImagesGenerateInput(
    input: LaozhangGenerateImageInput,
  ): input is LaozhangOpenAIImagesGenerateImageInput {
    return this.getModel(input) === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL;
  }

  private isGeminiImageInput(
    input: LaozhangGenerateImageInput,
  ): input is LaozhangGeminiGenerateImageInput {
    return (
      !this.isOpenAIImagesGenerateInput(input)
      && !this.isOpenAIParameterlessImageInput(input)
      && !this.isOpenAITextToImageInput(input)
      && !this.isOpenAIEditInput(input)
    );
  }

  private assertCommonInput(input: LaozhangGenerateImageInput): void {
    if (!input.prompt.trim()) {
      throw createLaozhangValidationError("Laozhang image prompt is required.");
    }

    if (
      !this.isOpenAIImagesGenerateInput(input)
      && !this.isOpenAIParameterlessImageInput(input)
      && !this.isOpenAITextToImageInput(input)
      && !this.isGeminiImageInput(input)
      && input.images.length === 0
    ) {
      throw createLaozhangValidationError("Laozhang image request requires at least one input image.");
    }
  }

  buildGeminiPayload(input: LaozhangGeminiGenerateImageInput): LaozhangRequestPayload {
    this.assertCommonInput(input);

    const parts: LaozhangRequestPart[] = [
      {
        text: input.prompt,
      },
      ...input.images.map((image) => ({
        inline_data: {
          mime_type: image.mimeType,
          data: image.dataBase64,
        },
      })),
    ];

    const payload: LaozhangRequestPayload = {
      contents: [
        {
          parts,
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          imageSize: this.normalizeImageSize(input),
        },
      },
    };

    const aspectRatio = this.normalizeAspectRatio(input);
    if (aspectRatio) {
      payload.generationConfig.imageConfig.aspectRatio = aspectRatio;
    }

    return payload;
  }

  buildOpenAIEditFormData(input: LaozhangOpenAIEditImageInput): {
    formData: FormData;
    snapshotEntries: Array<{ key: string; value: string }>;
  } {
    this.assertCommonInput(input);

    if (!input.size.trim()) {
      throw createLaozhangValidationError("Laozhang OpenAI image edit size is required.");
    }

    const formData = new FormData();
    const snapshotEntries: Array<{ key: string; value: string }> = [];
    const model = this.getModel(input);

    formData.append("model", model);
    snapshotEntries.push({ key: "model", value: model });

    formData.append("prompt", input.prompt);
    snapshotEntries.push({ key: "prompt", value: input.prompt });

    formData.append("size", input.size);
    snapshotEntries.push({ key: "size", value: input.size });

    input.images.forEach((image, index) => {
      const extension = this.mimeTypeToExtension(image.mimeType);
      const fileName = `image-${index + 1}.${extension}`;
      const buffer = Buffer.from(image.dataBase64, "base64");
      const blob = new Blob([buffer], { type: image.mimeType });

      formData.append("image[]", blob, fileName);
      snapshotEntries.push({ key: "image[]", value: fileName });
    });

    return {
      formData,
      snapshotEntries,
    };
  }

  async generateImage(
    input: LaozhangGenerateImageInput,
  ): Promise<LaozhangSuccessResult> {
    if (this.isOpenAIImagesGenerateInput(input)) {
      return this.generateOpenAIImage(input);
    }

    if (!this.apiKey) {
      throw createLaozhangValidationError("LAOZHANG_API_KEY is not configured.");
    }

    if (this.isOpenAIEditInput(input)) {
      return this.generateOpenAIEditedImage(input);
    }

    if (this.isOpenAIParameterlessImageInput(input)) {
      return input.images.length > 0
        ? this.generateOpenAIParameterlessEditedImage(input)
        : this.generateOpenAIParameterlessTextToImage(input);
    }

    if (this.isOpenAITextToImageInput(input)) {
      return this.generateOpenAITextToImage(input);
    }

    return this.generateGeminiImage(input);
  }

  private async generateOpenAIImage(
    input: LaozhangOpenAIImagesGenerateImageInput,
  ): Promise<LaozhangSuccessResult> {
    this.assertCommonInput(input);

    const providerModel = input.providerModel ?? AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL;
    if (providerModel !== AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL) {
      throw createLaozhangValidationError("Unsupported Sora2Official image provider model.");
    }

    return this.openAIImagesClient.generateImage({
      model: providerModel,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      timeoutMs: input.timeoutMs,
      snapshotLabel: input.snapshotLabel,
    });
  }

  private async generateGeminiImage(
    input: LaozhangGeminiGenerateImageInput,
  ): Promise<LaozhangSuccessResult> {
    const payload = this.buildGeminiPayload(input);
    const timeoutMs = input.timeoutMs ?? WHITE_MODEL_RENDER_DEFAULT_TIMEOUT_MS;

    return this.withTimeout(timeoutMs, async (controller) => {
      let responseText = "";
      let snapshotPath = "";
      let phase: LaozhangRequestPhase = "before-fetch";
      let httpStatus: number | undefined;
      const startedAtMs = Date.now();

      try {
        phase = "fetch";
        const response = await this.fetchImpl(this.apiUrl, {
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
          label: input.snapshotLabel ?? "laozhang-response",
          request: {
            url: this.apiUrl,
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
            `Laozhang API request failed with HTTP status ${response.status}.`,
            String(response.status),
            {
              responseBody: responseText,
              snapshotPath,
            },
          );
        }

        phase = "parse-response";
        return parseLaozhangImageResponse({
          responseText,
          snapshotPath,
        });
      } catch (error) {
        this.throwNormalizedError(error, {
          timeoutMs,
          apiUrl: this.apiUrl,
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

  private async generateOpenAIEditedImage(
    input: LaozhangOpenAIEditImageInput,
  ): Promise<LaozhangSuccessResult> {
    const endpoint = `${this.openaiApiBaseUrl}/images/edits`;
    const { formData, snapshotEntries } = this.buildOpenAIEditFormData(input);
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
          },
          body: formData,
          signal: controller.signal,
        });

        phase = "response-received";
        httpStatus = response.status;
        phase = "body-read";
        responseText = await response.text();
        phase = "snapshot-write";
        snapshotPath = await this.saveResponseSnapshot({
          label: input.snapshotLabel ?? "laozhang-openai-image-response",
          request: {
            url: endpoint,
            method: "POST",
            headers: {
              Authorization: "Bearer ***",
            },
            formDataEntries: snapshotEntries,
          },
          response: {
            status: response.status,
            responseText,
          },
        });

        if (!response.ok) {
          throw createLaozhangProviderError(
            `Laozhang OpenAI image request failed with HTTP status ${response.status}.`,
            String(response.status),
            {
              responseBody: responseText,
              snapshotPath,
            },
          );
        }

        phase = "parse-response";
        const parsed = parseLaozhangOpenAIImageResponse({
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

        return this.downloadOpenAIImageUrl({
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

  private buildOpenAIParameterlessEditFormData(input: LaozhangOpenAIParameterlessGenerateImageInput): {
    formData: FormData;
    snapshotEntries: Array<{ key: string; value: string }>;
  } {
    this.assertCommonInput(input);

    const formData = new FormData();
    const snapshotEntries: Array<{ key: string; value: string }> = [];

    formData.append("model", input.model);
    snapshotEntries.push({ key: "model", value: input.model });

    formData.append("prompt", input.prompt);
    snapshotEntries.push({ key: "prompt", value: input.prompt });

    input.images.forEach((image, index) => {
      const extension = this.mimeTypeToExtension(image.mimeType);
      const fileName = `image-${index + 1}.${extension}`;
      const buffer = Buffer.from(image.dataBase64, "base64");
      const blob = new Blob([buffer], { type: image.mimeType });

      formData.append("image[]", blob, fileName);
      snapshotEntries.push({ key: "image[]", value: fileName });
    });

    return {
      formData,
      snapshotEntries,
    };
  }

  private async generateOpenAIParameterlessEditedImage(
    input: LaozhangOpenAIParameterlessGenerateImageInput,
  ): Promise<LaozhangSuccessResult> {
    const endpoint = `${this.openaiApiBaseUrl}/images/edits`;
    const { formData, snapshotEntries } = this.buildOpenAIParameterlessEditFormData(input);
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
          },
          body: formData,
          signal: controller.signal,
        });

        phase = "response-received";
        httpStatus = response.status;
        phase = "body-read";
        responseText = await response.text();
        phase = "snapshot-write";
        snapshotPath = await this.saveResponseSnapshot({
          label: input.snapshotLabel ?? "laozhang-openai-image-parameterless-edit-response",
          request: {
            url: endpoint,
            method: "POST",
            headers: {
              Authorization: "Bearer ***",
            },
            formDataEntries: snapshotEntries,
          },
          response: {
            status: response.status,
            responseText,
          },
        });

        if (!response.ok) {
          throw createLaozhangProviderError(
            `Laozhang OpenAI image request failed with HTTP status ${response.status}.`,
            String(response.status),
            {
              responseBody: responseText,
              snapshotPath,
            },
          );
        }

        phase = "parse-response";
        const parsed = parseLaozhangOpenAIImageResponse({
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

        return this.downloadOpenAIImageUrl({
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

  private async generateOpenAIParameterlessTextToImage(
    input: LaozhangOpenAIParameterlessGenerateImageInput,
  ): Promise<LaozhangSuccessResult> {
    this.assertCommonInput(input);

    const endpoint = `${this.openaiApiBaseUrl}/images/generations`;
    const payload = {
      model: input.model,
      prompt: input.prompt,
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
          label: input.snapshotLabel ?? "laozhang-openai-image-parameterless-generate-response",
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
            `Laozhang OpenAI image generation request failed with HTTP status ${response.status}.`,
            String(response.status),
            {
              responseBody: responseText,
              snapshotPath,
            },
          );
        }

        phase = "parse-response";
        const parsed = parseLaozhangOpenAIImageResponse({
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

        return this.downloadOpenAIImageUrl({
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

  private async generateOpenAITextToImage(
    input: LaozhangOpenAITextToImageInput,
  ): Promise<LaozhangSuccessResult> {
    this.assertCommonInput(input);

    if (!input.size.trim()) {
      throw createLaozhangValidationError("Laozhang OpenAI image generation size is required.");
    }

    const endpoint = `${this.openaiApiBaseUrl}/images/generations`;
    const payload = {
      model: input.model,
      prompt: input.prompt,
      size: input.size,
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
          label: input.snapshotLabel ?? "laozhang-openai-image-generate-response",
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
            `Laozhang OpenAI image generation request failed with HTTP status ${response.status}.`,
            String(response.status),
            {
              responseBody: responseText,
              snapshotPath,
            },
          );
        }

        phase = "parse-response";
        const parsed = parseLaozhangOpenAIImageResponse({
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

        return this.downloadOpenAIImageUrl({
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

  private async downloadOpenAIImageUrl(input: {
    url: string;
    timeoutMs: number;
    parentSnapshotPath: string;
  }): Promise<LaozhangSuccessResult> {
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
            `Laozhang OpenAI image download failed with HTTP status ${response.status}.`,
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

    throw createLaozhangNetworkError("Laozhang API network request failed.", {
      ...diagnostics,
      cause: error instanceof Error ? error.message : ERROR_CODES.networkError,
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

  private async saveResponseSnapshot(input: LaoZhangSnapshotInput): Promise<string> {
    await fs.mkdir(this.snapshotDir, { recursive: true });

    const safeLabel = input.label.replace(/[^a-zA-Z0-9-_]/g, "-");
    const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${safeLabel}.json`;
    const absolutePath = path.join(this.snapshotDir, fileName);

    await fs.writeFile(
      absolutePath,
      JSON.stringify(
        {
          provider: "laozhang",
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

  private mimeTypeToExtension(mimeType: string): string {
    switch (mimeType) {
      case "image/jpeg":
        return "jpg";
      case "image/webp":
        return "webp";
      default:
        return "png";
    }
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
