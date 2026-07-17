import fs from "node:fs/promises";
import path from "node:path";

import {
  AI_MULTI_VIEW_RESTORE_OUTPUT_NODE_ID,
  AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_FIELD_NAME,
  AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_NODE_ID,
  AI_MULTI_VIEW_RESTORE_RENDER_INPUT_FIELD_NAME,
  AI_MULTI_VIEW_RESTORE_RENDER_INPUT_NODE_ID,
  AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
  AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
  AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
  AI_IMAGE_TO_PLY_INPUT_NODE_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
  createEnv,
} from "@newworkflow/backend-shared";
import { createRunningHubValidationError } from "./runninghub.errors.ts";
import type {
  RunningHubBuildNodeInfoListInput,
  RunningHubBuildNodeInfoListResult,
  RunningHubResolvedWorkflowTemplate,
  RunningHubWorkflowTemplateDescriptor,
  RunningHubWorkflowTemplateDocument,
  RunningHubWorkflowTemplateNode,
} from "./runninghub-workflow-template.types.ts";

const DEFAULT_TEMPLATE_DESCRIPTOR: RunningHubWorkflowTemplateDescriptor = {
  templateKey: AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
  workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
  fileName: "sharp_api.json",
  inputBindings: [
    {
      inputKey: "input",
      nodeId: AI_IMAGE_TO_PLY_INPUT_NODE_ID,
      fieldName: AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
    },
  ],
};

const MULTI_VIEW_RESTORE_TEMPLATE_DESCRIPTOR: RunningHubWorkflowTemplateDescriptor = {
  templateKey: AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
  workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
  fileName: "multi-view-restore_api.json",
  inputBindings: [
    {
      inputKey: "render",
      nodeId: AI_MULTI_VIEW_RESTORE_RENDER_INPUT_NODE_ID,
      fieldName: AI_MULTI_VIEW_RESTORE_RENDER_INPUT_FIELD_NAME,
    },
    {
      inputKey: "reference",
      nodeId: AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_NODE_ID,
      fieldName: AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_FIELD_NAME,
    },
  ],
  outputNodeIds: [AI_MULTI_VIEW_RESTORE_OUTPUT_NODE_ID],
};

