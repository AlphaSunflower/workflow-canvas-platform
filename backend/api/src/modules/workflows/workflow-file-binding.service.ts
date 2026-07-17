import type { WorkflowDetailResponseData } from "@newworkflow/backend-shared/api";
import {
  collectWorkflowFileBindings,
} from "./workflow-files.repository.ts";
import type { WorkflowFileBindingRecord } from "./workflow-file-binding.types.ts";

export interface WorkflowBindingWriter {
  replaceBindings(
    workflowId: string,
    bindings: WorkflowFileBindingRecord[],
  ): Promise<void>;
  deleteBindings(workflowId: string): Promise<void>;
}

export class WorkflowFileBindingService {
  private readonly bindings: WorkflowBindingWriter;

  constructor(bindings: WorkflowBindingWriter) {
    this.bindings = bindings;
  }

  async syncWorkflowBindings(
    workflowId: string,
    ownerUserId: string,
    workflow: WorkflowDetailResponseData["workflow"],
  ): Promise<void> {
    await this.bindings.replaceBindings(
      workflowId,
      collectWorkflowFileBindings(
        workflowId,
        ownerUserId,
        workflow.nodes,
        workflow.connections,
      ),
    );
  }

  async deleteWorkflowBindings(workflowId: string): Promise<void> {
    await this.bindings.deleteBindings(workflowId);
  }
}
