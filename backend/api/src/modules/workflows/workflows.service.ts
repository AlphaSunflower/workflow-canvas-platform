import { randomUUID } from "node:crypto";

import type {
  DeleteWorkflowGroupResponseData,
  DeleteWorkflowResponseData,
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
  WorkflowListResponseData,
} from "@newworkflow/backend-shared/api";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import type { FilesRepository } from "../files/files.repository.types.ts";
import type {
  WorkflowFilesRepository,
  WorkflowGroupRepository,
  WorkflowRepository,
} from "./workflow.repository.types.ts";
import {
  type CreateBlankWorkflowCommand,
  type CreateWorkflowCommand,
  type CreateWorkflowGroupCommand,
  type MoveWorkflowGroupCommand,
  type RenameWorkflowCommand,
  type RenameWorkflowGroupCommand,
  toWorkflowPayload,
  type UpdateWorkflowCommand,
} from "./workflows.contracts.ts";
import { WorkflowAccessPolicy } from "./workflow-access.policy.ts";
import { WorkflowNodeSanitizer } from "./workflow-node-sanitizer.ts";
import { WorkflowFileHydrator } from "./workflow-file-hydrator.ts";
import { WorkflowDetailAssembler } from "./workflow-detail.assembler.ts";
import { WorkflowFileBindingService } from "./workflow-file-binding.service.ts";
import { collectWorkflowFileBindings } from "./workflow-files.repository.ts";
import { WorkflowNamingService } from "./workflow-naming.service.ts";
import { createBlankWorkflowPayload } from "./workflow-payload.factory.ts";
import { WorkflowSummaryMapper } from "./workflow-summary.mapper.ts";

export interface WorkflowsServiceCollaborators {
  accessPolicy?: WorkflowAccessPolicy;
  nodeSanitizer?: WorkflowNodeSanitizer;
  fileHydrator?: WorkflowFileHydrator;
  detailAssembler?: WorkflowDetailAssembler;
  fileBindingService?: WorkflowFileBindingService;
  namingService?: WorkflowNamingService;
  summaryMapper?: WorkflowSummaryMapper;
}

export class WorkflowsService {
  private readonly repository: WorkflowRepository;
  private readonly workflowGroupsRepository: WorkflowGroupRepository;
  private readonly workflowFilesRepository: WorkflowFilesRepository;
  private readonly filesRepository: FilesRepository;
  private readonly accessPolicy: WorkflowAccessPolicy;
  private readonly nodeSanitizer: WorkflowNodeSanitizer;
  private readonly detailAssembler: WorkflowDetailAssembler;
  private readonly fileBindingService: WorkflowFileBindingService;
  private readonly namingService: WorkflowNamingService;
  private readonly summaryMapper: WorkflowSummaryMapper;

  constructor(
    repository: WorkflowRepository,
    workflowGroupsRepository: WorkflowGroupRepository,
    workflowFilesRepository: WorkflowFilesRepository,
    filesRepository: FilesRepository,
    collaborators: WorkflowsServiceCollaborators = {},
  ) {
    this.repository = repository;
    this.workflowGroupsRepository = workflowGroupsRepository;
    this.workflowFilesRepository = workflowFilesRepository;
    this.filesRepository = filesRepository;
    this.accessPolicy = collaborators.accessPolicy ?? new WorkflowAccessPolicy();
    this.nodeSanitizer = collaborators.nodeSanitizer ?? new WorkflowNodeSanitizer();
    const fileHydrator = collaborators.fileHydrator ?? new WorkflowFileHydrator();
    this.summaryMapper = collaborators.summaryMapper ?? new WorkflowSummaryMapper();
    this.detailAssembler = collaborators.detailAssembler
      ?? new WorkflowDetailAssembler(
        workflowFilesRepository,
        filesRepository,
        fileHydrator,
      );
    this.fileBindingService = collaborators.fileBindingService
      ?? new WorkflowFileBindingService(workflowFilesRepository);
    this.namingService = collaborators.namingService
      ?? new WorkflowNamingService(
        repository,
        workflowGroupsRepository,
        this.summaryMapper,
      );
  }

  async createWorkflowForActor(
    authenticated: AuthenticatedAccount,
    request: CreateWorkflowCommand,
  ): Promise<WorkflowDetailResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();
    await this.filesRepository.ensureInitialized();

