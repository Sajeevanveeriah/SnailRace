import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawOrder,
  drawRace,
  hexToSeed,
  seedToHex,
  stepRace,
  verifyDraw,
} from '../lib/race-engine';

/* Defect class: non-determinism in the draw. Same seed must always produce
   the same finishing order, at every field size, or the printed seed proves
   nothing. */
test('drawOrder is deterministic per seed and field size', () => {
  for (let n = 3; n <= 20; n++) {
    for (const seed of [1, 42, 0xdeadbeef, 987654321]) {
      assert.deepEqual(drawOrder(seed, n).order, drawOrder(seed, n).order);
    }
  }
});

test('seed hex round-trips', () => {
  for (const seed of [0, 1, 255, 0xffffffff, 0x8f2a31c0]) {
    assert.equal(hexToSeed(seedToHex(seed)), seed >>> 0);
  }
  assert.equal(hexToSeed('not hex'), null);
});

test('verifyDraw replays the same order the engine drew', () => {
  const { order } = drawOrder(0x1234abcd, 8);
  assert.deepEqual(verifyDraw(seedToHex(0x1234abcd), 8), order);
});

/* Defect class: the animation changing the result. Surprises, wobble and
   finish drama must never reorder arrivals: the announced places must equal
   the shuffle for every seed tried, with surprises on. */
test('arrival order equals the drawn order, surprises on, many seeds and fields', () => {
  for (const seed of [7, 1001, 0x51a11, 0xc0ffee, 2147483647]) {
    for (const n of [3, 6, 12, 20]) {
      const names = Array.from({ length: n }, (_, i) => `S${i}`);
      const race = drawRace(seed, names, 12_000, true);
      let placed = 0;
      for (let t = 0; t <= race.tMax; t += 50) {
        const { crossed } = stepRace(race.snails, t, 50, placed);
        if (crossed.length) placed = crossed[crossed.length - 1].place;
      }
      const finishOrder = race.snails
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((s) => s.lane);
      assert.deepEqual(
        finishOrder,
        race.order,
        `seed ${seed} n=${n}: animation reordered the draw`,
      );
      /* Nobody unplaced, nobody early. */
      assert.ok(race.snails.every((s) => s.done && s.place >= 1 && s.place <= n));
    }
  }
});

/* Defect class: a snail crossing the line before its drawn time. Position
   must stay below 1 until u reaches 1, whatever the surprises do. */
test('no snail reaches the line early', () => {
  const race = drawRace(0xabcdef, ['a', 'b', 'c', 'd', 'e', 'f'], 10_000, true);
  for (let t = 0; t <= race.tMax; t += 40) {
    stepRace(race.snails, t, 40, 0);
    for (const s of race.snails) {
      if (t < s.T) assert.ok(s.p < 1, `lane ${s.lane} at ${t}ms reached the line early`);
    }
  }
});

/* Defect class: bias. Every lane must win about 1/N of the time. A rough
   tolerance keeps the test fast and still catches a rigged or skewed draw. */
test('the winner is uniform to a rough tolerance', () => {
  const n = 6;
  const draws = 30_000;
  const wins = new Array(n).fill(0);
  for (let seed = 1; seed <= draws; seed++) wins[drawOrder(seed, n).order[0]] += 1;
  const expected = draws / n;
  for (const w of wins) {
    assert.ok(Math.abs(w - expected) < expected * 0.05, `win counts skewed: ${wins.join(',')}`);
  }
});

/* Defect class: ties. Two snails sharing a finish time lets frame order
   decide a place. */
test('finish times are strictly distinct', () => {
  for (const seed of [3, 99, 424242]) {
    const race = drawRace(seed, Array.from({ length: 20 }, (_, i) => `s${i}`), 45_000, true);
    const times = race.snails.map((s) => s.T).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
  }
});
