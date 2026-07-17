import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExecutionTaskRecord } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { createAIImageHdRequest } from "./helpers/execution-request.fixture.ts";

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const registerResult = await filesRepository.registerFile({
    userId,
    sha256,
    size: buffer.length,
    mimeType: "image/png",
    originalName,
    fileType: "image",
    sourceType: "input",
  });

  if (registerResult.uploadRequired && registerResult.uploadId) {
    await filesRepository.uploadFile(
      registerResult.uploadId,
      buffer.toString("base64"),
    );
  }

  return registerResult.file.fileId;
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 1000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error("WAIT_FOR_CONDITION_TIMEOUT");
}

async function runNonRunningHubUnlimitedScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-non-runninghub-unbounded-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileIds = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        registerReadyFile(
          filesRepository,
          "user-a",
          `source-${index + 1}.png`,
          `source-content-${index + 1}`,
        )),
    );

    const createResult = await executionsService.createExecution(createAIImageHdRequest({
      workflowId: "workflow-laozhang-unbounded",
      nodeId: "node-laozhang-unbounded",
      nodeTitle: "laozhang unbounded",
      groups: sourceFileIds.map((sourceFileId, index) => ({
        groupId: `lz-group-${index + 1}`,
        sourceFileId,
        imageSize: "1K",
        aspectRatio: "1:1",
      })),
    }));

    const startedTaskIds: string[] = [];
    const releaseBarriers: Array<() => void> = [];

    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute(input) {
          startedTaskIds.push(input.task.id);
          await new Promise<void>((resolve) => {
            releaseBarriers.push(resolve);
          });
        },
      },
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
    );

    const pollPromise = queueService.pollOnce();
    await waitForCondition(() => startedTaskIds.length === 6);

    const tasks = await Promise.all(
      createResult.tasks.map((task) => executionsRepository.getTaskById(task.taskId)),
    );
    const queueHealth = queueService.getHealth();

    assert.equal(startedTaskIds.length, 6);
    assert.equal(tasks.filter((task: ExecutionTaskRecord | null) => task?.status === "processing").length, 6);
    assert.equal(queueHealth.activeTaskCount, 6);
    assert.equal(queueHealth.maxConcurrency, null);
    assert.equal(queueHealth.queuedTaskCount, 0);

    assert.equal(releaseBarriers.length, 6);
    for (const releaseBarrier of releaseBarriers.splice(0)) {
      releaseBarrier();
    }
    const pollResult = await pollPromise;

    assert.equal(pollResult.claimedCount, 6);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runNonRunningHubUnlimitedScenario();
}

void run();
