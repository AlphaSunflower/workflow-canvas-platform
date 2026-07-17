import test from 'node:test';
import assert from 'node:assert/strict';

interface FsLike {
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
  statSync: (path: string) => { isDirectory: () => boolean };
}

interface PathLike {
  join: (...parts: string[]) => string;
  resolve: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
}

const processLike = globalThis as typeof globalThis & {
  process?: {
    cwd: () => string;
  };
};

const DIRECT_ORIGINAL_PATTERNS = [
  'getFileNodeImageOriginalUrl',
  'fetchProtectedResourceBlob(',
  'imageOriginalSourceRegistry.getOrCreateObjectUrl',
] as const;

const DIRECT_ORIGINAL_ALLOWLIST = new Set([
  'services/file-resource/file-resource-service.ts',
  'services/file-resource/file-resource-boundary.spec.ts',
  'services/protected-resource.ts',
  'services/protected-resource.spec.ts',
  'services/image/image-asset.ts',
  'services/image/image-original-source-registry.spec.ts',
  'hooks/image/useImageResource.spec.ts',
  'services/execution-output-runtime-sync.ts',
  'services/execution-output-runtime-sync.spec.ts',
]);

const LOW_LEVEL_DIRECT_ORIGINAL_ALLOWLIST = [
  'services/execution-output-runtime-sync.ts',
  'services/file-resource/file-resource-service.ts',
  'services/image/image-asset.ts',
  'services/protected-resource.ts',
] as const;

async function loadNodeModules(): Promise<{
  fs: FsLike;
  path: PathLike;
  sourceRoot: string;
}> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  const fs = await dynamicImport('node:fs') as FsLike;
  const path = await dynamicImport('node:path') as PathLike;
  const cwd = processLike.process?.cwd() ?? '.';
  return {
    fs,
    path,
    sourceRoot: path.resolve(cwd, 'src'),
  };
}

function normalizePath(pathModule: PathLike, sourceRoot: string, filePath: string): string {
  return pathModule.relative(sourceRoot, filePath).replace(/\\/g, '/');
}

function collectSourceFiles(fs: FsLike, pathModule: PathLike, directory: string): string[] {
  const entries = fs.readdirSync(directory);
  const files: string[] = [];

  entries.forEach((entryName: string) => {
    const entryPath = pathModule.join(directory, entryName);
    const stats = fs.statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fs, pathModule, entryPath));
      return;
    }

    if (/\.(ts|tsx)$/.test(entryName)) {
      files.push(entryPath);
    }
  });

  return files;
}

function readSource(fs: FsLike, pathModule: PathLike, sourceRoot: string, relativePath: string): string {
  return fs.readFileSync(pathModule.join(sourceRoot, relativePath), 'utf8');
}

function assertIncludes(source: string, expected: string, label: string): void {
  assert.equal(source.includes(expected), true, `${label} must include ${expected}`);
}

function assertNotIncludes(source: string, unexpected: string, label: string): void {
  assert.equal(source.includes(unexpected), false, `${label} must not include ${unexpected}`);
}

function extractBracedBlock(source: string, startNeedle: string, label: string): string {
  const startIndex = source.indexOf(startNeedle);
  assert.equal(startIndex !== -1, true, `${label} start was not found`);
  const braceStart = source.indexOf('{', startIndex);
  assert.equal(braceStart !== -1, true, `${label} opening brace was not found`);

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, index + 1);
      }
    }
  }

  throw new Error(`${label} closing brace was not found`);
}

