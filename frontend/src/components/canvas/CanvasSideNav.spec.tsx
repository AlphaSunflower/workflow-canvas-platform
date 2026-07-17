import test from 'node:test';
import assert from 'node:assert/strict';

async function readSource(relativePath: string): Promise<string> {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);

  return readFileSync(
    `${processLike.process?.cwd() ?? '.'}/${relativePath}`,
    'utf8',
  );
}

test('CanvasSideNav defines task history as a left-nav control', async () => {
  const source = await readSource('src/components/canvas/CanvasSideNav.tsx');

  assert.ok(/id:\s*'task-history'/.test(source));
  assert.ok(/label:\s*'任务历史'/.test(source));
  assert.ok(/title:\s*showTaskHistory\s*\?\s*'隐藏任务历史'\s*:\s*'显示任务历史'/.test(source));
  assert.ok(/active:\s*showTaskHistory/.test(source));
  assert.ok(/onClick:\s*onToggleTaskHistory/.test(source));
});

test('App keeps task history collapsed by default and wires the side-nav toggle to Canvas', async () => {
  const source = await readSource('src/App.tsx');

  assert.ok(/const\s+\[showTaskHistory,\s*setShowTaskHistory\]\s*=\s*useState\(false\)/.test(source));
  assert.ok(/setShowTaskHistory\(\(current\)\s*=>\s*!current\)/.test(source));
  assert.ok(/<Canvas[\s\S]*showTaskHistory=\{showTaskHistory\}/.test(source));
  assert.ok(/<CanvasSideNav[\s\S]*showTaskHistory=\{showTaskHistory\}/.test(source));
  assert.ok(/onToggleTaskHistory=\{handleToggleTaskHistory\}/.test(source));
});
