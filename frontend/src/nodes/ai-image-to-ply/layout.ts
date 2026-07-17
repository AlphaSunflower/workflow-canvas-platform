import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';

export function buildAIImageToPlyInputLayoutVersion(
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
