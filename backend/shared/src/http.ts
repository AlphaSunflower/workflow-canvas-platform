import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

const REQUEST_CONTEXT_KEY = Symbol("newworkflow.http.requestContext");

type RequestWithContext = IncomingMessage & {
  [REQUEST_CONTEXT_KEY]?: Map<string, unknown>;
};

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

export async function readJsonBody<T>(
  request: IncomingMessage,
  maxBytes = 25 * 1024 * 1024,
): Promise<T> {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of request) {
    const bufferChunk =
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    totalLength += bufferChunk.length;

    if (totalLength > maxBytes) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }

    chunks.push(bufferChunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (!rawBody) {
    return {} as T;
  }

  return JSON.parse(rawBody) as T;
}

export function ensureRequestContext(
  request: IncomingMessage,
): Map<string, unknown> {
  const requestWithContext = request as RequestWithContext;

  requestWithContext[REQUEST_CONTEXT_KEY] ??= new Map<string, unknown>();
  return requestWithContext[REQUEST_CONTEXT_KEY];
}

export function getRequestContextValue<T>(
  request: IncomingMessage,
  key: string,
): T | undefined {
  return ensureRequestContext(request).get(key) as T | undefined;
}

export function setRequestContextValue<T>(
  request: IncomingMessage,
  key: string,
  value: T | undefined,
): void {
  const context = ensureRequestContext(request);

  if (value === undefined) {
    context.delete(key);
    return;
  }

  context.set(key, value);
}

export function sendApiSuccess<T>(
  response: ServerResponse,
  data: T,
  statusCode = 200,
): void {
  sendJson(response, statusCode, {
    code: 0,
    message: "ok",
    data,
    timestamp: Date.now(),
  });
}

export function sendApiError(
  response: ServerResponse,
  statusCode: number,
  appCode: number,
  error: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  sendJson(response, statusCode, {
    code: appCode,
    error,
    message,
    ...(details ? { details } : {}),
    timestamp: Date.now(),
  });
}
