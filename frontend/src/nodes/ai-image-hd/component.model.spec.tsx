import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAIImageHdNodeAspectRatioOptions,
  normalizeAIImageHdNodeConfig,
} from './constants';

test('AI image hd model switch normalizes unsupported aspect ratio for gpt-image-2-vip', () => {
  const normalized = normalizeAIImageHdNodeConfig({
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

test('AI image hd model switch keeps valid aspect ratio and filters auto from gpt-image-2-vip options', () => {
  const normalized = normalizeAIImageHdNodeConfig({
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '16:9',
  });

  const options = getAIImageHdNodeAspectRatioOptions('gpt-image-2-vip');

  assert.equal(normalized.aspectRatio, '16:9');
  assert.equal(options.some((option) => option.value === 'auto'), false);
  assert.equal(options.some((option) => option.value === '16:9'), true);
});
