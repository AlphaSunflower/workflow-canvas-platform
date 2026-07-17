import type {
  CreateBlankWorkflowRequest,
  CreateWorkflowGroupRequest,
  CreateWorkflowRequest,
  MoveWorkflowGroupRequest,
  RenameWorkflowGroupRequest,
  RenameWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowViewport,
} from "@newworkflow/backend-shared/api";

function assertObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("INVALID_BODY");
  }

  return input as Record<string, unknown>;
}

function normalizeString(
  value: unknown,
  errorCode: string,
  options?: { maxLength?: number },
): string {
  if (typeof value !== "string") {
    throw new Error(errorCode);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(errorCode);
  }

  if (options?.maxLength && normalized.length > options.maxLength) {
    throw new Error(errorCode);
  }

  return normalized;
}

function normalizeOptionalString(
  value: unknown,
  errorCode: string,
  options?: { maxLength?: number },
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeString(value, errorCode, options);
}

function normalizePositiveNumber(value: unknown, errorCode: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(errorCode);
  }

  return Number(value);
}

function normalizeViewport(value: unknown): WorkflowViewport {
  const body = assertObject(value);

  return {
    x: normalizePositiveNumber(body.x, "INVALID_VIEWPORT"),
    y: normalizePositiveNumber(body.y, "INVALID_VIEWPORT"),
    zoom: normalizePositiveNumber(body.zoom, "INVALID_VIEWPORT"),
  };
}

function normalizeNodes(value: unknown, required: boolean): Record<string, unknown> {
  if (!required && value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_NODES");
  }

  return value as Record<string, unknown>;
}

function normalizeConnections(value: unknown, required: boolean): unknown[] {
  if (!required && value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("INVALID_CONNECTIONS");
  }

  return value;
}

function normalizeMetadata(value: unknown, required: boolean): Record<string, unknown> {
  if (!required && value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_METADATA");
  }

  return value as Record<string, unknown>;
}

function normalizeTimestamp(value: unknown, required: boolean): number {
  if (!required && value === undefined) {
    return Date.now();
  }

  return normalizePositiveNumber(value, "INVALID_TIMESTAMP");
}

function normalizeVersion(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizePositiveNumber(value, "INVALID_VERSION");
}

function normalizeNullableGroupId(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  return normalizeString(value, "INVALID_GROUP_ID", { maxLength: 120 });
}

export function validateWorkflowIdParam(workflowId: string): string {
  return normalizeString(workflowId, "INVALID_WORKFLOW_ID", { maxLength: 120 });
}

export function validateWorkflowGroupIdParam(groupId: string): string {
  return normalizeString(groupId, "INVALID_GROUP_ID", { maxLength: 120 });
}

export function validateCreateWorkflowRequest(input: unknown): CreateWorkflowRequest {
  const body = assertObject(input);

  return {
    ...(body.id !== undefined
      ? {
          id: normalizeString(body.id, "INVALID_WORKFLOW_ID", {
            maxLength: 120,
          }),
        }
      : {}),
    projectId: normalizeString(body.projectId, "INVALID_PROJECT_ID", { maxLength: 120 }),
    name: normalizeString(body.name, "INVALID_WORKFLOW_NAME", { maxLength: 120 }),
    nodes: normalizeNodes(body.nodes, false),
    connections: normalizeConnections(body.connections, false),
    viewport: body.viewport === undefined
      ? { x: 0, y: 0, zoom: 1 }
      : normalizeViewport(body.viewport),
    metadata: normalizeMetadata(body.metadata, false),
    timestamp: normalizeTimestamp(body.timestamp, false),
    version: normalizeVersion(body.version),
  };
}

export function validateUpdateWorkflowRequest(input: unknown): UpdateWorkflowRequest {
  const body = assertObject(input);

  return {
    ...(body.workflowId !== undefined
      ? {
          workflowId: normalizeString(body.workflowId, "INVALID_WORKFLOW_ID", {
            maxLength: 120,
          }),
        }
      : {}),
    projectId: normalizeString(body.projectId, "INVALID_PROJECT_ID", { maxLength: 120 }),
    name: normalizeString(body.name, "INVALID_WORKFLOW_NAME", { maxLength: 120 }),
    nodes: normalizeNodes(body.nodes, true),
    connections: normalizeConnections(body.connections, true),
    viewport: normalizeViewport(body.viewport),
    metadata: normalizeMetadata(body.metadata, true),
    timestamp: normalizeTimestamp(body.timestamp, true),
    version: normalizeVersion(body.version),
  };
}

export function validateCreateBlankWorkflowRequest(input: unknown): CreateBlankWorkflowRequest {
  const body = assertObject(input);

  return {
    ...(body.id !== undefined
      ? {
          id: normalizeString(body.id, "INVALID_WORKFLOW_ID", {
            maxLength: 120,
          }),
        }
      : {}),
    ...(body.projectId !== undefined
      ? {
          projectId: normalizeString(body.projectId, "INVALID_PROJECT_ID", {
            maxLength: 120,
          }),
        }
      : {}),
    ...(body.name !== undefined
      ? {
          name: normalizeString(body.name, "INVALID_WORKFLOW_NAME", {
            maxLength: 120,
          }),
        }
      : {}),
    ...(body.groupId !== undefined
      ? {
          groupId: normalizeNullableGroupId(body.groupId),
        }
      : {}),
    viewport: body.viewport === undefined
      ? undefined
      : normalizeViewport(body.viewport),
    metadata: body.metadata === undefined
      ? undefined
      : normalizeMetadata(body.metadata, true),
    timestamp: normalizeTimestamp(body.timestamp, false),
    version: normalizeVersion(body.version),
  };
}

export function validateRenameWorkflowRequest(input: unknown): RenameWorkflowRequest {
  const body = assertObject(input);

  return {
    name: normalizeString(body.name, "INVALID_WORKFLOW_NAME", { maxLength: 120 }),
  };
}

export function validateMoveWorkflowGroupRequest(input: unknown): MoveWorkflowGroupRequest {
  const body = assertObject(input);

  if (!Object.prototype.hasOwnProperty.call(body, "groupId")) {
    throw new Error("INVALID_GROUP_ID");
  }

  return {
    groupId: normalizeNullableGroupId(body.groupId),
  };
}

export function validateCreateWorkflowGroupRequest(input: unknown): CreateWorkflowGroupRequest {
  const body = assertObject(input);

  return {
    name: normalizeOptionalString(body.name, "INVALID_GROUP_NAME", { maxLength: 120 }),
  };
}

export function validateRenameWorkflowGroupRequest(input: unknown): RenameWorkflowGroupRequest {
  const body = assertObject(input);

  return {
    name: normalizeString(body.name, "INVALID_GROUP_NAME", { maxLength: 120 }),
  };
}
