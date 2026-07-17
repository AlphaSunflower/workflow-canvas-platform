import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LaozhangVeoClient } from "./laozhang-veo.client.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("LaozhangVeoClient creates video task with official multipart requests and parses query/content/download", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "laozhang-veo-client-test-"));

  try {
    const requests: Array<{
      url: string;
      method?: string;
      headers: Record<string, string>;
      bodyType: string;
      formValues: Record<string, string[]>;
      fileFields: string[];
    }> = [];
    const client = new LaozhangVeoClient({
      apiKey: "sk-test",
      apiBaseUrl: "https://example.test/v1",
      snapshotDir: rootDir,
      fetchImpl: async (input, init) => {
        const url = String(input);
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const formValues: Record<string, string[]> = {};
        const fileFields: string[] = [];
        if (init?.body instanceof FormData) {
          for (const [key, value] of init.body.entries()) {
            if (typeof value === "string") {
              formValues[key] = [...(formValues[key] ?? []), value];
            } else {
              fileFields.push(key);
            }
          }
        }
        requests.push({
          url,
          method: init?.method,
          headers,
          bodyType: init?.body instanceof FormData ? "form-data" : typeof init?.body,
          formValues,
          fileFields,
        });

        if (url.endsWith("/videos") && init?.method === "POST" && init?.body instanceof FormData) {
          return createJsonResponse({
            id: requests.length === 1 ? "video-task-1" : "video-task-2",
            object: "video",
            status: "queued",
            progress: 0,
            created_at: 1779283975,
            model: "veo-3.1-fast-generate-preview",
          });
        }

        if (url.endsWith("/videos/video-task-1")) {
          return createJsonResponse({
            id: "video-task-1",
            object: "video",
            status: "completed",
            progress: 100,
            created_at: 1779283975,
            completed_at: 1779284026,
            model: "veo-3.1-fast-generate-preview",
            video_url: "https://cdn.example.test/video-task-1.mp4",
          });
        }

        if (url.endsWith("/videos/video-task-1/content")) {
          return createJsonResponse({
            id: "video-task-1",
            object: "video",
            status: "completed",
            model: "veo-3.1-fast-generate-preview",
            url: "https://cdn.example.test/video-task-1.mp4",
            duration: 8,
            resolution: "1920x1080",
          });
        }

        if (url === "https://cdn.example.test/video-task-1.mp4") {
          return new Response(new Blob([Buffer.from("video-binary")], { type: "video/mp4" }), {
            status: 200,
            headers: {
              "Content-Type": "video/mp4",
            },
          });
        }

        return createJsonResponse({ error: { message: "unexpected request" } }, 500);
      },
    });

    const multipartResult = await client.createVideoTask({
      prompt: "A cinematic product shot",
      model: "veo-3.1-fast-generate-preview",
      inputReferences: [
        {
          fileName: "ref-1.png",
          mimeType: "image/png",
          buffer: Buffer.from("ref-1"),
        },
        {
          fileName: "ref-2.png",
          mimeType: "image/png",
          buffer: Buffer.from("ref-2"),
        },
      ],
      snapshotLabel: "create-multipart",
    });
    const jsonResult = await client.createVideoTask({
      prompt: "A cinematic product shot",
      model: "veo-3.1-generate-preview",
      duration: 8,
      aspectRatio: "16:9",
      resolution: "4k",
      size: "3840x2160",
      metadata: JSON.stringify({
        durationSeconds: 8,
        resolution: "4k",
        aspectRatio: "16:9",
      }),
      inputReferences: [],
      snapshotLabel: "create-4k",
    });
    const statusResult = await client.getVideoTask({
      videoId: "video-task-1",
      snapshotLabel: "query-status",
    });
    const contentResult = await client.getVideoContent({
      videoId: "video-task-1",
      snapshotLabel: "query-content",
    });
    const downloadResult = await client.downloadVideo({
      url: "https://cdn.example.test/video-task-1.mp4",
      snapshotLabel: "download-video",
    });

    assert.equal(multipartResult.id, "video-task-1");
    assert.equal(jsonResult.id, "video-task-2");
    assert.equal(multipartResult.createdAt, 1779283975);
    assert.equal(multipartResult.progress, 0);
    assert.equal(statusResult.status, "completed");
    assert.equal(statusResult.progress, 100);
    assert.equal(statusResult.completedAt, 1779284026);
    assert.equal(statusResult.videoUrl, "https://cdn.example.test/video-task-1.mp4");
    assert.equal(contentResult.url, "https://cdn.example.test/video-task-1.mp4");
    assert.equal(contentResult.videoUrl, "https://cdn.example.test/video-task-1.mp4");
    assert.equal(contentResult.duration, 8);
    assert.equal(downloadResult.buffer.toString("utf8"), "video-binary");
    assert.equal(downloadResult.mimeType, "video/mp4");
    assert.equal(requests[0]?.bodyType, "form-data");
    assert.equal(requests[1]?.bodyType, "form-data");
    assert.equal(requests[0]?.headers.authorization, "Bearer sk-test");
    assert.equal(requests[0]?.headers["content-type"], undefined);
    assert.deepEqual(requests[0]?.formValues, {
      model: ["veo-3.1-fast-generate-preview"],
      prompt: ["A cinematic product shot"],
      seconds: ["8"],
      duration: ["8"],
      size: ["1280x720"],
      resolution: ["720p"],
      aspectRatio: ["16:9"],
      referenceType: ["asset"],
    });
    assert.deepEqual(requests[0]?.fileFields, ["referenceImages", "referenceImages"]);
    assert.deepEqual(requests[1]?.formValues, {
      model: ["veo-3.1-generate-preview"],
      prompt: ["A cinematic product shot"],
      seconds: ["8"],
      duration: ["8"],
      size: ["3840x2160"],
      resolution: ["4k"],
      aspectRatio: ["16:9"],
      metadata: [JSON.stringify({
        durationSeconds: 8,
        resolution: "4k",
        aspectRatio: "16:9",
      })],
    });
    assert.deepEqual(requests[1]?.fileFields, []);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("LaozhangVeoClient maps provider validation, rate limit and invalid response errors", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "laozhang-veo-client-error-test-"));

  try {
    const client = new LaozhangVeoClient({
      apiKey: "sk-test",
      apiBaseUrl: "https://example.test/v1",
      snapshotDir: rootDir,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/videos")) {
          return createJsonResponse({
            error: {
              code: "too_many_requests",
              message: "rate limited",
            },
          }, 429);
        }

        return createJsonResponse({
          id: "video-task-1",
          status: "completed",
        });
      },
    });

    await assert.rejects(
      () => client.createVideoTask({
        prompt: "   ",
        model: "veo-3.1-fast-generate-preview",
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "VALIDATION_ERROR");
        return true;
      },
    );

    await assert.rejects(
      () => client.createVideoTask({
        prompt: "ok",
        model: "veo-3.1-fast-generate-preview",
        inputReferences: [
          {
            fileName: "ref-1.png",
            mimeType: "image/png",
            buffer: Buffer.from("1"),
          },
          {
            fileName: "ref-2.png",
            mimeType: "image/png",
            buffer: Buffer.from("2"),
          },
          {
            fileName: "ref-3.png",
            mimeType: "image/png",
            buffer: Buffer.from("3"),
          },
        ],
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "VALIDATION_ERROR");
        return true;
      },
    );

    await assert.rejects(
      () => client.createVideoTask({
        prompt: "ok",
        model: "veo-3.1-fast-generate-preview",
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "PROVIDER_ERROR");
        assert.equal((error as { providerCode?: string }).providerCode, "429");
        return true;
      },
    );

    const invalidResponseClient = new LaozhangVeoClient({
      apiKey: "sk-test",
      apiBaseUrl: "https://example.test/v1",
      snapshotDir: rootDir,
      fetchImpl: async () => createJsonResponse({
        status: "completed",
      }),
    });

    await assert.rejects(
      () => invalidResponseClient.getVideoTask({
        videoId: "task-without-id",
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_RESPONSE");
        return true;
      },
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("LaozhangVeoClient accepts direct mp4 bytes from video content endpoint", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "laozhang-veo-client-inline-content-test-"));

  try {
    const client = new LaozhangVeoClient({
      apiKey: "sk-test",
      apiBaseUrl: "https://example.test/v1",
      snapshotDir: rootDir,
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.endsWith("/videos/video-task-1/content")) {
          return new Response(new Blob([Buffer.from("inline-video-binary")], { type: "video/mp4" }), {
            status: 200,
            headers: {
              "Content-Type": "video/mp4",
            },
          });
        }

        return createJsonResponse({ error: { message: "unexpected request" } }, 500);
      },
    });

    const contentResult = await client.getVideoContent({
      videoId: "video-task-1",
      snapshotLabel: "query-inline-content",
    });

    assert.equal(contentResult.id, "video-task-1");
    assert.equal(contentResult.url, null);
    assert.equal(contentResult.videoUrl, null);
    assert.equal(contentResult.video?.mimeType, "video/mp4");
    assert.equal(contentResult.video?.buffer.toString("utf8"), "inline-video-binary");
    assert.equal(contentResult.video?.size, Buffer.byteLength("inline-video-binary"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("LaozhangVeoClient accepts video_url in content payloads", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "laozhang-veo-client-content-url-test-"));

  try {
    const client = new LaozhangVeoClient({
      apiKey: "sk-test",
      apiBaseUrl: "https://example.test/v1",
      snapshotDir: rootDir,
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.endsWith("/videos/video-task-2/content")) {
          return createJsonResponse({
            id: "video-task-2",
            object: "video",
            status: "completed",
            model: "veo-3.1-fast-generate-preview",
            video_url: "https://cdn.example.test/video-task-2.mp4",
          });
        }

        return createJsonResponse({ error: { message: "unexpected request" } }, 500);
      },
    });

    const contentResult = await client.getVideoContent({
      videoId: "video-task-2",
      snapshotLabel: "query-content-video-url",
    });

    assert.equal(contentResult.id, "video-task-2");
    assert.equal(contentResult.url, "https://cdn.example.test/video-task-2.mp4");
    assert.equal(contentResult.videoUrl, "https://cdn.example.test/video-task-2.mp4");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
