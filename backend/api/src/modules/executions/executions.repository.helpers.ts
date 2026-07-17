import { createHash } from "node:crypto";

import type { TaskFileRole } from "@newworkflow/backend-shared";
import type { ExecutionTaskRecord } from "./execution-records.types.ts";
import type { ExecutionTaskFileLinkRecord } from "./executions.repository.types.ts";

export function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${(Number.parseInt(hash.slice(16, 17), 16) & 0x3 | 0x8).toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

export function formatSequence(prefix: "RUN" | "TASK", sequence: number): string {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${prefix}-${year}${month}${day}-${String(sequence).padStart(6, "0")}`;
}

export function compareTaskOrder(
  left: Pick<ExecutionTaskRecord, "createdAt" | "groupOrder">,
  right: Pick<ExecutionTaskRecord, "createdAt" | "groupOrder">,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }

  const leftOrder = left.groupOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.groupOrder ?? Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return 0;
}

export function buildTaskPayload(task: ExecutionTaskRecord): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};

  if (task.groupId) {
    payload.groupId = task.groupId;
  }

  if (typeof task.groupOrder === "number") {
    payload.groupOrder = task.groupOrder;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function buildTaskInputFileLinks(
  task: ExecutionTaskRecord,
  createdAt: string,
): ExecutionTaskFileLinkRecord[] {
  const links: ExecutionTaskFileLinkRecord[] = [];
  const seen = new Set<string>();
  const append = (input: {
    fileId: unknown;
    role: TaskFileRole;
    orderIndex?: number | null;
    sourceHandle: string;
  }) => {
    if (typeof input.fileId !== "string" || input.fileId.trim().length === 0) {
      return;
    }

    const fileId = input.fileId.trim();
    const orderIndex = typeof input.orderIndex === "number"
      ? Math.trunc(input.orderIndex)
      : null;
    const identity = [
      task.id,
      fileId,
      input.role,
      input.sourceHandle,
      orderIndex ?? "",
    ].join(":");

    if (seen.has(identity)) {
      return;
    }

    seen.add(identity);
    links.push({
      id: deterministicUuid(`task_file_link:${identity}`),
      taskId: task.id,
      fileId,
      workflowId: task.workflowId,
      role: input.role,
      orderIndex,
      sourceHandle: input.sourceHandle,
      groupId: task.groupId,
      createdAt,
    });
  };

  append({
    fileId: task.whiteModelFileId,
    role: "input",
    sourceHandle: "whiteModelFileId",
  });
  append({
    fileId: task.styleReferenceFileId,
    role: "reference",
    sourceHandle: "styleReferenceFileId",
  });

  const taskInput = task.input ?? {};
  toStringArray(taskInput.referenceFileIds).forEach((fileId, index) => {
    append({
      fileId,
      role: "reference",
      sourceHandle: "input.referenceFileIds",
      orderIndex: index,
    });
  });
  toStringArray(taskInput.fileIds).forEach((fileId, index) => {
    append({
      fileId,
      role: "input",
      sourceHandle: "input.fileIds",
      orderIndex: index,
    });
  });
  append({
    fileId: taskInput.sourceFileId,
    role: "input",
    sourceHandle: "input.sourceFileId",
  });
  append({
    fileId: taskInput.inputFileId,
    role: "input",
    sourceHandle: "input.inputFileId",
  });
  append({
    fileId: taskInput.maskFileId,
    role: "reference",
    sourceHandle: "input.maskFileId",
  });
  append({
    fileId: taskInput.renderFileId,
    role: "input",
    sourceHandle: "input.renderFileId",
  });
  append({
    fileId: taskInput.referenceFileId,
    role: "reference",
    sourceHandle: "input.referenceFileId",
  });

  return links;
}
