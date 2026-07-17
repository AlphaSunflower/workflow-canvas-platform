import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";

const MAX_REDIRECTS = 20;

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function appendResponseHeaders(headers: http.IncomingHttpHeaders): Headers {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "undefined") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item);
      }
      continue;
    }

    result.set(key, value);
  }

  return result;
}

function buildOutboundHeaders(headers: Headers, body?: Buffer): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, key) => {
    result[key] = value;
  });

  if (body && !headers.has("content-length")) {
    result["content-length"] = String(body.byteLength);
  }

  return result;
}

function shouldDropRequestBodyForMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function shouldDropResponseBody(method: string, status: number): boolean {
  return method === "HEAD" || status === 204 || status === 304;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readRequestBody(request: Request): Promise<Buffer | undefined> {
  if (shouldDropRequestBodyForMethod(request.method) || !request.body) {
    return undefined;
  }

  return Buffer.from(await request.arrayBuffer());
}

async function requestWithNodeHttp(
  request: Request,
  redirectCount: number,
): Promise<Response> {
  if (request.signal.aborted) {
    throw createAbortError();
  }

  const url = new URL(request.url);
  const body = await readRequestBody(request);
  const transport = url.protocol === "https:" ? https : http;

  if (request.signal.aborted) {
    throw createAbortError();
  }

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    let activeIncoming: http.IncomingMessage | null = null;

    const cleanup = (): void => {
      request.signal.removeEventListener("abort", onAbort);
    };

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const settleResolve = (response: Response): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(response);
    };

    const clientRequest = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers: buildOutboundHeaders(request.headers, body),
      },
      (incoming) => {
        activeIncoming = incoming;
        incoming.on("error", (error) => {
          if (settled && request.signal.aborted) {
            return;
          }

          settleReject(error);
        });
        const status = incoming.statusCode ?? 599;
        const headers = appendResponseHeaders(incoming.headers);

        if (isRedirectStatus(status) && request.redirect !== "manual") {
          const location = headers.get("location");
          if (!location) {
            if (shouldDropResponseBody(request.method, status)) {
              cleanup();
            } else {
              incoming.once("close", cleanup);
              incoming.once("end", cleanup);
            }

            settleResolve(new Response(
              shouldDropResponseBody(request.method, status)
                ? null
                : (Readable.toWeb(incoming) as ReadableStream),
              {
                status,
                statusText: incoming.statusMessage,
                headers,
              },
            ));
            return;
          }

          incoming.resume();

          if (redirectCount >= MAX_REDIRECTS || request.redirect === "error") {
            settleReject(new TypeError("fetch failed: maximum redirects exceeded"));
            return;
          }

          const redirectedUrl = new URL(location, request.url);
          const redirectMethod =
            status === 303 || ((status === 301 || status === 302) && request.method === "POST")
              ? "GET"
              : request.method;

          cleanup();
          requestWithNodeHttp(
            new Request(redirectedUrl, {
              method: redirectMethod,
              headers: request.headers,
              body: redirectMethod === "GET" ? undefined : body,
              signal: request.signal,
              redirect: request.redirect,
            }),
            redirectCount + 1,
          ).then(resolve, reject);
          return;
        }

        if (shouldDropResponseBody(request.method, status)) {
          cleanup();
        } else {
          incoming.once("close", cleanup);
          incoming.once("end", cleanup);
        }

        settleResolve(new Response(
          shouldDropResponseBody(request.method, status)
            ? null
            : (Readable.toWeb(incoming) as ReadableStream),
          {
            status,
            statusText: incoming.statusMessage,
            headers,
          },
        ));
      },
    );

    const onAbort = (): void => {
      const abortError = createAbortError();
      activeIncoming?.destroy(abortError);
      clientRequest.removeAllListeners("error");
      clientRequest.on("error", () => {
        // The response body receives the AbortError through activeIncoming.
      });
      clientRequest.destroy(abortError);
      settleReject(abortError);
    };

    request.signal.addEventListener("abort", onAbort, { once: true });

    clientRequest.on("error", settleReject);

    if (request.signal.aborted) {
      onAbort();
      return;
    }

    if (body) {
      clientRequest.write(body);
    }

    clientRequest.end();
  });
}

export function createLaozhangLongTimeoutFetch(
  fallbackFetch: typeof fetch = fetch,
): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallbackFetch(input, init);
    }

    return requestWithNodeHttp(request, 0);
  }) as typeof fetch;
}
