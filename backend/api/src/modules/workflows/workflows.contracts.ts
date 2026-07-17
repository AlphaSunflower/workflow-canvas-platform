import type {
  DeleteWorkflowGroupResponseData,
  DeleteWorkflowResponseData,
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
  WorkflowListResponseData,
  WorkflowPayload,
  WorkflowViewport,
} from "@newworkflow/backend-shared/api";

export type {
  DeleteWorkflowGroupResponseData,
  DeleteWorkflowResponseData,
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
  WorkflowListResponseData,
  WorkflowPayload,
};

export interface CreateWorkflowCommand {
  id?: string;
  projectId: string;
  name: string;
  nodes?: Record<string, unknown>;
  connections?: unknown[];
  viewport?: WorkflowViewport;
  metadata?: Record<string, unknown>;
  timestamp?: number;
  version?: number;
}

export interface UpdateWorkflowCommand {
  workflowId?: string;
  projectId: string;
  name: string;
  nodes: Record<string, unknown>;
  connections: unknown[];
  viewport: WorkflowViewport;
  metadata: Record<string, unknown>;
  timestamp: number;
  version?: number;
}

export interface CreateBlankWorkflowCommand {
  id?: string;
  projectId?: string;
  name?: string;
  groupId?: string | null;
  viewport?: WorkflowViewport;
  metadata?: Record<string, unknown>;
  timestamp?: number;
  version?: number;
}

export interface RenameWorkflowCommand {
  name: string;
}

export interface MoveWorkflowGroupCommand {
  groupId: string | null;
}

export interface CreateWorkflowGroupCommand {
  name?: string;
}

export interface RenameWorkflowGroupCommand {
  name: string;
}

export function toWorkflowPayload(
  workflowId: string | undefined,
  input: CreateWorkflowCommand | UpdateWorkflowCommand,
): WorkflowPayload {
  return {
    ...(workflowId ? { id: workflowId } : {}),
    projectId: input.projectId,
    name: input.name,
    nodes: input.nodes ?? {},
    connections: input.connections ?? [],
    viewport: input.viewport ?? { x: 0, y: 0, zoom: 1 },
    metadata: input.metadata ?? {},
    timestamp: input.timestamp ?? Date.now(),
    ...(input.version !== undefined ? { version: input.version } : {}),
  };
}
