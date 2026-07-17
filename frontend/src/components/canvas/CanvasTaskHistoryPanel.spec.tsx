import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import type { TaskHistoryListItem, TaskHistoryDetail, WorkflowTaskHistoryBackendTaskItem } from './task-history.types';
import { CanvasTaskHistoryPanel } from './CanvasTaskHistoryPanel';
import { canvasTaskHistoryStore } from './canvas-task-history.store';

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
    resultFileId: null,
    createdAt: '2026-05-07T10:00:00.000Z',
    startedAt: '2026-05-07T10:00:01.000Z',
    completedAt: '2026-05-07T10:00:02.000Z',
    durationMs: 1000,
    input: null,
    inputFileId: null,
    sourceFileId: null,
    renderFileId: null,
    referenceFileId: null,
    workflowTemplateKey: null,
    providerTaskId: null,
    providerClientId: null,
    prompt: 'prompt',
    referenceFileIds: null,
    stylePreset: null,
    imageSize: '1K',
    aspectRatio: '1:1',
    whiteModelFileId: null,
    styleReferenceFileId: null,
    inputFile: null,
    sourceFile: null,
    renderFile: null,
    referenceFile: null,
    whiteModelFile: null,
    styleReferenceFile: null,
    resultFile: null,
    ...overrides,
  };
}

function createItem(overrides: Partial<TaskHistoryListItem> = {}): TaskHistoryListItem {
  const raw = createRawTask({
    taskId: overrides.taskId ?? 'task-1',
    taskNo: overrides.taskNo ?? 'TASK-1',
    createdAt: new Date(overrides.createdAt ?? Date.parse('2026-05-07T10:00:00.000Z')).toISOString(),
    nodeTitle: overrides.title ?? 'Task One',
    status: overrides.status ?? 'completed',
    lastErrorCode: overrides.errorCode ?? null,
    lastErrorMessage: overrides.errorMessage ?? null,
    nodeType: overrides.nodeType ?? 'aiImageGen',
  });

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
    status: raw.status,
    currentStep: raw.currentStep,
    createdAt: overrides.createdAt ?? Date.parse(raw.createdAt),
    startedAt: raw.startedAt ? Date.parse(raw.startedAt) : null,
    completedAt: raw.completedAt ? Date.parse(raw.completedAt) : null,
    durationMs: raw.durationMs ?? null,
    provider: raw.provider,
    model: raw.model,
    title: overrides.title ?? raw.nodeTitle ?? raw.taskNo,
    subtitle: overrides.subtitle ?? 'subtitle',
    message: overrides.message ?? 'done',
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    latestEventAt: overrides.latestEventAt ?? Date.parse(raw.completedAt ?? raw.createdAt),
    isTerminal: overrides.isTerminal ?? true,
    isFailed: overrides.isFailed ?? false,
    isCancelled: overrides.isCancelled ?? false,
    isSuccessful: overrides.isSuccessful ?? true,
    artifactPreviewItems: overrides.artifactPreviewItems ?? [],
    primaryArtifact: overrides.primaryArtifact ?? null,
    relatedTaskRef: overrides.relatedTaskRef,
  };
}

function createDetail(item: TaskHistoryListItem): TaskHistoryDetail {
  const raw = createRawTask({
    taskId: item.taskId,
    taskNo: item.taskNo,
    nodeType: item.nodeType,
  });

  return {
    ...item,
    provider: item.provider ?? raw.provider,
    model: item.model ?? raw.model,
    title: item.title ?? raw.nodeTitle ?? raw.taskNo,
    subtitle: item.subtitle ?? null,
    latestEventAt: item.latestEventAt ?? Date.parse(raw.completedAt ?? raw.createdAt),
    inputPreviewItems: [],
    recentEvents: [],
    raw,
    events: [],
    eventCount: 0,
  };
}

test('CanvasTaskHistoryPanel renders empty state and collapsed aria attributes', () => {
  const markup = renderToStaticMarkup(
    <CanvasTaskHistoryPanel
      workflowId="workflow-empty"
      items={[]}
      topOffset={24}
      isCollapsed={true}
      onToggle={() => undefined}
    />,
  );

  assert.ok(markup.includes('canvas-task-history-panel--collapsed'));
  assert.ok(markup.includes('aria-expanded="false"'));
  assert.ok(markup.includes('canvas-task-history-panel__empty'));
  assert.ok(markup.includes('canvas-task-history-panel__empty-title'));
});

test('CanvasTaskHistoryPanel renders latest task first and can open detail modal from default selection', () => {
  const workflowId = 'workflow-panel';
  canvasTaskHistoryStore.clear(workflowId);

  const newer = createItem({
    taskId: 'task-newer',
    taskNo: 'TASK-NEWER',
    createdAt: Date.parse('2026-05-07T12:00:00.000Z'),
  });
  const older = createItem({
    taskId: 'task-older',
    taskNo: 'TASK-OLDER',
    createdAt: Date.parse('2026-05-07T11:00:00.000Z'),
  });

  canvasTaskHistoryStore.upsertDetail({
    workflowId,
    detail: createDetail(newer),
  });

  const markup = renderToStaticMarkup(
    <CanvasTaskHistoryPanel
      workflowId={workflowId}
      items={[newer, older]}
      topOffset={16}
      isCollapsed={false}
      onToggle={() => undefined}
      defaultSelectedTaskId="task-newer"
    />,
  );

  const newerIndex = markup.indexOf('TASK-NEWER');
  const olderIndex = markup.indexOf('TASK-OLDER');

  assert.equal(newerIndex >= 0, true);
  assert.equal(olderIndex >= 0, true);
  assert.equal(newerIndex < olderIndex, true);
  assert.ok(markup.includes('task-history-detail-modal__tab--active'));

  canvasTaskHistoryStore.clear(workflowId);
});

test('CanvasTaskHistoryPanel list stays lightweight and shows node type, task id and artifact section', () => {
  const item = createItem({
    taskId: 'task-light',
    taskNo: 'TASK-LIGHT',
    nodeType: 'aiImageHd',
  });

  const markup = renderToStaticMarkup(
    <CanvasTaskHistoryPanel
      workflowId="workflow-light"
      items={[item]}
      topOffset={12}
      isCollapsed={false}
      onToggle={() => undefined}
    />,
  );

  assert.ok(markup.includes('aiImageHd'));
  assert.ok(markup.includes('TASK-LIGHT'));
  assert.ok(markup.includes('canvas-task-history-card__section-title'));
});

test('CanvasTaskHistoryPanel can render without its local toggle when controlled from side nav', () => {
  const markup = renderToStaticMarkup(
    <CanvasTaskHistoryPanel
      workflowId="workflow-side-nav"
      items={[]}
      topOffset={84}
      isCollapsed={false}
      showToggle={false}
    />,
  );

  assert.equal(markup.includes('canvas-task-history-panel__toggle'), false);
  assert.equal(markup.includes('canvas-task-history-panel__surface'), true);
});
