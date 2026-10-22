import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUE_STEP,
  RUNNER_ART_MANIFEST,
  SURPRISE_ART_IDS,
  laneNumbers,
  runnerArtForLane,
  runnerArtForSnail,
  runnerArtIndexForSnail,
  runnerArtSources,
  runnerLook,
  runnerLookAt,
  runnerLooks,
  surpriseArtSrc,
} from '../lib/presentation/runner-art';

test('the art is WebP at most 768 px on the long side', () => {
  for (const a of RUNNER_ART_MANIFEST) {
    assert.match(a.src, /\/art\/snails\/[a-z-]+\.webp$/);
    assert.ok(Math.max(a.width, a.height) <= 768, a.id);
  }
  for (const id of SURPRISE_ART_IDS) assert.match(surpriseArtSrc(id), /\/art\/surprises\/[a-z-]+\.webp$/);
});

test('a snail number keeps one art all night and the first eight are the eight snails', () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => runnerArtIndexForSnail(i + 1)),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(runnerArtForSnail(5), runnerArtForSnail(5));
  assert.equal(runnerArtForSnail(0), runnerArtForSnail(1));
  assert.equal(runnerArtForSnail(Number.NaN), runnerArtForSnail(1));
});

test('the same place in successive races is a different snail: 5, 13 and 21 are not three rockets', () => {
  const [a, b, c] = [5, 13, 21].map(runnerArtIndexForSnail);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
  /* The ten-a-race default: lane 4 of races 1 to 4 is snails 5, 15, 25, 35. */
  const lane4 = [5, 15, 25, 35].map(runnerArtIndexForSnail);
  assert.equal(new Set(lane4).size, 4, lane4.join(','));
});

test('eight consecutive numbers from a block start are the eight different snails', () => {
  for (const start of [1, 9, 17, 25, 65, 73]) {
    const idx = Array.from({ length: 8 }, (_, i) => runnerArtIndexForSnail(start + i));
    assert.equal(new Set(idx).size, 8, `from ${start}: ${idx.join(',')}`);
  }
});

test('no two runners in one race look the same: a shared silhouette takes the next colourway', () => {
  for (const field of [laneNumbers(12), laneNumbers(10, 10), laneNumbers(12, 24), [5, 13, 21, 29, 37, 45, 53, 61], laneNumbers(8, 80)]) {
    const looks = runnerLooks(field);
    const keys = looks.map((l) => `${l.art.id}@${l.hue}`);
    assert.equal(new Set(keys).size, field.length, keys.join(' '));
    assert.ok(looks.every((l) => l.hue % HUE_STEP === 0 && l.hue < 360));
  }
  /* The approved colourway is always the first appearance. */
  const twelve = runnerLooks(laneNumbers(12));
  assert.ok(twelve.slice(0, 8).every((l) => l.hue === 0));
  assert.ok(twelve.slice(8).every((l) => l.hue === HUE_STEP));
});

test('a lane look matches the field look, on a run of numbers or a listed field', () => {
  assert.deepEqual(runnerLook(laneNumbers(10, 20), 3), runnerLookAt(3, 10, 20));
  assert.deepEqual(runnerLookAt(1, 3, 0, [5, 13, 21]).art, runnerArtForSnail(13));
  assert.equal(runnerLookAt(9, 10, 0).snailNo, 10);
  assert.deepEqual(laneNumbers(3, 10), [11, 12, 13]);
  assert.deepEqual(laneNumbers(3, 10, [4, 8]), [4, 8, 13]);
});

test('the art a card needs is each file once', () => {
  const sources = runnerArtSources(laneNumbers(40));
  assert.equal(sources.length, 8);
  assert.equal(new Set(sources).size, 8);
  assert.deepEqual(runnerArtSources([1, 1, 9]), [runnerArtForSnail(1).src, runnerArtForSnail(9).src]);
});

test('the lane-only fallback still cycles the eight snails for callers without numbers', () => {
  assert.equal(runnerArtForLane(0).id, 'speedy');
  assert.equal(runnerArtForLane(8).id, 'speedy');
  assert.equal(runnerArtForLane(-1).id, 'dino-dash');
});
