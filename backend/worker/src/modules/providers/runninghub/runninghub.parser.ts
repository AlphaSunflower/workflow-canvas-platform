import {
  createRunningHubBackpressureError,
  createRunningHubInvalidResponseError,
  createRunningHubProviderError,
} from "./runninghub.errors.ts";
import type {
  RunningHubCreateTaskResult,
  RunningHubPromptTipsSummary,
  RunningHubQueryTaskResult,
  RunningHubResultFileItem,
  RunningHubTaskStatusResult,
  RunningHubUploadedFileResult,
} from "./runninghub.types.ts";

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJsonText(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parsePromptTips(promptTips: string | null): RunningHubPromptTipsSummary | null {
  if (!promptTips) {
    return null;
  }

  const parsed = parseJsonText(promptTips);
  const root = readObject(parsed);

  if (!root) {
    return {
      parseStatus: "invalid_json",
      rawText: promptTips,
      raw: parsed,
    };
  }

  const outputsToExecute = readArray(root.outputs_to_execute)
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));

  return {
    result: typeof root.result === "boolean" ? root.result : null,
    error: readString(root.error),
    outputsToExecute,
    nodeErrors: readObject(root.node_errors) ?? {},
    parseStatus: "parsed",
    rawText: promptTips,
    raw: parsed,
  };
}

function assertPromptTipsHealthy(input: {
  taskId: string;
  clientId: string | null;
  taskStatus: string;
  promptTips: string | null;
  promptTipsSummary: RunningHubPromptTipsSummary | null;
  snapshotPath: string;
}): void {
  const summary = input.promptTipsSummary;

  if (!summary || summary.parseStatus !== "parsed") {
    return;
  }

  if (summary.result === false) {
    throw createRunningHubProviderError(
      "RunningHub 创建任务失败：promptTips.result = false。",
      "PROMPT_TIPS_RESULT_FALSE",
      {
        taskId: input.taskId,
        clientId: input.clientId,
        taskStatus: input.taskStatus,
        promptTips: input.promptTips,
        promptTipsSummary: summary,
        snapshotPath: input.snapshotPath,
      },
    );
  }

  if (summary.error) {
    throw createRunningHubProviderError(
      "RunningHub 创建任务失败：promptTips.error 非空。",
      "PROMPT_TIPS_ERROR",
      {
        taskId: input.taskId,
        clientId: input.clientId,
        taskStatus: input.taskStatus,
        promptTips: input.promptTips,
        promptTipsSummary: summary,
        snapshotPath: input.snapshotPath,
      },
    );
  }

  if (summary.nodeErrors && Object.keys(summary.nodeErrors).length > 0) {
    throw createRunningHubProviderError(
      "RunningHub 创建任务失败：promptTips.node_errors 非空。",
      "PROMPT_TIPS_NODE_ERRORS",
      {
        taskId: input.taskId,
        clientId: input.clientId,
        taskStatus: input.taskStatus,
        promptTips: input.promptTips,
        promptTipsSummary: summary,
        snapshotPath: input.snapshotPath,
      },
    );
  }
}

function parseRoot(input: {
  responseText: string;
  snapshotPath: string;
}): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.responseText) as unknown;
  } catch {
    throw createRunningHubInvalidResponseError("RunningHub 返回内容不是合法 JSON。", {
      snapshotPath: input.snapshotPath,
    });
  }

  const root = readObject(parsed);

  if (!root) {
    throw createRunningHubInvalidResponseError("RunningHub 返回 JSON 根对象无效。", {
      snapshotPath: input.snapshotPath,
    });
  }

  return root;
}

function assertSuccessRoot(root: Record<string, unknown>, snapshotPath: string): void {
  const code = readNumber(root.code);
  const message = readString(root.msg);

  if (code === null) {
    throw createRunningHubInvalidResponseError("RunningHub 返回缺少 code 字段。", {
      snapshotPath,
    });
  }

  if (code !== 0) {
    if (message === "task_queue_maxed") {
      throw createRunningHubBackpressureError(
        "RunningHub 队列繁忙，等待后端重新调度。",
        "task_queue_maxed",
        {
          snapshotPath,
        },
      );
    }

    throw createRunningHubProviderError(
      readString(root.msg) ?? "RunningHub 返回业务失败。",
      String(code),
      {
        snapshotPath,
      },
    );
  }
}

