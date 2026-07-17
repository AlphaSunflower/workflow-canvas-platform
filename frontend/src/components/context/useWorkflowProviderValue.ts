import { useMemo } from 'react';
import type { WorkflowContextValue } from './workflow-context.types';
import type { WorkflowProviderSources } from './workflow-provider-sources';

export interface WorkflowProviderValueResult {
  actions: WorkflowContextValue['actions'];
  value: WorkflowContextValue;
}

export function useWorkflowProviderValue(
  sources: WorkflowProviderSources,
): WorkflowProviderValueResult {
  const {
    stateSource,
    actionSource,
    selectorSource,
    runtimeSource,
  } = sources;

  const actions = useMemo<WorkflowContextValue['actions']>(
    () => actionSource,
    [actionSource],
  );

  const value = useMemo<WorkflowContextValue>(() => ({
    state: stateSource,
    actions,
    selectors: selectorSource,
    runtime: runtimeSource,
  }), [actions, runtimeSource, selectorSource, stateSource]);

  return {
    actions,
    value,
  };
}
