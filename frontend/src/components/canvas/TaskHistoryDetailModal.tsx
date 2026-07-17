import { memo, useEffect, useMemo, useState } from 'react';

import { Modal } from '@/components/ui/primitives';
import { normalizeWorkflowTaskHistoryDetail } from '@/services/task-history-normalizer';
import { workflowTaskHistoryService } from '@/services/workflow-task-history.service';
import { getModelDisplayName, getProviderDisplayName, getTaskTypeDisplayName } from '@/utils/ai/display';
import { canvasTaskHistoryStore } from './canvas-task-history.store';
import { TaskHistoryArtifactPreview } from './TaskHistoryArtifactPreview';
import { TaskHistoryInputPreviewStrip } from './TaskHistoryInputPreviewStrip';
import type {
  TaskHistoryDetail,
  TaskHistoryDetailInputFileSummary,
  TaskHistoryListItem,
} from './task-history.types';

type DetailTab = 'artifact' | 'info' | 'events';

interface TaskHistoryDetailModalProps {
  isOpen: boolean;
  workflowId: string | null;
  item: TaskHistoryListItem | null;
  cachedDetail?: TaskHistoryDetail;
  onClose: () => void;
  initialTab?: DetailTab;
}

interface InfoRow {
  label: string;
  value: string;
}

