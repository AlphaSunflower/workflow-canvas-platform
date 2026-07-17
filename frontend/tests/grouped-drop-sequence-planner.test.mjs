import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSequenceGroupedDropPlannerTestHarness,
  createTestImageNode,
  runSequenceGroupedDropPlannerBuildScenario,
  runSequenceGroupedDropPlannerValidationScenario,
} from '../dist-tests/src/nodes/shared/grouped-drop/sequence-planner.test.js';
import {
  getGroupedDropModeSemanticSnapshot,
} from '../dist-tests/src/nodes/shared/grouped-drop/planner.test.js';
import {
  aiImageGenGroupedDrop,
} from '../dist-tests/src/nodes/ai-image-gen/drop-config.js';
import {
  createTestAINode,
  createTestDropContext,
  createTestInputGroups,
  createTestWorkflow,
} from '../dist-tests/src/nodes/shared/grouped-drop/planner.test.js';

test('grouped drop mode semantics are fixed in the shared layer', () => {
  const snapshot = getGroupedDropModeSemanticSnapshot();

  assert.equal(snapshot.normal.intent, 'slot');
  assert.equal(snapshot.normal.displayMode, 'normal');
  assert.equal(snapshot.ctrl.intent, 'existing-capacity');
  assert.equal(snapshot.ctrl.displayMode, 'batch');
  assert.equal(snapshot.shift.intent, 'expand-capacity');
  assert.equal(snapshot.shift.displayMode, 'batch');
  assert.equal(snapshot.invalid.intent, 'invalid');
  assert.equal(snapshot.invalid.displayMode, 'invalid');
});

test('sequence planner appends images to a concrete slot in order', () => {
  const harness = createSequenceGroupedDropPlannerTestHarness({
    maxConnectionsPerPort: 5,
    inputsByHandle: {
      'group-1:images': ['existing-1'],
    },
  });

  const preview = runSequenceGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'slot|group-1|images',
    },
    draggedNodes: [
      createTestImageNode('image-a', 0, 0),
      createTestImageNode('image-b', 100, 0),
    ],
  });

  const plan = runSequenceGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'slot|group-1|images',
    },
    draggedNodes: [
      createTestImageNode('image-a', 0, 0),
      createTestImageNode('image-b', 100, 0),
    ],
  });

  assert.equal(preview.valid, true);
  assert.ok(plan);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['existing-1', 'image-a', 'image-b']
  );
});

test('sequence planner ctrl fill uses existing capacity only', () => {
  const harness = createSequenceGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
      { id: 'group-2', label: 'Group 2', order: 1 },
    ],
    maxConnectionsPerPort: 3,
    inputsByHandle: {
      'group-1:images': ['existing-1'],
      'group-2:images': ['existing-2', 'existing-3'],
    },
  });

  const preview = runSequenceGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('image-a'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
      createTestImageNode('image-d'),
    ],
    keyboard: {
      ctrlKey: true,
    },
  });

  assert.equal(preview.valid, false);
  assert.match(preview.reason ?? '', /current group capacity/i);
});

test('sequence planner ctrl fill rotates across groups before reusing capacity', () => {
  const harness = createSequenceGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
      { id: 'group-2', label: 'Group 2', order: 1 },
    ],
    maxConnectionsPerPort: 5,
    ctrlSingleBroadcast: false,
  });

  const plan = runSequenceGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('image-a'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
    ],
    keyboard: {
      ctrlKey: true,
    },
  });

  assert.ok(plan);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['image-a', 'image-c']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-2:images')
      .map((connection) => connection.sourceId),
    ['image-b']
  );
});

test('sequence planner ctrl single-image broadcast fills all groups missing that image', () => {
  const harness = createSequenceGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
      { id: 'group-2', label: 'Group 2', order: 1 },
      { id: 'group-3', label: 'Group 3', order: 2 },
    ],
    maxConnectionsPerPort: 5,
    ctrlSingleBroadcast: true,
    disallowHandleDuplicates: true,
    inputsByHandle: {
      'group-1:images': ['image-a'],
      'group-2:images': ['existing-2'],
    },
  });

  const plan = runSequenceGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [createTestImageNode('image-a')],
    keyboard: {
      ctrlKey: true,
    },
  });

  assert.ok(plan);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['image-a']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-2:images')
      .map((connection) => connection.sourceId),
    ['existing-2', 'image-a']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-3:images')
      .map((connection) => connection.sourceId),
    ['image-a']
  );
});

test('sequence planner shift fill expands groups when needed', () => {
  const harness = createSequenceGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
    ],
    maxGroups: 3,
    maxConnectionsPerPort: 2,
    inputsByHandle: {
      'group-1:images': ['existing-1'],
    },
  });

  const preview = runSequenceGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('image-a'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
    ],
    keyboard: {
      shiftKey: true,
    },
  });

  const plan = runSequenceGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('image-a'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
    ],
    keyboard: {
      shiftKey: true,
    },
  });

  assert.equal(preview.valid, true);
  assert.ok(plan);
  assert.equal(plan.nextTargetNode.config.inputGroups.length, 2);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['existing-1', 'image-a']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-2:images')
      .map((connection) => connection.sourceId),
    ['image-b', 'image-c']
  );
});

