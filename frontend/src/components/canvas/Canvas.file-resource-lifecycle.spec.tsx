import test from 'node:test';
import assert from 'node:assert/strict';

async function readCanvasSource(): Promise<string> {
  const fsSpecifier = 'node:fs';
  const { readFileSync } = await import(fsSpecifier);
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };

  return readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/Canvas.tsx`,
    'utf8',
  );
}

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex !== -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex !== -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('canvas cleanup paths pass workflow scope so unleased originals from other workflows are not cleared', async () => {
  const canvasSource = await readCanvasSource();
  const cleanupCalls = Array.from(canvasSource.matchAll(/clearAllImageResources\(\{\s*workflowId:/g));

  assert.equal(cleanupCalls.length >= 2, true);
  assert.equal(canvasSource.includes('workflowId: runtimeResourceWorkflowIdRef.current'), true);
  assert.equal(canvasSource.includes('workflowId: workflowState.workflow?.id,'), true);
  assert.equal(canvasSource.includes('clearAllImageResources();'), false);
});

test('canvas explicit node deletion force clears file resources with workflow scope', async () => {
  const canvasSource = await readCanvasSource();
  const removeNodeLocallyBlock = sliceBetween(
    canvasSource,
    'const removeNodeLocally = useCallback((nodeId: string): void => {',
    '  const deleteSelectedElements = useCallback((): void => {',
  );
  const deleteSelectedBlock = sliceBetween(
    canvasSource,
    'const deleteSelectedElements = useCallback((): void => {',
    '  useEffect(() => {\n    const handleGlobalKeyDown',
  );

  assert.equal(removeNodeLocallyBlock.includes('backendFileService.forceDeleteNodeResource('), true);
  assert.equal(removeNodeLocallyBlock.includes('workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current'), true);
  assert.equal(removeNodeLocallyBlock.includes('workflowState.workflow?.id]'), true);
  assert.equal(deleteSelectedBlock.includes('backendFileService.forceDeleteNodeResource('), true);
  assert.equal(deleteSelectedBlock.includes('workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current'), true);
  assert.equal(deleteSelectedBlock.includes('workflowState.workflow?.id]'), true);
});

test('canvas viewport drag sync remains viewport-only and cannot trigger original file downloads', async () => {
  const canvasSource = await readCanvasSource();
  const onMoveEndBlock = sliceBetween(
    canvasSource,
    'const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {',
    '  const onInit = useCallback(',
  );

  assert.equal(onMoveEndBlock.includes('scheduleViewportSync(viewport);'), true);
  assert.equal(onMoveEndBlock.includes('scheduleWorkflowSync({'), true);
  assert.equal(onMoveEndBlock.includes('syncViewportOnlyToWorkflow(viewport, {'), false);
  assert.equal(onMoveEndBlock.includes('syncReactFlowStateToWorkflow(nodesRef.current, edgesRef.current, viewport)'), false);
  assert.equal(onMoveEndBlock.includes('resolveFileResource('), false);
  assert.equal(onMoveEndBlock.includes('getFileBlobFromNode'), false);
  assert.equal(onMoveEndBlock.includes('download'), false);
  assert.equal(onMoveEndBlock.includes('original'), false);
});

test('canvas passes workflow scope into viewer and inpaint editor resource consumers', async () => {
  const canvasSource = await readCanvasSource();

  assert.equal(canvasSource.includes('workflowId={workflowState.workflow?.id ?? null}'), true);
  assert.equal(canvasSource.includes('workflowId: workflowState.workflow?.id ?? null'), true);
});
