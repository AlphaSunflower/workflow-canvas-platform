import test from 'node:test';
import assert from 'node:assert/strict';
import type { NodeInputImagePreviewProps } from '../shared/NodeInputImagePreview';
import type { FileNodeData } from '@/types';

function createImageNode(fileName: string): FileNodeData {
  return {
    id: { value: `${fileName}-node`, display: `#${fileName}` },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 200 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: 0,
      updated: 0,
    },
    fileId: `${fileName}-file`,
    fileName,
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 0,
    },
    metadata: {},
  };
}

function createDualSlotPreviewProps(fileName: string): NodeInputImagePreviewProps {
  return {
    sourceNode: createImageNode(fileName),
    alt: fileName,
    draggable: false,
    fallback: fileName.slice(0, 10),
  };
}

test('aiModelRenderTransfer dual slots use shared NodeInputImagePreview source-node contract', () => {
  const whiteModelPreview = createDualSlotPreviewProps('white-model.png');
  const styleReferencePreview = createDualSlotPreviewProps('style-reference.png');

  assert.equal(whiteModelPreview.sourceNode?.type, 'image');
  assert.equal(styleReferencePreview.sourceNode?.type, 'image');
  assert.equal(whiteModelPreview.sourceNode?.source.importMethod, 'local');
  assert.equal(styleReferencePreview.sourceNode?.source.importMethod, 'local');
  assert.equal(whiteModelPreview.alt, 'white-model.png');
  assert.equal(styleReferencePreview.alt, 'style-reference.png');
  assert.equal(whiteModelPreview.draggable, false);
  assert.equal(styleReferencePreview.draggable, false);
  assert.equal('src' in whiteModelPreview, false);
  assert.equal('src' in styleReferencePreview, false);
  assert.equal(whiteModelPreview.fallback, 'white-mode');
  assert.equal(styleReferencePreview.fallback, 'style-refe');
});
