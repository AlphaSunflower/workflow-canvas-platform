import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import type { NormalizedExecutionError } from "../worker/src/modules/retry/retry.types.ts";

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-event-diagnostics-"));

  try {
    const executionsRepository = new ExecutionsRepository(rootDir);
    const createResult = await executionsRepository.createExecution({
      run: {
        userId: "user-a",
        workflowId: "workflow-diagnostics",
        projectId: null,
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "node-diagnostics",
        nodeTitle: "diagnostics",
        provider: "laozhang",
        requestPayload: {
          userId: "user-a",
          workflowId: "workflow-diagnostics",
          nodeType: "aiImageGen",
          taskType: "image-gen",
          executionMode: "legacy-grouped-task",
          nodeId: "node-diagnostics",
          nodeTitle: "diagnostics",
          prompt: "diagnostics",
          groups: [
            {
              groupId: "group-diagnostics",
              referenceFileIds: [],
            },
          ],
        },
      },
      tasks: [
        {
          workflowId: "workflow-diagnostics",
          projectId: null,
          nodeType: "aiImageGen",
          nodeId: "node-diagnostics",
          nodeTitle: "diagnostics",
          taskType: "image-gen",
          groupId: "group-diagnostics",
          groupOrder: 0,
          provider: "laozhang",
          model: "gpt-image-2-vip",
          input: {
            prompt: "diagnostics",
            referenceFileIds: [],
          },
        },
      ],
    });

    const taskId = createResult.tasks[0]!.taskId;
    const eventService = new ExecutionEventService(executionsRepository);
    const error: NormalizedExecutionError = {
      code: "NETWORK_ERROR",
      message: "Laozhang API network request failed.",
      category: "provider_retryable",
      retryable: true,
      provider: "laozhang",
      details: {
        apiUrl: "https://example.test/v1/images/edits",
        timeoutMs: 1_200_000,
        elapsedMs: 305_123,
        phase: "fetch",
        method: "POST",
        causeCode: "UND_ERR_HEADERS_TIMEOUT",
        causeMessage: "Headers Timeout Error",
        responseBody: "must not be persisted to event payload",
      },
    };

    await eventService.recordAttemptFailure({
      taskId,
      attemptNo: 1,
      stepType: "final",
      error,
      finalFailure: false,
    });
    await eventService.recordAttemptRetryScheduled({
      taskId,
      attemptNo: 1,
      nextAttemptNo: 2,
      delayMs: 3_000,
      error,
      stepType: "final",
    });

    const events = await executionsRepository.getTaskEvents(taskId);
    const failureEvent = events.find((event) => event.eventType === "task_retry_progress");
    const retryEvent = events.find((event) => event.eventType === "task_retry_scheduled");

    assert.equal(failureEvent?.payload?.errorCode, "NETWORK_ERROR");
    assert.equal(failureEvent?.payload?.provider, "laozhang");
    assert.equal(failureEvent?.payload?.retryable, true);
    assert.equal(retryEvent?.payload?.nextAttemptNo, 2);
    assert.equal(retryEvent?.payload?.delayMs, 3_000);

    const diagnostics = retryEvent?.payload?.diagnostics as Record<string, unknown> | undefined;
    assert.equal(diagnostics?.apiUrl, "https://example.test/v1/images/edits");
    assert.equal(diagnostics?.timeoutMs, 1_200_000);
    assert.equal(diagnostics?.elapsedMs, 305_123);
    assert.equal(diagnostics?.phase, "fetch");
    assert.equal(diagnostics?.causeCode, "UND_ERR_HEADERS_TIMEOUT");
    assert.equal("responseBody" in (diagnostics ?? {}), false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