export interface RunningHubWorkflowTemplateServiceOptions {
  backendRoot?: string;
  snapshotDir?: string;
  descriptors?: RunningHubWorkflowTemplateDescriptor[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readNodeInputField(
  node: RunningHubWorkflowTemplateNode | undefined,
  fieldName: string,
): boolean {
  return Boolean(
    node
    && isRecord(node.inputs)
    && Object.prototype.hasOwnProperty.call(node.inputs, fieldName),
  );
}

function readNode(nodeId: string, document: RunningHubWorkflowTemplateDocument) {
  return document[nodeId];
}

export class RunningHubWorkflowTemplateService {
  private readonly backendRoot: string;
  private readonly snapshotDir: string;
  private readonly descriptorMap: Map<string, RunningHubWorkflowTemplateDescriptor>;

  constructor(options: RunningHubWorkflowTemplateServiceOptions = {}) {
    this.backendRoot = options.backendRoot
      ?? path.resolve(import.meta.dirname, "../../../../..");
    this.snapshotDir = options.snapshotDir
      ?? path.resolve(this.backendRoot, createEnv("worker").providerSnapshotDir);
    this.descriptorMap = new Map(
      (options.descriptors ?? [
        DEFAULT_TEMPLATE_DESCRIPTOR,
        MULTI_VIEW_RESTORE_TEMPLATE_DESCRIPTOR,
      ]).map((descriptor) => [
        descriptor.templateKey,
        descriptor,
      ]),
    );
  }

  async loadTemplate(
    templateKey: string = AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
  ): Promise<RunningHubResolvedWorkflowTemplate> {
    const descriptor = this.descriptorMap.get(templateKey);

    if (!descriptor) {
      throw createRunningHubValidationError("RunningHub workflow template key 不存在。", {
        templateKey,
      });
    }

    const absolutePath = path.join(this.backendRoot, "runninghub", descriptor.fileName);
    let raw = "";

    try {
      raw = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      throw createRunningHubValidationError("RunningHub workflow 模板文件不存在。", {
        templateKey,
        absolutePath,
        cause: error instanceof Error ? error.message : "READ_FAILED",
      });
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw createRunningHubValidationError("RunningHub workflow 模板文件不是合法 JSON。", {
        templateKey,
        absolutePath,
        cause: error instanceof Error ? error.message : "INVALID_JSON",
      });
    }

    if (!isRecord(parsed)) {
      throw createRunningHubValidationError("RunningHub workflow 模板根结构无效。", {
        templateKey,
        absolutePath,
      });
    }

    const document = parsed as RunningHubWorkflowTemplateDocument;
    this.validateTemplateDocument(descriptor, document, absolutePath);

    return {
      descriptor,
      absolutePath,
      document,
    };
  }

  async buildNodeInfoList(
    input: RunningHubBuildNodeInfoListInput,
  ): Promise<RunningHubBuildNodeInfoListResult> {
    const resolved = await this.loadTemplate(input.templateKey);
    const uploadedFileNames = this.resolveUploadedFileNames(input, resolved.descriptor);
    const nodeInfoList = resolved.descriptor.inputBindings.map((binding) => ({
      nodeId: binding.nodeId,
      fieldName: binding.fieldName,
      fieldValue: uploadedFileNames[binding.inputKey],
    }));

    const snapshotPath = await this.saveNodeInfoListSnapshot({
      templateKey: resolved.descriptor.templateKey,
      workflowId: resolved.descriptor.workflowId,
      templatePath: resolved.absolutePath,
      nodeInfoList,
      label: input.snapshotLabel ?? "runninghub-node-info-list",
    });

    return {
      templateKey: resolved.descriptor.templateKey,
      workflowId: resolved.descriptor.workflowId,
      nodeInfoList,
      snapshotPath,
    };
  }

  private validateTemplateDocument(
    descriptor: RunningHubWorkflowTemplateDescriptor,
    document: RunningHubWorkflowTemplateDocument,
    absolutePath: string,
  ): void {
    descriptor.inputBindings.forEach((binding) => {
      const inputNode = readNode(binding.nodeId, document);

      if (!inputNode) {
        throw createRunningHubValidationError("RunningHub workflow 模板缺少输入节点。", {
          templateKey: descriptor.templateKey,
          absolutePath,
          inputKey: binding.inputKey,
          inputNodeId: binding.nodeId,
        });
      }

      if (!readNodeInputField(inputNode, binding.fieldName)) {
        throw createRunningHubValidationError("RunningHub workflow 模板缺少输入字段。", {
          templateKey: descriptor.templateKey,
          absolutePath,
          inputKey: binding.inputKey,
          inputNodeId: binding.nodeId,
          inputFieldName: binding.fieldName,
        });
      }
    });

    descriptor.outputNodeIds?.forEach((outputNodeId) => {
      const outputNode = readNode(outputNodeId, document);

      if (!outputNode) {
        throw createRunningHubValidationError("RunningHub workflow 模板缺少输出节点。", {
          templateKey: descriptor.templateKey,
          absolutePath,
          outputNodeId,
        });
      }
    });
  }

  private resolveUploadedFileNames(
    input: RunningHubBuildNodeInfoListInput,
    descriptor: RunningHubWorkflowTemplateDescriptor,
  ): Record<string, string> {
    if (
      isRecord(input.uploadedFileNames)
      && Object.keys(input.uploadedFileNames).length > 0
    ) {
      const resolvedEntries = descriptor.inputBindings.map((binding) => {
        const rawValue = input.uploadedFileNames?.[binding.inputKey];
        const fileName = typeof rawValue === "string" ? rawValue.trim() : "";

        if (!fileName) {
          throw createRunningHubValidationError("RunningHub 上传返回 fileName 不能为空。", {
            templateKey: descriptor.templateKey,
            inputKey: binding.inputKey,
          });
        }

        return [binding.inputKey, fileName] as const;
      });

      return Object.fromEntries(resolvedEntries);
    }

    if (descriptor.inputBindings.length !== 1) {
      throw createRunningHubValidationError("RunningHub 多输入模板必须提供 uploadedFileNames。", {
        templateKey: descriptor.templateKey,
      });
    }

    const uploadedFileName = typeof input.uploadedFileName === "string"
      ? input.uploadedFileName.trim()
      : "";

    if (!uploadedFileName) {
      throw createRunningHubValidationError("RunningHub 上传返回 fileName 不能为空。", {
        templateKey: descriptor.templateKey,
      });
    }

    return {
      [descriptor.inputBindings[0]?.inputKey ?? "input"]: uploadedFileName,
    };
  }

  private async saveNodeInfoListSnapshot(input: {
    templateKey: string;
    workflowId: string;
    templatePath: string;
    nodeInfoList: Array<{
      nodeId: string;
      fieldName: string;
      fieldValue: string;
    }>;
    label: string;
  }): Promise<string> {
    await fs.mkdir(this.snapshotDir, { recursive: true });

    const safeLabel = input.label.replace(/[^a-zA-Z0-9-_]/g, "-");
    const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${safeLabel}.json`;
    const absolutePath = path.join(this.snapshotDir, fileName);

    await fs.writeFile(
      absolutePath,
      JSON.stringify(
        {
          provider: "runninghub",
          templateKey: input.templateKey,
          workflowId: input.workflowId,
          templatePath: input.templatePath,
          nodeInfoList: input.nodeInfoList,
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    return absolutePath;
  }
}
