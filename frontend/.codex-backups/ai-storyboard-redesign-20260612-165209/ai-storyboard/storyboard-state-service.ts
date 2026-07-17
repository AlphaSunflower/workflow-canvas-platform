import type {
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';
import type { Node as ReactFlowNode } from 'reactflow';
import type {
  AINodeData,
  AnyNodeData,
  StoryboardShotData,
  StoryboardConfig,
  Workflow,
} from '@/types';
import { buildStoryboardConfigPatch, getStoryboardExternalState } from './shot-sync';
import {
  createStoryboardNodePatchResult,
  createStoryboardShotPatchResult,
} from './storyboard-execution-service';
import { patchNodeConfigInGraph } from '../shared/node-config-updater';
import {
  createStoryboardLocalStateKey,
  type StoryboardLocalState,
  type StoryboardShotDefaults,
} from './types';

export interface StoryboardStateGraphWriteResult {
  changed: boolean;
  nextNodes: ReactFlowNode<AnyNodeData>[];
  nextStateKey: string;
}

export interface StoryboardRuntimeStateApplier {
  (
    runtimeSnapshot: WorkflowRuntimeSnapshot,
    options?: WorkflowRuntimeSyncOptions,
  ): Workflow | null;
}

export function writeStoryboardLocalStateToNodeGraph(params: {
  nodes: ReactFlowNode<AnyNodeData>[];
  nodeId: string;
  nextState: StoryboardLocalState;
  defaults: StoryboardShotDefaults;
}): StoryboardStateGraphWriteResult {
  const nextStateKey = createStoryboardLocalStateKey(params.nextState);
  const patchResult = patchNodeConfigInGraph<StoryboardConfig>({
    nodes: params.nodes,
    nodeId: params.nodeId,
    expectedType: 'aiStoryboard',
    updater: (config) => {
      const currentState = getStoryboardExternalState(config, params.defaults);
      if (createStoryboardLocalStateKey(currentState) === nextStateKey) {
        return null;
      }

      return buildStoryboardConfigPatch(config, params.nextState);
    },
  });

  return {
    changed: patchResult.changed,
    nextNodes: patchResult.nextNodes,
    nextStateKey,
  };
}

export function patchStoryboardNodeRuntimeState(params: {
  workflow: Workflow | null;
  nodeId: string;
  updater: (state: {
    currentNode: AINodeData;
    shots: StoryboardShotData[];
    processedInputFileIds: string[];
  }) => {
    shots?: StoryboardShotData[];
    processedInputFileIds?: string[];
  } | null;
  applyRuntimeSnapshot: StoryboardRuntimeStateApplier;
  applyOptions?: WorkflowRuntimeSyncOptions;
}): boolean {
  if (!params.workflow) {
    return false;
  }

  const patchResult = createStoryboardNodePatchResult(
    params.workflow,
    params.nodeId,
    params.updater,
  );
  if (!patchResult) {
    return false;
  }

  params.applyRuntimeSnapshot(patchResult.runtimeSnapshot, params.applyOptions ?? {
    hydrateCanvas: true,
    hydrationReason: 'external-output',
  });
  return true;
}

export function patchStoryboardShotRuntimeState(params: {
  workflow: Workflow | null;
  nodeId: string;
  shotId: string;
  updater: (shots: StoryboardShotData[]) => StoryboardShotData[];
  applyRuntimeSnapshot: StoryboardRuntimeStateApplier;
  applyOptions?: WorkflowRuntimeSyncOptions;
}): boolean {
  if (!params.workflow) {
    return false;
  }

  const patchResult = createStoryboardShotPatchResult(
    params.workflow,
    params.nodeId,
    params.shotId,
    params.updater,
  );
  if (!patchResult) {
    return false;
  }

  params.applyRuntimeSnapshot(patchResult.runtimeSnapshot, params.applyOptions ?? {
    hydrateCanvas: true,
    hydrationReason: 'external-output',
  });
  return true;
}
