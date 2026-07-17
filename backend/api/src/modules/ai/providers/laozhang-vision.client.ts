import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  RETRYABLE_ERROR_CODES,
} from "@newworkflow/backend-shared";
import type { ExecutionError } from "@newworkflow/backend-shared";
import {
  buildPromptOptimizeMessages,
  cleanPromptOptimizeResponseText,
  type PromptOptimizeChatMessage,
} from "../prompt-optimize.messages.ts";

export interface LaozhangVisionClientOptions {
  apiKey: string | null;
  apiUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface LaozhangVisionPromptOptimizeInput {
  prompt: string;
  imageDataUrls: string[];
}

export interface LaozhangVisionPromptOptimizeResult {
  optimizedPrompt: string;
  model: string;
  rawResponse: unknown;
  responseText: string;
}

export interface LaozhangVisionImageContentPart {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export interface LaozhangVisionTextContentPart {
  type: "text";
  text: string;
}

export type LaozhangVisionMessageContentPart =
  | LaozhangVisionImageContentPart
  | LaozhangVisionTextContentPart;

export interface LaozhangVisionChatMessage {
  role: "system" | "user";
  content: string | LaozhangVisionMessageContentPart[];
}

export interface LaozhangVisionCompletionInput {
  messages: LaozhangVisionChatMessage[];
}

export interface LaozhangVisionCompletionResult {
  contentText: string;
  model: string;
  rawResponse: unknown;
  responseText: string;
}

interface LaozhangVisionChatPayload {
  model: string;
  stream: false;
  messages: LaozhangVisionChatMessage[];
}

function isRetryableCode(code: ExecutionError["code"]): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
}

function createVisionError(
  code: ExecutionError["code"],
  message: string,
  category: ExecutionError["category"],
  details?: Record<string, unknown>,
  providerCode?: string,
): ExecutionError {
  return {
    code,
    message,
    category,
    retryable: isRetryableCode(code),
    provider: "laozhang",
    ...(providerCode ? { providerCode } : {}),
    ...(details ? { details } : {}),
  };
}

function createValidationError(message: string, details?: Record<string, unknown>): ExecutionError {
  return createVisionError(ERROR_CODES.validationError, message, ERROR_CATEGORIES.common, details);
}

function createTimeoutError(timeoutMs: number, details?: Record<string, unknown>): ExecutionError {
  return createVisionError(
    ERROR_CODES.timeout,
    `Laozhang vision request timed out (${timeoutMs}ms).`,
    ERROR_CATEGORIES.providerRetryable,
    details,
  );
}

function createNetworkError(message: string, details?: Record<string, unknown>): ExecutionError {
  return createVisionError(ERROR_CODES.networkError, message, ERROR_CATEGORIES.providerRetryable, details);
}

function createProviderError(
  message: string,
  providerCode?: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return createVisionError(
    ERROR_CODES.providerError,
    message,
    ERROR_CATEGORIES.providerRetryable,
    details,
    providerCode,
  );
}

function createInvalidResponseError(message: string, details?: Record<string, unknown>): ExecutionError {
  return createVisionError(ERROR_CODES.invalidResponse, message, ERROR_CATEGORIES.providerRetryable, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJsonResponse(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch {
    throw createInvalidResponseError("Laozhang vision API returned a non-JSON response.", {
      responseBody: responseText,
    });
  }
}

function extractMessageContent(parsed: unknown, responseText: string): string {
  if (!isRecord(parsed)) {
    throw createInvalidResponseError("Laozhang vision API response root must be an object.", {
      responseBody: responseText,
    });
  }

  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw createInvalidResponseError("Laozhang vision API response is missing choices.", {
      responseBody: responseText,
    });
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw createInvalidResponseError("Laozhang vision API response is missing message.", {
      responseBody: responseText,
    });
  }

  const content = firstChoice.message.content;
  if (typeof content !== "string") {
    throw createInvalidResponseError("Laozhang vision API returned invalid message.content.", {
      responseBody: responseText,
    });
  }

  const normalized = content.trim();
  if (!normalized) {
    throw createInvalidResponseError("Laozhang vision API returned empty message content.", {
      responseBody: responseText,
    });
  }

  return normalized;
}

function parseOptimizedPrompt(responseText: string): {
  optimizedPrompt: string;
  rawResponse: unknown;
} {
  const parsed = parseJsonResponse(responseText);
  const content = extractMessageContent(parsed, responseText);
  const optimizedPrompt = cleanPromptOptimizeResponseText(content);

  if (!optimizedPrompt) {
    throw createInvalidResponseError("Laozhang vision API returned an empty optimized prompt.", {
      responseBody: responseText,
    });
  }

  return {
    optimizedPrompt,
    rawResponse: parsed,
  };
}

export class LaozhangVisionClient {
  private readonly apiKey: string | null;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: LaozhangVisionClientOptions) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
  }