test('file resource boundary blocks component and feature layers from direct original resource APIs', async () => {
  const { fs, path: pathModule, sourceRoot } = await loadNodeModules();
  const violations: string[] = [];

  collectSourceFiles(fs, pathModule, sourceRoot).forEach((filePath) => {
    const relativePath = normalizePath(pathModule, sourceRoot, filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    DIRECT_ORIGINAL_PATTERNS.forEach((pattern) => {
      if (!source.includes(pattern)) {
        return;
      }

      if (!DIRECT_ORIGINAL_ALLOWLIST.has(relativePath)) {
        violations.push(`${relativePath}: ${pattern}`);
      }
    });
  });

  assert.deepEqual(violations, []);
});

test('file resource boundary keeps direct original allowlist restricted to low-level services and specs', () => {
  const nonSpecAllowedPaths = Array.from(DIRECT_ORIGINAL_ALLOWLIST)
    .filter((relativePath) => !relativePath.endsWith('.spec.ts') && !relativePath.endsWith('.spec.tsx'))
    .sort();

  assert.deepEqual(nonSpecAllowedPaths, [...LOW_LEVEL_DIRECT_ORIGINAL_ALLOWLIST].sort());
});

test('file resource boundary keeps viewer inpaint upload export and prompt references on FileResourceService', async () => {
  const { fs, path: pathModule, sourceRoot } = await loadNodeModules();
  const viewer = readSource(fs, pathModule, sourceRoot, 'hooks/image/useViewerImageResource.ts');
  assertIncludes(viewer, "purpose: 'viewer-original'", 'viewer original resource resolver');
  assertIncludes(viewer, 'const resourceNode = viewerResourceNodeRef.current;', 'viewer original resource resolver');
  assertIncludes(viewer, 'resolveFileResource(resourceNode,', 'viewer original resource resolver');
  assertIncludes(viewer, 'workflowId: options.workflowId', 'viewer original resource resolver');

  const inpaint = readSource(fs, pathModule, sourceRoot, 'nodes/ai-image-inpaint/InpaintCanvasEditor.tsx');
  assertIncludes(inpaint, "purpose: 'inpaint-editor-original'", 'inpaint editor original resolver');
  assertIncludes(inpaint, 'resolveFileResource(resourceNode,', 'inpaint editor original resolver');
  assertIncludes(inpaint, 'workflowId: resourceOptions.workflowId', 'inpaint editor original resolver');

  const upload = readSource(fs, pathModule, sourceRoot, 'services/backendFileService.ts');
  assertIncludes(upload, "purpose: 'upload-input'", 'upload input resolver');
  assertIncludes(upload, "'prompt-reference'", 'prompt reference resolver type');
  assertIncludes(upload, 'const purpose = options.purpose ?? \'upload-input\'', 'upload input resolver');
  assertIncludes(upload, 'resolveFileResource(node,', 'upload input resolver');
  assertIncludes(upload, 'workflowId: options.workflowId', 'upload input resolver');

  const exportSource = readSource(fs, pathModule, sourceRoot, 'services/file-export.ts');
  assertIncludes(exportSource, "purpose: 'export-original'", 'export original resolver');
  assertIncludes(exportSource, 'resolveFileResource(node,', 'export original resolver');
  assertIncludes(exportSource, 'workflowId: options.workflowId', 'export original resolver');

  const promptReference = readSource(fs, pathModule, sourceRoot, 'components/context/coordinators/workflow-execution-coordinator.ts');
  assertIncludes(promptReference, "purpose: 'prompt-reference'", 'prompt reference execution entry');
  assertIncludes(promptReference, 'backendFileService.ensureBackendFileId(sourceNode,', 'prompt reference execution entry');
  assertIncludes(promptReference, 'workflowId,', 'prompt reference execution entry');
});

test('file resource boundary requires export callers to pass workflow scope', async () => {
  const { fs, path: pathModule, sourceRoot } = await loadNodeModules();
  const exportTypes = readSource(fs, pathModule, sourceRoot, 'services/file-export.types.ts');
  assertIncludes(exportTypes, 'workflowId?: string | null', 'FileExportOptions');
  assertIncludes(exportTypes, 'authScope?: string | null', 'FileExportOptions');

  const exportSource = readSource(fs, pathModule, sourceRoot, 'services/file-export.ts');
  assertIncludes(exportSource, 'workflowId: options.workflowId', 'file-export resolver options');
  assertIncludes(exportSource, 'authScope: options.authScope', 'file-export resolver options');

  const violations: string[] = [];
  let checkedCalls = 0;
  const callPattern = /fileExportService\.exportNodeFile\([\s\S]*?\);/g;
  collectSourceFiles(fs, pathModule, sourceRoot).forEach((filePath) => {
    const relativePath = normalizePath(pathModule, sourceRoot, filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    const matches = source.matchAll(callPattern);
    for (const match of matches) {
      checkedCalls += 1;
      const callSource = match[0] ?? '';
      if (!callSource.includes('workflowId:')) {
        violations.push(`${relativePath}: fileExportService.exportNodeFile call missing workflowId`);
      }
    }
  });

  assert.equal(checkedCalls > 0, true, 'expected at least one fileExportService.exportNodeFile call');
  assert.deepEqual(violations, []);
});

test('file resource boundary keeps Task History image input previews off download and stale blob fallback', async () => {
  const { fs, path: pathModule, sourceRoot } = await loadNodeModules();
  const taskHistoryInputPreview = readSource(
    fs,
    pathModule,
    sourceRoot,
    'components/canvas/TaskHistoryInputPreviewStrip.tsx',
  );

  const imageBranch = extractBracedBlock(
    taskHistoryInputPreview,
    "if (previewType === 'image')",
    'TaskHistoryInputPreviewStrip image preview branch',
  );
  assertIncludes(imageBranch, 'item.backendFile?.thumbnailUrl', 'Task History image input preview');
  assertIncludes(imageBranch, 'item.backendFile?.previewUrl', 'Task History image input preview');
  assertIncludes(imageBranch, 'thumbnailPath', 'Task History image input preview');
  assertIncludes(imageBranch, 'previewPath', 'Task History image input preview');
  assertNotIncludes(imageBranch, 'downloadUrl', 'Task History image input preview');
  assertNotIncludes(imageBranch, 'filePath', 'Task History image input preview');

  const videoBranch = extractBracedBlock(
    taskHistoryInputPreview,
    "if (previewType === 'video')",
    'TaskHistoryInputPreviewStrip video preview branch',
  );
  assertIncludes(videoBranch, 'item.backendFile?.downloadUrl', 'Task History video input preview');
  assertIncludes(videoBranch, 'filePath', 'Task History video input preview');

  const ephemeralFunction = extractBracedBlock(
    taskHistoryInputPreview,
    'function getEphemeralPreviewSrc',
    'TaskHistoryInputPreviewStrip ephemeral preview function',
  );
  const imageGuardIndex = ephemeralFunction.indexOf("if (getPreviewType(item) === 'image')");
  const firstEphemeralPathIndex = ephemeralFunction.indexOf('item.fileInfo?.path');
  assert.equal(imageGuardIndex !== -1, true, 'Task History image input preview must explicitly reject ephemeral fallback');
  assertIncludes(ephemeralFunction.slice(imageGuardIndex, firstEphemeralPathIndex), 'return undefined', 'Task History image input ephemeral guard');

  const previewSourceTests = readSource(fs, pathModule, sourceRoot, 'components/canvas/TaskHistoryPreviewSources.spec.tsx');
  assertIncludes(
    previewSourceTests,
    'TaskHistoryInputPreviewStrip uses previewUrl as fallback when thumbnailUrl is present',
    'Task History image input preview tests',
  );
  assertIncludes(
    previewSourceTests,
    'TaskHistoryInputPreviewStrip keeps video download fallback when preview is unavailable',
    'Task History video input preview tests',
  );
});
