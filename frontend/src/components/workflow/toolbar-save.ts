import type { WorkflowContextActions, WorkflowContextState, WorkflowContextRuntime } from '../context/workflow-context.types';
import { createModuleLogger, shouldIgnoreGlobalKeyboardShortcut } from '../../utils';

const log = createModuleLogger('toolbar');

export async function runToolbarSave(
  actions: Pick<WorkflowContextActions, 'saveWorkflow'>,
  state: Pick<WorkflowContextState, 'canSave' | 'saveBlockedReason'>,
  notification: Pick<WorkflowContextRuntime['notification'], 'showWarning' | 'showSuccess' | 'showError'>,
): Promise<void> {
  if (!state.canSave) {
    notification.showWarning('暂时无法保存', state.saveBlockedReason ?? '当前不可保存');
    return;
  }

  try {
    await actions.saveWorkflow({ force: true, silent: false, reason: 'manual' });
    notification.showSuccess('保存成功', '当前画布已保存到后端。');
    log.info('runToolbarSave', 'Workflow saved to backend');
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存当前画布失败';
    notification.showError('保存失败', message);
    log.error('runToolbarSave', 'Failed to save workflow to backend', error instanceof Error ? error : undefined);
  }
}

export function shouldTriggerToolbarSaveShortcut(event: KeyboardEvent): boolean {
  if (shouldIgnoreGlobalKeyboardShortcut(event)) {
    return false;
  }

  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return false;
  }

  return event.key.toLowerCase() === 's';
}
