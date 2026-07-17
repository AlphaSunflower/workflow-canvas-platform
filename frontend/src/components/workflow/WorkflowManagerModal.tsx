import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { workflowApi } from '@/api';
import type {
  UUID,
  Workflow,
  WorkflowManagerGroupSummary,
  WorkflowManagerItem,
  WorkflowManagerList,
} from '@/types';
import { Modal } from '../ui/primitives';
import {
  AUTO_NAMED_LABEL,
  buildWorkflowManagerSections,
  CURRENT_WORKFLOW_LABEL,
  formatWorkflowManagerTime,
  getWorkflowGroupLabel,
  getWorkflowSummaryText,
  loadManagedWorkflowById,
  UNGROUPED_CONTAINER_LABEL,
} from './workflow-manager-modal.shared';

interface WorkflowManagerModalProps {
  isOpen: boolean;
  currentWorkflowId: UUID | null;
  currentWorkflowName: string | null;
  onClose: () => void;
  onCreateBlank: () => void;
  onOpenWorkflow: (workflow: Workflow) => void;
  onCurrentWorkflowPatched: (workflow: Workflow) => void;
  onCurrentWorkflowDeleted: () => void;
  onBeforeSwitch: (request: {
    targetKind: 'workflow' | 'new-blank';
    targetLabel: string;
  }) => Promise<boolean>;
  onNotifySuccess: (title: string, message?: string) => void;
  onNotifyError: (title: string, message?: string) => void;
}

type WorkflowManagerBusyAction =
  | 'refresh'
  | `create:${string}`
  | `workflow:${string}:${string}`
  | `group:${string}:${string}`;

interface WorkflowManagerDeleteConfirmation {
  kind: 'workflow' | 'group';
  id: string;
  title: string;
  message: string;
  confirmLabel: string;
  busyAction: WorkflowManagerBusyAction;
  onConfirm: () => Promise<void>;
}

