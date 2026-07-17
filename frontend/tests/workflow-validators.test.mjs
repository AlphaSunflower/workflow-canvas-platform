import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkflowData } from '../dist-tests/src/utils/workflow/runtime.js';
import { validateNodeData, validateWorkflow } from '../dist-tests/src/utils/validators/index.js';
import { AI_IMAGE_INPAINT_GROUP_LABEL } from '../dist-tests/src/nodes/ai-image-inpaint/groups.js';

function createTimestamp() {
  return {
    created: 1,
    updated: 1,
  };
}

function createWorkflowBase() {
  return {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Validator Baseline',
    nodes: {},
    connections: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 0,
      canvasSize: {
        width: 20000,
        height: 20000,
      },
      usedNodeIds: [],
      releasedNodeIds: [],
    },
    timestamp: createTimestamp(),
  };
}

function createImageNode(id, fileId = `file-${id}`) {
  return {
    id: {
      value: String(id),
      display: `#${String(id).padStart(5, '0')}`,
    },
    type: 'image',
    position: {
      x: 0,
      y: 0,
    },
    dimensions: {
      width: 240,
      height: 160,
    },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: createTimestamp(),
    fileId,
    fileName: `${fileId}.png`,
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: `${fileId}.png`,
      localSource: {
        status: 'runtime-only',
      },
      importedAt: 1,
    },
    metadata: {
      width: 1024,
      height: 1024,
    },
  };
}

function createVideoNode(id, fileId = `video-${id}`) {
  return {
    id: {
      value: String(id),
      display: `#${String(id).padStart(5, '0')}`,
    },
    type: 'video',
    position: {
      x: 0,
      y: 0,
    },
    dimensions: {
      width: 240,
      height: 160,
    },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: createTimestamp(),
    fileId,
    fileName: `${fileId}.mp4`,
    fileSize: 2048,
    mimeType: 'video/mp4',
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: `${fileId}.mp4`,
      localSource: {
        status: 'runtime-only',
      },
      importedAt: 1,
    },
    metadata: {
      width: 1920,
      height: 1080,
      duration: 4,
    },
  };
}

function createAIImageGenNode(id, overrides = {}) {
  return {
    id: {
      value: String(id),
      display: `#${String(id).padStart(5, '0')}`,
    },
    type: 'aiImageGen',
    position: {
      x: 300,
      y: 100,
    },
    dimensions: {
      width: 320,
      height: 296,
    },
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
      model: 'stable-diffusion-xl',
      prompt: 'demo',
      negativePrompt: '',
      steps: 30,
      inputGroups: [
        {
          id: 'group-1',
          label: 'Group 1',
          order: 0,
        },
      ],
      ...overrides.config,
    },
    ...overrides,
  };
}

function createAIImageHdNode(id, overrides = {}) {
  return {
    id: {
      value: String(id),
      display: `#${String(id).padStart(5, '0')}`,
    },
    type: 'aiImageHd',
    position: {
      x: 300,
      y: 100,
    },
    dimensions: {
      width: 320,
      height: 296,
    },
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
      model: 'stable-diffusion-xl',
      steps: 20,
      inputGroups: [
        {
          id: 'group-1',
          label: 'Group 1',
          order: 0,
        },
      ],
      ...overrides.config,
    },
    ...overrides,
  };
}

function createAIFloorplanColorizeNode(id, overrides = {}) {
  return {
    id: {
      value: String(id),
      display: `#${String(id).padStart(5, '0')}`,
    },
    type: 'aiFloorplanColorize',
    position: {
      x: 300,
      y: 100,
    },
    dimensions: {
      width: 320,
      height: 296,
    },
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
      model: 'gemini-3-pro-image-preview',
      stylePreset: 'three-d-render',
      imageSize: '1K',
      aspectRatio: 'auto',
      inputGroups: [
        {
          id: 'group-1',
          label: 'Group 1',
          order: 0,
        },
      ],
      ...overrides.config,
    },
    ...overrides,
  };
}

function createAIImageInpaintNode(id, overrides = {}) {
  return {
    id: {
      value: String(id),
      display: `#${String(id).padStart(5, '0')}`,
    },
    type: 'aiImageInpaint',
    position: {
      x: 300,
      y: 100,
    },
    dimensions: {
      width: 360,
      height: 460,
    },
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
      model: 'gemini-3-pro-image-preview',
      prompt: 'replace the marked area',
      imageSize: '1K',
      aspectRatio: 'auto',
      maskMode: 'original-markup',
      hasMaskMarks: true,
      maskStrokes: [
        {
          id: 'stroke-1',
          tool: 'brush',
          brushSize: 24,
          points: [{ x: 10, y: 20 }],
        },
      ],
      editorHeight: 360,
      maskSourceFileId: 'inpaint-source',
      maskSourceWidth: 1024,
      maskSourceHeight: 1024,
      inputGroups: [
        {
          id: 'main',
          label: AI_IMAGE_INPAINT_GROUP_LABEL,
          order: 0,
        },
      ],
      ...overrides.config,
    },
    ...overrides,
  };
}

