import assert from "node:assert/strict";
import http from "node:http";
import type { Socket } from "node:net";

import { createLaozhangLongTimeoutFetch } from "./laozhang-long-timeout-fetch.ts";

async function createServer(
  handler: http.RequestListener,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  const sockets = new Set<Socket>();

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function runReceivesDelayedHeadersScenario(): Promise<void> {
  const server = await createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ ok: true }));
    }, 25);
  });

  try {
    const fetchImpl = createLaozhangLongTimeoutFetch();
    const response = await fetchImpl(`${server.baseUrl}/slow-headers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "slow" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await server.close();
  }
}

async function runSupportsMultipartFormDataScenario(): Promise<void> {
  let contentType = "";
  let requestBody = "";

  const server = await createServer((request, response) => {
    contentType = String(request.headers["content-type"] ?? "");
    request.on("data", (chunk: Buffer) => {
      requestBody += chunk.toString("utf8");
    });
    request.on("end", () => {
      response.writeHead(200, {
        "Content-Type": "text/plain",
      });
      response.end("ok");
    });
  });

  try {
    const formData = new FormData();
    formData.append("model", "gpt-image-2-vip");
    formData.append("prompt", "multipart prompt");
    formData.append(
      "image[]",
      new Blob([Buffer.from("image-bytes")], { type: "image/png" }),
      "image-1.png",
    );

    const fetchImpl = createLaozhangLongTimeoutFetch();
    const response = await fetchImpl(`${server.baseUrl}/multipart`, {
      method: "POST",
      body: formData,
    });

    assert.equal(await response.text(), "ok");
    assert.match(contentType, /^multipart\/form-data; boundary=/);
    assert.match(requestBody, /name="model"/);
    assert.match(requestBody, /gpt-image-2-vip/);
    assert.match(requestBody, /filename="image-1.png"/);
    assert.match(requestBody, /image-bytes/);
  } finally {
    await server.close();
  }
}

async function runAbortScenario(): Promise<void> {
  const server = await createServer((_request, _response) => {
    // Keep the request open until the caller aborts it.
  });

  try {
    const controller = new AbortController();
    const fetchImpl = createLaozhangLongTimeoutFetch();
    const request = fetchImpl(`${server.baseUrl}/abort`, {
      signal: controller.signal,
    });

    controller.abort();

    await assert.rejects(
      request,
      (error: unknown) =>
        error instanceof DOMException
        && error.name === "AbortError",
    );
  } finally {
    await server.close();
  }
}

async function runAbortBodyReadScenario(): Promise<void> {
  const server = await createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/plain",
    });
    response.write("partial");
  });

  try {
    const controller = new AbortController();
    const fetchImpl = createLaozhangLongTimeoutFetch();
    const response = await fetchImpl(`${server.baseUrl}/abort-body`, {
      signal: controller.signal,
    });

    controller.abort();

    await assert.rejects(
      response.text(),
      (error: unknown) =>
        error instanceof DOMException
        && error.name === "AbortError",
    );
  } finally {
    await server.close();
  }
}

async function run(): Promise<void> {
  await runReceivesDelayedHeadersScenario();
  await runSupportsMultipartFormDataScenario();
  await runAbortScenario();
  await runAbortBodyReadScenario();
}

void run();
