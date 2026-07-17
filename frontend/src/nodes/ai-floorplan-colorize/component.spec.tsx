import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
  AI_FLOORPLAN_COLORIZE_STYLE_OPTIONS,
  getAIFloorplanColorizeAspectRatioOptions,
  normalizeAIFloorplanColorizeConfig,
  normalizeAIFloorplanColorizeStylePreset,
} from './constants';
import { getDefaultAIConfig } from '@/utils/node/create';

test('AI floorplan colorize exposes the expected style preset options', () => {
  assert.deepEqual(
    AI_FLOORPLAN_COLORIZE_STYLE_OPTIONS.map((option) => option.value),
    ['three-d-render', 'photoreal-render'],
  );
});

test('AI floorplan colorize defaults to the shared style preset', () => {
  assert.equal(
    getDefaultAIConfig('aiFloorplanColorize').stylePreset,
    AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
  );
});

test('AI floorplan colorize normalizes legacy and empty style preset values', () => {
  assert.equal(normalizeAIFloorplanColorizeStylePreset(undefined), 'three-d-render');
  assert.equal(normalizeAIFloorplanColorizeStylePreset(''), 'three-d-render');
  assert.equal(normalizeAIFloorplanColorizeStylePreset('default'), 'three-d-render');
  assert.equal(normalizeAIFloorplanColorizeStylePreset('modern'), 'three-d-render');
  assert.equal(normalizeAIFloorplanColorizeStylePreset('warm'), 'three-d-render');
  assert.equal(normalizeAIFloorplanColorizeStylePreset('photoreal-render'), 'photoreal-render');
});

test('AI floorplan colorize model switch normalizes unsupported aspect ratio for gpt-image-2-vip', () => {
  const normalized = normalizeAIFloorplanColorizeConfig({
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

test('AI floorplan colorize model switch keeps valid aspect ratio and filters auto from gpt-image-2-vip options', () => {
  const normalized = normalizeAIFloorplanColorizeConfig({
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '3:4',
  });

  const options = getAIFloorplanColorizeAspectRatioOptions('gpt-image-2-vip');

  assert.equal(normalized.aspectRatio, '3:4');
  assert.equal(options.some((option) => option.value === 'auto'), false);
  assert.equal(options.some((option) => option.value === '3:4'), true);
});