test('normalizeWorkflowData migrates legacy aiImageGen input and output handles', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1, 'legacy-input');
  const outputNode = createImageNode(3, 'legacy-output');
  const aiNode = createAIImageGenNode(2, {
    outputs: ['legacy-output'],
  });

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'legacy-input-connection',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'group-1',
      order: 0,
    },
    {
      id: 'legacy-output-connection',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-1',
      order: 0,
    },
  ];

  const normalized = normalizeWorkflowData(workflow);

  assert.equal(normalized.connections[0].targetHandle, 'group-1:images');
  assert.equal(normalized.connections[1].sourceHandle, 'group-1:result');
});

test('normalizeWorkflowData recreates legacy aiImageGen reference connections', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1, 'legacy-ref-file');
  const aiNode = createAIImageGenNode(2, {
    references: [
      {
        id: 'ref-1',
        nodeId: inputNode.id.value,
        fileId: 'legacy-ref-file',
        type: 'group',
        order: 0,
      },
    ],
  });

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
  };

  const normalized = normalizeWorkflowData(workflow);
  const generatedConnection = normalized.connections.find((connection) => connection.id.startsWith('legacy-ai-image-'));

  assert.ok(generatedConnection);
  assert.equal(generatedConnection.targetHandle, 'group-1:images');
});

test('validateWorkflow rejects invalid aiImageGen output handle after normalization', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1);
  const outputNode = createImageNode(3);
  const aiNode = createAIImageGenNode(2);

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'input-connection',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'group-1',
      order: 0,
    },
    {
      id: 'output-connection',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-999',
      order: 0,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, false);
  assert.match(result.message, /valid group handle/i);
});

