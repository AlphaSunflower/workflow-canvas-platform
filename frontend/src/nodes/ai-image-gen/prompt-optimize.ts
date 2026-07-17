import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import { AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP, AI_IMAGE_INPUT_PORT_ID } from './groups';

export interface AIImageGenPromptOptimizeAvailability {
  enabled: boolean;
  reason: string | null;
  referenceCount: number;
}

export interface AIImageGenPromptOptimizeRequestHandle {
  requestId: number;
  signal: AbortSignal;
}

interface ResolveAIImageGenPromptOptimizeAvailabilityOptions {
  prompt: string | null | undefined;
  configuredGroupCount: number;
  resolvedGroups: WorkflowResolvedNodeGroupState[];
  isOptimizing?: boolean;
}

function getReferenceCount(resolvedGroups: WorkflowResolvedNodeGroupState[]): number {
  const imageGroup = resolvedGroups[0];
  if (!imageGroup) {
    return 0;
  }

  return imageGroup.ports
    .find((port) => port.portId === AI_IMAGE_INPUT_PORT_ID)
    ?.inputs
    .filter((input) => input.sourceNode.type === 'image')
    .length ?? 0;
}

export function resolveAIImageGenPromptOptimizeAvailability(
  options: ResolveAIImageGenPromptOptimizeAvailabilityOptions,
): AIImageGenPromptOptimizeAvailability {
  const trimmedPrompt = options.prompt?.trim() ?? '';
  const referenceCount = getReferenceCount(options.resolvedGroups);

  if (options.isOptimizing) {
    return {
      enabled: false,
      reason: 'AI 提示词优化进行中',
      referenceCount,
    };
  }

  if (options.configuredGroupCount !== 1) {
    return {
      enabled: false,
      reason: '仅支持单输入组节点使用 AI 提示词优化',
      referenceCount,
    };
  }

  if (trimmedPrompt.length === 0) {
    return {
      enabled: false,
      reason: '请先输入提示词',
      referenceCount,
    };
  }

  if (options.resolvedGroups.length > 1) {
    return {
      enabled: false,
      reason: '当前输入组状态未就绪',
      referenceCount,
    };
  }

  if (referenceCount > AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP) {
    return {
      enabled: false,
      reason: `唯一输入组最多支持 ${AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP} 张输入图片`,
      referenceCount,
    };
  }

  return {
    enabled: true,
    reason: null,
    referenceCount,
  };
}

export class AIImageGenPromptOptimizeRequestController {
  private activeRequestId = 0;
  private activeAbortController: AbortController | null = null;

  start(): AIImageGenPromptOptimizeRequestHandle {
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
