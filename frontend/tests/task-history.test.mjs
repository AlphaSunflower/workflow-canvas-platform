import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileNodePropertySections } from '../dist-tests/src/components/node/file/file-node-property-sections.js';

function createFileNode(overrides = {}) {
  return {
    id: { value: '1', display: '#00001' },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'ready',
    zIndex: 0,
    timestamp: { created: 10, updated: 20 },
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
      importedAt: 30,
      originalPath: 'C:/demo.png',
    },
    metadata: {
      width: 1024,
      height: 768,
    },
    ...overrides,
  };
}

test('buildFileNodePropertySections renders imported file properties without node output details', () => {
  const sections = buildFileNodePropertySections(createFileNode());
  const titles = sections.map((section) => section.title);
  const sourceSection = sections.find((section) => section.title === '\u6765\u6e90\u4fe1\u606f');

  assert.deepEqual(titles, ['\u57fa\u7840\u4fe1\u606f', '\u6765\u6e90\u4fe1\u606f']);
  assert.ok(sourceSection);
  assert.equal(sourceSection.items.some((item) => item.label === '\u4efb\u52a1\u7f16\u53f7'), false);
  assert.equal(sourceSection.items.find((item) => item.label === '\u5bfc\u5165\u65b9\u5f0f').value, '\u672c\u5730\u5bfc\u5165');
  assert.equal(sourceSection.items.find((item) => item.label === '\u6765\u6e90\u6587\u4ef6\u540d').value, 'demo.png');
  assert.equal(sourceSection.items.find((item) => item.label === '\u672c\u5730\u6e90\u72b6\u6001').value, '\u4ec5\u5f53\u524d\u4f1a\u8bdd');
});

test('buildFileNodePropertySections renders node output generation details for produced files', () => {
  const sections = buildFileNodePropertySections(createFileNode({
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
  }));

  const titles = sections.map((section) => section.title);
  const generationSection = sections.find((section) => section.title === '\u751f\u6210\u4fe1\u606f');

  assert.deepEqual(titles, ['\u57fa\u7840\u4fe1\u606f', '\u6765\u6e90\u4fe1\u606f', '\u751f\u6210\u4fe1\u606f']);
  assert.ok(generationSection);
  assert.equal(generationSection.items.find((item) => item.label === '\u4efb\u52a1\u7f16\u53f7').value, 'TASK-20260403-000001');
  assert.equal(generationSection.items.find((item) => item.label === '\u4efb\u52a1\u5b8c\u6210\u65f6\u95f4').value !== '\u672a\u8bb0\u5f55', true);
});
