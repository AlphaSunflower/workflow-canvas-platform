import test from "node:test";
import assert from "node:assert/strict";

import type { AIVideoGenCreateExecutionRequest } from "@newworkflow/backend-shared/api";
import { buildCreateExecutionStoreInput, validateExecutionCreateRequest } from "../execution-node.registry.ts";

test("aiVideoGen execution node validates prompt/model/duration/group reference count", () => {
  const validated = validateExecutionCreateRequest({
    workflowId: " workflow-ai-video-gen ",
    nodeType: "aiVideoGen",
    taskType: "video-gen",
    executionMode: "legacy-grouped-task",
    nodeId: " node-ai-video-gen ",
    nodeTitle: " AI Video Gen ",
    prompt: " Create a smooth product demo video ",
    model: "veo-3.1-fast-generate-preview",
    duration: 8,
    aspectRatio: "9:16",
    resolution: "1080p",
    groups: [
      {
        groupId: " group-1 ",
        referenceFileIds: [" file-ref-1 ", " file-ref-2 "],
      },
      {
        groupId: "group-2",
        referenceFileIds: ["file-ref-3"],
      },
    ],
  });

  assert.equal(validated.nodeType, "aiVideoGen");
  const request = validated as AIVideoGenCreateExecutionRequest;

  assert.equal(request.workflowId, "workflow-ai-video-gen");
  assert.equal(request.nodeId, "node-ai-video-gen");
  assert.equal(request.nodeTitle, "AI Video Gen");
  assert.equal(request.prompt, "Create a smooth product demo video");
  assert.equal(request.model, "veo-3.1-fast-generate-preview");
  assert.equal(request.duration, 8);
  assert.equal(request.aspectRatio, "9:16");
  assert.equal(request.resolution, "1080p");
  assert.equal(request.size, "1080x1920");
  assert.deepEqual(request.groups, [
    {
      groupId: "group-1",
      referenceFileIds: ["file-ref-1", "file-ref-2"],
    },
    {
      groupId: "group-2",
      referenceFileIds: ["file-ref-3"],
    },
  ]);

  const storeInput = buildCreateExecutionStoreInput(request);
  assert.equal(storeInput.run.nodeType, "aiVideoGen");
  assert.equal(storeInput.run.taskType, "video-gen");
  assert.equal(storeInput.run.provider, "laozhang-veo");
  assert.equal(storeInput.tasks.length, 2);
  assert.equal(storeInput.tasks[0]?.groupId, "group-1");
  assert.equal(storeInput.tasks[0]?.groupOrder, 1);
  assert.equal(storeInput.tasks[1]?.groupId, "group-2");
  assert.equal(storeInput.tasks[1]?.groupOrder, 2);
  assert.deepEqual(storeInput.tasks[0]?.input, {
    prompt: "Create a smooth product demo video",
    model: "veo-3.1-fast-generate-preview",
    duration: 8,
    aspectRatio: "9:16",
    resolution: "1080p",
    size: "1080x1920",
    referenceFileIds: ["file-ref-1", "file-ref-2"],
  });
  assert.deepEqual(storeInput.tasks[1]?.input, {
    prompt: "Create a smooth product demo video",
    model: "veo-3.1-fast-generate-preview",
    duration: 8,
    aspectRatio: "9:16",
    resolution: "1080p",
    size: "1080x1920",
    referenceFileIds: ["file-ref-3"],
  });
});

test("aiVideoGen execution node maps legacy Veo model names before storage", () => {
  const validated = validateExecutionCreateRequest({
    workflowId: "workflow-ai-video-gen",
    nodeType: "aiVideoGen",
    taskType: "video-gen",
    executionMode: "legacy-grouped-task",
    prompt: "Create a smooth product demo video",
    model: "veo-3.1-landscape-fast-fl",
    duration: 8,
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: ["file-ref-1"],
      },
    ],
  });

  const request = validated as AIVideoGenCreateExecutionRequest;
  const storeInput = buildCreateExecutionStoreInput(request);

  assert.equal(request.model, "veo-3.1-fast-generate-preview");
  assert.equal(storeInput.tasks[0]?.model, "veo-3.1-fast-generate-preview");
  assert.equal(
    (storeInput.tasks[0]?.input as { model?: string } | null)?.model,
    "veo-3.1-fast-generate-preview",
  );
});

test("aiVideoGen execution node rejects invalid prompt/model/duration/reference counts", () => {
  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      prompt: "   ",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_PROMPT/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      model: "unsupported-model",
      duration: 8,
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_MODEL/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      model: "veo-3.1-fast-generate-preview",
      duration: 4,
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_DURATION/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: [],
        },
      ],
    } as never);
  }, /INVALID_REFERENCE_FILE_COUNT:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1", "file-ref-2", "file-ref-3"],
        },
      ],
    } as never);
  }, /INVALID_REFERENCE_FILE_COUNT:0/);
});
