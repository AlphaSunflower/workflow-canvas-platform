import type { AINodeData, Workflow } from '@/types';
import { isAINodeData } from '@/utils';
import {
  type ExecutionOutputCommitMode,
  type ExecutionOutputCommitResolvedLegacyGroupedRequest,
  type ExecutionOutputCommitRequest,
  type ExecutionOutputCommitWorkflowAccess,
  type ExecutionOutputCommitPayloadInput,
  type ExecutionOutputCommitLegacyGroupedInput,
  type ExecutionOutputCommitWorkflowInput,
  type LegacyBackendExecutionTarget,
} from './execution-output-commit.types';
import type {
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeNodeExecutionPayload,
  ExecutionRuntimeNodeExecutionTarget,
} from './node-execution.types';
import type {
  ExecutionRuntimeNodeAdapter,
  ExecutionRuntimeNodeAdapterContext,
  ExecutionRuntimeNodeOutputAdapter,
} from './node-execution-adapter.types';
import type { ExecutionRuntimeRunState } from './execution-runtime.types';

interface ResolveWorkflowExecutionOutputCommitRequestParams {
  node: AINodeData;
  snapshot: ExecutionRuntimeRunState;
  input: ExecutionOutputCommitWorkflowInput;
  latestWorkflow: Workflow | null;
  resolveNodeTitle: (nodeId: string) => string;
  buildAdapterContext: (node: AINodeData) => ExecutionRuntimeNodeAdapterContext;
  groupedAdapter: ExecutionRuntimeNodeOutputAdapter<
    undefined,
    ExecutionRuntimeGroupedNodeExecutionTarget
  >;
  getNodeAdapter: (
    nodeType: AINodeData['type'],
  ) => ExecutionRuntimeNodeAdapter | null;
  workflowAccess: ExecutionOutputCommitWorkflowAccess;
}

export interface WorkflowExecutionOutputCommitResolvedPayloadRequest<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> {
  kind: 'payload';
  request: ExecutionOutputCommitRequest<TRequest, TTarget>;
}

export interface WorkflowExecutionOutputCommitResolvedLegacyRequest {
  kind: 'legacy-grouped-targets';
  request: ExecutionOutputCommitResolvedLegacyGroupedRequest;
}

export type WorkflowExecutionOutputCommitResolvedRequest =
  | WorkflowExecutionOutputCommitResolvedPayloadRequest
  | WorkflowExecutionOutputCommitResolvedLegacyRequest;

function resolveCommitNode(
  node: AINodeData,
  latestWorkflow: Workflow | null,
): AINodeData {
  const latestNode = latestWorkflow?.nodes[node.id.value];
  if (
    latestNode
    && isAINodeData(latestNode)
    && latestNode.type === node.type
  ) {
    return latestNode;
  }

  return node;
}

function toLegacyGroupedPayload(
  node: AINodeData,
  nodeTitle: string,
  targets: ExecutionOutputCommitResolvedLegacyGroupedRequest['payload']['targets'],
): ExecutionRuntimeNodeExecutionPayload<undefined, ExecutionRuntimeGroupedNodeExecutionTarget> {
  return {
    nodeId: node.id.value,
    nodeType: node.type,
    nodeTitle,
    taskType: 'grouped-backend-execution',
    executionKind: 'grouped',
    request: undefined,
    targets,
  };
}

function toGroupedExecutionTargets(
  node: AINodeData,
  targets: ReadonlyArray<LegacyBackendExecutionTarget>,
): ExecutionRuntimeGroupedNodeExecutionTarget[] {
  return targets.map((target) => ({
    kind: 'group',
    nodeId: node.id.value,
    nodeType: node.type,
    groupId: target.groupId,
    groupOrder: target.groupOrder,
    groupLabel: target.groupLabel,
    outputHandle: target.outputHandle,
  }));
}

function buildCommitAdapterContext(
  adapterContext: ExecutionRuntimeNodeAdapterContext,
  commitNode: AINodeData,
  latestWorkflow: Workflow | null,
  snapshot: ExecutionRuntimeRunState,
): ExecutionRuntimeNodeAdapterContext {
  return {
    ...adapterContext,
    workflowId: latestWorkflow?.id ?? adapterContext.workflowId ?? snapshot.workflowId ?? null,
    workflow: latestWorkflow ?? adapterContext.workflow,
    node: commitNode,
  };
}

