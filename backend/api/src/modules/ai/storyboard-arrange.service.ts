import type {
  StoryboardArrangeCommand,
  StoryboardArrangeResult,
  StoryboardArrangeShotCommand,
  StoryboardStoryArrangeCommand,
} from "./storyboard-arrange.contracts.ts";
import {
  AI_STORYBOARD_ARRANGE_IMAGE_MAX_DIMENSION,
  AI_STORYBOARD_ARRANGE_IMAGE_QUALITY,
  AI_STORYBOARD_ARRANGE_NODE_TYPE,
  AI_STORYBOARD_ARRANGE_PROMPT_VERSION,
  AI_STORYBOARD_STORY_PROMPT_VERSION,
} from "./storyboard-arrange.constants.ts";
import {
  buildStoryboardArrangeMessages,
  buildStoryboardStoryMessages,
} from "./storyboard-arrange.messages.ts";
import {
  parseStoryboardArrangeResult,
  parseStoryboardStoryArrangeResult,
} from "./storyboard-arrange.result.ts";
import {
  prepareAiMultimodalImages,
  type PromptOptimizeImageInput,
} from "./prompt-optimize.image.ts";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import { FilesService } from "../files/files.service.ts";
import { LaozhangVisionClient } from "./providers/laozhang-vision.client.ts";

export class StoryboardArrangeService {
  private readonly filesService: FilesService;
  private readonly visionClient: LaozhangVisionClient;

  constructor(
    filesService: FilesService,
    visionClient: LaozhangVisionClient,
  ) {
    this.filesService = filesService;
    this.visionClient = visionClient;
  }

  async arrangeShotsForActor(
    authenticated: AuthenticatedAccount,
    request: StoryboardArrangeCommand,
  ): Promise<StoryboardArrangeResult> {
    this.assertRequestBoundary(request);

    const referenceImages = await this.readShotImages(authenticated, request);
    const preparedImages = await this.prepareShotImages(referenceImages);
    const result = await this.visionClient.complete({
      messages: buildStoryboardArrangeMessages({
        shots: request.shots.map((shot, index) => ({
          shotId: shot.shotId,
          imageDataUrl: preparedImages[index].dataUrl,
        })),
      }),
    });

    const shots = parseStoryboardArrangeResult(
      result.contentText,
      request.shots.map((shot) => shot.shotId),
    );

    return {
      shots,
      model: result.model,
      referenceCount: preparedImages.length,
      promptVersion: AI_STORYBOARD_ARRANGE_PROMPT_VERSION,
      mode: "image",
    };
  }

  async arrangeFromStory(
    _authenticated: AuthenticatedAccount,
    request: StoryboardStoryArrangeCommand,
  ): Promise<StoryboardArrangeResult> {
    this.assertStoryRequestBoundary(request);

    const messages = buildStoryboardStoryMessages({
      storyText: request.storyText,
      creationType: request.creationType,
    });

    const result = await this.visionClient.complete({ messages });
    const shots = parseStoryboardStoryArrangeResult(result.contentText);

    return {
      shots,
      model: result.model,
      referenceCount: 0,
      promptVersion: AI_STORYBOARD_STORY_PROMPT_VERSION,
      mode: "story",
    };
  }

  private assertRequestBoundary(request: StoryboardArrangeCommand): void {
    if (request.nodeType !== AI_STORYBOARD_ARRANGE_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.shots.length === 0) {
      throw new Error("INVALID_SHOTS");
    }
  }

  private assertStoryRequestBoundary(request: StoryboardStoryArrangeCommand): void {
    if (request.nodeType !== AI_STORYBOARD_ARRANGE_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (!request.storyText || request.storyText.trim().length === 0) {
      throw new Error("INVALID_STORY_TEXT");
    }
  }

  private async readShotImages(
    authenticated: AuthenticatedAccount,
    request: StoryboardArrangeCommand,
  ): Promise<PromptOptimizeImageInput[]> {
    const images: PromptOptimizeImageInput[] = [];

    for (const shot of request.shots) {
      images.push(await this.readShotImage(authenticated, shot));
    }

    return images;
  }

  private async readShotImage(
    authenticated: AuthenticatedAccount,
    shot: StoryboardArrangeShotCommand,
  ): Promise<PromptOptimizeImageInput> {
    let file: Awaited<ReturnType<FilesService["downloadFileForActor"]>>;

    try {
      file = await this.filesService.downloadFileForActor(
        authenticated,
        shot.imageFileId,
        "download",
      );
    } catch (error) {
      if (this.isFileStoreBusyError(error)) {
        throw new Error("SHOT_FILE_STORE_BUSY");
      }

      if (this.isMissingStorageError(error)) {
        throw new Error(`FILE_NOT_FOUND:${shot.imageFileId}`);
      }

      throw error;
    }

    if (!file) {
      throw new Error(`FILE_NOT_FOUND:${shot.imageFileId}`);
    }

    if (!file.mimeType.toLowerCase().startsWith("image/")) {
      throw new Error("SHOT_FILE_NOT_IMAGE");
    }

    return {
      buffer: file.buffer,
      mimeType: file.mimeType,
    };
  }

  private async prepareShotImages(
    images: PromptOptimizeImageInput[],
  ): Promise<Awaited<ReturnType<typeof prepareAiMultimodalImages>>> {
    try {
      return await prepareAiMultimodalImages(images, {
        maxDimension: AI_STORYBOARD_ARRANGE_IMAGE_MAX_DIMENSION,
        jpegQuality: Math.round(AI_STORYBOARD_ARRANGE_IMAGE_QUALITY * 100),
      });
    } catch {
      throw new Error("SHOT_IMAGE_PROCESS_FAILED");
    }
  }

  private isFileStoreBusyError(error: unknown): boolean {
    return error instanceof Error && error.message === "FILE_STORE_LOCK_TIMEOUT";
  }

  private isMissingStorageError(error: unknown): boolean {
    return (
      error instanceof Error
      && (
        (error as NodeJS.ErrnoException).code === "ENOENT"
        || error.message.startsWith("ENOENT:")
      )
    );
  }
}
