import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
  TaskHistoryDetail,
  TaskHistoryPreviewFile,
  WorkflowTaskHistoryBackendTaskItem,
} from './task-history.types';
import { TaskHistoryDetailModal } from './TaskHistoryDetailModal';

function createPreviewFile(
  fileId: string,
  label: string,
  role: TaskHistoryPreviewFile['role'],
): TaskHistoryPreviewFile {
  return {
    fileId,
    role,
    label,
    order: 0,
    fileInfo: {
      id: fileId,
      name: `${fileId}.png`,
      originalName: `${fileId}.png`,
      size: 2048,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: `hash-${fileId}`,
      path: `/api/v1/files/${fileId}/download`,
      thumbnailPath: `/api/v1/files/${fileId}/thumbnail`,
      metadata: {
        width: 1536,
        height: 1024,
      },
      source: {
        type: 'node-output',
      },
      timestamp: {
        created: Date.parse('2026-05-07T10:00:00.000Z'),
        updated: Date.parse('2026-05-07T10:00:00.000Z'),
      },
    },
    backendFile: {
      fileId,
      originalName: `${fileId}.png`,
      displayName: `${fileId}.png`,
      mimeType: 'image/png',
      fileType: 'image',
      sourceType: 'output',
      sha256: `hash-${fileId}`,
      size: 2048,
      extension: 'png',
      width: 1536,
      height: 1024,
      duration: null,
      status: 'ready',
      createdAt: '2026-05-07T10:00:00.000Z',
      downloadUrl: `/api/v1/files/${fileId}/download`,
      thumbnailUrl: `/api/v1/files/${fileId}/thumbnail`,
      previewUrl: `/api/v1/files/${fileId}/preview`,
    },
  };
}

function createRawTask(overrides: Partial<WorkflowTaskHistoryBackendTaskItem> = {}): WorkflowTaskHistoryBackendTaskItem {
  return {
    sequence: 1,
    taskId: 'task-1',
    taskNo: 'TASK-1',
    runId: 'run-1',
    runNo: 'RUN-1',
    workflowId: 'workflow-1',
    projectId: 'project-1',
    nodeId: 'node-1',
    nodeTitle: 'Task One',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    groupId: 'group-1',
    groupOrder: 0,
    provider: 'laozhang',
    model: 'gpt-image-2-vip',
    status: 'completed',
    currentStep: 'final',
    currentAttemptNo: 1,
    retryCount: 0,
    maxRetries: 2,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    resultFileId: 'result-1',
    createdAt: '2026-05-07T10:00:00.000Z',
    startedAt: '2026-05-07T10:00:01.000Z',
    completedAt: '2026-05-07T10:00:05.000Z',
    durationMs: 4000,
    input: {
      prompt: 'hello world',
      imageSize: '2K',
      aspectRatio: '4:5',
      stylePreset: 'editorial',
      maskMode: null,
    },
    inputFileId: 'input-1',
    sourceFileId: null,
    maskFileId: null,
    maskMode: null,
    renderFileId: null,
    referenceFileId: null,
    workflowTemplateKey: 'template-a',
    providerTaskId: 'provider-task-1',
    providerClientId: 'provider-client-1',
    prompt: 'hello world',
    referenceFileIds: ['reference-1'],
    stylePreset: 'editorial',
    imageSize: '2K',
    aspectRatio: '4:5',
    whiteModelFileId: null,
    styleReferenceFileId: null,
    inputFile: null,
    sourceFile: null,
    maskFile: null,
    renderFile: null,
    referenceFile: null,
    whiteModelFile: null,
    styleReferenceFile: null,
    resultFile: null,
    ...overrides,
  };
}

