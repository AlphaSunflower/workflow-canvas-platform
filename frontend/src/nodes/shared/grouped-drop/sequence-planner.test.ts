import type { AINodeData, AIImageInputGroup, AnyNodeData, Workflow } from '@/types';
import type {
  NodeDropTargetContext,
  NodeInputGroupDefinition,
} from '../../types';
import {
  buildSequenceGroupedDropPlan,
  type SequenceGroupedDropPlannerOptions,
  validateSequenceGroupedDropPlan,
} from './sequence-planner';
import {
  createTestDropContext,
  createTestImageNode,
  createTestWorkflow,
  createTestInputGroups,
  type CreateTestDropContextOptions,
} from './planner.test';

interface BuildHarnessOptions {
  groups?: AIImageInputGroup[];
  inputsByHandle?: Record<string, string[]>;
  maxGroups?: number;
  ctrlSingleBroadcast?: boolean;
  targetNodeType?: AINodeData['type'];
  maxConnectionsPerPort?: number;
  shiftPlacementStrategy?: 'fill-capacity' | 'single-per-group';
  disallowHandleDuplicates?: boolean;
}

interface BuildContextOptions {
  target: NodeDropTargetContext['target'];
  draggedNodes: AnyNodeData[];
  keyboard?: Partial<NodeDropTargetContext['keyboard']>;
}

export interface SequenceGroupedDropPlannerTestHarness {
  workflow: Workflow;
  targetNode: AINodeData;
  options: SequenceGroupedDropPlannerOptions<AINodeData, AnyNodeData, 'input'>;
}

function createSequenceTargetNode(groups: AIImageInputGroup[], type: AINodeData['type'] = 'aiImageGen'): AINodeData {
  return {
    id: {
      value: 'ai-node-1',
      display: '#target',
    },
    type,
    position: { x: 300, y: 100 },
    dimensions: { width: 320, height: 340 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: 1,
      updated: 1,
    },
    references: [],
    outputs: [],
    tasks: [],
    config: {
      inputGroups: groups,
    },
  };
}

function createSequenceGroupDefinitions(
  node: AINodeData,
  maxConnectionsPerPort: number = 5
): NodeInputGroupDefinition[] {
  const groups = Array.isArray(node.config.inputGroups) ? node.config.inputGroups : [];
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
        orderMode: 'ordered',
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

export function createSequenceGroupedDropPlannerTestHarness(
  options: BuildHarnessOptions = {}
): SequenceGroupedDropPlannerTestHarness {
  const groups = options.groups ?? createTestInputGroups(3);
  const targetNode = createSequenceTargetNode(groups, options.targetNodeType ?? 'aiImageGen');
  const workflow = createTestWorkflow({
    targetNode,
    inputsByHandle: options.inputsByHandle,
  });

  const plannerOptions: SequenceGroupedDropPlannerOptions<AINodeData, AnyNodeData, 'input'> = {
    getTargetNode: (currentWorkflow, nodeId) => {
      const node = currentWorkflow.nodes[nodeId];
      return node && node.type === (options.targetNodeType ?? 'aiImageGen')
        ? node as AINodeData
        : null;
    },
    resolveInputGroups: (node) => createSequenceGroupDefinitions(
      node,
      options.maxConnectionsPerPort ?? 5
    ),
    normalizeDraggedNodes: (nodes) => nodes.filter((node): node is AnyNodeData => node.type === 'image'),
    sidePortMap: Object.freeze({
      input: 'images',
    }),
    maxGroups: options.maxGroups ?? 10,
    allowCtrl: true,
    allowShift: true,
    ctrlSingleBroadcast: options.ctrlSingleBroadcast ?? true,
    shiftPlacementStrategy: options.shiftPlacementStrategy,
    disallowHandleDuplicates: options.disallowHandleDuplicates,
  };

  return {
    workflow,
    targetNode,
    options: plannerOptions,
  };
}

export function createSequenceGroupedDropPlannerTestContext(
  harness: SequenceGroupedDropPlannerTestHarness,
  options: BuildContextOptions
) {
  return createTestDropContext({
    workflow: harness.workflow,
    target: options.target,
    draggedNodes: options.draggedNodes,
    keyboard: options.keyboard,
  } satisfies CreateTestDropContextOptions);
}

export function runSequenceGroupedDropPlannerValidationScenario(
  harness: SequenceGroupedDropPlannerTestHarness,
  options: BuildContextOptions
) {
  return validateSequenceGroupedDropPlan(
    createSequenceGroupedDropPlannerTestContext(harness, options),
    harness.options
  );
}

export function runSequenceGroupedDropPlannerBuildScenario(
  harness: SequenceGroupedDropPlannerTestHarness,
  options: BuildContextOptions
) {
  return buildSequenceGroupedDropPlan(
    createSequenceGroupedDropPlannerTestContext(harness, options),
    harness.options
  );
}

export { createTestImageNode };
