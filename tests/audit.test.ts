import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalRacePlan,
  commitmentInput,
  commitmentOf,
  planHashOf,
  resultHashOf,
  resultInput,
  sha256Bytes,
  sha256Hex,
  type RaceConfig,
} from '../lib/audit';
import type { LockedRacePlan } from '../lib/types';

/* Defect class: a wrong hash implementation. Checked against the FIPS 180-4
   published vectors, for both the WebCrypto path and the pure fallback that
   covers insecure contexts (a projector on plain http). */
const VECTORS: Array<[string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
];

test('sha256Hex matches the published vectors', async () => {
  for (const [input, expected] of VECTORS) {
    assert.equal(await sha256Hex(input), expected);
  }
});

test('the pure fallback agrees with the vectors and with WebCrypto', async () => {
  const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  for (const [input, expected] of VECTORS) {
    assert.equal(toHex(sha256Bytes(new TextEncoder().encode(input))), expected);
  }
  /* A long input crosses several blocks. */
  const long = 'a'.repeat(1_000_000);
  assert.equal(
    toHex(sha256Bytes(new TextEncoder().encode(long))),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  );
});

const config: RaceConfig = {
  raceNo: 3,
  raceType: 'Heat',
  fieldSize: 4,
  names: ['A', 'B', 'C', 'D'],
  durationMs: 12_000,
  laps: 3,
  surprises: true,
  trackShape: 'circuit',
};

/* Defect class: a commitment that fails to bind. Changing any part of the
   configuration must change the commitment. */
test('the commitment binds seed and configuration', async () => {
  const base = await commitmentOf('8F2A31C0', config);
  assert.equal(base, await commitmentOf('8f2a31c0', config)); // case-stable
  assert.notEqual(base, await commitmentOf('8F2A31C1', config));
  assert.notEqual(base, await commitmentOf('8F2A31C0', { ...config, laps: 4 }));
  assert.notEqual(base, await commitmentOf('8F2A31C0', { ...config, surprises: false }));
  assert.notEqual(
    base,
    await commitmentOf('8F2A31C0', { ...config, names: ['A', 'B', 'C', 'E'] }),
  );
  /* The canonical string is stated, so an outside audit can rebuild it. */
  assert.equal(
    commitmentInput('8F2A31C0', config),
    'ndcc-race-commit-v1|8F2A31C0|3|Heat|4|A\u001fB\u001fC\u001fD|12000|3|1|circuit',
  );
});

test('new commitments and plans bind the selected broadcast course', async () => {
  const withCourse: RaceConfig = { ...config, intensity: 'standard', courseId: 'boundary-oval' };
  assert.match(commitmentInput('8F2A31C0', withCourse), /^ndcc-race-commit-v3\|/);
  assert.notEqual(
    await commitmentOf('8F2A31C0', withCourse),
    await commitmentOf('8F2A31C0', { ...withCourse, courseId: 'pavilion-chicane' }),
  );

  const first = structuredClone(lockedPlan);
  first.courseId = 'boundary-oval';
  const second = structuredClone(first);
  second.courseId = 'floodlight-eight';
  assert.match(canonicalRacePlan(first), /^ndcc-race-plan-v2\|/);
  assert.notEqual(await planHashOf(first), await planHashOf(second));
});

/* Defect class: a result hash that misses a change to the finishing order. */
test('the result hash fingerprints the finishing order', async () => {
  const results = [
    { lane: 2, name: 'C', place: 1, finishMs: 11800 },
    { lane: 0, name: 'A', place: 2, finishMs: 12100 },
  ];
  const base = await resultHashOf('8F2A31C0', results);
  /* Order of the array must not matter; place decides. */
  assert.equal(base, await resultHashOf('8F2A31C0', [...results].reverse()));
  assert.notEqual(
    base,
    await resultHashOf('8F2A31C0', [
      { ...results[0], name: 'X' },
      results[1],
    ]),
  );
});

/* Defect class: a migration silently changing hashes already printed or
   exported for legacy races. Both the canonical bytes and their digest stay
   fixed when every row is an old all-finisher row. */
