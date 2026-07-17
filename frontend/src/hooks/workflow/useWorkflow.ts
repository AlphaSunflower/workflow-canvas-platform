import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Workflow,
  AnyNodeData,
  Connection,
  Viewport,
  WorkflowMetadata,
  AutoSaveConfig,
  UUID,
  FileNodeData,
} from '@/types';
import {
  createModuleLogger,
  createNodeIdAllocatorFromWorkflowMetadata,
  deepEqual,
  deepClone,
  normalizeWorkflowNodeIdMetadata,
  normalizeWorkflowData,
  validateWorkflow,
} from '@/utils';
import { AUTO_SAVE_DEFAULTS, CANVAS_DEFAULTS } from '@/constants';
import { backendFileService } from '@/services/backendFileService';
import { localFileSourceStore } from '@/services/local-file-source-store';
import { shouldUseRemoteFileResourceFallback } from '@/services/image';
import {
  createDraftWorkflowIdentity,
  getPersistedWorkflowId,
  hasMaterializedCanvas,
} from '@/services/workflow-session';
import type {
  WorkflowHydrationState,
  WorkflowRuntimeSnapshotMeta,
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';

const log = createModuleLogger('useWorkflow');
const DEFAULT_WORKFLOW_NAME = '\u672a\u547d\u540d\u5de5\u4f5c\u6d41';

export type {
  WorkflowHydrationReason,
  WorkflowHydrationState,
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';

export interface UseWorkflowOptions {
  initialWorkflow?: Workflow | null;
  onLoad?: (workflow: Workflow) => void;
  autoSaveConfig?: Partial<AutoSaveConfig>;
}

export interface UseWorkflowReturn {
  workflow: Workflow | null;
  hydrationVersion: number;
  hydrationState: WorkflowHydrationState;
  isLoaded: boolean;
  isDirty: boolean;
  lastSavedAt: number | null;
  autoSaveConfig: AutoSaveConfig;
  nodes: AnyNodeData[];
  connections: Connection[];
  viewport: Viewport | null;
  metadata: WorkflowMetadata | null;
  nodeCount: number;
  connectionCount: number;
  persistenceState: Workflow['persistenceState'] | null;
  hasMaterializedCanvas: boolean;
  persistedWorkflowId: UUID | null;
  create: (projectId: UUID, name?: string) => Workflow;
  load: (workflow: Workflow) => void;
  replaceCurrent: (workflow: Workflow) => void;
  commitPersistedWorkflow: (workflow: Workflow) => Workflow | null;
  patchCurrent: (updater: (workflow: Workflow) => Workflow) => Workflow | null;
  syncRuntimeState: (runtime: WorkflowRuntimeSnapshot, options?: WorkflowRuntimeSyncOptions) => Workflow | null;
  reset: () => void;
  markDirty: () => void;
  markClean: (savedAt?: number) => void;
}

export function createEmptyWorkflow(projectId: UUID, name: string): Workflow {
  const now = Date.now();
  const workflow: Workflow = {
    ...createDraftWorkflowIdentity(),
    projectId,
    name,
    nodes: {},
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 0,
      canvasSize: {
        width: CANVAS_DEFAULTS.width,
        height: CANVAS_DEFAULTS.height,
      },
      relatedTasks: [],
      usedNodeIds: [],
      releasedNodeIds: [],
    },
    timestamp: {
      created: now,
      updated: now,
    },
    groupId: null,
    workflowGroupId: null,
    isAutoNamed: false,
  };

  return {
    ...workflow,
    metadata: normalizeWorkflowNodeIdMetadata(workflow.metadata, workflow.nodes),
  };
}

export function buildWorkflowWithRuntime(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
  updatedAt: number = Date.now()
): Workflow {
  const sanitizedRuntimeNodes = sanitizeRuntimeNodes(runtime.nodes);
  const runtimeNodeIds = Object.keys(runtime.nodes);
  const nextMetadata = normalizeWorkflowNodeIdMetadata({
    ...currentWorkflow.metadata,
    ...runtime.metadata,
    nodeCount: runtimeNodeIds.length,
    connectionCount: runtime.connections.length,
  }, sanitizedRuntimeNodes);

  return {
    ...currentWorkflow,
    nodes: sanitizedRuntimeNodes,
    connections: runtime.connections,
    viewport: runtime.viewport,
    metadata: nextMetadata,
    timestamp: {
      ...currentWorkflow.timestamp,
      updated: updatedAt,
    },
  };
}

function getRuntimeSnapshotMeta(
  runtime: WorkflowRuntimeSnapshot,
): WorkflowRuntimeSnapshotMeta | undefined {
  return runtime.snapshotMeta;
}

function isIncrementalOutputSnapshot(snapshotMeta: WorkflowRuntimeSnapshotMeta): boolean {
  return snapshotMeta.scope === 'output-append'
    || snapshotMeta.scope === 'output-reconcile'
    || snapshotMeta.scope === 'canvas-sync';
}

function getSortedNodeIds(nodes: Record<string, AnyNodeData>): string[] {
  return Object.keys(nodes).sort((left, right) => left.localeCompare(right));
}

function getConnectionStructureSignature(connection: Connection): string {
  return [
    connection.type,
    connection.sourceId,
    connection.targetId,
    connection.sourceHandle ?? '',
    connection.targetHandle ?? '',
    String(connection.order ?? -1),
  ].join('::');
}

function getSortedConnectionStructureSignatures(
  connections: readonly Connection[],
): string[] {
  return connections
    .map((connection) => getConnectionStructureSignature(connection))
    .sort((left, right) => left.localeCompare(right));
}

function hasRuntimeSnapshotStructuralDifference(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
): boolean {
  if (!deepEqual(getSortedNodeIds(currentWorkflow.nodes), getSortedNodeIds(runtime.nodes))) {
    return true;
  }

  return !deepEqual(
    getSortedConnectionStructureSignatures(currentWorkflow.connections),
    getSortedConnectionStructureSignatures(runtime.connections),
  );
}

function resolveSnapshotScope(snapshotMeta: WorkflowRuntimeSnapshotMeta): WorkflowRuntimeSnapshotMeta['scope'] {
  return snapshotMeta.scope ?? 'unknown';
}

function resolveSnapshotSource(snapshotMeta: WorkflowRuntimeSnapshotMeta): WorkflowRuntimeSnapshotMeta['source'] {
  return snapshotMeta.source ?? 'unknown';
}

function isKnownIncrementalSnapshotScope(
  scope: WorkflowRuntimeSnapshotMeta['scope'],
): scope is 'canvas-sync' | 'output-append' | 'output-reconcile' {
  return scope === 'canvas-sync'
    || scope === 'output-append'
    || scope === 'output-reconcile';
}

function isSnapshotSourceScopeCompatible(
  snapshotMeta: WorkflowRuntimeSnapshotMeta,
): { compatible: boolean; reason?: 'missing-source' | 'mismatched-source' } {
  const scope = resolveSnapshotScope(snapshotMeta);
  const source = resolveSnapshotSource(snapshotMeta);

  if (!isKnownIncrementalSnapshotScope(scope)) {
    return { compatible: true };
  }

  if (source === 'unknown') {
    return { compatible: true, reason: 'missing-source' };
  }

  if (
    (scope === 'canvas-sync' && source === 'canvas-edit')
    || (scope === 'output-append' && source === 'external-output')
    || (scope === 'output-reconcile' && source === 'execution-reconcile')
  ) {
    return { compatible: true };
  }

  return { compatible: false, reason: 'mismatched-source' };
}

function hasStaleRuntimeSnapshotBase(
  currentWorkflow: Workflow,
  snapshotMeta: WorkflowRuntimeSnapshotMeta,
): boolean {
  const currentNodeCount = Object.keys(currentWorkflow.nodes).length;
  const currentConnectionCount = currentWorkflow.connections.length;
  const scope = resolveSnapshotScope(snapshotMeta);

  if (
    scope !== 'canvas-sync'
    && typeof snapshotMeta.baseUpdatedAt === 'number'
    && snapshotMeta.baseUpdatedAt !== currentWorkflow.timestamp.updated
  ) {
    return true;
  }

  if (
    typeof snapshotMeta.baseNodeCount === 'number'
    && snapshotMeta.baseNodeCount !== currentNodeCount
  ) {
    return true;
  }

  if (
    typeof snapshotMeta.baseConnectionCount === 'number'
    && snapshotMeta.baseConnectionCount !== currentConnectionCount
  ) {
    return true;
  }

  return false;
}

function wouldShrinkRuntimeSnapshotNodes(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
): boolean {
  return Object.keys(runtime.nodes).length < Object.keys(currentWorkflow.nodes).length;
}

function wouldShrinkRuntimeSnapshotConnections(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
): boolean {
  return runtime.connections.length < currentWorkflow.connections.length;
}

function resolveAffectedNodeIds(snapshotMeta: WorkflowRuntimeSnapshotMeta): Set<string> {
  const affectedNodeIds = new Set<string>();

  if (typeof snapshotMeta.sourceNodeId === 'string' && snapshotMeta.sourceNodeId.trim().length > 0) {
    affectedNodeIds.add(snapshotMeta.sourceNodeId);
  }

  snapshotMeta.affectedNodeIds?.forEach((nodeId) => {
    if (typeof nodeId === 'string' && nodeId.trim().length > 0) {
      affectedNodeIds.add(nodeId);
    }
  });

  return affectedNodeIds;
}

function requiresIncrementalAffectedNodeScope(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
  snapshotMeta: WorkflowRuntimeSnapshotMeta,
): boolean {
  const scope = resolveSnapshotScope(snapshotMeta);
  if (scope !== 'output-append' && scope !== 'output-reconcile') {
    return false;
  }

  return hasRuntimeSnapshotStructuralDifference(currentWorkflow, runtime)
    && resolveAffectedNodeIds(snapshotMeta).size === 0;
}

function hasUnsafeIncrementalStructureChanges(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
  snapshotMeta: WorkflowRuntimeSnapshotMeta,
): boolean {
  const affectedNodeIds = resolveAffectedNodeIds(snapshotMeta);
  if (affectedNodeIds.size === 0) {
    return false;
  }

  for (const [nodeId, currentNode] of Object.entries(currentWorkflow.nodes)) {
    const runtimeNode = runtime.nodes[nodeId];
    if (affectedNodeIds.has(nodeId)) {
      continue;
    }

    if (!runtimeNode) {
      return true;
    }

    if (!deepEqual(stripNodeTimestamps(currentNode), stripNodeTimestamps(runtimeNode))) {
      return true;
    }
  }

  for (const nodeId of Object.keys(runtime.nodes)) {
    if (currentWorkflow.nodes[nodeId]) {
      continue;
    }

    if (!affectedNodeIds.has(nodeId)) {
      return true;
    }
  }

  const isAffectedConnection = (connection: Connection): boolean => (
    affectedNodeIds.has(connection.sourceId) || affectedNodeIds.has(connection.targetId)
  );

  return !deepEqual(
    getSortedConnectionStructureSignatures(
      currentWorkflow.connections.filter((connection) => !isAffectedConnection(connection)),
    ),
    getSortedConnectionStructureSignatures(
      runtime.connections.filter((connection) => !isAffectedConnection(connection)),
    ),
  );
}

let hasWarnedForLegacyStructuralRuntimeSnapshot = false;
let hasWarnedForLooseIncrementalRuntimeSnapshot = false;

function warnForLegacyStructuralRuntimeSnapshot(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
): void {
  if (runtime.snapshotMeta || hasWarnedForLegacyStructuralRuntimeSnapshot) {
    return;
  }

  if (!hasRuntimeSnapshotStructuralDifference(currentWorkflow, runtime)) {
    return;
  }

  const currentNodeCount = Object.keys(currentWorkflow.nodes).length;
  const runtimeNodeCount = Object.keys(runtime.nodes).length;
  const currentConnectionCount = currentWorkflow.connections.length;
  const runtimeConnectionCount = runtime.connections.length;
  hasWarnedForLegacyStructuralRuntimeSnapshot = true;
  log.warn(
    'syncRuntimeState',
    'Applied a structural runtime snapshot without snapshot metadata. Canvas structure sync should flow through the Canvas-owned sync delegate.',
    {
      currentNodeCount,
      runtimeNodeCount,
      currentConnectionCount,
      runtimeConnectionCount,
    },
  );
}

function warnForLooseIncrementalRuntimeSnapshot(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
  snapshotMeta: WorkflowRuntimeSnapshotMeta,
): void {
  if (hasWarnedForLooseIncrementalRuntimeSnapshot) {
    return;
  }

  if (!isKnownIncrementalSnapshotScope(resolveSnapshotScope(snapshotMeta))) {
    return;
  }

  const compatibility = isSnapshotSourceScopeCompatible(snapshotMeta);
  if (compatibility.reason !== 'missing-source') {
    return;
  }

  if (!hasRuntimeSnapshotStructuralDifference(currentWorkflow, runtime)) {
    return;
  }

  hasWarnedForLooseIncrementalRuntimeSnapshot = true;
  log.warn(
    'syncRuntimeState',
    'Applying an incremental runtime snapshot without an explicit source. This remains compatible for now, but will be restricted to Canvas/runtime-owned producers only.',
    {
      scope: resolveSnapshotScope(snapshotMeta),
      source: resolveSnapshotSource(snapshotMeta),
      baseUpdatedAt: snapshotMeta.baseUpdatedAt ?? null,
      baseNodeCount: snapshotMeta.baseNodeCount ?? null,
      baseConnectionCount: snapshotMeta.baseConnectionCount ?? null,
    },
  );
}

function canApplyRuntimeSnapshot(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot,
): boolean {
  const snapshotMeta = getRuntimeSnapshotMeta(runtime);
  if (!snapshotMeta) {
    return true;
  }

  if (!isIncrementalOutputSnapshot(snapshotMeta)) {
    return true;
  }

  warnForLooseIncrementalRuntimeSnapshot(currentWorkflow, runtime, snapshotMeta);

  const scope = resolveSnapshotScope(snapshotMeta);
  const source = resolveSnapshotSource(snapshotMeta);
  const currentNodeCount = Object.keys(currentWorkflow.nodes).length;
  const runtimeNodeCount = Object.keys(runtime.nodes).length;
  const currentConnectionCount = currentWorkflow.connections.length;
  const runtimeConnectionCount = runtime.connections.length;
  const sourceCompatibility = isSnapshotSourceScopeCompatible(snapshotMeta);

  if (!sourceCompatibility.compatible) {
    log.warn('syncRuntimeState', 'Rejected incremental runtime snapshot because its declared source does not match its scope.', {
      source,
      scope,
      baseUpdatedAt: snapshotMeta.baseUpdatedAt ?? null,
      currentUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: snapshotMeta.baseNodeCount ?? null,
      currentNodeCount,
      baseConnectionCount: snapshotMeta.baseConnectionCount ?? null,
      currentConnectionCount,
      runtimeNodeCount,
      runtimeConnectionCount,
    });
    return false;
  }

  if (hasStaleRuntimeSnapshotBase(currentWorkflow, snapshotMeta)) {
    log.warn('syncRuntimeState', 'Rejected incremental runtime snapshot because workflow base timestamp is stale.', {
      source,
      scope,
      baseUpdatedAt: snapshotMeta.baseUpdatedAt ?? null,
      currentUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: snapshotMeta.baseNodeCount ?? null,
      currentNodeCount,
      runtimeNodeCount,
      baseConnectionCount: snapshotMeta.baseConnectionCount ?? null,
      currentConnectionCount,
      runtimeConnectionCount,
    });
    return false;
  }

  if (snapshotMeta.allowNodeShrink !== true && wouldShrinkRuntimeSnapshotNodes(currentWorkflow, runtime)) {
    log.warn('syncRuntimeState', 'Rejected incremental runtime snapshot because it would shrink workflow nodes.', {
      source,
      scope,
      baseUpdatedAt: snapshotMeta.baseUpdatedAt ?? null,
      currentUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: snapshotMeta.baseNodeCount ?? null,
      currentNodeCount,
      runtimeNodeCount,
      baseConnectionCount: snapshotMeta.baseConnectionCount ?? null,
      currentConnectionCount,
      runtimeConnectionCount,
    });
    return false;
  }

  if (
    scope !== 'canvas-sync'
    && wouldShrinkRuntimeSnapshotConnections(currentWorkflow, runtime)
  ) {
    log.warn('syncRuntimeState', 'Rejected incremental runtime snapshot because it would shrink workflow connections.', {
      source,
      scope,
      currentConnectionCount,
      runtimeConnectionCount,
      currentNodeCount,
      runtimeNodeCount,
    });
    return false;
  }

  if (requiresIncrementalAffectedNodeScope(currentWorkflow, runtime, snapshotMeta)) {
    log.warn('syncRuntimeState', 'Rejected incremental runtime snapshot because it declared structural output changes without affected node metadata.', {
      source,
      scope,
      sourceNodeId: snapshotMeta.sourceNodeId ?? null,
      affectedNodeIds: snapshotMeta.affectedNodeIds ?? [],
      currentNodeCount,
      runtimeNodeCount,
      currentConnectionCount,
      runtimeConnectionCount,
    });
    return false;
  }

  if (
    (scope === 'output-append' || scope === 'output-reconcile')
    && hasUnsafeIncrementalStructureChanges(currentWorkflow, runtime, snapshotMeta)
  ) {
    log.warn('syncRuntimeState', 'Rejected incremental runtime snapshot because it attempted to mutate unrelated workflow structure.', {
      source,
      scope,
      sourceNodeId: snapshotMeta.sourceNodeId ?? null,
      affectedNodeIds: snapshotMeta.affectedNodeIds ?? [],
      currentNodeCount,
      runtimeNodeCount,
      currentConnectionCount,
      runtimeConnectionCount,
    });
    return false;
  }

  return true;
}

export const __testOnly = {
  canApplyRuntimeSnapshot,
};

function isEphemeralRuntimeUrl(url: string): boolean {
  return (
    url.startsWith('runtime:') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('file:')
  );
}

function stripEphemeralPreviewUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string' || url.length === 0) {
    return undefined;
  }

  if (isEphemeralRuntimeUrl(url)) {
    return undefined;
  }

  return url;
}

