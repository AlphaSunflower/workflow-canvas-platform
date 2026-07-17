import test from 'node:test';
import assert from 'node:assert/strict';

test('FileThumbnail falls back when protected resource resolution fails before img onError', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const source = readFileSync(
    `${cwd}/src/components/file/FileThumbnail.tsx`,
    'utf8',
  );

  assert.equal(source.includes('!protectedResource.error'), true);
  assert.equal(source.includes('Thumbnail protected resource resolution failed, falling back to alternate source'), true);
  assert.equal(source.includes('setHasAttemptedFallback(true);'), true);
  assert.equal(source.includes('setActiveSrc(fallbackSrc);'), true);
});
