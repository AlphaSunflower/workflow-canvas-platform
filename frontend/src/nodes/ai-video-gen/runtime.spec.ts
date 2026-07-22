import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowConnectionInput } from '@/contracts/workflow';
import type { NodeValidationResult } from '@/nodes/types';
import type { AINodeData, FileNodeData, Workflow } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  AI_VIDEO_GEN_DEFAULT_MODEL,
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
  AI_VIDEO_GEN_DEFAULT_RESOLUTION,
  AI_VIDEO_GEN_PROVIDER,
  aiVideoGenExecution,
  buildAIVideoGenGroupPlans,
  canRunAIVideoGen,
  getAIVideoGenExecutableGroups,
  normalizeAIVideoGenDuration,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenPrompt,
  validateAIVideoGenExecutionInput,
} from './runtime';
import {
  getAIVideoGenGroupInputHandle,
  getAIVideoGenGroupOutputHandle,
} from './groups';

function assertInvalid(
  result: NodeValidationResult,
  pattern?: RegExp,
): string {
  assert.equal(result.valid, false);
  if (result.valid) {
    throw new Error('expected invalid result');
  }

  const reason = result.reason ?? '';
  assert.ok(reason.length > 0);

  if (pattern) {
    assert.ok(pattern.test(reason), `expected "${reason}" to match ${String(pattern)}`);
  }

  return reason;
}

function createImageNode(sequence: number, fileId: string, fileName: string): FileNodeData {
  return createDefaultFileNodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 20, y: sequence * 10 },
    'image',
    fileId,
    fileName,
    1024,
    'image/png',
    {
      width: 1280,
      height: 720,
    },
  );
}

function createVideoNode(sequence: number, fileId: string, fileName: string): FileNodeData {
  return createDefaultFileNodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 20, y: sequence * 10 },
    'video',
    fileId,
    fileName,
    2048,
    'video/mp4',
    {
      width: 1280,
      height: 720,
      duration: 8,
    },
  );
}

function createNode(): AINodeData {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiVideoGen',
  );

  node.config = {
    ...node.config,
    prompt: 'Create a smooth product demo video',
    model: AI_VIDEO_GEN_DEFAULT_MODEL,
    duration: AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
    aspectRatio: '9:16',
    resolutionPreset: '1080p',
    inputGroups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
      { id: 'group-2', label: 'Group 2', order: 1 },
    ],
  };

  return node;
}

