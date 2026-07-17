import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileMetadata, FileNodeData } from '@/types';
import { calculateFileNodeDimensions, createSequentialNodeId } from '@/utils';
import {
  buildPositionedImportFiles,
  createPlaceholderImportBatch,
  FILE_IMPORT_BATCH_COLUMNS,
  FILE_IMPORT_BATCH_COLUMN_GAP,
  FILE_IMPORT_BATCH_GAP_Y,
  FILE_IMPORT_BATCH_ROW_GAP,
  FILE_IMPORT_BATCH_SIZE,
  initializeImportBatch,
  probeImportFilesForLayout,
  type EligibleImportFile,
  type FileCanvasNodeType,
  type ProbedImportFile,
} from './import-batch';

function createMockFile(name: string, type: string): File {
  return new File(['x'], name, { type, lastModified: 0 });
}

function createEligibleFile(
  index: number,
  nodeType: FileCanvasNodeType,
  metadata: FileMetadata = {},
): EligibleImportFile & { expectedMetadata: FileMetadata } {
  const extension = nodeType === 'image' ? 'png' : nodeType === 'video' ? 'mp4' : 'ply';
  const mimeType = nodeType === 'image'
    ? 'image/png'
    : nodeType === 'video'
      ? 'video/mp4'
      : 'application/octet-stream';

  return {
    file: createMockFile(`file-${index}.${extension}`, mimeType),
    nodeType,
    mimeType,
    expectedMetadata: metadata,
  };
}

