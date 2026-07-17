import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE,
} from "../shared/src/index.ts";
import { LaozhangClient } from "../worker/src/modules/providers/laozhang/laozhang.client.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "laozhang-client-test-"));

  try {
    await runGeminiSuccessScenario(rootDir);
    await runGeminiTextOnlyScenario(rootDir);
    await runGeminiSnakeCaseScenario(rootDir);
    await runGptSingleImageBase64Scenario(rootDir);
    await runGptTextOnlyBase64Scenario(rootDir);
    await runGptImage2ParameterlessTextOnlyScenario(rootDir);
    await runGptImage2ParameterlessEditScenario(rootDir);
    await runGptFourImageBase64Scenario(rootDir);
    await runGptFiveImageBase64Scenario(rootDir);
    await runGptUrlScenario(rootDir);
    await runGptImage2OfficialGenerateScenario(rootDir);
    await runProviderErrorScenario(rootDir);
    await runInvalidResponseScenario(rootDir);
    await runInvalidResponseSnapshotDiagnosticsScenario(rootDir);
    await runNetworkErrorScenario(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runGeminiTextOnlyScenario(rootDir: string): Promise<void> {
  const requests: Array<{
    payload: {
      generationConfig: {
        imageConfig: {
          imageSize: string;
          aspectRatio?: string;
        };
      };
      contents: Array<{
        parts: Array<Record<string, unknown>>;
      }>;
    };
  }> = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (_input, init) => {
      requests.push({
        payload: JSON.parse(String(init?.body)) as {
          generationConfig: {
            imageConfig: {
              imageSize: string;
              aspectRatio?: string;
            };
          };
          contents: Array<{
            parts: Array<Record<string, unknown>>;
          }>;
        },
      });

      return createJsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "Z2VtaW5pLXRleHQtb25seS1yZXN1bHQ=",
                  },
                },
              ],
            },
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gemini-3-pro-image-preview",
    prompt: "gemini text only prompt",
    imageSize: "2K",
    images: [],
    snapshotLabel: "gemini-text-only",
  });

  assert.equal(result.imageBase64, "Z2VtaW5pLXRleHQtb25seS1yZXN1bHQ=");
  assert.equal(result.mimeType, "image/png");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.payload.generationConfig.imageConfig.imageSize, "2K");
  assert.equal(requests[0]?.payload.contents[0]?.parts.length, 1);
  assert.deepEqual(requests[0]?.payload.contents[0]?.parts[0], {
    text: "gemini text only prompt",
  });
}

async function runGeminiSuccessScenario(rootDir: string): Promise<void> {
  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer sk-test",
      );
      assert.equal(
        (init?.headers as Record<string, string>)["Content-Type"],
        "application/json",
      );

      const payload = JSON.parse(String(init?.body)) as {
        generationConfig: {
          imageConfig: {
            imageSize: string;
            aspectRatio?: string;
          };
        };
        contents: Array<{
          parts: Array<Record<string, unknown>>;
        }>;
      };

      assert.equal(
        payload.generationConfig.imageConfig.imageSize,
        WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE,
      );
      assert.equal("aspectRatio" in payload.generationConfig.imageConfig, false);
      assert.equal(payload.contents[0]?.parts.length, 3);

      return createJsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "ZmFrZS1pbWFnZS1iYXNlNjQ=",
                  },
                },
              ],
            },
          },
        ],
      });
    },
  });

  const success = await client.generateImage({
    prompt: "test prompt",
    images: [
      {
        mimeType: "image/png",
        dataBase64: "aW1hZ2UtMQ==",
      },
      {
        mimeType: "image/jpeg",
        dataBase64: "aW1hZ2UtMg==",
      },
    ],
    snapshotLabel: "success-case",
  });

  assert.equal(success.imageBase64, "ZmFrZS1pbWFnZS1iYXNlNjQ=");
  assert.equal(success.mimeType, "image/png");
}

async function runGeminiSnakeCaseScenario(rootDir: string): Promise<void> {
  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async () =>
      createJsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: "c25ha2UtY2FzZS1pbWFnZQ==",
                  },
                },
              ],
            },
          },
        ],
      }),
  });

  const result = await client.generateImage({
    prompt: "snake case prompt",
    images: [
      {
        mimeType: "image/png",
        dataBase64: "aW1hZ2UtMQ==",
      },
    ],
    snapshotLabel: "snake-case",
  });

  assert.equal(result.imageBase64, "c25ha2UtY2FzZS1pbWFnZQ==");
  assert.equal(result.mimeType, "image/jpeg");
}

