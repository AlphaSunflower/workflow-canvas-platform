import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, AnyNodeData, Connection, FileNodeData, StoryboardShotData, Workflow } from '@/types';
import { getDefaultAIConfig } from '@/utils/node';
import {
  getNodeInputGroupsFromConnections,
  toWorkflowResolvedNodeGroupStates,
} from '../shared/group-query';
import {
  AI_STORYBOARD_DEFAULT_SIZE,
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_MIN_HEIGHT,
  AI_STORYBOARD_MIN_WIDTH,
  AI_STORYBOARD_RESULT_PORT_ID,
} from './constants';
import { aiStoryboardDrop, aiStoryboardDropConfig } from './drop';
import { normalizeDraggedImageNodes } from '../shared/drop-config-builder';
import {
  resolveAIStoryboardInputGroups,
  validateAIStoryboardConnection,
} from './groups';
import { resolveStoryboardInputImages } from './input-resolver';
import { resolveStoryboardGeneratedImagePreviewUrl } from './preview';
import type { StoryboardLocalState } from './types';
import { getStoryboardShotDefaults } from './types';
import { mergeStoryboardShotsFromInputs } from './shot-sync';

const defaults = getStoryboardShotDefaults(undefined);

function createStoryboardNode(overrides?: Partial<AINodeData>): AINodeData {
  return {
    id: {
      value: 'storyboard-node-1',
      display: '#storyboard-node-1',
    },
    type: 'aiStoryboard',
    position: { x: 120, y: 80 },
    dimensions: { ...AI_STORYBOARD_DEFAULT_SIZE },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: {
      created: 1,
      updated: 1,
    },
    references: [],
    outputs: [],
    config: getDefaultAIConfig('aiStoryboard'),
    tasks: [],
    ...overrides,
  };
}

function createStoryboardConfigWithoutInputGroups(): NonNullable<AINodeData['config']> {
  const config = { ...getDefaultAIConfig('aiStoryboard') };
  delete config.inputGroups;
  return config;
}

function createImageNode(id: string): FileNodeData {
  return {
    id: {
      value: id,
      display: `#${id}`,
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: {
      created: 1,
      updated: 1,
    },
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

function createVideoNode(id: string): FileNodeData {
  return {
    id: {
      value: id,
      display: `#${id}`,
    },
    type: 'video',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: {
      created: 1,
      updated: 1,
    },
    fileId: `file-${id}`,
    fileName: `${id}.mp4`,
    fileSize: 2048,
    mimeType: 'video/mp4',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 1,
    },
    metadata: {
      width: 1920,
      height: 1080,
      duration: 8,
    },
  };
}

function createStoryboardShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'storyboard-shot-file-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    sourceNodeId: 'node-image-1',
    sourceFileId: 'file-1',
    sourceImageFileId: 'file-1',
    imageFileId: undefined,
    videoFileId: undefined,
    prompt: '',
    imageModel: defaults.defaultImageModel,
    imageAspectRatio: defaults.defaultImageAspectRatio,
    imageSize: defaults.defaultImageSize,
    videoModel: defaults.defaultVideoModel,
    videoDuration: defaults.defaultVideoDuration,
    videoAspectRatio: defaults.defaultVideoAspectRatio,
    videoResolution: defaults.defaultVideoResolution,
    imageGenStatus: 'idle',
    imageGenMessage: undefined,
    imageGenRunId: undefined,
    videoGenStatus: 'idle',
    videoProgress: undefined,
    videoError: undefined,
    videoRunId: undefined,
    ...overrides,
  };
}

test('storyboard workspace keeps compact controller default and minimum size baseline', () => {
  assert.deepEqual(AI_STORYBOARD_DEFAULT_SIZE, {
    width: 920,
    height: 212,
  });
  assert.equal(AI_STORYBOARD_MIN_WIDTH, 760);
  assert.equal(AI_STORYBOARD_MIN_HEIGHT, 200);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.width > AI_STORYBOARD_MIN_WIDTH, true);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.height > AI_STORYBOARD_MIN_HEIGHT, true);
});