test('validateWorkflow rejects non-file inputs into non-aiImageGen AI nodes', () => {
  const workflow = createWorkflowBase();
  const sourceAINode = createAIImageGenNode(1);
  const targetAINode = createAIImageHdNode(2);

  workflow.nodes = {
    [sourceAINode.id.value]: sourceAINode,
    [targetAINode.id.value]: targetAINode,
  };
  workflow.connections = [
    {
      id: 'ai-to-ai-connection',
      type: 'file-reference',
      sourceId: sourceAINode.id.value,
      targetId: targetAINode.id.value,
      targetHandle: 'group-1:image',
      order: 0,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, false);
  assert.match(result.message, /only allows file nodes/i);
});

test('validateNodeData rejects invalid grouped AI config numeric fields', () => {
  const node = createAIImageHdNode(1, {
    config: {
      model: 'stable-diffusion-xl',
      steps: -1,
      inputGroups: [
        {
          id: 'group-1',
          label: 'Group 1',
          order: 0,
        },
      ],
    },
  });

  const result = validateNodeData(node);

  assert.equal(result.valid, false);
  assert.match(result.message, /config\.steps/i);
});

test('validateNodeData rejects invalid AI outputs and tasks payloads', () => {
  const node = createAIImageGenNode(1, {
    outputs: ['file-1', 2],
    tasks: ['task-1', 3],
  });

  const result = validateNodeData(node);

  assert.equal(result.valid, false);
  assert.match(result.message, /outputs must contain strings only/i);
});

test('validateNodeData rejects node-output file nodes missing producer and task metadata', () => {
  const node = createImageNode(1, 'generated-file');
  node.source = {
    type: 'node-output',
    taskId: 'task-1',
    taskNo: 'TASK-20260403-000001',
    taskCreatedAt: 1,
  };

  const result = validateNodeData(node);

  assert.equal(result.valid, false);
  assert.match(result.message, /valid imported or node-output source/i);
});

test('validateWorkflow rejects invalid relatedTasks metadata', () => {
  const workflow = createWorkflowBase();
  const imageNode = createImageNode(1);

  workflow.nodes = {
    [imageNode.id.value]: imageNode,
  };
  workflow.metadata.relatedTasks = [
    {
      taskId: 'task-1',
      taskNo: 123,
      nodeId: '1',
      nodeDisplayId: '#00001',
      nodeType: 'aiImageGen',
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, false);
  assert.match(result.message, /relatedTasks/i);
});

test('validateWorkflow ignores latestSnapshot metadata in validator boundary', () => {
  const workflow = createWorkflowBase();
  workflow.metadata.latestSnapshot = {
    snapshotId: 'snapshot-1',
    savedAt: '100',
  };

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});

test('validateWorkflow rejects legacy relatedTaskIds metadata', () => {
  const workflow = createWorkflowBase();
  workflow.metadata.relatedTaskIds = ['task-1'];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, false);
  assert.match(result.message, /relatedTaskIds/i);
});

test('validateWorkflow accepts latestSnapshot and relatedTasks metadata in the new snapshot protocol', () => {
  const workflow = createWorkflowBase();
  const imageNode = createImageNode(1);

  workflow.nodes = {
    [imageNode.id.value]: imageNode,
  };
  workflow.metadata.latestSnapshot = {
    snapshotId: 'snapshot-1',
    savedAt: 100,
  };
  workflow.metadata.relatedTasks = [
    {
      taskId: 'task-1',
      taskNo: 'TASK-20260403-000001',
      batchId: 'batch-1',
      nodeId: '1',
      nodeDisplayId: '#00001',
      nodeType: 'image',
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});

test('validateWorkflow accepts normalized legacy aiImageGen workflow', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1, 'legacy-input');
  const outputNode = createImageNode(3, 'legacy-output');
  const aiNode = createAIImageGenNode(2);

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'legacy-input-connection',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'group-1',
      order: 0,
    },
    {
      id: 'legacy-output-connection',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-1',
      order: 0,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});

test('validateWorkflow accepts placeholder node file-reference inputs from valid file nodes', () => {
  const workflow = createWorkflowBase();
  const imageNode = createImageNode(1);
  const videoGenNode = {
    ...createAIImageHdNode(2),
    type: 'aiVideoGen',
    config: {
      model: 'runway-gen2',
      duration: 4,
      fps: 24,
      outputCount: 1,
      inputGroups: [],
    },
  };

  workflow.nodes = {
    [imageNode.id.value]: imageNode,
    [videoGenNode.id.value]: videoGenNode,
  };
  workflow.connections = [
    {
      id: 'video-gen-input',
      type: 'file-reference',
      sourceId: imageNode.id.value,
      targetId: videoGenNode.id.value,
      order: 0,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});

test('validateWorkflow rejects aiImageGen output links targeting non-image nodes', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1);
  const outputNode = createVideoNode(3);
  const aiNode = createAIImageGenNode(2);

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'input-connection',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'group-1',
      order: 0,
    },
    {
      id: 'output-connection',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-1:result',
      order: 0,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, false);
  assert.match(result.message, /must point to image nodes/i);
});

test('normalizeWorkflowData keeps only the latest aiImageInpaint source image connection', () => {
  const workflow = createWorkflowBase();
  const oldInputNode = createImageNode(1, 'old-source');
  const aiNode = createAIImageInpaintNode(2);
  const newInputNode = createImageNode(3, 'new-source');

  workflow.nodes = {
    [oldInputNode.id.value]: oldInputNode,
    [aiNode.id.value]: aiNode,
    [newInputNode.id.value]: newInputNode,
  };
  workflow.connections = [
    {
      id: 'old-input',
      type: 'file-reference',
      sourceId: oldInputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'legacy-handle',
      order: 0,
    },
    {
      id: 'new-input',
      type: 'file-reference',
      sourceId: newInputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'main:image',
      order: 1,
    },
  ];

  const normalized = normalizeWorkflowData(workflow);
  const inpaintInputs = normalized.connections.filter((connection) =>
    connection.type === 'file-reference' &&
    connection.targetId === aiNode.id.value
  );

  assert.equal(inpaintInputs.length, 1);
  assert.equal(inpaintInputs[0]?.id, 'new-input');
  assert.equal(inpaintInputs[0]?.sourceId, newInputNode.id.value);
  assert.equal(inpaintInputs[0]?.targetHandle, 'main:image');
});

