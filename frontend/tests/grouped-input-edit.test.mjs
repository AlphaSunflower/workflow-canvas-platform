import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupedInputEditEdges,
  getGroupedInputInteractionDisabledSnapshot,
  runRemoveGroupedPortInputScenario,
  runReorderGroupedPortInputsScenario,
} from '../dist-tests/src/nodes/shared/grouped-input-edit.test.js';
import {
  getOrderedSourceIdsForHandle,
  reorderGroupedPortSourceIds,
} from '../dist-tests/src/nodes/shared/grouped-input-sort.js';

test('shared delete helper removes single-slot input and cuts only the affected group output-link', () => {
  const edges = createGroupedInputEditEdges().singleSlot;
  const result = runRemoveGroupedPortInputScenario({
    inputHandle: 'group-1:image',
    outputHandle: 'group-1:result',
    sourceId: 'image-a',
    edges,
  });

  assert.deepEqual(
    result.nextEdges.map((edge) => edge.id).sort(),
    ['edge-output-2']
  );
  assert.equal(result.nextNodes.find((node) => node.id === 'ai-node-1')?.data.outputs.includes('file-output-1'), false);
  assert.equal(result.nextNodes.find((node) => node.id === 'image-out-1')?.id, 'image-out-1');
});

test('shared delete helper removes dual-slot input without deleting unrelated slot input or file nodes', () => {
  const edges = createGroupedInputEditEdges().dualSlot;
  const result = runRemoveGroupedPortInputScenario({
    inputHandle: 'group-1:white-model',
    outputHandle: 'group-1:result',
    sourceId: 'image-a',
    edges,
  });

  const remainingHandles = result.nextEdges
    .filter((edge) => edge.data?.connectionType !== 'output-link')
    .map((edge) => edge.targetHandle);

  assert.deepEqual(remainingHandles, ['group-1:style-reference']);
  assert.equal(result.nextNodes.some((node) => node.id === 'image-a'), true);
  assert.equal(result.nextNodes.some((node) => node.id === 'image-b'), true);
});

test('shared delete helper reindexes sequence inputs and removes the group output-link', () => {
  const edges = createGroupedInputEditEdges().sequence;
  const result = runRemoveGroupedPortInputScenario({
    inputHandle: 'group-1:images',
    outputHandle: 'group-1:result',
    sourceId: 'image-b',
    edges,
  });

  const remainingSequenceEdges = result.nextEdges
    .filter((edge) => edge.targetHandle === 'group-1:images')
    .sort((left, right) => (left.data?.order ?? 0) - (right.data?.order ?? 0));

  assert.deepEqual(
    remainingSequenceEdges.map((edge) => `${edge.source}:${edge.data?.order}`),
    ['image-a:0', 'image-c:1']
  );
  assert.equal(result.nextEdges.some((edge) => edge.sourceHandle === 'group-1:result'), false);
  assert.equal(result.nextNodes.some((node) => node.id === 'image-out-1'), true);
});

test('shared sort helper rebuilds ordered sequence and removes only the affected group output-link', () => {
  const edges = createGroupedInputEditEdges().sequence;
  const orderedSourceIds = getOrderedSourceIdsForHandle(edges, 'ai-node-1', 'group-1:images');
  const nextSourceIds = reorderGroupedPortSourceIds(orderedSourceIds, 'image-c', 'image-a');

  assert.deepEqual(nextSourceIds, ['image-c', 'image-a', 'image-b']);

  const sorted = runReorderGroupedPortInputsScenario({
    inputHandle: 'group-1:images',
    outputHandle: 'group-1:result',
    sourceIds: nextSourceIds,
    edges,
  });

  const nextSequenceEdges = sorted.nextEdges
    .filter((edge) => edge.targetHandle === 'group-1:images')
    .sort((left, right) => (left.data?.order ?? 0) - (right.data?.order ?? 0));

  assert.deepEqual(
    nextSequenceEdges.map((edge) => `${edge.source}:${edge.data?.order}`),
    ['image-c:0', 'image-a:1', 'image-b:2']
  );
  assert.equal(sorted.nextEdges.some((edge) => edge.sourceHandle === 'group-1:result'), false);
  assert.equal(sorted.nextNodes.some((node) => node.id === 'image-out-1'), true);
});

test('shared input interactions are disabled while locked or running', () => {
  const snapshot = getGroupedInputInteractionDisabledSnapshot();

  assert.equal(snapshot.locked, true);
  assert.equal(snapshot.queued, true);
  assert.equal(snapshot.processing, true);
  assert.equal(snapshot.idle, false);
});
