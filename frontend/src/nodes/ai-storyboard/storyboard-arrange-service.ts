import type { AuthContextValue } from '@/auth';
import { requireAuthenticatedAction } from '@/auth';
import type {
  StoryboardArrangeResponse,
  StoryboardCreationType,
  StoryboardStoryArrangeRequest,
} from '@/api';
import type { Result } from '@/types';
import type {
  AnyNodeData,
  FileNodeData,
  StoryboardShotData,
  Workflow,
} from '@/types';
import { isAINodeData, isFileNodeData } from '@/utils';
import {
  applyStoryboardArrangeResult,
  resolveStoryboardArrangeImageFileId,
} from './arrange';
import { getStoryboardShots } from './storyboard-execution-service';

function createStoryShot(shotId: string, order: number, prompt: string, total: number): StoryboardShotData {
  return {
    id: shotId,
    order,
    row: order - 1,
    col: 0,
    originalIndex: order,
    originalTotal: total,
    prompt,
    imageGenStatus: 'idle',
    videoGenStatus: 'idle',
  } as StoryboardShotData;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export interface StoryboardArrangeNotifications {
  showWarning: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string) => void;
  showAuthFeedback: (error: unknown, actionLabel: string) => boolean;
}

export interface StoryboardArrangeDependencies {
  auth: AuthContextValue;
  getNodeNameById: (nodeId: string) => string;
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getCurrentWorkflow: () => Workflow | null;
  applyStoryboardArrangeResult: (
    nodeId: string,
    arranged: StoryboardArrangeResponse['shots'],
  ) => boolean;
  arrangeStoryboardShots: (
    request: {
      workflowId: string;
      nodeId: string;
      nodeType: 'aiStoryboard';
      shots: Array<{
        shotId: string;
        order: number;
        imageFileId: string;
      }>;
    },
    options?: { signal?: AbortSignal },
  ) => Promise<Result<StoryboardArrangeResponse>>;
  getBackendFileInfo: (fileId: string, signal?: AbortSignal) => Promise<{ status: string }>;
  ensureBackendFileId: (
    sourceNode: FileNodeData,
    options?: { signal?: AbortSignal; workflowId?: string | null },
  ) => Promise<string | null | undefined>;
  notification: StoryboardArrangeNotifications;
}

