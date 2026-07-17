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
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.width, 1080);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.height, 760);
  assert.equal(AI_STORYBOARD_MIN_WIDTH, 860);
  assert.equal(AI_STORYBOARD_MIN_HEIGHT, 620);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.width > AI_STORYBOARD_MIN_WIDTH, true);
  assert.equal(AI_STORYBOARD_DEFAULT_SIZE.height > AI_STORYBOARD_MIN_HEIGHT, true);
});

test('storyboard component keeps the workbench shell and lightweight execution status region', () => {
  expectContains(componentSource, /className=\{\[\s*'node-wrapper',\s*'ai-node',\s*'ai-storyboard-node'/);
  expectContains(componentSource, /className="node-content ai-storyboard-node__content grouped-drop-input-region nodrag nopan"/);
  expectContains(componentSource, /ai-storyboard-node__workspace-top/);
  expectContains(componentSource, /data-storyboard-status-region="node-execution"/);
  expectContains(componentSource, /ai-storyboard-node__section--toolbar/);
  expectContains(componentSource, /ai-storyboard-node__section--batch-video/);
  expectContains(componentSource, /ai-storyboard-node__section--meta/);
  expectContains(componentSource, /ai-storyboard-node__drop-targets/);
  expectContains(componentSource, /ai-storyboard-node__main custom-scrollbar/);
  expectNotContains(componentSource, /placeholder shell/i);
  expectNotContains(componentSource, /runStoryboardDecompose/);
  expectNotContains(componentSource, /KeepShotsDialog/);
  expectNotContains(componentSource, /showJson/);
});

test('storyboard stylesheet keeps dedicated handles, status panel, and drop anchors', () => {
  expectContains(cssSource, /\.ai-storyboard-node__handle \{/);
  expectContains(cssSource, /\.ai-storyboard-node__handle::before \{/);
  expectContains(cssSource, /\.ai-storyboard-node__handle--input \{\s*left: -10px;/);
  expectContains(cssSource, /\.ai-storyboard-node__handle--output \{\s*right: -10px;/);
  expectContains(cssSource, /\.ai-storyboard-node__status-region \{/);
  expectContains(cssSource, /\.ai-storyboard-node__status-panel \{/);
  expectContains(cssSource, /\.ai-storyboard-node__drop-targets \{[\s\S]*?pointer-events: none;/s);
  expectContains(cssSource, /\.ai-storyboard-node__drop-target-anchor \{[\s\S]*?pointer-events: none;/s);
  expectContains(cssSource, /\.ai-storyboard-node__drop-slot-anchor \{[\s\S]*?pointer-events: none;/s);
  expectContains(cssSource, /\.ai-storyboard-shot-card \{/);
  expectContains(cssSource, /\.ai-storyboard-shot-grid-card \{/);
  expectContains(cssSource, /\.ai-storyboard-shot-table-shell \{/);
  expectContains(cssSource, /\.ai-storyboard-status-badge \{/);
  expectContains(cssSource, /\.ai-storyboard-shot-empty-state \{/);
});

test('storyboard stylesheet no longer keeps removed legacy dialog and broad article fallback rules', () => {
  expectNotContains(cssSource, /\.ai-storyboard-dialog \{/);
  expectNotContains(cssSource, /\.ai-storyboard-node__json-preview \{/);
  expectNotContains(cssSource, /\.ai-storyboard-meta__layout-row \{/);
  expectNotContains(cssSource, /\.ai-storyboard-workbench__button--chip \{/);
  expectNotContains(cssSource, /\.ai-storyboard-node article \{/);
  expectNotContains(cssSource, /\.ai-storyboard-node article \[style\*=/);
});