  buildPayload(input: LaozhangVisionPromptOptimizeInput): LaozhangVisionChatPayload {
    if (!input.prompt.trim()) {
      throw createValidationError("Laozhang vision prompt must not be empty.");
    }

    return {
      model: this.model,
      stream: false,
      messages: buildPromptOptimizeMessages({
        prompt: input.prompt,
        images: input.imageDataUrls.map((dataUrl) => ({ dataUrl })),
      }),
    };
  }

  buildCompletionPayload(input: LaozhangVisionCompletionInput): LaozhangVisionChatPayload {
    if (!Array.isArray(input.messages) || input.messages.length === 0) {
      throw createValidationError("Laozhang vision completion requires at least one message.");
    }

    return {
      model: this.model,
      stream: false,
      messages: input.messages,
    };
  }

  async complete(input: LaozhangVisionCompletionInput): Promise<LaozhangVisionCompletionResult> {
    if (!this.apiKey) {
      throw createValidationError("LAOZHANG_API_KEY is not configured.");
    }

    const payload = this.buildCompletionPayload(input);
    const result = await this.sendPayload(payload);

    return {
      contentText: extractMessageContent(result.rawResponse, result.responseText),
      model: this.model,
      rawResponse: result.rawResponse,
      responseText: result.responseText,
    };
  }

  async optimizePrompt(
    input: LaozhangVisionPromptOptimizeInput,
  ): Promise<LaozhangVisionPromptOptimizeResult> {
    if (!this.apiKey) {
      throw createValidationError("LAOZHANG_API_KEY is not configured.");
    }

    const payload = this.buildPayload(input);
    const result = await this.sendPayload(payload);
    const parsed = parseOptimizedPrompt(result.responseText);

    return {
      optimizedPrompt: parsed.optimizedPrompt,
      model: this.model,
      rawResponse: parsed.rawResponse,
      responseText: result.responseText,
    };
  }

  private async sendPayload(payload: LaozhangVisionChatPayload): Promise<{
    rawResponse: unknown;
    responseText: string;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let responseText = "";

    try {
      const response = await this.fetchImpl(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      responseText = await response.text();

      if (!response.ok) {
        throw createProviderError(
          `Laozhang vision API request failed with HTTP ${response.status}.`,
          String(response.status),
          {
            responseBody: responseText,
          },
        );
      }

      return {
        rawResponse: parseJsonResponse(responseText),
        responseText,
      };
    } catch (error) {
      if (this.isExecutionError(error)) {
        throw error;
      }

      if (this.isAbortError(error)) {
        throw createTimeoutError(this.timeoutMs, {
          apiUrl: this.apiUrl,
        });
      }

      throw createNetworkError("Laozhang vision API network request failed.", {
        apiUrl: this.apiUrl,
        cause: error instanceof Error ? error.message : ERROR_CODES.networkError,
        responseBody: responseText || undefined,
      });
    } finally {
      clearTimeout(timeoutId);
    }
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

export type { PromptOptimizeChatMessage };
