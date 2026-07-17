import { createHash } from "node:crypto";

import { ExecutionsRepository } from "../../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../../api/src/modules/files/files.repository.ts";
import { createAIImageToPlyRequest } from "./execution-request.fixture.ts";

export async function registerReadyImageFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const registerResult = await filesRepository.registerFile({
    userId,
    sha256,
    size: buffer.length,
    mimeType: "image/png",
    originalName,
    fileType: "image",
    sourceType: "input",
  });

  if (registerResult.uploadRequired && registerResult.uploadId) {
    await filesRepository.uploadFile(
      registerResult.uploadId,
      buffer.toString("base64"),
    );
  }

  return registerResult.file.fileId;
}

export async function createRunningHubImageToPlyExecution(input: {
  executionsService: ExecutionsService;
  userId?: string;
  workflowId?: string;
  nodeId: string;
  nodeTitle: string;
  sourceFileIds: string[];
  groupIds?: string[];
}) {
  return input.executionsService.createExecution(createAIImageToPlyRequest({
    userId: input.userId,
    workflowId: input.workflowId,
    nodeId: input.nodeId,
    nodeTitle: input.nodeTitle,
    groups: input.sourceFileIds.map((sourceFileId, index) => ({
      groupId: input.groupIds?.[index] ?? `group-${index + 1}`,
      sourceFileId,
    })),
  }));
}

export async function loadTasksByCreateResult(
  executionsRepository: ExecutionsRepository,
  taskIds: string[],
) {
  return Promise.all(taskIds.map((taskId) => executionsRepository.getTaskById(taskId)));
}
