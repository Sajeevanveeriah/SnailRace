import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENSITY_FACTOR, drawRace, eventBudget, stepRace, type IntensityId } from '../lib/race-engine';

/**
 * The Surprise Director's non-negotiable: intensity presets change how much
 * drama is dealt and NEVER who wins. The finishing order and every finish
 * time are drawn before the surprise budget is spent, so all four presets
 * must produce the identical result from the same seed.
 */

const PRESETS = Object.keys(INTENSITY_FACTOR) as IntensityId[];
const names = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);

test('standard is bit-identical to the v3 default draw', () => {
  for (const seed of [7, 0xc0ffee, 2147483647]) {
    const v3 = drawRace(seed, names(8), 45_000, true);
    const v4 = drawRace(seed, names(8), 45_000, true, 'standard');
    assert.deepEqual(JSON.parse(JSON.stringify(v4)), JSON.parse(JSON.stringify(v3)));
  }
});

test('every preset draws the same order and finish times from the same seed', () => {
  for (const seed of [3, 99, 424242, 0xabcdef]) {
    for (const n of [3, 8, 20]) {
      const reference = drawRace(seed, names(n), 30_000, true, 'standard');
      for (const preset of PRESETS) {
        const race = drawRace(seed, names(n), 30_000, true, preset);
        assert.deepEqual(race.order, reference.order, `${preset} changed the order at seed ${seed}`);
        assert.deepEqual(
          race.snails.map((s) => s.T),
          reference.snails.map((s) => s.T),
          `${preset} changed a finish time at seed ${seed}`,
        );
        assert.equal(race.photoFinish, reference.photoFinish);
      }
    }
  }
});

test('arrival order equals the drawn order under every preset', () => {
  for (const preset of PRESETS) {
    for (const seed of [11, 5150]) {
      const race = drawRace(seed, names(10), 15_000, true, preset);
      let placed = 0;
      const arrived: number[] = [];
      for (let t = 0; t <= race.tMax; t += 50) {
        const { crossed } = stepRace(race.snails, t, 50, placed);
        for (const c of crossed) {
          arrived.push(c.lane);
          placed = c.place;
        }
      }
      assert.deepEqual(arrived, race.order, `${preset} let a surprise change an arrival at seed ${seed}`);
    }
  }
});

test('no preset lets a snail cross early: the envelope closes to zero', () => {
  for (const preset of PRESETS) {
    const race = drawRace(0xdead, names(6), 10_000, true, preset);
    for (let t = 0; t <= race.tMax; t += 40) {
      stepRace(race.snails, t, 40, 0);
      for (const s of race.snails) {
        if (t < s.T) assert.ok(s.p < 1, `${preset}: lane ${s.lane} reached the line early at ${t}ms`);
      }
    }
  }
});

test('the budget scales with the preset and stays capped', () => {
  const budgets = PRESETS.map((p) => eventBudget(60_000, 8, INTENSITY_FACTOR[p]));
  const byPreset = Object.fromEntries(PRESETS.map((p, i) => [p, budgets[i]]));
  assert.ok(byPreset.calm < byPreset.standard, 'calm should deal less than standard');
  assert.ok(byPreset.standard < byPreset.big, 'big should deal more than standard');
  assert.ok(byPreset.big <= byPreset.chaos, 'chaos deals the most');
  for (const b of budgets) assert.ok(b >= 2 && b <= 120);
  /* The per-field cap holds whatever the factor. */
  assert.ok(eventBudget(20 * 60_000, 3, INTENSITY_FACTOR.chaos) <= 3 * 8);
});

test('chaos actually deals more drama than calm over many seeds', () => {
  let calmTotal = 0;
  let chaosTotal = 0;
  for (let seed = 1; seed <= 40; seed++) {
    calmTotal += drawRace(seed, names(8), 45_000, true, 'calm').events.length;
    chaosTotal += drawRace(seed, names(8), 45_000, true, 'chaos').events.length;
  }
  assert.ok(chaosTotal > calmTotal, `chaos ${chaosTotal} should exceed calm ${calmTotal}`);
});