    const workflowId = request.id?.trim() || randomUUID();
    const payload = toWorkflowPayload(workflowId, request);
    const resolvedName = await this.namingService.resolveWorkflowNameForGroup({
      ownerUserId: authenticated.user.userId,
      desiredName: request.name,
      groupId: null,
    });
    const workflow = {
      ...payload,
      name: resolvedName.resolvedName,
      nodes: this.nodeSanitizer.sanitize(payload.nodes),
    };
    const workflowIdForBindings = workflowId;
    const bindings = collectWorkflowFileBindings(
      workflowIdForBindings,
      authenticated.user.userId,
      workflow.nodes,
      workflow.connections,
    );
    const created = this.repository.createWorkflowWithBindings
      ? await this.repository.createWorkflowWithBindings(
        authenticated.user.userId,
        workflow,
        bindings,
        {
          workflowId,
          groupId: null,
          isAutoNamed: resolvedName.usedFallbackName,
        },
      )
      : await this.repository.createWorkflow(
      authenticated.user.userId,
      workflow,
      {
        groupId: null,
        isAutoNamed: resolvedName.usedFallbackName,
      },
    );

    if (!this.repository.createWorkflowWithBindings) {
      await this.fileBindingService.syncWorkflowBindings(
        created.workflowId,
        created.ownerUserId,
        created.workflow,
      );
    }
    return this.detailAssembler.assemble(created);
  }

  async listWorkflowsForActor(
    authenticated: AuthenticatedAccount,
  ): Promise<WorkflowListResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();

    const items = authenticated.user.role === "admin"
      ? await this.repository.listAll()
      : await this.repository.listByOwner(authenticated.user.userId);
    const groups = authenticated.user.role === "admin"
      ? await this.workflowGroupsRepository.listAll()
      : await this.workflowGroupsRepository.listByOwner(authenticated.user.userId);

    return {
      items,
      groups: this.summaryMapper.applyGroupWorkflowCounts(groups, items),
      total: items.length,
    };
  }

  async listManagedWorkflowsForActor(
    authenticated: AuthenticatedAccount,
  ): Promise<WorkflowListResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();

    const items = await this.repository.listByOwner(authenticated.user.userId);
    const groups = await this.workflowGroupsRepository.listByOwner(authenticated.user.userId);

    return {
      items,
      groups: this.summaryMapper.applyGroupWorkflowCounts(groups, items),
      total: items.length,
    };
  }

  async createBlankWorkflowForActor(
    authenticated: AuthenticatedAccount,
    request: CreateBlankWorkflowCommand,
  ): Promise<WorkflowDetailResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();
    await this.filesRepository.ensureInitialized();

    if (request.groupId) {
      this.accessPolicy.assertCanAccessGroup(
        authenticated,
        await this.workflowGroupsRepository.findById(request.groupId),
      );
    }

    const workflowId = request.id?.trim() || undefined;
    const resolvedName = await this.namingService.resolveWorkflowNameForGroup({
      ownerUserId: authenticated.user.userId,
      desiredName: request.name,
      groupId: request.groupId ?? null,
    });
    const created = await this.repository.createWorkflow(
      authenticated.user.userId,
      createBlankWorkflowPayload(workflowId, request, resolvedName.resolvedName),
      {
        workflowId,
        groupId: request.groupId ?? null,
        isAutoNamed: resolvedName.usedFallbackName,
      },
    );

    await this.workflowFilesRepository.ensureInitialized(created.workflowId);
    return this.detailAssembler.assemble(created);
  }

  async createGroupForActor(
    authenticated: AuthenticatedAccount,
    request: CreateWorkflowGroupCommand,
  ): Promise<WorkflowGroupSummaryItem> {
    await this.workflowGroupsRepository.ensureInitialized();
    const resolvedName = await this.namingService.resolveGroupName({
      ownerUserId: authenticated.user.userId,
      desiredName: request.name,
    });

    return this.workflowGroupsRepository.createGroup(
      authenticated.user.userId,
      resolvedName.resolvedName,
    );
  }

  async renameGroupForActor(
    authenticated: AuthenticatedAccount,
    groupId: string,
    request: RenameWorkflowGroupCommand,
  ): Promise<WorkflowGroupSummaryItem> {
    await this.workflowGroupsRepository.ensureInitialized();
    this.accessPolicy.assertCanAccessGroup(
      authenticated,
      await this.workflowGroupsRepository.findById(groupId),
    );

    const resolvedName = await this.namingService.resolveGroupName({
      ownerUserId: authenticated.user.userId,
      desiredName: request.name,
      excludedGroupId: groupId,
    });

    return this.workflowGroupsRepository.renameGroup(groupId, resolvedName.resolvedName);
  }

  async deleteGroupForActor(
    authenticated: AuthenticatedAccount,
    groupId: string,
  ): Promise<DeleteWorkflowGroupResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();
    this.accessPolicy.assertCanAccessGroup(
      authenticated,
      await this.workflowGroupsRepository.findById(groupId),
    );

    const items = await this.repository.listByOwner(authenticated.user.userId);
    const groupedItems = items.filter((item) => item.groupId === groupId);
    let ungroupedItems = items.filter((item) => item.groupId === null);

    for (const item of groupedItems) {
      const resolvedName = this.namingService.resolveWorkflowNameFromItems(
        ungroupedItems,
        item.name,
      );
      const updated = await this.repository.updateWorkflowMetadata(item.workflowId, {
        name: resolvedName.resolvedName,
        groupId: null,
      });
      ungroupedItems = [...ungroupedItems, this.summaryMapper.fromDetail(updated)];
    }

    await this.workflowGroupsRepository.deleteGroup(groupId);

    return {
      groupId,
      movedWorkflowCount: groupedItems.length,
      deleted: true,
    };
  }

  async renameWorkflowForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
    request: RenameWorkflowCommand,
  ): Promise<WorkflowDetailResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowFilesRepository.ensureInitialized(workflowId);
    await this.filesRepository.ensureInitialized();
    const existing = this.accessPolicy.assertCanManageWorkflowDetail(
      authenticated,
      await this.repository.findById(workflowId),
    );

    const resolvedName = await this.namingService.resolveWorkflowNameForGroup({
      ownerUserId: authenticated.user.userId,
      desiredName: request.name,
      groupId: existing.groupId,
      excludedWorkflowId: workflowId,
    });
    const updated = await this.repository.updateWorkflowMetadata(workflowId, {
      name: resolvedName.resolvedName,
      isAutoNamed: false,
    });

    return this.detailAssembler.assemble(updated);
  }

  async moveWorkflowGroupForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
    request: MoveWorkflowGroupCommand,
  ): Promise<WorkflowDetailResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();
    await this.workflowFilesRepository.ensureInitialized(workflowId);
    await this.filesRepository.ensureInitialized();
    const existing = this.accessPolicy.assertCanManageWorkflowDetail(
      authenticated,
      await this.repository.findById(workflowId),
    );

    if (request.groupId) {
      this.accessPolicy.assertCanAccessGroup(
        authenticated,
        await this.workflowGroupsRepository.findById(request.groupId),
      );
    }

    const resolvedName = await this.namingService.resolveWorkflowNameForGroup({
      ownerUserId: authenticated.user.userId,
      desiredName: existing.workflow.name,
      groupId: request.groupId,
      excludedWorkflowId: workflowId,
    });
    const updated = await this.repository.updateWorkflowMetadata(workflowId, {
      name: resolvedName.resolvedName,
      groupId: request.groupId,
    });

    return this.detailAssembler.assemble(updated);
  }

  async deleteWorkflowForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
  ): Promise<DeleteWorkflowResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowFilesRepository.ensureInitialized(workflowId);
    this.accessPolicy.assertCanManageWorkflowDetail(
      authenticated,
      await this.repository.findById(workflowId),
    );

    await this.fileBindingService.deleteWorkflowBindings(workflowId);
    await this.repository.deleteWorkflow(workflowId);

    return {
      workflowId,
      deleted: true,
    };
  }

  async getWorkflowForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
  ): Promise<WorkflowDetailResponseData | null> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();
    await this.workflowFilesRepository.ensureInitialized(workflowId);
    await this.filesRepository.ensureInitialized();
    const workflow = await this.repository.findById(workflowId);

    if (!workflow) {
      return null;
    }

    this.accessPolicy.assertCanAccessWorkflow(authenticated, workflow.ownerUserId);
    return this.detailAssembler.assemble(workflow);
  }

  async updateWorkflowForActor(
    authenticated: AuthenticatedAccount,
    workflowId: string,
    request: UpdateWorkflowCommand,
  ): Promise<WorkflowDetailResponseData> {
    await this.repository.ensureInitialized();
    await this.workflowGroupsRepository.ensureInitialized();
    await this.workflowFilesRepository.ensureInitialized(workflowId);
    await this.filesRepository.ensureInitialized();
    const existing = this.accessPolicy.assertCanUpdateWorkflowDetail(
      authenticated,
      await this.repository.findById(workflowId),
    );
    const payload = toWorkflowPayload(workflowId, request);
    const workflow = {
      ...payload,
      nodes: this.nodeSanitizer.sanitize(payload.nodes),
    };
    const bindings = collectWorkflowFileBindings(
      workflowId,
      existing.ownerUserId,
      workflow.nodes,
      workflow.connections,
    );
    const updated = this.repository.updateWorkflowWithBindings
      ? await this.repository.updateWorkflowWithBindings(
        workflowId,
        existing.ownerUserId,
        workflow,
        bindings,
      )
      : await this.repository.updateWorkflow(
      workflowId,
      existing.ownerUserId,
      workflow,
    );

    if (!this.repository.updateWorkflowWithBindings) {
      await this.fileBindingService.syncWorkflowBindings(
        updated.workflowId,
        updated.ownerUserId,
        updated.workflow,
      );
    }
    return this.detailAssembler.assemble(updated);
  }
}
