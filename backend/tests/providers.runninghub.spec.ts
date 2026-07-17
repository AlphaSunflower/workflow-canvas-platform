import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RunningHubClient } from "../worker/src/modules/providers/runninghub/runninghub.client.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "runninghub-client-test-"));

  try {
    const observedUrls: string[] = [];
    const client = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async (input, init) => {
        const url = String(input);
        observedUrls.push(url);

        assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer rh-test-key");

        if (url.endsWith("/task/openapi/upload")) {
          assert.equal(init?.method, "POST");
          assert.ok(init?.body instanceof FormData);

          return createJsonResponse({
            code: 0,
            msg: "success",
            data: {
              fileName: "uploaded-image-name.png",
            },
          });
        }

        if (url.endsWith("/task/openapi/create")) {
          const payload = JSON.parse(String(init?.body)) as {
            apiKey: string;
            workflowId: string;
            nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }>;
          };

          assert.equal(payload.apiKey, "rh-test-key");
          assert.equal(payload.workflowId, "2014519004714508290");
          assert.deepEqual(payload.nodeInfoList, [
            {
              nodeId: "1",
              fieldName: "image",
              fieldValue: "uploaded-image-name.png",
            },
          ]);

          return createJsonResponse({
            code: 0,
            msg: "success",
            data: {
              netWssUrl: null,
              taskId: "1910246754753896450",
              clientId: "e825290b08ca2015b8f62f0bbdb5f5f6",
              taskStatus: "QUEUED",
              promptTips: "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"9\"], \"node_errors\": {}}",
            },
          });
        }

        if (url.endsWith("/openapi/v2/query")) {
          const payload = JSON.parse(String(init?.body)) as { taskId: string };
          assert.equal(payload.taskId, "1910246754753896450");

          return createJsonResponse({
            taskId: "1910246754753896450",
            status: "SUCCESS",
            clientId: "e825290b08ca2015b8f62f0bbdb5f5f6",
            promptTips: "{\"result\": true}",
            errorCode: null,
            errorMessage: null,
            results: [
              {
                fileUrl: "https://rh-images.example.com/result/output.ply",
                fileType: "ply",
                taskCostTime: 42,
                nodeId: "5",
              },
            ],
          });
        }

        if (url.endsWith("/task/openapi/status")) {
          const payload = JSON.parse(String(init?.body)) as {
            apiKey: string;
            taskId: string;
          };
          assert.equal(payload.apiKey, "rh-test-key");
          assert.equal(payload.taskId, "1910246754753896450");

          return createJsonResponse({
            code: 0,
            msg: "success",
            data: {
              taskId: "1910246754753896450",
              clientId: "e825290b08ca2015b8f62f0bbdb5f5f6",
              taskStatus: "RUNNING",
              progress: 60,
            },
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const uploadResult = await client.uploadFile({
      fileName: "input.png",
      mimeType: "image/png",
      fileBuffer: Buffer.from("fake-image-content"),
      snapshotLabel: "upload-case",
    });
    assert.equal(uploadResult.fileName, "uploaded-image-name.png");
    assert.ok(uploadResult.snapshotPath.endsWith(".json"));

    const createTaskResult = await client.createWorkflowTask({
      workflowId: "2014519004714508290",
      nodeInfoList: [
        {
          nodeId: "1",
          fieldName: "image",
          fieldValue: uploadResult.fileName,
        },
      ],
      snapshotLabel: "create-case",
    });
    assert.equal(createTaskResult.taskId, "1910246754753896450");
    assert.equal(createTaskResult.taskStatus, "QUEUED");
    assert.equal(createTaskResult.clientId, "e825290b08ca2015b8f62f0bbdb5f5f6");
    assert.equal(createTaskResult.promptTipsSummary?.parseStatus, "parsed");
    assert.equal(createTaskResult.promptTipsSummary?.result, true);
    assert.deepEqual(createTaskResult.promptTipsSummary?.outputsToExecute, ["9"]);
    assert.equal(createTaskResult.promptTipsSummary?.rawText, "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"9\"], \"node_errors\": {}}");

    const queryTaskResult = await client.queryTaskResultV2({
      taskId: createTaskResult.taskId,
      snapshotLabel: "query-result-case",
    });
    assert.equal(queryTaskResult.taskStatus, "SUCCESS");
    assert.equal(queryTaskResult.results.length, 1);
    assert.equal(queryTaskResult.results[0]?.fileType, "ply");
    assert.equal(queryTaskResult.results[0]?.nodeId, "5");

    const queryStatusResult = await client.queryTaskStatus({
      taskId: createTaskResult.taskId,
      snapshotLabel: "query-status-case",
    });
    assert.equal(queryStatusResult.taskStatus, "RUNNING");
    assert.equal(queryStatusResult.progress, 60);

    assert.deepEqual(observedUrls, [
      "https://example.test/task/openapi/upload",
      "https://example.test/task/openapi/create",
      "https://example.test/openapi/v2/query",
      "https://example.test/task/openapi/status",
    ]);

    const snapshotFiles = await fs.readdir(rootDir);
    assert.equal(snapshotFiles.length, 4);

    const providerErrorClient = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async () =>
        createJsonResponse({
          code: 40001,
          msg: "invalid workflow",
        }),
    });

    await assert.rejects(
      () =>
        providerErrorClient.createWorkflowTask({
          workflowId: "bad-workflow",
          nodeInfoList: [
            {
              nodeId: "1",
              fieldName: "image",
              fieldValue: "file.png",
            },
          ],
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "PROVIDER_ERROR"
          && (error as { providerCode?: string }).providerCode === "40001",
        ),
    );

    const backpressureClient = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async () =>
        createJsonResponse({
          code: 42901,
          msg: "task_queue_maxed",
        }),
    });

    await assert.rejects(
      () =>
        backpressureClient.createWorkflowTask({
          workflowId: "2014519004714508290",
          nodeInfoList: [
            {
              nodeId: "1",
              fieldName: "image",
              fieldValue: "file.png",
            },
          ],
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "PROVIDER_ERROR"
          && (error as { providerCode?: string }).providerCode === "task_queue_maxed"
          && (error as { details?: Record<string, unknown> }).details?.backpressure === true,
        ),
    );

    const httpBackpressureClient = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async () =>
        createJsonResponse(
          {
            code: 42901,
            msg: "task_queue_maxed",
          },
          429,
        ),
    });

    await assert.rejects(
      () =>
        httpBackpressureClient.createWorkflowTask({
          workflowId: "2014519004714508290",
          nodeInfoList: [
            {
              nodeId: "1",
              fieldName: "image",
              fieldValue: "file.png",
            },
          ],
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "PROVIDER_ERROR"
          && (error as { providerCode?: string }).providerCode === "task_queue_maxed"
          && (error as { details?: Record<string, unknown> }).details?.backpressure === true
          && (error as { details?: Record<string, unknown> }).details?.httpStatus === 429,
        ),
    );

    const invalidResponseClient = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async () =>
        createJsonResponse({
          code: 0,
          msg: "success",
          data: {},
        }),
    });

    await assert.rejects(
      () =>
        invalidResponseClient.createWorkflowTask({
          workflowId: "2014519004714508290",
          nodeInfoList: [
            {
              nodeId: "1",
              fieldName: "image",
              fieldValue: "file.png",
            },
          ],
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "INVALID_RESPONSE",
        ),
    );

    const networkErrorClient = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await assert.rejects(
      () =>
        networkErrorClient.queryTaskResultV2({
          taskId: "1910246754753896450",
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "NETWORK_ERROR",
        ),
    );

    const invalidPromptTipsClient = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async () =>
        createJsonResponse({
          code: 0,
          msg: "success",
          data: {
            netWssUrl: null,
            taskId: "1910246754753896450",
            clientId: "e825290b08ca2015b8f62f0bbdb5f5f6",
            taskStatus: "QUEUED",
            promptTips: "not-json-prompt-tips",
          },
        }),
    });

    const invalidPromptTipsResult = await invalidPromptTipsClient.createWorkflowTask({
      workflowId: "2014519004714508290",
      nodeInfoList: [
        {
          nodeId: "1",
          fieldName: "image",
          fieldValue: "file.png",
        },
      ],
    });

    assert.equal(invalidPromptTipsResult.promptTipsSummary?.parseStatus, "invalid_json");
    assert.equal(invalidPromptTipsResult.promptTipsSummary?.rawText, "not-json-prompt-tips");

    const promptTipsErrorClient = new RunningHubClient({
      apiKey: "rh-test-key",
      apiBaseUrl: "https://example.test",
      snapshotDir: rootDir,
      fetchImpl: async () =>
        createJsonResponse({
          code: 0,
          msg: "success",
          data: {
            netWssUrl: null,
            taskId: "1910246754753896450",
            clientId: "e825290b08ca2015b8f62f0bbdb5f5f6",
            taskStatus: "QUEUED",
            promptTips: "{\"result\": true, \"error\": \"workflow broken\", \"outputs_to_execute\": [\"9\"], \"node_errors\": {}}",
          },
        }),
    });

    await assert.rejects(
      () =>
        promptTipsErrorClient.createWorkflowTask({
          workflowId: "2014519004714508290",
          nodeInfoList: [
            {
              nodeId: "1",
              fieldName: "image",
              fieldValue: "file.png",
            },
          ],
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "PROVIDER_ERROR"
          && (error as { providerCode?: string }).providerCode === "PROMPT_TIPS_ERROR",
        ),
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