export function parseRunningHubUploadResponse(input: {
  responseText: string;
  snapshotPath: string;
}): RunningHubUploadedFileResult {
  const root = parseRoot(input);
  assertSuccessRoot(root, input.snapshotPath);

  const data = readObject(root.data);
  const fileName = readString(data?.fileName);

  if (!fileName) {
    throw createRunningHubInvalidResponseError(
      "RunningHub 文件上传返回中缺少 data.fileName。",
      { snapshotPath: input.snapshotPath },
    );
  }

  return {
    fileName,
    rawResponse: root,
    responseText: input.responseText,
    snapshotPath: input.snapshotPath,
  };
}

export function parseRunningHubCreateTaskResponse(input: {
  responseText: string;
  snapshotPath: string;
}): RunningHubCreateTaskResult {
  const root = parseRoot(input);
  assertSuccessRoot(root, input.snapshotPath);

  const data = readObject(root.data);
  const taskId = readString(data?.taskId);
  const taskStatus = readString(data?.taskStatus);
  const clientId = readString(data?.clientId);
  const promptTips = readString(data?.promptTips);

  if (!taskId || !taskStatus) {
    throw createRunningHubInvalidResponseError(
      "RunningHub 创建任务返回缺少 taskId 或 taskStatus。",
      { snapshotPath: input.snapshotPath },
    );
  }

  const promptTipsSummary = parsePromptTips(promptTips);
  assertPromptTipsHealthy({
    taskId,
    clientId,
    taskStatus,
    promptTips,
    promptTipsSummary,
    snapshotPath: input.snapshotPath,
  });

  return {
    taskId,
    taskStatus,
    clientId,
    promptTips,
    promptTipsSummary,
    rawResponse: root,
    responseText: input.responseText,
    snapshotPath: input.snapshotPath,
  };
}

export function parseRunningHubTaskStatusResponse(input: {
  responseText: string;
  snapshotPath: string;
}): RunningHubTaskStatusResult {
  const root = parseRoot(input);
  assertSuccessRoot(root, input.snapshotPath);

  const data = readObject(root.data);
  const taskId = readString(data?.taskId);
  const taskStatus = readString(data?.taskStatus);
  const clientId = readString(data?.clientId);
  const progress = readNumber(data?.progress);

  if (!taskId) {
    throw createRunningHubInvalidResponseError(
      "RunningHub 状态查询返回缺少 taskId。",
      { snapshotPath: input.snapshotPath },
    );
  }

  return {
    taskId,
    taskStatus,
    clientId,
    progress,
    rawResponse: root,
    responseText: input.responseText,
    snapshotPath: input.snapshotPath,
  };
}

function parseResultItem(value: unknown): RunningHubResultFileItem | null {
  const item = readObject(value);

  if (!item) {
    return null;
  }

  const fileUrl = readString(item.fileUrl) ?? readString(item.url);
  const fileType = readString(item.fileType) ?? readString(item.outputType);

  if (!fileUrl || !fileType) {
    return null;
  }

  return {
    fileUrl,
    fileType,
    nodeId: readString(item.nodeId),
    taskCostTime: readNumber(item.taskCostTime),
  };
}

export function parseRunningHubQueryTaskResultResponse(input: {
  responseText: string;
  snapshotPath: string;
}): RunningHubQueryTaskResult {
  const root = parseRoot(input);
  const hasEnvelope = typeof root.code === "number";

  if (hasEnvelope) {
    assertSuccessRoot(root, input.snapshotPath);
  }

  const payload = hasEnvelope ? root.data : root;
  const payloadObject = readObject(payload);
  const resultItems = payloadObject
    ? (
      readArray(payloadObject.results).length > 0
        ? readArray(payloadObject.results)
        : readArray(payloadObject.outputs).length > 0
          ? readArray(payloadObject.outputs)
          : readArray(payloadObject.files)
    ).map(parseResultItem)
    : readArray(payload).map(parseResultItem);
  const results = resultItems.filter((item): item is RunningHubResultFileItem => Boolean(item));

  return {
    taskId:
      (payloadObject ? readString(payloadObject.taskId) : null)
      ?? readString(root.taskId),
    taskStatus:
      (payloadObject
        ? readString(payloadObject.taskStatus) ?? readString(payloadObject.status)
        : null)
      ?? readString(root.taskStatus)
      ?? readString(root.status),
    clientId:
      (payloadObject ? readString(payloadObject.clientId) : null)
      ?? readString(root.clientId),
    promptTips:
      (payloadObject ? readString(payloadObject.promptTips) : null)
      ?? readString(root.promptTips),
    errorCode:
      (payloadObject ? readString(payloadObject.errorCode) : null)
      ?? readString(root.errorCode),
    errorMessage:
      (payloadObject ? readString(payloadObject.errorMessage) : null)
      ?? readString(root.errorMessage),
    results,
    rawResponse: root,
    responseText: input.responseText,
    snapshotPath: input.snapshotPath,
  };
}