test('sequence planner shift can place one image per group when configured', () => {
  const harness = createSequenceGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
      { id: 'group-2', label: 'Group 2', order: 1 },
    ],
    maxGroups: 4,
    maxConnectionsPerPort: 5,
    shiftPlacementStrategy: 'single-per-group',
    inputsByHandle: {
      'group-1:images': ['existing-1'],
      'group-2:images': ['existing-2'],
    },
  });

  const plan = runSequenceGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('image-a'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
      createTestImageNode('image-d'),
    ],
    keyboard: {
      shiftKey: true,
    },
  });

  assert.ok(plan);
  assert.equal(plan.nextTargetNode.config.inputGroups.length, 4);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['existing-1', 'image-a']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-2:images')
      .map((connection) => connection.sourceId),
    ['existing-2', 'image-b']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-3:images')
      .map((connection) => connection.sourceId),
    ['image-c']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-4:images')
      .map((connection) => connection.sourceId),
    ['image-d']
  );
});

test('sequence planner blocks duplicates on the same handle when configured', () => {
  const harness = createSequenceGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
    ],
    maxGroups: 2,
    maxConnectionsPerPort: 5,
    shiftPlacementStrategy: 'single-per-group',
    disallowHandleDuplicates: true,
    inputsByHandle: {
      'group-1:images': ['existing-1'],
    },
  });

  const preview = runSequenceGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('existing-1'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
    ],
    keyboard: {
      shiftKey: true,
    },
  });

  assert.equal(preview.valid, false);
  assert.match(preview.reason ?? '', /only 2 files can be accepted/i);
});

test('aiImageGen drop config keeps ordered sequence constraints and group-port handles', () => {
  const targetNode = createTestAINode({
    type: 'aiImageGen',
    groups: createTestInputGroups(2),
    dimensions: { width: 320, height: 340 },
  });
  const workflow = createTestWorkflow({
    targetNode,
    inputsByHandle: {
      'group-1:images': ['existing-1', 'existing-2', 'existing-3', 'existing-4'],
    },
  });

  const ctrlContext = createTestDropContext({
    workflow,
    target: {
      nodeId: targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('image-a'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
      createTestImageNode('image-d'),
      createTestImageNode('image-e'),
      createTestImageNode('image-f'),
      createTestImageNode('image-g'),
    ],
    keyboard: {
      ctrlKey: true,
    },
  });

  const ctrlPreview = aiImageGenGroupedDrop.validateTarget(ctrlContext);
  assert.equal(ctrlPreview.valid, false);
  assert.match(ctrlPreview.reason ?? '', /current group capacity/i);

  const normalContext = createTestDropContext({
    workflow,
    target: {
      nodeId: targetNode.id.value,
      nodeType: 'group',
      groupId: 'slot|group-1|images',
    },
    draggedNodes: [createTestImageNode('image-slot')],
  });

  const normalPlan = aiImageGenGroupedDrop.buildPlan(normalContext);
  assert.ok(normalPlan);
  const slotInputs = normalPlan.nextConnections
    .filter((connection) => connection.targetHandle === 'group-1:images')
    .map((connection) => connection.sourceId);
  assert.deepEqual(slotInputs, ['existing-1', 'existing-2', 'existing-3', 'existing-4', 'image-slot']);
  assert.ok(normalPlan.nextConnections.every((connection) =>
    !connection.targetHandle || /^[^:]+:[^:]+$/.test(connection.targetHandle)
  ));
});

test('aiImageGen grouped drop sorts by canvas position and preserves ordered handles', () => {
  const targetNode = createTestAINode({
    type: 'aiImageGen',
    groups: createTestInputGroups(1),
    dimensions: { width: 320, height: 340 },
  });
  const workflow = createTestWorkflow({ targetNode });
  const context = createTestDropContext({
    workflow,
    target: {
      nodeId: targetNode.id.value,
      nodeType: 'group',
      groupId: 'slot|group-1|images',
    },
    draggedNodes: [
      createTestImageNode('image-bottom', 0, 200),
      createTestImageNode('image-top', 0, 0),
      createTestImageNode('image-middle', 0, 100),
    ],
  });

  const plan = aiImageGenGroupedDrop.buildPlan(context);
  assert.ok(plan);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['image-top', 'image-middle', 'image-bottom']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.order),
    [0, 1, 2]
  );
});

test('aiImageGen ctrl drag distributes images across existing groups in order', () => {
  const targetNode = createTestAINode({
    type: 'aiImageGen',
    groups: createTestInputGroups(3),
    dimensions: { width: 320, height: 340 },
  });
  const workflow = createTestWorkflow({ targetNode });
  const context = createTestDropContext({
    workflow,
    target: {
      nodeId: targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [
      createTestImageNode('image-a'),
      createTestImageNode('image-b'),
      createTestImageNode('image-c'),
    ],
    keyboard: {
      ctrlKey: true,
    },
  });

  const plan = aiImageGenGroupedDrop.buildPlan(context);
  assert.ok(plan);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['image-a']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-2:images')
      .map((connection) => connection.sourceId),
    ['image-b']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-3:images')
      .map((connection) => connection.sourceId),
    ['image-c']
  );
});

test('aiImageGen ctrl single-image drag broadcasts to groups that do not already contain it', () => {
  const targetNode = createTestAINode({
    type: 'aiImageGen',
    groups: createTestInputGroups(3),
    dimensions: { width: 320, height: 340 },
  });
  const workflow = createTestWorkflow({
    targetNode,
    inputsByHandle: {
      'group-1:images': ['image-a'],
      'group-2:images': ['existing-2'],
    },
  });
  const context = createTestDropContext({
    workflow,
    target: {
      nodeId: targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [createTestImageNode('image-a')],
    keyboard: {
      ctrlKey: true,
    },
  });

  const plan = aiImageGenGroupedDrop.buildPlan(context);
  assert.ok(plan);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:images')
      .map((connection) => connection.sourceId),
    ['image-a']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-2:images')
      .map((connection) => connection.sourceId),
    ['existing-2', 'image-a']
  );
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-3:images')
      .map((connection) => connection.sourceId),
    ['image-a']
  );
});