function sanitizeRuntimeNode(node: AnyNodeData): AnyNodeData {
  if (node.type !== 'image' && node.type !== 'video' && node.type !== 'ply') {
    return node;
  }

  const useRemoteFallback = shouldUseRemoteFileResourceFallback(node);
  const sanitizedPreviewUrl = node.type === 'image'
    ? undefined
    : useRemoteFallback
      ? stripEphemeralPreviewUrl(node.previewUrl)
      : undefined;
  const nextNode = {
    ...node,
    previewUrl: sanitizedPreviewUrl,
    thumbnailUrl: useRemoteFallback
      ? stripEphemeralPreviewUrl(node.thumbnailUrl)
      : undefined,
    renderTier: undefined,
    activeState: undefined,
    activeReasons: undefined,
    imageResourceOwner: undefined,
  };

  if (node.type !== 'image' || !node.imageAsset) {
    return nextNode;
  }

  if (!useRemoteFallback) {
    return {
      ...nextNode,
      imageAsset: {
        ...node.imageAsset,
        variants: {},
      },
    };
  }

  const sanitizedThumbnailUrl = stripEphemeralPreviewUrl(node.imageAsset.variants.thumbnail?.url);
  const sanitizedOriginalUrl = stripEphemeralPreviewUrl(node.imageAsset.variants.original?.url);

  return {
    ...nextNode,
    imageAsset: {
      ...node.imageAsset,
      variants: {
        thumbnail: sanitizedThumbnailUrl
          ? {
            ...node.imageAsset.variants.thumbnail,
            url: sanitizedThumbnailUrl,
          }
          : undefined,
        original: sanitizedOriginalUrl
          ? {
            ...node.imageAsset.variants.original,
            url: sanitizedOriginalUrl,
          }
          : undefined,
      },
    },
  };
}

