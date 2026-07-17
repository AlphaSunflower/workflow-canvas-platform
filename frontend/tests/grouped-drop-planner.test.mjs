import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestAINode,
  createTestDropContext,
  createGroupedDropPlannerTestHarness,
  createTestInputGroups,
  createTestImageNode,
  createTestWorkflow,
  runGroupedDropCapabilityAcceptScenario,
  runGroupedDropPlannerBuildScenario,
  runGroupedDropPlannerValidationScenario,
} from '../dist-tests/src/nodes/shared/grouped-drop/planner.test.js';
import {
  aiImageHdGroupedDrop,
} from '../dist-tests/src/nodes/ai-image-hd/drop-config.js';
import {
  aiModelRenderTransferGroupedDrop,
} from '../dist-tests/src/nodes/ai-model-render-transfer/drop-config.js';

test('grouped planner accepts normal single-image slot drop', () => {
  const harness = createGroupedDropPlannerTestHarness();
  const imageNode = createTestImageNode('image-normal');

  const preview = runGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'slot|group-1|white-model',
    },
    draggedNodes: [imageNode],
  });

  const plan = runGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'slot|group-1|white-model',
    },
    draggedNodes: [imageNode],
  });

  assert.equal(preview.valid, true);
  assert.ok(plan);
  assert.deepEqual(
    plan.nextConnections
      .filter((connection) => connection.targetHandle === 'group-1:white-model')
      .map((connection) => connection.sourceId),
    ['image-normal']
  );
});

test('grouped planner ctrl single-image broadcast fills every empty slot on the target side', () => {
  const harness = createGroupedDropPlannerTestHarness({
    inputsByHandle: {
      'group-1:style-reference': ['existing-style'],
    },
  });
  const imageNode = createTestImageNode('image-broadcast');

  const preview = runGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|left',
    },
    draggedNodes: [imageNode],
    keyboard: {
      ctrlKey: true,
    },
  });

  const plan = runGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|left',
    },
    draggedNodes: [imageNode],
    keyboard: {
      ctrlKey: true,
    },
  });

  assert.equal(preview.valid, true);
  assert.ok(plan);
  const leftInputs = plan.nextConnections
    .filter((connection) => connection.targetHandle?.endsWith(':white-model'))
    .map((connection) => `${connection.targetHandle}:${connection.sourceId}`)
    .sort();
  assert.deepEqual(leftInputs, [
    'group-1:white-model:image-broadcast',
    'group-2:white-model:image-broadcast',
    'group-3:white-model:image-broadcast',
  ]);
});

test('grouped planner ctrl multi-image fill assigns images to empty slots in order', () => {
  const harness = createGroupedDropPlannerTestHarness({
    inputsByHandle: {
      'group-1:white-model': ['existing-white'],
    },
    ctrlSingleBroadcast: false,
  });
  const first = createTestImageNode('image-1', 0, 0);
  const second = createTestImageNode('image-2', 100, 0);

  const preview = runGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|left',
    },
    draggedNodes: [first, second],
    keyboard: {
      ctrlKey: true,
    },
  });

  const plan = runGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|left',
    },
    draggedNodes: [first, second],
    keyboard: {
      ctrlKey: true,
    },
  });

  assert.equal(preview.valid, true);
  assert.ok(plan);
  const leftInputs = plan.nextConnections
    .filter((connection) => connection.targetHandle?.endsWith(':white-model'))
    .map((connection) => `${connection.targetHandle}:${connection.sourceId}`)
    .sort();
  assert.deepEqual(leftInputs, [
    'group-1:white-model:existing-white',
    'group-2:white-model:image-1',
    'group-3:white-model:image-2',
  ]);
});

test('grouped planner shift expansion appends groups when empty slots are insufficient', () => {
  const harness = createGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
      { id: 'group-2', label: 'Group 2', order: 1 },
    ],
    inputsByHandle: {
      'group-1:style-reference': ['existing-style-1'],
    },
    maxGroups: 4,
  });
  const first = createTestImageNode('image-a', 0, 0);
  const second = createTestImageNode('image-b', 0, 100);
  const third = createTestImageNode('image-c', 0, 200);

  const preview = runGroupedDropPlannerValidationScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|right',
    },
    draggedNodes: [first, second, third],
    keyboard: {
      shiftKey: true,
    },
  });

  const plan = runGroupedDropPlannerBuildScenario(harness, {
    target: {
      nodeId: harness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|right',
    },
    draggedNodes: [first, second, third],
    keyboard: {
      shiftKey: true,
    },
  });

  assert.equal(preview.valid, true);
  assert.ok(plan);
  assert.equal(plan.nextTargetNode.config.inputGroups?.length, 4);
  const rightInputs = plan.nextConnections
    .filter((connection) => connection.targetHandle?.endsWith(':style-reference'))
    .map((connection) => `${connection.targetHandle}:${connection.sourceId}`)
    .sort();
  assert.deepEqual(rightInputs, [
    'group-1:style-reference:existing-style-1',
    'group-2:style-reference:image-a',
    'group-3:style-reference:image-b',
    'group-4:style-reference:image-c',
  ]);
});

