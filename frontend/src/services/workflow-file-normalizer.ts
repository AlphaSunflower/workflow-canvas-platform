import type { AINodeData, Connection, FileNodeData, FileSource, Workflow, AnyNodeData, ImageAsset } from '@/types';
import { getFileUrl } from '@/api/services/file-api';
import { ensureBackendFileId } from '@/services/backendFileService';
import { buildRemoteImageAsset, shouldUseRemoteFileResourceFallback } from '@/services/image';
import { isAINodeData, isFileNodeData } from '@/utils';
import { getPersistedWorkflowId } from '@/services/workflow-session';
import { stripStoryboardShotRuntimeStateFromShots } from '@/nodes/ai-storyboard/storyboard-runtime-state';
import { normalizeStoryboardTaskRefIdentity } from '@/nodes/ai-storyboard/storyboard-output-identity';
import type { StoryboardShotData } from '@/types';

export interface WorkflowApiPayload {
  id?: string;
  projectId: string;
  name: string;
  nodes: Record<string, unknown>;
  connections: unknown[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  metadata: Record<string, unknown>;
  timestamp: number;
  version?: number;
}

export interface WorkflowApiSummary {
  workflowId: string;
  projectId: string;
  ownerUserId: string;
  name: string;
  groupId: string | null;
  containerKey: string;
  isAutoNamed: boolean;
  nodeCount: number;
  connectionCount: number;
  timestamp: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowApiGroupSummary {
  groupId: string;
  ownerUserId: string;
  name: string;
  workflowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowApiManagedListResponse {
  items: WorkflowApiSummary[];
  groups: WorkflowApiGroupSummary[];
  total: number;
}

export interface WorkflowApiDetail {
  workflowId: string;
  ownerUserId: string;
  groupId: string | null;
  containerKey: string;
  isAutoNamed: boolean;
  workflow: WorkflowApiPayload;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBlankWorkflowApiPayload {
  id?: string;
  projectId?: string;
  name?: string;
  groupId?: string | null;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  metadata?: Record<string, unknown>;
  timestamp?: number;
  version?: number;
}

type FileNodeBinding = {
  nodeId: string;
  backendFileId: string;
};

type NormalizedWorkflowResult = {
  workflow: Workflow;
  payload: WorkflowApiPayload;
  bindings: FileNodeBinding[];
};

function sanitizeRemoteUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.startsWith('runtime:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('data:')
    || normalized.startsWith('file:')
  ) {
    return undefined;
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isPathLikeOriginalPath(value: string): boolean {
  return (
    value.startsWith('file:') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.startsWith('~/') ||
    value.startsWith('~\\') ||
    /^[A-Za-z]:/.test(value) ||
    value.includes('/') ||
    value.includes('\\')
  );
}

function getDisplayNameFromOriginalPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith('file:')) {
    try {
      const fileUrl = new URL(value);
      const pathname = decodeURIComponent(fileUrl.pathname);
      const urlBasename = pathname.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
      return getNonEmptyString(urlBasename) ?? value;
    } catch {
      return value;
    }
  }

  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return getNonEmptyString(normalized.split('/').pop()) ?? value;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeImportedLocalSource(value: unknown): NonNullable<FileSource['localSource']> {
  if (!isRecord(value)) {
    return { status: 'unknown' };
  }

  const rawStatus = value.status;
  const status = (
    rawStatus === 'runtime-only' ||
    rawStatus === 'available' ||
    rawStatus === 'linked' ||
    rawStatus === 'permission-required' ||
    rawStatus === 'missing' ||
    rawStatus === 'unknown'
  )
    ? rawStatus
    : 'unknown';
  const referenceId = getNonEmptyString(value.referenceId);
  const kind = (
    value.kind === 'runtime' ||
    value.kind === 'file-system-access' ||
    value.kind === 'unknown'
  )
    ? value.kind
    : undefined;
  const permissionState = (
    value.permissionState === 'granted' ||
    value.permissionState === 'prompt' ||
    value.permissionState === 'denied'
  )
    ? value.permissionState
    : undefined;
  const lastResolvedAt = getFiniteNumber(value.lastResolvedAt);

  return {
    status: status === 'available' ? 'linked' : status,
    ...(referenceId ? { referenceId } : {}),
    ...(kind ? { kind } : {}),
    ...(permissionState ? { permissionState } : {}),
    ...(lastResolvedAt !== undefined ? { lastResolvedAt } : {}),
  };
}

function normalizeImportedFileSource(input: {
  source: Record<string, unknown>;
  fileName: string;
  fallbackTimestamp: number;
}): FileSource {
  const originalPath = getNonEmptyString(input.source.originalPath);
  const legacyOriginalPath = originalPath && isPathLikeOriginalPath(originalPath)
    ? originalPath
    : undefined;
  const sourceDisplayName = getNonEmptyString(input.source.sourceDisplayName)
    ?? getDisplayNameFromOriginalPath(originalPath)
    ?? input.fileName;
  const importedAt = getFiniteNumber(input.source.importedAt) ?? input.fallbackTimestamp;
  const uploadedBy = getNonEmptyString(input.source.uploadedBy);

  return {
    type: 'imported',
    importMethod: 'local',
    sourceDisplayName,
    localSource: normalizeImportedLocalSource(input.source.localSource),
    ...(legacyOriginalPath ? { originalPath: legacyOriginalPath } : {}),
    importedAt,
    ...(uploadedBy ? { uploadedBy } : {}),
  };
}

function isValidImportedFileSource(source: Record<string, unknown>): boolean {
  return (
    source.type === 'imported' &&
    (source.importMethod === undefined || source.importMethod === 'local') &&
    (source.sourceDisplayName === undefined || typeof source.sourceDisplayName === 'string') &&
    (
      source.localSource === undefined ||
      (
        isRecord(source.localSource) &&
        (
          source.localSource.status === 'runtime-only' ||
          source.localSource.status === 'available' ||
          source.localSource.status === 'linked' ||
          source.localSource.status === 'permission-required' ||
          source.localSource.status === 'missing' ||
          source.localSource.status === 'unknown'
        ) &&
        (source.localSource.referenceId === undefined || typeof source.localSource.referenceId === 'string') &&
        (
          source.localSource.kind === undefined ||
          source.localSource.kind === 'runtime' ||
          source.localSource.kind === 'file-system-access' ||
          source.localSource.kind === 'unknown'
        ) &&
        (
          source.localSource.permissionState === undefined ||
          source.localSource.permissionState === 'granted' ||
          source.localSource.permissionState === 'prompt' ||
          source.localSource.permissionState === 'denied'
        ) &&
        (source.localSource.lastResolvedAt === undefined || typeof source.localSource.lastResolvedAt === 'number')
      )
    ) &&
    (source.originalPath === undefined || typeof source.originalPath === 'string') &&
    (source.importedAt === undefined || typeof source.importedAt === 'number') &&
    (source.uploadedBy === undefined || typeof source.uploadedBy === 'string')
  );
}

function isValidNodeOutputFileSource(source: Record<string, unknown>): boolean {
  return (
    source.type === 'node-output' &&
    typeof source.producerNodeId === 'string' &&
    typeof source.producerNodeDisplayId === 'string' &&
    typeof source.producerNodeType === 'string' &&
    typeof source.taskId === 'string' &&
    typeof source.taskNo === 'string' &&
    typeof source.taskCreatedAt === 'number' &&
    (source.taskStartedAt === undefined || typeof source.taskStartedAt === 'number') &&
    (source.taskCompletedAt === undefined || typeof source.taskCompletedAt === 'number')
  );
}

function isValidFileSource(source: unknown): source is FileSource {
  return isRecord(source) && (
    isValidImportedFileSource(source) ||
    isValidNodeOutputFileSource(source)
  );
}

function isImageAsset(value: unknown): value is ImageAsset {
  if (!isRecord(value) || !isRecord(value.variants)) {
    return false;
  }

  return value.source === 'remote' || value.source === 'local' || value.source === 'unknown';
}

function stripEphemeralImageAssetVariants(imageAsset: ImageAsset | undefined): ImageAsset | undefined {
  if (!isImageAsset(imageAsset)) {
    return undefined;
  }

  const thumbnailUrl = sanitizeRemoteUrl(imageAsset.variants.thumbnail?.url);
  const originalUrl = sanitizeRemoteUrl(imageAsset.variants.original?.url);

  return {
    ...imageAsset,
    variants: {
      ...(thumbnailUrl ? { thumbnail: { ...imageAsset.variants.thumbnail, url: thumbnailUrl } } : {}),
      ...(originalUrl ? { original: { ...imageAsset.variants.original, url: originalUrl } } : {}),
    },
  };
}

function stripImageAssetResourceVariants(imageAsset: ImageAsset | undefined): ImageAsset | undefined {
  if (!isImageAsset(imageAsset)) {
    return undefined;
  }

  return {
    ...imageAsset,
    variants: {},
  };
}

function getPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function parseApiTimestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getNodeTimestamp(node: FileNodeData, fallback: number): number {
  return getFiniteNumber(node.timestamp?.created)
    ?? getFiniteNumber(node.timestamp?.updated)
    ?? fallback;
}

function findOutputSourceNode(
  nodeId: string,
  nodes: Record<string, AnyNodeData>,
  connections: Workflow['connections'],
): AINodeData | null {
  const outputLink = (connections as Connection[]).find((connection) => (
    connection.type === 'output-link' &&
    connection.targetId === nodeId
  ));
  if (!outputLink) {
    return null;
  }

  const sourceNode = nodes[outputLink.sourceId];
  return sourceNode && isAINodeData(sourceNode) ? sourceNode : null;
}

function findOutputSourceTask(
  sourceNode: AINodeData | null,
  source: Record<string, unknown> | null,
): AINodeData['tasks'][number] | null {
  if (!sourceNode || sourceNode.tasks.length === 0) {
    return null;
  }

  const sourceTaskId = getNonEmptyString(source?.taskId);
  if (sourceTaskId) {
    const matchedByTaskId = sourceNode.tasks.find((task) => task.taskId === sourceTaskId);
    if (matchedByTaskId) {
      return matchedByTaskId;
    }
  }

  const sourceTaskNo = getNonEmptyString(source?.taskNo);
  if (sourceTaskNo) {
    const matchedByTaskNo = sourceNode.tasks.find((task) => task.taskNo === sourceTaskNo);
    if (matchedByTaskNo) {
      return matchedByTaskNo;
    }
  }

  return sourceNode.tasks
    .slice()
    .sort((left, right) => (
      (right.completedAt ?? right.startedAt ?? right.createdAt) -
      (left.completedAt ?? left.startedAt ?? left.createdAt)
    ))[0] ?? null;
}

function normalizeHydratedFileSource(input: {
  nodeId: string;
  node: FileNodeData;
  nodes: Record<string, AnyNodeData>;
  connections: Workflow['connections'];
  fallbackTimestamp: number;
}): FileSource {
  if (isValidFileSource(input.node.source)) {
    if (input.node.source.type === 'imported') {
      return normalizeImportedFileSource({
        source: input.node.source as unknown as Record<string, unknown>,
        fileName: input.node.fileName,
        fallbackTimestamp: input.fallbackTimestamp,
      });
    }

    return input.node.source;
  }

  const source = isRecord(input.node.source) ? input.node.source : null;
  const sourceNode = findOutputSourceNode(input.nodeId, input.nodes, input.connections);
  const sourceTask = findOutputSourceTask(sourceNode, source);
  const fallbackTimestamp = getNodeTimestamp(input.node, input.fallbackTimestamp);
  const sourceType = source?.['type'];
  const sourceTaskCreatedAt = getFiniteNumber(source?.['taskCreatedAt']);
  const sourceTaskStartedAt = getFiniteNumber(source?.['taskStartedAt']);
  const sourceTaskCompletedAt = getFiniteNumber(source?.['taskCompletedAt']);
  const sourceProducerNodeId = getNonEmptyString(source?.['producerNodeId']);
  const sourceProducerNodeDisplayId = getNonEmptyString(source?.['producerNodeDisplayId']);
  const sourceProducerNodeType = getNonEmptyString(source?.['producerNodeType']);
  const sourceTaskId = getNonEmptyString(source?.['taskId']);
  const sourceTaskNo = getNonEmptyString(source?.['taskNo']);

  if (sourceType === 'node-output' || sourceNode) {
    const taskCreatedAt = sourceTaskCreatedAt
      ?? sourceTask?.createdAt
      ?? fallbackTimestamp;
    const taskStartedAt = sourceTaskStartedAt
      ?? sourceTask?.startedAt;
    const taskCompletedAt = sourceTaskCompletedAt
      ?? sourceTask?.completedAt
      ?? fallbackTimestamp;

    return {
      type: 'node-output',
      producerNodeId: sourceProducerNodeId ?? sourceNode?.id.value ?? 'unknown',
      producerNodeDisplayId: sourceProducerNodeDisplayId ?? sourceNode?.id.display ?? 'unknown',
      producerNodeType: sourceProducerNodeType ?? sourceNode?.type ?? 'unknown',
      taskId: sourceTaskId ?? sourceTask?.taskId ?? `legacy-${input.node.fileId}`,
      taskNo: sourceTaskNo ?? sourceTask?.taskNo ?? `TASK-${input.node.fileId}`,
      taskCreatedAt,
      ...(taskStartedAt !== undefined ? { taskStartedAt } : {}),
      ...(taskCompletedAt !== undefined ? { taskCompletedAt } : {}),
    };
  }

  return {
    ...normalizeImportedFileSource({
      source: source ?? {},
      fileName: input.node.fileName,
      fallbackTimestamp,
    }),
  };
}

function sanitizeHydratedFileNode(node: FileNodeData): FileNodeData {
  const nextNode: FileNodeData & Record<string, unknown> = {
    ...node,
    thumbnailUrl: sanitizeRemoteUrl(node.thumbnailUrl),
    previewUrl: node.type === 'image'
      ? undefined
      : sanitizeRemoteUrl(node.previewUrl),
  };

  delete nextNode.file;
  delete nextNode.localFile;
  delete nextNode.objectUrl;
  delete nextNode.localState;

  return nextNode;
}

function buildRemoteImageAssetForNode(
  backendFileId: string,
  node: FileNodeData,
): {
  imageAsset: ImageAsset;
  thumbnailUrl: string;
} {
  const thumbnailUrl = sanitizeRemoteUrl(node.thumbnailUrl) ?? getFileUrl(backendFileId, 'thumbnail');
  const existingImageAsset = stripEphemeralImageAssetVariants(node.imageAsset);
  const originalUrl = sanitizeRemoteUrl(existingImageAsset?.variants.original?.url) ?? getFileUrl(backendFileId, 'download');
  const existingThumbnail = existingImageAsset?.variants.thumbnail;

  return buildRemoteImageAsset(backendFileId, node.metadata, {
    thumbnailUrl,
    originalUrl,
    thumbnailSize: {
      width: getPositiveNumber(existingThumbnail?.width),
      height: getPositiveNumber(existingThumbnail?.height),
    },
    version: existingImageAsset?.version,
  });
}

function toWorkflowApiPayload(workflow: Workflow): WorkflowApiPayload {
  const persistedWorkflowId = getPersistedWorkflowId(workflow);

  return {
    ...(persistedWorkflowId ? { id: persistedWorkflowId } : {}),
    projectId: workflow.projectId,
    name: workflow.name,
    nodes: workflow.nodes as Record<string, unknown>,
    connections: workflow.connections as unknown[],
    viewport: workflow.viewport,
    metadata: workflow.metadata as unknown as Record<string, unknown>,
    timestamp: workflow.timestamp.updated,
    ...(workflow.version !== undefined ? { version: workflow.version } : {}),
  };
}

function createHydratedFileNode(
  node: FileNodeData,
  backendFileId: string,
): FileNodeData {
  const useRemoteFallback = shouldUseRemoteFileResourceFallback(node);
  const remoteImage = useRemoteFallback && node.type === 'image'
    ? buildRemoteImageAssetForNode(backendFileId, node)
    : null;
  const thumbnailUrl = useRemoteFallback
    ? remoteImage?.thumbnailUrl ?? sanitizeRemoteUrl(node.thumbnailUrl) ?? getFileUrl(backendFileId, 'thumbnail')
    : sanitizeRemoteUrl(node.thumbnailUrl);
  const nextNode: FileNodeData = {
    ...node,
    fileId: backendFileId,
    backendFileId,
    ...(node.type === 'image'
      ? {
          imageAsset: remoteImage?.imageAsset ?? stripImageAssetResourceVariants(node.imageAsset),
          thumbnailUrl: useRemoteFallback ? thumbnailUrl : undefined,
          previewUrl: undefined,
        }
      : {
          previewUrl: useRemoteFallback
            ? sanitizeRemoteUrl(node.previewUrl)
            : undefined,
          thumbnailUrl: useRemoteFallback
            ? thumbnailUrl
            : undefined,
        }),
  };

  return sanitizeHydratedFileNode(nextNode);
}

function normalizePersistedLocalSource(node: FileNodeData): FileNodeData {
  if (node.source.type !== 'imported') {
    return node;
  }

  const normalizedSource = normalizeImportedFileSource({
    source: node.source as unknown as Record<string, unknown>,
    fileName: node.fileName,
    fallbackTimestamp: getNodeTimestamp(node, Date.now()),
  });

  return {
    ...node,
    source: normalizedSource,
  };
}

function stripPersistedNode(node: FileNodeData, backendFileId: string): Record<string, unknown> {
  const nextNode: Record<string, unknown> = {
    ...node,
    fileId: backendFileId,
    backendFileId,
  };

  delete nextNode.imageAsset;
  delete nextNode.previewUrl;
  delete nextNode.thumbnailUrl;
  delete nextNode.file;
  delete nextNode.localFile;
  delete nextNode.objectUrl;
  delete nextNode.localState;

  return nextNode;
}

function replaceNodeReferenceFileIds(
  node: AnyNodeData,
  bindings: Map<string, string>,
): AnyNodeData {
  if (!isAINodeData(node)) {
    return node;
  }

  return {
    ...node,
    references: node.references.map((reference) => ({
      ...reference,
      fileId: bindings.get(reference.nodeId) ?? reference.fileId,
    })),
  };
}

function stripPersistedAINode(node: AINodeData): Record<string, unknown> {
  if (node.type !== 'aiStoryboard') {
    return node as unknown as Record<string, unknown>;
  }

  const rawShots = Array.isArray(node.config.shots)
    ? node.config.shots as StoryboardShotData[]
    : [];

  return {
    ...node,
    tasks: (Array.isArray(node.tasks) ? node.tasks : []).map((taskRef) => normalizeStoryboardTaskRefIdentity(taskRef)),
    config: {
      ...node.config,
      shots: stripStoryboardShotRuntimeStateFromShots(rawShots),
    },
  } as unknown as Record<string, unknown>;
}

function normalizeHydratedStoryboardNode(node: AnyNodeData): AnyNodeData {
  if (!isAINodeData(node) || node.type !== 'aiStoryboard') {
    return node;
  }

  return {
    ...node,
    tasks: (Array.isArray(node.tasks) ? node.tasks : []).map((taskRef) => normalizeStoryboardTaskRefIdentity(taskRef)),
  };
}

function normalizeWorkflowRelatedTasks(metadata: Workflow['metadata']): Workflow['metadata'] {
  return {
    ...metadata,
    relatedTasks: (metadata.relatedTasks ?? []).map((taskRef) => (
      taskRef.nodeType === 'aiStoryboard'
        ? normalizeStoryboardTaskRefIdentity(taskRef)
        : taskRef
    )),
  };
}

function restoreWorkflowTimestamp(workflowPayload: WorkflowApiPayload): Workflow['timestamp'] {
  return {
    created: workflowPayload.timestamp,
    updated: workflowPayload.timestamp,
  };
}

function restoreNode(node: unknown): AnyNodeData {
  return node as AnyNodeData;
}

export async function normalizeWorkflowForPersistence(
  workflow: Workflow,
): Promise<NormalizedWorkflowResult> {
  const bindingEntries = await Promise.all(
    Object.values(workflow.nodes)
      .filter((node): node is FileNodeData => isFileNodeData(node))
      .map(async (node) => ({
        nodeId: node.id.value,
        backendFileId: node.backendFileId ?? await ensureBackendFileId(node),
      })),
  );

  const bindings = new Map(bindingEntries.map((item) => [item.nodeId, item.backendFileId]));
  const normalizedNodes = Object.fromEntries(
    Object.entries(workflow.nodes).map(([nodeId, node]) => {
      if (isFileNodeData(node)) {
        const backendFileId = bindings.get(nodeId) ?? node.fileId;
        return [nodeId, createHydratedFileNode(normalizePersistedLocalSource(node), backendFileId)];
      }

      return [nodeId, replaceNodeReferenceFileIds(node, bindings)];
    }),
  ) as Record<string, AnyNodeData>;

  const persistedNodes = Object.fromEntries(
    Object.entries(normalizedNodes).map(([nodeId, node]) => {
      if (isFileNodeData(node)) {
        const backendFileId = bindings.get(nodeId) ?? node.fileId;
        return [nodeId, stripPersistedNode(node, backendFileId)];
      }

      return [nodeId, stripPersistedAINode(node)];
    }),
  );

  const normalizedWorkflow: Workflow = {
    ...workflow,
    nodes: normalizedNodes,
    metadata: normalizeWorkflowRelatedTasks(workflow.metadata),
    timestamp: {
      ...workflow.timestamp,
      updated: Date.now(),
    },
  };

  return {
    workflow: normalizedWorkflow,
    payload: {
      ...(getPersistedWorkflowId(normalizedWorkflow) ? { id: getPersistedWorkflowId(normalizedWorkflow) as string } : {}),
      projectId: normalizedWorkflow.projectId,
      name: normalizedWorkflow.name,
      nodes: persistedNodes,
      connections: normalizedWorkflow.connections as unknown[],
      viewport: normalizedWorkflow.viewport,
      metadata: normalizedWorkflow.metadata as unknown as Record<string, unknown>,
      timestamp: normalizedWorkflow.timestamp.updated,
      ...(normalizedWorkflow.version !== undefined ? { version: normalizedWorkflow.version } : {}),
    },
    bindings: bindingEntries,
  };
}

export function hydrateWorkflowFromApiDetail(detail: WorkflowApiDetail): Workflow {
  const payload = detail.workflow;
  const rawRestoredNodes = Object.fromEntries(
    Object.entries(payload.nodes).map(([nodeId, node]) => [nodeId, normalizeHydratedStoryboardNode(restoreNode(node))]),
  ) as Record<string, AnyNodeData>;
  const restoredNodes = Object.fromEntries(
    Object.entries(rawRestoredNodes).map(([nodeId, restored]) => {

      if (!isFileNodeData(restored)) {
        return [nodeId, restored];
      }

      const backendFileId = restored.backendFileId ?? restored.fileId;
      const source = normalizeHydratedFileSource({
        nodeId,
        node: restored,
        nodes: rawRestoredNodes,
        connections: payload.connections as Workflow['connections'],
        fallbackTimestamp: payload.timestamp,
      });
      const sourceAwareNode = {
        ...restored,
        source,
      };
      const useRemoteFallback = shouldUseRemoteFileResourceFallback(sourceAwareNode);
      const remoteImage = useRemoteFallback && restored.type === 'image'
        ? buildRemoteImageAssetForNode(backendFileId, restored)
        : null;
      const thumbnailUrl = useRemoteFallback
        ? remoteImage?.thumbnailUrl ?? sanitizeRemoteUrl(restored.thumbnailUrl) ?? getFileUrl(backendFileId, 'thumbnail')
        : sanitizeRemoteUrl(restored.thumbnailUrl);
      const hydratedNode = sanitizeHydratedFileNode({
        ...restored,
        fileId: backendFileId,
        backendFileId,
        source,
        ...(restored.type === 'image'
          ? {
              imageAsset: remoteImage?.imageAsset ?? stripImageAssetResourceVariants(restored.imageAsset),
              thumbnailUrl: useRemoteFallback ? thumbnailUrl : undefined,
              previewUrl: undefined,
            }
          : {
              previewUrl: useRemoteFallback
                ? sanitizeRemoteUrl(restored.previewUrl)
                : undefined,
              thumbnailUrl: useRemoteFallback
                ? thumbnailUrl
                : undefined,
            }),
      });

      return [nodeId, hydratedNode];
    }),
  ) as Record<string, AnyNodeData>;

  return {
    id: detail.workflowId,
    persistedWorkflowId: detail.workflowId,
    projectId: payload.projectId,
    name: payload.name,
    nodes: restoredNodes,
    connections: payload.connections as Workflow['connections'],
    viewport: payload.viewport,
    metadata: normalizeWorkflowRelatedTasks(payload.metadata as unknown as Workflow['metadata']),
    timestamp: restoreWorkflowTimestamp(payload),
    ...(payload.version !== undefined ? { version: payload.version } : {}),
    ownerUserId: detail.ownerUserId,
    groupId: detail.groupId,
    workflowGroupId: detail.groupId,
    containerKey: detail.containerKey,
    isAutoNamed: detail.isAutoNamed,
    persistenceState: 'persisted',
    hasMaterializedCanvas: true,
    createdAt: parseApiTimestamp(detail.createdAt),
    updatedAt: parseApiTimestamp(detail.updatedAt),
  };
}

export function createWorkflowApiPayload(workflow: Workflow): WorkflowApiPayload {
  return toWorkflowApiPayload(workflow);
}

export function createBlankWorkflowPayload(
  payload: CreateBlankWorkflowApiPayload,
): CreateBlankWorkflowApiPayload {
  return {
    ...(payload.id ? { id: payload.id } : {}),
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.groupId !== undefined ? { groupId: payload.groupId } : {}),
    ...(payload.viewport ? { viewport: payload.viewport } : {}),
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
    ...(payload.timestamp !== undefined ? { timestamp: payload.timestamp } : {}),
    ...(payload.version !== undefined ? { version: payload.version } : {}),
  };
}
