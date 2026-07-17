import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import { shouldBootstrapBlankWorkflow } from './workflow-session-bootstrap';

test('shouldBootstrapBlankWorkflow creates a blank draft once after auth restore settles', () => {
  assert.equal(shouldBootstrapBlankWorkflow({
    authStatus: 'unauthenticated',
    workflow: null,
  }), true);

  assert.equal(shouldBootstrapBlankWorkflow({
    authStatus: 'authenticated',
    workflow: null,
  }), true);
});

test('shouldBootstrapBlankWorkflow does not load or replace an existing workflow', () => {
  assert.equal(shouldBootstrapBlankWorkflow({
    authStatus: 'authenticated',
    workflow: createEmptyWorkflow('project-bootstrap', 'Draft'),
  }), false);
});

test('shouldBootstrapBlankWorkflow waits while auth state is restoring or refreshing', () => {
  assert.equal(shouldBootstrapBlankWorkflow({
    authStatus: 'restoring',
    workflow: null,
  }), false);

  assert.equal(shouldBootstrapBlankWorkflow({
    authStatus: 'refreshing',
    workflow: null,
  }), false);
});
