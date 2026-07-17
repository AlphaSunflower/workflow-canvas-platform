import type { Node as ReactFlowNode } from 'reactflow';

import type { AINodeData, AnyNodeData, Workflow } from '@/types';
import { deepEqual, isAINodeData } from '@/utils';

export interface PatchNodeConfigParams<TConfig extends AINodeData['config'] = AINodeData['config']> {
  nodeId: string;
  expectedType?: AINodeData['type'];
  updatedAt?: number;
  updater: (config: TConfig, node: AINodeData) => Partial<TConfig> | null;
}

export interface PatchNodeConfigGraphResult {
  changed: boolean;
  nextNodes: ReactFlowNode<AnyNodeData>[];
}

export interface PatchNodeConfigWorkflowResult {
  changed: boolean;
  nextWorkflow: Workflow;
}

function hasConfigPatchChanges<TConfig extends AINodeData['config']>(
  currentConfig: TConfig,
  nextPatch: Partial<TConfig>,
): boolean {
  return Object.entries(nextPatch).some(([key, nextValue]) => (
    !deepEqual(
      currentConfig[key as keyof TConfig],
      nextValue,
    )
  ));
}

function patchNodeConfigData<TConfig extends AINodeData['config']>(
  currentData: AnyNodeData,
  params: Omit<PatchNodeConfigParams<TConfig>, 'nodeId'>,
): AINodeData | null {
  if (!isAINodeData(currentData)) {
    return null;
  }

  if (params.expectedType && currentData.type !== params.expectedType) {
    return null;
  }

  const currentConfig = currentData.config as TConfig;
  const nextPatch = params.updater(currentConfig, currentData);
  if (!nextPatch || !hasConfigPatchChanges(currentConfig, nextPatch)) {
    return null;
  }

  return {
    ...currentData,
    config: {
      ...currentData.config,
      ...nextPatch,
    },
    timestamp: {
      ...currentData.timestamp,
      updated: params.updatedAt ?? Date.now(),
    },
  };
}

export function patchNodeConfigInGraph<TConfig extends AINodeData['config'] = AINodeData['config']>(
  params: PatchNodeConfigParams<TConfig> & {
    nodes: ReactFlowNode<AnyNodeData>[];
  },
): PatchNodeConfigGraphResult {
  let changed = false;

  const nextNodes = params.nodes.map((node) => {
    if (node.id !== params.nodeId) {
      return node;
    }

    const nextData = patchNodeConfigData(node.data, params);
    if (!nextData) {
      return node;
    }

    changed = true;
    return {
      ...node,
      data: nextData,
      position: nextData.position,
    };
  });

  return {
    changed,
    nextNodes,
  };
}

export function patchNodeConfigInWorkflow<TConfig extends AINodeData['config'] = AINodeData['config']>(
  params: PatchNodeConfigParams<TConfig> & {
    workflow: Workflow;
  },
): PatchNodeConfigWorkflowResult {
  const currentNode = params.workflow.nodes[params.nodeId];
  if (!currentNode) {
    return {
      changed: false,
      nextWorkflow: params.workflow,
    };
  }

  const nextNode = patchNodeConfigData(currentNode, params);
  if (!nextNode) {
    return {
      changed: false,
      nextWorkflow: params.workflow,
    };
  }

  return {
    changed: true,
    nextWorkflow: {
      ...params.workflow,
      nodes: {
        ...params.workflow.nodes,
        [params.nodeId]: nextNode,
      },
      timestamp: {
        ...params.workflow.timestamp,
        updated: nextNode.timestamp.updated,
      },
    },
  };
}
