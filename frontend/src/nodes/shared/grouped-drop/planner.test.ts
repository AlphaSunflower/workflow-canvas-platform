import type { AINodeData, AIImageInputGroup, AnyNodeData, Workflow } from '@/types';
import type {
  NodeDropTargetContext,
  NodeInputGroupDefinition,
} from '../../types';
import {
  buildGroupedDropPlan,
  type GroupedDropPlannerOptions,
  validateGroupedDropPlan,
} from './planner';
import { createDefaultGroupedDropAcceptDraggedNodes } from './capability';
import { getGroupedDropModeSemantics } from './types';

interface GroupedDropPlannerTestHarness {
  workflow: Workflow;
  targetNode: AINodeData;
  options: GroupedDropPlannerOptions<AINodeData, AnyNodeData, 'left' | 'right'>;
}

interface BuildHarnessOptions {
  groups?: AIImageInputGroup[];
  inputsByHandle?: Record<string, string[]>;
  maxGroups?: number;
  ctrlSingleBroadcast?: boolean;
  targetNodeType?: AINodeData['type'];
  targetPortMode?: 'single-slot' | 'sequence';
  maxConnectionsPerPort?: number;
}

interface BuildContextOptions {
  target: NodeDropTargetContext['target'];
  draggedNodes: AnyNodeData[];
  keyboard?: Partial<NodeDropTargetContext['keyboard']>;
}

export interface CreateTestAINodeOptions {
  type?: AINodeData['type'];
  groups?: AIImageInputGroup[];
  dimensions?: {
    width: number;
    height: number;
  };
}

export interface CreateTestWorkflowOptions {
  targetNode: AINodeData;
  inputsByHandle?: Record<string, string[]>;
  extraNodes?: AnyNodeData[];
}

export interface CreateTestDropContextOptions {
  workflow: Workflow;
  target: NodeDropTargetContext['target'];
  draggedNodes: AnyNodeData[];
  keyboard?: Partial<NodeDropTargetContext['keyboard']>;
}

const DEFAULT_GROUPS: AIImageInputGroup[] = [
  { id: 'group-1', label: 'Group 1', order: 0 },
  { id: 'group-2', label: 'Group 2', order: 1 },
  { id: 'group-3', label: 'Group 3', order: 2 },
];

const DEFAULT_NODE_ID = 'ai-node-1';

function createTimestamp() {
  return {
    created: 1,
    updated: 1,
  };
}

function createImageNode(id: string, x: number = 0, y: number = 0): AnyNodeData {
  return {
    id: {
      value: id,
      display: `#${id}`,
    },
    type: 'image',
    position: { x, y },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: createTimestamp(),
    fileId: `file-${id}`,
    fileName: `${id}.png`,
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 1,
    },
    metadata: {
      width: 1024,
      height: 1024,
    },
  };
}

export function createTestInputGroups(count: number = DEFAULT_GROUPS.length): AIImageInputGroup[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    id: `group-${index + 1}`,
    label: `Group ${index + 1}`,
    order: index,
  }));
}

function createTargetNode(
  groups: AIImageInputGroup[],
  type: AINodeData['type'] = 'aiModelRenderTransfer',
  dimensions: { width: number; height: number } = { width: 320, height: 296 }
): AINodeData {
  return {
    id: {
      value: DEFAULT_NODE_ID,
      display: '#target',
    },
    type,
    position: { x: 300, y: 100 },
    dimensions,
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: createTimestamp(),
    references: [],
    outputs: [],
    tasks: [],
    config: {
      inputGroups: groups,
    },
  };
}

function createSequenceTargetNode(groups: AIImageInputGroup[]): AINodeData {
  return createTargetNode(groups, 'aiImageGen', { width: 320, height: 340 });
}

function createGroupDefinitions(
  node: AINodeData,
  mode: BuildHarnessOptions['targetPortMode'] = 'single-slot',
  maxConnectionsPerPort: number = 1
): NodeInputGroupDefinition[] {
  const groups = Array.isArray(node.config.inputGroups) ? node.config.inputGroups : [];
  if (mode === 'sequence') {
    return groups.map((group) => ({
      id: group.id,
      label: group.label,
      ports: [
        {
          id: 'images',
          label: 'Images',
          accepts: ['image'],
          required: false,
          maxConnections: maxConnectionsPerPort,
        },
        {
          id: 'result',
          label: 'Result',
          accepts: ['image'],
          required: false,
          maxConnections: 1,
        },
      ],
    }));
  }

  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    ports: [
      {
        id: 'white-model',
        label: 'White Model',
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: 'style-reference',
        label: 'Style Reference',
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: 'result',
        label: 'Result',
        accepts: ['image'],
        required: false,
        maxConnections: 1,
      },
    ],
  }));
}

function createWorkflow(
  targetNode: AINodeData,
  sourceNodes: AnyNodeData[],
  inputsByHandle: Record<string, string[]>
): Workflow {
  const nodes: Record<string, AnyNodeData> = {
    [targetNode.id.value]: targetNode,
  };

  sourceNodes.forEach((node) => {
    nodes[node.id.value] = node;
  });

  const connections = Object.entries(inputsByHandle).flatMap(([handle, sourceIds]) =>
    sourceIds.map((sourceId, index) => ({
      id: `connection-${handle}-${index}`,
      type: 'file-reference' as const,
      sourceId,
      targetId: targetNode.id.value,
      targetHandle: handle,
      order: index,
    }))
  );

  return {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Grouped Drop Planner Test',
    nodes,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: Object.keys(nodes).length,
      connectionCount: connections.length,
      lastNodeId: 0,
      canvasSize: { width: 20000, height: 20000 },
      usedNodeIds: [],
      releasedNodeIds: [],
    },
    timestamp: createTimestamp(),
  };
}

