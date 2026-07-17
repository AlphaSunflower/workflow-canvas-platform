import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGroupedInputEditEdges,
  runRemoveCanvasEdgeScenario,
} from '@/nodes/shared/grouped-input-edit.test';

test('canvas edge removal updates true input state when deleting a file-reference edge', () => {
  const result = runRemoveCanvasEdgeScenario({
    edgeId: 'edge-input-left',
    edges: createGroupedInputEditEdges().dualSlot,
  });

  assert.deepEqual(
    result.nextEdges.map((edge) => edge.id).sort(),
    ['edge-input-right', 'edge-output-2'],
  );
  assert.equal(result.nextEdges.some((edge) => edge.id === 'edge-output-1'), false);
  assert.deepEqual(
    result.nextEdges
      .filter((edge) => edge.data?.connectionType === 'file-reference')
      .map((edge) => edge.targetHandle),
    ['group-1:style-reference'],
  );
});

test('canvas edge removal updates true output relations when deleting an output-link edge', () => {
  const result = runRemoveCanvasEdgeScenario({
    edgeId: 'edge-output-1',
    edges: createGroupedInputEditEdges().outputOnly,
  });

  assert.deepEqual(
    result.nextEdges.map((edge) => edge.id).sort(),
    ['edge-input-1', 'edge-output-2'],
  );
  const sourceNode = result.nextNodes.find((node) => node.id === 'ai-node-1');
  assert.ok(sourceNode);
  assert.deepEqual(
    sourceNode?.data.type === 'aiImageGen'
      ? sourceNode.data.outputs
      : [],
    ['file-image-out-2'],
  );
});

test('canvas edge removal keeps file-reference and output-link semantics distinct', () => {
  const inputRemoval = runRemoveCanvasEdgeScenario({
    edgeId: 'edge-input-1',
    edges: createGroupedInputEditEdges().singleSlot,
  });
  const outputRemoval = runRemoveCanvasEdgeScenario({
    edgeId: 'edge-output-1',
    edges: createGroupedInputEditEdges().outputOnly,
  });

  assert.equal(inputRemoval.nextEdges.some((edge) => edge.id === 'edge-output-1'), false);
  assert.equal(outputRemoval.nextEdges.some((edge) => edge.id === 'edge-input-1'), true);
});