export async function runStoryboardArrange(
  nodeId: string,
  dependencies: StoryboardArrangeDependencies,
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const node = dependencies.getNodeById(nodeId);

  if (!node || !isAINodeData(node) || node.type !== 'aiStoryboard') {
    dependencies.notification.showWarning('AI 智能排序不可用', '当前节点不是 AI 分镜表节点。');
    return;
  }

  const authError = requireAuthenticatedAction(dependencies.auth, {
    actionLabel: '使用 AI 智能排序与写运镜',
  });
  if (authError) {
    dependencies.notification.showWarning('需要登录', authError.message);
    return;
  }

  const workflowId = dependencies.getCurrentWorkflow()?.id ?? '';
  if (!workflowId) {
    dependencies.notification.showWarning(
      'AI 智能排序不可用',
      '当前画布未就绪，暂时无法执行 AI 智能排序与写运镜。',
    );
    return;
  }

  const shots = getStoryboardShots(node);
  if (shots.length === 0) {
    dependencies.notification.showWarning('AI 智能排序不可用', '当前分镜表还没有镜头数据。');
    return;
  }

  const arrangeableShots = await Promise.all(
    shots.map(async (shot) => {
      const sourceNode = typeof shot.sourceNodeId === 'string' && shot.sourceNodeId.length > 0
        ? dependencies.getNodeById(shot.sourceNodeId)
        : null;

      const resolvedImageFileId = await resolveStoryboardArrangeImageFileId({
        shot,
        sourceNode: sourceNode && isFileNodeData(sourceNode) && sourceNode.type === 'image'
          ? sourceNode
          : null,
        signal: options?.signal,
        isBackendFileReady: async (fileId, signal) => {
          const fileInfo = await dependencies.getBackendFileInfo(fileId, signal);
          return fileInfo.status === 'ready';
        },
        ensureBackendFileId: dependencies.ensureBackendFileId,
        workflowId,
      });

      if (!resolvedImageFileId) {
        return null;
      }

      return {
        shotId: shot.id,
        order: typeof shot.order === 'number' && Number.isFinite(shot.order) ? shot.order : 1,
        imageFileId: resolvedImageFileId,
      };
    }),
  );

  if (options?.signal?.aborted) {
    dependencies.notification.showInfo(
      'AI 智能排序已取消',
      `${dependencies.getNodeNameById(nodeId)} 已取消 AI 智能排序与写运镜`,
    );
    return;
  }

  const requestShots = arrangeableShots.filter((item): item is NonNullable<typeof item> => item !== null);
  if (requestShots.length === 0) {
    dependencies.notification.showWarning('AI 智能排序不可用', '当前没有可用于编排的带图镜头。');
    return;
  }

  dependencies.notification.showInfo(
    'AI 智能排序中',
    `${dependencies.getNodeNameById(nodeId)} 正在分析镜头顺序并生成运镜提示词`,
  );

  try {
    const result = await dependencies.arrangeStoryboardShots({
      workflowId,
      nodeId,
      nodeType: 'aiStoryboard',
      shots: requestShots,
    }, {
      signal: options?.signal,
    });

    if (!result.success) {
      if (dependencies.notification.showAuthFeedback(result.error, '使用 AI 智能排序与写运镜')) {
        return;
      }

      if (options?.signal?.aborted || isAbortError(result.error)) {
        dependencies.notification.showInfo(
          'AI 智能排序已取消',
          `${dependencies.getNodeNameById(nodeId)} 已取消 AI 智能排序与写运镜`,
        );
        return;
      }

      dependencies.notification.showError('AI 智能排序失败', result.error.message);
      return;
    }

    const applied = dependencies.applyStoryboardArrangeResult(nodeId, result.data.shots);
    if (!applied) {
      dependencies.notification.showWarning(
        'AI 智能排序失败',
        '当前节点已变化，无法回填 AI 编排结果。',
      );
      return;
    }

    dependencies.notification.showSuccess(
      'AI 智能排序完成',
      `${dependencies.getNodeNameById(nodeId)} 的镜头顺序与运镜提示词已更新`,
    );
  } catch (error) {
    if (dependencies.notification.showAuthFeedback(error, '使用 AI 智能排序与写运镜')) {
      return;
    }

    if (options?.signal?.aborted || isAbortError(error)) {
      dependencies.notification.showInfo(
        'AI 智能排序已取消',
        `${dependencies.getNodeNameById(nodeId)} 已取消 AI 智能排序与写运镜`,
      );
      return;
    }

    dependencies.notification.showError(
      'AI 智能排序失败',
      getActionErrorMessage(error, 'AI 智能排序与写运镜失败，请稍后重试。'),
    );
  }
}

export function applyStoryboardArrangeToWorkflow(
  workflow: Workflow | null,
  nodeId: string,
  arrangedShots: StoryboardArrangeResponse['shots'],
): Workflow | null {
  if (!workflow) {
    return null;
  }

  const currentNode = workflow.nodes[nodeId];
  if (!currentNode || !isAINodeData(currentNode) || currentNode.type !== 'aiStoryboard') {
    return null;
  }

  const currentShots = getStoryboardShots(currentNode);
  const nextShots = applyStoryboardArrangeResult(currentShots, arrangedShots);

  return {
    ...workflow,
    nodes: {
      ...workflow.nodes,
      [nodeId]: {
        ...currentNode,
        config: {
          ...currentNode.config,
          shots: nextShots,
        },
        timestamp: {
          ...currentNode.timestamp,
          updated: Date.now(),
        },
      },
    },
  };
}

