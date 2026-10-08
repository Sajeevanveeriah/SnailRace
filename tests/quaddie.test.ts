import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUADDIE, normaliseQuaddie, picksMatchLegs, quaddieIsLive, quaddieOpen, quaddieStatus, winnerSnailFor, type QuaddieEntry } from '../lib/quaddie';
import type { RaceHistoryEntry } from '../lib/types';

const live = () => normaliseQuaddie({ ...DEFAULT_QUADDIE, enabled: true, permitReference: 'Club authority 77', permitAcknowledgedAt: 1 });

const won = (raceNo: number, lane: number): RaceHistoryEntry => ({
  raceNo, raceType: 'Heat', seedHex: 'ABCDEF01', fieldSize: 10, durationMs: 1, at: raceNo, potCents: 0, photoFinish: false,
  results: Array.from({ length: 10 }, (_, i) => ({ lane: i, name: `S${i}`, place: i === lane ? 1 : i < lane ? i + 2 : i + 1, finishMs: null })),
});

const entry = (id: string, holder: string, picks: number[]): QuaddieEntry => ({ id, holder, picks, createdAt: 1 });

test('the quaddie is off by default and cannot go live without a permit attestation', () => {
  assert.equal(quaddieIsLive(DEFAULT_QUADDIE), false);
  assert.equal(quaddieIsLive(normaliseQuaddie({ ...DEFAULT_QUADDIE, enabled: true })), false);
  assert.equal(quaddieIsLive(normaliseQuaddie({ ...DEFAULT_QUADDIE, enabled: true, permitReference: 'x' })), false);
  assert.equal(quaddieIsLive(live()), true);
  /* A backup cannot smuggle a fifth leg or a duplicate. */
  assert.deepEqual(normaliseQuaddie({ legs: [3, 3, 5, 7, 9] }).legs, [3, 5, 7, 9]);
  assert.deepEqual(normaliseQuaddie({ legs: [2, 4, 6] }).legs, [3, 5, 7, 9]);
});

test('picks must name a snail that actually runs in each leg', () => {
  const legs = [3, 5, 7, 9];
  assert.equal(picksMatchLegs([23, 45, 63, 88], legs), true);
  assert.equal(picksMatchLegs([23, 45, 63, 91], legs), false);
  assert.equal(picksMatchLegs([23, 45, 63], legs), false);
  assert.equal(winnerSnailFor([won(3, 6)], 3), 27);
  assert.equal(winnerSnailFor([won(3, 6)], 5), null);
});

test('the pool follows the legs and pays every four-leg winner rounded down to ten cents', () => {
  const settings = live();
  const entries = [
    entry('a', 'Priya', [23, 45, 63, 88]),
    entry('b', 'Table 4', [23, 45, 63, 88]),
    entry('c', 'Dan', [27, 45, 63, 88]),
    entry('d', 'Void', [23, 45, 63, 88]),
  ];
  entries[3].void = true;
  const before = quaddieStatus(settings, entries, []);
  assert.equal(before.entries, 3);
  assert.equal(before.poolCents, 3000);
  assert.equal(before.retainedCents, 600);
  assert.equal(before.returnedCents, 2400);
  assert.equal(before.legsRun, 0);
  assert.equal(before.alive.length, 3);

  const afterTwo = quaddieStatus(settings, entries, [won(3, 2), won(5, 4)]);
  assert.equal(afterTwo.legsRun, 2);
  assert.deepEqual(afterTwo.legs.map((l) => l.alive), [2, 2, null, null]);
  assert.equal(afterTwo.complete, false);

  const done = quaddieStatus(settings, entries, [won(3, 2), won(5, 4), won(7, 2), won(9, 7)]);
  assert.equal(done.complete, true);
  assert.deepEqual(done.winners.map((w) => w.holder), ['Priya', 'Table 4']);
  assert.equal(done.dividendCents, 1200);
  assert.equal(done.breakageCents, 0);

  const three = quaddieStatus(settings, entries.concat(entry('e', 'Mel', [23, 45, 63, 88])), [won(3, 2), won(5, 4), won(7, 2), won(9, 7)]);
  /* 4 standing entries, $32 returned, three winners: $10.60 each, 20c breakage. */
  assert.equal(three.returnedCents, 3200);
  assert.equal(three.dividendCents, 1060);
  assert.equal(three.breakageCents, 20);

  const nobody = quaddieStatus(settings, entries, [won(3, 9), won(5, 4), won(7, 2), won(9, 7)]);
  assert.equal(nobody.unwon, true);
  assert.equal(nobody.dividendCents, 0);
});

test('legs only count in order and entries close at the first leg', () => {
  const settings = live();
  /* Leg 3 ran before leg 1 (an operator skipped ahead): it does not count yet. */
  const skipped = quaddieStatus(settings, [entry('a', 'P', [23, 45, 63, 88])], [won(7, 2)]);
  assert.equal(skipped.legsRun, 0);
  assert.equal(quaddieOpen(settings, [], false, 1), true);
  assert.equal(quaddieOpen(settings, [], true, 3), false);
  assert.equal(quaddieOpen(settings, [won(3, 1)], false, 4), false);
  assert.equal(quaddieOpen(DEFAULT_QUADDIE, [], false, 1), false);
});
