export interface RunningHubWorkflowTemplateNodeInputMap {
  [fieldName: string]: unknown;
}

export interface RunningHubWorkflowTemplateNode {
  inputs?: RunningHubWorkflowTemplateNodeInputMap;
  class_type?: string;
  _meta?: {
    title?: string;
  };
}

export interface RunningHubWorkflowTemplateDocument {
  [nodeId: string]: RunningHubWorkflowTemplateNode;
}

export interface RunningHubWorkflowTemplateDescriptor {
  templateKey: string;
  workflowId: string;
  fileName: string;
  inputBindings: RunningHubWorkflowTemplateInputBinding[];
  outputNodeIds?: string[];
}

export interface RunningHubWorkflowTemplateInputBinding {
  inputKey: string;
  nodeId: string;
  fieldName: string;
}

export interface RunningHubResolvedWorkflowTemplate {
  descriptor: RunningHubWorkflowTemplateDescriptor;
  absolutePath: string;
  document: RunningHubWorkflowTemplateDocument;
}

export interface RunningHubBuildNodeInfoListInput {
  templateKey?: string;
  uploadedFileName?: string;
  uploadedFileNames?: Record<string, string>;
  snapshotLabel?: string;
}

export interface RunningHubBuildNodeInfoListResult {
  templateKey: string;
  workflowId: string;
  nodeInfoList: Array<{
    nodeId: string;
    fieldName: string;
    fieldValue: string;
  }>;
  snapshotPath: string;
}
