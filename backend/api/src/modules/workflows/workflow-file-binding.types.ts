export interface WorkflowFileBindingRecord {
  bindingId: string;
  workflowId: string;
  ownerUserId: string;
  nodeId: string;
  fileId: string;
  role: "file-node" | "node-reference" | "connection-reference" | "file-group";
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowFileBindingStore {
  items: WorkflowFileBindingRecord[];
}

export function createEmptyWorkflowFileBindingStore(): WorkflowFileBindingStore {
  return { items: [] };
}
