import type { FileNodeData, StoryboardShotData } from '@/types';
import {
  AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS,
} from '@/nodes/ai-image-gen/constants';
import {
  getStoryboardImageAspectRatioOptions as getStoryboardImageAspectRatioOptionsFromTypes,
  getStoryboardImageModelOptions,
  getStoryboardVideoAspectRatioOptions,
  getStoryboardVideoModelOptions,
  getStoryboardVideoResolutionOptions,
} from '../types';

export interface StoryboardShotImagePreview {
  url?: string;
  fallbackUrl?: string;
  label: string;
  sourceNode?: FileNodeData;
  mediaType?: 'image' | 'video';
}

export const STORYBOARD_IMAGE_MODEL_OPTIONS = (
  getStoryboardImageModelOptions().length > 0
    ? getStoryboardImageModelOptions()
    : AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS.map((option) => option.value)
) as readonly string[];
export const STORYBOARD_IMAGE_RATIO_OPTIONS = getStoryboardImageAspectRatioOptionsFromTypes('gpt-image-2');
export const STORYBOARD_IMAGE_SIZE_OPTIONS = ['1K', '2K', '4K'] as const;
export const STORYBOARD_VIDEO_MODEL_OPTIONS = getStoryboardVideoModelOptions();
export const STORYBOARD_VIDEO_ASPECT_RATIO_OPTIONS = getStoryboardVideoAspectRatioOptions();

export function getStoryboardImageStatusText(shot: StoryboardShotData): string | undefined {
  if (shot.imageGenStatus === 'generating') {
    return shot.imageGenMessage ?? 'AI 出图进行中';
  }

  if (shot.imageGenStatus === 'failed') {
    return shot.imageGenMessage ?? 'AI 出图失败';
  }

  if (shot.imageGenStatus === 'completed') {
    return shot.imageGenMessage ?? '已生成图片';
  }

  return shot.imageGenMessage;
}

export function getStoryboardVideoStatusText(shot: StoryboardShotData): string | undefined {
  if (shot.videoGenStatus === 'generating') {
    const progressText = typeof shot.videoProgress === 'number'
      ? ` ${Math.round(shot.videoProgress)}%`
      : '';
    return shot.videoError ?? `视频生成进行中${progressText}`;
  }

  if (shot.videoGenStatus === 'failed') {
    return shot.videoError ?? '视频生成失败';
  }

  if (shot.videoGenStatus === 'completed') {
    return '已生成视频';
  }

  return shot.videoError;
}

export function getStoryboardImageAspectRatioOptions(model: string): readonly string[] {
  return getStoryboardImageAspectRatioOptionsFromTypes(model);
}

export function getStoryboardVideoResolutionOptionsForAspectRatio(aspectRatio?: string): readonly string[] {
  return getStoryboardVideoResolutionOptions(aspectRatio);
}

export type StoryboardMediaStatusKind = 'image' | 'video';

interface StoryboardStatusTone {
  background: string;
  border: string;
  color: string;
}

export function getStoryboardStatusTone(
  kind: StoryboardMediaStatusKind,
  status: StoryboardShotData['imageGenStatus'],
): StoryboardStatusTone {
  if (status === 'failed') {
    return {
      background: 'rgba(127, 29, 29, 0.36)',
      border: 'rgba(248, 113, 113, 0.34)',
      color: '#fecaca',
    };
  }

  if (kind === 'image') {
    if (status === 'generating') {
      return {
        background: 'rgba(154, 52, 18, 0.34)',
        border: 'rgba(251, 146, 60, 0.36)',
        color: '#fed7aa',
      };
    }

    if (status === 'completed') {
      return {
        background: 'rgba(6, 78, 59, 0.34)',
        border: 'rgba(52, 211, 153, 0.3)',
        color: '#bbf7d0',
      };
    }
  }

  if (kind === 'video') {
    if (status === 'generating') {
      return {
        background: 'rgba(30, 64, 175, 0.34)',
        border: 'rgba(96, 165, 250, 0.34)',
        color: '#bfdbfe',
      };
    }

    if (status === 'completed') {
      return {
        background: 'rgba(49, 46, 129, 0.36)',
        border: 'rgba(129, 140, 248, 0.32)',
        color: '#c7d2fe',
      };
    }
  }

  return {
    background: 'rgba(15, 23, 42, 0.54)',
    border: 'rgba(148, 163, 184, 0.18)',
    color: '#94a3b8',
  };
}