test('grouped planner rejects shift plus ctrl and rejects over-capacity batch fill', () => {
  const invalidModeHarness = createGroupedDropPlannerTestHarness();
  const invalidModePreview = runGroupedDropPlannerValidationScenario(invalidModeHarness, {
    target: {
      nodeId: invalidModeHarness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|left',
    },
    draggedNodes: [createTestImageNode('image-invalid')],
    keyboard: {
      shiftKey: true,
      ctrlKey: true,
    },
  });

  assert.equal(invalidModePreview.valid, false);
  assert.match(invalidModePreview.reason ?? '', /Shift \+ Ctrl/i);

  const capacityHarness = createGroupedDropPlannerTestHarness({
    groups: [
      { id: 'group-1', label: 'Group 1', order: 0 },
      { id: 'group-2', label: 'Group 2', order: 1 },
    ],
    maxGroups: 2,
  });
  const capacityPreview = runGroupedDropPlannerValidationScenario(capacityHarness, {
    target: {
      nodeId: capacityHarness.targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|left',
    },
    draggedNodes: [
      createTestImageNode('image-1'),
      createTestImageNode('image-2'),
      createTestImageNode('image-3'),
    ],
    keyboard: {
      shiftKey: true,
    },
  });

  assert.equal(capacityPreview.valid, false);
  assert.match(capacityPreview.reason ?? '', /Only 2 files can be accepted/i);
});

test('grouped drop capability default accept logic only accepts fully normalized image drops', () => {
  const imageNode = createTestImageNode('image-ok');
  const videoLikeNode = {
    ...createTestImageNode('video-not-ok'),
    type: 'video',
    mimeType: 'video/mp4',
    fileName: 'video.mp4',
  };

  assert.equal(runGroupedDropCapabilityAcceptScenario([imageNode]), true);
  assert.equal(runGroupedDropCapabilityAcceptScenario([imageNode, videoLikeNode]), false);
});

test('aiImageHd disables ctrl batch fill and shift expansion respects max groups', () => {
  const targetNode = createTestAINode({
    type: 'aiImageHd',
    groups: createTestInputGroups(2),
  });
  const workflow = createTestWorkflow({ targetNode });

  const ctrlContext = createTestDropContext({
    workflow,
    target: {
      nodeId: targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|input',
    },
    draggedNodes: [createTestImageNode('image-ctrl')],
    keyboard: {
      ctrlKey: true,
    },
  });

  const ctrlPreview = aiImageHdGroupedDrop.validateTarget(ctrlContext);
  assert.equal(ctrlPreview.valid, false);
  assert.match(ctrlPreview.reason ?? '', /Ctrl batch fill is not enabled/i);

  const shiftContext = createTestDropContext({
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
      shiftKey: true,
    },
  });

  const shiftPlan = aiImageHdGroupedDrop.buildPlan(shiftContext);
  assert.ok(shiftPlan);
  assert.equal(shiftPlan.nextTargetNode.config.inputGroups.length, 3);
  assert.deepEqual(
    shiftPlan.nextConnections
      .filter((connection) => connection.targetHandle?.endsWith(':image'))
      .map((connection) => `${connection.targetHandle}:${connection.sourceId}`)
      .sort(),
    [
      'group-1:image:image-a',
      'group-2:image:image-b',
      'group-3:image:image-c',
    ]
  );
});

test('aiModelRenderTransfer keeps ctrl broadcast semantics and stable group-port handles', () => {
  const targetNode = createTestAINode({
    type: 'aiModelRenderTransfer',
    groups: createTestInputGroups(2),
  });
  const workflow = createTestWorkflow({
    targetNode,
    inputsByHandle: {
      'group-1:style-reference': ['existing-style'],
    },
  });

  const ctrlContext = createTestDropContext({
    workflow,
    target: {
      nodeId: targetNode.id.value,
      nodeType: 'group',
      groupId: 'panel|white-model',
    },
    draggedNodes: [createTestImageNode('image-broadcast')],
    keyboard: {
      ctrlKey: true,
    },
  });

  const ctrlPlan = aiModelRenderTransferGroupedDrop.buildPlan(ctrlContext);
  assert.ok(ctrlPlan);
  assert.deepEqual(
    ctrlPlan.nextConnections
      .filter((connection) => connection.targetHandle?.endsWith(':white-model'))
      .map((connection) => `${connection.targetHandle}:${connection.sourceId}`)
      .sort(),
    [
      'group-1:white-model:image-broadcast',
      'group-2:white-model:image-broadcast',
    ]
  );
  assert.ok(ctrlPlan.nextConnections.every((connection) =>
    !connection.targetHandle || /^[^:]+:[^:]+$/.test(connection.targetHandle)
  ));
});
