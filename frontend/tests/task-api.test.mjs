import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskListQuery } from '../dist-tests/src/api/services/task-query.js';

test('buildTaskListQuery keeps scalar filters for task history requests', () => {
  const query = buildTaskListQuery({
    taskNo: 'TASK-20260403-000001',
    nodeDisplayId: '#00002',
    status: 'completed',
    createdFrom: 100,
    createdTo: 200,
    page: 1,
    pageSize: 20,
  });

  assert.deepEqual(query, {
    taskNo: 'TASK-20260403-000001',
    nodeDisplayId: '#00002',
    status: 'completed',
    createdFrom: '100',
    createdTo: '200',
    page: '1',
    pageSize: '20',
  });
});

test('buildTaskListQuery expands array status filters for unified protocol requests', () => {
  const query = buildTaskListQuery({
    status: ['queued', 'processing', 'failed'],
    snapshotId: 'snapshot-1',
    batchId: 'batch-1',
  });

  assert.equal(query.status, 'failed');
  assert.equal(query.snapshotId, 'snapshot-1');
  assert.equal(query.batchId, 'batch-1');
});

test('buildTaskListQuery omits undefined and null fields', () => {
  const query = buildTaskListQuery({
    taskNo: '',
    nodeDisplayId: undefined,
    batchId: null,
    page: 1,
  });

  assert.deepEqual(query, {
    taskNo: '',
    page: '1',
  });
});