function createWorkflow(node: AINodeData, fileNodes: FileNodeData[], connections: Workflow['connections']): Workflow {
  const nodes: Workflow['nodes'] = {
    [node.id.value]: node,
  };

  fileNodes.forEach((fileNode) => {
    nodes[fileNode.id.value] = fileNode;
  });

  return {
    id: 'workflow-ai-video-gen-runtime',
    projectId: 'project-ai-video-gen-runtime',
    name: 'AI Video Gen Runtime Workflow',
    nodes,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: Object.keys(nodes).length,
      connectionCount: connections.length,
      lastNodeId: Math.max(...Object.keys(nodes).map((value) => Number.parseInt(value, 10))),
      canvasSize: {
        width: 1920,
        height: 1080,
      },
      relatedTasks: [],
      usedNodeIds: Object.keys(nodes),
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createConnectionInput(
  sourceNode: FileNodeData,
  targetNode: AINodeData,
  groupId: string,
  order: number,
): WorkflowConnectionInput {
  return {
    connection: {
      id: `connection-${groupId}-${order}`,
      type: 'file-reference',
      sourceId: sourceNode.id.value,
      targetId: '100',
      targetHandle: getAIVideoGenGroupInputHandle(groupId),
      order,
    },
    sourceNode,
    targetNode,
  };
}

test('aiVideoGen runtime validates prompt, model, duration and group bounds', () => {
  assert.equal(normalizeAIVideoGenPrompt('  hello  '), 'hello');
  assert.equal(normalizeAIVideoGenPrompt(undefined), '');
  assert.equal(normalizeAIVideoGenModel(AI_VIDEO_GEN_DEFAULT_MODEL), AI_VIDEO_GEN_DEFAULT_MODEL);
  assert.equal(normalizeAIVideoGenModel('veo-3.1'), 'veo-3.1-generate-preview');
  assert.equal(normalizeAIVideoGenDuration(AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS), AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS);
  assert.equal(normalizeAIVideoGenDuration(12), null);

  const missingPrompt = validateAIVideoGenExecutionInput({
    prompt: '   ',
    model: AI_VIDEO_GEN_DEFAULT_MODEL,
    duration: AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
    groups: [{ groupId: 'group-1', groupLabel: 'Group 1', inputCount: 1 }],
  });
  assert.ok(assertInvalid(missingPrompt).length > 0);

  const invalidModel = validateAIVideoGenExecutionInput({
    prompt: 'ok',
    model: 'veo-2',
    duration: AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
    groups: [{ groupId: 'group-1', groupLabel: 'Group 1', inputCount: 1 }],
  });
  assert.ok(assertInvalid(invalidModel).length > 0);

  const invalidDuration = validateAIVideoGenExecutionInput({
    prompt: 'ok',
    model: AI_VIDEO_GEN_DEFAULT_MODEL,
    duration: 5,
    groups: [{ groupId: 'group-1', groupLabel: 'Group 1', inputCount: 1 }],
  });
  assert.ok(assertInvalid(invalidDuration).length > 0);

  const overflowGroup = validateAIVideoGenExecutionInput({
    prompt: 'ok',
    model: AI_VIDEO_GEN_DEFAULT_MODEL,
    duration: AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
    groups: [{ groupId: 'group-1', groupLabel: 'Group 1', inputCount: 3 }],
  });
  assertInvalid(overflowGroup, /Group 1/);
});

test('aiVideoGen runtime definition uses laozhang-veo provider', () => {
  assert.equal(aiVideoGenExecution.mode, 'legacy-grouped-task');
  assert.equal(aiVideoGenExecution.taskType, 'video-gen');
  assert.equal(aiVideoGenExecution.provider, AI_VIDEO_GEN_PROVIDER);
});

test('aiVideoGen runtime only treats image references as executable inputs and preserves group order', () => {
  const node = createNode();
  const group1Image2 = createImageNode(2, 'file-2', 'image-2.png');
  const group1Image1 = createImageNode(1, 'file-1', 'image-1.png');
  const group2Video = createVideoNode(3, 'video-1', 'video-1.mp4');
  const group2Image = createImageNode(4, 'file-4', 'image-4.png');

  const connections = [
    {
      id: 'connection-group-1-1',
      type: 'file-reference' as const,
      sourceId: group1Image2.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-1'),
      order: 1,
    },
    {
      id: 'connection-group-1-0',
      type: 'file-reference' as const,
      sourceId: group1Image1.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-1'),
      order: 0,
    },
    {
      id: 'connection-group-2-video',
      type: 'file-reference' as const,
      sourceId: group2Video.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-2'),
      order: 0,
    },
    {
      id: 'connection-group-2-image',
      type: 'file-reference' as const,
      sourceId: group2Image.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-2'),
      order: 1,
    },
  ];

  const workflow = createWorkflow(node, [group1Image1, group1Image2, group2Video, group2Image], connections);
  const executableGroups = getAIVideoGenExecutableGroups({
    workflow,
    node,
    inputs: [],
  });

  assert.equal(executableGroups.length, 2);
  assert.deepEqual(executableGroups.map((group) => group.groupId), ['group-1', 'group-2']);
  assert.deepEqual(
    executableGroups[0]?.imageInputs.map((item) => item.fileId),
    ['file-1', 'file-2'],
  );
  assert.deepEqual(
    executableGroups[1]?.imageInputs.map((item) => item.fileId),
    ['file-4'],
  );
});

test('aiVideoGen runtime builds backend group plans with result handles and filtered config', () => {
  const node = createNode();
  const image1 = createImageNode(1, 'file-1', 'image-1.png');
  const image2 = createImageNode(2, 'file-2', 'image-2.png');
  const image3 = createImageNode(3, 'file-3', 'image-3.png');
  const connections = [
    {
      id: 'connection-group-1-0',
      type: 'file-reference' as const,
      sourceId: image1.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-1'),
      order: 0,
    },
    {
      id: 'connection-group-1-1',
      type: 'file-reference' as const,
      sourceId: image2.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-1'),
      order: 1,
    },
    {
      id: 'connection-group-2-0',
      type: 'file-reference' as const,
      sourceId: image3.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-2'),
      order: 0,
    },
  ];
  const workflow = createWorkflow(node, [image1, image2, image3], connections);
  const plans = buildAIVideoGenGroupPlans({
    workflow,
    node,
    inputs: [],
  });

  assert.equal(plans.length, 2);
  assert.deepEqual(
    plans.map((item) => ({
      groupId: item.groupId,
      groupLabel: item.groupLabel,
      order: item.order,
      outputHandle: item.outputHandle,
      files: item.plan.files,
      references: item.plan.references,
      prompt: item.plan.prompt,
    })),
    [
      {
        groupId: 'group-1',
        groupLabel: 'Group 1',
        order: 0,
        outputHandle: getAIVideoGenGroupOutputHandle('group-1'),
        files: ['file-1', 'file-2'],
        references: ['file-1', 'file-2'],
        prompt: 'Create a smooth product demo video',
      },
      {
        groupId: 'group-2',
        groupLabel: 'Group 2',
        order: 1,
        outputHandle: getAIVideoGenGroupOutputHandle('group-2'),
        files: ['file-3'],
        references: ['file-3'],
        prompt: 'Create a smooth product demo video',
      },
    ],
  );
  assert.equal(plans[0]?.plan.config.model, AI_VIDEO_GEN_DEFAULT_MODEL);
  assert.equal(plans[0]?.plan.config.duration, AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS);
  assert.equal(plans[0]?.plan.config.aspectRatio, '9:16');
  assert.equal(plans[0]?.plan.config.resolutionPreset, '1080p');
  assert.equal(plans[0]?.plan.config.size, '1080x1920');
  assert.deepEqual(plans[0]?.plan.config.inputGroups, [{ id: 'group-1', label: 'Group 1', order: 0 }]);
  assert.equal(plans[0]?.plan.config.camera, undefined);
  assert.equal(plans[0]?.plan.config.lighting, undefined);
});

test('aiVideoGen runtime defaults official video parameters when missing', () => {
  const node = createNode();
  node.config.aspectRatio = undefined;
  node.config.resolutionPreset = undefined;
  const image1 = createImageNode(1, 'file-1', 'image-1.png');
  const workflow = createWorkflow(node, [image1], [
    {
      id: 'connection-group-1-0',
      type: 'file-reference' as const,
      sourceId: image1.id.value,
      targetId: node.id.value,
      targetHandle: getAIVideoGenGroupInputHandle('group-1'),
      order: 0,
    },
  ]);

  const plans = buildAIVideoGenGroupPlans({
    workflow,
    node,
    inputs: [],
  });

  assert.equal(plans[0]?.plan.config.aspectRatio, AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO);
  assert.equal(plans[0]?.plan.config.resolutionPreset, AI_VIDEO_GEN_DEFAULT_RESOLUTION);
  assert.equal(plans[0]?.plan.config.size, '1280x720');
});

test('aiVideoGen runtime canRun blocks groups without image inputs or with too many inputs', () => {
  const node = createNode();
  const image1 = createImageNode(1, 'file-1', 'image-1.png');
  const image2 = createImageNode(2, 'file-2', 'image-2.png');
  const image3 = createImageNode(3, 'file-3', 'image-3.png');
  const image4 = createImageNode(4, 'file-4', 'image-4.png');

  const missingGroupInput = canRunAIVideoGen(node, [
    createConnectionInput(image1, node, 'group-1', 0),
    createConnectionInput(image2, node, 'group-1', 1),
  ]);
  assertInvalid(missingGroupInput, /Group 2/);

  const overflowGroup = canRunAIVideoGen(node, [
    createConnectionInput(image1, node, 'group-1', 0),
    createConnectionInput(image2, node, 'group-1', 1),
    createConnectionInput(image3, node, 'group-1', 2),
    createConnectionInput(image4, node, 'group-2', 0),
  ]);
  assertInvalid(overflowGroup, /Group 1/);
});
