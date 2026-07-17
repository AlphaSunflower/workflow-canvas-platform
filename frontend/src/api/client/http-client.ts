import type { ApiResponse, AppError, ErrorCode, Result } from '../../types';
import { createError } from '../../utils/error/create';
import { handleError, tryCatchAsync } from '../../utils/error/handle';
import { createModuleLogger } from '../../utils/logger/module';

const log = createModuleLogger('http-client');

export interface HttpClientConfig {
  baseURL: string;
  timeout: number;
  headers: Record<string, string>;
}

export interface RequestConfig {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  skipAuthRefresh?: boolean;
  suppressErrorLog?: boolean;
}

export interface RawRequestConfig extends RequestConfig {
  params?: Record<string, unknown>;
  body?: BodyInit | null;
  responseType?: 'json' | 'blob' | 'text' | 'raw';
  contentType?: string | null;
}

export interface RefreshAuthResult {
  accessToken: string;
}

export interface AuthLifecycleHandlers {
  refreshAuth: () => Promise<Result<RefreshAuthResult>>;
  onAuthRefreshFailure?: (error: AppError) => void | Promise<void>;
}

const DEFAULT_CONFIG: HttpClientConfig = {
  baseURL: '',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
};

const MAX_ERROR_BODY_SNIPPET_LENGTH = 2048;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const REDACTED_DIAGNOSTIC_VALUE = '[REDACTED]';

type ParsedApiErrorPayload = {
  code?: string | number;
  error?: string;
  message?: string;
  errors?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getCodeValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return getNonEmptyString(value);
}

function resolveCurrentOrigin(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return undefined;
  }

  return window.location.origin;
}

function createBodyDiagnostics(rawBody: string): Record<string, unknown> {
  if (!rawBody) {
    return {
      bodySnippet: '',
      bodyLength: 0,
      bodyTruncated: false,
    };
  }

  const safeBody = redactSensitiveText(rawBody);
  const bodySnippet = safeBody.length > MAX_ERROR_BODY_SNIPPET_LENGTH
    ? safeBody.slice(0, MAX_ERROR_BODY_SNIPPET_LENGTH)
    : safeBody;

  return {
    bodySnippet,
    bodyLength: rawBody.length,
    bodyTruncated: rawBody.length > MAX_ERROR_BODY_SNIPPET_LENGTH || safeBody.length > MAX_ERROR_BODY_SNIPPET_LENGTH,
    ...(rawBody.length <= MAX_ERROR_BODY_SNIPPET_LENGTH ? { body: safeBody } : {}),
  };
}

