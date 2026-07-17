import type { AINodeData, Workflow } from '@/types';

export interface PatchNodeConfigOptions {
  expectedType?: AINodeData['type'];
}

export interface RunNodeActionParams {
  nodeId: string;
  actionId: string;
  targetId?: string;
  options?: {
    signal?: AbortSignal;
    suppressNotifications?: boolean;
    [key: string]: unknown;
  };
}

export interface WorkflowNodeActionAccess {
  runNodeAction: (params: RunNodeActionParams) => Promise<void>;
  patchNodeConfig: <TConfig extends AINodeData['config']>(
    nodeId: string,
    updater: (config: TConfig, node: AINodeData) => Partial<TConfig> | null,
    options?: PatchNodeConfigOptions,
  ) => Workflow | null;
}
