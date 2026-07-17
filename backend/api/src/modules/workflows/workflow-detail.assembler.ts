import type { FileAssetResponse, WorkflowDetailResponseData } from "@newworkflow/backend-shared/api";
import { WorkflowFileHydrator } from "./workflow-file-hydrator.ts";

export interface WorkflowBindingLookup {
  listBindings(
    workflowId: string,
  ): Promise<Array<{ fileId: string }>>;
}

export interface WorkflowFileLookup {
  findFilesByIds(fileIds: string[]): Promise<FileAssetResponse[]>;
}

export class WorkflowDetailAssembler {
  private readonly bindings: WorkflowBindingLookup;
  private readonly files: WorkflowFileLookup;
  private readonly fileHydrator: WorkflowFileHydrator;

  constructor(
    bindings: WorkflowBindingLookup,
    files: WorkflowFileLookup,
    fileHydrator: WorkflowFileHydrator = new WorkflowFileHydrator(),
  ) {
    this.bindings = bindings;
    this.files = files;
    this.fileHydrator = fileHydrator;
  }

  async assemble(detail: WorkflowDetailResponseData): Promise<WorkflowDetailResponseData> {
    const bindings = await this.bindings.listBindings(detail.workflowId);
    const fileIds = Array.from(new Set(bindings.map((binding) => binding.fileId)));
    const files = await this.files.findFilesByIds(fileIds);
    const filesById = new Map(files.map((file) => [file.fileId, file]));

    return {
      ...detail,
      workflow: {
        ...detail.workflow,
        nodes: this.fileHydrator.hydrateNodes(detail.workflow.nodes, filesById),
      },
    };
  }
}

