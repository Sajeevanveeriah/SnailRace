import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standingsFrom, sponsorFor } from '../lib/standings';
import type { RaceHistoryEntry } from '../lib/types';

const race = (raceNo: number, order: string[], over: Partial<RaceHistoryEntry> = {}): RaceHistoryEntry => ({
  raceNo,
  raceType: 'Heat',
  seedHex: 'AAAA0000',
  fieldSize: order.length,
  durationMs: 12_000,
  at: raceNo,
  results: order.map((name, i) => ({ lane: i, name, place: i + 1, finishMs: 12_000 + i * 100 })),
  potCents: 0,
  photoFinish: false,
  ...over,
});

/* Defect class: a voided (undone) race still scoring points. The undo is a
   compensating entry, and the table must treat it as if the race never
   stood. */
test('voided races score nothing', () => {
  const history = [
    race(2, ['B', 'A'], { void: true, voidReason: 'undone' }),
    race(1, ['A', 'B']),
  ];
  const table = standingsFrom(history);
  assert.equal(table[0].name, 'A');
  assert.equal(table[0].points, 5);
  assert.equal(table[0].races, 1);
  assert.equal(table.find((r) => r.name === 'B')?.points, 3);
});

test('points order: consistent seconds beat one lucky win', () => {
  const history = [
    race(1, ['A', 'B', 'C', 'D']),
    race(2, ['D', 'B', 'C', 'A']),
    race(3, ['C', 'B', 'A', 'D']),
  ];
  const table = standingsFrom(history);
  assert.equal(table[0].name, 'B'); // three seconds, 9 points
});

test('sponsors cycle evenly', () => {
  const sponsors = ['One', ' ', 'Two'];
  assert.equal(sponsorFor(sponsors, 1), 'One');
  assert.equal(sponsorFor(sponsors, 2), 'Two');
  assert.equal(sponsorFor(sponsors, 3), 'One');
  assert.equal(sponsorFor([], 1), '');
});
