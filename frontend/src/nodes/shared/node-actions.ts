import type { AINodeData, Workflow } from '@/types';
import type { WorkflowConnectionInput } from '@/contracts/workflow';
import type {
  NodeActionContext,
  NodeActionDefinition,
  NodeActionOptions,
  NodeDefinition,
  NodeValidationResult,
} from '../types';
import type {
  NodeActionServiceRegistry,
  NodeActionServiceRegistryContext,
} from './node-action-service-registry';
import { defaultNodeActionServiceRegistry } from './node-action-service-registry.default';

export interface RunNodeActionInput<TOptions extends NodeActionOptions = NodeActionOptions> {
  workflow: Workflow;
  node: AINodeData;
  actionId: string;
  inputs: WorkflowConnectionInput[];
  targetId?: string;
  options?: TOptions;
  services?: unknown;
  resolveServices?: (context: NodeActionServiceRegistryContext<TOptions>) => unknown;
  serviceRegistry?: NodeActionServiceRegistry;
  resolveNodeDefinition?: (nodeType: AINodeData['type']) => Pick<NodeDefinition, 'actions'> | null;
}

export function resolveNodeActionServices<TOptions extends NodeActionOptions = NodeActionOptions>(
  input: RunNodeActionInput<TOptions>,
): unknown {
  const context: NodeActionServiceRegistryContext<TOptions> = {
    workflow: input.workflow,
    node: input.node,
    actionId: input.actionId,
    inputs: input.inputs,
    targetId: input.targetId,
    options: input.options,
    services: input.services,
  };

  if (input.resolveServices) {
    return input.resolveServices(context);
  }

  return (input.serviceRegistry ?? defaultNodeActionServiceRegistry).resolve(context);
}

export function getNodeActionDefinition(
  nodeType: AINodeData['type'],
  actionId: string,
  resolveNodeDefinition: (nodeType: AINodeData['type']) => Pick<NodeDefinition, 'actions'> | null,
): NodeActionDefinition | null {
  const definition = resolveNodeDefinition(nodeType);
  if (!definition?.actions) {
    return null;
  }

  return definition.actions.find((action) => action.id === actionId) ?? null;
}

export function createNodeActionContext<TOptions extends NodeActionOptions = NodeActionOptions>(
  input: RunNodeActionInput<TOptions>,
): NodeActionContext<TOptions> {
  return {
    workflow: input.workflow,
    node: input.node,
    inputs: input.inputs,
    targetId: input.targetId,
    options: (input.options ?? {}) as TOptions,
    services: resolveNodeActionServices(input),
  };
}

export function validateNodeAction<TOptions extends NodeActionOptions = NodeActionOptions>(
  action: NodeActionDefinition<TOptions>,
  context: NodeActionContext<TOptions>,
): NodeValidationResult {
  if (action.targetRequired && (!context.targetId || context.targetId.trim().length === 0)) {
    return {
      valid: false,
      reason: `Node action "${action.id}" requires a target id.`,
    };
  }

  return action.validate?.(context) ?? { valid: true };
}

export async function runNodeActionDefinition<TOptions extends NodeActionOptions = NodeActionOptions>(
  action: NodeActionDefinition<TOptions>,
  context: NodeActionContext<TOptions>,
): Promise<void> {
  const validation = validateNodeAction(action, context);
  if (!validation.valid) {
    throw new Error(validation.reason ?? `Node action "${action.id}" is invalid.`);
  }

  await action.run(context);
}

export async function runNodeAction<TOptions extends NodeActionOptions = NodeActionOptions>(
  input: RunNodeActionInput<TOptions>,
): Promise<void> {
  if (!input.resolveNodeDefinition) {
    throw new Error('Node action resolution requires a node definition resolver.');
  }

  const action = getNodeActionDefinition(
    input.node.type,
    input.actionId,
    input.resolveNodeDefinition,
  );
  if (!action) {
    throw new Error(`Node action "${input.actionId}" is not registered for node type "${input.node.type}".`);
  }

  const context = createNodeActionContext(input);
  await runNodeActionDefinition(action, context);
}
