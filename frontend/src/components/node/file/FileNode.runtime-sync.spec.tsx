import test from 'node:test';
import assert from 'node:assert/strict';

test('FileNode keeps runtime video object URLs in local display state instead of persisting them back into workflow data', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const source = readFileSync(
    `${cwd}/src/components/node/file/FileNode.tsx`,
    'utf8',
  );

  assert.equal(source.includes("const [runtimePreviewVideoUrl, setRuntimePreviewVideoUrl] = useState<string | undefined>(undefined);"), true);
  assert.equal(source.includes("? runtimePreviewVideoUrl ?? data.previewUrl"), true);
  assert.equal(source.includes('runtimeResource?.fileType === \'video\'\n        ? runtimeResource.objectUrl'), true);
  assert.equal(source.includes('setRuntimePreviewVideoUrl((current) => (\n        current === resource.objectUrl ? current : resource.objectUrl\n      ));'), true);
  assert.equal(source.includes('persistCurrentNodePatch({ previewUrl:'), false);
  assert.equal(source.includes('persistCurrentNodePatch((currentData) => ({\n      ...currentData,\n      previewUrl:'), false);
});

test('FileNode routes passive media layout writes through the runtime snapshot store', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const source = readFileSync(
    `${cwd}/src/components/node/file/FileNode.tsx`,
    'utf8',
  );
  const syncMediaLayoutStart = source.indexOf('const syncMediaLayout = useCallback((width: number, height: number, duration?: number): void => {');
  assert.ok(syncMediaLayoutStart >= 0);
  const syncMediaLayoutBlock = source.slice(
    syncMediaLayoutStart,
    source.indexOf('  const handleDelete = useCallback(', syncMediaLayoutStart),
  );
  const passiveBranchStart = syncMediaLayoutBlock.indexOf('if (!shouldCommitMediaLayoutImmediately) {');
  assert.ok(passiveBranchStart >= 0);
  const passiveBranch = syncMediaLayoutBlock.slice(
    passiveBranchStart,
    syncMediaLayoutBlock.indexOf('    updateCurrentNodeLocal', passiveBranchStart),
  );

  assert.equal(source.includes('setFileNodeLayoutRuntimeSnapshot'), true);
  assert.equal(source.includes('file-node-layout-runtime-store'), true);
  assert.equal(source.includes('const isFullDomMediaNode ='), true);
  assert.equal(source.includes('const isMediaLayoutInteractionActive ='), true);
  assert.equal(source.includes('const shouldCommitMediaLayoutImmediately ='), true);
  assert.equal(source.includes('isFullDomMediaNode && isMediaLayoutInteractionActive'), true);
  assert.equal(passiveBranch.includes('setFileNodeLayoutRuntimeSnapshot({'), true);
  assert.equal(passiveBranch.includes("reason: 'media-layout-runtime-snapshot'"), true);
  assert.equal(passiveBranch.includes('scheduleMediaLayoutRuntimeSync('), false);
  assert.equal(passiveBranch.includes('updateCurrentNodeLocal('), false);
  assert.equal(passiveBranch.includes('persistCurrentNodePatch('), false);
  assert.equal(syncMediaLayoutBlock.includes('persistCurrentNodePatch((currentData) => buildFileNodeMediaLayoutPatch'), true);
  assert.equal(source.includes("reason: 'media-layout-node-active'"), true);
});
