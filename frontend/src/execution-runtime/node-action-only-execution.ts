import type { NodeActionOnlyExecutionMode, NodeExecutionPlan } from '@/nodes/types';

export const NODE_ACTION_ONLY_EXECUTION_MODE: NodeActionOnlyExecutionMode = 'node-action-only';

export interface NodeActionOnlyExecutionRequest {
  boundary: typeof NODE_ACTION_ONLY_EXECUTION_MODE;
  actionIds: string[];
  plan: NodeExecutionPlan;
}

function normalizeActionIds(actionIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  actionIds.forEach((actionId) => {
    const trimmed = actionId.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
}

export function createNodeActionOnlyExecutionRequest(input: {
  actionIds: readonly string[];
  plan: NodeExecutionPlan;
}): NodeActionOnlyExecutionRequest {
  return {
    boundary: NODE_ACTION_ONLY_EXECUTION_MODE,
    actionIds: normalizeActionIds(input.actionIds),
    plan: input.plan,
  };
}