test('storyboard input group resolver falls back to the default single group', () => {
  const node = createStoryboardNode({
    config: createStoryboardConfigWithoutInputGroups(),
  });

  const groups = resolveAIStoryboardInputGroups(node);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.id, 'group-1');
  assert.deepEqual(groups[0]?.ports.map((port) => port.id), [
    AI_STORYBOARD_INPUT_PORT_ID,
    AI_STORYBOARD_RESULT_PORT_ID,
  ]);
});

test('storyboard panel drop resolves to the only slot during normal drag', () => {
  const node = createStoryboardNode({
    config: createStoryboardConfigWithoutInputGroups(),
  });
  const workflow: Workflow = {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Storyboard Test Workflow',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: {
        width: 1920,
        height: 1080,
      },
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
    version: 1,
  };

  const normalTarget = aiStoryboardDropConfig.resolveDropTarget?.({
    workflow,
    target: {
      nodeId: node.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [],
    keyboard: {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    },
  }, 'normal');

  const ctrlTarget = aiStoryboardDropConfig.resolveDropTarget?.({
    workflow,
    target: {
      nodeId: node.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [],
    keyboard: {
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
    },
  }, 'ctrl');

  assert.deepEqual(normalTarget, {
    kind: 'slot',
    groupId: 'group-1',
    portId: AI_STORYBOARD_INPUT_PORT_ID,
  });
  assert.deepEqual(ctrlTarget, {
    kind: 'panel',
    side: 'input',
  });
});

test('storyboard body drop resolves to the input target for full-node image drops', () => {
  const node = createStoryboardNode();
  const workflow: Workflow = {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Storyboard Test Workflow',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: {
        width: 1920,
        height: 1080,
      },
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
    version: 1,
  };

  const normalTarget = aiStoryboardDropConfig.resolveDropTarget?.({
    workflow,
    target: {
      nodeId: node.id.value,
      nodeType: 'body',
    },
    draggedNodes: [],
    keyboard: {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    },
  }, 'normal');

  assert.deepEqual(normalTarget, {
    kind: 'slot',
    groupId: 'group-1',
    portId: AI_STORYBOARD_INPUT_PORT_ID,
  });
});

test('storyboard hidden slot drop target keeps the image input target semantics', () => {
  const node = createStoryboardNode();
  const workflow: Workflow = {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Storyboard Test Workflow',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: {
        width: 1920,
        height: 1080,
      },
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
    version: 1,
  };

  const normalTarget = aiStoryboardDropConfig.resolveDropTarget?.({
    workflow,
    target: {
      nodeId: node.id.value,
      nodeType: 'group',
      groupId: `slot|group-1|${AI_STORYBOARD_INPUT_PORT_ID}`,
    },
    draggedNodes: [],
    keyboard: {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    },
  }, 'normal');

  assert.deepEqual(normalTarget, {
    kind: 'slot',
    groupId: 'group-1',
    portId: AI_STORYBOARD_INPUT_PORT_ID,
  });
});

test('storyboard manual image connection resolves into input images and initial shots', () => {
  const node = createStoryboardNode();
  const imageNode = createImageNode('image-node-1');
  const targetHandle = `group-1:${AI_STORYBOARD_INPUT_PORT_ID}`;
  const groups = resolveAIStoryboardInputGroups(node);
  const validation = validateAIStoryboardConnection({
    sourceNode: imageNode,
    targetNode: node,
    sourceHandle: undefined,
    targetHandle,
    existingInputs: [],
  });

  assert.equal(validation.valid, true);

  const connections: Connection[] = [{
    id: 'connection-1',
    type: 'file-reference',
    sourceId: imageNode.id.value,
    targetId: node.id.value,
    targetHandle,
    order: 0,
  }];
  const nodeMap = new Map<string, AnyNodeData>([
    [node.id.value, node],
    [imageNode.id.value, imageNode],
  ]);
  const resolvedGroups = toWorkflowResolvedNodeGroupStates(
    getNodeInputGroupsFromConnections(node, groups, connections, nodeMap),
  );
  const resolvedImages = resolveStoryboardInputImages(resolvedGroups);

  assert.equal(resolvedImages.length, 1);
  assert.equal(resolvedImages[0]?.sourceNodeId, imageNode.id.value);

  const nextState = mergeStoryboardShotsFromInputs({
    shots: [],
    processedInputFileIds: [],
  }, resolvedImages, defaults);

  assert.equal(nextState.shots.length, 1);
  assert.equal(nextState.shots[0]?.sourceNodeId, imageNode.id.value);
  assert.equal(nextState.shots[0]?.sourceImageFileId, imageNode.fileId);
  assert.equal(nextState.shots[0]?.imageFileId, undefined);
});

