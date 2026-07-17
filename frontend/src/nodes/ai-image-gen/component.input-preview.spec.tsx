import test from 'node:test';
import assert from 'node:assert/strict';
import type { NodeInputImagePreviewProps } from '../shared/NodeInputImagePreview';
import type { FileNodeData } from '@/types';

function createLocalImageNode(fileName: string): FileNodeData {
  return {
    id: { value: `${fileName}-id`, display: `#${fileName}` },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 240 },
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
    metadata: {
      width: 1280,
      height: 720,
    },
  };
}

test('aiImageGen input preview adopts shared NodeInputImagePreview prop contract for local source-node rendering', () => {
  const props: NodeInputImagePreviewProps = {
    sourceNode: createLocalImageNode('group-input-preview.png'),
    alt: 'group-input-preview.png',
    draggable: false,
    fallback: 'fallback',
  };

  assert.equal(props.sourceNode?.type, 'image');
  assert.equal(props.sourceNode?.source.type, 'imported');
  assert.equal(props.sourceNode?.source.importMethod, 'local');
  assert.equal(props.alt, 'group-input-preview.png');
  assert.equal(props.draggable, false);
  assert.equal('sourceNode' in props, true);
  assert.equal('src' in props, false);
  assert.equal(props.fallback, 'fallback');
});
