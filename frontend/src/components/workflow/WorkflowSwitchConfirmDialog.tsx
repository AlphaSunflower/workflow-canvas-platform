import { memo } from 'react';

import type {
  WorkflowSwitchDecision,
  WorkflowSwitchRequestContext,
} from '../context/workflow-context.types';
import { Modal } from '../ui/primitives';

interface WorkflowSwitchConfirmDialogProps {
  isOpen: boolean;
  context: WorkflowSwitchRequestContext | null;
  isSaving: boolean;
  onDecision: (decision: WorkflowSwitchDecision) => void;
}

const TARGET_LABELS: Record<WorkflowSwitchRequestContext['targetKind'], string> = {
  workflow: '\u5207\u6362\u753b\u5e03',
  'new-blank': '\u65b0\u5efa\u7a7a\u767d\u753b\u5e03',
};

export const WorkflowSwitchConfirmDialog = memo(({
  isOpen,
  context,
  isSaving,
  onDecision,
}: WorkflowSwitchConfirmDialogProps) => {
  if (!context) {
    return null;
  }

  const saveDisabled = isSaving || !context.canSave;
  const footer = (
    <>
      <button
        className="btn btn--secondary"
        type="button"
        onClick={() => onDecision('cancel')}
        disabled={isSaving}
      >
        {'\u53d6\u6d88'}
      </button>
      <button
        className="btn btn--secondary"
        type="button"
        onClick={() => onDecision('discard')}
        disabled={isSaving}
      >
        {'\u4e0d\u4fdd\u5b58'}
      </button>
      <button
        className="btn btn--primary"
        type="button"
        onClick={() => onDecision('save')}
        disabled={saveDisabled}
        title={!context.canSave ? (context.saveBlockedReason ?? '\u5f53\u524d\u65e0\u6cd5\u4fdd\u5b58') : undefined}
      >
        {isSaving ? '\u4fdd\u5b58\u4e2d' : '\u4fdd\u5b58\u5e76\u7ee7\u7eed'}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => onDecision('cancel')}
      title={TARGET_LABELS[context.targetKind]}
      size="sm"
      footer={footer}
      closeOnBackdrop={!isSaving}
      closeOnEscape={!isSaving}
      showCloseButton={!isSaving}
    >
      <div className="workflow-switch-confirm-dialog">
        <p className="workflow-switch-confirm-dialog__message">
          {`\u5f53\u524d\u753b\u5e03\u5b58\u5728\u672a\u4fdd\u5b58\u5185\u5bb9\uff0c\u662f\u5426\u5728${context.targetKind === 'new-blank' ? '\u65b0\u5efa\u524d' : '\u5207\u6362\u524d'}\u5148\u4fdd\u5b58\uff1f`}
        </p>
        <div className="workflow-switch-confirm-dialog__target">
          {`\u76ee\u6807\uff1a${context.targetLabel}`}
        </div>
        {!context.canSave && context.saveBlockedReason ? (
          <div className="workflow-switch-confirm-dialog__warning" role="status">
            {`\u5f53\u524d\u65e0\u6cd5\u4fdd\u5b58\uff1a${context.saveBlockedReason}\u3002\u4f60\u4ecd\u53ef\u4ee5\u9009\u62e9\u201c\u4e0d\u4fdd\u5b58\u201d\u6216\u201c\u53d6\u6d88\u201d\u3002`}
          </div>
        ) : null}
      </div>
    </Modal>
  );
});

WorkflowSwitchConfirmDialog.displayName = 'WorkflowSwitchConfirmDialog';