test('storyboard rejects manual video connections on the image input handle', () => {
  const node = createStoryboardNode();
  const videoNode = createVideoNode('video-node-1');
  const targetHandle = `group-1:${AI_STORYBOARD_INPUT_PORT_ID}`;

  const validation = validateAIStoryboardConnection({
    sourceNode: videoNode,
    targetNode: node,
    sourceHandle: undefined,
    targetHandle,
    existingInputs: [],
  });

  assert.equal(validation.valid, false);
});

test('storyboard drop only accepts image nodes', () => {
  const imageNode = createImageNode('image-node-1');
  const videoNode = createVideoNode('video-node-1');

  assert.equal(aiStoryboardDrop.acceptDraggedNodes([imageNode]), true);
  assert.equal(aiStoryboardDrop.acceptDraggedNodes([videoNode]), false);
  assert.equal(aiStoryboardDrop.acceptDraggedNodes([imageNode, videoNode]), false);
});

test('storyboard drop reuses shared image normalization and preserves canvas-order semantics', () => {
  const lowerRight = {
    ...createImageNode('image-node-1'),
    position: { x: 120, y: 200 },
  };
  const sameRowLeft = {
    ...createImageNode('image-node-2'),
    position: { x: 40, y: 200 },
  };
  const upperNode = {
    ...createImageNode('image-node-3'),
    position: { x: 80, y: 60 },
  };
  const ignoredVideo = {
    ...createVideoNode('video-node-1'),
    position: { x: 0, y: 0 },
  };

  assert.equal(aiStoryboardDropConfig.normalizeDraggedNodes, normalizeDraggedImageNodes);
  assert.deepEqual(
    aiStoryboardDropConfig.normalizeDraggedNodes([lowerRight, ignoredVideo, sameRowLeft, upperNode])
      .map((node) => node.id.value),
    ['image-node-3', 'image-node-2', 'image-node-1'],
  );
});

test('storyboard resolved inputs ignore non-image nodes connected to the image input handle', () => {
  const node = createStoryboardNode();
  const imageNode = createImageNode('image-node-1');
  const videoNode = createVideoNode('video-node-1');
  const targetHandle = `group-1:${AI_STORYBOARD_INPUT_PORT_ID}`;
  const groups = resolveAIStoryboardInputGroups(node);
  const connections: Connection[] = [
    {
      id: 'connection-video',
      type: 'file-reference',
      sourceId: videoNode.id.value,
      targetId: node.id.value,
      targetHandle,
      order: 0,
    },
    {
      id: 'connection-image',
      type: 'file-reference',
      sourceId: imageNode.id.value,
      targetId: node.id.value,
      targetHandle,
      order: 1,
    },
  ];
  const nodeMap = new Map<string, AnyNodeData>([
    [node.id.value, node],
    [imageNode.id.value, imageNode],
    [videoNode.id.value, videoNode],
  ]);
  const resolvedGroups = toWorkflowResolvedNodeGroupStates(
    getNodeInputGroupsFromConnections(node, groups, connections, nodeMap),
  );
  const inputPort = resolvedGroups[0]?.ports.find((port) => port.portId === AI_STORYBOARD_INPUT_PORT_ID);
  const resolvedImages = resolveStoryboardInputImages(resolvedGroups);

  assert.deepEqual(
    inputPort?.inputs.map((input) => input.sourceNode.id.value),
    [imageNode.id.value],
  );
  assert.equal(resolvedImages.length, 1);
  assert.equal(resolvedImages[0]?.sourceNodeId, imageNode.id.value);
});

