import type { FileInfo } from '@/types';
import { getAIStoryboardShotOutputHandle } from './groups';

export type StoryboardMediaKind = 'image' | 'video';
export type StoryboardTaskType = 'image-gen' | 'video-gen';

export interface StoryboardOutputRoutingIdentity {
  kind: 'storyboard-shot-output';
  groupId: string;
  outputHandle: string;
}

export interface StoryboardExecutionTargetIdentity extends StoryboardOutputRoutingIdentity {
  taskType: StoryboardTaskType;
}

export interface StoryboardIdentityLike {
  groupId?: unknown;
  outputHandle?: unknown;
  taskType?: unknown;
}

export interface StoryboardPersistedTaskRefLike extends StoryboardIdentityLike {
  taskId?: string;
  runId?: string;
  runNo?: string;
  groupLabel?: string;
  groupOrder?: number;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function isStoryboardTaskType(value: unknown): value is StoryboardTaskType {
  return value === 'image-gen' || value === 'video-gen';
}

export function getStoryboardTaskTypeForMediaKind(
  mediaKind: StoryboardMediaKind,
): StoryboardTaskType {
  return mediaKind === 'image' ? 'image-gen' : 'video-gen';
}

export function normalizeStoryboardTaskType(
  value: unknown,
  fallback?: StoryboardTaskType | StoryboardMediaKind | null,
): StoryboardTaskType | undefined {
  if (isStoryboardTaskType(value)) {
    return value;
  }

  if (fallback === 'image' || fallback === 'video') {
    return getStoryboardTaskTypeForMediaKind(fallback);
  }

  return isStoryboardTaskType(fallback) ? fallback : undefined;
}

export function getStoryboardTaskTypeFromFileInfo(
  fileInfo?: FileInfo,
): StoryboardTaskType | undefined {
  if (!fileInfo) {
    return undefined;
  }

  if (fileInfo.fileType === 'image' || fileInfo.mimeType.startsWith('image/')) {
    return 'image-gen';
  }

  if (fileInfo.fileType === 'video' || fileInfo.mimeType.startsWith('video/')) {
    return 'video-gen';
  }

  return undefined;
}

export function getStoryboardOutputHandleForGroupId(groupId: string): string {
  return getAIStoryboardShotOutputHandle(groupId);
}

export function createStoryboardOutputRoutingIdentity(
  groupId: string,
): StoryboardOutputRoutingIdentity {
  return {
    kind: 'storyboard-shot-output',
    groupId,
    outputHandle: getStoryboardOutputHandleForGroupId(groupId),
  };
}

export function normalizeStoryboardOutputRoutingIdentity(
  input: StoryboardIdentityLike,
  options?: {
    fallbackGroupId?: string | null;
  },
): StoryboardOutputRoutingIdentity | null {
  const groupId = normalizeNonEmptyString(input.groupId)
    ?? normalizeNonEmptyString(options?.fallbackGroupId);
  if (!groupId) {
    return null;
  }

  const outputHandle = normalizeNonEmptyString(input.outputHandle)
    ?? getStoryboardOutputHandleForGroupId(groupId);

  return {
    kind: 'storyboard-shot-output',
    groupId,
    outputHandle: getStoryboardOutputHandleForGroupId(groupId) === outputHandle
      ? outputHandle
      : getStoryboardOutputHandleForGroupId(groupId),
  };
}

export function createStoryboardExecutionTargetIdentity(input: {
  groupId: string;
  taskType: StoryboardTaskType | StoryboardMediaKind;
  outputHandle?: string;
}): StoryboardExecutionTargetIdentity {
  const routing = createStoryboardOutputRoutingIdentity(input.groupId);
  const taskType = normalizeStoryboardTaskType(input.taskType, input.taskType);

  return {
    ...routing,
    taskType: taskType ?? 'video-gen',
  };
}

export function normalizeStoryboardExecutionTargetIdentity(
  input: StoryboardIdentityLike,
  options?: {
    fallbackGroupId?: string | null;
    fallbackTaskType?: StoryboardTaskType | StoryboardMediaKind | null;
  },
): StoryboardExecutionTargetIdentity | null {
  const routing = normalizeStoryboardOutputRoutingIdentity(input, options);
  if (!routing) {
    return null;
  }

  const taskType = normalizeStoryboardTaskType(input.taskType, options?.fallbackTaskType);
  if (!taskType) {
    return null;
  }

  return {
    ...routing,
    taskType,
  };
}

export function isStoryboardPersistedTaskRef(
  taskRef: StoryboardPersistedTaskRefLike,
): boolean {
  return normalizeStoryboardOutputRoutingIdentity(taskRef) !== null;
}

export function normalizeStoryboardTaskRefIdentity<T extends StoryboardPersistedTaskRefLike>(
  taskRef: T,
  options?: {
    fallbackGroupId?: string | null;
    fallbackTaskType?: StoryboardTaskType | StoryboardMediaKind | null;
  },
): T {
  const routing = normalizeStoryboardOutputRoutingIdentity(taskRef, {
    fallbackGroupId: options?.fallbackGroupId ?? null,
  });
  const taskType = normalizeStoryboardTaskType(taskRef.taskType, options?.fallbackTaskType);

  if (!routing && !taskType) {
    return { ...taskRef };
  }

  return {
    ...taskRef,
    ...(routing ? {
      groupId: routing.groupId,
      outputHandle: routing.outputHandle,
    } : {}),
    ...(taskType ? { taskType } : {}),
  };
}

export function matchesStoryboardOutputIdentity(
  left: StoryboardIdentityLike,
  right: StoryboardIdentityLike,
  options?: {
    leftFallbackGroupId?: string | null;
    rightFallbackGroupId?: string | null;
    leftFallbackTaskType?: StoryboardTaskType | StoryboardMediaKind | null;
    rightFallbackTaskType?: StoryboardTaskType | StoryboardMediaKind | null;
    allowMissingTaskType?: boolean;
  },
): boolean {
  const leftRouting = normalizeStoryboardOutputRoutingIdentity(left, {
    fallbackGroupId: options?.leftFallbackGroupId ?? null,
  });
  const rightRouting = normalizeStoryboardOutputRoutingIdentity(right, {
    fallbackGroupId: options?.rightFallbackGroupId ?? null,
  });
  if (!leftRouting || !rightRouting) {
    return false;
  }

  if (
    leftRouting.groupId !== rightRouting.groupId
    || leftRouting.outputHandle !== rightRouting.outputHandle
  ) {
    return false;
  }

  const leftTaskType = normalizeStoryboardTaskType(left.taskType, options?.leftFallbackTaskType);
  const rightTaskType = normalizeStoryboardTaskType(right.taskType, options?.rightFallbackTaskType);

  if (leftTaskType && rightTaskType) {
    return leftTaskType === rightTaskType;
  }

  return options?.allowMissingTaskType === true;
}

export function findMatchingStoryboardTaskRef<T extends StoryboardPersistedTaskRefLike>(
  taskRefs: readonly T[],
  snapshot: { runId: string; runNo?: string },
  task: {
    taskId: string;
    groupId: string;
    taskType?: string;
  },
  options?: {
    fallbackTaskType?: StoryboardTaskType | StoryboardMediaKind | null;
  },
): T | null {
  return taskRefs.find((item) => item.taskId === task.taskId)
    ?? taskRefs.find((item) => (
      item.runId === snapshot.runId
      && matchesStoryboardOutputIdentity(item, task, {
        rightFallbackTaskType: options?.fallbackTaskType ?? null,
        allowMissingTaskType: true,
      })
    ))
    ?? taskRefs.find((item) => (
      typeof snapshot.runNo === 'string'
      && item.runNo === snapshot.runNo
      && matchesStoryboardOutputIdentity(item, task, {
        rightFallbackTaskType: options?.fallbackTaskType ?? null,
        allowMissingTaskType: true,
      })
    ))
    ?? null;
}
