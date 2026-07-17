import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import type { FileNodeData } from '@/types';
import { buildFileNodeMediaLayoutPatch } from '@/utils';
import { buildContextMenuItems } from '@/components/canvas/context-menu/builders';
import type { BuildContextMenuItemsOptions } from '@/components/canvas/context-menu/builders';
import { FileNodeExportButton } from './FileNodeExportButton';
import {
  clearFileNodeLayoutRuntimeSnapshots,
  consumeFileNodeLayoutRuntimeSnapshots,
  getFileNodeLayoutRuntimeSnapshot,
  getFileNodeLayoutRuntimeSnapshotCount,
  setFileNodeLayoutRuntimeSnapshot,
} from './file-node-layout-runtime-store';
import { shouldMountFileNodeActionLayer } from './constants';

function createFileNodeData(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: '501',
      display: '#00501',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'file-501',
    fileName: 'preview.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 512,
      height: 512,
    },
    ...overrides,
  };
}

function createContextMenuOptions(): BuildContextMenuItemsOptions {
  return {
    target: {
      kind: 'node',
      nodeId: '501',
      nodeType: 'image',
      nodeData: createFileNodeData(),
    },
    aiNodeDefinitions: [],
    handlers: {
      onImportFiles: () => undefined,
      onCreateNode: () => undefined,
      onDeleteNode: () => undefined,
      onOpenFileProperties: () => undefined,
      onExportFileNode: () => undefined,
      onSplitImageNode: () => undefined,
    },
  };
}

test('FileNodeExportButton renders save action by default', () => {
  const markup = renderToStaticMarkup(
    <FileNodeExportButton
      isExporting={false}
      onExport={() => undefined}
    />
  );

  assert.ok(markup.includes('file-node__save-button'));
  assert.ok(markup.includes('title="保存"'));
});

test('FileNodeExportButton renders disabled state while exporting', () => {
  const markup = renderToStaticMarkup(
    <FileNodeExportButton
      isExporting={true}
      onExport={() => undefined}
    />
  );

  assert.ok(markup.includes('title="保存中"'));
  assert.ok(markup.includes('disabled'));
});

test('file node context menu includes save action', () => {
  const items = buildContextMenuItems(createContextMenuOptions());
  const saveItem = items.find((item) => item.id === 'save-file-node');

  assert.ok(saveItem);
  assert.equal(saveItem?.label, '保存到目录');
});

test('file node context menu save action forces directory picker', () => {
  let invoked = false;
  let receivedNodeId = '';
  let receivedForcePicker = false;

  const options = createContextMenuOptions();
  options.handlers.onExportFileNode = (nodeId, exportOptions) => {
    invoked = true;
    receivedNodeId = nodeId;
    receivedForcePicker = Boolean(exportOptions?.forceDirectoryPicker);
  };

  const items = buildContextMenuItems(options);
  const saveItem = items.find((item) => item.id === 'save-file-node');

  assert.ok(saveItem?.onClick);
  saveItem?.onClick?.();

  assert.equal(invoked, true);
  assert.equal(receivedNodeId, '501');
  assert.equal(receivedForcePicker, true);
});

test('image node context menu includes grid split presets', () => {
  const items = buildContextMenuItems(createContextMenuOptions());
  const splitItem = items.find((item) => item.id === 'split-image-node');

  assert.ok(splitItem);
  assert.equal(splitItem?.label, '拆分图片');
  assert.deepEqual(
    splitItem?.children?.map((item) => item.id),
    [
      'split-image-node-2x2',
      'split-image-node-3x3',
      'split-image-node-4x4',
      'split-image-node-custom',
    ],
  );
});

