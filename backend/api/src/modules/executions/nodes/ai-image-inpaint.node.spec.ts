import test from "node:test";
import assert from "node:assert/strict";

import type { AIImageInpaintCreateExecutionRequest } from "@newworkflow/backend-shared/api";
import {
  buildCreateExecutionStoreInput,
  collectExecutionInputFileIds,
  mapCreateExecutionError,
  validateExecutionCreateRequest,
} from "../execution-node.registry.ts";

test("aiImageInpaint execution node validates request and builds store input", () => {
  const validated = validateExecutionCreateRequest({
    workflowId: " workflow-ai-image-inpaint ",
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    nodeId: " node-ai-image-inpaint ",
    nodeTitle: " AI Image Inpaint ",
    prompt: " Replace the marked sofa with a lounge chair ",
    model: "gpt-image-2-vip",
    imageSize: "2K",
    aspectRatio: "4:5",
    maskMode: "strong-mask",
    groups: [{
      groupId: " main ",
      sourceFileId: " source-file-1 ",
      maskFileId: " mask-file-1 ",
    }],
  });

  assert.equal(validated.nodeType, "aiImageInpaint");
  const request = validated as AIImageInpaintCreateExecutionRequest;

  assert.equal(request.workflowId, "workflow-ai-image-inpaint");
  assert.equal(request.nodeId, "node-ai-image-inpaint");
  assert.equal(request.nodeTitle, "AI Image Inpaint");
  assert.equal(request.prompt, "Replace the marked sofa with a lounge chair");
  assert.equal(request.model, "gpt-image-2-vip");
  assert.equal(request.imageSize, "2K");
  assert.equal(request.aspectRatio, "4:5");
  assert.equal(request.maskMode, "strong-mask");
  assert.deepEqual(request.groups, [{
    groupId: "main",
    sourceFileId: "source-file-1",
    maskFileId: "mask-file-1",
  }]);
  assert.deepEqual(collectExecutionInputFileIds(request), [
    "source-file-1",
    "mask-file-1",
  ]);

  const storeInput = buildCreateExecutionStoreInput(request);
  assert.equal(storeInput.run.nodeType, "aiImageInpaint");
  assert.equal(storeInput.run.taskType, "image-inpaint");
  assert.equal(storeInput.run.provider, "laozhang");
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.groupId, "main");
  assert.equal(storeInput.tasks[0]?.groupOrder, 1);
  assert.equal(storeInput.tasks[0]?.provider, "laozhang");
  assert.equal(storeInput.tasks[0]?.model, "gpt-image-2-vip");
  assert.deepEqual(storeInput.tasks[0]?.input, {
    prompt: "Replace the marked sofa with a lounge chair",
    model: "gpt-image-2-vip",
    inputFileId: "source-file-1",
    sourceFileId: "source-file-1",
    maskFileId: "mask-file-1",
    maskMode: "strong-mask",
    imageSize: "2K",
    aspectRatio: "4:5",
  });
});

test("aiImageInpaint execution node applies default model and mask mode without image params", () => {
  const validated = validateExecutionCreateRequest({
    workflowId: "workflow-ai-image-inpaint",
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    prompt: "make marked wall matte green",
    groups: [{
      groupId: "main",
      sourceFileId: "source-file-1",
      maskFileId: "mask-file-1",
    }],
  });

  const request = validated as AIImageInpaintCreateExecutionRequest;
  assert.equal(request.model, "gpt-image-2");
  assert.equal(Object.prototype.hasOwnProperty.call(request, "imageSize"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, "aspectRatio"), false);
  assert.equal(request.maskMode, "original-markup");

  const storeInput = buildCreateExecutionStoreInput(request);
  assert.deepEqual(storeInput.tasks[0]?.input, {
    prompt: "make marked wall matte green",
    model: "gpt-image-2",
    inputFileId: "source-file-1",
    sourceFileId: "source-file-1",
    maskFileId: "mask-file-1",
    maskMode: "original-markup",
  });
});

test("aiImageInpaint execution node rejects invalid prompt, group count, input files, mask mode, and image parameters", () => {
  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "   ",
      maskMode: "original-markup",
      groups: [{
        groupId: "main",
        sourceFileId: "source-file-1",
        maskFileId: "mask-file-1",
      }],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_PROMPT/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      maskMode: "original-markup",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
        {
          groupId: "extra",
          sourceFileId: "source-file-2",
          maskFileId: "mask-file-2",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_GROUP_COUNT/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      maskMode: "original-markup",
      groups: [{
        groupId: "main",
        sourceFileId: "   ",
        maskFileId: "mask-file-1",
      }],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      maskMode: "original-markup",
      groups: [{
        groupId: "main",
        sourceFileId: "source-file-1",
        maskFileId: "   ",
      }],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      maskMode: "invalid-mask",
      groups: [{
        groupId: "main",
        sourceFileId: "source-file-1",
        maskFileId: "mask-file-1",
      }],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_MASK_MODE/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      model: "unsupported-model",
      maskMode: "original-markup",
      groups: [{
        groupId: "main",
        sourceFileId: "source-file-1",
        maskFileId: "mask-file-1",
      }],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_MODEL/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      imageSize: "8K",
      maskMode: "original-markup",
      groups: [{
        groupId: "main",
        sourceFileId: "source-file-1",
        maskFileId: "mask-file-1",
      }],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_IMAGE_SIZE:request/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: "workflow-ai-image-inpaint",
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "ok",
      model: "gpt-image-2-vip",
      aspectRatio: "auto",
      maskMode: "original-markup",
      groups: [{
        groupId: "main",
        sourceFileId: "source-file-1",
        maskFileId: "mask-file-1",
      }],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_ASPECT_RATIO:request/);
});

test("aiImageInpaint execution node maps validation errors to explicit API messages", () => {
  assert.deepEqual(mapCreateExecutionError("INVALID_AI_IMAGE_INPAINT_PROMPT"), {
    code: 40041,
    message: "AI image inpaint requires a non-empty prompt.",
  });
  assert.deepEqual(mapCreateExecutionError("INVALID_AI_IMAGE_INPAINT_GROUP_COUNT"), {
    code: 40037,
    message: "AI image inpaint requires exactly one input group.",
  });
  assert.deepEqual(mapCreateExecutionError("INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID:0"), {
    code: 40038,
    message: "sourceFileId is invalid.",
  });
  assert.deepEqual(mapCreateExecutionError("INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID:0"), {
    code: 40038,
    message: "maskFileId is invalid.",
  });
  assert.deepEqual(mapCreateExecutionError("INVALID_AI_IMAGE_INPAINT_MASK_MODE"), {
    code: 40046,
    message: "maskMode is invalid.",
  });
});
