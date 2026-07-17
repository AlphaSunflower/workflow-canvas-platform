import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areImageNodePropsEqual,
  arePlyNodePropsEqual,
  areVideoNodePropsEqual,
} from '../dist-tests/src/components/node/file/file-node-equality.js';

function createNodeProps(overrides = {}) {
  const dataOverrides = overrides.data ?? {};

  return {
    id: 'node-1',
    type: 'image',
    selected: false,
    dragging: false,
    data: {
      id: {
        value: 'node-1',
        display: '#00001',
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
      zIndex: 1,
      timestamp: {
        created: 1,
        updated: 1,
      },
      annotation: 'demo',
      fileId: 'file-1',
      fileName: 'demo.png',
      fileSize: 1024,
      mimeType: 'image/png',
      source: {
        type: 'imported',
        importMethod: 'local',
        sourceDisplayName: 'demo.png',
        localSource: {
          status: 'runtime-only',
        },
        importedAt: 1,
      },
      thumbnailUrl: 'blob:thumb',
      previewUrl: undefined,
      metadata: {
        width: 1600,
        height: 1200,
        duration: undefined,
      },
      imageAsset: {
        assetId: 'file-1',
        source: 'local',
        version: 1,
        intrinsicSize: {
          width: 1600,
          height: 1200,
        },
        variants: {
          thumbnail: {
            url: 'blob:thumb',
          },
          original: {
            url: 'blob:original',
          },
        },
      },
      ...dataOverrides,
    },
    ...overrides,
  };
}

test('areImageNodePropsEqual ignores timestamp-only updates', () => {
  const previous = createNodeProps();
  const next = createNodeProps({
    data: {
      ...previous.data,
      timestamp: {
        created: 1,
        updated: 999,
      },
    },
  });

  assert.equal(areImageNodePropsEqual(previous, next), true);
});

test('areImageNodePropsEqual detects image asset version and original variant changes', () => {
  const previous = createNodeProps();
  const next = createNodeProps({
    data: {
      ...previous.data,
      imageAsset: {
        ...previous.data.imageAsset,
        version: 2,
        variants: {
          ...previous.data.imageAsset.variants,
          original: {
            url: 'blob:original-v2',
          },
        },
      },
    },
  });

  assert.equal(areImageNodePropsEqual(previous, next), false);
});

test('areImageNodePropsEqual detects file source changes', () => {
  const previous = createNodeProps();
  const next = createNodeProps({
    data: {
      ...previous.data,
      source: {
        ...previous.data.source,
        sourceDisplayName: 'renamed-demo.png',
      },
    },
  });

  assert.equal(areImageNodePropsEqual(previous, next), false);
});

test('areImageNodePropsEqual detects node-output task metadata changes', () => {
  const previous = createNodeProps({
    data: {
      ...createNodeProps().data,
      source: {
        type: 'node-output',
        producerNodeId: '2',
        producerNodeDisplayId: '#00002',
        producerNodeType: 'aiImageGen',
        taskId: 'task-1',
        taskNo: 'TASK-20260403-000001',
        taskCreatedAt: 10,
        taskStartedAt: 20,
        taskCompletedAt: 30,
      },
    },
  });
  const next = createNodeProps({
    data: {
      ...previous.data,
      source: {
        ...previous.data.source,
        taskCompletedAt: 31,
      },
    },
  });

  assert.equal(areImageNodePropsEqual(previous, next), false);
});

test('video and ply comparators ignore imageAsset changes but react to preview changes', () => {
  const previous = createNodeProps({
    data: {
      ...createNodeProps().data,
      type: 'video',
      mimeType: 'video/mp4',
    },
  });

  const imageAssetOnlyNext = createNodeProps({
    data: {
      ...previous.data,
      imageAsset: {
        ...previous.data.imageAsset,
        version: 8,
      },
    },
  });
  const previewChangedNext = createNodeProps({
    data: {
      ...previous.data,
      previewUrl: 'blob:preview-v2',
    },
  });

  assert.equal(areVideoNodePropsEqual(previous, imageAssetOnlyNext), true);
  assert.equal(arePlyNodePropsEqual(previous, imageAssetOnlyNext), true);
  assert.equal(areVideoNodePropsEqual(previous, previewChangedNext), false);
  assert.equal(arePlyNodePropsEqual(previous, previewChangedNext), false);
});
