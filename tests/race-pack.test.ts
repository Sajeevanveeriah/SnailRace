import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPack, drawPackRace, packCommitment, validatePack, PACK_MAX_RACES } from '../lib/race-pack';
import type { PackRace, RacePackManifest } from '../lib/types';

/** A valid single race; each test breaks one thing. */
function race(over: Partial<PackRace> = {}): PackRace {
  return {
    raceId: 'r1',
    title: 'Race 1: The Clubrooms Classic',
    runners: ['Turbo', 'Shelly', 'Gary'],
    durationMs: 60_000,
    mediaFileName: 'race1.mp4',
    mediaSha256: 'a'.repeat(64),
    mediaBytes: 1024,
    mediaType: 'video/mp4',
    resultOrder: [2, 0, 1],
    source: 'Saj, simulated race capture',
    licence: 'Recorded by the club for this event',
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

function pack(races: PackRace[], over: Partial<RacePackManifest> = {}): RacePackManifest {
  return { schema: 1, packId: 'pk1', title: 'Night Card A', createdAt: 1_700_000_000_000, races, ...over };
}

test('a well-formed pack validates clean', () => {
  const p = pack([race(), race({ raceId: 'r2', mediaSha256: 'b'.repeat(64), mediaFileName: 'race2.mp4' })]);
  assert.deepEqual(validatePack(p), []);
});

test('every tamper-relevant defect is named', () => {
  const cases: [RacePackManifest, RegExp][] = [
    [pack([race()], { schema: 2 as 1 }), /schema/],
    [pack([]), /no races/],
    [pack([race(), race()]), /duplicate raceId/],
    [pack([race(), race({ raceId: 'r2' })]), /same media file/],
    [pack([race({ resultOrder: [0, 1] })]), /resultOrder/],
    [pack([race({ resultOrder: [0, 0, 1] })]), /resultOrder/],
    [pack([race({ resultOrder: [0, 1, 3] })]), /resultOrder/],
    [pack([race({ licence: '' })]), /licence/],
    [pack([race({ source: '' })]), /source/],
    [pack([race({ durationMs: 1000 })]), /duration/],
    [pack([race({ runners: ['solo'] })]), /2 to 20 runners/],
    [pack([race({ mediaSha256: 'zz' })]), /SHA-256/],
    [pack([race({ mediaType: 'audio/mpeg', mediaFileName: 'x.mp3' })]), /video format/],
  ];
  for (const [p, want] of cases) {
    const errors = validatePack(p);
    assert.ok(errors.some((e) => want.test(e)), `expected ${want} in: ${errors.join(' | ')}`);
  }
});

test('too many races is refused', () => {
  const races = Array.from({ length: PACK_MAX_RACES + 1 }, (_, i) =>
    race({ raceId: `r${i}`, mediaSha256: i.toString(16).padStart(64, '0'), mediaFileName: `r${i}.mp4` }),
  );
  assert.ok(validatePack(pack(races)).some((e) => /maximum/.test(e)));
});

test('the commitment is order-independent over races', async () => {
  const a = race();
  const b = race({ raceId: 'r2', mediaSha256: 'b'.repeat(64), mediaFileName: 'race2.mp4' });
  const one = await packCommitment(pack([a, b]));
  const two = await packCommitment(pack([b, a]));
  assert.equal(one, two);
});

test('changing any committed fact changes the commitment', async () => {
  const base = await packCommitment(pack([race()]));
  const variants: Partial<PackRace>[] = [
    { mediaSha256: 'c'.repeat(64) },
    { resultOrder: [0, 2, 1] },
    { runners: ['Turbo', 'Shelly', 'Gail'] },
    { durationMs: 61_000 },
    { title: 'Race 1: Retitled' },
  ];
  for (const v of variants) {
    assert.notEqual(await packCommitment(pack([race(v)])), base, JSON.stringify(v));
  }
});

test('runner lists cannot collide by concatenation', () => {
  const one = canonicalPack(pack([race({ runners: ['ab', 'c'] })]));
  const two = canonicalPack(pack([race({ runners: ['a', 'bc'] })]));
  assert.notEqual(one, two);
});

test('the draw is deterministic and input-order independent', () => {
  const ids = ['r3', 'r1', 'r2', 'r5', 'r4'];
  const first = drawPackRace(0xc0ffee, ids);
  assert.equal(first, drawPackRace(0xc0ffee, ids.slice().reverse()));
  assert.ok(first !== null && ids.includes(first));
  assert.equal(drawPackRace(123, []), null);
});

test('over many seeds every eligible race gets drawn', () => {
  const ids = ['r1', 'r2', 'r3', 'r4'];
  const seen = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    const id = drawPackRace(seed, ids);
    if (id) seen.add(id);
  }
  assert.equal(seen.size, ids.length);
});
