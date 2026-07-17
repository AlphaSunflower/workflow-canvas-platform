export interface AIImageToPlyExecutorInput {
  userId: string;
  runId: string;
  taskId: string;
  taskNo: string;
  sourceFileId: string;
  workflowId: string;
  workflowTemplateKey: string;
}

export interface AIImageToPlyExecutorResult {
  providerTaskId: string;
  providerClientId: string | null;
  uploadedFileName: string;
  resultFileId: string;
  resultStorageKey: string;
  resultFileUrl: string;
}
