import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const productionFiles = [
  'src/services/image/image-asset.ts',
  'src/services/image/image-node.ts',
  'src/services/image/image-manager.ts',
  'src/services/image/image-resource.types.ts',
  'src/services/image/image-import-coordinator.ts',
  'src/services/image/image-original-source-registry.ts',
  'src/services/image/image-thumbnail-runtime-store.ts',
  'src/services/file/file-service.ts',
  'src/services/file/file-preprocess.types.ts',
  'src/services/file/image-thumbnail-worker-pipeline.ts',
  'src/services/file/image-thumbnail.worker.ts',
  'src/hooks/image/useImageResource.ts',
  'src/hooks/image/useViewerImageResource.ts',
  'src/components/canvas/Canvas.tsx',
  'src/components/canvas/canvas-raster-image-resource-bridge.ts',
  'src/components/canvas/canvas-image-raster-draw.ts',
  'src/components/node/file/FileNode.tsx',
  'src/components/node/file/FileNodeCanvasShell.tsx',
  'src/components/node/file/FileNodeViewerLayer.tsx',
  'src/services/workflow-file-normalizer.ts',
  'src/services/backendFileService.ts',
  'src/services/workflow-upload-scheduler.ts',
  'src/services/file-export.ts',
];

const forbiddenPatterns = [
  ['runtime:', 'import-preview'].join(''),
  ['imageAsset', '.variants', '.preview'].join(''),
  ['variants', '.preview'].join(''),
  ['generate', 'Preview('].join(''),
  ['data', ':image/'].join(''),
];

test('image formal chain production files no longer reference removed image preview or data-url semantics', () => {
  for (const relativePath of productionFiles) {
    const source = readFileSync(path.join(projectRoot, relativePath), 'utf8');

    for (const pattern of forbiddenPatterns) {
      assert.equal(
        source.includes(pattern),
        false,
        `${relativePath} should not contain ${pattern}`,
      );
    }
  }
});
