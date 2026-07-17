import test from "node:test";
import assert from "node:assert/strict";

import type { AIFloorplanColorizeCreateExecutionRequest } from "@newworkflow/backend-shared/api";
import { buildCreateExecutionStoreInput, validateExecutionCreateRequest } from "../execution-node.registry.ts";

test("aiFloorplanColorize execution node preserves selected gemini model", () => {
  const validated = validateExecutionCreateRequest({
    workflowId: " workflow-floorplan-colorize ",
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    executionMode: "legacy-grouped-task",
    nodeId: " node-floorplan-colorize ",
    nodeTitle: "Floorplan Colorize",
    model: "gemini-3-pro-image-preview",
    groups: [
      {
        groupId: " group-1 ",
        sourceFileId: " file-source-1 ",
        stylePreset: "photoreal-render",
        imageSize: "2K",
        aspectRatio: "auto",
      },
    ],
  });

  assert.equal(validated.nodeType, "aiFloorplanColorize");
  const request = validated as AIFloorplanColorizeCreateExecutionRequest;
  assert.equal(request.workflowId, "workflow-floorplan-colorize");
  assert.equal(request.nodeId, "node-floorplan-colorize");
  assert.equal(request.model, "gemini-3-pro-image-preview");
  assert.deepEqual(request.groups, [
    {
      groupId: "group-1",
      sourceFileId: "file-source-1",
      stylePreset: "photoreal-render",
      imageSize: "2K",
      aspectRatio: "auto",
    },
  ]);

  const storeInput = buildCreateExecutionStoreInput(request);
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.model, "gemini-3-pro-image-preview");
  assert.deepEqual(storeInput.tasks[0]?.input, {
    model: "gemini-3-pro-image-preview",
    inputFileId: "file-source-1",
    sourceFileId: "file-source-1",
    stylePreset: "photoreal-render",
    imageSize: "2K",
    aspectRatio: "auto",
  });
});

test("aiFloorplanColorize execution node rejects unsupported model", () => {
  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-floorplan-colorize",
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
      executionMode: "legacy-grouped-task",
      model: "unsupported-model",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-1",
        },
      ],
    } as never);
  }, /INVALID_MODEL/);
});
