import type { StoryboardShotData } from '@/types';
import {
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeModel,
} from '@/nodes/ai-image-gen/constants';

export interface AIStoryboardShotImageAvailability {
  enabled: boolean;
  reason: string | null;
}

export interface AIStoryboardShotImageRequestHandle {
  requestId: number;
  signal: AbortSignal;
}

interface ResolveAIStoryboardShotImageAvailabilityOptions {
  shot: StoryboardShotData;
  isGenerating?: boolean;
}

function hasPrompt(shot: StoryboardShotData): boolean {
  return typeof shot.prompt === 'string' && shot.prompt.trim().length > 0;
}

function hasReferenceImage(shot: StoryboardShotData): boolean {
  return (
    typeof shot.imageFileId === 'string' && shot.imageFileId.trim().length > 0
  ) || (
    typeof shot.sourceImageFileId === 'string' && shot.sourceImageFileId.trim().length > 0
  ) || (
    typeof shot.sourceFileId === 'string' && shot.sourceFileId.trim().length > 0
  );
}

export function resolveAIStoryboardShotImageAvailability(
  options: ResolveAIStoryboardShotImageAvailabilityOptions,
): AIStoryboardShotImageAvailability {
  const model = normalizeAIImageGenNodeModel(options.shot.imageModel);

  if (options.isGenerating || options.shot.imageGenStatus === 'generating') {
    return {
      enabled: false,
      reason: '当前镜头正在执行 AI 出图',
    };
  }

  if (!hasPrompt(options.shot)) {
    return {
      enabled: false,
      reason: '请先填写该镜头的提示词',
    };
  }

  if (!isAIImageGenNodeParameterlessModel(model) && !hasReferenceImage(options.shot)) {
    return {
      enabled: false,
      reason: '当前镜头缺少可用参考图',
    };
  }

  return {
    enabled: true,
    reason: null,
  };
}

export class AIStoryboardShotImageRequestController {
  private activeRequestId = 0;
  private activeAbortController: AbortController | null = null;

  start(): AIStoryboardShotImageRequestHandle {
    this.activeAbortController?.abort();

    const requestId = this.activeRequestId + 1;
    const abortController = new AbortController();

    this.activeRequestId = requestId;
    this.activeAbortController = abortController;

    return {
      requestId,
      signal: abortController.signal,
    };
  }

  finish(requestId: number): boolean {
    if (this.activeRequestId !== requestId) {
      return false;
    }

    this.activeAbortController = null;
    return true;
  }

  cancel(): void {
    this.activeRequestId += 1;
    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }
}
