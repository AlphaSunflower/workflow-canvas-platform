import type {
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
  WorkflowSummaryItem,
} from "@newworkflow/backend-shared/api";
import type { StoredWorkflowDocument } from "./workflow-storage.types.ts";
import type { WorkflowFileBindingRecord } from "./workflow-file-binding.types.ts";

export interface WorkflowRepository {
  ensureInitialized(): Promise<void>;
  listByOwner(ownerUserId: string): Promise<WorkflowSummaryItem[]>;
  listByOwnerAndContainer(
    ownerUserId: string,
    containerKey: string,
  ): Promise<WorkflowSummaryItem[]>;
  listAll(): Promise<WorkflowSummaryItem[]>;
  findSummaryById(workflowId: string): Promise<WorkflowSummaryItem | null>;
  findById(workflowId: string): Promise<WorkflowDetailResponseData | null>;
  createWorkflow(
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      workflowId?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData>;
  createWorkflowWithBindings?(
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    bindings: WorkflowFileBindingRecord[],
    options?: {
      workflowId?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData>;
  updateWorkflow(
    workflowId: string,
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData>;
  updateWorkflowWithBindings?(
    workflowId: string,
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    bindings: WorkflowFileBindingRecord[],
    options?: {
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData>;
  updateWorkflowMetadata(
    workflowId: string,
    updates: {
      name?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData>;
  deleteWorkflow(workflowId: string): Promise<WorkflowDetailResponseData>;
}

export interface WorkflowGroupRepository {
  ensureInitialized(): Promise<void>;
  listByOwner(ownerUserId: string): Promise<WorkflowGroupSummaryItem[]>;
  listAll(): Promise<WorkflowGroupSummaryItem[]>;
  findById(groupId: string): Promise<WorkflowGroupSummaryItem | null>;
  upsertGroup(
    input: Omit<WorkflowGroupSummaryItem, "createdAt" | "updatedAt">
      & Partial<Pick<WorkflowGroupSummaryItem, "createdAt" | "updatedAt">>,
  ): Promise<WorkflowGroupSummaryItem>;
  createGroup(ownerUserId: string, name: string): Promise<WorkflowGroupSummaryItem>;
  deleteGroup(groupId: string): Promise<void>;
  renameGroup(groupId: string, name: string): Promise<WorkflowGroupSummaryItem>;
  updateWorkflowCount(groupId: string, workflowCount: number): Promise<WorkflowGroupSummaryItem>;
}

export interface WorkflowFilesRepository {
  ensureInitialized(workflowId: string): Promise<void>;
  listBindings(workflowId: string): Promise<WorkflowFileBindingRecord[]>;
  replaceBindings(
    workflowId: string,
    bindings: WorkflowFileBindingRecord[],
  ): Promise<void>;
  deleteBindings(workflowId: string): Promise<void>;
}
