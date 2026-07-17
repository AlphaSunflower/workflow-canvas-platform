import type { AnyNodeData, FileInfo, StoryboardShotData, Workflow } from '@/types';
import { isAINodeData } from '@/utils';
import type { WorkflowNodeGroupExecutionState } from '@/contracts/execution';
import { getStoryboardShots } from './storyboard-execution-service';
import type { StoryboardExecutionNotifications } from './storyboard-shot-image-runner';

export interface StoryboardBatchVideoRunnerDependencies {
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getNodeNameById: (nodeId: string) => string;
  getCurrentWorkflow: () => Workflow | null;
  generateStoryboardShotVideo: (
    nodeId: string,
    shotId: string,
    options?: {
      signal?: AbortSignal;
      suppressNotifications?: boolean;
    },
  ) => Promise<void>;
  getCommittedStoryboardGroupState: (
    nodeId: string,
    shotId: string,
    options?: {
      workflowId?: string | null;
      runId?: string | null;
      taskId?: string | null;
      resultFileId?: string | null;
      fileType?: FileInfo['fileType'];
    },
  ) => WorkflowNodeGroupExecutionState | null;
  notification: Pick<StoryboardExecutionNotifications, 'showWarning' | 'showInfo' | 'showSuccess'>;
}

export async function runStoryboardBatchVideo(
  nodeId: string,
  dependencies: StoryboardBatchVideoRunnerDependencies,
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const node = dependencies.getNodeById(nodeId);

  if (!node || !isAINodeData(node) || node.type !== 'aiStoryboard') {
    dependencies.notification.showWarning('一键生成视频不可用', '当前节点不是 AI 分镜表节点。');
    return;
  }

  const shots = getStoryboardShots(node);
  const executableShots = shots.filter((shot) => shot.videoGenStatus !== 'generating');
  const getLatestStoryboardShot = (shotId: string): StoryboardShotData | null => {
    const latestWorkflow = dependencies.getCurrentWorkflow();
    if (!latestWorkflow) {
      return null;
    }

    const latestNode = latestWorkflow.nodes[nodeId];
    if (!latestNode || !isAINodeData(latestNode) || latestNode.type !== 'aiStoryboard') {
      return null;
    }

    return getStoryboardShots(latestNode).find((item) => item.id === shotId) ?? null;
  };

  if (executableShots.length === 0) {
    dependencies.notification.showInfo('一键生成视频不可用', '当前没有可派发的视频镜头，或所有镜头都已在生成中。');
    return;
  }

  dependencies.notification.showInfo(
    '一键生成视频开始',
    `${dependencies.getNodeNameById(nodeId)} 正在同时派发 ${executableShots.length} 个视频任务`,
  );

  const pendingShots = [...executableShots];
  let dispatchedCount = 0;
  let successfulCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;

  const runShot = async (shot: StoryboardShotData): Promise<void> => {
    if (options?.signal?.aborted) {
      cancelledCount += 1;
      return;
    }

    dispatchedCount += 1;

    try {
      await dependencies.generateStoryboardShotVideo(nodeId, shot.id, {
        signal: options?.signal,
        suppressNotifications: true,
      });
    } catch {
      failedCount += 1;
      return;
    }

    const latestShot = getLatestStoryboardShot(shot.id);
    const committedGroup = dependencies.getCommittedStoryboardGroupState(nodeId, shot.id, {
      workflowId: dependencies.getCurrentWorkflow()?.id ?? null,
      fileType: 'video',
    });
    if (committedGroup?.isOutputCommitted === true && typeof committedGroup.resultFileId === 'string') {
      successfulCount += 1;
      return;
    }

    if (options?.signal?.aborted || latestShot?.videoGenStatus === 'idle') {
      cancelledCount += 1;
      return;
    }

    failedCount += 1;
  };

  pendingShots.length = 0;
  await Promise.all(executableShots.map((shot) => runShot(shot)));

  if (options?.signal?.aborted) {
    dependencies.notification.showInfo(
      '一键生成视频已取消',
      `${dependencies.getNodeNameById(nodeId)} 已停止后续视频任务派发。成功 ${successfulCount} 个，失败 ${failedCount} 个，已取消 ${cancelledCount} 个，未派发 ${pendingShots.length} 个。`,
    );
    return;
  }

  if (failedCount > 0 || cancelledCount > 0) {
    dependencies.notification.showWarning(
      '一键生成视频完成',
      `${dependencies.getNodeNameById(nodeId)} 已完成 ${dispatchedCount} 个视频任务。成功 ${successfulCount} 个，失败 ${failedCount} 个，已取消 ${cancelledCount} 个。`,
    );
    return;
  }

  dependencies.notification.showSuccess(
    '一键生成视频完成',
    `${dependencies.getNodeNameById(nodeId)} 已完成 ${dispatchedCount} 个视频任务。成功 ${successfulCount} 个，失败 ${failedCount} 个。`,
  );
}
