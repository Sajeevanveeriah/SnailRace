import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chipsAfter,
  fairFunChipOdds,
  funChipPoolsFor,
  settleBets,
} from '../lib/tote';
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

/* Prices follow only the equal-chance field size, never the amount on a lane. */
test('fun-chip odds are fixed at the fair N-for-1 price', () => {
  assert.equal(fairFunChipOdds(8), 8);
  assert.equal(fairFunChipOdds(6), 6);
  assert.equal(fairFunChipOdds(1), 1.01);
});

test('fun-chip pools include only open picks from the current race', () => {
  const book = [
    bet({ lane: 0, chips: 10 }),
    bet({ lane: 0, chips: 50, settled: true }),
    bet({ lane: 1, chips: 20, raceNo: 2 }),
  ];
  const { lanes, totalChips } = funChipPoolsFor(book, ['A', 'B'], 1);
  assert.equal(totalChips, 10);
  assert.equal(lanes[0].chips, 10);
  assert.equal(lanes[1].chips, 0);
  assert.deepEqual(lanes.map((lane) => lane.odds), [2, 2]);
});

type DonationCannotEnterFunChipPools = Donation extends Parameters<typeof funChipPoolsFor>[0][number]
  ? false
  : true;

test('donation amounts cannot change fun-chip odds or returns', () => {
  const structuralGuard: DonationCannotEnterFunChipPools = true;
  assert.equal(structuralGuard, true);

  const names = ['Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher'];
  const book = [bet({ lane: 0, chips: 25, odds: 8 })];
  const donations = [donation({ lane: 0, cents: 100 })];
  const before = funChipPoolsFor(book, names, 1);

  donations[0].cents = 100_000_000;
  donations.push(donation({ lane: 7, cents: 900_000_000 }));
  const after = funChipPoolsFor(book, names, 1);

  assert.deepEqual(after, before);
  assert.ok(before.lanes.every((lane) => lane.odds === 8));
  const beforeReturn = settleBets(
    [bet({ chips: 25, odds: before.lanes[0].odds })],
    1,
    0,
  )[0].returned;
  const afterReturn = settleBets(
    [bet({ chips: 25, odds: after.lanes[0].odds })],
    1,
    0,
  )[0].returned;
  assert.equal(beforeReturn, 200);
  assert.equal(afterReturn, beforeReturn);
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