function createNodeIds(count: number) {
  return Array.from({ length: count }, (_, index) => createSequentialNodeId(index + 1));
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function toProbedFiles(files: Array<EligibleImportFile & { expectedMetadata: FileMetadata }>): ProbedImportFile[] {
  return files.map(({ expectedMetadata, ...entry }) => ({
    ...entry,
    metadata: expectedMetadata,
  }));
}

function getDimensions(file: ProbedImportFile) {
  return calculateFileNodeDimensions(file.nodeType, file.metadata);
}

function getColumnWidths(files: ProbedImportFile[]) {
  return Array.from({ length: FILE_IMPORT_BATCH_COLUMNS }, (_, columnIndex) => (
    files.reduce((maxWidth, file, index) => (
      index % FILE_IMPORT_BATCH_COLUMNS === columnIndex
        ? Math.max(maxWidth, getDimensions(file).width)
        : maxWidth
    ), 0)
  ));
}

function getRowHeights(files: ProbedImportFile[]) {
  return [0, 1].map((rowIndex) => (
    files.reduce((maxHeight, file, index) => (
      Math.floor(index / FILE_IMPORT_BATCH_COLUMNS) === rowIndex
        ? Math.max(maxHeight, getDimensions(file).height)
        : maxHeight
    ), 0)
  ));
}

function getBatchHeight(files: ProbedImportFile[]) {
  const usedRows = getRowHeights(files).filter((height) => height > 0);
  return usedRows.reduce((sum, height) => sum + height, 0)
    + Math.max(usedRows.length - 1, 0) * FILE_IMPORT_BATCH_ROW_GAP;
}

test('single file import anchors the first node to the import trigger top-left', () => {
  const files = toProbedFiles([
    createEligibleFile(1, 'image', { width: 1600, height: 900 }),
  ]);
  const anchor = { x: 120, y: 80 };
  const positioned = buildPositionedImportFiles(files, anchor, createNodeIds);

  assert.equal(positioned.length, 1);
  assert.deepEqual(positioned[0].position, anchor);
});

test('five file import keeps a single aligned row with 20px minimum column gaps', () => {
  const files = toProbedFiles([
    createEligibleFile(1, 'image', { width: 1600, height: 900 }),
    createEligibleFile(2, 'image', { width: 900, height: 1600 }),
    createEligibleFile(3, 'video', { width: 1920, height: 1080, duration: 12 }),
    createEligibleFile(4, 'image', { width: 1024, height: 1024 }),
    createEligibleFile(5, 'ply'),
  ]);
  const anchor = { x: 32, y: 48 };
  const positioned = buildPositionedImportFiles(files, anchor, createNodeIds);
  const columnWidths = getColumnWidths(files);

  assert.equal(positioned.length, 5);

  positioned.forEach((entry, index) => {
    assert.equal(entry.position.y, anchor.y);
    if (index === 0) {
      assert.equal(entry.position.x, anchor.x);
      return;
    }

    const previous = positioned[index - 1];
    const expectedMinX = previous.position.x + columnWidths[index - 1] + FILE_IMPORT_BATCH_COLUMN_GAP;
    assert.equal(entry.position.x, expectedMinX);
  });
});

test('six file import starts the second row at the same x origin and keeps a 20px row gap', () => {
  const files = toProbedFiles([
    createEligibleFile(1, 'image', { width: 1600, height: 900 }),
    createEligibleFile(2, 'image', { width: 900, height: 1600 }),
    createEligibleFile(3, 'video', { width: 1920, height: 1080, duration: 12 }),
    createEligibleFile(4, 'image', { width: 1024, height: 1024 }),
    createEligibleFile(5, 'ply'),
    createEligibleFile(6, 'image', { width: 800, height: 600 }),
  ]);
  const anchor = { x: 0, y: 0 };
  const positioned = buildPositionedImportFiles(files, anchor, createNodeIds);
  const rowHeights = getRowHeights(files);

  assert.equal(positioned[5].position.x, anchor.x);
  assert.equal(positioned[5].position.y, anchor.y + rowHeights[0] + FILE_IMPORT_BATCH_ROW_GAP);
});

test('ten file import forms a 5x2 batch with aligned columns and rows', () => {
  const files = toProbedFiles(Array.from({ length: 10 }, (_, index) => (
    createEligibleFile(index + 1, index % 3 === 0 ? 'image' : index % 3 === 1 ? 'video' : 'ply', {
      width: 1000 + index * 50,
      height: 700 + index * 25,
      duration: index % 3 === 1 ? 10 + index : undefined,
    })
  )));
  const anchor = { x: 64, y: 96 };
  const positioned = buildPositionedImportFiles(files, anchor, createNodeIds);
  const firstRowY = positioned[0].position.y;
  const secondRowY = positioned[5].position.y;

  assert.equal(positioned.length, 10);
  positioned.slice(0, 5).forEach((entry) => assert.equal(entry.position.y, firstRowY));
  positioned.slice(5, 10).forEach((entry) => assert.equal(entry.position.y, secondRowY));
  for (let columnIndex = 0; columnIndex < FILE_IMPORT_BATCH_COLUMNS; columnIndex += 1) {
    assert.equal(positioned[columnIndex].position.x, positioned[columnIndex + FILE_IMPORT_BATCH_COLUMNS].position.x);
  }
});

test('eleven file import starts a new batch below the first batch with a 200px gap', () => {
  const files = toProbedFiles(Array.from({ length: 11 }, (_, index) => (
    createEligibleFile(index + 1, 'image', {
      width: 1200 + index * 10,
      height: 800 + index * 5,
    })
  )));
  const anchor = { x: 10, y: 20 };
  const positioned = buildPositionedImportFiles(files, anchor, createNodeIds);
  const firstBatchHeight = getBatchHeight(files.slice(0, FILE_IMPORT_BATCH_SIZE));

  assert.equal(positioned[10].position.x, anchor.x);
  assert.equal(positioned[10].position.y, anchor.y + firstBatchHeight + FILE_IMPORT_BATCH_GAP_Y);
});

test('mixed-size files align by batch-local column widths and row heights', () => {
  const files = toProbedFiles([
    createEligibleFile(1, 'image', { width: 2400, height: 800 }),
    createEligibleFile(2, 'image', { width: 800, height: 2400 }),
    createEligibleFile(3, 'image', { width: 1600, height: 900 }),
    createEligibleFile(4, 'video', { width: 3840, height: 2160, duration: 30 }),
    createEligibleFile(5, 'ply'),
    createEligibleFile(6, 'image', { width: 600, height: 600 }),
    createEligibleFile(7, 'image', { width: 3000, height: 1000 }),
  ]);
  const anchor = { x: 100, y: 140 };
  const positioned = buildPositionedImportFiles(files, anchor, createNodeIds);
  const batchFiles = files.slice(0, 7);
  const columnWidths = getColumnWidths(batchFiles);
  const rowHeights = getRowHeights(batchFiles);

  assert.equal(positioned[0].position.x, anchor.x);
  assert.equal(positioned[1].position.x, anchor.x + columnWidths[0] + FILE_IMPORT_BATCH_COLUMN_GAP);
  assert.equal(positioned[5].position.y, anchor.y + rowHeights[0] + FILE_IMPORT_BATCH_ROW_GAP);
  assert.equal(positioned[6].position.x, anchor.x + columnWidths[0] + FILE_IMPORT_BATCH_COLUMN_GAP);
});

test('placeholder batch preserves layout metadata without persisting any group concept', () => {
  const files = toProbedFiles([
    createEligibleFile(1, 'image', { width: 1600, height: 900 }),
    createEligibleFile(2, 'video', { width: 1920, height: 1080, duration: 8 }),
  ]);
  const positioned = buildPositionedImportFiles(files, { x: 0, y: 0 }, createNodeIds);
  const placeholderBatch = createPlaceholderImportBatch('batch-1', positioned, () => 'session-1');

  assert.equal(placeholderBatch.tasks.length, 2);
  assert.equal(placeholderBatch.nodes.length, 2);

  placeholderBatch.tasks.forEach((task, index) => {
    assert.deepEqual(task.metadata, files[index].metadata);
    assert.equal('groupId' in task, false);
    assert.equal('batchIndex' in task, false);
  });

  placeholderBatch.nodes.forEach((node, index) => {
    const fileNode = node as FileNodeData;
    assert.deepEqual(fileNode.metadata, files[index].metadata);
    assert.equal('groupId' in fileNode, false);
    assert.equal('batchIndex' in fileNode, false);
  });
});

test('initializeImportBatch probes before placeholder creation and preserves probe order', async () => {
  const files = [
    createEligibleFile(1, 'image', { width: 800, height: 600 }),
    createEligibleFile(2, 'video', { width: 1920, height: 1080, duration: 12 }),
    createEligibleFile(3, 'ply'),
  ];
  const steps: string[] = [];

  const result = await initializeImportBatch({
    batchId: 'batch-seq',
    files,
    position: { x: 50, y: 60 },
    getNextNodeIds: createNodeIds,
    probeMetadata: async (file) => {
      steps.push(`probe:${file.file.name}`);
      const source = files.find((entry) => entry.file.name === file.file.name);
      return source?.expectedMetadata ?? {};
    },
    createSessionId: () => {
      steps.push('session');
      return 'session-seq';
    },
  });

  assert.deepEqual(
    steps,
    [
      `probe:${files[0].file.name}`,
      `probe:${files[1].file.name}`,
      `probe:${files[2].file.name}`,
      'session',
      'session',
      'session',
    ],
  );
  assert.equal(result.probedFiles.length, 3);
  assert.equal(result.positionedFiles.length, 3);
  assert.equal(result.placeholderBatch.nodes.length, 3);
});

test('initializeImportBatch falls back to empty metadata on probe failure without polluting result state', async () => {
  const files = [
    createEligibleFile(1, 'image', { width: 1600, height: 900 }),
    createEligibleFile(2, 'video', { width: 1920, height: 1080, duration: 4 }),
  ];
  const errors: string[] = [];

  const result = await initializeImportBatch({
    batchId: 'batch-fallback',
    files,
    position: { x: 0, y: 0 },
    getNextNodeIds: createNodeIds,
    probeMetadata: async (file) => {
      if (file.file.name === files[1].file.name) {
        throw new Error('probe failed');
      }
      const source = files.find((entry) => entry.file.name === file.file.name);
      return source?.expectedMetadata ?? {};
    },
    onProbeError: (file) => {
      errors.push(file.file.name);
    },
    createSessionId: () => 'session-fallback',
  });

  assert.deepEqual(errors, [files[1].file.name]);
  assert.deepEqual(result.probedFiles[0].metadata, files[0].expectedMetadata);
  assert.deepEqual(result.probedFiles[1].metadata, {});
  assert.equal('groupId' in result.placeholderBatch.tasks[0], false);
  assert.equal('groupId' in result.placeholderBatch.nodes[0], false);
});

test('probeImportFilesForLayout probes with a fixed concurrency window and keeps output order', async () => {
  const files = Array.from({ length: 5 }, (_, index) => (
    createEligibleFile(index + 1, 'image', {
      width: 100 + index,
      height: 200 + index,
    })
  ));
  const gates = files.map(() => createDeferred<FileMetadata>());
  const started: string[] = [];
  let active = 0;
  let maxActive = 0;

  const resultPromise = probeImportFilesForLayout(
    files,
    async (file) => {
      const index = files.findIndex((entry) => entry.file.name === file.file.name);
      started.push(file.file.name);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const metadata = await gates[index].promise;
      active -= 1;
      return metadata;
    },
    undefined,
    2,
  );

  await Promise.resolve();
  assert.deepEqual(started, [
    files[0].file.name,
    files[1].file.name,
  ]);
  assert.equal(maxActive, 2);

  gates[1].resolve(files[1].expectedMetadata);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  assert.deepEqual(started, [
    files[0].file.name,
    files[1].file.name,
    files[2].file.name,
  ]);

  gates[0].resolve(files[0].expectedMetadata);
  gates[2].resolve(files[2].expectedMetadata);
  gates[3].resolve(files[3].expectedMetadata);
  gates[4].resolve(files[4].expectedMetadata);

  const result = await resultPromise;
  assert.equal(maxActive, 2);
  assert.deepEqual(
    result.map((entry) => entry.file.name),
    files.map((entry) => entry.file.name),
  );
  assert.deepEqual(
    result.map((entry) => entry.metadata),
    files.map((entry) => entry.expectedMetadata),
  );
});

test('probeImportFilesForLayout falls back per file without aborting later probes', async () => {
  const files = [
    createEligibleFile(1, 'image', { width: 800, height: 600 }),
    createEligibleFile(2, 'video', { width: 1920, height: 1080, duration: 3 }),
    createEligibleFile(3, 'image', { width: 300, height: 200 }),
  ];
  const errors: string[] = [];

  const result = await probeImportFilesForLayout(
    files,
    async (file) => {
      if (file.file.name === files[1].file.name) {
        throw new Error('probe failed');
      }

      return files.find((entry) => entry.file.name === file.file.name)?.expectedMetadata ?? {};
    },
    (file) => {
      errors.push(file.file.name);
    },
    2,
  );

  assert.deepEqual(errors, [files[1].file.name]);
  assert.deepEqual(result.map((entry) => entry.metadata), [
    files[0].expectedMetadata,
    {},
    files[2].expectedMetadata,
  ]);
});