test('image node context menu grid split preset invokes handler', () => {
  let receivedNodeId = '';
  let receivedGrid: unknown = null;
  const options = createContextMenuOptions();
  options.handlers.onSplitImageNode = (nodeId, grid) => {
    receivedNodeId = nodeId;
    receivedGrid = grid;
  };

  const items = buildContextMenuItems(options);
  const splitItem = items.find((item) => item.id === 'split-image-node');
  const presetItem = splitItem?.children?.find((item) => item.id === 'split-image-node-3x3');

  assert.ok(presetItem?.onClick);
  presetItem?.onClick?.();

  assert.equal(receivedNodeId, '501');
  assert.deepEqual(receivedGrid, { kind: 'preset', rows: 3, cols: 3 });
});

test('buildMediaLayoutPatch updates image layout fields without touching preview state', () => {
  const node = createFileNodeData({
    metadata: {},
    thumbnailUrl: 'blob:thumb',
    imageAsset: {
      assetId: 'file-501',
      source: 'local',
      version: 2,
      variants: {
        thumbnail: { url: 'blob:thumb' },
        original: { url: 'blob:original-501' },
      },
    },
  });

  const patch = buildFileNodeMediaLayoutPatch(node, 1600, 900);

  assert.ok(patch);
  assert.ok(patch?.dimensions);
  assert.equal(patch?.metadata?.width, 1600);
  assert.equal(patch?.metadata?.height, 900);
  assert.equal('previewUrl' in (patch ?? {}), false);
  assert.equal('thumbnailUrl' in (patch ?? {}), false);
  assert.equal('imageAsset' in (patch ?? {}), false);
});

test('buildMediaLayoutPatch keeps image layout on authoritative metadata instead of thumbnail load size', () => {
  const node = createFileNodeData({
    metadata: {
      width: 1600,
      height: 900,
    },
    dimensions: {
      width: 200,
      height: 200,
    },
    imageAsset: {
      assetId: 'file-501',
      source: 'local',
      version: 2,
      variants: {
        thumbnail: {
          url: 'blob:thumb',
          width: 512,
          height: 512,
        },
      },
      intrinsicSize: {
        width: 1600,
        height: 900,
      },
    },
  });

  const patch = buildFileNodeMediaLayoutPatch(node, 512, 512);

  assert.ok(patch);
  assert.deepEqual(patch?.dimensions, { width: 267, height: 150 });
  assert.equal(patch?.metadata?.width, undefined);
  assert.equal(patch?.metadata?.height, undefined);
});

test('buildMediaLayoutPatch restores image metadata from original variant before thumbnail size', () => {
  const node = createFileNodeData({
    metadata: {
      width: 512,
      height: 512,
    },
    dimensions: {
      width: 200,
      height: 200,
    },
    imageAsset: {
      assetId: 'file-501',
      source: 'remote',
      version: 2,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-501/thumbnail',
          width: 512,
          height: 512,
        },
        original: {
          url: '/api/v1/files/file-501/download',
          width: 1600,
          height: 900,
        },
      },
    },
  });

  const patch = buildFileNodeMediaLayoutPatch(node, 512, 512);

  assert.ok(patch);
  assert.deepEqual(patch?.dimensions, { width: 267, height: 150 });
  assert.equal(patch?.metadata?.width, 1600);
  assert.equal(patch?.metadata?.height, 900);
});

test('buildMediaLayoutPatch updates video duration metadata with field-level scope', () => {
  const node = createFileNodeData({
    type: 'video',
    mimeType: 'video/mp4',
    previewUrl: 'blob:video-preview',
    metadata: {
      width: 1280,
      height: 720,
    },
  });

  const patch = buildFileNodeMediaLayoutPatch(node, 1920, 1080, 12.5);

  assert.ok(patch);
  assert.equal(patch?.metadata?.width, 1920);
  assert.equal(patch?.metadata?.height, 1080);
  assert.equal(patch?.metadata?.duration, 12.5);
  assert.equal('previewUrl' in (patch ?? {}), false);
});

test('buildMediaLayoutPatch returns null when media layout is unchanged', () => {
  const node = createFileNodeData({
    metadata: {
      width: 625,
      height: 500,
    },
    dimensions: {
      width: 250,
      height: 200,
    },
  });
  const patch = buildFileNodeMediaLayoutPatch(
    node,
    node.metadata.width ?? 0,
    node.metadata.height ?? 0,
  );

  assert.equal(patch, null);
});

