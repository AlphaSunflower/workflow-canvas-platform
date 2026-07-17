import test from 'node:test';
import assert from 'node:assert/strict';

import type { Workflow } from '@/types';
import { createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import { AUTO_SAVE_DEFAULTS } from '@/constants/workflow.constants';
import {
  createWorkflowAutoSaveOptions,
  requestWorkflowAutoSave,
  canAutoSaveWorkflow,
  shouldAutoSaveAfterExecutionIdle,
  shouldRunFallbackAutoSave,
} from './workflow-auto-save';

function createPersistedWorkflow(): Workflow {
  const workflow = createEmptyWorkflow('project-auto-save', 'Workflow Auto Save');
  return {
    ...workflow,
    id: 'workflow-auto-save',
    persistedWorkflowId: 'workflow-auto-save',
    persistenceState: 'persisted',
    hasMaterializedCanvas: true,
  };
}

test('idle auto save only triggers when execution transitions from active to idle on a dirty persisted workflow', () => {
  const persisted = createPersistedWorkflow();

  assert.deepEqual(shouldAutoSaveAfterExecutionIdle({
    workflow: persisted,
    isDirty: true,
    isSaving: false,
    hasActiveExecution: false,
    previousHadActiveExecution: true,
    fileSyncBlockReason: null,
    autoSaveEnabled: true,
  }), {
    shouldSave: true,
    reason: 'idle',
  });

  assert.deepEqual(shouldAutoSaveAfterExecutionIdle({
    workflow: persisted,
    isDirty: true,
    isSaving: false,
    hasActiveExecution: false,
    previousHadActiveExecution: false,
    fileSyncBlockReason: null,
    autoSaveEnabled: true,
  }), {
    shouldSave: false,
    reason: null,
  });
});

test('fallback auto save never saves draft workflows or blocked workflows', () => {
  const draft = createEmptyWorkflow('project-draft', 'Draft');
  const persisted = createPersistedWorkflow();

  assert.equal(canAutoSaveWorkflow({
    workflow: draft,
    isDirty: true,
    isSaving: false,
    fileSyncBlockReason: null,
    autoSaveEnabled: true,
  }), false);

  assert.deepEqual(shouldRunFallbackAutoSave({
    workflow: persisted,
    isDirty: true,
    isSaving: false,
    fileSyncBlockReason: 'Uploading files',
    autoSaveEnabled: true,
  }), {
    shouldSave: false,
    reason: null,
  });

  assert.deepEqual(shouldRunFallbackAutoSave({
    workflow: persisted,
    isDirty: true,
    isSaving: false,
    fileSyncBlockReason: null,
    autoSaveEnabled: true,
  }), {
    shouldSave: true,
    reason: 'fallback',
  });
});

test('fallback auto save interval stays at 10 minutes', () => {
  assert.equal(AUTO_SAVE_DEFAULTS.fallbackIntervalMs, 10 * 60 * 1000);
  assert.equal(AUTO_SAVE_DEFAULTS.interval, 10 * 60 * 1000);
});

test('auto save helper normalizes idle and fallback requests into the unified save options', () => {
  assert.deepEqual(createWorkflowAutoSaveOptions('idle'), {
    force: true,
    silent: true,
    reason: 'auto-idle',
  });
  assert.deepEqual(createWorkflowAutoSaveOptions('fallback'), {
    force: true,
    silent: true,
    reason: 'auto-fallback',
  });
});

test('auto save helper delegates through the shared saveWorkflow entrypoint', async () => {
  const seenOptions: Array<Parameters<typeof createWorkflowAutoSaveOptions>[0] | null> = [];
  const seenSaveOptions: Array<ReturnType<typeof createWorkflowAutoSaveOptions>> = [];

  await requestWorkflowAutoSave(async (options) => {
    seenOptions.push(options?.reason === 'auto-idle' ? 'idle' : 'fallback');
    if (!options) {
      throw new Error('expected save options');
    }
    seenSaveOptions.push(options);
  }, 'idle');

  await requestWorkflowAutoSave(async (options) => {
    seenOptions.push(options?.reason === 'auto-idle' ? 'idle' : 'fallback');
    if (!options) {
      throw new Error('expected save options');
    }
    seenSaveOptions.push(options);
  }, 'fallback');

  assert.deepEqual(seenOptions, ['idle', 'fallback']);
  assert.deepEqual(seenSaveOptions, [
    {
      force: true,
      silent: true,
      reason: 'auto-idle',
    },
    {
      force: true,
      silent: true,
      reason: 'auto-fallback',
    },
  ]);
});
