import type {
  WorkflowAIExecutionState,
  WorkflowNodeGroupExecutionState,
} from '@/contracts/execution';

type ExecutionLikeState = WorkflowAIExecutionState | WorkflowNodeGroupExecutionState;

export function getExecutionStatusLabel(
  status: ExecutionLikeState['status'],
): string | null {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'processing':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'skipped':
      return '已跳过';
    default:
      return null;
  }
}

export function getExecutionStepLabel(step?: string | null): string | null {
  switch (step) {
    case 'lineart':
      return '线稿生成';
    case 'depth':
      return '深度图生成';
    case 'final':
      return '最终结果生成';
    default:
      return null;
  }
}

export function getExecutionAttemptLabel(state: ExecutionLikeState): string | null {
  if (!state.currentAttemptNo || !state.maxAttempts) {
    return null;
  }

  return `第 ${state.currentAttemptNo} / ${state.maxAttempts} 次尝试`;
}

export function getExecutionRetryLabel(state: ExecutionLikeState): string | null {
  if (!state.currentAttemptNo || !state.maxAttempts) {
    return null;
  }

  if (state.status !== 'processing' || state.currentAttemptNo <= 1) {
    return null;
  }

  return `正在重试第 ${state.currentAttemptNo - 1} 次`;
}

export function getExecutionDetailLines(state: ExecutionLikeState): string[] {
  const lines: string[] = [];
  const stepLabel = getExecutionStepLabel(state.currentStep);
  const attemptLabel = getExecutionAttemptLabel(state);
  const retryLabel = getExecutionRetryLabel(state);

  if (stepLabel && state.status === 'processing') {
    lines.push(`当前步骤：${stepLabel}`);
  }

  if (attemptLabel) {
    lines.push(attemptLabel);
  }

  if (retryLabel) {
    lines.push(retryLabel);
  }

  if (state.status === 'queued') {
    lines.push('等待后端调度');
  }

  if (state.status === 'failed' && state.currentAttemptNo && state.maxAttempts) {
    lines.push(`最终执行失败，已完成 ${state.currentAttemptNo} 次尝试`);
  }

  if (state.status === 'cancelled') {
    lines.push(state.message ?? '已停止前端轮询，后端任务可能仍在执行');
  }

  return lines;
}

export function getExecutionErrorMessage(state: ExecutionLikeState): string | null {
  if (state.status === 'cancelled') {
    return null;
  }

  const userMessage = getExecutionErrorUserMessage(state.lastErrorCode, state.error ?? undefined);

  if (!userMessage) {
    return null;
  }

  if (state.status === 'failed') {
    return `最终执行失败：${userMessage}`;
  }

  return userMessage;
}

export function getMissingInputMessage(
  whiteModelExists: boolean,
  styleReferenceExists: boolean,
): string | null {
  if (whiteModelExists && styleReferenceExists) {
    return null;
  }

  if (!whiteModelExists && !styleReferenceExists) {
    return '缺少白模图和风格参考图';
  }

  if (!whiteModelExists) {
    return '缺少白模图';
  }

  return '缺少风格参考图';
}

export function getExecutionErrorUserMessage(
  errorCode?: string | null,
  fallbackMessage?: string,
): string | null {
  switch (errorCode) {
    case 'FILE_REGISTER_FAILED':
      return '输入文件注册失败，请稍后重试';
    case 'MASK_FILE_REGISTER_FAILED':
      return '局部重绘标记图注册失败，请重新标记后再试';
    case 'FILE_CORRUPTED':
      return '输入文件已失效，请重新上传后再执行';
    case 'FILE_DOWNLOAD_FAILED':
    case 'DOWNLOAD_ERROR':
      return '读取输入文件失败，请检查原始文件是否仍可访问';
    case 'UPLOAD_ERROR':
    case 'FILE_UPLOAD_FAILED':
      return '输入文件上传失败，请稍后重试';
    case 'EXECUTION_CREATE_FAILED':
    case 'TASK_CREATE_FAILED':
      return fallbackMessage ?? '任务创建失败，请稍后重试';
    case 'TASK_QUERY_FAILED':
      return '任务状态获取失败，请稍后重试';
    case 'TASK_CANCEL_FAILED':
      return '取消任务失败，请稍后重试';
    case 'TIMEOUT':
    case 'TIMEOUT_ERROR':
    case 'AI_TASK_TIMEOUT':
      return '外部服务响应超时';
    case 'NETWORK_ERROR':
      return '网络异常，无法完成当前请求';
    case 'AI_RATE_LIMIT':
    case 'RATE_LIMIT_ERROR':
      return '外部服务当前较忙，请稍后重试';
    case 'PROVIDER_ERROR':
    case 'AI_PROVIDER_ERROR':
      return fallbackMessage ?? '外部服务执行失败';
    case 'INVALID_RESPONSE':
      return '外部服务返回结果异常';
    case 'STORAGE_ERROR':
      return '结果保存失败';
    case 'INVALID_AI_IMAGE_INPAINT_TASK_INPUT':
      return '图片局部重绘任务输入无效，请确认原图、标记图、遮罩模式和提示词都已正确提交';
    case 'INVALID_AI_IMAGE_INPAINT_PROMPT':
      return '图片局部重绘提示词不能为空';
    case 'INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID':
      return '图片局部重绘缺少可用原图，请重新拖入原图后执行';
    case 'INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID':
      return '图片局部重绘缺少可用标记图，请重新涂抹标记区域后执行';
    case 'INVALID_AI_IMAGE_INPAINT_MASK_STROKES':
      return '图片局部重绘缺少标记区域，请先用画笔涂抹需要重绘的位置';
    case 'AI_IMAGE_INPAINT_MASK_EXPORT_FAILED':
      return fallbackMessage ?? '局部重绘标记图导出失败，请重新涂抹标记区域后再试';
    case 'INVALID_AI_IMAGE_INPAINT_MASK_MODE':
      return '图片局部重绘遮罩模式无效，请重新选择遮罩模式后执行';
    case 'CANCELLED':
    case 'AI_TASK_CANCELLED':
      return '任务已取消';
    case 'NOT_FOUND':
    case 'NOT_FOUND_ERROR':
      return '任务或文件不存在，可能已失效';
    case 'PERMISSION_ERROR':
    case 'FORBIDDEN':
      return '当前没有权限执行该操作';
    case 'VALIDATION_ERROR':
      return fallbackMessage ?? '请求参数校验失败';
    default:
      return fallbackMessage ?? null;
  }
}

function normalizeExecutionErrorMeta(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

export function formatExecutionErrorMessage(
  errorCode?: string | null,
  fallbackMessage?: string | null,
  errorContext?: Record<string, unknown> | null,
): string | null {
  const message = getExecutionErrorUserMessage(errorCode, fallbackMessage ?? undefined);
  const details: string[] = [];
  const normalizedErrorCode = normalizeExecutionErrorMeta(errorCode);
  const backendError = normalizeExecutionErrorMeta(errorContext?.backendError);
  const backendCode = normalizeExecutionErrorMeta(errorContext?.backendCode);

  if (normalizedErrorCode) {
    details.push(`错误码：${normalizedErrorCode}`);
  }

  if (backendError && backendError !== normalizedErrorCode) {
    details.push(`后端错误：${backendError}`);
  }

  if (backendCode && backendCode !== normalizedErrorCode) {
    details.push(`业务码：${backendCode}`);
  }

  if (!message) {
    return details.length > 0 ? details.join('，') : null;
  }

  return details.length > 0 ? `${message}（${details.join('，')}）` : message;
}
