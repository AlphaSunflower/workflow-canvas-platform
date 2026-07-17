import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';

export interface AIImageGenParameterField {
  key: 'prompt' | 'aspectRatio' | 'imageSize';
  label: string;
}

export const AI_IMAGE_GEN_PARAMETER_FIELDS: AIImageGenParameterField[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'aspectRatio', label: 'Aspect' },
  { key: 'imageSize', label: 'Resolution' },
];

export function buildAIImageGenInputLayoutVersion(
  resolvedGroupStates: WorkflowResolvedNodeGroupState[],
): string {
  return resolvedGroupStates
    .map((groupState) => [
      groupState.group.id,
      groupState.ports
        .map((port) => [
          port.portId,
          port.inputs.map((input) => input.sourceNode.id.value).join(','),
        ].join(':'))
        .join('|'),
    ].join(':'))
    .join('|');
}
