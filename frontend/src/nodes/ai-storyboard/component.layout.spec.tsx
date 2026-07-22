import test from 'node:test';
import assert from 'node:assert/strict';

import { aiStoryboardExecution } from './runtime';
import {
  AI_STORYBOARD_DEFAULT_SIZE,
  AI_STORYBOARD_MIN_HEIGHT,
  AI_STORYBOARD_MIN_WIDTH,
} from './constants';

const importNodeFs = new Function('return import("node:fs")') as () => Promise<{
  readFileSync: (path: URL | string, encoding: string) => string;
}>;
const { readFileSync } = await importNodeFs();
const frontendRoot = (new Function('return process.cwd()') as () => string)();
const componentSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-storyboard/component.tsx`,
  'utf8',
);
const definitionSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-storyboard/index.tsx`,
  'utf8',
);
const cssSource = readFileSync(
  `${frontendRoot}/src/index.css`,
  'utf8',
);
const shotPreviewSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-storyboard/views/StoryboardShotPreview.tsx`,
  'utf8',
);
const shotTimelineSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-storyboard/views/ShotTimelineView.tsx`,
  'utf8',
);

function expectContains(source: string, pattern: RegExp, message?: string): void {
  assert.equal(pattern.test(source), true, message ?? `Expected source to match ${pattern}`);
}

function expectNotContains(source: string, pattern: RegExp, message?: string): void {
  assert.equal(pattern.test(source), false, message ?? `Expected source not to match ${pattern}`);
}

test('storyboard node definition keeps workbench default size above minimum size floor', () => {
  assert.equal(aiStoryboardExecution.mode, 'node-action-only');
  assert.equal(aiStoryboardExecution.canRun({} as never, []).valid, true);
  expectContains(definitionSource, /defaultSize:\s*AI_STORYBOARD_DEFAULT_SIZE/);
  expectContains(definitionSource, /stage:\s*'full'/);
  expectContains(definitionSource, /execution:\s*aiStoryboardExecution/);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.width, 920);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.height, 212);
  assert.equal(AI_STORYBOARD_MIN_WIDTH, 760);
  assert.equal(AI_STORYBOARD_MIN_HEIGHT, 200);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.width > AI_STORYBOARD_MIN_WIDTH, true);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.height > AI_STORYBOARD_MIN_HEIGHT, true);
});

test('storyboard component keeps the workbench shell and lightweight execution status region', () => {
  expectContains(componentSource, /'ai-storyboard-node-shell'/);
  expectContains(componentSource, /const wrapperClasses = \[\s*'node-wrapper',\s*'ai-node',\s*'ai-storyboard-node',\s*'grouped-drop-input-region'/);
  expectContains(componentSource, /className=\{wrapperClasses\}/);
  expectContains(componentSource, /className=\{wrapperClasses\}[\s\S]*?\{\.\.\.inputRegionProps\}/);
  expectContains(componentSource, /className=\{shellClasses\}[\s\S]*?data-node-dropzone="body"/);
  expectContains(componentSource, /className="node-content ai-storyboard-node__content nodrag nopan"/);
  expectNotContains(componentSource, /className="node-content ai-storyboard-node__content grouped-drop-input-region nodrag nopan"/);
  expectContains(componentSource, /ai-storyboard-node__workspace-top/);
  expectContains(componentSource, /contentMeasureRef/);
  expectContains(componentSource, /manualResizeLockRef/);
  expectContains(componentSource, /ResizeObserver/);
  expectContains(componentSource, /resolveAIStoryboardMeasuredContentHeight/);
  expectContains(componentSource, /resolveAIStoryboardAutoDimensions/);
  expectContains(componentSource, /manualResizeLockRef\.current = true;/);
  expectContains(componentSource, /manualResizeLockRef\.current\)/);
  expectContains(componentSource, /minHeight:\s*nodeHeight/);
  expectNotContains(componentSource, /height:\s*nodeHeight/);
  expectContains(componentSource, /data-storyboard-status-region="node-execution"/);
  expectNotContains(componentSource, /StoryboardInputStrip/);
  expectContains(componentSource, /ai-storyboard-primary-toolbar/);
  expectContains(componentSource, /ai-storyboard-workbench__button--video-primary/);
  expectContains(componentSource, /const dropHintText = '拖入图片到节点本体可添加分镜';/);
  expectContains(componentSource, /className="ai-storyboard-node__drop-hint"[\s\S]*?\{dropHintText\}/);
  expectContains(componentSource, /ShotTimelineView/);
  expectContains(componentSource, /\{shotCount > 0 \? \([\s\S]*?className="ai-storyboard-node__shot-dock nodrag nopan"[\s\S]*?<ShotTimelineView \{\.\.\.storyboardViewProps\} \/>[\s\S]*?\) : null\}/);
  expectContains(componentSource, /getAIStoryboardOutputHandle/);
  expectContains(componentSource, /const legacyOutputHandle = getAIStoryboardOutputHandle\(primaryGroupId\);/);
  expectContains(componentSource, /id=\{legacyOutputHandle\}[\s\S]*?type="source"[\s\S]*?ai-storyboard-node__handle--legacy-output/);
  expectContains(componentSource, /nodeColor,/);
  expectContains(componentSource, /shotHandleVersion/);
  expectContains(componentSource, /ai-storyboard-node__section--toolbar/);
  expectContains(componentSource, /ai-storyboard-node__section--batch-video/);
  expectContains(componentSource, /ai-storyboard-node__drop-targets/);
  expectNotContains(componentSource, /emptyStateText/);
  expectNotContains(componentSource, /data-storyboard-legacy-empty-state/);
  expectNotContains(componentSource, /ai-storyboard-node__main custom-scrollbar/);
  expectNotContains(componentSource, /placeholder shell/i);
  expectNotContains(componentSource, /runStoryboardDecompose/);
  expectNotContains(componentSource, /KeepShotsDialog/);
  expectNotContains(componentSource, /showJson/);

  const nodeContentIndex = componentSource.indexOf('className="node-content ai-storyboard-node__content nodrag nopan"');
  const nodeFooterIndex = componentSource.indexOf('className="node-footer ai-storyboard-node__footer"');
  const inputHandleIndex = componentSource.indexOf('id={`${primaryGroupId}:${AI_STORYBOARD_INPUT_PORT_ID}`}');
  const shotDockIndex = componentSource.indexOf('className="ai-storyboard-node__shot-dock nodrag nopan"');
  assert.equal(nodeContentIndex >= 0, true);
  assert.equal(nodeFooterIndex > nodeContentIndex, true);
  assert.equal(inputHandleIndex > nodeFooterIndex, true);
  assert.equal(shotDockIndex > inputHandleIndex, true);
  expectNotContains(componentSource, /ai-storyboard-node__shot-layer/);
});

