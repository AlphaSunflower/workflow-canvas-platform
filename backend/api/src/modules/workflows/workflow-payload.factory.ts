import type { WorkflowPayload } from "@newworkflow/backend-shared/api";
import type { CreateBlankWorkflowCommand } from "./workflows.contracts.ts";

export function createBlankWorkflowPayload(
  workflowId: string | undefined,
  request: CreateBlankWorkflowCommand,
  name: string,
): WorkflowPayload {
  return {
    ...(workflowId ? { id: workflowId } : {}),
    projectId: request.projectId ?? "default",
    name,
    nodes: {},
    connections: [],
    viewport: request.viewport ?? { x: 0, y: 0, zoom: 1 },
    metadata: request.metadata ?? {},
    timestamp: request.timestamp ?? Date.now(),
    ...(request.version !== undefined ? { version: request.version } : {}),
  };
}
