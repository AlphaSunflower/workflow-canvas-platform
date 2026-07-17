import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_IMAGE_INPAINT_DEFAULT_SIZE,
  AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
  AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT,
  AI_IMAGE_INPAINT_MIN_HEIGHT,
  resolveAIImageInpaintEditorSize,
} from './constants';

const importNodeFs = new Function('return import("node:fs")') as () => Promise<{
  readFileSync: (path: URL | string, encoding: string) => string;
}>;
const { readFileSync } = await importNodeFs();
const frontendRoot = (new Function('return process.cwd()') as () => string)();
const componentSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-image-inpaint/component.tsx`,
  'utf8',
);
const editorSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-image-inpaint/InpaintCanvasEditor.tsx`,
  'utf8',
);
const cssSource = readFileSync(
  `${frontendRoot}/src/index.css`,
  'utf8',
);
const canvasSource = readFileSync(
  `${frontendRoot}/src/components/canvas/Canvas.tsx`,
  'utf8',
);
const visibilityRectSource = readFileSync(
  `${frontendRoot}/src/hooks/canvas/node-visibility-rect.ts`,
  'utf8',
);

function expectContains(source: string, pattern: RegExp, message?: string): void {
  assert.equal(pattern.test(source), true, message ?? `Expected source to match ${pattern}`);
}

function expectNotContains(source: string, pattern: RegExp, message?: string): void {
  assert.equal(pattern.test(source), false, message ?? `Expected source not to match ${pattern}`);
}

