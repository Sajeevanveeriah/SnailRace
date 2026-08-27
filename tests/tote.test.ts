import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipsAfter, oddsFor, poolsFor, settleBets } from '../lib/tote';
import type { Bet, Donation } from '../lib/types';

const donation = (over: Partial<Donation>): Donation => ({
  id: Math.random().toString(36),
  raceNo: 1,
  lane: 0,
  snailName: 'Speedy',
  backerName: '',
  cents: 1000,
  source: 'cash',
  createdAt: 0,
  ...over,
});

/* Defect class: odds outside sane bounds, or infinity on an unbacked lane. */
test('odds are bounded and open at the fair price', () => {
  assert.equal(oddsFor(0, 0, 6), 6);
  assert.equal(oddsFor(0, 10_000, 6), 30); // capped, not infinite
  assert.equal(oddsFor(10_000, 10_000, 6), 1.01);
  assert.equal(oddsFor(2_500, 10_000, 6), 4);
});

/* Defect class: refunded or voided money still steering the pot. */
test('poolsFor excludes void donations and other races', () => {
  const donations = [
    donation({ lane: 0, cents: 1000 }),
    donation({ lane: 0, cents: 500, void: true }),
    donation({ lane: 1, cents: 2000, raceNo: 2 }),
  ];
  const { lanes, potCents } = poolsFor(donations, ['A', 'B'], 1);
  assert.equal(potCents, 1000);
  assert.equal(lanes[0].cents, 1000);
  assert.equal(lanes[1].cents, 0);
});

const bet = (over: Partial<Bet>): Bet => ({
  id: Math.random().toString(36),
  raceNo: 1,
  lane: 0,
  snailName: 'Speedy',
  punter: 'dave',
  chips: 50,
  odds: 4,
  settled: false,
  ...over,
});

/* Defect class: double settlement. Settling twice must be a no-op, and the
   chips paid must not change - this is the exactly-once property. */
test('settlement is exactly-once', () => {
  const book = [bet({ lane: 0 }), bet({ lane: 1 }), bet({ raceNo: 2, lane: 0 })];
  const once = settleBets(book, 1, 0);
  const twice = settleBets(once, 1, 0);
  assert.deepEqual(twice, once);

  const winners = once.filter((b) => b.won);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].returned, 200); // 50 chips at 4.00, stake included
  /* The race-2 bet is untouched. */
  assert.equal(once.find((b) => b.raceNo === 2)?.settled, false);

  /* Settling again against a DIFFERENT winner must change nothing either. */
  const rigged = settleBets(once, 1, 1);
  assert.deepEqual(rigged, once);
});

test('settlement with no winner marks every bet lost', () => {
  const settled = settleBets([bet({ lane: 0 }), bet({ lane: 1 })], 1, -1);
  assert.ok(settled.every((b) => b.settled && !b.won && b.returned === 0));
});

test('chipsAfter counts settled returns only', () => {
  const book = settleBets([bet({ lane: 0 }), bet({ lane: 1 })], 1, 0);
  assert.equal(chipsAfter(100, book), 300);
});