function sanitizeRuntimeNodes(nodes: Record<string, AnyNodeData>): Record<string, AnyNodeData> {
  return Object.fromEntries(
    Object.entries(nodes).map(([nodeId, node]) => [nodeId, sanitizeRuntimeNode(node)]),
  );
}

function stripNodeTimestamps(node: AnyNodeData): AnyNodeData {
  return {
    ...node,
    timestamp: {
      ...node.timestamp,
      updated: 0,
    },
  };
}

function areRuntimeNodesEquivalent(
  currentNodes: Record<string, AnyNodeData>,
  nextNodes: Record<string, AnyNodeData>
): boolean {
  const currentNodeIds = Object.keys(currentNodes);
  const nextNodeIds = Object.keys(nextNodes);
  if (currentNodeIds.length !== nextNodeIds.length) {
    return false;
  }

  for (const nodeId of currentNodeIds) {
    const currentNode = currentNodes[nodeId];
    const nextNode = nextNodes[nodeId];
    if (!currentNode || !nextNode) {
      return false;
    }

    if (!deepEqual(stripNodeTimestamps(currentNode), stripNodeTimestamps(nextNode))) {
      return false;
    }
  }

  return true;
}

export function normalizeWorkflowForUseWorkflow(workflow: Workflow): Workflow {
  const normalizedWorkflow = normalizeWorkflowData(deepClone(workflow) as Workflow);
  const sanitizedNodes = sanitizeRuntimeNodes(normalizedWorkflow.nodes);
  return {
    ...normalizedWorkflow,
    persistedWorkflowId: normalizedWorkflow.persistedWorkflowId ?? (
      normalizedWorkflow.persistenceState === 'persisted'
        ? normalizedWorkflow.id
        : undefined
    ),
    workflowGroupId: normalizedWorkflow.workflowGroupId ?? normalizedWorkflow.groupId ?? null,
    groupId: normalizedWorkflow.workflowGroupId ?? normalizedWorkflow.groupId ?? null,
    persistenceState: normalizedWorkflow.persistenceState ?? 'draft',
    hasMaterializedCanvas: hasMaterializedCanvas(normalizedWorkflow),
    nodes: sanitizedNodes,
    metadata: normalizeWorkflowNodeIdMetadata(
      normalizedWorkflow.metadata,
      sanitizedNodes,
    ),
  };
}

