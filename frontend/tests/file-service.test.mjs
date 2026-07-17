import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalImportFileSource,
  preprocessImportFile,
} from '../dist-tests/src/services/file/file-service.js';

test('createLocalImportFileSource stamps imported local source metadata with defaults and overrides', () => {
  const explicit = createLocalImportFileSource({
    sourceDisplayName: 'input.png',
    localSource: {
      status: 'linked',
      referenceId: 'local-ref-1',
    },
    originalPath: 'C:/demo/input.png',
    importedAt: 123,
  });
  const implicit = createLocalImportFileSource();

  assert.deepEqual(explicit, {
    type: 'imported',
    importMethod: 'local',
    sourceDisplayName: 'input.png',
    localSource: {
      status: 'linked',
      referenceId: 'local-ref-1',
    },
    originalPath: 'C:/demo/input.png',
    importedAt: 123,
  });
  assert.equal(implicit.type, 'imported');
  assert.equal(implicit.importMethod, 'local');
  assert.equal(implicit.localSource?.status, 'runtime-only');
  assert.ok(typeof implicit.importedAt === 'number');
});

test('preprocessImportFile marks image thumbnail as unavailable when worker path is unavailable', async () => {
  const originalWorker = globalThis.Worker;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  try {
    globalThis.Worker = undefined;
    globalThis.createImageBitmap = undefined;
    globalThis.OffscreenCanvas = undefined;

    const result = await preprocessImportFile({
      file: new File(['image'], 'demo.png', { type: 'image/png' }),
      kind: 'image',
      thumbnail: {
        maxWidth: 512,
        maxHeight: 512,
      },
    });

    assert.equal(result.kind, 'image');
    assert.equal(result.processingMode, 'unavailable');
    assert.equal(result.thumbnailBlob, undefined);
    assert.equal(result.thumbnailUrl, undefined);
    assert.equal(result.thumbnailMimeType, undefined);
    assert.equal(result.metadata, undefined);
    assert.equal('previewUrl' in result, false);
  } finally {
    globalThis.Worker = originalWorker;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
});