async function runGptSingleImageBase64Scenario(rootDir: string): Promise<void> {
  const requests: FormData[] = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (_input, init) => {
      requests.push(init?.body as FormData);

      return createJsonResponse({
        data: [
          {
            b64_json: "c2luZ2xlLWltYWdlLWdwdA==",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2-vip",
    prompt: "single image prompt",
    size: "1280x960",
    images: [
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("single-image-input").toString("base64"),
      },
    ],
    snapshotLabel: "gpt-single-image",
  });

  assert.equal(result.imageBase64, "c2luZ2xlLWltYWdlLWdwdA==");
  assert.equal(result.mimeType, "image/png");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.get("model"), "gpt-image-2-vip");
  assert.equal(requests[0]?.get("prompt"), "single image prompt");
  assert.equal(requests[0]?.get("size"), "1280x960");

  const images = requests[0]?.getAll("image[]") ?? [];
  assert.equal(images.length, 1);
  assert.equal((images[0] as File).name, "image-1.png");
}

async function runGptFourImageBase64Scenario(rootDir: string): Promise<void> {
  const requests: FormData[] = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (_input, init) => {
      requests.push(init?.body as FormData);

      return createJsonResponse({
        data: [
          {
            b64_json: "Zm91ci1pbWFnZS1ncHQtcmVzdWx0",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2-vip",
    prompt: "four image prompt",
    size: "2560x3216",
    images: [
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("styleReference").toString("base64"),
      },
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("lineart").toString("base64"),
      },
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("depth").toString("base64"),
      },
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("whiteModel").toString("base64"),
      },
    ],
    snapshotLabel: "gpt-four-image",
  });

  assert.equal(result.imageBase64, "Zm91ci1pbWFnZS1ncHQtcmVzdWx0");
  const images = requests[0]?.getAll("image[]") ?? [];
  assert.equal(images.length, 4);
  assert.deepEqual(
    images.map((item) => (item as File).name),
    ["image-1.png", "image-2.png", "image-3.png", "image-4.png"],
  );

  const snapshotRaw = await fs.readFile(result.snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as {
    request: {
      formDataEntries: Array<{ key: string; value: string }>;
    };
  };

  assert.deepEqual(snapshot.request.formDataEntries, [
    { key: "model", value: "gpt-image-2-vip" },
    { key: "prompt", value: "four image prompt" },
    { key: "size", value: "2560x3216" },
    { key: "image[]", value: "image-1.png" },
    { key: "image[]", value: "image-2.png" },
    { key: "image[]", value: "image-3.png" },
    { key: "image[]", value: "image-4.png" },
  ]);
}

async function runGptTextOnlyBase64Scenario(rootDir: string): Promise<void> {
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    contentType: string | null;
    payload: Record<string, unknown>;
  }> = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
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
            b64_json: "Z3B0LXRleHQtb25seS1yZXN1bHQ=",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2-vip",
    prompt: "gpt text only prompt",
    size: "1280x1280",
    images: [],
    snapshotLabel: "gpt-text-only",
  });

  assert.equal(result.imageBase64, "Z3B0LXRleHQtb25seS1yZXN1bHQ=");
  assert.equal(result.mimeType, "image/png");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/v1/images/generations");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.authorization, "Bearer sk-test");
  assert.equal(requests[0]?.contentType, "application/json");
  assert.deepEqual(requests[0]?.payload, {
    model: "gpt-image-2-vip",
    prompt: "gpt text only prompt",
    size: "1280x1280",
  });

  const snapshotRaw = await fs.readFile(result.snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as {
    request: {
      headers: Record<string, string>;
      payload: Record<string, unknown>;
    };
  };

  assert.equal(snapshot.request.headers.Authorization, "Bearer ***");
  assert.deepEqual(snapshot.request.payload, {
    model: "gpt-image-2-vip",
    prompt: "gpt text only prompt",
    size: "1280x1280",
  });
}

