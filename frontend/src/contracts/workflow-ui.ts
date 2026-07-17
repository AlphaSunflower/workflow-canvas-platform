import type { UseNotificationReturn } from '@/hooks/ui';
import type { BrowserFileSystemFileHandleLike } from '@/services/local-file-source-store';
import type { AINodeData, AnyNodeData, Connection, FileNodeData, Workflow } from '@/types';
import type {
  WorkflowConnectionInput,
  WorkflowNodeGroupInput,
  WorkflowNodeGroupPortInput,
  WorkflowNodeGroupState,
  WorkflowResolvedNodeGroupState,
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';
import type {
  PatchNodeConfigOptions,
  RunNodeActionParams,
} from '@/contracts/node-actions';

export interface WorkflowUIActions {
  syncRuntimeSnapshot: (
    runtime: WorkflowRuntimeSnapshot,
    options?: WorkflowRuntimeSyncOptions,
  ) => Workflow | null;
  exportFileNode: (nodeId: string, options?: { forceDirectoryPicker?: boolean }) => Promise<void>;
  rebindLocalFileNodeSource: (
    nodeId: string,
    file: File,
    options?: {
      localSourceHandle?: BrowserFileSystemFileHandleLike;
    },
  ) => Promise<FileNodeData | null>;
  optimizeAIImageGenPrompt: (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
      prompt?: string;
    },
  ) => Promise<void>;
  runAINode: (nodeId: string) => Promise<void>;
  cancelAINodeRun: (nodeId: string) => Promise<void>;
  runNodeAction: (params: RunNodeActionParams) => Promise<void>;
  patchNodeConfig: <TConfig extends AINodeData['config']>(
    nodeId: string,
    updater: (config: TConfig, node: AINodeData) => Partial<TConfig> | null,
    options?: PatchNodeConfigOptions,
  ) => Workflow | null;
}

export interface WorkflowUISelectors {
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getConnectionsForNode: (nodeId: string) => Connection[];
  getIncomingConnections: (nodeId: string) => Connection[];
  getOutgoingConnections: (nodeId: string) => Connection[];
  getIncomingSourceNodes: (nodeId: string) => AnyNodeData[];
  getConnectedFileInputs: (nodeId: string) => FileNodeData[];
  getConnectedAIInputs: (nodeId: string) => AINodeData[];
  getNodeInputSummary: (nodeId: string) => WorkflowConnectionInput[];
  getResolvedNodeInputGroups: (nodeId: string) => WorkflowResolvedNodeGroupState[];
  getResolvedNodeGroupPortInputs: (
    nodeId: string,
    groupId: string,
    portId: string,
  ) => WorkflowNodeGroupPortInput[];
  hasResolvedNodeGroupInputs: (nodeId: string) => boolean;
  getNodeGroupInputs: (nodeId: string, groupId: string) => WorkflowNodeGroupInput[];
  getNodeInputGroups: (nodeId: string) => WorkflowNodeGroupState[];
  hasNodeGroupInputs: (nodeId: string) => boolean;
  canRunNode: (nodeId: string) => boolean;
  getNodeDisplayName: (nodeId: string) => string;
  getAllNodeInputs: (nodeId: string) => WorkflowConnectionInput[];
}

export interface WorkflowUINotificationRuntime {
  notification: Pick<
    UseNotificationReturn,
    'showError' | 'showInfo' | 'showSuccess' | 'showWarning'
  >;
}
