import test from 'node:test';
import assert from 'node:assert/strict';

test('toolbar save helper keeps Ctrl+S/Cmd+S routing and input-ignore rules in one place', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const toolbarSaveSource = readFileSync(
    `${cwd}/src/components/workflow/toolbar-save.ts`,
    'utf8',
  );

  assert.equal(
    toolbarSaveSource.includes('shouldIgnoreGlobalKeyboardShortcut(event)'),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes('if (!(event.ctrlKey || event.metaKey) || event.altKey) {'),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes("return event.key.toLowerCase() === 's';"),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes("await actions.saveWorkflow({ force: true, silent: false, reason: 'manual' });"),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes("notification.showWarning('暂时无法保存', state.saveBlockedReason ?? '当前不可保存');"),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes("notification.showSuccess('保存成功', '当前画布已保存到后端。');"),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes("notification.showError('保存失败', message);"),
    true,
  );
});