async function runGptImage2ParameterlessTextOnlyScenario(rootDir: string): Promise<void> {
  const requests: Array<{
    url: string;
    method: string;
    payload: Record<string, unknown>;
  }> = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method),
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });

      return createJsonResponse({
        data: [
          {
            b64_json: "Z3B0LWltYWdlLTItZGVmYXVsdA==",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "parameterless text prompt",
    images: [],
    snapshotLabel: "gpt-image-2-parameterless-text",
  });

  assert.equal(result.imageBase64, "Z3B0LWltYWdlLTItZGVmYXVsdA==");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/v1/images/generations");
  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(requests[0]?.payload, {
    model: "gpt-image-2",
    prompt: "parameterless text prompt",
  });
  assert.equal("size" in (requests[0]?.payload ?? {}), false);
  assert.equal("quality" in (requests[0]?.payload ?? {}), false);
}

async function runGptImage2ParameterlessEditScenario(rootDir: string): Promise<void> {
  const requests: Array<{
    url: string;
    method: string;
    formData: FormData | null;
  }> = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method),
        formData: init?.body instanceof FormData ? init.body : null,
      });

      return createJsonResponse({
        data: [
          {
            b64_json: "Z3B0LWltYWdlLTItZWRpdA==",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "parameterless edit prompt",
    images: [
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("image-1").toString("base64"),
      },
    ],
    snapshotLabel: "gpt-image-2-parameterless-edit",
  });

  assert.equal(result.imageBase64, "Z3B0LWltYWdlLTItZWRpdA==");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/v1/images/edits");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.formData?.get("model"), "gpt-image-2");
  assert.equal(requests[0]?.formData?.get("prompt"), "parameterless edit prompt");
  assert.equal(requests[0]?.formData?.has("size"), false);
  assert.equal(requests[0]?.formData?.has("quality"), false);
  assert.equal(requests[0]?.formData?.getAll("image[]").length, 1);
}

async function runGptFiveImageBase64Scenario(rootDir: string): Promise<void> {
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    formData?: FormData;
  }> = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        formData: init?.body instanceof FormData ? init.body : undefined,
      });

      return createJsonResponse({
        data: [
          {
            b64_json: "Z3B0LWJhc2U2NC1yZXN1bHQ=",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2-vip",
    prompt: "gpt prompt",
    size: "2048x1152",
    images: [
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("image-1").toString("base64"),
      },
      {
        mimeType: "image/jpeg",
        dataBase64: Buffer.from("image-2").toString("base64"),
      },
      {
        mimeType: "image/webp",
        dataBase64: Buffer.from("image-3").toString("base64"),
      },
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("image-4").toString("base64"),
      },
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("image-5").toString("base64"),
      },
    ],
    snapshotLabel: "gpt-base64",
  });

  assert.equal(result.imageBase64, "Z3B0LWJhc2U2NC1yZXN1bHQ=");
  assert.equal(result.mimeType, "image/png");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/v1/images/edits");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.authorization, "Bearer sk-test");

  const formData = requests[0]?.formData;
  assert.ok(formData);
  assert.equal(formData?.get("model"), "gpt-image-2-vip");
  assert.equal(formData?.get("prompt"), "gpt prompt");
  assert.equal(formData?.get("size"), "2048x1152");

  const images = formData?.getAll("image[]") ?? [];
  assert.equal(images.length, 5);
  assert.deepEqual(
    images.map((item) => (item as File).name),
    ["image-1.png", "image-2.jpg", "image-3.webp", "image-4.png", "image-5.png"],
  );
}

async function runGptUrlScenario(rootDir: string): Promise<void> {
  const calledUrls: string[] = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (input, init) => {
      const url = String(input);
      calledUrls.push(url);

      if (url.endsWith("/images/edits")) {
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
      return new Response(Buffer.from("downloaded-image"), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
        },
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2-vip",
    prompt: "url prompt",
    size: "1280x720",
    images: [
      {
        mimeType: "image/png",
        dataBase64: Buffer.from("image-1").toString("base64"),
      },
    ],
    snapshotLabel: "gpt-url",
  });

  assert.deepEqual(calledUrls, [
    "https://example.test/v1/images/edits",
    "https://cdn.example.test/generated/result.webp",
  ]);
  assert.equal(result.mimeType, "image/webp");
  assert.equal(
    Buffer.from(result.imageBase64, "base64").toString("utf8"),
    "downloaded-image",
  );
}