export const WorkflowManagerModal = memo(({
  isOpen,
  currentWorkflowId,
  currentWorkflowName,
  onClose,
  onCreateBlank,
  onOpenWorkflow,
  onCurrentWorkflowPatched,
  onCurrentWorkflowDeleted,
  onBeforeSwitch,
  onNotifySuccess,
  onNotifyError,
}: WorkflowManagerModalProps) => {
  const [managerList, setManagerList] = useState<WorkflowManagerList | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<WorkflowManagerBusyAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<WorkflowManagerDeleteConfirmation | null>(null);

  const isBusy = busyAction !== null;
  const groupOptions = useMemo(
    () => managerList?.groups.slice().sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')) ?? [],
    [managerList],
  );
  const sections = useMemo(
    () => (managerList ? buildWorkflowManagerSections(managerList) : []),
    [managerList],
  );

  const refreshList = useCallback(async (): Promise<void> => {
    setBusyAction('refresh');
    setErrorMessage(null);

    const result = await workflowApi.listManaged();
    if (!result.success) {
      setErrorMessage(result.error.message);
      setBusyAction(null);
      return;
    }

    setManagerList(result.data);
    setBusyAction(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setIsLoading(true);
    void refreshList().finally(() => {
      setIsLoading(false);
    });
  }, [isOpen, refreshList]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setManagerList(null);
    setBusyAction(null);
    setIsLoading(false);
    setErrorMessage(null);
    setDeleteConfirmation(null);
  }, [isOpen]);

  const handleManagedAction = useCallback(async (
    actionKey: WorkflowManagerBusyAction,
    run: () => Promise<void>,
  ): Promise<void> => {
    setBusyAction(actionKey);
    setErrorMessage(null);

    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '\u64cd\u4f5c\u5931\u8d25';
      setErrorMessage(message);
      onNotifyError('\u64cd\u4f5c\u5931\u8d25', message);
    } finally {
      setBusyAction(null);
    }
  }, [onNotifyError]);

  const patchCurrentWorkflowMeta = useCallback((workflow: Workflow): void => {
    if (!currentWorkflowId || workflow.id !== currentWorkflowId) {
      return;
    }

    onCurrentWorkflowPatched(workflow);
  }, [currentWorkflowId, onCurrentWorkflowPatched]);

  const handleCreateBlank = useCallback(async (): Promise<void> => {
    const shouldSwitch = await onBeforeSwitch({
      targetKind: 'new-blank',
      targetLabel: '\u65b0\u5efa\u7a7a\u767d\u753b\u5e03',
    });
    if (!shouldSwitch) {
      return;
    }

    await handleManagedAction('create:workflow', async () => {
      onCreateBlank();
      onNotifySuccess('\u5df2\u521b\u5efa\u753b\u5e03', '\u5df2\u5207\u6362\u5230\u65b0\u7684\u7a7a\u767d\u753b\u5e03');
      onClose();
    });
  }, [
    handleManagedAction,
    onBeforeSwitch,
    onClose,
    onCreateBlank,
    onNotifySuccess,
  ]);

  const handleOpenWorkflow = useCallback(async (item: WorkflowManagerItem): Promise<void> => {
    const shouldSwitch = await onBeforeSwitch({
      targetKind: 'workflow',
      targetLabel: item.name,
    });
    if (!shouldSwitch) {
      return;
    }

    await handleManagedAction(`workflow:${item.workflowId}:open`, async () => {
      const workflow = await loadManagedWorkflowById(item.workflowId);
      onOpenWorkflow(workflow);
      onNotifySuccess('\u5df2\u6253\u5f00\u753b\u5e03', item.name);
      onClose();
    });
  }, [handleManagedAction, onBeforeSwitch, onClose, onNotifySuccess, onOpenWorkflow]);

  const handleRenameWorkflow = useCallback(async (item: WorkflowManagerItem): Promise<void> => {
    const nextName = window.prompt('\u8f93\u5165\u753b\u5e03\u540d\u79f0', item.name)?.trim();
    if (!nextName || nextName === item.name) {
      return;
    }

    await handleManagedAction(`workflow:${item.workflowId}:rename`, async () => {
      const result = await workflowApi.rename(item.workflowId, nextName);
      if (!result.success) {
        throw result.error;
      }

      patchCurrentWorkflowMeta(result.data);
      await refreshList();
      onNotifySuccess('\u753b\u5e03\u5df2\u91cd\u547d\u540d', `\u65b0\u540d\u79f0\uff1a${result.data.name}`);
    });
  }, [handleManagedAction, onNotifySuccess, patchCurrentWorkflowMeta, refreshList]);

  const handleDeleteWorkflow = useCallback(async (item: WorkflowManagerItem): Promise<void> => {
    setDeleteConfirmation({
      kind: 'workflow',
      id: item.workflowId,
      title: '\u5220\u9664\u753b\u5e03',
      message: `\u786e\u8ba4\u5220\u9664\u753b\u5e03\u201c${item.name}\u201d\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002`,
      confirmLabel: '\u5220\u9664\u753b\u5e03',
      busyAction: `workflow:${item.workflowId}:delete`,
      onConfirm: async () => {
        await handleManagedAction(`workflow:${item.workflowId}:delete`, async () => {
          const result = await workflowApi.delete(item.workflowId);
          if (!result.success) {
            throw result.error;
          }

          if (currentWorkflowId === item.workflowId) {
            onCurrentWorkflowDeleted();
          }

          await refreshList();
          onNotifySuccess('\u753b\u5e03\u5df2\u5220\u9664', item.name);
        });
      },
    });
  }, [currentWorkflowId, handleManagedAction, onCurrentWorkflowDeleted, onNotifySuccess, refreshList]);

  const handleMoveWorkflow = useCallback(async (
    item: WorkflowManagerItem,
    nextGroupId: string | null,
  ): Promise<void> => {
    if ((item.groupId ?? null) === nextGroupId) {
      return;
    }

    const nextGroupName = nextGroupId
      ? (groupOptions.find((group) => group.groupId === nextGroupId)?.name ?? '\u76ee\u6807\u5206\u7ec4')
      : UNGROUPED_CONTAINER_LABEL;

    await handleManagedAction(`workflow:${item.workflowId}:move`, async () => {
      const result = await workflowApi.moveToGroup(item.workflowId, nextGroupId);
      if (!result.success) {
        throw result.error;
      }

      patchCurrentWorkflowMeta(result.data);
      await refreshList();
      onNotifySuccess('\u753b\u5e03\u5206\u7ec4\u5df2\u66f4\u65b0', `${result.data.name} \u5df2\u79fb\u52a8\u5230 ${nextGroupName}`);
    });
  }, [groupOptions, handleManagedAction, onNotifySuccess, patchCurrentWorkflowMeta, refreshList]);

  const handleCreateGroup = useCallback(async (): Promise<void> => {
    const name = window.prompt('\u8f93\u5165\u5206\u7ec4\u540d\u79f0')?.trim();
    if (!name) {
      return;
    }

    await handleManagedAction('create:group', async () => {
      const result = await workflowApi.createGroup(name);
      if (!result.success) {
        throw result.error;
      }

      await refreshList();
      onNotifySuccess('\u5206\u7ec4\u5df2\u521b\u5efa', result.data.name);
    });
  }, [handleManagedAction, onNotifySuccess, refreshList]);

  const handleRenameGroup = useCallback(async (group: WorkflowManagerGroupSummary): Promise<void> => {
    const nextName = window.prompt('\u8f93\u5165\u5206\u7ec4\u540d\u79f0', group.name)?.trim();
    if (!nextName || nextName === group.name) {
      return;
    }

    await handleManagedAction(`group:${group.groupId}:rename`, async () => {
      const result = await workflowApi.renameGroup(group.groupId, nextName);
      if (!result.success) {
        throw result.error;
      }

      await refreshList();
      onNotifySuccess('\u5206\u7ec4\u5df2\u91cd\u547d\u540d', result.data.name);
    });
  }, [handleManagedAction, onNotifySuccess, refreshList]);

  const handleDeleteGroup = useCallback(async (group: WorkflowManagerGroupSummary): Promise<void> => {
    setDeleteConfirmation({
      kind: 'group',
      id: group.groupId,
      title: '\u5220\u9664\u5206\u7ec4',
      message: `\u786e\u8ba4\u5220\u9664\u5206\u7ec4\u201c${group.name}\u201d\u5417\uff1f\u7ec4\u5185\u753b\u5e03\u4f1a\u79fb\u52a8\u5230${UNGROUPED_CONTAINER_LABEL}\u3002`,
      confirmLabel: '\u5220\u9664\u5206\u7ec4',
      busyAction: `group:${group.groupId}:delete`,
      onConfirm: async () => {
        await handleManagedAction(`group:${group.groupId}:delete`, async () => {
          const result = await workflowApi.deleteGroup(group.groupId);
          if (!result.success) {
            throw result.error;
          }

          const currentItem = managerList?.items.find((item) => item.workflowId === currentWorkflowId);
          if (currentItem?.groupId === group.groupId && currentWorkflowId) {
            const currentWorkflowResult = await workflowApi.getById(currentWorkflowId);
            if (currentWorkflowResult.success) {
              patchCurrentWorkflowMeta(currentWorkflowResult.data);
            }
          }

          await refreshList();
          onNotifySuccess(
            '\u5206\u7ec4\u5df2\u5220\u9664',
            `\u5df2\u79fb\u52a8 ${result.data.movedWorkflowCount} \u4e2a\u753b\u5e03\u5230${UNGROUPED_CONTAINER_LABEL}`,
          );
        });
      },
    });
  }, [currentWorkflowId, handleManagedAction, managerList?.items, onNotifySuccess, patchCurrentWorkflowMeta, refreshList]);

  const handleConfirmDelete = useCallback(async (): Promise<void> => {
    if (!deleteConfirmation) {
      return;
    }

    try {
      await deleteConfirmation.onConfirm();
      setDeleteConfirmation(null);
    } catch {
      // handleManagedAction already reports errors.
    }
  }, [deleteConfirmation]);

  const deleteConfirmationFooter = deleteConfirmation ? (
    <>
      <button
        className="btn btn--secondary"
        type="button"
        onClick={() => setDeleteConfirmation(null)}
        disabled={isBusy}
      >
        {'\u53d6\u6d88'}
      </button>
      <button
        className="btn btn--danger"
        type="button"
        onClick={() => { void handleConfirmDelete(); }}
        disabled={isBusy && busyAction === deleteConfirmation.busyAction}
      >
        {isBusy && busyAction === deleteConfirmation.busyAction
          ? '\u5904\u7406\u4e2d'
          : deleteConfirmation.confirmLabel}
      </button>
    </>
  ) : null;

  const footer = (
    <>
      <button
        className="btn btn--secondary"
        type="button"
        onClick={() => { void refreshList(); }}
        disabled={isBusy}
      >
        {'\u5237\u65b0'}
      </button>
      <button
        className="btn btn--primary"
        type="button"
        onClick={() => { void handleCreateBlank(); }}
        disabled={isBusy}
      >
        {'\u65b0\u5efa\u7a7a\u767d\u753b\u5e03'}
      </button>
    </>
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={'\u753b\u5e03\u7ba1\u7406'}
        size="xl"
        footer={footer}
      >
        <div className="workflow-manager-modal">
        <div className="workflow-manager-modal__topbar">
          <div className="workflow-manager-modal__summary">
            <span>{'\u5f53\u524d\u753b\u5e03'}</span>
            <strong>{currentWorkflowName ?? '\u672a\u6253\u5f00\u6301\u4e45\u5316\u753b\u5e03'}</strong>
          </div>
          <button
            className="btn btn--secondary btn--sm"
            type="button"
            onClick={() => { void handleCreateGroup(); }}
            disabled={isBusy}
          >
            {'\u65b0\u5efa\u5206\u7ec4'}
          </button>
        </div>

        {isLoading ? (
          <div className="workflow-manager-modal__notice workflow-manager-modal__notice--info">
            {'\u6b63\u5728\u52a0\u8f7d\u753b\u5e03\u5217\u8868...'}
          </div>
        ) : null}

        {!isLoading && errorMessage ? (
          <div className="workflow-manager-modal__notice workflow-manager-modal__notice--error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        {!isLoading && managerList && managerList.total === 0 ? (
          <div className="workflow-manager-modal__empty">
            {'\u5f53\u524d\u8d26\u6237\u8fd8\u6ca1\u6709\u6301\u4e45\u5316\u753b\u5e03\u3002\u70b9\u51fb\u201c\u65b0\u5efa\u7a7a\u767d\u753b\u5e03\u201d\u540e\u5f00\u59cb\u7ba1\u7406\u3002'}
          </div>
        ) : null}

        {!isLoading && managerList ? (
          <div className="workflow-manager-modal__sections">
            {sections.map((section) => (
              <section
                className="workflow-manager-modal__section"
                key={section.group?.groupId ?? '__ungrouped__'}
              >
                <div className="workflow-manager-modal__section-header">
                  <div>
                    <h3 className="workflow-manager-modal__section-title">
                      {getWorkflowGroupLabel(section.group)}
                    </h3>
                    <div className="workflow-manager-modal__section-meta">
                      {`${section.items.length} \u4e2a\u753b\u5e03`}
                    </div>
                  </div>

                  {section.group ? (
                    <div className="workflow-manager-modal__section-actions">
                      <button
                        className="btn btn--secondary btn--sm"
                        type="button"
                        onClick={() => {
                          const targetGroup = section.group;
                          if (!targetGroup) {
                            return;
                          }
                          void handleRenameGroup(targetGroup);
                        }}
                        disabled={isBusy}
                      >
                        {'\u91cd\u547d\u540d'}
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        type="button"
                        onClick={() => {
                          const targetGroup = section.group;
                          if (!targetGroup) {
                            return;
                          }
                          void handleDeleteGroup(targetGroup);
                        }}
                        disabled={isBusy}
                      >
                        {'\u5220\u9664\u5206\u7ec4'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {section.items.length === 0 ? (
                  <div className="workflow-manager-modal__section-empty">
                    {'\u8be5\u5206\u7ec4\u4e0b\u6682\u65e0\u753b\u5e03\u3002'}
                  </div>
                ) : (
                  <div className="workflow-manager-modal__list">
                    {section.items.map((item) => {
                      const isCurrent = currentWorkflowId === item.workflowId;
                      const isRowBusy = busyAction?.startsWith(`workflow:${item.workflowId}:`) ?? false;

                      return (
                        <article
                          className={[
                            'workflow-manager-modal__item',
                            isCurrent ? 'workflow-manager-modal__item--current' : '',
                          ].filter(Boolean).join(' ')}
                          key={item.workflowId}
                        >
                          <div className="workflow-manager-modal__item-main">
                            <div className="workflow-manager-modal__item-title-row">
                              <div className="workflow-manager-modal__item-name">{item.name}</div>
                              {isCurrent ? (
                                <span className="workflow-manager-modal__badge">{CURRENT_WORKFLOW_LABEL}</span>
                              ) : null}
                              {item.isAutoNamed ? (
                                <span className="workflow-manager-modal__badge workflow-manager-modal__badge--muted">
                                  {AUTO_NAMED_LABEL}
                                </span>
                              ) : null}
                            </div>
                            <div className="workflow-manager-modal__item-meta">
                              <span>{getWorkflowSummaryText(item)}</span>
                              <span>{`\u66f4\u65b0\u4e8e ${formatWorkflowManagerTime(item.updatedAt)}`}</span>
                            </div>
                          </div>

                          <div className="workflow-manager-modal__item-controls">
                            <select
                              className="select workflow-manager-modal__group-select"
                              value={item.groupId ?? ''}
                              onChange={(event) => {
                                const nextValue = event.target.value.trim();
                                void handleMoveWorkflow(item, nextValue.length > 0 ? nextValue : null);
                              }}
                              disabled={isBusy}
                              aria-label={`move-${item.workflowId}`}
                            >
                              <option value="">{UNGROUPED_CONTAINER_LABEL}</option>
                              {groupOptions.map((group) => (
                                <option key={group.groupId} value={group.groupId}>
                                  {group.name}
                                </option>
                              ))}
                            </select>
                            <button
                              className="btn btn--secondary btn--sm"
                              type="button"
                              onClick={() => { void handleOpenWorkflow(item); }}
                              disabled={isBusy || isCurrent}
                            >
                              {'\u6253\u5f00'}
                            </button>
                            <button
                              className="btn btn--secondary btn--sm"
                              type="button"
                              onClick={() => { void handleRenameWorkflow(item); }}
                              disabled={isBusy}
                            >
                              {'\u91cd\u547d\u540d'}
                            </button>
                            <button
                              className="btn btn--danger btn--sm"
                              type="button"
                              onClick={() => { void handleDeleteWorkflow(item); }}
                              disabled={isBusy || isRowBusy}
                            >
                              {'\u5220\u9664'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : null}

          {isBusy ? (
            <div className="workflow-manager-modal__notice workflow-manager-modal__notice--info">
              {'\u6b63\u5728\u5904\u7406\u8bf7\u6c42...'}
            </div>
          ) : null}
        </div>
      </Modal>
      <Modal
        isOpen={deleteConfirmation !== null}
        onClose={() => setDeleteConfirmation(null)}
        title={deleteConfirmation?.title}
        size="sm"
        footer={deleteConfirmationFooter}
        closeOnBackdrop={!isBusy}
        closeOnEscape={!isBusy}
        showCloseButton={!isBusy}
      >
        <div className="workflow-manager-modal__notice workflow-manager-modal__notice--warning">
          {deleteConfirmation?.message}
        </div>
      </Modal>
    </>
  );
});

WorkflowManagerModal.displayName = 'WorkflowManagerModal';