test('storyboard preview url is only built for generated backend image files', () => {
  assert.equal(resolveStoryboardGeneratedImagePreviewUrl({
    imageFileId: undefined,
  }), undefined);

  assert.equal(resolveStoryboardGeneratedImagePreviewUrl({
    imageFileId: 'backend-image-1',
  }), '/api/v1/files/backend-image-1/preview');
});

test('storyboard shot sync appends new input images and tracks processed ids without duplicating existing shots', () => {
  const currentState: StoryboardLocalState = {
    shots: [],
    processedInputFileIds: [],
  };

  const once = mergeStoryboardShotsFromInputs(currentState, [
    {
      sourceNodeId: 'node-image-1',
      sourceFileId: 'file-1',
      sourceImageFileId: 'file-1',
      sourceNode: {} as never,
      fileName: 'image-1.png',
      promptHint: '镜头一',
      order: 0,
    },
    {
      sourceNodeId: 'node-image-2',
      sourceFileId: 'file-2',
      sourceImageFileId: 'file-2',
      sourceNode: {} as never,
      fileName: 'image-2.png',
      promptHint: '镜头二',
      order: 1,
    },
  ], defaults);

  assert.equal(once.shots.length, 2);
  assert.deepEqual(once.processedInputFileIds, ['file-1', 'file-2']);
  assert.equal(once.shots[0]?.prompt, '镜头一');
  assert.equal(once.shots[1]?.prompt, '镜头二');

  const twice = mergeStoryboardShotsFromInputs(once, [
    {
      sourceNodeId: 'node-image-1',
      sourceFileId: 'file-1',
      sourceImageFileId: 'file-1',
      sourceNode: {} as never,
      fileName: 'image-1.png',
      promptHint: '不会重复',
      order: 0,
    },
    {
      sourceNodeId: 'node-image-3',
      sourceFileId: 'file-3',
      sourceImageFileId: 'file-3',
      sourceNode: {} as never,
      fileName: 'image-3.png',
      promptHint: '镜头三',
      order: 2,
    },
  ], defaults);

  assert.equal(twice.shots.length, 3);
  assert.deepEqual(twice.processedInputFileIds, ['file-1', 'file-2', 'file-3']);
  assert.equal(twice.shots[2]?.prompt, '镜头三');
  assert.deepEqual(twice.shots.map((shot) => shot.id), [
    'storyboard-shot-file-1',
    'storyboard-shot-file-2',
    'storyboard-shot-file-3',
  ]);
});

test('storyboard input sync uses source file ids as processed input keys', () => {
  const nextState = mergeStoryboardShotsFromInputs({
    shots: [
      createStoryboardShot({
        id: 'storyboard-shot-backend-file-1',
        sourceFileId: 'local-file-1',
        sourceImageFileId: 'backend-file-1',
      }),
    ],
    processedInputFileIds: ['local-file-1'],
  }, [
    {
      sourceNodeId: 'node-image-1',
      sourceFileId: 'local-file-1',
      sourceImageFileId: 'backend-file-1',
      sourceNode: {} as never,
      fileName: 'image-1.png',
      promptHint: 'should not duplicate',
      order: 0,
    },
  ], defaults);

  assert.equal(nextState.shots.length, 1);
  assert.deepEqual(nextState.processedInputFileIds, ['local-file-1']);
});

test('storyboard input sync repairs rolled-back processed ids without duplicating shots', () => {
  const nextState = mergeStoryboardShotsFromInputs({
    shots: [
      createStoryboardShot({
        id: 'storyboard-shot-local-file-1',
        sourceFileId: 'local-file-1',
        sourceImageFileId: undefined,
      }),
    ],
    processedInputFileIds: [],
  }, [
    {
      sourceNodeId: 'node-image-1',
      sourceFileId: 'local-file-1',
      sourceImageFileId: 'backend-file-1',
      sourceNode: {} as never,
      fileName: 'image-1.png',
      promptHint: 'should not duplicate after task patch',
      order: 0,
    },
  ], defaults);

  assert.equal(nextState.shots.length, 1);
  assert.deepEqual(nextState.processedInputFileIds, ['local-file-1']);
  assert.equal(nextState.shots[0]?.id, 'storyboard-shot-local-file-1');
});