test('storyboard stylesheet keeps dedicated handles, status panel, and drop anchors', () => {
  expectContains(cssSource, /\.ai-storyboard-node-shell \{/);
  expectContains(cssSource, /\.ai-storyboard-node-shell \{[\s\S]*?min-width: 760px;/);
  expectContains(cssSource, /\.ai-storyboard-node-shell::before \{[\s\S]*?display: none;/);
  expectContains(cssSource, /\.ai-storyboard-node__auto-content \{[\s\S]*?flex: 1;[\s\S]*?min-height: 0;/);
  expectContains(cssSource, /\.ai-storyboard-node-shell:hover \.ai-storyboard-node \{/);
  expectContains(cssSource, /\.ai-storyboard-node-shell\[data-drop-hover='true'\]\[data-drop-valid='true'\] \.ai-storyboard-node \{/);
  expectContains(cssSource, /\.ai-storyboard-node__shot-dock \{/);
  expectNotContains(cssSource, /\.ai-storyboard-node__shot-layer \{/);
  expectContains(cssSource, /\.ai-storyboard-node__handle \{/);
  expectContains(cssSource, /\.ai-storyboard-node__handle::before \{/);
  expectContains(cssSource, /\.ai-storyboard-node__handle--input \{\s*left: -10px;/);
  expectContains(cssSource, /\.ai-storyboard-node__handle--legacy-output \{[\s\S]*?right: -10px;[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  expectContains(cssSource, /\.ai-storyboard-shot-row__output-handle \{/);
  expectContains(cssSource, /\.ai-storyboard-node__status-region \{/);
  expectContains(cssSource, /\.ai-storyboard-node__status-panel \{/);
  expectContains(cssSource, /\.ai-storyboard-node__footer \{[\s\S]*?margin-top: auto;/);
  expectContains(cssSource, /\.ai-storyboard-node__drop-hint \{[\s\S]*?font-size: 12px;[\s\S]*?color: #94a3b8;/);
  expectContains(cssSource, /\.ai-storyboard-node__drop-targets \{[\s\S]*?pointer-events: none;/s);
  expectContains(cssSource, /\.ai-storyboard-node__drop-target-anchor \{[\s\S]*?pointer-events: none;/s);
  expectContains(cssSource, /\.ai-storyboard-node__drop-slot-anchor \{[\s\S]*?pointer-events: none;/s);
  expectContains(cssSource, /\.ai-storyboard-primary-toolbar \{/);
  expectContains(cssSource, /\.ai-storyboard-workbench__button--video-primary \{/);
  expectContains(cssSource, /\.ai-storyboard-shot-timeline \{/);
  expectContains(cssSource, /\.ai-storyboard-shot-row \{[\s\S]*?grid-template-columns: 172px minmax\(0, 1fr\) auto;[\s\S]*?min-width: 0;/);
  expectContains(cssSource, /\.ai-storyboard-shot-row__preview \{[\s\S]*?align-self: center;[\s\S]*?overflow: hidden;[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?aspect-ratio: 16 \/ 9;/);
  expectContains(cssSource, /\.ai-storyboard-shot-preview \{[\s\S]*?aspect-ratio: 16 \/ 9;/);
  expectContains(cssSource, /\.ai-storyboard-shot-grid-card__preview \{[\s\S]*?aspect-ratio: 16 \/ 9;/);
  expectContains(cssSource, /\.ai-storyboard-shot-preview__image \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  expectContains(cssSource, /\.ai-storyboard-shot-preview__button \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?cursor: zoom-in;/);
  expectContains(cssSource, /\.ai-storyboard-shot-viewer__stage \{[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/);
  expectContains(cssSource, /\.ai-storyboard-shot-viewer__image \{[\s\S]*?max-width: min\(92vw, 1600px\);[\s\S]*?max-height: min\(82vh, 1000px\);[\s\S]*?object-fit: contain;/);
  expectContains(cssSource, /\.ai-storyboard-shot-card \{/);
  expectContains(cssSource, /\.ai-storyboard-shot-grid-card \{/);
  expectContains(cssSource, /\.ai-storyboard-shot-grid-card__image-wrap \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?overflow: hidden;/);
  expectContains(cssSource, /\.ai-storyboard-shot-table-shell \{/);
  expectContains(cssSource, /\.ai-storyboard-status-badge \{/);
  expectNotContains(cssSource, /\.ai-storyboard-shot-empty-state/);
  expectNotContains(cssSource, /\.ai-storyboard-shot-add-card/);
  expectNotContains(cssSource, /\.ai-storyboard-shot-grid-add/);
});

test('storyboard shot timeline renders one source handle per shot row', () => {
  expectContains(shotTimelineSource, /import \{ Handle, Position \} from 'reactflow';/);
  expectContains(shotTimelineSource, /getAIStoryboardShotOutputHandle/);
  expectContains(shotTimelineSource, /id=\{getAIStoryboardShotOutputHandle\(shot\.id\)\}/);
  expectContains(shotTimelineSource, /type="source"/);
  expectContains(shotTimelineSource, /position=\{Position\.Right\}/);
  expectContains(shotTimelineSource, /ai-storyboard-shot-row__output-handle/);
  expectContains(shotTimelineSource, /if \(shots\.length === 0\) \{[\s\S]*?return null;/);
  expectNotContains(shotTimelineSource, /emptyStateText/);
  expectNotContains(shotTimelineSource, /ai-storyboard-shot-empty-state/);
});

test('storyboard shot previews keep a thumbnail fallback independent of low-zoom canvas scheduling', () => {
  expectContains(shotPreviewSource, /getFileNodeImageThumbnailUrl/);
  expectContains(shotPreviewSource, /createPortal/);
  expectContains(shotPreviewSource, /viewerOpen/);
  expectContains(shotPreviewSource, /ai-storyboard-shot-preview__button/);
  expectContains(shotPreviewSource, /file-node__viewer-backdrop/);
  expectContains(shotPreviewSource, /const sourceThumbnailUrl = sourceNode && sourceNode\.type === 'image'[\s\S]*?getFileNodeImageThumbnailUrl\(sourceNode\)/);
  expectContains(shotPreviewSource, /const protectedResourceUrl = activeSrc \?\? imageResource\.requestUrl \?\? sourceThumbnailUrl;/);
  expectContains(shotPreviewSource, /const resolvedSrc = isVideo[\s\S]*?\? videoDirectUrl[\s\S]*?: \(imageResource\.src \?\? protectedResource\.resolvedUrl\);/);
});

test('storyboard stylesheet no longer keeps removed legacy dialog and broad article fallback rules', () => {
  expectNotContains(cssSource, /\.ai-storyboard-dialog \{/);
  expectNotContains(cssSource, /\.ai-storyboard-node__json-preview \{/);
  expectNotContains(cssSource, /\.ai-storyboard-meta__layout-row \{/);
  expectNotContains(cssSource, /\.ai-storyboard-workbench__button--chip \{/);
  expectNotContains(cssSource, /\.ai-storyboard-node article \{/);
  expectNotContains(cssSource, /\.ai-storyboard-node article \[style\*=/);
});
