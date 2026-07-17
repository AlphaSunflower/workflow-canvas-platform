import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowFileBindingService } from "./workflow-file-binding.service.ts";

test("WorkflowFileBindingService builds and replaces workflow file bindings", async () => {
  let receivedWorkflowId: string | null = null;
  let receivedBindingsCount = 0;
  const service = new WorkflowFileBindingService({
    async replaceBindings(workflowId, bindings) {
      receivedWorkflowId = workflowId;
      receivedBindingsCount = bindings.length;
    },
    async deleteBindings() {
      throw new Error("delete should not be called");
    },
  });

  await service.syncWorkflowBindings(
    "workflow-1",
    "user-1",
    {
      id: "workflow-1",
      projectId: "project-1",
      name: "Canvas",
      nodes: {
        nodeA: {
          fileId: "file-1",
          references: [{ fileId: "file-2" }],
          fileIds: ["file-3", "file-3"],
        },
      },
      connections: [
        {
          targetId: "nodeA",
          references: [{ fileId: "file-4" }],
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {},
      timestamp: 1,
      version: 1,
    },
  );

  assert.equal(receivedWorkflowId, "workflow-1");
  assert.equal(receivedBindingsCount, 4);
});
