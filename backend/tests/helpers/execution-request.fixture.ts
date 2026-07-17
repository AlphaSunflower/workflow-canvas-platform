import type {
  AIFloorplanColorizeCreateExecutionRequest,
  AIImageGenCreateExecutionRequest,
  AIImageHdCreateExecutionRequest,
  AIImageInpaintCreateExecutionRequest,
  AIImageToPlyCreateExecutionRequest,
  AIMultiViewRestoreCreateExecutionRequest,
  WhiteModelRenderCreateExecutionRequest,
} from "../../shared/src/types/api/executions.ts";

export const DEFAULT_TEST_USER_ID = "user-a";
export const DEFAULT_TEST_WORKFLOW_ID = "workflow-test-1";
export const DEFAULT_TEST_PROJECT_ID = "project-test-1";
export const DEFAULT_TEST_NODE_ID = "node-test-1";
export const DEFAULT_TEST_NODE_TITLE = "Test Node";

type RequestDefaultOverrides = {
  userId?: string;
  workflowId?: string;
  nodeId?: string;
  nodeTitle?: string;
};

function createRequestDefaults(
  overrides: RequestDefaultOverrides = {},
): Required<RequestDefaultOverrides> {
  return {
    userId: overrides.userId ?? DEFAULT_TEST_USER_ID,
    workflowId: overrides.workflowId ?? DEFAULT_TEST_WORKFLOW_ID,
    nodeId: overrides.nodeId ?? DEFAULT_TEST_NODE_ID,
    nodeTitle: overrides.nodeTitle ?? DEFAULT_TEST_NODE_TITLE,
  };
}

export function createWhiteModelRenderRequest(
  overrides: Partial<WhiteModelRenderCreateExecutionRequest> = {},
): WhiteModelRenderCreateExecutionRequest {
  const defaults = createRequestDefaults(overrides);

  return {
    userId: defaults.userId,
    workflowId: defaults.workflowId,
    nodeType: "aiModelRenderTransfer",
    taskType: "model-render-transfer",
    executionMode: "legacy-grouped-task",
    nodeId: defaults.nodeId,
    nodeTitle: defaults.nodeTitle,
    model: "gemini-3-pro-image-preview",
    imageSize: "1K",
    aspectRatio: "auto",
    groups: [
      {
        groupId: "group-1",
        whiteModelFileId: "white-model-file-1",
        styleReferenceFileId: "style-reference-file-1",
      },
    ],
    ...overrides,
  };
}

export function createAIImageToPlyRequest(
  overrides: Partial<AIImageToPlyCreateExecutionRequest> = {},
): AIImageToPlyCreateExecutionRequest {
  const defaults = createRequestDefaults(overrides);

  return {
    userId: defaults.userId,
    workflowId: defaults.workflowId,
    nodeType: "aiImageToPly",
    taskType: "image-to-ply",
    executionMode: "legacy-grouped-task",
    nodeId: defaults.nodeId,
    nodeTitle: defaults.nodeTitle,
    groups: [
      {
        groupId: "group-1",
        sourceFileId: "source-file-1",
      },
    ],
    ...overrides,
  };
}

export function createAIImageHdRequest(
  overrides: Partial<AIImageHdCreateExecutionRequest> = {},
): AIImageHdCreateExecutionRequest {
  const defaults = createRequestDefaults(overrides);

  return {
    userId: defaults.userId,
    workflowId: defaults.workflowId,
    nodeType: "aiImageHd",
    taskType: "image-hd",
    executionMode: "legacy-grouped-task",
    nodeId: defaults.nodeId,
    nodeTitle: defaults.nodeTitle,
    model: "gemini-3-pro-image-preview",
    groups: [
      {
        groupId: "group-1",
        sourceFileId: "source-file-1",
      },
    ],
    ...overrides,
  };
}

export function createAIFloorplanColorizeRequest(
  overrides: Partial<AIFloorplanColorizeCreateExecutionRequest> = {},
): AIFloorplanColorizeCreateExecutionRequest {
  const defaults = createRequestDefaults(overrides);

  return {
    userId: defaults.userId,
    workflowId: defaults.workflowId,
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    executionMode: "legacy-grouped-task",
    nodeId: defaults.nodeId,
    nodeTitle: defaults.nodeTitle,
    model: "gemini-3-pro-image-preview",
    groups: [
      {
        groupId: "group-1",
        sourceFileId: "source-file-1",
      },
    ],
    ...overrides,
  };
}

export function createAIMultiViewRestoreRequest(
  overrides: Partial<AIMultiViewRestoreCreateExecutionRequest> = {},
): AIMultiViewRestoreCreateExecutionRequest {
  const defaults = createRequestDefaults(overrides);

  return {
    userId: defaults.userId,
    workflowId: defaults.workflowId,
    nodeType: "aiMultiViewRestore",
    taskType: "multi-view-restore",
    executionMode: "legacy-grouped-task",
    nodeId: defaults.nodeId,
    nodeTitle: defaults.nodeTitle,
    groups: [
      {
        groupId: "group-1",
        renderFileId: "render-file-1",
        referenceFileId: "reference-file-1",
      },
    ],
    ...overrides,
  };
}

export function createAIImageGenRequest(
  overrides: Partial<AIImageGenCreateExecutionRequest> = {},
): AIImageGenCreateExecutionRequest {
  const defaults = createRequestDefaults(overrides);

  return {
    userId: defaults.userId,
    workflowId: defaults.workflowId,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: defaults.nodeId,
    nodeTitle: defaults.nodeTitle,
    prompt: "test prompt",
    model: "gemini-3-pro-image-preview",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: ["reference-file-1"],
      },
    ],
    ...overrides,
  };
}

export function createAIImageInpaintRequest(
  overrides: Partial<AIImageInpaintCreateExecutionRequest> = {},
): AIImageInpaintCreateExecutionRequest {
  const defaults = createRequestDefaults(overrides);

  return {
    userId: defaults.userId,
    workflowId: defaults.workflowId,
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    nodeId: defaults.nodeId,
    nodeTitle: defaults.nodeTitle,
    prompt: "test inpaint prompt",
    model: "gemini-3-pro-image-preview",
    imageSize: "1K",
    aspectRatio: "auto",
    maskMode: "original-markup",
    groups: [
      {
        groupId: "main",
        sourceFileId: "source-file-1",
        maskFileId: "mask-file-1",
      },
    ],
    ...overrides,
  };
}
