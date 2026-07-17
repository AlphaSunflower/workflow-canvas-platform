import type { AINodeData } from '@/types';
import type { AIPlaceholderNodeType, NodeDefinition, RegisteredAINodeType } from './types';
import { aiNodeDefinitions } from './definitions';

export const aiNodeRegistry: Record<RegisteredAINodeType, NodeDefinition> = aiNodeDefinitions.reduce(
  (accumulator, definition) => {
    accumulator[definition.type] = definition;
    return accumulator;
  },
  {} as Record<RegisteredAINodeType, NodeDefinition>
);

export function getNodeDefinition(type: AINodeData['type']): NodeDefinition | null {
  return aiNodeRegistry[type] ?? null;
}

export const placeholderNodeRegistry = aiNodeRegistry as Record<AIPlaceholderNodeType, NodeDefinition>;

export function getPlaceholderNodeDefinition(type: AINodeData['type']): NodeDefinition | null {
  return getNodeDefinition(type);
}