function resolvePayloadAdapter<
  TRequest,
  TTarget extends ExecutionRuntimeNodeExecutionTarget,
>(
  payload: ExecutionRuntimeNodeExecutionPayload<TRequest, TTarget>,
  adapter: ExecutionRuntimeNodeAdapter | null,
): ExecutionRuntimeNodeOutputAdapter<TRequest, TTarget> | null {
  if (!adapter || adapter.executionKind !== payload.executionKind) {
    return null;
  }

  return adapter as ExecutionRuntimeNodeOutputAdapter<TRequest, TTarget>;
}

export function resolveWorkflowExecutionOutputCommitRequest(
  params: Omit<ResolveWorkflowExecutionOutputCommitRequestParams, 'input'> & {
    input: ExecutionOutputCommitLegacyGroupedInput;
  },
): WorkflowExecutionOutputCommitResolvedLegacyRequest;
export function resolveWorkflowExecutionOutputCommitRequest<
  TRequest,
  TTarget extends ExecutionRuntimeNodeExecutionTarget,
>(
  params: Omit<ResolveWorkflowExecutionOutputCommitRequestParams, 'input'> & {
    input: ExecutionOutputCommitPayloadInput<TRequest, TTarget>;
  },
): WorkflowExecutionOutputCommitResolvedPayloadRequest<TRequest, TTarget> | null;
export function resolveWorkflowExecutionOutputCommitRequest(
  params: ResolveWorkflowExecutionOutputCommitRequestParams,
): WorkflowExecutionOutputCommitResolvedRequest | null;
export function resolveWorkflowExecutionOutputCommitRequest(
  params: ResolveWorkflowExecutionOutputCommitRequestParams,
): WorkflowExecutionOutputCommitResolvedRequest | null {
  const {
    node,
    snapshot,
    input,
    latestWorkflow,
    resolveNodeTitle,
    buildAdapterContext,
    groupedAdapter,
    getNodeAdapter,
    workflowAccess,
  } = params;

  const commitNode = resolveCommitNode(node, latestWorkflow);

  if (input.kind === 'legacy-grouped-targets') {
    const adapterContext = buildAdapterContext(node);
    const commitAdapterContext = buildCommitAdapterContext(
      adapterContext,
      commitNode,
      latestWorkflow,
      snapshot,
    );

    return {
      kind: 'legacy-grouped-targets',
      request: {
        workflowId: latestWorkflow?.id ?? null,
        runId: snapshot.runId,
        node: commitNode,
        snapshot,
        payload: toLegacyGroupedPayload(
          node,
          resolveNodeTitle(node.id.value),
          toGroupedExecutionTargets(node, input.targets),
        ),
        adapter: groupedAdapter,
        adapterContext: commitAdapterContext,
        workflowAccess,
        mode: input.mode ?? 'incremental',
      },
    };
  }

  const adapter = resolvePayloadAdapter(input.payload, getNodeAdapter(node.type));
  if (!adapter) {
    return null;
  }

  const adapterContext = input.adapterContext;
  const commitAdapterContext = buildCommitAdapterContext(
    adapterContext,
    commitNode,
    latestWorkflow,
    snapshot,
  );

  return {
    kind: 'payload',
    request: {
      workflowId: latestWorkflow?.id ?? null,
      runId: snapshot.runId,
      node: commitNode,
      snapshot,
      payload: input.payload,
      adapter,
      adapterContext: commitAdapterContext,
      workflowAccess,
      mode: input.mode,
    },
  };
}

export function createPayloadExecutionOutputCommitInput<
  TRequest,
  TTarget extends ExecutionRuntimeNodeExecutionTarget,
>(
  payload: ExecutionRuntimeNodeExecutionPayload<TRequest, TTarget>,
  adapterContext: ExecutionRuntimeNodeAdapterContext,
  mode?: ExecutionOutputCommitMode,
): ExecutionOutputCommitWorkflowInput<TRequest, TTarget> {
  return {
    kind: 'payload',
    payload,
    adapterContext,
    mode,
  };
}

export function createLegacyGroupedExecutionOutputCommitInput(
  targets: LegacyBackendExecutionTarget[],
  mode?: ExecutionOutputCommitMode,
): ExecutionOutputCommitWorkflowInput {
  return {
    kind: 'legacy-grouped-targets',
    targets,
    mode,
  };
}
