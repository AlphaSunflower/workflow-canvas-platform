import type { StoryboardShotData } from '@/types';
import type { StoryboardShotConnectedImage } from './types';

export interface AIStoryboardShotVideoAvailability {
  enabled: boolean;
  reason: string | null;
}

export interface AIStoryboardShotVideoRequestHandle {
  requestId: number;
  signal: AbortSignal;
}

interface ResolveAIStoryboardShotVideoAvailabilityOptions {
  shot: StoryboardShotData;
  connectedImages?: StoryboardShotConnectedImage[];
  isGenerating?: boolean;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function hasPrompt(shot: StoryboardShotData): boolean {
  return typeof shot.prompt === 'string' && shot.prompt.trim().length > 0;
}

function hasUsableStoryboardVideoReference(
  shot: StoryboardShotData,
  connectedImages?: StoryboardShotConnectedImage[],
): boolean {
  const imageFileId = normalizeId(shot.imageFileId);
  if (imageFileId) {
    return true;
  }

  // Check connected images from per-shot input port
  if (connectedImages && connectedImages.length > 0) {
    return true;
  }

  const sourceNodeId = normalizeId(shot.sourceNodeId);
  if (sourceNodeId) {
    return true;
  }

  const sourceImageFileId = normalizeId(shot.sourceImageFileId);
  const sourceFileId = normalizeId(shot.sourceFileId);
  return Boolean(
    sourceImageFileId
    && (!sourceFileId || sourceImageFileId !== sourceFileId)
  );
}

export function getStoryboardShotVideoUnavailableReason(
  shot: StoryboardShotData,
  connectedImages?: StoryboardShotConnectedImage[],
): string | null {
  if (!hasPrompt(shot)) {
    return '请先填写该镜头的运镜提示词。';
  }

  if (hasUsableStoryboardVideoReference(shot, connectedImages)) {
    return null;
  }

  return '当前镜头缺少可确认的后端参考图，请先使用已生成图片、连接图片或保留可解析的上游图片节点。';
}

export function resolveAIStoryboardShotVideoAvailability(
  options: ResolveAIStoryboardShotVideoAvailabilityOptions,
): AIStoryboardShotVideoAvailability {
  if (options.isGenerating || options.shot.videoGenStatus === 'generating') {
    return {
      enabled: false,
      reason: '当前镜头正在执行视频生成。',
    };
  }

  const unavailableReason = getStoryboardShotVideoUnavailableReason(options.shot, options.connectedImages);
  if (unavailableReason) {
    return {
      enabled: false,
      reason: unavailableReason,
    };
  }

  return {
    enabled: true,
    reason: null,
  };
}

export class AIStoryboardShotVideoRequestController {
  private activeRequestId = 0;
  private activeAbortController: AbortController | null = null;

  start(): AIStoryboardShotVideoRequestHandle {
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