export function createTestAINode(options: CreateTestAINodeOptions = {}): AINodeData {
  return createTargetNode(
    options.groups ?? createTestInputGroups(),
    options.type,
    options.dimensions
  );
}

export function createTestWorkflow(options: CreateTestWorkflowOptions): Workflow {
  const inputsByHandle = options.inputsByHandle ?? {};
  const explicitNodes = options.extraNodes ?? [];
  const explicitNodeIds = new Set(explicitNodes.map((node) => node.id.value));
  const referencedSourceIds = Array.from(new Set(Object.values(inputsByHandle).flat()));
  const autoSourceNodes = referencedSourceIds
    .filter((sourceId) => !explicitNodeIds.has(sourceId))
    .map((sourceId, index) => createImageNode(sourceId, index * 100, index * 40));

  return createWorkflow(
    options.targetNode,
    [...explicitNodes, ...autoSourceNodes],
    inputsByHandle
  );
}

export function createTestDropContext(options: CreateTestDropContextOptions): NodeDropTargetContext {
  const sourceNodes = options.draggedNodes.reduce<Record<string, AnyNodeData>>((result, node) => {
    result[node.id.value] = node;
    return result;
  }, {});

  return {
    workflow: {
      ...options.workflow,
      nodes: {
        ...options.workflow.nodes,
        ...sourceNodes,
      },
    },
    target: options.target,
    draggedNodes: options.draggedNodes,
    keyboard: {
      shiftKey: Boolean(options.keyboard?.shiftKey),
      ctrlKey: Boolean(options.keyboard?.ctrlKey),
      metaKey: Boolean(options.keyboard?.metaKey),
    },
  };
}

export function createGroupedDropPlannerTestHarness(
  options: BuildHarnessOptions = {}
): GroupedDropPlannerTestHarness {
  const groups = options.groups ?? DEFAULT_GROUPS;
  const targetNode = options.targetPortMode === 'sequence'
    ? createSequenceTargetNode(groups)
    : createTargetNode(groups);
  const inputsByHandle = options.inputsByHandle ?? {};
  const sourceNodeIds = Array.from(new Set(Object.values(inputsByHandle).flat()));
  const sourceNodes = sourceNodeIds.map((sourceId, index) => createImageNode(sourceId, index * 100, index * 40));
  const workflow = createWorkflow(targetNode, sourceNodes, inputsByHandle);

  const plannerOptions: GroupedDropPlannerOptions<AINodeData, AnyNodeData, 'left' | 'right'> = {
    getTargetNode: (currentWorkflow, nodeId) => {
      const node = currentWorkflow.nodes[nodeId];
      return node && node.type === (options.targetNodeType ?? targetNode.type)
        ? node as AINodeData
        : null;
    },
    resolveInputGroups: (node) => createGroupDefinitions(
      node,
      options.targetPortMode,
      options.maxConnectionsPerPort
    ),
    normalizeDraggedNodes: (nodes) => nodes.filter((node): node is AnyNodeData => node.type === 'image'),
    sidePortMap: Object.freeze({
      left: options.targetPortMode === 'sequence' ? 'images' : 'white-model',
      right: options.targetPortMode === 'sequence' ? 'images' : 'style-reference',
    }),
    maxGroups: options.maxGroups ?? 10,
    allowCtrl: true,
    allowShift: true,
    ctrlSingleBroadcast: options.ctrlSingleBroadcast ?? true,
  };

  return {
    workflow,
    targetNode,
    options: plannerOptions,
  };
}

export function createGroupedDropPlannerTestContext(
  harness: GroupedDropPlannerTestHarness,
  options: BuildContextOptions
): NodeDropTargetContext {
  return createTestDropContext({
    workflow: harness.workflow,
    target: options.target,
    draggedNodes: options.draggedNodes,
    keyboard: options.keyboard,
  });
}

export function runGroupedDropPlannerValidationScenario(
  harness: GroupedDropPlannerTestHarness,
  options: BuildContextOptions
) {
  return validateGroupedDropPlan(
    createGroupedDropPlannerTestContext(harness, options),
    harness.options
  );
}

export function runGroupedDropPlannerBuildScenario(
  harness: GroupedDropPlannerTestHarness,
  options: BuildContextOptions
) {
  return buildGroupedDropPlan(
    createGroupedDropPlannerTestContext(harness, options),
    harness.options
  );
}

export function runGroupedDropCapabilityAcceptScenario(nodes: AnyNodeData[]): boolean {
  return createDefaultGroupedDropAcceptDraggedNodes(
    (items: AnyNodeData[]) => items.filter((node): node is AnyNodeData => node.type === 'image')
  )(nodes);
}

export function getGroupedDropModeSemanticSnapshot() {
  return {
    normal: getGroupedDropModeSemantics('normal'),
    ctrl: getGroupedDropModeSemantics('ctrl'),
    shift: getGroupedDropModeSemantics('shift'),
    invalid: getGroupedDropModeSemantics('invalid'),
  };
}

export function createTestImageNode(id: string, x: number = 0, y: number = 0): AnyNodeData {
  return createImageNode(id, x, y);
}
