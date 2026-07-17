import { createContext } from 'react';
import type { WorkflowContextValue } from './workflow-context.types';

export type { WorkflowContextValue } from './workflow-context.types';

export const WorkflowContext = createContext<WorkflowContextValue | null>(null);
