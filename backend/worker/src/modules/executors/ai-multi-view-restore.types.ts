export interface AIMultiViewRestoreExecutorInput {
  userId: string;
  runId: string;
  taskId: string;
  taskNo: string;
  renderFileId: string;
  referenceFileId: string;
  workflowId: string;
  workflowTemplateKey: string;
  outputNodeId: string;
}

export interface AIMultiViewRestoreExecutorResult {
  providerTaskId: string;
  providerClientId: string | null;
  renderUploadedFileName: string;
  referenceUploadedFileName: string;
  resultFileId: string;
  resultStorageKey: string;
  resultFileUrl: string;
  resultNodeId: string | null;
}
