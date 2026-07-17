import type { FileAssetResponse } from "@newworkflow/backend-shared/api";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import type { FilesRepository } from "../files/files.repository.types.ts";
import type { WorkflowRepository } from "../workflows/workflow.repository.types.ts";
import type {
  ExecutionCreateCommand,
  ExecutionCreateResult,
} from "./executions.contracts.ts";
import type { ExecutionsRepository } from "./executions.repository.types.ts";
import { ExecutionAccessPolicy } from "./execution-access.policy.ts";
import { ExecutionStoreInputBuilder } from "./execution-store-input.builder.ts";

export interface ExecutionsServiceCollaborators {
  accessPolicy?: ExecutionAccessPolicy;
  storeInputBuilder?: ExecutionStoreInputBuilder;
}

export class ExecutionsService {
  private readonly executionsRepository: ExecutionsRepository;
  private readonly filesRepository: FilesRepository;
  private readonly workflowRepository: WorkflowRepository;
  private readonly accessPolicy: ExecutionAccessPolicy;
  private readonly storeInputBuilder: ExecutionStoreInputBuilder;

  constructor(
    executionsRepository: ExecutionsRepository,
    filesRepository: FilesRepository,
    workflowRepository: WorkflowRepository,
    collaborators: ExecutionsServiceCollaborators = {},
  ) {
    this.executionsRepository = executionsRepository;
    this.filesRepository = filesRepository;
    this.workflowRepository = workflowRepository;
    this.accessPolicy = collaborators.accessPolicy ?? new ExecutionAccessPolicy();
    this.storeInputBuilder = collaborators.storeInputBuilder ?? new ExecutionStoreInputBuilder();
  }

  async createExecution(
    input: ExecutionCreateCommand,
  ): Promise<ExecutionCreateResult> {
    await this.requireReadyFiles(this.storeInputBuilder.collectFileIds(input));
    return this.executionsRepository.createExecution(
      this.storeInputBuilder.build(input),
    );
  }

  async createExecutionForActor(
    authenticated: AuthenticatedAccount,
    input: ExecutionCreateCommand,
  ): Promise<ExecutionCreateResult> {
    const workflowId = this.accessPolicy.assertWorkflowId(input.workflowId);

    await this.workflowRepository.ensureInitialized();
    const files = await this.requireReadyFiles(this.storeInputBuilder.collectFileIds(input));
    this.accessPolicy.assertFilesAccessible(authenticated, files);

    const workflow = this.accessPolicy.assertWorkflowAccessible(
      authenticated,
      await this.workflowRepository.findById(workflowId),
    );
    const storeInput = this.storeInputBuilder.build(input, {
      userId: authenticated.user.userId,
      workflowId: workflow.workflowId,
      projectId: workflow.workflow.projectId,
    });

    return this.executionsRepository.createExecution(storeInput);
  }

  private async requireReadyFiles(
    uniqueFileIds: string[],
  ): Promise<FileAssetResponse[]> {
    const files = await this.filesRepository.findReadyFilesByIds(uniqueFileIds);

    if (files.length !== uniqueFileIds.length) {
      const missingIds = uniqueFileIds.filter(
        (fileId) => !files.some((file) => file.fileId === fileId),
      );
      throw new Error(`FILE_NOT_FOUND:${missingIds.join(",")}`);
    }

    return files;
  }
}