test('buildMediaLayoutPatch returns null for repeated onLoad payload after first successful layout write', () => {
  const node = createFileNodeData({
    metadata: {
      width: 1600,
      height: 900,
    },
    dimensions: {
      width: 265,
      height: 149,
    },
  });

  const patch = buildFileNodeMediaLayoutPatch(node, 1600, 900);

  assert.equal(patch, null);
});

test('buildMediaLayoutPatch keeps runtime-only render tier out of persisted media layout patch', () => {
  const node = createFileNodeData({
    renderTier: 'minimal',
    imageResourceOwner: 'raster',
    metadata: {},
    dimensions: {
      width: 245,
      height: 163,
    },
  });

  const patch = buildFileNodeMediaLayoutPatch(node, 1920, 1080);

  assert.ok(patch);
  assert.equal('renderTier' in (patch ?? {}), false);
  assert.equal('imageResourceOwner' in (patch ?? {}), false);
  assert.equal(patch?.metadata?.width, 1920);
  assert.equal(patch?.metadata?.height, 1080);
});

test('file node layout runtime snapshots merge per node and drain before save', () => {
  clearFileNodeLayoutRuntimeSnapshots();

  setFileNodeLayoutRuntimeSnapshot({
    nodeId: '501',
    fileId: 'file-501',
    nodeType: 'image',
    width: 1000,
    height: 800,
    reason: 'first-layout',
    now: 10,
  });
  setFileNodeLayoutRuntimeSnapshot({
    nodeId: '501',
    fileId: 'file-501',
    nodeType: 'image',
    width: 1600,
    height: 900,
    reason: 'latest-layout',
    now: 20,
  });

  const pendingSnapshot = getFileNodeLayoutRuntimeSnapshot('501');
  assert.equal(pendingSnapshot?.width, 1600);
  assert.equal(pendingSnapshot?.height, 900);
  assert.equal(pendingSnapshot?.reason, 'latest-layout');

  const snapshots = consumeFileNodeLayoutRuntimeSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.nodeId, '501');
  assert.equal(snapshots[0]?.width, 1600);
  assert.equal(getFileNodeLayoutRuntimeSnapshot('501'), undefined);
  clearFileNodeLayoutRuntimeSnapshots();
});

test('file node layout runtime snapshots ignore duplicate passive media dimensions', () => {
  clearFileNodeLayoutRuntimeSnapshots();

  setFileNodeLayoutRuntimeSnapshot({
    nodeId: 'duplicate-layout',
    fileId: 'file-duplicate-layout',
    nodeType: 'image',
    width: 1600,
    height: 900,
    reason: 'media-layout-runtime-snapshot',
    now: 100,
  });
  const duplicate = setFileNodeLayoutRuntimeSnapshot({
    nodeId: 'duplicate-layout',
    fileId: 'file-duplicate-layout',
    nodeType: 'image',
    width: 1600,
    height: 900,
    reason: 'media-layout-runtime-snapshot',
    now: 200,
  });

  assert.equal(getFileNodeLayoutRuntimeSnapshotCount(), 1);
  assert.equal(duplicate?.updatedAt, 100);

  const snapshots = consumeFileNodeLayoutRuntimeSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.updatedAt, 100);
  clearFileNodeLayoutRuntimeSnapshots();
});

test('shouldMountFileNodeActionLayer keeps heavy controls out of steady unselected nodes', () => {
  assert.equal(shouldMountFileNodeActionLayer({
    selected: false,
    isResizing: false,
    isRotating: false,
    isPreviewPlaying: false,
    isPreviewModalOpen: false,
    isImageViewerOpen: false,
  }), false);

  assert.equal(shouldMountFileNodeActionLayer({
    selected: true,
    isResizing: false,
    isRotating: false,
    isPreviewPlaying: false,
    isPreviewModalOpen: false,
    isImageViewerOpen: false,
  }), true);
});