test('ai image inpaint node keeps editor height outside body height calculations', () => {
  assert.equal(AI_IMAGE_INPAINT_DEFAULT_SIZE.width, 500);
  assert.equal(AI_IMAGE_INPAINT_DEFAULT_SIZE.height, 460);
  assert.equal(AI_IMAGE_INPAINT_MIN_HEIGHT, 430);
  assert.equal(AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP, 12);
  assert.equal(AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP, 6);
  assert.equal(AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT, 39);
  expectContains(componentSource, /function getMinimumNodeHeight\(\): number \{/);
  expectNotContains(componentSource, /function getMinimumNodeHeight\(editorHeight/);
  expectContains(componentSource, /const committedEditorHeight = getNormalizedEditorHeight\(data\.config\.editorHeight\);/);
  expectContains(componentSource, /const editorHeight = resizingEditorHeight \?\? committedEditorHeight;/);
  expectContains(componentSource, /const minimumNodeHeight = getMinimumNodeHeight\(\);/);
});

test('ai image inpaint editor is rendered as a floating shell before the node body', () => {
  expectContains(componentSource, /const floatingEditor = \(/);
  expectContains(componentSource, /className="ai-image-inpaint-node__editor-shell nodrag nopan"/);
  expectContains(componentSource, /data-node-dropzone="body"/);
  expectContains(componentSource, /\{floatingEditor\}[\s\S]*?<div\s+ref=\{wrapperRef\}/);
  expectContains(componentSource, /'--inpaint-editor-gap': `\$\{AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP\}px`/);
  expectContains(componentSource, /className="node-content ai-image-gen-node__content ai-image-inpaint-node__content nodrag nopan"/);
  expectNotContains(
    componentSource,
    /className="node-content ai-image-gen-node__content ai-image-inpaint-node__content nodrag nopan"[\s\S]*?ai-image-inpaint-node__editor-shell/,
    'floating editor must not be nested inside the node body content',
  );
});

test('ai image inpaint handles stay split between editor input and body output', () => {
  expectContains(componentSource, /ai-image-inpaint-node__editor-input-handle/);
  expectContains(componentSource, /top: '50%'/);
  expectContains(componentSource, /const outputHandleTop = Math\.round\(compositeHeight \/ 2\);/);
  expectContains(componentSource, /top: outputHandleTop/);
  expectNotContains(componentSource, /top: 34 \+ editorHeight \/ 2/);
});

test('ai image inpaint stylesheet keeps the floating editor visible and above the body', () => {
  expectContains(cssSource, /\.react-flow__node:has\(\.ai-image-inpaint-node-shell\) \{[\s\S]*?overflow: visible;/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-shell \{[\s\S]*?position: absolute;[\s\S]*?left: 50%;[\s\S]*?right: auto;[\s\S]*?bottom: calc\(100% \+ var\(--inpaint-editor-gap, 12px\)\);/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-shell \{[\s\S]*?width: var\(--inpaint-editor-width, 500px\);[\s\S]*?transform: translateX\(-50%\);/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-shell \{[\s\S]*?height: var\(--inpaint-editor-height, 360px\);[\s\S]*?overflow: visible;/);
  expectContains(cssSource, /\.ai-image-inpaint-node-shell \{[\s\S]*?overflow: visible;[\s\S]*?position: relative;/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor \{[\s\S]*?box-shadow:/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-input-handle \{[\s\S]*?z-index: 7;/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-titlebar \{[\s\S]*?position: absolute;[\s\S]*?bottom: calc\(100% \+ 6px\);/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-titlebar \{[\s\S]*?min-height: 33px;/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-resize-handle \{[\s\S]*?right: -10px;[\s\S]*?top: -10px;/);
  expectContains(cssSource, /\.ai-image-inpaint-node__editor-resize-handle \{[\s\S]*?cursor: nesw-resize;/);
  expectNotContains(cssSource, /\.ai-image-inpaint-editor__topbar/);
  expectNotContains(cssSource, /\.ai-image-inpaint-editor__source-title/);
});

test('ai image inpaint visibility includes floating editor outside the node body', () => {
  expectContains(visibilityRectSource, /export function resolveCanvasNodeVisibilityRect/);
  expectContains(visibilityRectSource, /node\.data\.type !== 'aiImageInpaint'/);
  expectContains(visibilityRectSource, /AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP/);
  expectContains(visibilityRectSource, /resolveAIImageInpaintEditorSize/);
  expectContains(visibilityRectSource, /sourceWidth: node\.data\.config\.maskSourceWidth/);
  expectContains(visibilityRectSource, /const bodyCenterX = bodyRect\.x \+ bodyWidth \/ 2;/);
  expectContains(visibilityRectSource, /const editorX = bodyCenterX - editorSize\.width \/ 2;/);
  expectContains(visibilityRectSource, /y: bodyRect\.y[\s\S]*?- editorSize\.totalHeight[\s\S]*?- AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP[\s\S]*?- AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP[\s\S]*?- AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT/);
  expectContains(visibilityRectSource, /height: bodyHeight[\s\S]*?\+ editorSize\.totalHeight[\s\S]*?\+ AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP[\s\S]*?\+ AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP[\s\S]*?\+ AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT/);
  expectContains(visibilityRectSource, /AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP/);
  expectContains(visibilityRectSource, /AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT/);
  expectContains(canvasSource, /onlyRenderVisibleElements=\{false\}/);
  expectNotContains(canvasSource, /const hasFloatingInpaintEditorNodes = useMemo/);
});

test('ai image inpaint floating editor sizes itself from the source image aspect ratio', () => {
  assert.deepEqual(resolveAIImageInpaintEditorSize({
    editorHeight: 300,
    sourceWidth: 1600,
    sourceHeight: 900,
  }), {
    width: 533,
    height: 300,
    totalHeight: 300 + AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT,
    aspectRatio: 1600 / 900,
  });
  assert.deepEqual(resolveAIImageInpaintEditorSize({
    editorHeight: 800,
    sourceWidth: 3000,
    sourceHeight: 1000,
  }), {
    width: 960,
    height: 320,
    totalHeight: 320 + AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT,
    aspectRatio: 3,
  });
  assert.deepEqual(resolveAIImageInpaintEditorSize({
    editorHeight: 300,
    sourceWidth: 400,
    sourceHeight: 1600,
  }), {
    width: 220,
    height: 880,
    totalHeight: 880 + AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT,
    aspectRatio: 0.25,
  });
  expectContains(componentSource, /function resolveSourceEditorDimensions/);
  expectContains(componentSource, /sourceNode\.imageAsset\?\.intrinsicSize/);
  expectContains(componentSource, /sourceNode\.imageAsset\?\.variants\.original/);
  expectContains(componentSource, /sourceNode\.metadata/);
  expectContains(componentSource, /sourceNode\.dimensions/);
  expectContains(componentSource, /const editorSize = resolveAIImageInpaintEditorSize\(\{/);
  expectContains(componentSource, /'--inpaint-editor-height': `\$\{editorSize\.totalHeight\}px`/);
  expectContains(componentSource, /'--inpaint-editor-width': `\$\{editorSize\.width\}px`/);
  expectContains(cssSource, /\.ai-image-inpaint-editor \{[\s\S]*?grid-template-rows: 1fr auto;/);
  expectContains(cssSource, /\.ai-image-inpaint-editor__stage \{[\s\S]*?height: 100%;/);
  expectContains(cssSource, /\.ai-image-inpaint-editor__frame \{[\s\S]*?position: relative;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
  expectContains(cssSource, /\.ai-image-inpaint-editor__frame--source-ratio \{[\s\S]*?aspect-ratio: var\(--inpaint-source-aspect-ratio\);/);
  expectNotContains(editorSource, /minHeight=\{AI_IMAGE_INPAINT_MIN_EDITOR_HEIGHT\}/);
  expectContains(componentSource, /className="ai-image-inpaint-node__editor-titlebar nodrag nopan"/);
  expectContains(componentSource, /className="ai-image-inpaint-node__editor-source-title"/);
  expectContains(componentSource, /<InpaintXIcon className="ai-image-inpaint-editor__button-icon" \/>/);
  expectNotContains(editorSource, /ai-image-inpaint-editor__topbar/);
  expectNotContains(editorSource, /onRemoveSource/);
  expectNotContains(editorSource, /statusSlot/);
});

test('ai image inpaint editor resize handle uses top-right drag semantics', () => {
  const handleEditorResizeStart = componentSource.search(/const\s+handleEditorResizeStart\s*=\s*useNodeResizeInteraction/);
  const updateImageConfigStart = componentSource.search(/const\s+updateImageConfig\s*=\s*useCallback/);
  assert.ok(handleEditorResizeStart >= 0, 'handleEditorResizeStart source should exist');
  assert.ok(updateImageConfigStart > handleEditorResizeStart, 'handleEditorResizeStart should end before updateImageConfig');
  const resizeSource = componentSource.slice(handleEditorResizeStart, updateImageConfigStart);
  expectContains(resizeSource, /const dominantDelta = Math\.abs\(canvasDelta\.x\) > Math\.abs\(canvasDelta\.y\)/);
  expectContains(resizeSource, /\? canvasDelta\.x\s*: -canvasDelta\.y;/);
  expectContains(resizeSource, /Math\.round\(committedEditorHeight \+ dominantDelta\)/);
  expectContains(resizeSource, /setResizingEditorHeight/);
  expectContains(resizeSource, /commitNodeLocal\(update\);/);
  expectNotContains(resizeSource, /Math\.round\(editorHeight \+ canvasDelta\.y\)/);
});

test('ai image inpaint editor resize avoids workflow node updates and canvas redraws during drag', () => {
  expectContains(componentSource, /const \[resizingEditorHeight, setResizingEditorHeight\] = useState<number \| null>\(null\);/);
  expectContains(componentSource, /deferPreviewResize=\{isEditorResizing\}/);
  expectContains(componentSource, /isEditorResizing \? 'resizing' : editorSize\.height/);

  const resizeStart = componentSource.search(/const\s+handleEditorResizeStart\s*=\s*useNodeResizeInteraction/);
  const updateImageConfigStart = componentSource.search(/const\s+updateImageConfig\s*=\s*useCallback/);
  assert.ok(resizeStart >= 0, 'handleEditorResizeStart source should exist');
  assert.ok(updateImageConfigStart > resizeStart, 'handleEditorResizeStart should end before updateImageConfig');
  const resizeSource = componentSource.slice(resizeStart, updateImageConfigStart);

  expectContains(resizeSource, /applyUpdate: \(update\) => \{/);
  expectContains(resizeSource, /setResizingEditorHeight/);
  expectNotContains(resizeSource, /applyUpdate: updateNodeLocal/);
  expectContains(resizeSource, /onCommit: \(update\) => \{/);
  expectContains(resizeSource, /commitNodeLocal\(update\);/);
});

test('ai image inpaint editor uses split canvas layers for source, mask, and interaction', () => {
  expectContains(editorSource, /className=\{\[[\s\S]*?ai-image-inpaint-editor__frame/);
  expectContains(editorSource, /ref=\{\s*baseCanvasRef\s*\}/);
  expectContains(editorSource, /ref=\{\s*previewMaskCanvasRef\s*\}/);
  expectContains(editorSource, /ai-image-inpaint-editor__canvas--base/);
  expectContains(editorSource, /ai-image-inpaint-editor__canvas--mask/);
  expectContains(editorSource, /ai-image-inpaint-editor__canvas--interaction/);
  expectContains(cssSource, /\.ai-image-inpaint-editor__canvas--base \{[\s\S]*?pointer-events: none;/);
  expectContains(cssSource, /\.ai-image-inpaint-editor__canvas--mask \{[\s\S]*?opacity: 0\.44;[\s\S]*?pointer-events: none;/);
  expectContains(cssSource, /\.ai-image-inpaint-editor__canvas--interaction \{[\s\S]*?z-index: 2;/);
});

test('ai image inpaint pointer coordinates account for React Flow zoom transforms', () => {
  expectContains(editorSource, /export function resolveInpaintCanvasElementLayoutSize/);
  expectContains(editorSource, /element\.clientWidth/);
  expectContains(editorSource, /element\.offsetWidth/);
  expectContains(editorSource, /const stageSize = resolveInpaintCanvasElementLayoutSize\(stage\);/);
  expectContains(editorSource, /resolveInpaintAspectFitSize\(\{/);
  expectContains(editorSource, /export function resolveInpaintCanvasLocalPoint/);
  expectContains(editorSource, /viewport\.width \/ canvasBounds\.width/);
  expectContains(editorSource, /viewport\.height \/ canvasBounds\.height/);
  expectContains(editorSource, /const localPoint = resolveInpaintCanvasLocalPoint\(\{/);
  expectContains(editorSource, /canvasX: localPoint\.canvasX/);
  expectContains(editorSource, /canvasY: localPoint\.canvasY/);
});

test('ai image inpaint canvas resize keeps the previous preview during transient zero-size layout', () => {
  const resizeDisplayCanvasStart = editorSource.search(/function\s+resizeDisplayCanvas/);
  const resizeCanvasToViewportStart = editorSource.search(/function\s+resizeCanvasToViewport/);
  const ensureCanvasPixelSizeStart = editorSource.search(/function\s+ensureCanvasPixelSize/);
  const renderBaseLayerStart = editorSource.search(/const\s+renderBaseLayer\s*=\s*useCallback/);
  const getMaskCanvasStart = editorSource.search(/const\s+getMaskCanvas\s*=\s*useCallback/);
  assert.ok(resizeDisplayCanvasStart >= 0, 'resizeDisplayCanvas source should exist');
  assert.ok(resizeCanvasToViewportStart > resizeDisplayCanvasStart, 'resizeCanvasToViewport should follow resizeDisplayCanvas');
  assert.ok(ensureCanvasPixelSizeStart > resizeCanvasToViewportStart, 'ensureCanvasPixelSize should follow resizeCanvasToViewport');
  assert.ok(renderBaseLayerStart >= 0, 'renderBaseLayer source should exist');
  assert.ok(getMaskCanvasStart > renderBaseLayerStart, 'renderBaseLayer should end before getMaskCanvas');

  const resizeDisplayCanvasSource = editorSource.slice(resizeDisplayCanvasStart, resizeCanvasToViewportStart);
  const resizeCanvasToViewportSource = editorSource.slice(resizeCanvasToViewportStart, ensureCanvasPixelSizeStart);
  const renderBaseLayerSource = editorSource.slice(renderBaseLayerStart, getMaskCanvasStart);

  expectContains(resizeDisplayCanvasSource, /if \(!viewport\.ready\) \{[\s\S]*?return viewport;/);
  expectContains(resizeCanvasToViewportSource, /if \(!viewport\.ready\) \{[\s\S]*?return;/);
  expectContains(renderBaseLayerSource, /if \(!viewport\.ready\) \{[\s\S]*?return null;/);
  expectNotContains(renderBaseLayerSource, /if \(!viewport\.ready\) \{[\s\S]*?clearCanvas/);
});

test('ai image inpaint editor defers preview canvas resize while the editor handle is dragging', () => {
  expectContains(editorSource, /deferPreviewResize\?: boolean;/);
  expectContains(editorSource, /const\s+redrawFrameIdRef\s*=\s*useRef<number \| null>\(null\);/);
  expectContains(editorSource, /const\s+scheduleRedraw\s*=\s*useCallback/);
  expectContains(editorSource, /if \(deferPreviewResize\) \{[\s\S]*?return;/);
  expectContains(editorSource, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?redraw\(\);/);
  expectContains(editorSource, /if \(deferPreviewResize\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?syncDisplayCanvasSize\(\);[\s\S]*?scheduleRedraw\(\);/);
  expectNotContains(editorSource, /const resize = \(\) => \{[\s\S]*?syncDisplayCanvasSize\(\);[\s\S]*?redraw\(\);[\s\S]*?\};/);
});

test('ai image inpaint drag drawing path does not do full-mask image data copies', () => {
  expectContains(editorSource, /const\s+drawStrokePreview\s*=\s*useCallback/);
  const drawStrokePreviewStart = editorSource.search(/const\s+drawStrokePreview\s*=\s*useCallback/);
  const drawStrokePreviewEnd = editorSource.search(/const\s+handlePointerDown\s*=\s*useCallback/);
  assert.ok(drawStrokePreviewStart >= 0, 'drawStrokePreview source should exist');
  assert.ok(drawStrokePreviewEnd > drawStrokePreviewStart, 'drawStrokePreview source should end before handlePointerDown');
  const drawStrokePreviewSource = editorSource.slice(
    drawStrokePreviewStart,
    drawStrokePreviewEnd,
  );
  expectContains(drawStrokePreviewSource, /drawStrokeSegment\(context, stroke, from, to\);/);
  expectContains(drawStrokePreviewSource, /drawPreviewStrokeSegment\(\{/);
  expectNotContains(drawStrokePreviewSource, /putImageData/);
  expectNotContains(drawStrokePreviewSource, /getImageData/);
  expectNotContains(drawStrokePreviewSource, /redraw\(\)/);
});

test('ai image inpaint batches pointer drawing through animation frames', () => {
  expectContains(editorSource, /getCoalescedEvents\?\.\(\)/);
  expectContains(editorSource, /const\s+pendingStrokePointsRef\s*=\s*useRef<ImagePointerPoint\[\]>\(\[\]\);/);
  expectContains(editorSource, /const\s+draftStrokesRef\s*=\s*useRef<AIImageInpaintMaskStroke\[\]>/);
  expectContains(editorSource, /const\s+flushPendingStrokePoints\s*=\s*useCallback/);
  expectContains(editorSource, /window\.requestAnimationFrame\(flushPendingStrokePoints\)/);
  expectContains(editorSource, /queueStrokePoints\(getImagePointsFromPointerEvent\(event\)\);[\s\S]*?flushStrokeFrameNow\(\);/);
  const handlePointerMoveStart = editorSource.search(/const\s+handlePointerMove\s*=\s*useCallback/);
  const handlePointerMoveEnd = editorSource.search(/const\s+handlePointerEnter\s*=\s*useCallback/);
  assert.ok(handlePointerMoveStart >= 0, 'handlePointerMove source should exist');
  assert.ok(handlePointerMoveEnd > handlePointerMoveStart, 'handlePointerMove source should end before handlePointerEnter');
  const handlePointerMoveSource = editorSource.slice(handlePointerMoveStart, handlePointerMoveEnd);
  expectContains(handlePointerMoveSource, /queueStrokePoints\(points\);/);
  expectNotContains(handlePointerMoveSource, /drawStrokePreview\(/);
});

test('ai image inpaint only starts painting with the primary pointer button', () => {
  expectContains(editorSource, /function isPrimaryPointerButton/);
  expectContains(editorSource, /function stopPrimaryPointerEvent/);
  expectContains(editorSource, /onMouseDown=\{stopPrimaryPointerEvent\}/);
  const handlePointerDownStart = editorSource.search(/const\s+handlePointerDown\s*=\s*useCallback/);
  const handlePointerDownEnd = editorSource.search(/const\s+handlePointerMove\s*=\s*useCallback/);
  assert.ok(handlePointerDownStart >= 0, 'handlePointerDown source should exist');
  assert.ok(handlePointerDownEnd > handlePointerDownStart, 'handlePointerDown source should end before handlePointerMove');
  const handlePointerDownSource = editorSource.slice(handlePointerDownStart, handlePointerDownEnd);
  expectContains(handlePointerDownSource, /if \(!isPrimaryPointerButton\(event\)\) \{/);
  expectContains(handlePointerDownSource, /scheduleBrushPreviewUpdate\(null\);/);
  expectContains(handlePointerDownSource, /return;/);
  expectContains(handlePointerDownSource, /stopPointerEvent\(event\);/);
  expectContains(handlePointerDownSource, /setPointerCapture/);
});

test('ai image inpaint pointer up keeps mask edits in memory instead of writing node config', () => {
  const finishPointerStrokeStart = editorSource.search(/const\s+finishPointerStroke\s*=\s*useCallback/);
  const finishPointerStrokeEnd = editorSource.search(/const\s+handlePointerLeave\s*=\s*useCallback/);
  assert.ok(finishPointerStrokeStart >= 0, 'finishPointerStroke source should exist');
  assert.ok(finishPointerStrokeEnd > finishPointerStrokeStart, 'finishPointerStroke source should end before handlePointerLeave');
  const finishPointerStrokeSource = editorSource.slice(finishPointerStrokeStart, finishPointerStrokeEnd);
  expectContains(finishPointerStrokeSource, /draftStrokesRef\.current\s*=\s*\[\.\.\.draftStrokesRef\.current,\s*finishedStroke\];/);
  expectContains(finishPointerStrokeSource, /notifyMaskDraftState\(\);/);
  expectContains(finishPointerStrokeSource, /scheduleMaskSnapshotCommit\(\);/);
  expectNotContains(finishPointerStrokeSource, /onMaskSnapshotCommit/);
  expectNotContains(finishPointerStrokeSource, /commitMaskSnapshot\(\)/);
  expectNotContains(finishPointerStrokeSource, /updateImageConfig/);
  expectNotContains(finishPointerStrokeSource, /onMaskStrokesChange/);
  expectNotContains(finishPointerStrokeSource, /renderMaskCanvasFromStrokes/);
  expectNotContains(finishPointerStrokeSource, /getImageData/);
  expectNotContains(finishPointerStrokeSource, /redraw\(\)/);
});

test('ai image inpaint pointer move and pointer up paths avoid full-mask reads', () => {
  const handlePointerMoveStart = editorSource.search(/const\s+handlePointerMove\s*=\s*useCallback/);
  const handlePointerMoveEnd = editorSource.search(/const\s+handlePointerEnter\s*=\s*useCallback/);
  const finishPointerStrokeStart = editorSource.search(/const\s+finishPointerStroke\s*=\s*useCallback/);
  const finishPointerStrokeEnd = editorSource.search(/const\s+handlePointerLeave\s*=\s*useCallback/);
  assert.ok(handlePointerMoveStart >= 0, 'handlePointerMove source should exist');
  assert.ok(handlePointerMoveEnd > handlePointerMoveStart, 'handlePointerMove source should end before handlePointerEnter');
  assert.ok(finishPointerStrokeStart >= 0, 'finishPointerStroke source should exist');
  assert.ok(finishPointerStrokeEnd > finishPointerStrokeStart, 'finishPointerStroke source should end before handlePointerLeave');
  const hotPathSource = [
    editorSource.slice(handlePointerMoveStart, handlePointerMoveEnd),
    editorSource.slice(finishPointerStrokeStart, finishPointerStrokeEnd),
  ].join('\n');
  expectNotContains(hotPathSource, /getImageData/);
  expectNotContains(hotPathSource, /putImageData/);
  expectNotContains(hotPathSource, /renderMaskCanvasFromStrokes/);
  expectNotContains(hotPathSource, /hasMaskMarks/);
});

test('ai image inpaint export uses current mask canvas and commits after successful blob export', () => {
  const exportMaskStart = editorSource.search(/const\s+exportMaskBlob\s*=\s*useCallback/);
  const exportMaskEnd = editorSource.search(/useEffect\(\(\) => \{\s*if \(!sourceLoadSignature/);
  assert.ok(exportMaskStart >= 0, 'exportMaskBlob source should exist');
  assert.ok(exportMaskEnd > exportMaskStart, 'exportMaskBlob source should end before source loading effect');
  const exportMaskSource = editorSource.slice(exportMaskStart, exportMaskEnd);
  expectContains(exportMaskSource, /flushStrokeFrameNowRef\.current\?\.\(\);/);
  expectContains(exportMaskSource, /const maskCanvas = maskCanvasRef\.current;/);
  expectContains(exportMaskSource, /getImageData\(0,\s*0,\s*imageData\.width,\s*imageData\.height\)/);
  expectContains(exportMaskSource, /if \(!hasMaskMarks\(finalMask\)\)/);
  expectContains(exportMaskSource, /exportInpaintMaskImageDataFromMask\(\{/);
  expectContains(exportMaskSource, /commitMaskSnapshotRef\.current\?\.\(\);/);
  expectNotContains(exportMaskSource, /renderInpaintMaskImageDataFromStrokes/);
  expectNotContains(exportMaskSource, /draftStrokesRef\.current/);
});

test('ai image inpaint clear marks only clears in-memory draft and canvases', () => {
  const handleClearMarksStart = editorSource.search(/const\s+handleClearMarks\s*=\s*useCallback/);
  const handleClearMarksEnd = editorSource.search(/useEffect\(\(\) => \(\) => \{/);
  assert.ok(handleClearMarksStart >= 0, 'handleClearMarks source should exist');
  assert.ok(handleClearMarksEnd > handleClearMarksStart, 'handleClearMarks source should end before cleanup effect');
  const handleClearMarksSource = editorSource.slice(handleClearMarksStart, handleClearMarksEnd);
  expectContains(handleClearMarksSource, /clearMaskDraftState\(\{/);
  expectContains(handleClearMarksSource, /lastRestoredPersistedSnapshotSignatureRef\.current = \[/);
  expectContains(handleClearMarksSource, /createAIImageInpaintMaskStrokesSignature\(\[\]\)/);
  expectContains(handleClearMarksSource, /commitMaskSnapshot\(\);/);
  expectNotContains(handleClearMarksSource, /onMaskStrokesChange/);
  expectNotContains(handleClearMarksSource, /renderMaskCanvasFromStrokes/);
});

test('ai image inpaint restores persisted masks once per matching source snapshot', () => {
  expectContains(editorSource, /lastRestoredPersistedSnapshotSignatureRef/);
  expectContains(editorSource, /createInpaintMaskSourceSignature\(sourceInfo\)/);
  expectContains(editorSource, /createAIImageInpaintMaskStrokesSignature\(maskStrokes\)/);
  expectContains(editorSource, /if \(lastRestoredPersistedSnapshotSignatureRef\.current === restoreSignature\) \{[\s\S]*?return;/);
  expectContains(editorSource, /const nextMaskCanvas = renderMaskCanvasFromStrokes\(image\.width,\s*image\.height,\s*maskStrokes\);/);
});

test('ai image inpaint parent syncs only lightweight mask state during editing', () => {
  expectNotContains(componentSource, /hasInpaintMaskStrokeMarks/);
  expectNotContains(componentSource, /onMaskStrokesChange=/);
  expectNotContains(componentSource, /handleMaskStrokesChange/);
  expectContains(componentSource, /const\s+handleMaskDraftStateChange\s*=\s*useCallback/);
  expectContains(componentSource, /syncLightweightMaskConfig\(state\);/);

  const syncLightweightStart = componentSource.search(/const\s+syncLightweightMaskConfig\s*=\s*useCallback/);
  const syncLightweightEnd = componentSource.search(/useEffect\(\(\) => \{\s*const modelChanged/);
  assert.ok(syncLightweightStart >= 0, 'syncLightweightMaskConfig source should exist');
  assert.ok(syncLightweightEnd > syncLightweightStart, 'syncLightweightMaskConfig should end before normalization effect');
  const syncLightweightSource = componentSource.slice(syncLightweightStart, syncLightweightEnd);
  expectContains(syncLightweightSource, /patch\.hasMaskMarks = nextHasMaskMarks;/);
  expectContains(syncLightweightSource, /patch\.maskSourceFileId = source\.fileId;/);
  expectContains(syncLightweightSource, /patch\.maskSourceWidth = source\.width;/);
  expectContains(syncLightweightSource, /patch\.maskSourceHeight = source\.height;/);
  expectNotContains(syncLightweightSource, /maskStrokes/);
});

test('ai image inpaint parent commits full mask snapshot only before running', () => {
  const handleRunStart = componentSource.search(/const\s+handleRun\s*=\s*useCallback/);
  const handleRunEnd = componentSource.search(/const\s+handleCancel\s*=\s*useCallback/);
  assert.ok(handleRunStart >= 0, 'handleRun source should exist');
  assert.ok(handleRunEnd > handleRunStart, 'handleRun source should end before handleCancel');
  const handleRunSource = componentSource.slice(handleRunStart, handleRunEnd);
  expectContains(handleRunSource, /commitMaskSnapshot\(\)/);
  expectNotContains(handleRunSource, /maskStrokes: snapshot\.strokes/);
  expectNotContains(handleRunSource, /patchNodeConfig/);
  expectContains(componentSource, /commitSnapshot: \(\) => maskEditorStateRef\.current\?\.commitMaskSnapshot\(\) \?\? null/);
  expectContains(componentSource, /exportMask: \(\{ mode \}\) => \{/);

  const handleDraftStart = componentSource.search(/const\s+handleMaskDraftStateChange\s*=\s*useCallback/);
  const handleDraftEnd = componentSource.search(/const\s+handleMaskSnapshotCommit\s*=\s*useCallback/);
  assert.ok(handleDraftStart >= 0, 'handleMaskDraftStateChange source should exist');
  assert.ok(handleDraftEnd > handleDraftStart, 'handleMaskDraftStateChange should end before snapshot handler');
  const handleDraftSource = componentSource.slice(handleDraftStart, handleDraftEnd);
  expectNotContains(handleDraftSource, /maskStrokes/);

  const snapshotCommitStart = componentSource.search(/const\s+handleMaskSnapshotCommit\s*=\s*useCallback/);
  const snapshotCommitEnd = componentSource.search(/const\s+floatingEditor\s*=\s*\(/);
  assert.ok(snapshotCommitStart >= 0, 'handleMaskSnapshotCommit source should exist');
  assert.ok(snapshotCommitEnd > snapshotCommitStart, 'handleMaskSnapshotCommit should end before floating editor');
  const snapshotCommitSource = componentSource.slice(snapshotCommitStart, snapshotCommitEnd);
  expectContains(snapshotCommitSource, /maskStrokes: snapshot\.strokes/);
  expectContains(snapshotCommitSource, /maskSourceFileId: snapshot\.sourceInfo\.fileId/);
});

test('ai image inpaint editor auto commits snapshots after editing pauses and on unmount', () => {
  expectContains(editorSource, /MASK_SNAPSHOT_AUTO_COMMIT_DELAY_MS = 4000/);
  expectContains(editorSource, /const\s+autoCommitTimerRef\s*=\s*useRef/);
  expectContains(editorSource, /const\s+lastCommittedSnapshotSignatureRef\s*=\s*useRef/);
  expectContains(editorSource, /const\s+scheduleMaskSnapshotCommit\s*=\s*useCallback/);
  expectContains(editorSource, /window\.setTimeout\(\(\) => \{[\s\S]*?commitMaskSnapshot\(\);[\s\S]*?\}, MASK_SNAPSHOT_AUTO_COMMIT_DELAY_MS\)/);
  expectContains(editorSource, /if \(!draftRef\.current\.dirty && lastCommittedSnapshotSignatureRef\.current === signature\)/);
  expectContains(editorSource, /return sourceInfo[\s\S]*?strokes: cloneInpaintMaskStrokes\(draftStrokesRef\.current\)/);
  expectContains(editorSource, /useEffect\(\(\) => \(\) => \{[\s\S]*?commitMaskSnapshot\(\);[\s\S]*?clearAutoCommitTimer\(\);/);
});

test('ai image inpaint source removal and snapshot callback persist or clear full masks explicitly', () => {
  const handleRemoveStart = componentSource.search(/const\s+handleRemoveSource\s*=\s*useCallback/);
  const handleRemoveEnd = componentSource.search(/const\s+shellClasses\s*=\s*\[/);
  assert.ok(handleRemoveStart >= 0, 'handleRemoveSource source should exist');
  assert.ok(handleRemoveEnd > handleRemoveStart, 'handleRemoveSource should end before shell classes');
  const handleRemoveSource = componentSource.slice(handleRemoveStart, handleRemoveEnd);
  expectNotContains(handleRemoveSource, /commitMaskSnapshot\(\);/);
  expectContains(handleRemoveSource, /maskStrokes: \[\]/);
  expectContains(handleRemoveSource, /maskSourceFileId: undefined/);

});

test('ai image inpaint source changes clear draft and persisted snapshot state', () => {
  expectContains(editorSource, /const hasPersistedMask = maskStrokes\.length > 0/);
  expectContains(editorSource, /lastRestoredPersistedSnapshotSignatureRef\.current = null;/);
  expectContains(editorSource, /clearMaskDraftState\(\{[\s\S]*?sourceInfo,[\s\S]*?dirty: hasPersistedMask/);
  expectContains(editorSource, /if \(hasPersistedMask\) \{[\s\S]*?commitMaskSnapshot\(\);/);
});
