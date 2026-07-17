import type { AuthContextValue } from '@/auth';
import type {
  ExecutionOutputCommitWorkflowInput,
} from '@/execution-runtime/execution-output-commit.types';
import type { ExecutionRuntimeNodeAdapterContext } from '@/execution-runtime/node-execution-adapter.types';
import type {
  ExecutionRuntimeNodeExecutionPayload,
  ExecutionRuntimeNodeExecutionTarget,
} from '@/execution-runtime/node-execution.types';
import type { ExecutionRuntimeRunState } from '@/execution-runtime/execution-runtime.types';
import type {
  WorkflowAIExecutionState,
  WorkflowNodeGroupExecutionState,
} from '@/contracts/execution';
import type {
  WorkflowConnectionInput,
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';
import type {
  AINodeData,
  AnyNodeData,
  ExecutionTaskRef,
  FileNodeData,
  NodeTaskRef,
  Workflow,
} from '@/types';
import type {
  BackendExecutionSummary,
  CreateBackendExecutionRequest,
} from '@/services/backendExecutionService';
import type { NodeActionOptions } from '../types';

export interface SharedNodeActionNotificationServices {
  showWarning: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string) => void;
  showAuthFeedback: (error: unknown, actionLabel: string) => boolean;
}

export interface SharedNodeActionServices {
  auth: AuthContextValue;
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getNodeNameById: (nodeId: string) => string;
  getCurrentWorkflow: () => Workflow | null;
  applyRuntimeSnapshot: (
    snapshot: WorkflowRuntimeSnapshot,
    options?: WorkflowRuntimeSyncOptions,
  ) => Workflow | null;
  ensureWorkflowPersistedForExecution: () => Promise<Workflow>;
  ensureBackendFileId: (
    sourceNode: FileNodeData,
    options?: { signal?: AbortSignal; workflowId?: string | null },
  ) => Promise<string | null | undefined>;
  getBackendFileInfo: (
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<{ status: string }>;
  getExecutionRuntimeGroupState: (
    nodeId: string,
    groupId: string,
    workflowId?: string | null,
  ) => WorkflowNodeGroupExecutionState | null;
  syncTaskRefsToWorkflow: (
    nodeId: string,
    taskRefs: NodeTaskRef[],
    taskRefsForMetadata: ExecutionTaskRef[],
  ) => void;
  commitBackendExecutionOutputs: (
    node: AINodeData,
    snapshot: ExecutionRuntimeRunState,
    input: ExecutionOutputCommitWorkflowInput,
  ) => Promise<void>;
  buildExecutionRuntimeAdapterContext: (
    node: AINodeData,
    signal?: AbortSignal,
  ) => ExecutionRuntimeNodeAdapterContext;
  createOutputCommitInput: (
    payload: ExecutionRuntimeNodeExecutionPayload<unknown, ExecutionRuntimeNodeExecutionTarget>,
    adapterContext: ExecutionRuntimeNodeAdapterContext,
  ) => ExecutionOutputCommitWorkflowInput;
  setNodeExecutionState: (
    nodeId: string,
    nextState: WorkflowAIExecutionState,
  ) => void;
  setGroupExecutionState: (
    nodeId: string,
    nextState: WorkflowNodeGroupExecutionState,
  ) => void;
  createGroupedExecution: (
    request: CreateBackendExecutionRequest,
    signal?: AbortSignal,
  ) => Promise<BackendExecutionSummary>;
  startExecutionPolling: (options: {
    runId: string;
    workflowId: string;
    nodeId: string;
    signal?: AbortSignal;
    onSnapshot: (snapshot: ExecutionRuntimeRunState) => void;
  }) => Promise<ExecutionRuntimeRunState>;
  logWarn: (
    event: string,
    message: string,
    context: Record<string, unknown>,
  ) => void;
  notification: SharedNodeActionNotificationServices;
}

export interface NodeActionServiceRegistryContext<
  TOptions extends NodeActionOptions = NodeActionOptions,
> {
  workflow: Workflow;
  node: AINodeData;
  actionId: string;
  inputs: WorkflowConnectionInput[];
  targetId?: string;
  options?: TOptions;
  services?: unknown;
}

export type NodeActionServiceResolver = (
  context: NodeActionServiceRegistryContext,
) => unknown;

export class NodeActionServiceRegistry {
  private readonly resolvers = new Map<AINodeData['type'], NodeActionServiceResolver>();

  register(nodeType: AINodeData['type'], resolver: NodeActionServiceResolver): this {
    this.resolvers.set(nodeType, resolver);
    return this;
  }

  resolve(context: NodeActionServiceRegistryContext): unknown {
    const resolver = this.resolvers.get(context.node.type);
    if (!resolver) {
      return context.services;
    }

    return resolver(context);
  }
}

export function createNodeActionServiceRegistry(): NodeActionServiceRegistry {
  return new NodeActionServiceRegistry();
}
