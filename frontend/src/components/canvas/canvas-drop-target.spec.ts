import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';

import type { AnyNodeData, AINodeData, FileNodeData } from '@/types';

import { createCanvasNodeSpatialIndex } from './canvas-node-spatial-index';
import { resolveCanvasDropTarget, screenPointToFlowPosition } from './canvas-hit-test';
import { clearCanvasActiveNodeStateSnapshot } from './canvas-active-node-state';

function createAiNode(
  id: string,
  overrides: Partial<Node<AINodeData>> = {},
  dataOverrides: Partial<AINodeData> = {},
): Node<AnyNodeData> {
  const now = Date.now();
  const data: AINodeData = {
    id: { value: id, display: `#${id}` },
    type: 'aiImageGen',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 220 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    references: [],
    outputs: [],
    config: {
      inputGroups: [{ id: 'group-1', label: 'Group 1', order: 0 }],
    },
    tasks: [],
    ...dataOverrides,
  };

  return {
    id,
    type: 'aiImageGen',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
    ...overrides,
  };
}

function createImageNode(
  id: string,
  overrides: Partial<Node<FileNodeData>> = {},
  dataOverrides: Partial<FileNodeData> = {},
): Node<AnyNodeData> {
  const now = Date.now();
  const data: FileNodeData = {
    id: { value: id, display: `#${id}` },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 120 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: `file-${id}`,
    fileName: `${id}.png`,
    fileSize: 1024,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: now },
    metadata: {},
    ...dataOverrides,
  };

  return {
    id,
    type: 'image',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
    ...overrides,
  };
}