function createDetail(overrides: Partial<TaskHistoryDetail> = {}): TaskHistoryDetail {
  const raw = createRawTask({
    status: overrides.status ?? 'completed',
    lastErrorCode: overrides.errorCode ?? null,
    lastErrorMessage: overrides.errorMessage ?? null,
  });
  const inputPreviewItems = overrides.inputPreviewItems ?? [
    createPreviewFile('input-1', '输入图', 'input'),
    createPreviewFile('reference-1', '参考图 1', 'reference'),
  ];
  const artifactPreviewItems = overrides.artifactPreviewItems ?? [
    createPreviewFile('result-1', '任务产物', 'result'),
  ];

  return {
    taskId: raw.taskId,
    taskNo: raw.taskNo,
    runId: raw.runId,
    runNo: raw.runNo,
    workflowId: raw.workflowId,
    projectId: raw.projectId,
    nodeId: raw.nodeId ?? null,
    nodeTitle: raw.nodeTitle ?? null,
    nodeType: raw.nodeType,
    taskType: raw.taskType,
    groupId: raw.groupId,
    groupOrder: raw.groupOrder,
    status: overrides.status ?? raw.status,
    currentStep: raw.currentStep,
    createdAt: Date.parse(raw.createdAt),
    startedAt: Date.parse(raw.startedAt ?? raw.createdAt),
    completedAt: Date.parse(raw.completedAt ?? raw.createdAt),
    durationMs: raw.durationMs ?? null,
    provider: raw.provider,
    model: raw.model,
    title: overrides.title ?? 'Task One',
    subtitle: overrides.subtitle ?? 'subtitle',
    message: overrides.message ?? 'task done',
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    latestEventAt: Date.parse(raw.completedAt ?? raw.createdAt),
    isTerminal: overrides.isTerminal ?? true,
    isFailed: overrides.isFailed ?? false,
    isCancelled: overrides.isCancelled ?? false,
    isSuccessful: overrides.isSuccessful ?? true,
    inputPreviewItems,
    artifactPreviewItems,
    primaryArtifact: overrides.primaryArtifact ?? artifactPreviewItems[0] ?? null,
    recentEvents: overrides.recentEvents ?? [],
    raw,
    events: overrides.events ?? [
      {
        eventId: 'event-1',
        eventType: 'task_progress',
        runId: 'run-1',
        taskId: 'task-1',
        attemptNo: 1,
        status: 'processing',
        phase: 'processing',
        stepType: 'final',
        progress: 30,
        message: 'processing',
        payload: { providerTaskId: 'provider-1' },
        timestamp: '2026-05-07T10:00:02.000Z',
      },
      {
        eventId: 'event-2',
        eventType: 'task_completed',
        runId: 'run-1',
        taskId: 'task-1',
        attemptNo: 1,
        status: 'completed',
        phase: 'completed',
        stepType: 'final',
        progress: 100,
        message: 'completed',
        payload: null,
        timestamp: '2026-05-07T10:00:05.000Z',
      },
    ],
    eventCount: overrides.eventCount ?? 2,
    runDetail: overrides.runDetail ?? {
      runId: 'run-1',
      runNo: 'RUN-1',
      workflowId: 'workflow-1',
      nodeId: 'node-1',
      nodeType: 'aiImageGen',
      status: 'completed',
      totalTaskCount: 1,
      completedTaskCount: 1,
      failedTaskCount: 0,
      progress: 100,
      message: 'done',
      createdAt: Date.parse('2026-05-07T10:00:00.000Z'),
      startedAt: Date.parse('2026-05-07T10:00:01.000Z'),
      completedAt: Date.parse('2026-05-07T10:00:05.000Z'),
      isTerminal: true,
      hasCommittableOutput: true,
      allOutputsCommitted: true,
      tasks: [],
    },
    inputFileSummaries: overrides.inputFileSummaries ?? [
      {
        key: 'input-1:input:0:0',
        fileId: 'input-1',
        role: 'input',
        label: '输入图',
        fileName: 'input-1.png',
        fileType: 'image',
        mimeType: 'image/png',
        format: 'png',
        size: 2048,
        width: 1536,
        height: 1024,
        duration: null,
      },
      {
        key: 'reference-1:reference:0:1',
        fileId: 'reference-1',
        role: 'reference',
        label: '参考图 1',
        fileName: 'reference-1.png',
        fileType: 'image',
        mimeType: 'image/png',
        format: 'png',
        size: 2048,
        width: 1536,
        height: 1024,
        duration: null,
      },
    ],
  };
}

test('TaskHistoryDetailModal defaults to artifact tab and renders title', () => {
  const detail = createDetail();

  const markup = renderToStaticMarkup(
    <TaskHistoryDetailModal
      isOpen={true}
      workflowId="workflow-1"
      item={detail}
      cachedDetail={detail}
      onClose={() => undefined}
    />,
  );

  assert.ok(markup.includes('task-history-detail-modal__tab--active'));
  assert.ok(markup.includes('TASK-1 / 任务详情'));
  assert.ok(markup.includes('产物'));
  assert.ok(markup.includes('result-1.png'));
});

