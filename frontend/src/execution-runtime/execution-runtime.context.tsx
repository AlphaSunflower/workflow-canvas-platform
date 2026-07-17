import { useMemo, type PropsWithChildren } from 'react';
import {
  executionRuntimeStore as defaultExecutionRuntimeStore,
  type ExecutionRuntimeStore,
} from './execution-runtime.store';
import { ExecutionRuntimeStoreContext } from './execution-runtime.context.shared';

export interface ExecutionRuntimeProviderProps extends PropsWithChildren {
  store?: ExecutionRuntimeStore;
}

export function ExecutionRuntimeProvider({
  children,
  store,
}: ExecutionRuntimeProviderProps): JSX.Element {
  const value = useMemo(() => store ?? defaultExecutionRuntimeStore, [store]);

  return (
    <ExecutionRuntimeStoreContext.Provider value={value}>
      {children}
    </ExecutionRuntimeStoreContext.Provider>
  );
}
