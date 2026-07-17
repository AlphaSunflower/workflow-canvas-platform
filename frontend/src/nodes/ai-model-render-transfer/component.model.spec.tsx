import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getModelRenderTransferNodeAspectRatioOptions,
  normalizeModelRenderTransferNodeConfig,
} from './constants';

test('AI model render transfer model switch normalizes unsupported aspect ratio for gpt-image-2-vip', () => {
  const normalized = normalizeModelRenderTransferNodeConfig({
    model: 'gpt-image-2-vip',
    imageSize: '4K',
    aspectRatio: 'auto',
  });

  assert.deepEqual(normalized, {
    model: 'gpt-image-2-vip',
    imageSize: '4K',
    aspectRatio: '1:1',
  });
});

test('AI model render transfer model switch keeps valid aspect ratio and filters auto from gpt-image-2-vip options', () => {
  const normalized = normalizeModelRenderTransferNodeConfig({
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '4:5',
  });

  const options = getModelRenderTransferNodeAspectRatioOptions('gpt-image-2-vip');

  assert.equal(normalized.aspectRatio, '4:5');
  assert.equal(options.some((option) => option.value === 'auto'), false);
  assert.equal(options.some((option) => option.value === '4:5'), true);
});