test('legacy result hash v1 remains byte-for-byte stable', async () => {
  const results = [
    { lane: 2, name: 'C', place: 1, finishMs: 11800 },
    { lane: 0, name: 'A', place: 2, finishMs: 12100 },
  ];
  assert.equal(
    resultInput('8f2a31c0', results),
    'ndcc-race-result-v1|8F2A31C0|1:2:C:11800|2:0:A:12100',
  );
  assert.equal(
    await resultHashOf('8F2A31C0', results),
    '2d90903e0e44372390dd110526eba25e7e44b568ff0555850e4669001ad7f0a7',
  );
});

const lockedPlan: LockedRacePlan = {
  schema: 1,
  engine: 'consequential-eight-v1',
  seed: 0x8f2a31c0,
  seedHex: '8F2A31C0',
  names: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  durationMs: 12_000,
  laps: 3,
  surprises: true,
  intensity: 'standard',
  trackShape: 'circuit',
  weather: 'drizzle',
  photoFinish: false,
  runners: Array.from({ length: 8 }, (_, lane) => ({
    lane,
    name: String.fromCharCode(65 + lane),
    baseFinishMs: 11_800 + lane * 100,
    A: 0.04 + lane * 0.001,
    w1: 1.1 + lane * 0.01,
    w2: 1.8 + lane * 0.01,
    ph1: 0.2 + lane * 0.01,
    ph2: 0.5 + lane * 0.01,
  })),
  events: [
    {
      id: 'event-boost',
      kind: 'turbo',
      label: 'Turbo leaf',
      tone: 'good',
      sound: 'boost',
      targetLanes: [0],
      consequence: 'advance',
      warningAtMs: 2_000,
      revealAtMs: 2_700,
      effectAtMs: 3_400,
      commentaryAtMs: 3_650,
      effectEndMs: 4_100,
      clockDeltaMsByLane: { 0: 450 },
      warningText: 'Something is rustling near lane one.',
      revealText: 'A turbo leaf appears for A.',
      commentaryText: 'A finds another gear.',
    },
    {
      id: 'event-retire',
      kind: 'shell-check',
      label: 'Shell check',
      tone: 'wild',
      sound: 'bell',
      targetLanes: [7],
      consequence: 'retire',
      warningAtMs: 6_000,
      revealAtMs: 6_700,
      effectAtMs: 7_400,
      commentaryAtMs: 7_650,
      effectEndMs: 7_650,
      clockDeltaMsByLane: { 7: 0 },
      warningText: 'The steward watches lane eight.',
      revealText: 'H heads safely to the lettuce tent.',
      commentaryText: 'H is safe, but their race is over.',
      retirementCode: 'shell-check',
      retirementLabel: 'Safe shell check',
    },
  ],
  cues: [
    {
      id: 'event-boost-warning',
      eventId: 'event-boost',
      phase: 'warning',
      atMs: 2_000,
      text: 'Something is rustling near lane one.',
      lane: 0,
      tone: 'good',
      sound: 'warning',
      big: false,
    },
    {
      id: 'event-boost-commentary',
      eventId: 'event-boost',
      phase: 'commentary',
      atMs: 3_650,
      text: 'A finds another gear.',
      lane: 0,
      tone: 'good',
      sound: 'boost',
      big: true,
    },
    {
      id: 'event-retire-commentary',
      eventId: 'event-retire',
      phase: 'commentary',
      atMs: 7_650,
      text: 'H is safe, but their race is over.',
      lane: 7,
      tone: 'wild',
      sound: 'bell',
      big: true,
    },
  ],
  results: [
    { lane: 0, name: 'A', place: 1, finishMs: 11_350, status: 'finished', progressAtStop: 1 },
    { lane: 1, name: 'B', place: 2, finishMs: null, status: 'classified', progressAtStop: 0.98 },
    { lane: 2, name: 'C', place: 3, finishMs: null, status: 'classified', progressAtStop: 0.96 },
    { lane: 3, name: 'D', place: 4, finishMs: null, status: 'classified', progressAtStop: 0.94 },
    { lane: 4, name: 'E', place: 5, finishMs: null, status: 'classified', progressAtStop: 0.92 },
    { lane: 5, name: 'F', place: 6, finishMs: null, status: 'classified', progressAtStop: 0.9 },
    { lane: 6, name: 'G', place: 7, finishMs: null, status: 'classified', progressAtStop: 0.88 },
    {
      lane: 7,
      name: 'H',
      place: 8,
      finishMs: null,
      status: 'retired',
      progressAtStop: 0.57,
      retiredAtMs: 7_400,
      retirementCode: 'shell-check',
      retirementLabel: 'Safe shell check',
    },
  ],
  winnerLane: 0,
  stopAtMs: 11_350,
};

