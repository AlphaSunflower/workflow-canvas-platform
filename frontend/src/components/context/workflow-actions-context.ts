import { createContext } from 'react';
import type { WorkflowContextActions } from './workflow-context.types';

export const WorkflowActionsContext = createContext<WorkflowContextActions | null>(null);

