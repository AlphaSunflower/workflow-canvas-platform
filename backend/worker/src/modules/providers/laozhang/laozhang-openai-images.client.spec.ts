import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LaozhangOpenAIImagesClient } from "./laozhang-openai-images.client.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "laozhang-openai-images-client-test-"));

  try {
    await runOfficialGenerateBase64Scenario(rootDir);
    await runOfficialGenerateUrlScenario(rootDir);
    await runMissingKeyScenario(rootDir);
    await runInvalidOfficialResponseSnapshotDiagnosticsScenario(rootDir);
    await runNetworkDiagnosticsScenario(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runOfficialGenerateBase64Scenario(rootDir: string): Promise<void> {
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    contentType: string | null;
    payload: Record<string, unknown>;
  }> = [];

  const client = new LaozhangOpenAIImagesClient({
    apiKey: "sk-official-test",
    apiBaseUrl: "https://sora2official.example.test/v1/",
    snapshotDir: rootDir,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        contentType: (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ?? null,
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });

      return createJsonResponse({
        data: [
          {
            b64_json: "b2ZmaWNpYWwtYmFzZTY0LWltYWdl",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "official prompt",
    size: "auto",
    quality: "high",
    snapshotLabel: "official-base64",
  });

  assert.equal(result.imageBase64, "b2ZmaWNpYWwtYmFzZTY0LWltYWdl");
  assert.equal(result.mimeType, "image/png");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://sora2official.example.test/v1/images/generations");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.authorization, "Bearer sk-official-test");
  assert.equal(requests[0]?.contentType, "application/json");
  assert.deepEqual(requests[0]?.payload, {
    model: "gpt-image-2",
    prompt: "official prompt",
    size: "auto",
    quality: "high",
  });

  const snapshotRaw = await fs.readFile(result.snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as {
    provider: string;
    request: {
      headers: Record<string, string>;
      payload: Record<string, unknown>;
    };
  };

  assert.equal(snapshot.provider, "laozhang-sora2official");
  assert.equal(snapshot.request.headers.Authorization, "Bearer ***");
  assert.deepEqual(snapshot.request.payload, {
    model: "gpt-image-2",
    prompt: "official prompt",
    size: "auto",
    quality: "high",
  });
}

async function runOfficialGenerateUrlScenario(rootDir: string): Promise<void> {
  const calledUrls: string[] = [];
  const client = new LaozhangOpenAIImagesClient({
    apiKey: "sk-official-test",
    apiBaseUrl: "https://sora2official.example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (input, init) => {
      const url = String(input);
      calledUrls.push(url);

      if (url.endsWith("/images/generations")) {
        assert.equal(init?.method, "POST");
        return createJsonResponse({
          data: [
            {
              url: "https://cdn.example.test/generated/result.webp",
            },
          ],
        });
      }

      assert.equal(url, "https://cdn.example.test/generated/result.webp");
      assert.equal(init?.method, "GET");
      return new Response(Buffer.from("official-downloaded-image"), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
        },
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "url prompt",
    size: "2048x1152",
    quality: "auto",
    snapshotLabel: "official-url",
  });

  assert.deepEqual(calledUrls, [
    "https://sora2official.example.test/v1/images/generations",
    "https://cdn.example.test/generated/result.webp",
  ]);
  assert.equal(result.mimeType, "image/webp");
  assert.equal(
    Buffer.from(result.imageBase64, "base64").toString("utf8"),
    "official-downloaded-image",
  );
}

async function runMissingKeyScenario(rootDir: string): Promise<void> {
  const client = new LaozhangOpenAIImagesClient({
    apiKey: null,
    apiBaseUrl: "https://sora2official.example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async () => createJsonResponse({}),
  });

  await assert.rejects(
    () =>
      client.generateImage({
        model: "gpt-image-2",
        prompt: "missing key",
        size: "auto",
        quality: "auto",
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "VALIDATION_ERROR"
        && String((error as { message?: string }).message).includes("LAOZHANG_SORA2OFFICIAL_API_KEY"),
      ),
  );
}

async function runInvalidOfficialResponseSnapshotDiagnosticsScenario(rootDir: string): Promise<void> {
  const rawResponse = JSON.stringify({
    data: [
      {
        revised_prompt: "no image payload",
      },
    ],
    providerDebug: "unsupported response shape",
  });

  const client = new LaozhangOpenAIImagesClient({
    apiKey: "sk-official-test",
    apiBaseUrl: "https://sora2official.example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async () =>
      new Response(rawResponse, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
  });

  let capturedError: {
    code?: string;
    details?: Record<string, unknown>;
  } | null = null;

  try {
    await client.generateImage({
      model: "gpt-image-2",
      prompt: "invalid official diagnostics",
      size: "auto",
      quality: "auto",
      snapshotLabel: "official-invalid-diagnostics",
    });
  } catch (error) {
    capturedError = error as {
      code?: string;
      details?: Record<string, unknown>;
    };
  }

  assert.equal(capturedError?.code, "INVALID_RESPONSE");
  assert.equal(capturedError.details?.phase, "parse-response");
  assert.equal(capturedError.details?.httpStatus, 200);
  assert.equal(capturedError.details?.responseBodyBytes, Buffer.byteLength(rawResponse, "utf8"));
  assert.equal(capturedError.details?.responseBody, rawResponse);
  assert.equal(typeof capturedError.details?.snapshotPath, "string");

  const snapshotRaw = await fs.readFile(String(capturedError.details?.snapshotPath), "utf8");
  const snapshot = JSON.parse(snapshotRaw) as {
    response: {
      responseText: string;
    };
  };
  assert.equal(snapshot.response.responseText, rawResponse);
}

async function runNetworkDiagnosticsScenario(rootDir: string): Promise<void> {
  const cause = new Error("Headers Timeout Error") as Error & { code?: string };
  cause.code = "UND_ERR_HEADERS_TIMEOUT";
  const client = new LaozhangOpenAIImagesClient({
    apiKey: "sk-official-test",
    apiBaseUrl: "https://sora2official.example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async () => {
      throw new TypeError("fetch failed", {
        cause,
      });
    },
  });

  await assert.rejects(
    () =>
      client.generateImage({
        model: "gpt-image-2",
        prompt: "network diagnostics",
        size: "auto",
        quality: "auto",
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "NETWORK_ERROR",
      )
      && (error as { details?: Record<string, unknown> }).details?.apiUrl
        === "https://sora2official.example.test/v1/images/generations"
      && (error as { details?: Record<string, unknown> }).details?.phase === "fetch"
      && (error as { details?: Record<string, unknown> }).details?.causeCode === "UND_ERR_HEADERS_TIMEOUT"
      && (error as { details?: Record<string, unknown> }).details?.timeoutMs === 1_200_000,
  );
}

void run();