async function runGptImage2OfficialGenerateScenario(rootDir: string): Promise<void> {
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    payload: Record<string, unknown>;
  }> = [];

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    sora2OfficialApiKey: "sk-sora2official-test",
    sora2OfficialApiBaseUrl: "https://sora2official.example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });

      return createJsonResponse({
        data: [
          {
            b64_json: "bGFvemhhbmctb2ZmaWNpYWwtZ2VuZXJhdGlvbg==",
          },
        ],
      });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2-official",
    prompt: "official generate prompt",
    size: "auto",
    quality: "medium",
    images: [],
    snapshotLabel: "gpt-image-2-official-generate",
  });

  assert.equal(result.imageBase64, "bGFvemhhbmctb2ZmaWNpYWwtZ2VuZXJhdGlvbg==");
  assert.equal(result.mimeType, "image/png");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://sora2official.example.test/v1/images/generations");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.authorization, "Bearer sk-sora2official-test");
  assert.deepEqual(requests[0]?.payload, {
    model: "gpt-image-2",
    prompt: "official generate prompt",
    size: "auto",
    quality: "medium",
  });
  assert.equal(
    Object.values(requests[0]?.payload ?? {}).includes("gpt-image-2-official"),
    false,
  );
}

async function runProviderErrorScenario(rootDir: string): Promise<void> {
  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async () =>
      createJsonResponse(
        {
          error: {
            message: "provider unavailable",
          },
        },
        502,
      ),
  });

  await assert.rejects(
    () =>
      client.generateImage({
        prompt: "provider fail",
        images: [
          {
            mimeType: "image/png",
            dataBase64: "aW1hZ2UtMQ==",
          },
        ],
        snapshotLabel: "provider-error",
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "PROVIDER_ERROR"
        && (error as { providerCode?: string }).providerCode === "502",
      ),
  );
}

async function runInvalidResponseScenario(rootDir: string): Promise<void> {
  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async () =>
      createJsonResponse({
        candidates: [],
      }),
  });

  await assert.rejects(
    () =>
      client.generateImage({
        prompt: "invalid response",
        images: [
          {
            mimeType: "image/png",
            dataBase64: "aW1hZ2UtMQ==",
          },
        ],
        snapshotLabel: "invalid-response",
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "INVALID_RESPONSE",
      ),
  );
}

async function runInvalidResponseSnapshotDiagnosticsScenario(rootDir: string): Promise<void> {
  const rawResponse = JSON.stringify({
    unexpected: true,
    providerMessage: "schema was not recognized",
    payload: {
      detail: "keep this exact provider response for diagnostics",
    },
  });

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
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
      prompt: "invalid response diagnostics",
      images: [
        {
          mimeType: "image/png",
          dataBase64: "aW1hZ2UtMQ==",
        },
      ],
      snapshotLabel: "invalid-response-diagnostics",
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

async function runNetworkErrorScenario(rootDir: string): Promise<void> {
  const socketError = new Error("socket hang up") as Error & {
    code?: string;
    syscall?: string;
  };
  socketError.code = "ECONNRESET";
  socketError.syscall = "read";

  const client = new LaozhangClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/laozhang",
    openaiApiBaseUrl: "https://example.test/v1",
    snapshotDir: rootDir,
    fetchImpl: async () => {
      throw new TypeError("fetch failed", {
        cause: socketError,
      });
    },
  });

  await assert.rejects(
    () =>
      client.generateImage({
        prompt: "network error",
        images: [
          {
            mimeType: "image/png",
            dataBase64: "aW1hZ2UtMQ==",
          },
        ],
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "NETWORK_ERROR",
      )
      && (error as { details?: Record<string, unknown> }).details?.apiUrl === "https://example.test/laozhang"
      && (error as { details?: Record<string, unknown> }).details?.timeoutMs === 1_200_000
      && (error as { details?: Record<string, unknown> }).details?.phase === "fetch"
      && (error as { details?: Record<string, unknown> }).details?.method === "POST"
      && (error as { details?: Record<string, unknown> }).details?.errorName === "TypeError"
      && (error as { details?: Record<string, unknown> }).details?.causeCode === "ECONNRESET"
      && typeof (error as { details?: Record<string, unknown> }).details?.elapsedMs === "number",
  );
}

void run();