test('normalizeWorkflowData preserves aiImageInpaint editor and mask stroke persistence fields', () => {
  const workflow = createWorkflowBase();
  const aiNode = createAIImageInpaintNode(2, {
    config: {
      editorHeight: 420,
      maskSourceFileId: 'source-file-1',
      maskSourceWidth: 1536,
      maskSourceHeight: 1024,
      maskStrokes: [
        {
          id: 'stroke-preserved',
          tool: 'brush',
          brushSize: 48,
          points: [
            { x: 100, y: 120 },
            { x: 160, y: 180 },
          ],
        },
      ],
    },
  });

  workflow.nodes = {
    [aiNode.id.value]: aiNode,
  };

  const normalized = normalizeWorkflowData(workflow);
  const normalizedNode = normalized.nodes[aiNode.id.value];

  assert.equal(normalizedNode.config.editorHeight, 420);
  assert.equal(normalizedNode.config.maskSourceFileId, 'source-file-1');
  assert.equal(normalizedNode.config.maskSourceWidth, 1536);
  assert.equal(normalizedNode.config.maskSourceHeight, 1024);
  assert.deepEqual(normalizedNode.config.maskStrokes, aiNode.config.maskStrokes);
});

test('validateWorkflow accepts aiImageInpaint single-image input and result output handles', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1, 'inpaint-source');
  const aiNode = createAIImageInpaintNode(2);
  const outputNode = createImageNode(3, 'inpaint-output');

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'inpaint-input',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'main:image',
      order: 0,
    },
    {
      id: 'inpaint-output',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'main:result',
      order: 1,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});

test('validateWorkflow rejects invalid aiImageInpaint source and output handles', () => {
  const workflow = createWorkflowBase();
  const videoNode = createVideoNode(1, 'inpaint-video');
  const aiNode = createAIImageInpaintNode(2);
  const outputNode = createVideoNode(3, 'inpaint-video-output');

  workflow.nodes = {
    [videoNode.id.value]: videoNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'invalid-inpaint-input',
      type: 'file-reference',
      sourceId: videoNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'main:image',
      order: 0,
    },
  ];

  const invalidInputResult = validateWorkflow(workflow);

  assert.equal(invalidInputResult.valid, false);
  assert.match(invalidInputResult.message, /can only connect one image node into AI image inpaint/i);

  workflow.connections = [
    {
      id: 'valid-inpaint-input',
      type: 'file-reference',
      sourceId: createImageNode(4).id.value,
      targetId: aiNode.id.value,
      targetHandle: 'main:image',
      order: 0,
    },
    {
      id: 'invalid-inpaint-output',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'wrong:result',
      order: 1,
    },
  ];
  workflow.nodes['4'] = createImageNode(4);

  const invalidOutputResult = validateWorkflow(workflow);

  assert.equal(invalidOutputResult.valid, false);
  assert.match(invalidOutputResult.message, /AI image inpaint outputs must point to image nodes/i);
});

test('validateNodeData rejects aiImageInpaint nodes without the fixed main group', () => {
  const node = createAIImageInpaintNode(1, {
    config: {
      inputGroups: [
        {
          id: 'group-1',
          label: 'Group 1',
          order: 0,
        },
      ],
    },
  });

  const result = validateNodeData(node);

  assert.equal(result.valid, false);
  assert.match(result.message, /fixed main group/i);
});

test('validateWorkflow keeps aiImageGen grouped input and output regression path valid', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1, 'gen-source');
  const aiNode = createAIImageGenNode(2);
  const outputNode = createImageNode(3, 'gen-output');

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'gen-input',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'group-1:images',
      order: 0,
    },
    {
      id: 'gen-output',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-1:result',
      order: 1,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});

test('validateWorkflow keeps aiImageHd grouped input and output regression path valid', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1, 'hd-source');
  const aiNode = createAIImageHdNode(2);
  const outputNode = createImageNode(3, 'hd-output');

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'hd-input',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'group-1:image',
      order: 0,
    },
    {
      id: 'hd-output',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-1:result',
      order: 1,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});

test('validateWorkflow keeps aiFloorplanColorize grouped input and output regression path valid', () => {
  const workflow = createWorkflowBase();
  const inputNode = createImageNode(1, 'floorplan-source');
  const aiNode = createAIFloorplanColorizeNode(2);
  const outputNode = createImageNode(3, 'floorplan-output');

  workflow.nodes = {
    [inputNode.id.value]: inputNode,
    [aiNode.id.value]: aiNode,
    [outputNode.id.value]: outputNode,
  };
  workflow.connections = [
    {
      id: 'floorplan-input',
      type: 'file-reference',
      sourceId: inputNode.id.value,
      targetId: aiNode.id.value,
      targetHandle: 'group-1:image',
      order: 0,
    },
    {
      id: 'floorplan-output',
      type: 'output-link',
      sourceId: aiNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-1:result',
      order: 1,
    },
  ];

  const result = validateWorkflow(workflow);

  assert.equal(result.valid, true);
});
