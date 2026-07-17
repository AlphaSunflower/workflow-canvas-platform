import type {
  AppError,
  LocalWorkflowArchive,
  LocalWorkflowEmbeddedAsset,
  Result,
  Workflow,
} from '@/types';
import {
  LOCAL_WORKFLOW_ARCHIVE_FORMAT,
  LOCAL_WORKFLOW_ARCHIVE_VERSION,
} from '@/types/local-workflow-archive.types';
import {
  createError,
  createModuleLogger,
  deepClone,
  normalizeWorkflowData,
  safeParse,
  validateWorkflow,
} from '@/utils';
import {
  clearLocalArchiveFileRegistry,
  collectEmbeddedLocalArchiveAssets,
  restoreEmbeddedLocalArchiveAssets,
} from './local-workflow-assets';
import { clearAllImageResources } from './image';

const log = createModuleLogger('local-workflow-archive');

function createArchiveError(
  code: 'VALIDATION_ERROR' | 'STORAGE_ERROR' | 'WORKFLOW_ERROR',
  message: string,
  operation: string,
  context?: Record<string, unknown>
): AppError {
  return createError(code, message, {
    module: 'local-workflow-archive',
    operation,
    timestamp: Date.now(),
    context,
  });
}

function isEmbeddedAssetArray(candidate: unknown): candidate is LocalWorkflowEmbeddedAsset[] {
  if (!Array.isArray(candidate)) {
    return false;
  }

  return candidate.every((asset) => (
    typeof asset === 'object' &&
    asset !== null &&
    typeof asset.id === 'string' &&
    typeof asset.nodeId === 'string' &&
    typeof asset.fileId === 'string' &&
    typeof asset.kind === 'string' &&
    typeof asset.fileName === 'string' &&
    typeof asset.mimeType === 'string' &&
    typeof asset.size === 'number' &&
    Number.isFinite(asset.size) &&
    typeof asset.encoding === 'string' &&
    typeof asset.data === 'string' &&
    typeof asset.createdAt === 'number' &&
    Number.isFinite(asset.createdAt) &&
    typeof asset.updatedAt === 'number' &&
    Number.isFinite(asset.updatedAt)
  ));
}

export function isLocalWorkflowArchive(candidate: unknown): candidate is LocalWorkflowArchive {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const archive = candidate as Partial<LocalWorkflowArchive>;
  return (
    archive.format === LOCAL_WORKFLOW_ARCHIVE_FORMAT &&
    archive.version === LOCAL_WORKFLOW_ARCHIVE_VERSION &&
    typeof archive.savedAt === 'number' &&
    Number.isFinite(archive.savedAt) &&
    typeof archive.workflow === 'object' &&
    archive.workflow !== null &&
    isEmbeddedAssetArray(archive.embeddedAssets)
  );
}

export function createLocalWorkflowArchive(
  workflow: Workflow,
  options: {
    savedAt?: number;
    embeddedAssets?: LocalWorkflowEmbeddedAsset[];
  } = {}
): LocalWorkflowArchive {
  const savedAt = options.savedAt ?? Date.now();
  const normalizedWorkflow = normalizeWorkflowData(deepClone(workflow) as Workflow);
  const embeddedAssets = deepClone(options.embeddedAssets ?? []) as LocalWorkflowEmbeddedAsset[];

  return {
    format: LOCAL_WORKFLOW_ARCHIVE_FORMAT,
    version: LOCAL_WORKFLOW_ARCHIVE_VERSION,
    savedAt,
    workflow: normalizedWorkflow,
    embeddedAssets,
  };
}

export function validateLocalWorkflowArchive(candidate: unknown): Result<LocalWorkflowArchive> {
  if (!isLocalWorkflowArchive(candidate)) {
    return {
      success: false,
      error: createArchiveError(
        'VALIDATION_ERROR',
        'Invalid local workflow archive format.',
        'validateLocalWorkflowArchive'
      ),
    };
  }

  const workflowValidation = validateWorkflow(candidate.workflow);
  if (!workflowValidation.valid) {
    return {
      success: false,
      error: createArchiveError(
        'WORKFLOW_ERROR',
        workflowValidation.message,
        'validateLocalWorkflowArchive'
      ),
    };
  }

  return {
    success: true,
    data: candidate,
  };
}

export function serializeLocalWorkflowArchive(archive: LocalWorkflowArchive): Result<string> {
  const validation = validateLocalWorkflowArchive(archive);
  if (!validation.success) {
    return validation;
  }

  try {
    return {
      success: true,
      data: JSON.stringify(validation.data, null, 2),
    };
  } catch (error) {
    log.error('serializeLocalWorkflowArchive', 'Failed to stringify archive', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createArchiveError(
        'STORAGE_ERROR',
        'Failed to serialize local workflow archive.',
        'serializeLocalWorkflowArchive'
      ),
    };
  }
}

export function parseLocalWorkflowArchive(content: string): Result<LocalWorkflowArchive> {
  const parseFallback = Symbol('local-workflow-archive-parse-fallback');
  const parsed = safeParse<unknown | symbol>(content, parseFallback);
  if (parsed === parseFallback) {
    return {
      success: false,
      error: createArchiveError(
        'VALIDATION_ERROR',
        'Archive content is not valid JSON.',
        'parseLocalWorkflowArchive'
      ),
    };
  }

  return validateLocalWorkflowArchive(parsed);
}

export async function extractWorkflowFromLocalArchive(archive: LocalWorkflowArchive): Promise<Result<Workflow>> {
  const validation = validateLocalWorkflowArchive(archive);
  if (!validation.success) {
    return validation;
  }

  clearAllImageResources({
    workflowId: validation.data.workflow.id,
  });
  clearLocalArchiveFileRegistry({
    workflowId: validation.data.workflow.id,
  });
  const restoredWorkflow = await restoreEmbeddedLocalArchiveAssets(validation.data);
  if (!restoredWorkflow.success) {
    return restoredWorkflow;
  }

  return {
    success: true,
    data: normalizeWorkflowData(deepClone(restoredWorkflow.data) as Workflow),
  };
}

export async function createEmbeddedLocalWorkflowArchive(
  workflow: Workflow,
  options: {
    savedAt?: number;
    embeddedAssets?: LocalWorkflowEmbeddedAsset[];
  } = {}
): Promise<Result<LocalWorkflowArchive>> {
  const embeddedAssetsResult = options.embeddedAssets
    ? { success: true as const, data: options.embeddedAssets }
    : await collectEmbeddedLocalArchiveAssets(workflow);

  if (!embeddedAssetsResult.success) {
    return embeddedAssetsResult;
  }

  return {
    success: true,
    data: createLocalWorkflowArchive(workflow, {
      savedAt: options.savedAt,
      embeddedAssets: embeddedAssetsResult.data,
    }),
  };
}

export const localWorkflowArchiveService = {
  format: LOCAL_WORKFLOW_ARCHIVE_FORMAT,
  version: LOCAL_WORKFLOW_ARCHIVE_VERSION,
  create: createLocalWorkflowArchive,
  createEmbedded: createEmbeddedLocalWorkflowArchive,
  validate: validateLocalWorkflowArchive,
  serialize: serializeLocalWorkflowArchive,
  parse: parseLocalWorkflowArchive,
  extractWorkflow: extractWorkflowFromLocalArchive,
  isArchive: isLocalWorkflowArchive,
};