function createTextSnippet(rawText: string, maxLength: number): { text: string; length: number; truncated: boolean } {
  const safeText = redactSensitiveText(rawText);
  if (safeText.length <= maxLength) {
    return {
      text: safeText,
      length: rawText.length,
      truncated: rawText.length !== safeText.length && rawText.length > maxLength,
    };
  }

  return {
    text: `${safeText.slice(0, maxLength)}...`,
    length: rawText.length,
    truncated: true,
  };
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_DIAGNOSTIC_VALUE}`)
    .replace(
      /("(?:accessToken|refreshToken|idToken|access_token|refresh_token|id_token|token|authorization)"\s*:\s*")([^"]*)(")/gi,
      `$1${REDACTED_DIAGNOSTIC_VALUE}$3`,
    )
    .replace(
      /('(?:accessToken|refreshToken|idToken|access_token|refresh_token|id_token|token|authorization)'\s*:\s*')([^']*)(')/gi,
      `$1${REDACTED_DIAGNOSTIC_VALUE}$3`,
    )
    .replace(
      /([?&](?:accessToken|refreshToken|idToken|access_token|refresh_token|id_token|token)=)[^&#"',}\[\]\s]+/gi,
      `$1${REDACTED_DIAGNOSTIC_VALUE}`,
    );
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    if (depth >= 3) {
      return '[Array]';
    }

    return value.map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }

  if (isRecord(value)) {
    if (depth >= 3) {
      return '[Object]';
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sanitizeDiagnosticValue(entryValue, depth + 1),
      ]),
    );
  }

  return value;
}

function sanitizeDiagnosticContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      sanitizeDiagnosticValue(value),
    ]),
  );
}

class HttpClient {
  private config: HttpClientConfig;
  private authToken: string | null = null;
  private authLifecycleHandlers: AuthLifecycleHandlers | null = null;
  private refreshInFlight: Promise<Result<RefreshAuthResult>> | null = null;

  constructor(config: Partial<HttpClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  clearAuthToken(): void {
    this.authToken = null;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  setAuthLifecycleHandlers(handlers: AuthLifecycleHandlers | null): void {
    this.authLifecycleHandlers = handlers;
  }

  setBaseURL(baseURL: string): void {
    this.config.baseURL = baseURL;
  }

  getBaseURL(): string {
    return this.config.baseURL;
  }

  private buildURL(path: string, params?: Record<string, unknown>): string {
    const hasBaseURL = typeof this.config.baseURL === 'string' && this.config.baseURL.trim().length > 0;

    if (!hasBaseURL) {
      const searchParams = new URLSearchParams();

      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, String(value));
          }
        });
      }

      const queryString = searchParams.toString();
      return queryString ? `${path}?${queryString}` : path;
    }

    const url = new URL(path, this.config.baseURL);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private buildRequestDiagnostics(
    method: string,
    path: string,
    url: string,
  ): Record<string, unknown> {
    const currentOrigin = resolveCurrentOrigin();
    let requestOrigin: string | undefined;
    let isCrossOrigin = false;

    try {
      requestOrigin = new URL(url, currentOrigin ?? undefined).origin;
      isCrossOrigin = Boolean(currentOrigin && requestOrigin !== currentOrigin);
    } catch {
      requestOrigin = undefined;
    }

    return {
      method,
      path,
      url,
      baseURL: this.config.baseURL,
      isCrossOrigin,
      hasAuthToken: Boolean(this.authToken),
      ...(currentOrigin ? { currentOrigin } : {}),
      ...(requestOrigin ? { requestOrigin } : {}),
    };
  }

  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.config.headers,
      ...customHeaders,
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  private parseErrorPayload(rawBody: string): ParsedApiErrorPayload | null {
    if (!rawBody) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!isRecord(parsed)) {
        return null;
      }

      return {
        code: getCodeValue(parsed.code),
        error: getNonEmptyString(parsed.error),
        message: getNonEmptyString(parsed.message),
        errors: parsed.errors,
      };
    } catch {
      return null;
    }
  }

  private resolveAppErrorCode(
    fallbackCode: ErrorCode,
    backendPayload?: ParsedApiErrorPayload | null,
  ): string {
    const backendError = getNonEmptyString(backendPayload?.error);
    if (backendError) {
      return backendError;
    }

    const backendCode = backendPayload?.code;
    if (typeof backendCode === 'string' && backendCode.trim().length > 0) {
      return backendCode.trim();
    }

    if (typeof backendCode === 'number' && Number.isFinite(backendCode)) {
      return `API_ERROR_${backendCode}`;
    }

    return fallbackCode;
  }

  private createStructuredError(
    fallbackCode: ErrorCode,
    message: string,
    operation: string,
    options?: {
      backendPayload?: ParsedApiErrorPayload | null;
      cause?: Error;
      context?: Record<string, unknown>;
    },
  ): AppError {
    const backendPayload = options?.backendPayload ?? null;
    const safeMessage = createTextSnippet(message, MAX_ERROR_MESSAGE_LENGTH);

    return createError(
      this.resolveAppErrorCode(fallbackCode, backendPayload) as ErrorCode,
      safeMessage.text,
      {
        module: 'http-client',
        operation,
        timestamp: Date.now(),
        cause: options?.cause,
        context: sanitizeDiagnosticContext({
          ...(backendPayload?.error ? { backendError: backendPayload.error } : {}),
          ...(backendPayload?.code !== undefined ? { backendCode: backendPayload.code } : {}),
          ...(backendPayload?.errors !== undefined ? { backendErrors: backendPayload.errors } : {}),
          ...(safeMessage.truncated
            ? {
                errorMessageLength: safeMessage.length,
                errorMessageTruncated: true,
              }
            : {}),
          ...options?.context,
        }),
      }
    );
  }

  private getErrorCode(status: number): ErrorCode {
    switch (status) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'AUTH_ERROR';
      case 403:
        return 'PERMISSION_ERROR';
      case 404:
        return 'NOT_FOUND_ERROR';
      case 408:
        return 'TIMEOUT_ERROR';
      case 409:
        return 'CONFLICT_ERROR';
      case 413:
        return 'FILE_SIZE_ERROR';
      case 422:
        return 'VALIDATION_ERROR';
      case 429:
        return 'RATE_LIMIT_ERROR';
      default:
        return status >= 500 ? 'UNKNOWN_ERROR' : 'NETWORK_ERROR';
    }
  }

  private isUnauthorizedError(error: AppError, config?: RequestConfig): boolean {
    if (config?.skipAuthRefresh) {
      return false;
    }

    return error.code === 'AUTH_ERROR';
  }

  private shouldRetryWithRefresh(method: string): boolean {
    return method !== 'UPLOAD';
  }

  private async handleAuthRefreshFailure(error: AppError): Promise<void> {
    if (error.context?.refreshFailureHandled === true) {
      return;
    }

    if (!this.authLifecycleHandlers?.onAuthRefreshFailure) {
      this.clearAuthToken();
      return;
    }

    await this.authLifecycleHandlers.onAuthRefreshFailure(error);
  }

  private async runRefreshSingleFlight(): Promise<Result<RefreshAuthResult>> {
    if (!this.authLifecycleHandlers?.refreshAuth) {
      return {
        success: false,
        error: this.createStructuredError(
          'AUTH_ERROR',
          'Authentication refresh is not configured',
          'runRefreshSingleFlight',
        ),
      };
    }

    if (!this.refreshInFlight) {
      this.refreshInFlight = this.authLifecycleHandlers.refreshAuth().finally(() => {
        this.refreshInFlight = null;
      });
    }

    const refreshResult = await this.refreshInFlight;

    if (refreshResult.success) {
      this.setAuthToken(refreshResult.data.accessToken);
      return refreshResult;
    }

    await this.handleAuthRefreshFailure(refreshResult.error);
    return refreshResult;
  }

  private async executeWithAutoRefresh<T>(
    operation: string,
    method: string,
    execute: () => Promise<Result<T>>,
    config?: RequestConfig
  ): Promise<Result<T>> {
    const initialResult = await execute();

    if (initialResult.success) {
      return initialResult;
    }

    if (!this.shouldRetryWithRefresh(method) || !this.isUnauthorizedError(initialResult.error, config)) {
      return initialResult;
    }

    log.warn(operation, 'Received 401, attempting token refresh');
    const refreshResult = await this.runRefreshSingleFlight();

    if (!refreshResult.success) {
      return { success: false, error: refreshResult.error };
    }

    return execute();
  }

  private async parseApiResponse<T>(response: Response, operation: string): Promise<Result<T>> {
    if (!response.ok) {
      const errorBody = await response.text();
      const backendPayload = this.parseErrorPayload(errorBody);
      const errorMessage = backendPayload?.message ?? `HTTP Error: ${response.status}`;
      const error = this.createStructuredError(
        this.getErrorCode(response.status),
        errorMessage,
        operation,
        {
          backendPayload,
          context: {
            status: response.status,
            statusText: response.statusText,
            ...createBodyDiagnostics(errorBody),
          },
        },
      );

      const safeLogMessage = createTextSnippet(errorMessage, MAX_ERROR_MESSAGE_LENGTH);
      log.error(operation, `HTTP ${response.status}: ${safeLogMessage.text}`);
      return { success: false, error };
    }

    try {
      const json = await response.json() as ApiResponse<T> & {
        error?: string;
        errors?: unknown;
      };

      if (json.code !== 0 && json.code !== 200) {
        const bodyText = JSON.stringify(json);
        const error = this.createStructuredError(
          'UNKNOWN_ERROR',
          json.message || 'API Error',
          operation,
          {
            backendPayload: {
              code: json.code,
              error: getNonEmptyString(json.error),
              message: getNonEmptyString(json.message),
              errors: json.errors,
            },
            context: {
              code: json.code,
              ...createBodyDiagnostics(bodyText),
            },
          },
        );

        return { success: false, error };
      }

      return { success: true, data: json.data };
    } catch (error) {
      return {
        success: false,
        error: this.createStructuredError(
          'UNKNOWN_ERROR',
          'Failed to parse response',
          operation,
          {
            cause: error instanceof Error ? error : undefined,
          },
        ),
      };
    }
  }

  private async executeFetch(
    method: string,
    path: string,
    config?: RawRequestConfig
  ): Promise<Result<Response>> {
    const url = this.buildURL(path, config?.params);
    const requestDiagnostics = this.buildRequestDiagnostics(method, path, url);

    const operation = method.toLowerCase();
    log.debug(operation, `${method} ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config?.timeout ?? this.config.timeout
    );

    const buildRequestHeaders = (): Record<string, string> => {
      const headers = this.buildHeaders(config?.headers);

      if (config?.contentType === null) {
        delete headers['Content-Type'];
      } else if (typeof config?.contentType === 'string') {
        headers['Content-Type'] = config.contentType;
      }

      return headers;
    };

    const execute = async (): Promise<Result<Response>> => {
      try {
        const response = await fetch(url, {
          method,
          headers: buildRequestHeaders(),
          body: config?.body,
          signal: config?.signal ?? controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          const backendPayload = this.parseErrorPayload(errorBody);
          const errorMessage = backendPayload?.message ?? `HTTP Error: ${response.status}`;
          return {
            success: false,
            error: this.createStructuredError(
              this.getErrorCode(response.status),
              errorMessage,
              operation,
              {
                backendPayload,
                context: {
                  status: response.status,
                  statusText: response.statusText,
                  ...createBodyDiagnostics(errorBody),
                  ...requestDiagnostics,
                },
              },
            ),
          };
        }

        return { success: true, data: response };
      } catch (error) {
        const isAbortError =
          error instanceof DOMException && error.name === 'AbortError';
        return {
          success: false,
          error: this.createStructuredError(
            isAbortError ? 'TIMEOUT_ERROR' : 'NETWORK_ERROR',
            isAbortError
              ? 'Request timed out'
              : error instanceof Error ? error.message : 'Network request failed',
            operation,
            {
              cause: error instanceof Error ? error : undefined,
              context: {
                ...requestDiagnostics,
              },
            },
          ),
        };
      }
    };

    try {
      return await this.executeWithAutoRefresh<Response>(operation, method, execute, config);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async requestRaw(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    config?: RawRequestConfig
  ): Promise<Result<Response>> {
    return tryCatchAsync(async () => {
      const result = await this.executeFetch(method, path, config);
      if (!result.success) {
        throw result.error;
      }

      return result.data;
    }, 'http-client', 'requestRaw');
  }

  async get<T>(
    path: string,
    params?: Record<string, unknown>,
    config?: RequestConfig
  ): Promise<Result<T>> {
    try {
      const responseResult = await this.executeFetch('GET', path, {
        ...config,
        params,
      });

      if (!responseResult.success) {
        return {
          success: false,
          error: config?.suppressErrorLog
            ? responseResult.error
            : handleError(responseResult.error, 'http-client', 'get'),
        };
      }

      const parsed = await this.parseApiResponse<T>(responseResult.data, 'get');
      if (!parsed.success) {
        return {
          success: false,
          error: config?.suppressErrorLog
            ? parsed.error
            : handleError(parsed.error, 'http-client', 'get'),
        };
      }

      return { success: true, data: parsed.data };
    } catch (error) {
      return { success: false, error: handleError(error, 'http-client', 'get') };
    }
  }

  async post<T>(
    path: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<Result<T>> {
    return tryCatchAsync(async () => {
      const body = data === undefined ? undefined : JSON.stringify(data);
      const responseResult = await this.executeFetch('POST', path, {
        ...config,
        body,
      });

      if (!responseResult.success) {
        throw responseResult.error;
      }

      const parsed = await this.parseApiResponse<T>(responseResult.data, 'post');
      if (!parsed.success) {
        throw parsed.error;
      }

      return parsed.data;
    }, 'http-client', 'post');
  }

  async put<T>(
    path: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<Result<T>> {
    return tryCatchAsync(async () => {
      const body = data === undefined ? undefined : JSON.stringify(data);
      const responseResult = await this.executeFetch('PUT', path, {
        ...config,
        body,
      });

      if (!responseResult.success) {
        throw responseResult.error;
      }

      const parsed = await this.parseApiResponse<T>(responseResult.data, 'put');
      if (!parsed.success) {
        throw parsed.error;
      }

      return parsed.data;
    }, 'http-client', 'put');
  }

  async patch<T>(
    path: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<Result<T>> {
    return tryCatchAsync(async () => {
      const body = data === undefined ? undefined : JSON.stringify(data);
      const responseResult = await this.executeFetch('PATCH', path, {
        ...config,
        body,
      });

      if (!responseResult.success) {
        throw responseResult.error;
      }

      const parsed = await this.parseApiResponse<T>(responseResult.data, 'patch');
      if (!parsed.success) {
        throw parsed.error;
      }

      return parsed.data;
    }, 'http-client', 'patch');
  }

  async delete<T>(
    path: string,
    config?: RequestConfig
  ): Promise<Result<T>> {
    return tryCatchAsync(async () => {
      const responseResult = await this.executeFetch('DELETE', path, config);

      if (!responseResult.success) {
        throw responseResult.error;
      }

      const parsed = await this.parseApiResponse<T>(responseResult.data, 'delete');
      if (!parsed.success) {
        throw parsed.error;
      }

      return parsed.data;
    }, 'http-client', 'delete');
  }

  async getBlob(
    path: string,
    params?: Record<string, unknown>,
    config?: RequestConfig
  ): Promise<Result<Blob>> {
    return tryCatchAsync(async () => {
      const responseResult = await this.executeFetch('GET', path, {
        ...config,
        params,
      });

      if (!responseResult.success) {
        throw responseResult.error;
      }

      return responseResult.data.blob();
    }, 'http-client', 'getBlob');
  }

  async upload<T>(
    path: string,
    file: File,
    onProgress?: (progress: number) => void,
    _config?: RequestConfig
  ): Promise<Result<T>> {
    return tryCatchAsync(async () => {
      const url = this.buildURL(path);
      log.debug('upload', `UPLOAD ${url}`, { fileName: file.name, fileSize: file.size });

      return new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress((event.loaded / event.total) * 100);
          }
        });

        xhr.addEventListener('load', () => {
          const backendPayload = this.parseErrorPayload(xhr.responseText);

          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText) as ApiResponse<T> & {
                error?: string;
                errors?: unknown;
              };

              if (response.code === 0 || response.code === 200) {
                resolve(response.data);
                return;
              }

              reject(this.createStructuredError(
                'UPLOAD_ERROR',
                response.message || 'Upload failed',
                'upload',
                {
                  backendPayload: {
                    code: response.code,
                    error: getNonEmptyString(response.error),
                    message: getNonEmptyString(response.message),
                    errors: response.errors,
                  },
                  context: {
                    status: xhr.status,
                    statusText: xhr.statusText,
                    ...createBodyDiagnostics(xhr.responseText),
                  },
                },
              ));
            } catch {
              reject(this.createStructuredError(
                'UNKNOWN_ERROR',
                'Failed to parse upload response',
                'upload',
                {
                  context: {
                    status: xhr.status,
                    statusText: xhr.statusText,
                    ...createBodyDiagnostics(xhr.responseText),
                  },
                },
              ));
            }

            return;
          }

          reject(this.createStructuredError(
            'UPLOAD_ERROR',
            backendPayload?.message ?? `Upload failed with status ${xhr.status}`,
            'upload',
            {
              backendPayload,
              context: {
                status: xhr.status,
                statusText: xhr.statusText,
                ...createBodyDiagnostics(xhr.responseText),
              },
            },
          ));
        });

        xhr.addEventListener('error', () => {
          reject(this.createStructuredError(
            'UPLOAD_ERROR',
            'Upload network error',
            'upload',
            {
              context: {
                status: xhr.status,
                statusText: xhr.statusText,
              },
            },
          ));
        });

        xhr.addEventListener('abort', () => {
          reject(this.createStructuredError(
            'UPLOAD_ERROR',
            'Upload aborted',
            'upload',
            {
              context: {
                status: xhr.status,
                statusText: xhr.statusText,
              },
            },
          ));
        });

        xhr.open('POST', url);

        if (this.authToken) {
          xhr.setRequestHeader('Authorization', `Bearer ${this.authToken}`);
        }

        const formData = new FormData();
        formData.append('file', file);

        xhr.send(formData);
      });
    }, 'http-client', 'upload');
  }
}

export const httpClient = new HttpClient();

export function createHttpClient(config: Partial<HttpClientConfig>): HttpClient {
  return new HttpClient(config);
}
