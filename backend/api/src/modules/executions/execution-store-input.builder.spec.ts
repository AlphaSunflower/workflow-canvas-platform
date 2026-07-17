import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionStoreInputBuilder } from "./execution-store-input.builder.ts";
import type { AIImageGenCreateExecutionRequest } from "@newworkflow/backend-shared/api";

function createAIImageGenRequest(): AIImageGenCreateExecutionRequest {
  return {
    userId: "request-user",
    workflowId: "workflow-request",
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-1",
    nodeTitle: "Node 1",
    prompt: "test prompt",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: ["file-a", "file-b", "file-a"],
      },
    ],
  };
}

test("ExecutionStoreInputBuilder deduplicates file ids and injects workflow context", () => {
  const builder = new ExecutionStoreInputBuilder();
  const input = createAIImageGenRequest();

  assert.deepEqual(builder.collectFileIds(input), ["file-a", "file-b"]);

  const storeInput = builder.build(input, {
    userId: "actor-user",
    workflowId: "workflow-real",
    projectId: "project-real",
  });

  assert.equal(storeInput.run.userId, "actor-user");
  assert.equal(storeInput.run.workflowId, "workflow-real");
  assert.equal(storeInput.run.projectId, "project-real");
  assert.equal(storeInput.tasks[0]?.workflowId, "workflow-real");
  assert.equal(storeInput.tasks[0]?.projectId, "project-real");
  assert.equal(storeInput.tasks[0]?.nodeId, "node-1");
  assert.equal(storeInput.tasks[0]?.nodeTitle, "Node 1");
});
