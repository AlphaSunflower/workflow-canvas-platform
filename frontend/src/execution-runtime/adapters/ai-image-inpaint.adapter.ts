import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import {
  AI_IMAGE_INPAINT_GROUP_ID,
  AI_IMAGE_INPAINT_INPUT_PORT_ID,
  getAIImageInpaintOutputHandle,
} from '@/nodes/ai-image-inpaint/groups';
import {
  AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
  normalizeAIImageInpaintMaskMode,
} from '@/nodes/ai-image-inpaint/constants';
import {
  buildAIImageInpaintBackendGroupPayload,
  buildAIImageInpaintBackendRequestConfig,
} from '@/nodes/ai-image-inpaint/runtime';
import {
  getAIImageInpaintMaskExportController,
  getAIImageInpaintMaskExporter,
} from '@/nodes/ai-image-inpaint/export-registry';
import { hasInpaintMaskStrokeMarks } from '@/nodes/ai-image-inpaint/mask-export';
import { normalizeAIImageInpaintMaskStrokes } from '@/nodes/ai-image-inpaint/mask-strokes';
import type { AIImageInpaintMaskSnapshot } from '@/nodes/ai-image-inpaint/mask-strokes';
import type { AppError, FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/common/guards';
import { createGroupedExecutionOutputAdapter } from '../execution-output-commit.adapters';
import { buildExecutionRuntimePatchesFromSnapshot } from '../execution-polling.utils';
import type {
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimeNodeAdapterContext,
} from '../node-execution-adapter.types';
import type { ExecutionRuntimeGroupedNodeExecutionTarget } from '../node-execution.types';

interface AIImageInpaintExecutableGroup {
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  outputHandle: string;
  sourceNode: FileNodeData;
}

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();

const AI_IMAGE_INPAINT_ERROR_MODULE = 'ai-image-inpaint.adapter';

function createInpaintAdapterError(
  code: string,
  message: string,
  context?: Record<string, unknown>,
): AppError {
  return {
    code,
    message,
    module: AI_IMAGE_INPAINT_ERROR_MODULE,
    operation: 'createExecutionPayload',
    timestamp: Date.now(),
    context,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function normalizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getImageInputNodes(groupState: WorkflowResolvedNodeGroupState): FileNodeData[] {
  const port = groupState.ports.find((item) => item.portId === AI_IMAGE_INPAINT_INPUT_PORT_ID);
  if (!port) {
    return [];
  }

  return port.inputs
    .map((input) => input.sourceNode)
    .filter((node): node is FileNodeData => isFileNodeData(node) && node.type === 'image');
}

function getExecutableGroups(
  context: ExecutionRuntimeNodeAdapterContext,
): AIImageInpaintExecutableGroup[] {
  return context.resolvedInputGroups
    .map((groupState) => {
      const inputNodes = getImageInputNodes(groupState);
      if (inputNodes.length !== 1) {
        return null;
      }

      return {
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        groupOrder: groupState.group.order,
        outputHandle: getAIImageInpaintOutputHandle(),
        sourceNode: inputNodes[0],
      } satisfies AIImageInpaintExecutableGroup;
    })
    .filter((group): group is AIImageInpaintExecutableGroup => Boolean(group))
    .sort((left, right) => left.groupOrder - right.groupOrder);
}

function getImageInputCount(context: ExecutionRuntimeNodeAdapterContext): number {
  return context.resolvedInputGroups.reduce((sum, groupState) => (
    sum + getImageInputNodes(groupState).length
  ), 0);
}

function getNormalizedMaskStrokes(context: ExecutionRuntimeNodeAdapterContext) {
  return normalizeAIImageInpaintMaskStrokes(context.node.config.maskStrokes);
}

function hasExecutableMaskMarks(context: ExecutionRuntimeNodeAdapterContext): boolean {
  return hasInpaintMaskStrokeMarks(getNormalizedMaskStrokes(context), {
    width: typeof context.node.config.maskSourceWidth === 'number'
      ? context.node.config.maskSourceWidth
      : undefined,
    height: typeof context.node.config.maskSourceHeight === 'number'
      ? context.node.config.maskSourceHeight
      : undefined,
  });
}

function commitInpaintMaskSnapshot(nodeId: string): void {
  const snapshot = getAIImageInpaintMaskExportController(nodeId)?.commitSnapshot?.() ?? null;
  if (!snapshot) {
    return;
  }

  contextNodeConfigByNodeId.get(nodeId)?.(snapshot);
}

const contextNodeConfigByNodeId = new Map<string, (snapshot: AIImageInpaintMaskSnapshot) => void>();

function commitInpaintMaskSnapshotForContext(context: ExecutionRuntimeNodeAdapterContext): void {
  contextNodeConfigByNodeId.set(context.node.id.value, (snapshot) => {
    context.node.config.hasMaskMarks = snapshot.hasMarks;
    context.node.config.maskStrokes = snapshot.strokes;
    context.node.config.maskSourceFileId = snapshot.sourceInfo.fileId;
    context.node.config.maskSourceWidth = snapshot.sourceInfo.width;
    context.node.config.maskSourceHeight = snapshot.sourceInfo.height;
  });
  try {
    commitInpaintMaskSnapshot(context.node.id.value);
  } finally {
    contextNodeConfigByNodeId.delete(context.node.id.value);
  }
}

function requireEnsureBackendFileId(
  context: ExecutionRuntimeNodeAdapterContext,
): (node: FileNodeData, options?: { signal?: AbortSignal; workflowId?: string | null }) => Promise<string> {
  const ensureBackendFileId = context.services?.ensureBackendFileId;
  if (!ensureBackendFileId) {
    throw createInpaintAdapterError(
      'FILE_REGISTER_FAILED',
      '执行适配器缺少后端文件注册服务。',
    );
  }

  return ensureBackendFileId;
}

function requireRegisterInpaintMaskFile(
  context: ExecutionRuntimeNodeAdapterContext,
): (nodeId: string, blob: Blob | File, options?: { signal?: AbortSignal }) => Promise<string> {
  const registerInpaintMaskFile = context.services?.registerInpaintMaskFile;
  if (!registerInpaintMaskFile) {
    throw createInpaintAdapterError(
      'MASK_FILE_REGISTER_FAILED',
      '执行适配器缺少局部重绘标记图注册服务。',
    );
  }

  return registerInpaintMaskFile;
}

export const aiImageInpaintExecutionRuntimeAdapter: ExecutionRuntimeGroupedNodeAdapter = {
  nodeType: 'aiImageInpaint',
  executionKind: 'grouped',
  taskType: 'image-inpaint',
  outputCommitMode: groupedOutputAdapter.outputCommitMode,
  validateExecution: (context) => {
    commitInpaintMaskSnapshotForContext(context);
    const prompt = normalizePrompt(context.node.config.prompt);
    if (prompt.length === 0) {
      return {
        valid: false,
        reason: '图片局部重绘的提示词不能为空。',
        code: 'INVALID_AI_IMAGE_INPAINT_PROMPT',
      };
    }

    const executableGroups = getExecutableGroups(context);
    const imageInputCount = getImageInputCount(context);
    if (imageInputCount === 0) {
      return {
        valid: false,
        reason: '图片局部重绘缺少可用原图，请拖入 1 张原图后执行。',
        code: 'INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID',
      };
    }

    if (executableGroups.length !== 1) {
      return {
        valid: false,
        reason: '图片局部重绘需要且只需要 1 张原图输入。',
        code: 'INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID',
      };
    }

    if (!hasExecutableMaskMarks(context)) {
      return {
        valid: false,
        reason: '请先用画笔标记需要局部重绘的区域。',
        code: 'INVALID_AI_IMAGE_INPAINT_MASK_STROKES',
      };
    }

    if (!getAIImageInpaintMaskExporter(context.node.id.value)) {
      return {
        valid: false,
        reason: '局部重绘标记图尚未准备好。',
        code: 'AI_IMAGE_INPAINT_MASK_EXPORT_FAILED',
      };
    }

    return { valid: true };
  },
  createExecutionPayload: async (context) => {
    commitInpaintMaskSnapshotForContext(context);
    const prompt = normalizePrompt(context.node.config.prompt);
    if (prompt.length === 0) {
      throw createInpaintAdapterError(
        'INVALID_AI_IMAGE_INPAINT_PROMPT',
        '图片局部重绘的提示词不能为空。',
      );
    }

    const executableGroups = getExecutableGroups(context);
    const imageInputCount = getImageInputCount(context);
    if (imageInputCount === 0) {
      throw createInpaintAdapterError(
        'INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID',
        '图片局部重绘缺少可用原图，请拖入 1 张原图后执行。',
      );
    }

    if (executableGroups.length !== 1) {
      throw createInpaintAdapterError(
        'INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID',
        '图片局部重绘需要且只需要 1 张原图输入。',
        { imageInputCount },
      );
    }

    if (!hasExecutableMaskMarks(context)) {
      throw createInpaintAdapterError(
        'INVALID_AI_IMAGE_INPAINT_MASK_STROKES',
        '请先用画笔标记需要局部重绘的区域。',
      );
    }

    const maskMode = normalizeAIImageInpaintMaskMode(
      context.node.config.maskMode ?? AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
    );
    const exporter = getAIImageInpaintMaskExporter(context.node.id.value);
    if (!exporter) {
      throw createInpaintAdapterError(
        'AI_IMAGE_INPAINT_MASK_EXPORT_FAILED',
        '局部重绘标记图尚未准备好。',
      );
    }

    const ensureBackendFileId = requireEnsureBackendFileId(context);
    const registerInpaintMaskFile = requireRegisterInpaintMaskFile(context);
    const group = executableGroups[0];
    let sourceFileId: string;
    try {
      sourceFileId = await ensureBackendFileId(group.sourceNode, {
        signal: context.signal,
        workflowId: context.workflowId ?? context.workflow.id,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw createInpaintAdapterError(
        'FILE_REGISTER_FAILED',
        error instanceof Error ? error.message : '原图文件注册失败。',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }

    let maskBlob: Blob;
    try {
      maskBlob = await exporter({ mode: maskMode });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw createInpaintAdapterError(
        'AI_IMAGE_INPAINT_MASK_EXPORT_FAILED',
        error instanceof Error ? error.message : '局部重绘标记图导出失败。',
        {
          maskMode,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    let maskFileId: string;
    try {
      maskFileId = await registerInpaintMaskFile(
        context.node.id.value,
        maskBlob,
        { signal: context.signal },
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw createInpaintAdapterError(
        'MASK_FILE_REGISTER_FAILED',
        error instanceof Error ? error.message : '标记图文件注册失败。',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const normalizedSourceFileId = sourceFileId.trim();
    const normalizedMaskFileId = maskFileId.trim();
    if (normalizedSourceFileId.length === 0) {
      throw createInpaintAdapterError(
        'INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID',
        '原图文件注册失败。',
      );
    }
    if (normalizedMaskFileId.length === 0) {
      throw createInpaintAdapterError(
        'INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID',
        '标记图文件注册失败。',
      );
    }
    const normalizedImageConfig = buildAIImageInpaintBackendRequestConfig(context.node.config);

    const targets = [{
      kind: 'group',
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      groupId: group.groupId,
      groupOrder: group.groupOrder,
      groupLabel: group.groupLabel,
      outputHandle: group.outputHandle,
    } satisfies ExecutionRuntimeGroupedNodeExecutionTarget];

    const request = {
      nodeType: 'aiImageInpaint',
      taskType: 'image-inpaint',
      executionMode: 'legacy-grouped-task',
      nodeId: context.node.id.value,
      nodeTitle: context.nodeTitle,
      prompt,
      model: normalizedImageConfig.model,
      maskMode,
      ...(normalizedImageConfig.imageSize ? { imageSize: normalizedImageConfig.imageSize } : {}),
      ...(normalizedImageConfig.aspectRatio ? { aspectRatio: normalizedImageConfig.aspectRatio } : {}),
      groups: [{
        ...buildAIImageInpaintBackendGroupPayload({
          groupId: AI_IMAGE_INPAINT_GROUP_ID,
          sourceFileId: normalizedSourceFileId,
          maskFileId: normalizedMaskFileId,
        }),
      }],
    };

    return {
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      nodeTitle: context.nodeTitle,
      taskType: 'image-inpaint',
      executionKind: 'grouped',
      request,
      targets,
    };
  },
  mapSnapshotToRuntimePatch: (snapshot, context) => buildExecutionRuntimePatchesFromSnapshot(
    context.previousSnapshot,
    snapshot,
    {
      workflowId: context.workflowId ?? snapshot.workflowId ?? null,
      nodeId: context.nodeId,
    },
  ),
  extractExecutionOutputs: (snapshot, context) => groupedOutputAdapter.extractExecutionOutputs(snapshot, context),
};