function isRuntimeSnapshotChanged(
  currentWorkflow: Workflow,
  runtime: WorkflowRuntimeSnapshot
): boolean {
  const sanitizedRuntimeNodes = sanitizeRuntimeNodes(runtime.nodes);
  const nextMetadata = normalizeWorkflowNodeIdMetadata({
    ...currentWorkflow.metadata,
    ...runtime.metadata,
    nodeCount: Object.keys(sanitizedRuntimeNodes).length,
    connectionCount: runtime.connections.length,
  }, sanitizedRuntimeNodes);

  return !(
    areRuntimeNodesEquivalent(currentWorkflow.nodes, sanitizedRuntimeNodes) &&
    deepEqual(currentWorkflow.connections, runtime.connections) &&
    deepEqual(currentWorkflow.viewport, runtime.viewport) &&
    deepEqual(currentWorkflow.metadata, nextMetadata)
  );
}

export function useWorkflow(options: UseWorkflowOptions = {}): UseWorkflowReturn {
  const {
    initialWorkflow = null,
    onLoad,
    autoSaveConfig: customAutoSaveConfig,
  } = options;

  const normalizedInitialWorkflow = useMemo(
    () => (initialWorkflow ? normalizeWorkflowForUseWorkflow(initialWorkflow) : null),
    [initialWorkflow],
  );

  const [workflow, setWorkflow] = useState<Workflow | null>(normalizedInitialWorkflow);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [hydrationState, setHydrationState] = useState<WorkflowHydrationState>({
    version: 0,
    reason: normalizedInitialWorkflow ? 'workflow-load' : null,
  });
  const workflowRef = useRef<Workflow | null>(normalizedInitialWorkflow);

  const autoSaveConfig: AutoSaveConfig = useMemo(
    () => ({
      ...AUTO_SAVE_DEFAULTS,
      ...customAutoSaveConfig,
    }),
    [customAutoSaveConfig]
  );
  const hydrationVersion = hydrationState.version;
  const persistedWorkflowId = workflow ? getPersistedWorkflowId(workflow) : null;
  const workflowPersistenceState = workflow?.persistenceState ?? null;
  const workflowHasMaterializedCanvas = hasMaterializedCanvas(workflow);
  const localSourceRecoveryVersionRef = useRef(0);

  useEffect(() => {
    workflowRef.current = workflow;
  }, [workflow]);

  useEffect(() => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return;
    }

    const targetNodes = Object.values(activeWorkflow.nodes).filter((node): node is FileNodeData => (
      (node.type === 'image' || node.type === 'video' || node.type === 'ply') &&
      node.source.type === 'imported' &&
      node.source.localSource?.status !== 'available' &&
      typeof node.source.localSource?.referenceId === 'string' &&
      node.source.localSource.referenceId.trim().length > 0
    ));

    if (targetNodes.length === 0) {
      return;
    }

    const runVersion = localSourceRecoveryVersionRef.current + 1;
    localSourceRecoveryVersionRef.current = runVersion;
    let cancelled = false;

    void (async (): Promise<void> => {
      const recoveredNodes = await Promise.all(targetNodes.map(async (node) => {
        const referenceId = node.source.localSource?.referenceId?.trim();
        if (!referenceId) {
          return null;
        }

        const restored = await localFileSourceStore.restore(referenceId);
        if (cancelled || localSourceRecoveryVersionRef.current !== runVersion) {
          return null;
        }

        if (restored.status === 'ready' && restored.file) {
          backendFileService.restoreRuntimeNodeFileSourceFromHandle(node, restored.file, {
            workflowId: activeWorkflow.id,
          });
          if (
            node.source.localSource?.status === 'available' &&
            node.source.localSource.permissionState === 'granted'
          ) {
            return null;
          }

          return {
            nodeId: node.id.value,
            patch: {
              source: {
                ...node.source,
                localSource: {
                  ...node.source.localSource,
                  status: 'available' as const,
                  kind: 'file-system-access' as const,
                  permissionState: 'granted' as PermissionState,
                  lastResolvedAt: Date.now(),
                },
              },
              timestamp: {
                ...node.timestamp,
                updated: Date.now(),
              },
            },
          };
        }

        const nextStatus = restored.status === 'permission-required' ? 'permission-required' as const : 'linked' as const;
        const nextPermissionState = (
          restored.permissionState === 'granted' ||
          restored.permissionState === 'prompt' ||
          restored.permissionState === 'denied'
        )
          ? restored.permissionState
          : undefined;

        if (
          node.source.localSource?.status === nextStatus &&
          node.source.localSource.permissionState === nextPermissionState
        ) {
          return null;
        }

        return {
          nodeId: node.id.value,
          patch: {
            source: {
              ...node.source,
              localSource: {
                ...node.source.localSource,
                status: nextStatus,
                kind: 'file-system-access' as const,
                ...(nextPermissionState ? { permissionState: nextPermissionState } : {}),
              },
            },
          },
        };
      }));

      if (cancelled || localSourceRecoveryVersionRef.current !== runVersion) {
        return;
      }

      const validPatches = recoveredNodes.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      if (validPatches.length === 0) {
        return;
      }

      setWorkflow((currentWorkflow) => {
        if (!currentWorkflow) {
          return currentWorkflow;
        }

        const nextNodes = { ...currentWorkflow.nodes };
        let hasChanged = false;

        validPatches.forEach((entry) => {
          const currentNode = nextNodes[entry.nodeId];
          if (!currentNode) {
            return;
          }

          nextNodes[entry.nodeId] = {
            ...currentNode,
            ...entry.patch,
          };
          hasChanged = true;
        });

        if (!hasChanged) {
          return currentWorkflow;
        }

        const nextWorkflow = {
          ...currentWorkflow,
          nodes: nextNodes,
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: Date.now(),
          },
        };
        workflowRef.current = nextWorkflow;
        return nextWorkflow;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [workflow]);

  const commitPersistedWorkflow = useCallback((nextWorkflow: Workflow): Workflow | null => {
    const normalizedWorkflow = normalizeWorkflowForUseWorkflow(nextWorkflow);
    const currentWorkflow = workflowRef.current;
    const currentPersistedWorkflowId = getPersistedWorkflowId(currentWorkflow);
    const nextPersistedWorkflowId = getPersistedWorkflowId(normalizedWorkflow);
    if (
      currentWorkflow
      && (
        (
          currentPersistedWorkflowId !== null
          && nextPersistedWorkflowId !== null
          && currentPersistedWorkflowId !== nextPersistedWorkflowId
        )
        || (
          currentPersistedWorkflowId === null
          && nextPersistedWorkflowId === null
          && currentWorkflow.id !== normalizedWorkflow.id
        )
        || currentWorkflow.timestamp.updated > normalizedWorkflow.timestamp.updated
      )
    ) {
      log.debug('commitPersistedWorkflow', 'Skipping outdated persisted workflow result');
      return currentWorkflow;
    }

    workflowRef.current = normalizedWorkflow;
    setWorkflow(normalizedWorkflow);
    setIsDirty(false);
    setLastSavedAt(normalizedWorkflow.timestamp.updated);
    return normalizedWorkflow;
  }, []);

  const create = useCallback((projectId: UUID, name: string = DEFAULT_WORKFLOW_NAME): Workflow => {
    const nextWorkflow = createEmptyWorkflow(projectId, name);
    setWorkflow(nextWorkflow);
    setHydrationState((previousState) => {
      return {
        version: previousState.version + 1,
        reason: 'canvas-reset',
      };
    });
    setIsDirty(false);
    setLastSavedAt(null);
    log.info('create', `Created workflow: ${name}`);
    return nextWorkflow;
  }, []);

  const load = useCallback((loadedWorkflow: Workflow): void => {
    const validation = validateWorkflow(loadedWorkflow);
    if (!validation.valid) {
      log.error('load', validation.message);
      return;
    }

    const normalizedWorkflow = normalizeWorkflowForUseWorkflow(loadedWorkflow);
    createNodeIdAllocatorFromWorkflowMetadata(normalizedWorkflow.metadata, normalizedWorkflow.nodes);
    setWorkflow(normalizedWorkflow);
    setHydrationState((previousState) => {
      return {
        version: previousState.version + 1,
        reason: 'workflow-load',
      };
    });
    setIsDirty(false);
    setLastSavedAt(normalizedWorkflow.timestamp.updated);
    onLoad?.(loadedWorkflow);
    log.info('load', `Loaded workflow: ${loadedWorkflow.name}`);
  }, [onLoad]);

  const replaceCurrent = useCallback((nextWorkflow: Workflow): void => {
    const normalizedWorkflow = normalizeWorkflowForUseWorkflow(nextWorkflow);
    workflowRef.current = normalizedWorkflow;
    setWorkflow(normalizedWorkflow);
    setIsDirty(false);
    if (typeof normalizedWorkflow.timestamp.updated === 'number') {
      setLastSavedAt(normalizedWorkflow.timestamp.updated);
    }
  }, []);

  const patchCurrent = useCallback((updater: (workflow: Workflow) => Workflow): Workflow | null => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return null;
    }

    const normalizedWorkflow = normalizeWorkflowForUseWorkflow(updater(activeWorkflow));
    workflowRef.current = normalizedWorkflow;
    setWorkflow(normalizedWorkflow);

    if (!isDirty && typeof normalizedWorkflow.timestamp.updated === 'number') {
      setLastSavedAt(normalizedWorkflow.timestamp.updated);
    }

    return normalizedWorkflow;
  }, [isDirty]);

  const syncRuntimeState = useCallback((
    runtime: WorkflowRuntimeSnapshot,
    options?: WorkflowRuntimeSyncOptions,
  ): Workflow | null => {
    const previousWorkflow = workflowRef.current;
    if (!previousWorkflow) {
      return null;
    }

    warnForLegacyStructuralRuntimeSnapshot(previousWorkflow, runtime);

    const runtimeWithMeta = options?.runtimeSnapshotMeta
      ? {
        ...runtime,
        snapshotMeta: {
          ...(runtime.snapshotMeta ?? {}),
          ...options.runtimeSnapshotMeta,
        },
      }
      : runtime;

    if (!isRuntimeSnapshotChanged(previousWorkflow, runtimeWithMeta)) {
      return previousWorkflow;
    }

    if (!canApplyRuntimeSnapshot(previousWorkflow, runtimeWithMeta)) {
      return previousWorkflow;
    }

    const nextWorkflow = buildWorkflowWithRuntime(previousWorkflow, runtimeWithMeta);
    workflowRef.current = nextWorkflow;
    setWorkflow(nextWorkflow);
    setIsDirty(true);

    if (options?.hydrateCanvas) {
      setHydrationState((previousState) => {
        return {
          version: previousState.version + 1,
          reason: options.hydrationReason ?? 'external-output',
        };
      });
    }

    return nextWorkflow;
  }, []);

  const reset = useCallback((): void => {
    setWorkflow(null);
    setHydrationState((previousState) => {
      return {
        version: previousState.version + 1,
        reason: 'canvas-reset',
      };
    });
    setIsDirty(false);
    setLastSavedAt(null);
    log.debug('reset', 'Workflow reset');
  }, []);

  const markDirty = useCallback((): void => setIsDirty(true), []);
  const markClean = useCallback((savedAt?: number): void => {
    setIsDirty(false);
    if (typeof savedAt === 'number') {
      setLastSavedAt(savedAt);
    }
  }, []);

  const nodes = useMemo(() => (workflow ? Object.values(workflow.nodes) : []), [workflow]);
  const connections = useMemo(() => workflow?.connections ?? [], [workflow]);
  const viewport = useMemo(() => workflow?.viewport ?? null, [workflow]);
  const metadata = useMemo(() => workflow?.metadata ?? null, [workflow]);

  return useMemo(() => ({
    workflow,
    hydrationVersion,
    hydrationState,
    isLoaded: workflow !== null,
    isDirty,
    lastSavedAt,
    autoSaveConfig,
    nodes,
    connections,
    viewport,
    metadata,
    nodeCount: nodes.length,
    connectionCount: connections.length,
    persistenceState: workflowPersistenceState,
    hasMaterializedCanvas: workflowHasMaterializedCanvas,
    persistedWorkflowId,
    create,
    load,
    replaceCurrent,
    commitPersistedWorkflow,
    patchCurrent,
    syncRuntimeState,
    reset,
    markDirty,
    markClean,
  }), [
    workflow,
    hydrationVersion,
    hydrationState,
    isDirty,
    lastSavedAt,
    autoSaveConfig,
    nodes,
    connections,
    viewport,
    metadata,
    workflowPersistenceState,
    workflowHasMaterializedCanvas,
    persistedWorkflowId,
    create,
    load,
    replaceCurrent,
    commitPersistedWorkflow,
    patchCurrent,
    syncRuntimeState,
    reset,
    markDirty,
    markClean,
  ]);
}
