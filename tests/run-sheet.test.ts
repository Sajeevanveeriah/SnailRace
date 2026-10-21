import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../lib/event-store';
import { freshCard, runSheetLocks, setRaceSettings, type CardState } from '../lib/card';
import { designName, designNameOf } from '../lib/courses';
import { championField, lengthPhrase, raceSettings, raceSummary, ranSummary, snailOfLane } from '../lib/run-sheet';
import { isAuctionRace, DEFAULT_CASH_TOTE } from '../lib/cash-tote';
import type { RaceHistoryEntry } from '../lib/types';

const edit = (card: CardState, raceNo: number, patch: Parameters<typeof setRaceSettings>[2]): CardState => {
  const next = setRaceSettings(card, raceNo, patch, runSheetLocks(card, { history: [] }));
  if ('error' in next) throw new Error(next.error);
  return next;
};

test('the design name follows the design a race runs on, never the straight\'s course id', () => {
  assert.equal(designName(null, 'lanes', 1), 'Side-on straight');
  assert.equal(designName(['straight', 'boundary-oval'], 'lanes', 2), 'Boundary Oval');
  assert.equal(designName(['straight', 'boundary-oval'], 'lanes', 3), 'Side-on straight');
  assert.equal(designNameOf('lanes', 'floodlight-eight'), 'Side-on straight');
  assert.equal(designNameOf('circuit', 'pavilion-chicane'), 'Pavilion Chicane');
});

test('a race takes the night settings unless its run sheet row says otherwise', () => {
  const s = freshState();
  const base = raceSettings(s, 1);
  assert.equal(base.trackShape, 'lanes');
  assert.equal(base.designName, 'Side-on straight');
  assert.equal(base.durationMs, 30_000);
  assert.equal(base.laps, 1);
  assert.equal(base.intensity, 'standard');
  assert.equal(base.title, 'Race 1');
  assert.equal(base.typeLabel, '');
  assert.equal(base.camera, null);
  assert.equal(raceSummary(base), 'Side-on straight, 30 s, Standard surprises');

  const card = edit(edit(s.card, 2, { design: 'boundary-oval', lengthMs: 20_000, laps: 2, intensity: 'big', camera: 'full', raceType: 'Final' }), 3, { lengthMs: 7_000 });
  const two = raceSettings({ ...s, card }, 2);
  assert.equal(two.trackShape, 'circuit');
  assert.equal(two.courseId, 'boundary-oval');
  assert.equal(two.durationMs, 40_000);
  assert.equal(lengthPhrase(two), '2 laps of 20 s');
  assert.equal(two.intensity, 'big');
  assert.equal(two.camera, 'full');
  assert.equal(two.title, 'Final 2');
  const three = raceSettings({ ...s, card }, 3);
  assert.equal(three.durationMs, 7_000);
  assert.equal(three.trackShape, 'lanes');
  /* A circuit night with no override keeps the stored duration exactly. */
  const circuit = raceSettings({ ...s, trackDesigns: ['boundary-oval'], trackShape: 'circuit', raceDurationMs: 120_000, laps: 3 }, 1);
  assert.equal(circuit.durationMs, 120_000);
  assert.equal(circuit.laps, 3);
  assert.equal(circuit.lapMs, 40_000);
});

const ran = (raceNo: number, winnerLane: number, extra: Partial<RaceHistoryEntry> = {}): RaceHistoryEntry => ({
  raceNo, raceType: 'League', seedHex: 'ABCDEF01', fieldSize: 8, durationMs: 30_000, at: raceNo, potCents: 0, photoFinish: false,
  snailOffset: (raceNo - 1) * 8, trackShape: 'lanes', courseId: 'boundary-oval', laps: 1, intensity: 'standard',
  results: Array.from({ length: 8 }, (_, lane) => ({
    lane, name: `S${lane}`, finishMs: 20_000 + lane * 100 + raceNo,
    place: lane === winnerLane ? 1 : lane < winnerLane ? lane + 2 : lane + 1,
  })),
  ...extra,
});

test('a recorded race describes what it ran on from its own record', () => {
  assert.equal(ranSummary(ran(1, 0)), 'Side-on straight, 30 s, Standard surprises');
  assert.equal(snailOfLane(ran(2, 0), 3), 12);
  assert.equal(snailOfLane({ raceNo: 11, snails: [6, 18, 27] }, 1), 18);
});

test('the run-off field is tonight\'s winners, topped up with runners-up when there are fewer than eight', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ran(i + 1, i % 8));
  const field = championField(ten);
  assert.equal(field.length, 10);
  assert.equal(field[0], 1);
  assert.equal(field[1], 10);
  const three = championField([ran(1, 0), ran(2, 0), ran(3, 0), { ...ran(4, 0), void: true }]);
  /* Three winners, three seconds, then two thirds. */
  assert.deepEqual(three, [1, 9, 17, 2, 10, 18, 3, 11]);
  const many = championField(Array.from({ length: 14 }, (_, i) => ran(i + 1, 0)));
  assert.equal(many.length, 12);
});

test('an auction under way stays on its race when a race is added after the card', () => {
  const live = { ...DEFAULT_CASH_TOTE, enabled: true, permitAcknowledgedAt: 1, permitReference: 'Permit 1', auctionLastRace: true };
  assert.equal(isAuctionRace(live, 10, 10), true);
  assert.equal(isAuctionRace(live, 11, 11, []), true);
  assert.equal(isAuctionRace(live, 11, 11, [{ raceNo: 10 }]), false);
  assert.equal(isAuctionRace(live, 10, 11, [{ raceNo: 10 }]), true);
  assert.equal(isAuctionRace(live, 11, 11, [{ raceNo: 10, void: true }]), true);
  assert.equal(raceSettings({ ...freshState(), card: freshCard() }, 11).snails[0], 101);
});
