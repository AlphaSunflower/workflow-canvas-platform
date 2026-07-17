import type {
  PromptOptimizeCommand,
  PromptOptimizeResult,
} from "./prompt-optimize.contracts.ts";
import {
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_MAX_REFERENCE_COUNT,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_MIN_REFERENCE_COUNT,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION,
} from "./prompt-optimize.constants.ts";
import {
  preparePromptOptimizeImages,
  type PromptOptimizeImageInput,
} from "./prompt-optimize.image.ts";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import { FilesService } from "../files/files.service.ts";
import { LaozhangVisionClient } from "./providers/laozhang-vision.client.ts";

export class PromptOptimizeService {
  private readonly filesService: FilesService;
  private readonly visionClient: LaozhangVisionClient;

  constructor(
    filesService: FilesService,
    visionClient: LaozhangVisionClient,
  ) {
    this.filesService = filesService;
    this.visionClient = visionClient;
  }

  async optimizePromptForActor(
    authenticated: AuthenticatedAccount,
    request: PromptOptimizeCommand,
  ): Promise<PromptOptimizeResult> {
    this.assertRequestBoundary(request);

    const referenceImages = await this.readReferenceImages(
      authenticated,
      request.referenceFileIds,
    );
    const preparedImages = await this.prepareReferenceImages(referenceImages);
    const result = await this.visionClient.optimizePrompt({
      prompt: request.prompt.trim(),
      imageDataUrls: preparedImages.map((image) => image.dataUrl),
    });

    return {
      optimizedPrompt: result.optimizedPrompt,
      model: result.model,
      referenceCount: preparedImages.length,
      promptVersion: AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION,
    };
  }

  private assertRequestBoundary(request: PromptOptimizeCommand): void {
    if (request.nodeType !== AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (!request.prompt.trim()) {
      throw new Error("INVALID_PROMPT");
    }

    if (
      request.referenceFileIds.length < AI_IMAGE_GEN_PROMPT_OPTIMIZE_MIN_REFERENCE_COUNT
      || request.referenceFileIds.length > AI_IMAGE_GEN_PROMPT_OPTIMIZE_MAX_REFERENCE_COUNT
    ) {
      throw new Error("INVALID_REFERENCE_FILE_COUNT");
    }
  }

  private async readReferenceImages(
    authenticated: AuthenticatedAccount,
    referenceFileIds: string[],
  ): Promise<PromptOptimizeImageInput[]> {
    return Promise.all(
      referenceFileIds.map(async (fileId) => {
        const file = await this.filesService.downloadFileForActor(
          authenticated,
          fileId,
          "download",
        );

        if (!file) {
          throw new Error(`FILE_NOT_FOUND:${fileId}`);
        }

        if (!file.mimeType.toLowerCase().startsWith("image/")) {
          throw new Error("REFERENCE_FILE_NOT_IMAGE");
        }

        return {
          buffer: file.buffer,
          mimeType: file.mimeType,
        };
      }),
    );
  }

  private async prepareReferenceImages(
    images: PromptOptimizeImageInput[],
  ): Promise<Awaited<ReturnType<typeof preparePromptOptimizeImages>>> {
    try {
      return await preparePromptOptimizeImages(images);
    } catch {
      throw new Error("REFERENCE_IMAGE_PROCESS_FAILED");
    }
  }
}