test('drop target resolution stays accurate when a dragged node overlays the target node body', () => {
  clearCanvasActiveNodeStateSnapshot();
  const aiNode = createAiNode('ai-1', {
    position: { x: 10, y: 20 },
    zIndex: 4,
  }, {
    position: { x: 10, y: 20 },
    zIndex: 4,
  });
  const draggedFile = createImageNode('image-1', {
    position: { x: 10, y: 20 },
    zIndex: 10,
    selected: true,
  }, {
    position: { x: 10, y: 20 },
    zIndex: 10,
  });
  const index = createCanvasNodeSpatialIndex();
  index.rebuild([aiNode, draggedFile]);

  const bodyDropzone = createDropzoneElement({
    nodeId: 'ai-1',
    nodeDropzone: 'body',
    rect: { left: 100, top: 200, width: 320, height: 220 },
  });
  const slotDropzone = createDropzoneElement({
    nodeId: 'ai-1',
    nodeDropzone: 'group',
    groupId: 'slot|group-1|image',
    rect: { left: 150, top: 250, width: 100, height: 70 },
    parent: bodyDropzone,
  });
  const draggedNodeOverlay = createNonDropzoneElement(bodyDropzone);
  const canvasRoot = createCanvasRoot([bodyDropzone, slotDropzone, draggedNodeOverlay]);

  const resolution = resolveCanvasDropTarget({
    clientPosition: { x: 180, y: 280 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [aiNode, draggedFile],
    spatialIndex: index,
    containerBounds: { left: 100, top: 200 },
    canvasRoot,
    documentLike: createDocumentLike([draggedNodeOverlay, bodyDropzone]),
    excludedNodeIds: new Set(['image-1']),
  });

  assert.deepEqual(resolution?.dropTarget, {
    nodeId: 'ai-1',
    nodeType: 'group',
    groupId: 'slot|group-1|image',
  });
  assert.equal(resolution?.dropzone, slotDropzone);
});

test('drop target resolution ignores dropzones owned by dragged nodes', () => {
  clearCanvasActiveNodeStateSnapshot();
  const sourceNode = createAiNode('source-ai', {
    position: { x: 0, y: 0 },
    zIndex: 10,
  }, {
    position: { x: 0, y: 0 },
    zIndex: 10,
  });
  const index = createCanvasNodeSpatialIndex();
  index.rebuild([sourceNode]);

  const sourceDropzone = createDropzoneElement({
    nodeId: 'source-ai',
    nodeDropzone: 'body',
    rect: { left: 100, top: 200, width: 320, height: 220 },
  });
  const canvasRoot = createCanvasRoot([sourceDropzone]);

  const resolution = resolveCanvasDropTarget({
    clientPosition: { x: 180, y: 280 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [sourceNode],
    spatialIndex: index,
    containerBounds: { left: 100, top: 200 },
    canvasRoot,
    documentLike: createDocumentLike([sourceDropzone]),
    excludedNodeIds: new Set(['source-ai']),
  });

  assert.equal(resolution, null);
});

test('drop target resolution can hit a covered target after excluding dragged nodes', () => {
  clearCanvasActiveNodeStateSnapshot();
  const targetNode = createAiNode('target-ai', {
    position: { x: 0, y: 0 },
    zIndex: 1,
  }, {
    position: { x: 0, y: 0 },
    zIndex: 1,
  });
  const sourceNode = createAiNode('source-ai', {
    position: { x: 0, y: 0 },
    zIndex: 10,
  }, {
    position: { x: 0, y: 0 },
    zIndex: 10,
  });
  const index = createCanvasNodeSpatialIndex();
  index.rebuild([targetNode, sourceNode]);

  const sourceDropzone = createDropzoneElement({
    nodeId: 'source-ai',
    nodeDropzone: 'body',
    rect: { left: 100, top: 200, width: 320, height: 220 },
  });
  const targetDropzone = createDropzoneElement({
    nodeId: 'target-ai',
    nodeDropzone: 'body',
    rect: { left: 100, top: 200, width: 320, height: 220 },
  });
  const canvasRoot = createCanvasRoot([sourceDropzone, targetDropzone]);

  const resolution = resolveCanvasDropTarget({
    clientPosition: { x: 180, y: 280 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [targetNode, sourceNode],
    spatialIndex: index,
    containerBounds: { left: 100, top: 200 },
    canvasRoot,
    documentLike: createDocumentLike([sourceDropzone, targetDropzone]),
    excludedNodeIds: new Set(['source-ai']),
  });

  assert.deepEqual(resolution?.dropTarget, {
    nodeId: 'target-ai',
    nodeType: 'body',
  });
  assert.equal(resolution?.dropzone, targetDropzone);
});

test('drop target resolution is consistent between single-node drag and multi-selection drag previews', () => {
  clearCanvasActiveNodeStateSnapshot();
  const aiNode = createAiNode('ai-1', {
    position: { x: 10, y: 20 },
  }, {
    position: { x: 10, y: 20 },
  });
  const draggedFileA = createImageNode('image-1', {
    position: { x: 10, y: 20 },
    zIndex: 10,
  }, {
    position: { x: 10, y: 20 },
    zIndex: 10,
  });
  const draggedFileB = createImageNode('image-2', {
    position: { x: 20, y: 30 },
    zIndex: 11,
  }, {
    position: { x: 20, y: 30 },
    zIndex: 11,
  });
  const index = createCanvasNodeSpatialIndex();
  index.rebuild([aiNode, draggedFileA, draggedFileB]);

  const bodyDropzone = createDropzoneElement({
    nodeId: 'ai-1',
    nodeDropzone: 'body',
    rect: { left: 100, top: 200, width: 320, height: 220 },
  });
  const slotDropzone = createDropzoneElement({
    nodeId: 'ai-1',
    nodeDropzone: 'group',
    groupId: 'slot|group-1|image',
    rect: { left: 150, top: 250, width: 100, height: 70 },
    parent: bodyDropzone,
  });
  const singlePreviewOverlay = createNonDropzoneElement(bodyDropzone);
  const multiPreviewOverlay = createNonDropzoneElement(bodyDropzone);
  const canvasRoot = createCanvasRoot([bodyDropzone, slotDropzone, singlePreviewOverlay, multiPreviewOverlay]);

  const singleResolution = resolveCanvasDropTarget({
    clientPosition: { x: 180, y: 280 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [aiNode, draggedFileA, draggedFileB],
    spatialIndex: index,
    containerBounds: { left: 100, top: 200 },
    canvasRoot,
    documentLike: createDocumentLike([singlePreviewOverlay, bodyDropzone]),
    excludedNodeIds: new Set(['image-1']),
  });
  const multiResolution = resolveCanvasDropTarget({
    clientPosition: { x: 180, y: 280 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [aiNode, draggedFileA, draggedFileB],
    spatialIndex: index,
    containerBounds: { left: 100, top: 200 },
    canvasRoot,
    documentLike: createDocumentLike([multiPreviewOverlay, bodyDropzone]),
    excludedNodeIds: new Set(['image-1', 'image-2']),
  });

  assert.deepEqual(singleResolution?.dropTarget, multiResolution?.dropTarget);
  assert.equal(singleResolution?.dropzone, slotDropzone);
  assert.equal(multiResolution?.dropzone, slotDropzone);
});

test('file drop flow position remains stable under overlay-only DOM hits', () => {
  clearCanvasActiveNodeStateSnapshot();
  const clientPosition = { x: 360, y: 240 };
  const viewport = { x: 40, y: 30, zoom: 2 };
  const containerBounds = { left: 120, top: 50 };

  assert.deepEqual(
    screenPointToFlowPosition(clientPosition, viewport, containerBounds),
    { x: 100, y: 80 },
  );
});

interface StubRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface StubElementLike {
  dataset: DOMStringMap;
  parentElement: StubElementLike | null;
  closest: <T extends Element = Element>(selector: string) => T | null;
  getBoundingClientRect: () => DOMRect;
}

function createDropzoneElement(options: {
  nodeId: string;
  nodeDropzone: 'body' | 'group';
  groupId?: string;
  rect: StubRect;
  parent?: StubElementLike | null;
}): StubElementLike {
  return createStubElement({
    dataset: {
      nodeId: options.nodeId,
      nodeDropzone: options.nodeDropzone,
      groupId: options.groupId,
    },
    rect: options.rect,
    parent: options.parent ?? null,
  });
}

function createNonDropzoneElement(parent?: StubElementLike | null): StubElementLike {
  return createStubElement({
    dataset: {},
    rect: { left: 0, top: 0, width: 0, height: 0 },
    parent: parent ?? null,
  });
}

function createStubElement(options: {
  dataset: Record<string, string | undefined>;
  rect: StubRect;
  parent: StubElementLike | null;
}): StubElementLike {
  const element: StubElementLike = {
    dataset: Object.assign(Object.create(null), options.dataset) as DOMStringMap,
    parentElement: options.parent,
    closest: <T extends Element = Element>(selector: string): T | null => {
      if (selector !== '[data-node-dropzone]') {
        return null;
      }

      let current: StubElementLike | null = element;
      while (current) {
        if (current.dataset.nodeDropzone) {
          return current as unknown as T;
        }
        current = current.parentElement;
      }

      return null;
    },
    getBoundingClientRect: (): DOMRect => ({
      x: options.rect.left,
      y: options.rect.top,
      left: options.rect.left,
      top: options.rect.top,
      width: options.rect.width,
      height: options.rect.height,
      right: options.rect.left + options.rect.width,
      bottom: options.rect.top + options.rect.height,
      toJSON: () => '',
    } as DOMRect),
  };

  return element;
}

function createCanvasRoot(elements: StubElementLike[]): ParentNode {
  const root = {
    contains(this: ParentNode, node: Node | null): boolean {
      if (this !== root) {
        throw new TypeError('Illegal invocation');
      }

      return elements.includes(node as unknown as StubElementLike);
    },
    querySelectorAll: <T extends Element = Element>(selector: string): NodeListOf<T> => {
      const match = selector.match(/^\[data-node-dropzone\]\[data-node-id="(.+)"\]$/);
      if (!match) {
        return [] as unknown as NodeListOf<T>;
      }

      const nodeId = match[1]?.replace(/\\"/g, '"').replace(/\\\\/g, '\\') ?? '';
      const matches = elements.filter((element) => element.dataset.nodeId === nodeId);
      return matches as unknown as NodeListOf<T>;
    },
  };

  return root as ParentNode;
}

function createDocumentLike(elements: StubElementLike[]): Pick<Document, 'elementFromPoint'> & Partial<Pick<Document, 'elementsFromPoint'>> {
  return {
    elementFromPoint: () => elements[0] as unknown as Element,
    elementsFromPoint: () => elements as unknown as Element[],
  };
}
