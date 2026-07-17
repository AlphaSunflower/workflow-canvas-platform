import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_IMAGE_GEN_NODE_DEFAULT_MODEL,
  AI_IMAGE_GEN_NODE_MODEL_OPTIONS,
  AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS,
  getAIImageGenNodeAspectRatioOptions,
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeConfig,
} from './constants';

test('AI image gen model switch normalizes unsupported aspect ratio for gpt-image-2-vip', () => {
  const normalized = normalizeAIImageGenNodeConfig({
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

test('AI image gen model switch keeps valid aspect ratio and filters auto from gpt-image-2-vip options', () => {
  const normalized = normalizeAIImageGenNodeConfig({
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '16:9',
  });

  const options = getAIImageGenNodeAspectRatioOptions('gpt-image-2-vip');

  assert.equal(normalized.aspectRatio, '16:9');
  assert.equal(options.some((option) => option.value === 'auto'), false);
  assert.equal(options.some((option) => option.value === '16:9'), true);
});

test('AI image gen model options keep GPT Image 2 Official compatible but hide it from visible choices', () => {
  assert.equal(AI_IMAGE_GEN_NODE_DEFAULT_MODEL, 'gpt-image-2');
  assert.equal(
    AI_IMAGE_GEN_NODE_MODEL_OPTIONS.find((option) => option.value === 'gpt-image-2')?.label,
    'GPT Image 2',
  );
  assert.equal(
    AI_IMAGE_GEN_NODE_MODEL_OPTIONS.find((option) => option.value === 'gpt-image-2-vip')?.label,
    'GPT Image 2 VIP',
  );
  assert.equal(
    AI_IMAGE_GEN_NODE_MODEL_OPTIONS.find((option) => option.value === 'gpt-image-2-official')?.label,
    'GPT Image 2 Official',
  );
  assert.equal(
    (AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS as readonly { value: string }[])
      .some((option) => option.value === 'gpt-image-2-official'),
    false,
  );
});

test('AI image gen parameterless model keeps only auto aspect ratio', () => {
  const normalized = normalizeAIImageGenNodeConfig({
    model: 'gpt-image-2',
    imageSize: '4K',
    aspectRatio: '16:9',
  });
  const options = getAIImageGenNodeAspectRatioOptions('gpt-image-2');

  assert.equal(isAIImageGenNodeParameterlessModel(normalized.model), true);
  assert.deepEqual(normalized, {
    model: 'gpt-image-2',
    imageSize: '4K',
    aspectRatio: 'auto',
  });
  assert.deepEqual(options.map((option) => option.value), ['auto']);
});

test('AI image gen official model keeps auto aspect ratio and normalizes quality', () => {
  const normalized = normalizeAIImageGenNodeConfig({
    model: 'gpt-image-2-official',
    imageSize: '2K',
    aspectRatio: 'auto',
    quality: 'high',
  });
  const options = getAIImageGenNodeAspectRatioOptions('gpt-image-2-official');

  assert.deepEqual(normalized, {
    model: 'gpt-image-2-official',
    imageSize: '2K',
    aspectRatio: 'auto',
    quality: 'high',
  });
  assert.equal(options.some((option) => option.value === 'auto'), true);
});

test('AI image gen official model defaults invalid quality to auto', () => {
  const normalized = normalizeAIImageGenNodeConfig({
    model: 'gpt-image-2-official',
    imageSize: '2K',
    aspectRatio: '16:9',
    quality: 'ultra',
  });

  assert.equal(normalized.quality, 'auto');
});
