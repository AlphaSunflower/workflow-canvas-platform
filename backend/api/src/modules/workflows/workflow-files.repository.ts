import { randomUUID } from "node:crypto";
import type { WorkflowFileBindingRecord } from "./workflow-file-binding.types.ts";

export type {
  WorkflowFileBindingRecord,
  WorkflowFileBindingStore,
} from "./workflow-file-binding.types.ts";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function collectWorkflowFileBindings(
  workflowId: string,
  ownerUserId: string,
  nodes: Record<string, unknown>,
  connections: unknown[],
): WorkflowFileBindingRecord[] {
  const now = new Date().toISOString();
  const bindings = new Map<string, WorkflowFileBindingRecord>();

  const pushBinding = (
    nodeId: string,
    fileId: string,
    role: WorkflowFileBindingRecord["role"],
  ): void => {
    const normalizedNodeId = normalizeString(nodeId);
    const normalizedFileId = normalizeString(fileId);

    if (!normalizedNodeId || !normalizedFileId) {
      return;
    }

    const key = `${normalizedNodeId}:${normalizedFileId}:${role}`;
    const existing = bindings.get(key);

    if (existing) {
      bindings.set(key, {
        ...existing,
        updatedAt: now,
      });
      return;
    }

    bindings.set(key, {
      bindingId: randomUUID(),
      workflowId,
      ownerUserId,
      nodeId: normalizedNodeId,
      fileId: normalizedFileId,
      role,
      createdAt: now,
      updatedAt: now,
    });
  };

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      continue;
    }

    const nodeRecord = node as Record<string, unknown>;
    const directFileId = normalizeString(nodeRecord.fileId);
    if (directFileId) {
      pushBinding(nodeId, directFileId, "file-node");
    }

    if (Array.isArray(nodeRecord.references)) {
      for (const reference of nodeRecord.references) {
        if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
          continue;
        }

        const referenceRecord = reference as Record<string, unknown>;
        const referenceFileId = normalizeString(referenceRecord.fileId);
        if (referenceFileId) {
          pushBinding(nodeId, referenceFileId, "node-reference");
        }
      }
    }

    if (Array.isArray(nodeRecord.fileIds)) {
      for (const fileId of uniqueStrings(
        nodeRecord.fileIds
          .map((value) => normalizeString(value))
          .filter((value): value is string => Boolean(value)),
      )) {
        pushBinding(nodeId, fileId, "file-group");
      }
    }
  }

  for (const connection of connections) {
    if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
      continue;
    }

    const connectionRecord = connection as Record<string, unknown>;
    const targetNodeId = normalizeString(connectionRecord.targetId);

    if (!targetNodeId || !Array.isArray(connectionRecord.references)) {
      continue;
    }

    for (const reference of connectionRecord.references) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        continue;
      }

      const referenceRecord = reference as Record<string, unknown>;
      const referenceFileId = normalizeString(referenceRecord.fileId);
      if (referenceFileId) {
        pushBinding(targetNodeId, referenceFileId, "connection-reference");
      }
    }
  }

  return Array.from(bindings.values()).sort((left, right) => {
    if (left.nodeId === right.nodeId) {
      if (left.fileId === right.fileId) {
        return left.role.localeCompare(right.role);
      }
      return left.fileId.localeCompare(right.fileId);
    }
    return left.nodeId.localeCompare(right.nodeId);
  });
}

export {
  JsonWorkflowFilesRepository,
  JsonWorkflowFilesRepository as WorkflowFilesRepository,
} from "./json-workflow-files.repository.ts";