function formatDateTime(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '无';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatPayload(value: unknown): string {
  if (value === null || value === undefined) {
    return '无';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '无';
  }

  return String(value);
}

function formatDurationMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '无';
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(2)} s`;
}

function formatFileSize(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '未知大小';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatFileDimensions(summary: TaskHistoryDetailInputFileSummary): string | null {
  if (typeof summary.width === 'number' && typeof summary.height === 'number') {
    return `${summary.width} x ${summary.height}`;
  }

  return null;
}

function formatFileDuration(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return `${value.toFixed(1)} 秒`;
}

function getStatusTitle(detail: TaskHistoryListItem): string {
  if (detail.isFailed) {
    return '任务失败';
  }
  if (detail.isCancelled) {
    return '任务已取消';
  }
  if (!detail.isTerminal) {
    return '任务执行中';
  }
  return '任务已完成';
}

function hasFullTaskHistoryDetail(
  detail: TaskHistoryListItem | TaskHistoryDetail | null | undefined,
): detail is TaskHistoryDetail {
  return Boolean(
    detail
      && detail.raw
      && Array.isArray(detail.inputPreviewItems)
      && Array.isArray((detail as TaskHistoryDetail).events),
  );
}

function toDisplayValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : '无';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '无';
  }

  return '无';
}

function getMaskModeDisplayName(value: unknown): string {
  if (value === 'original-markup') {
    return '原图遮罩';
  }

  if (value === 'strong-mask') {
    return '强遮罩';
  }

  return toDisplayValue(value);
}

function buildTaskInfoRows(detail: TaskHistoryDetail): InfoRow[] {
  const input = detail.raw.input ?? {};

  return [
    { label: '任务编号', value: detail.taskNo },
    { label: '任务 ID', value: detail.taskId },
    { label: '运行 ID', value: detail.runId },
    { label: '运行编号', value: toDisplayValue(detail.runNo) },
    { label: '节点 ID', value: toDisplayValue(detail.nodeId) },
    { label: '节点类型', value: detail.nodeType },
    { label: '任务类型', value: getTaskTypeDisplayName(detail.taskType as never) },
    { label: '状态', value: detail.status },
    { label: '当前步骤', value: toDisplayValue(detail.currentStep) },
    { label: 'Provider', value: detail.provider ? getProviderDisplayName(detail.provider as never) : '无' },
    { label: '模型', value: detail.model ? getModelDisplayName(detail.model as never) : '无' },
    { label: 'Prompt', value: toDisplayValue(detail.raw.prompt ?? input.prompt) },
    { label: '分辨率', value: toDisplayValue(detail.raw.imageSize ?? input.imageSize) },
    { label: '画面比例', value: toDisplayValue(detail.raw.aspectRatio ?? input.aspectRatio) },
    { label: '遮罩模式', value: getMaskModeDisplayName(detail.raw.maskMode ?? input.maskMode) },
    { label: '风格预设', value: toDisplayValue(detail.raw.stylePreset ?? input.stylePreset) },
    { label: '任务分组', value: detail.groupOrder !== null ? `第 ${detail.groupOrder + 1} 组` : '无' },
    { label: '分组 ID', value: toDisplayValue(detail.groupId) },
    { label: '创建时间', value: formatDateTime(detail.createdAt) },
    { label: '开始时间', value: formatDateTime(detail.startedAt) },
    { label: '完成时间', value: formatDateTime(detail.completedAt) },
    { label: '耗时', value: formatDurationMs(detail.durationMs) },
  ];
}

function buildExecutionInfoRows(detail: TaskHistoryDetail): InfoRow[] {
  return [
    { label: '当前重试序号', value: formatNumber(detail.raw.currentAttemptNo) },
    { label: '已重试次数', value: formatNumber(detail.raw.retryCount) },
    { label: '最大重试次数', value: formatNumber(detail.raw.maxRetries) },
    { label: '最大尝试次数', value: formatNumber(detail.raw.maxAttempts) },
    { label: '最新事件时间', value: formatDateTime(detail.latestEventAt) },
    { label: '事件总数', value: formatNumber(detail.eventCount) },
    { label: 'Provider Task ID', value: toDisplayValue(detail.raw.providerTaskId) },
    { label: 'Provider Client ID', value: toDisplayValue(detail.raw.providerClientId) },
    { label: '工作流模板', value: toDisplayValue(detail.raw.workflowTemplateKey) },
    { label: '最后错误码', value: toDisplayValue(detail.errorCode) },
    { label: '最后错误摘要', value: toDisplayValue(detail.errorMessage ?? detail.message) },
  ];
}

function buildRunInfoRows(detail: TaskHistoryDetail): InfoRow[] {
  if (!detail.runDetail) {
    return [];
  }

  return [
    { label: '运行状态', value: detail.runDetail.status },
    { label: '运行进度', value: `${detail.runDetail.progress}%` },
    { label: '运行消息', value: toDisplayValue(detail.runDetail.message) },
    { label: '总任务数', value: formatNumber(detail.runDetail.totalTaskCount) },
    { label: '完成任务数', value: formatNumber(detail.runDetail.completedTaskCount) },
    { label: '失败任务数', value: formatNumber(detail.runDetail.failedTaskCount) },
    { label: '运行创建时间', value: formatDateTime(detail.runDetail.createdAt) },
    { label: '运行开始时间', value: formatDateTime(detail.runDetail.startedAt) },
    { label: '运行完成时间', value: formatDateTime(detail.runDetail.completedAt) },
    { label: '结果可提交', value: detail.runDetail.hasCommittableOutput ? '是' : '否' },
    { label: '结果已全部提交', value: detail.runDetail.allOutputsCommitted ? '是' : '否' },
  ];
}

function InputFileSummaryCard({ summary }: { summary: TaskHistoryDetailInputFileSummary; }) {
  const metadata = [
    summary.label,
    summary.fileType,
    summary.format,
    summary.mimeType,
    formatFileSize(summary.size),
    formatFileDimensions(summary),
    formatFileDuration(summary.duration),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return (
    <div className="task-history-detail-modal__file-card">
      <div className="task-history-detail-modal__file-name" title={summary.fileName}>
        {summary.fileName}
      </div>
      <div className="task-history-detail-modal__file-id">{summary.fileId}</div>
      <div className="task-history-detail-modal__file-meta">
        {metadata.map((item) => (
          <span key={item} className="task-history-detail-modal__file-chip">{item}</span>
        ))}
      </div>
    </div>
  );
}

export const TaskHistoryDetailModal = memo(({
  isOpen,
  workflowId,
  item,
  cachedDetail,
  onClose,
  initialTab = 'artifact',
}: TaskHistoryDetailModalProps) => {
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab);
  const [detail, setDetail] = useState<TaskHistoryDetail | null>(cachedDetail ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(initialTab);
    setDetail(cachedDetail ?? null);
    setError(null);
  }, [cachedDetail, initialTab, isOpen, item?.taskId]);

  useEffect(() => {
    if (!isOpen || !workflowId || !item) {
      return;
    }

    if (cachedDetail) {
      setDetail(cachedDetail);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const bundle = await workflowTaskHistoryService.getWorkflowTaskDetailBundle(workflowId, item.taskId, {
          runId: item.runId,
          signal: controller.signal,
        });

        if (cancelled) {
          return;
        }

        const normalized = await normalizeWorkflowTaskHistoryDetail(bundle.detail, {
          events: bundle.events.items,
          runDetail: bundle.runDetail,
          relatedTasks: item.relatedTaskRef ? [item.relatedTaskRef] : undefined,
        });

        if (cancelled) {
          return;
        }

        setDetail(normalized);
        canvasTaskHistoryStore.upsertDetail({
          workflowId,
          detail: normalized,
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : '任务详情加载失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cachedDetail, isOpen, item, workflowId]);

  const resolvedDetail = detail ?? cachedDetail ?? item;
  const resolvedTaskDetail = hasFullTaskHistoryDetail(detail)
    ? detail
    : hasFullTaskHistoryDetail(cachedDetail)
      ? cachedDetail
      : null;
  const tabs: Array<{ id: DetailTab; label: string; }> = [
    { id: 'artifact', label: '产物' },
    { id: 'info', label: '完整信息' },
    { id: 'events', label: '事件日志' },
  ];

  const taskInfoRows = useMemo(
    () => (resolvedTaskDetail ? buildTaskInfoRows(resolvedTaskDetail) : []),
    [resolvedTaskDetail],
  );
  const executionInfoRows = useMemo(
    () => (resolvedTaskDetail ? buildExecutionInfoRows(resolvedTaskDetail) : []),
    [resolvedTaskDetail],
  );
  const runInfoRows = useMemo(
    () => (resolvedTaskDetail ? buildRunInfoRows(resolvedTaskDetail) : []),
    [resolvedTaskDetail],
  );
  const inputFileSummaries = resolvedTaskDetail?.inputFileSummaries ?? [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={resolvedDetail ? `${resolvedDetail.taskNo} / 任务详情` : '任务详情'}
      size="xl"
    >
      <div className="task-history-detail-modal">
        {resolvedDetail && (resolvedDetail.isFailed || resolvedDetail.isCancelled) && (
          <div
            className={[
              'task-history-detail-modal__banner',
              resolvedDetail.isFailed
                ? 'task-history-detail-modal__banner--failed'
                : 'task-history-detail-modal__banner--cancelled',
            ].join(' ')}
          >
            <div className="task-history-detail-modal__banner-title">{getStatusTitle(resolvedDetail)}</div>
            <div className="task-history-detail-modal__banner-text">
              {resolvedDetail.errorCode ? `${resolvedDetail.errorCode} / ` : ''}
              {resolvedDetail.errorMessage ?? resolvedDetail.message ?? '无更多错误信息'}
            </div>
          </div>
        )}

        <div className="task-history-detail-modal__tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={[
                'task-history-detail-modal__tab',
                activeTab === tab.id ? 'task-history-detail-modal__tab--active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && !resolvedDetail && (
          <div className="task-history-detail-modal__loading">任务详情加载中...</div>
        )}

        {error && !resolvedDetail && (
          <div className="task-history-detail-modal__error">{error}</div>
        )}

        {resolvedDetail && activeTab === 'artifact' && (
          <div className="task-history-detail-modal__panel">
            {resolvedTaskDetail?.inputPreviewItems && resolvedTaskDetail.inputPreviewItems.length > 0 && (
              <section className="task-history-detail-modal__section">
                <div className="task-history-detail-modal__section-title">输入</div>
                <TaskHistoryInputPreviewStrip items={resolvedTaskDetail.inputPreviewItems} />
              </section>
            )}
            <TaskHistoryArtifactPreview item={resolvedDetail} />
          </div>
        )}

        {resolvedDetail && activeTab === 'info' && (
          <div className="task-history-detail-modal__panel">
            {resolvedTaskDetail ? (
              <>
                <section className="task-history-detail-modal__section">
                  <div className="task-history-detail-modal__section-title">完整输入</div>
                  {resolvedTaskDetail.inputPreviewItems.length > 0 ? (
                    <TaskHistoryInputPreviewStrip items={resolvedTaskDetail.inputPreviewItems} />
                  ) : (
                    <div className="task-history-detail-modal__empty">无输入文件</div>
                  )}
                </section>

                <section className="task-history-detail-modal__section">
                  <div className="task-history-detail-modal__section-title">输入文件摘要</div>
                  {inputFileSummaries.length > 0 ? (
                    <div className="task-history-detail-modal__file-grid">
                      {inputFileSummaries.map((summary) => (
                        <InputFileSummaryCard key={summary.key} summary={summary} />
                      ))}
                    </div>
                  ) : (
                    <div className="task-history-detail-modal__empty">无输入文件摘要</div>
                  )}
                </section>

                <section className="task-history-detail-modal__section">
                  <div className="task-history-detail-modal__section-title">任务元信息</div>
                  <div className="task-history-detail-modal__info-grid">
                    {taskInfoRows.map((row) => (
                      <div key={row.label} className="task-history-detail-modal__info-row">
                        <div className="task-history-detail-modal__info-label">{row.label}</div>
                        <div className="task-history-detail-modal__info-value">{row.value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="task-history-detail-modal__section">
                  <div className="task-history-detail-modal__section-title">执行元信息</div>
                  <div className="task-history-detail-modal__info-grid">
                    {executionInfoRows.map((row) => (
                      <div key={row.label} className="task-history-detail-modal__info-row">
                        <div className="task-history-detail-modal__info-label">{row.label}</div>
                        <div className="task-history-detail-modal__info-value">{row.value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                {runInfoRows.length > 0 && (
                  <section className="task-history-detail-modal__section">
                    <div className="task-history-detail-modal__section-title">运行汇总</div>
                    <div className="task-history-detail-modal__info-grid">
                      {runInfoRows.map((row) => (
                        <div key={row.label} className="task-history-detail-modal__info-row">
                          <div className="task-history-detail-modal__info-label">{row.label}</div>
                          <div className="task-history-detail-modal__info-value">{row.value}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="task-history-detail-modal__section">
                  <div className="task-history-detail-modal__section-title">输入参数</div>
                  <pre className="task-history-detail-modal__payload-pre">
                    {formatPayload(resolvedTaskDetail.raw.input)}
                  </pre>
                </section>
              </>
            ) : (
              <div className="task-history-detail-modal__loading">任务详情加载中...</div>
            )}
          </div>
        )}

        {resolvedDetail && activeTab === 'events' && (
          <div className="task-history-detail-modal__panel">
            {resolvedTaskDetail?.events && resolvedTaskDetail.events.length > 0 ? (
              <div className="task-history-detail-modal__event-list">
                {resolvedTaskDetail.events.map((event) => (
                  <div key={event.eventId} className="task-history-detail-modal__event-item">
                    <div className="task-history-detail-modal__event-head">
                      <span className="task-history-detail-modal__event-type">{event.eventType}</span>
                      <span className="task-history-detail-modal__event-time">
                        {formatDateTime(Date.parse(event.timestamp))}
                      </span>
                    </div>
                    <div className="task-history-detail-modal__event-meta">
                      <span>{event.status}</span>
                      <span>{event.phase}</span>
                      <span>{event.stepType ?? 'no-step'}</span>
                      <span>{event.progress}%</span>
                    </div>
                    {event.message && (
                      <div className="task-history-detail-modal__event-message">{event.message}</div>
                    )}
                    {event.payload && (
                      <pre className="task-history-detail-modal__event-payload">{formatPayload(event.payload)}</pre>
                    )}
                  </div>
                ))}
              </div>
            ) : loading ? (
              <div className="task-history-detail-modal__loading">事件日志加载中...</div>
            ) : (
              <div className="task-history-detail-modal__empty">无事件日志</div>
            )}
          </div>
        )}

        {error && resolvedDetail && (
          <div className="task-history-detail-modal__inline-error">{error}</div>
        )}
      </div>
    </Modal>
  );
});

TaskHistoryDetailModal.displayName = 'TaskHistoryDetailModal';
