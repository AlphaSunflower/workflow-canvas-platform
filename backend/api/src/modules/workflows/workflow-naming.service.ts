import type { WorkflowSummaryItem } from "@newworkflow/backend-shared/api";
import {
  DEFAULT_WORKFLOW_GROUP_NAME,
  DEFAULT_WORKFLOW_NAME,
  resolveWindowsLikeName,
  type ResolvedWindowsLikeName,
} from "./workflow-name-resolver.ts";
import type {
  WorkflowGroupRepository,
  WorkflowRepository,
} from "./workflow.repository.types.ts";
import { resolveWorkflowContainerKey } from "./workflow-storage.types.ts";
import { WorkflowSummaryMapper } from "./workflow-summary.mapper.ts";

export interface ResolveWorkflowNameInput {
  ownerUserId: string;
  desiredName: string | null | undefined;
  groupId?: string | null;
  excludedWorkflowId?: string;
}

export interface ResolveGroupNameInput {
  ownerUserId: string;
  desiredName: string | null | undefined;
  excludedGroupId?: string;
}

export class WorkflowNamingService {
  private readonly repository: Pick<WorkflowRepository, "listByOwnerAndContainer">;
  private readonly groupsRepository: Pick<WorkflowGroupRepository, "listByOwner">;
  private readonly summaryMapper: WorkflowSummaryMapper;

  constructor(
    repository: Pick<WorkflowRepository, "listByOwnerAndContainer">,
    groupsRepository: Pick<WorkflowGroupRepository, "listByOwner">,
    summaryMapper: WorkflowSummaryMapper = new WorkflowSummaryMapper(),
  ) {
    this.repository = repository;
    this.groupsRepository = groupsRepository;
    this.summaryMapper = summaryMapper;
  }

  async resolveWorkflowNameForGroup(
    input: ResolveWorkflowNameInput,
  ): Promise<ResolvedWindowsLikeName> {
    const items = await this.repository.listByOwnerAndContainer(
      input.ownerUserId,
      resolveWorkflowContainerKey(input.groupId ?? null),
    );

    return this.resolveWorkflowNameFromItems(
      items,
      input.desiredName,
      input.excludedWorkflowId,
    );
  }

  resolveWorkflowNameFromItems(
    items: WorkflowSummaryItem[],
    desiredName: string | null | undefined,
    excludedWorkflowId?: string,
  ): ResolvedWindowsLikeName {
    return resolveWindowsLikeName({
      desiredName,
      fallbackBaseName: DEFAULT_WORKFLOW_NAME,
      existingNames: this.summaryMapper.collectWorkflowPeerNames(
        items,
        excludedWorkflowId,
      ),
    });
  }

  async resolveGroupName(
    input: ResolveGroupNameInput,
  ): Promise<ResolvedWindowsLikeName> {
    const groups = await this.groupsRepository.listByOwner(input.ownerUserId);

    return resolveWindowsLikeName({
      desiredName: input.desiredName,
      fallbackBaseName: DEFAULT_WORKFLOW_GROUP_NAME,
      existingNames: this.summaryMapper.collectGroupPeerNames(
        groups,
        input.excludedGroupId,
      ),
    });
  }
}
