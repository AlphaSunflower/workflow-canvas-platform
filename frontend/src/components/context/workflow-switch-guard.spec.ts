import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  hasMeaningfulWorkflowContent,
  isDraftWithoutMeaningfulWorkflowContent,
  shouldConfirmWorkflowSwitch,
} from './workflow-switch-guard';

test('shouldConfirmWorkflowSwitch skips confirmation for empty draft workflow', () => {
  const workflow = createEmptyWorkflow('project-switch-guard', 'Draft');

  assert.equal(hasMeaningfulWorkflowContent(workflow), false);
  assert.equal(isDraftWithoutMeaningfulWorkflowContent(workflow), true);
  assert.equal(shouldConfirmWorkflowSwitch({
    workflow,
    isDirty: true,
  }), false);
});

test('shouldConfirmWorkflowSwitch requires confirmation for draft workflow with meaningful content', () => {
  const workflow = createEmptyWorkflow('project-switch-guard', 'Draft');
  workflow.nodes = {
    'node-1': createDefaultAINodeData(createSequentialNodeId(1), { x: 0, y: 0 }, 'aiImageGen'),
  };

  assert.equal(hasMeaningfulWorkflowContent(workflow), true);
  assert.equal(isDraftWithoutMeaningfulWorkflowContent(workflow), false);
  assert.equal(shouldConfirmWorkflowSwitch({
    workflow,
    isDirty: true,
  }), true);
});

test('shouldConfirmWorkflowSwitch skips confirmation for non-dirty workflow even with content', () => {
  const workflow = createEmptyWorkflow('project-switch-guard', 'Persisted');
  workflow.connections = [{
    id: 'connection-1',
    sourceId: 'node-1',
    targetId: 'node-2',
    sourceHandle: 'output',
    targetHandle: 'input',
    type: 'output-link',
  }];

  assert.equal(shouldConfirmWorkflowSwitch({
    workflow,
    isDirty: false,
  }), false);
});

test('workflow persistence coordinator routes switch-save through authoritative workflow saves after SVR-6', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const coordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );

  assert.equal(
    coordinatorSource.includes('runtimeSnapshot?: WorkflowRuntimeSnapshot;'),
    false,
  );
  assert.equal(
    coordinatorSource.includes('await saveWorkflow({'),
    true,
  );
  assert.equal(
    coordinatorSource.includes('getAuthoritativeWorkflow: WorkflowAuthoritativeWorkflowSupplier;'),
    true,
  );
  assert.equal(
    coordinatorSource.includes('saveRuntimeSnapshot'),
    false,
  );
});

test('switch-save baseline uses the same orchestrated save entry without runtime snapshot branches after SVR-6', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const coordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );
  const blockStart = coordinatorSource.indexOf('const confirmBeforeWorkflowSwitch = useCallback(');
  const blockEnd = coordinatorSource.indexOf('const refreshWorkflow = useCallback(');
  const confirmBeforeSwitchBlock = coordinatorSource.slice(blockStart, blockEnd);

  assert.ok(blockStart >= 0);
  assert.ok(blockEnd >= 0);
  assert.equal(
    confirmBeforeSwitchBlock.includes('if (options?.runtimeSnapshot) {'),
    false,
  );
  assert.equal(
    confirmBeforeSwitchBlock.includes('await saveRuntimeSnapshot(options.runtimeSnapshot, {'),
    false,
  );
  assert.equal(
    confirmBeforeSwitchBlock.includes('await saveWorkflow({'),
    true,
  );
  assert.equal(
    confirmBeforeSwitchBlock.includes('resolveWorkflowRuntimeSnapshot('),
    false,
  );
  assert.equal(
    confirmBeforeSwitchBlock.includes('workflowApi.save('),
    false,
  );
});
