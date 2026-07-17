import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';

export function buildAIModelRenderTransferInputLayoutVersion(
  resolvedGroupStates: WorkflowResolvedNodeGroupState[],
): string {
  return resolvedGroupStates
    .map((groupState) => [
      groupState.group.id,
      groupState.group.label,
      groupState.group.order,
      groupState.ports
        .map((port) => [
          port.portId,
          port.handle,
          port.inputs.map((input) => `${input.connection.id}:${input.sourceNode.id.value}`).join(','),
        ].join(':'))
        .join('|'),
    ].join(':'))
    .join('|');
}