export interface StoryboardStoryArrangeDependencies {
  auth: AuthContextValue;
  getNodeNameById: (nodeId: string) => string;
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getCurrentWorkflow: () => Workflow | null;
  applyStoryboardStoryResult: (
    nodeId: string,
    arrangedShots: StoryboardArrangeResponse['shots'],
  ) => boolean;
  arrangeStoryboardFromStory: (
    request: StoryboardStoryArrangeRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<Result<StoryboardArrangeResponse>>;
  notification: StoryboardArrangeNotifications;
}

export async function runStoryboardStoryArrange(
  nodeId: string,
  storyText: string,
  creationType: StoryboardCreationType,
  dependencies: StoryboardStoryArrangeDependencies,
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const node = dependencies.getNodeById(nodeId);

  if (!node || !isAINodeData(node) || node.type !== 'aiStoryboard') {
    dependencies.notification.showWarning('AI 分镜生成不可用', '当前节点不是 AI 分镜表节点。');
    return;
  }

  const authError = requireAuthenticatedAction(dependencies.auth, {
    actionLabel: '使用 AI 剧情生成分镜',
  });
  if (authError) {
    dependencies.notification.showWarning('需要登录', authError.message);
    return;
  }

  const workflowId = dependencies.getCurrentWorkflow()?.id ?? '';
  if (!workflowId) {
    dependencies.notification.showWarning(
      'AI 分镜生成不可用',
      '当前画布未就绪，暂时无法执行 AI 剧情生成分镜。',
    );
    return;
  }

  dependencies.notification.showInfo(
    'AI 分镜生成中',
    `${dependencies.getNodeNameById(nodeId)} 正在根据剧情生成分镜表`,
  );

  try {
    const result = await dependencies.arrangeStoryboardFromStory({
      workflowId,
      nodeId,
      nodeType: 'aiStoryboard',
      storyText,
      creationType,
    }, {
      signal: options?.signal,
    });

    if (!result.success) {
      if (dependencies.notification.showAuthFeedback(result.error, '使用 AI 剧情生成分镜')) {
        return;
      }

      if (options?.signal?.aborted || isAbortError(result.error)) {
        dependencies.notification.showInfo(
          'AI 分镜生成已取消',
          `${dependencies.getNodeNameById(nodeId)} 已取消 AI 剧情生成分镜`,
        );
        return;
      }

      dependencies.notification.showError('AI 分镜生成失败', result.error.message);
      return;
    }

    const applied = dependencies.applyStoryboardStoryResult(nodeId, result.data.shots);
    if (!applied) {
      dependencies.notification.showWarning(
        'AI 分镜生成失败',
        '当前节点已变化，无法回填 AI 分镜生成结果。',
      );
      return;
    }

    dependencies.notification.showSuccess(
      'AI 分镜生成完成',
      `${dependencies.getNodeNameById(nodeId)} 已生成 ${result.data.shots.length} 个分镜`,
    );
  } catch (error) {
    if (dependencies.notification.showAuthFeedback(error, '使用 AI 剧情生成分镜')) {
      return;
    }

    if (options?.signal?.aborted || isAbortError(error)) {
      dependencies.notification.showInfo(
        'AI 分镜生成已取消',
        `${dependencies.getNodeNameById(nodeId)} 已取消 AI 剧情生成分镜`,
      );
      return;
    }

    dependencies.notification.showError(
      'AI 分镜生成失败',
      getActionErrorMessage(error, 'AI 剧情生成分镜失败，请稍后重试。'),
    );
  }
}

export function applyStoryboardStoryResultToWorkflow(
  workflow: Workflow | null,
  nodeId: string,
  arrangedShots: StoryboardArrangeResponse['shots'],
): Workflow | null {
  if (!workflow) {
    return null;
  }

  const currentNode = workflow.nodes[nodeId];
  if (!currentNode || !isAINodeData(currentNode) || currentNode.type !== 'aiStoryboard') {
    return null;
  }

  const now = Date.now();
  const newShots: StoryboardShotData[] = arrangedShots.map((shot, index) =>
    createStoryShot(shot.shotId, index + 1, shot.prompt, arrangedShots.length),
  );

  return {
    ...workflow,
    nodes: {
      ...workflow.nodes,
      [nodeId]: {
        ...currentNode,
        config: {
          ...currentNode.config,
          shots: newShots,
          processedInputFileIds: [],
        },
        timestamp: {
          ...currentNode.timestamp,
          updated: now,
        },
      },
    },
  };
}
