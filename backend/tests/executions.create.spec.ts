import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { WorkflowRepository } from "../api/src/modules/workflows/workflow.repository.ts";
import { createWhiteModelRenderRequest } from "./helpers/execution-request.fixture.ts";
import { registerReadyImageFile } from "./helpers/runninghub-queue-test.utils.ts";

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-test-"));
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const workflowRepository = new WorkflowRepository(rootDir);
  const executionsService = new ExecutionsService(
    executionsRepository,
    filesRepository,
    workflowRepository,
  );

  const whiteModelFileId1 = await registerReadyImageFile(
    filesRepository,
    "user-a",
    "white-model-1.png",
    "white-model-image-1",
  );
  const styleFileId1 = await registerReadyImageFile(
    filesRepository,
    "user-a",
    "style-1.png",
    "style-image-1",
  );
  const whiteModelFileId2 = await registerReadyImageFile(
    filesRepository,
    "user-a",
    "white-model-2.png",
    "white-model-image-2",
  );
  const styleFileId2 = await registerReadyImageFile(
    filesRepository,
    "user-a",
    "style-2.png",
    "style-image-2",
  );

  const result = await executionsService.createExecution(createWhiteModelRenderRequest({
    userId: "user-a",
    nodeId: "node-001",
    nodeTitle: "white model render",
    groups: [
      {
        groupId: "group-1",
        whiteModelFileId: whiteModelFileId1,
        styleReferenceFileId: styleFileId1,
      },
      {
        groupId: "group-2",
        whiteModelFileId: whiteModelFileId2,
        styleReferenceFileId: styleFileId2,
      },
    ],
  }));

  assert.ok(result.runId);
  assert.ok(result.runNo.startsWith("RUN-"));
  assert.equal(result.status, "queued");
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0]?.groupId, "group-1");
  assert.equal(result.tasks[1]?.groupId, "group-2");
  assert.ok(result.tasks[0]?.taskNo.startsWith("TASK-"));
  assert.ok(result.tasks[1]?.taskNo.startsWith("TASK-"));

  await fs.rm(rootDir, { recursive: true, force: true });
}

void run();