test('TaskHistoryDetailModal renders image inpaint inputs, mask mode, and result on artifact tab', () => {
  const sourcePreview = createPreviewFile('source-inpaint', '原图', 'input');
  const maskPreview = createPreviewFile('mask-inpaint', '标记图', 'mask');
  const resultPreview = createPreviewFile('result-inpaint', '重绘结果', 'result');
  const detail = createDetail({
    nodeType: 'aiImageInpaint',
    taskType: 'image-inpaint',
    title: '图片局部重绘',
    inputPreviewItems: [sourcePreview, maskPreview],
    artifactPreviewItems: [resultPreview],
    primaryArtifact: resultPreview,
  });

  detail.raw = {
    ...detail.raw,
    nodeType: 'aiImageInpaint',
    taskType: 'image-inpaint',
    inputFileId: 'source-inpaint',
    sourceFileId: 'source-inpaint',
    maskFileId: 'mask-inpaint',
    maskMode: 'strong-mask',
    resultFileId: 'result-inpaint',
    input: {
      ...detail.raw.input,
      sourceFileId: 'source-inpaint',
      maskFileId: 'mask-inpaint',
      maskMode: 'strong-mask',
    },
  };

  detail.inputFileSummaries = [
    {
      key: 'source-inpaint:input:0:0',
      fileId: 'source-inpaint',
      role: 'input',
      label: '原图',
      fileName: 'source-inpaint.png',
      fileType: 'image',
      mimeType: 'image/png',
      format: 'png',
      size: 2048,
      width: 1536,
      height: 1024,
      duration: null,
    },
    {
      key: 'mask-inpaint:mask:1:1',
      fileId: 'mask-inpaint',
      role: 'mask',
      label: '标记图',
      fileName: 'mask-inpaint.png',
      fileType: 'image',
      mimeType: 'image/png',
      format: 'png',
      size: 2048,
      width: 1536,
      height: 1024,
      duration: null,
    },
  ];

  const artifactMarkup = renderToStaticMarkup(
    <TaskHistoryDetailModal
      isOpen={true}
      workflowId="workflow-1"
      item={detail}
      cachedDetail={detail}
      onClose={() => undefined}
    />,
  );
  const infoMarkup = renderToStaticMarkup(
    <TaskHistoryDetailModal
      isOpen={true}
      workflowId="workflow-1"
      item={detail}
      cachedDetail={detail}
      onClose={() => undefined}
      initialTab="info"
    />,
  );

  assert.ok(artifactMarkup.includes('原图'));
  assert.ok(artifactMarkup.includes('标记图'));
  assert.ok(artifactMarkup.includes('重绘结果'));
  assert.ok(artifactMarkup.includes('source-inpaint.png'));
  assert.ok(artifactMarkup.includes('mask-inpaint.png'));
  assert.ok(artifactMarkup.includes('result-inpaint.png'));
  assert.ok(infoMarkup.includes('遮罩模式'));
  assert.ok(infoMarkup.includes('强遮罩'));
});

test('TaskHistoryDetailModal renders full info tab with complete inputs and metadata', () => {
  const detail = createDetail();

  const markup = renderToStaticMarkup(
    <TaskHistoryDetailModal
      isOpen={true}
      workflowId="workflow-1"
      item={detail}
      cachedDetail={detail}
      onClose={() => undefined}
      initialTab="info"
    />,
  );

  assert.ok(markup.includes('完整输入'));
  assert.ok(markup.includes('输入文件摘要'));
  assert.ok(markup.includes('任务元信息'));
  assert.ok(markup.includes('执行元信息'));
  assert.ok(markup.includes('运行汇总'));
  assert.ok(markup.includes('输入参数'));
  assert.ok(markup.includes('输入图'));
  assert.ok(markup.includes('reference-1.png'));
  assert.ok(markup.includes('任务 ID'));
  assert.ok(markup.includes('Provider'));
  assert.ok(markup.includes('模型'));
  assert.ok(markup.includes('Prompt'));
  assert.ok(markup.includes('hello world'));
  assert.ok(markup.includes('template-a'));
  assert.ok(markup.includes('provider-task-1'));
  assert.ok(markup.includes('stylePreset'));
  assert.ok(markup.includes('editorial'));
});

test('TaskHistoryDetailModal renders failure banner and preserves error context', () => {
  const detail = createDetail({
    status: 'failed',
    isFailed: true,
    isSuccessful: false,
    errorCode: 'PROVIDER_ERROR',
    errorMessage: 'provider failed',
    message: 'provider failed',
  });

  const markup = renderToStaticMarkup(
    <TaskHistoryDetailModal
      isOpen={true}
      workflowId="workflow-1"
      item={detail}
      cachedDetail={detail}
      onClose={() => undefined}
      initialTab="info"
    />,
  );

  assert.ok(markup.includes('任务失败'));
  assert.ok(markup.includes('PROVIDER_ERROR / provider failed'));
  assert.ok(markup.includes('最后错误码'));
  assert.ok(markup.includes('最后错误摘要'));
});

test('TaskHistoryDetailModal renders events timeline and cancelled status text', () => {
  const detail = createDetail({
    status: 'cancelled',
    isCancelled: true,
    isSuccessful: false,
    message: 'cancelled by user',
    errorMessage: 'cancelled by user',
  });

  const markup = renderToStaticMarkup(
    <TaskHistoryDetailModal
      isOpen={true}
      workflowId="workflow-1"
      item={detail}
      cachedDetail={detail}
      onClose={() => undefined}
      initialTab="events"
    />,
  );

  assert.ok(markup.includes('task-history-detail-modal__event-list'));
  assert.ok(markup.includes('task_progress'));
  assert.ok(markup.includes('task_completed'));
  assert.ok(markup.includes('processing'));
  assert.ok(markup.includes('completed'));
  assert.ok(markup.includes('cancelled by user'));
});