const clonePlan = (): LockedRacePlan => structuredClone(lockedPlan);

/* Defect class: a plan hash depending on incidental object construction
   order or seed-hex casing instead of the semantic locked plan. */
test('the race plan canonical is deterministic and key-order independent', async () => {
  const reordered = clonePlan();
  reordered.seedHex = '8f2a31c0';
  reordered.events[0].clockDeltaMsByLane = { 3: 0, 0: 450, 2: 0 };

  const sameValues = clonePlan();
  sameValues.events[0].clockDeltaMsByLane = { 0: 450, 2: 0, 3: 0 };

  assert.match(canonicalRacePlan(lockedPlan), /^ndcc-race-plan-v1\|/);
  assert.equal(
    await planHashOf(lockedPlan),
    '573d671e6e48e826a4224579673359e032bbdc9056a0ce8a6bb9882272326dbb',
  );
  assert.equal(canonicalRacePlan(reordered), canonicalRacePlan(sameValues));
  assert.equal(await planHashOf(reordered), await planHashOf(sameValues));
});

/* Defect class: a consequential decision escaping the pre-race lock. Each
   material event phase and every result/retirement payload must alter it. */
test('the race plan hash binds phases, consequences, cues and classification', async () => {
  const base = await planHashOf(lockedPlan);
  const mutations: Array<[string, (plan: LockedRacePlan) => void]> = [
    ['warning time', (plan) => { plan.events[0].warningAtMs += 1; }],
    ['reveal time', (plan) => { plan.events[0].revealAtMs += 1; }],
    ['effect time', (plan) => { plan.events[0].effectAtMs += 1; }],
    ['commentary time', (plan) => { plan.events[0].commentaryAtMs += 1; }],
    ['effect end time', (plan) => { plan.events[0].effectEndMs += 1; }],
    ['target lane', (plan) => { plan.events[0].targetLanes[0] = 1; }],
    ['clock delta', (plan) => { plan.events[0].clockDeltaMsByLane[0] += 1; }],
    ['event commentary', (plan) => { plan.events[0].commentaryText += '!'; }],
    ['cue commentary', (plan) => { plan.cues[1].text += '!'; }],
    ['retirement code', (plan) => { plan.events[1].retirementCode = 'steward-check'; }],
    ['retirement label', (plan) => { plan.events[1].retirementLabel = 'Safe steward check'; }],
    ['result status', (plan) => { plan.results[1].status = 'retired'; }],
    ['result progress', (plan) => { plan.results[1].progressAtStop = 0.97; }],
    ['result retirement time', (plan) => { plan.results[7].retiredAtMs = 7_401; }],
    ['winner lane', (plan) => { plan.winnerLane = 1; }],
    ['stop time', (plan) => { plan.stopAtMs += 1; }],
  ];

  for (const [label, mutate] of mutations) {
    const changed = clonePlan();
    mutate(changed);
    assert.notEqual(await planHashOf(changed), base, label);
  }
});

/* Defect class: v2 falling back to the old four-field row and therefore
   missing the difference between an active classification and retirement. */
test('result hash v2 binds status, progress and retirement metadata', async () => {
  const base = await resultHashOf(lockedPlan.seedHex, lockedPlan.results);
  assert.match(resultInput(lockedPlan.seedHex, lockedPlan.results), /^ndcc-race-result-v2\|/);
  assert.equal(base, await resultHashOf(lockedPlan.seedHex, [...lockedPlan.results].reverse()));

  const mutations: Array<[string, (plan: LockedRacePlan) => void]> = [
    ['status', (plan) => { plan.results[1].status = 'retired'; }],
    ['finish time', (plan) => { plan.results[0].finishMs = 11_351; }],
    ['progress', (plan) => { plan.results[1].progressAtStop = 0.97; }],
    ['retired time', (plan) => { plan.results[7].retiredAtMs = 7_401; }],
    ['retirement code', (plan) => { plan.results[7].retirementCode = 'steward-check'; }],
    ['retirement label', (plan) => { plan.results[7].retirementLabel = 'Safe steward check'; }],
  ];

  for (const [label, mutate] of mutations) {
    const changed = clonePlan();
    mutate(changed);
    assert.notEqual(await resultHashOf(changed.seedHex, changed.results), base, label);
  }
});
