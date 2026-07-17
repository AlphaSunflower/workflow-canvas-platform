import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearCanvasActiveNodeStateSnapshot,
  clearPromotedCanvasNodeReason,
  consumeCanvasNodeViewerOpenRequest,
  getCanvasActiveNodeState,
  promoteCanvasNode,
  requestCanvasNodeViewerOpen,
  syncCanvasActiveNodeStateSnapshot,
} from './canvas-active-node-state';

test('promotion reasons merge with base active snapshot and can be cleared independently', () => {
  clearCanvasActiveNodeStateSnapshot();
  syncCanvasActiveNodeStateSnapshot([
    ['node-1', { activeState: 'active', activeReasons: ['selected'] }],
  ]);

  promoteCanvasNode('node-1', ['hovered', 'context-menu']);
  assert.deepEqual(getCanvasActiveNodeState('node-1'), {
    activeState: 'active',
    activeReasons: ['context-menu', 'hovered', 'selected'],
  });

  clearPromotedCanvasNodeReason('node-1', 'hovered');
  assert.deepEqual(getCanvasActiveNodeState('node-1'), {
    activeState: 'active',
    activeReasons: ['context-menu', 'selected'],
  });

  clearPromotedCanvasNodeReason('node-1', 'context-menu');
  assert.deepEqual(getCanvasActiveNodeState('node-1'), {
    activeState: 'active',
    activeReasons: ['selected'],
  });
  clearCanvasActiveNodeStateSnapshot();
});

test('viewer open request is consumed exactly once per node', () => {
  clearCanvasActiveNodeStateSnapshot();
  requestCanvasNodeViewerOpen('image-node-1');
  requestCanvasNodeViewerOpen('image-node-1');

  const token = consumeCanvasNodeViewerOpenRequest('image-node-1');
  const nextToken = consumeCanvasNodeViewerOpenRequest('image-node-1');

  assert.equal(token, 2);
  assert.equal(nextToken, 0);
  clearCanvasActiveNodeStateSnapshot();
});
