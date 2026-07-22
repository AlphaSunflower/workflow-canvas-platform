import type { FileNodeData, StoryboardShotData } from '@/types';
import type { StoryboardArrangeShotResponse } from '@/api';

export interface AIStoryboardArrangeAvailability {
  enabled: boolean;
  reason: string | null;
  referenceCount: number;
}

export interface AIStoryboardStoryArrangeAvailability {
  enabled: boolean;
  reason: string | null;
}

interface ResolveAIStoryboardStoryArrangeAvailabilityOptions {
  storyText: string;
  isGenerating?: boolean;
}

export function resolveAIStoryboardStoryArrangeAvailability(
  options: ResolveAIStoryboardStoryArrangeAvailabilityOptions,
): AIStoryboardStoryArrangeAvailability {
  if (options.isGenerating) {
    return {
      enabled: false,
      reason: 'AI 分镜生成进行中',
    };
  }

  const trimmed = options.storyText.trim();
  if (trimmed.length < 10) {
    return {
      enabled: false,
      reason: '剧情文本至少需要 10 个字符',
    };
  }

  return {
    enabled: true,
    reason: null,
  };
}

export interface AIStoryboardArrangeRequestHandle {
  requestId: number;
  signal: AbortSignal;
}

interface ResolveAIStoryboardArrangeAvailabilityOptions {
  shots: StoryboardShotData[];
  isArranging?: boolean;
}

export interface ResolveStoryboardArrangeImageFileIdOptions {
  shot: StoryboardShotData;
  sourceNode?: FileNodeData | null;
  signal?: AbortSignal;
  isBackendFileReady: (fileId: string, signal?: AbortSignal) => Promise<boolean>;
  ensureBackendFileId: (
    sourceNode: FileNodeData,
    options?: { signal?: AbortSignal; workflowId?: string | null },
  ) => Promise<string | null | undefined>;
  workflowId?: string | null;
}

function normalizeFileId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

async function isReadyBackendFileId(
  fileId: string | null,
  options: ResolveStoryboardArrangeImageFileIdOptions,
): Promise<boolean> {
  if (!fileId) {
    return false;
  }

  return options.isBackendFileReady(fileId, options.signal).catch(() => false);
}

function hasReferenceImage(shot: StoryboardShotData): boolean {
  return typeof shot.imageFileId === 'string' && shot.imageFileId.trim().length > 0
    || typeof shot.sourceImageFileId === 'string' && shot.sourceImageFileId.trim().length > 0
    || typeof shot.sourceFileId === 'string' && shot.sourceFileId.trim().length > 0;
}

export function getStoryboardArrangeReferenceCount(shots: StoryboardShotData[]): number {
  return shots.filter(hasReferenceImage).length;
}

export async function resolveStoryboardArrangeImageFileId(
  options: ResolveStoryboardArrangeImageFileIdOptions,
): Promise<string | null> {
  const imageFileId = normalizeFileId(options.shot.imageFileId);

  if (await isReadyBackendFileId(imageFileId, options)) {
    return imageFileId;
  }

  if (options.sourceNode?.type === 'image') {
    return normalizeFileId(await options.ensureBackendFileId(options.sourceNode, {
      signal: options.signal,
      workflowId: options.workflowId,
    }));
  }

  const fallbackFileIds = [
    normalizeFileId(options.shot.sourceImageFileId),
    normalizeFileId(options.shot.sourceFileId),
  ].filter((fileId): fileId is string => Boolean(fileId) && fileId !== imageFileId);

  for (const fallbackFileId of fallbackFileIds) {
    if (await isReadyBackendFileId(fallbackFileId, options)) {
      return fallbackFileId;
    }
  }

  return null;
}

export function applyStoryboardArrangeResult(
  currentShots: StoryboardShotData[],
  arrangedShots: StoryboardArrangeShotResponse[],
): StoryboardShotData[] {
  const resultByShotId = new Map(arrangedShots.map((shot) => [shot.shotId, shot] as const));
  const arrangedShotIds = new Set(arrangedShots.map((shot) => shot.shotId));

  const updatedArrangedShots = currentShots
    .filter((shot) => arrangedShotIds.has(shot.id))
    .map((shot) => {
      const arranged = resultByShotId.get(shot.id);
      if (!arranged) {
        return shot;
      }

      return {
        ...shot,
        order: arranged.order,
        prompt: arranged.prompt,
      };
    })
    .sort((left, right) => left.order - right.order);

  const untouchedShots = currentShots.filter((shot) => !arrangedShotIds.has(shot.id));

  return [...updatedArrangedShots, ...untouchedShots].map((shot, index, collection) => ({
    ...shot,
    order: index + 1,
    originalTotal: collection.length,
  }));
}

export function resolveAIStoryboardArrangeAvailability(
  options: ResolveAIStoryboardArrangeAvailabilityOptions,
): AIStoryboardArrangeAvailability {
  const referenceCount = getStoryboardArrangeReferenceCount(options.shots);

  if (options.isArranging) {
    return {
      enabled: false,
      reason: 'AI 智能排序与写运镜进行中',
      referenceCount,
    };
  }

  if (referenceCount < 1) {
    return {
      enabled: false,
      reason: '至少需要 1 个带图镜头才能执行 AI 智能排序与写运镜',
      referenceCount,
    };
  }

  return {
    enabled: true,
    reason: null,
    referenceCount,
  };
}

export class AIStoryboardArrangeRequestController {
  private activeRequestId = 0;
  private activeAbortController: AbortController | null = null;

  start(): AIStoryboardArrangeRequestHandle {
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
