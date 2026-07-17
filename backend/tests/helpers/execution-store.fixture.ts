import type {
  CreateExecutionStoreInput,
  CreateExecutionStoreRunInput,
  CreateExecutionStoreTaskInput,
  ExecutionTaskRecord,
} from "../../api/src/modules/executions/executions.repository.ts";
import type { NodeTaskType } from "../../shared/src/types/execution.ts";
import {
  createAIImageToPlyRequest,
  DEFAULT_TEST_NODE_ID,
  DEFAULT_TEST_NODE_TITLE,
  DEFAULT_TEST_PROJECT_ID,
  DEFAULT_TEST_USER_ID,
  DEFAULT_TEST_WORKFLOW_ID,
} from "./execution-request.fixture.ts";

export function createExecutionStoreRunInput(
  overrides: Partial<CreateExecutionStoreRunInput> = {},
): CreateExecutionStoreRunInput {
  const requestPayload = overrides.requestPayload ?? createAIImageToPlyRequest({
    userId: overrides.userId ?? DEFAULT_TEST_USER_ID,
    workflowId: overrides.workflowId ?? DEFAULT_TEST_WORKFLOW_ID,
    nodeId: overrides.nodeId ?? DEFAULT_TEST_NODE_ID,
    nodeTitle: overrides.nodeTitle ?? DEFAULT_TEST_NODE_TITLE,
  });

  return {
    userId: DEFAULT_TEST_USER_ID,
    workflowId: DEFAULT_TEST_WORKFLOW_ID,
    projectId: DEFAULT_TEST_PROJECT_ID,
    nodeType: requestPayload.nodeType,
    taskType: requestPayload.taskType,
    executionMode: requestPayload.executionMode,
    nodeId: DEFAULT_TEST_NODE_ID,
    nodeTitle: DEFAULT_TEST_NODE_TITLE,
    provider: "runninghub",
    requestPayload,
    ...overrides,
  };
}

export function createExecutionStoreTaskInput(
  overrides: Partial<CreateExecutionStoreTaskInput> = {},
): CreateExecutionStoreTaskInput {
  return {
    workflowId: DEFAULT_TEST_WORKFLOW_ID,
    projectId: DEFAULT_TEST_PROJECT_ID,
    nodeType: "aiImageToPly",
    nodeId: DEFAULT_TEST_NODE_ID,
    nodeTitle: DEFAULT_TEST_NODE_TITLE,
    taskType: "image-to-ply",
    groupId: "group-1",
    groupOrder: 1,
    provider: "runninghub",
    model: null,
    input: {
      sourceFileId: "source-file-1",
    },
    ...overrides,
  };
}

export function createExecutionStoreInput(input: {
  run?: Partial<CreateExecutionStoreRunInput>;
  tasks?: Partial<CreateExecutionStoreTaskInput>[];
} = {}): CreateExecutionStoreInput {
  const run = createExecutionStoreRunInput(input.run);
  const tasks = (input.tasks ?? [{}]).map((task, index) => createExecutionStoreTaskInput({
    workflowId: run.workflowId,
    projectId: run.projectId,
    nodeType: run.nodeType,
    nodeId: run.nodeId,
    nodeTitle: run.nodeTitle,
    taskType: run.taskType,
    groupId: `group-${index + 1}`,
    groupOrder: index + 1,
    ...task,
  }));

  return {
    run,
    tasks,
  };
}

export function createExecutionTaskRecord(
  overrides: Partial<ExecutionTaskRecord> & {
    id: string;
    taskType?: NodeTaskType;
  },
): ExecutionTaskRecord {
  const { id, ...rest } = overrides;

  return {
    id,
    taskNo: `TASK-${id}`,
    runId: "run-1",
    userId: DEFAULT_TEST_USER_ID,
    workflowId: DEFAULT_TEST_WORKFLOW_ID,
    projectId: DEFAULT_TEST_PROJECT_ID,
    nodeType: "aiImageToPly",
    nodeId: DEFAULT_TEST_NODE_ID,
    nodeTitle: DEFAULT_TEST_NODE_TITLE,
    taskType: "image-to-ply",
    groupId: "group-1",
    groupOrder: 1,
    provider: "runninghub",
    model: null,
    input: {},
    status: "queued",
    currentStep: null,
    currentAttemptNo: 0,
    retryCount: 0,
    maxRetries: 2,
    lastErrorCode: null,
    lastErrorMessage: null,
    resultFileId: null,
    claimedBy: null,
    claimedAt: null,
    leaseUntil: null,
    heartbeatAt: null,
    attemptStartedAt: null,
    createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
    startedAt: null,
    completedAt: null,
    whiteModelFileId: null,
    styleReferenceFileId: null,
    ...rest,
  };
}
