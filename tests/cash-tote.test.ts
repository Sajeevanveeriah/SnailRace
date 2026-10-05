import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CASH_TOTE,
  auctionOwners,
  isAuctionRace,
  normaliseCashTote,
  projectTote,
  roundDownTo10c,
  settleAuction,
  settleTote,
  toteIsLive,
  toteProceeds,
} from '../lib/cash-tote';
import type { AuctionBid, CashToteSettings, RaceHistoryEntry, ToteSale } from '../lib/types';

const live: CashToteSettings = {
  ...DEFAULT_CASH_TOTE,
  enabled: true,
  permitAcknowledgedAt: 1_700_000_000_000,
  permitReference: 'VGCCC minor gaming permit 12345',
};

let n = 0;
const sale = (lane: number, tickets: number, raceNo = 1, over: Partial<ToteSale> = {}): ToteSale => ({
  id: `s${++n}`,
  raceNo,
  lane,
  tickets,
  createdAt: n,
  ...over,
});
const bid = (lane: number, cents: number, bidder = 'Dave', raceNo = 6, over: Partial<AuctionBid> = {}): AuctionBid => ({
  id: `b${++n}`,
  raceNo,
  lane,
  bidder,
  cents,
  createdAt: n,
  ...over,
});

test('the tote is off by default and cannot go live without a permit attestation', () => {
  assert.equal(toteIsLive(DEFAULT_CASH_TOTE), false);
  assert.equal(toteIsLive({ ...DEFAULT_CASH_TOTE, enabled: true }), false);
  assert.equal(toteIsLive({ ...DEFAULT_CASH_TOTE, enabled: true, permitAcknowledgedAt: 1 }), false);
  assert.equal(toteIsLive({ ...DEFAULT_CASH_TOTE, enabled: true, permitReference: 'x' }), false);
  assert.equal(toteIsLive(live), true);
  /* A hand-edited backup that says "enabled" without the attestation loads disabled. */
  assert.equal(normaliseCashTote({ enabled: true }).enabled, false);
  assert.equal(normaliseCashTote({ enabled: true, permitAcknowledgedAt: 5, permitReference: ' ' }).enabled, false);
  assert.equal(normaliseCashTote(live).enabled, true);
  assert.equal(normaliseCashTote({ ...live, retainedPercent: 140 }).retainedPercent, 100);
  assert.equal(normaliseCashTote({ ...live, ticketCents: 7 }).ticketCents, 200);
  assert.equal(normaliseCashTote(null).ticketCents, 200);
});

test('dividends round down to ten cents and the breakage stays with the club', () => {
  /* 13 tickets at $2 = $26 pool. 50% retained = $13 returned. 3 winning
     tickets would be $4.333 each: paid $4.30, breakage 10c. */
  const sales = [sale(0, 3), sale(1, 4), sale(2, 6)];
  const t = settleTote({ sales, raceNo: 1, settings: live, winnerLane: 0, fieldSize: 8 });
  assert.equal(t.tickets, 13);
  assert.equal(t.poolCents, 2600);
  assert.equal(t.retainedCents, 1300);
  assert.equal(t.returnedCents, 1300);
  assert.equal(t.winningTickets, 3);
  assert.equal(t.dividendCents, 430);
  assert.equal(t.breakageCents, 1300 - 3 * 430);
  assert.equal(t.unbacked, false);
  /* Money is conserved: pool = retained + paid out + breakage. */
  assert.equal(t.poolCents, t.retainedCents + t.dividendCents * t.winningTickets + t.breakageCents);
  assert.equal(roundDownTo10c(433.33), 430);
  assert.equal(roundDownTo10c(-5), 0);
});

test('an unbacked winner leaves the whole pool with the club, stated as such', () => {
  const t = settleTote({ sales: [sale(1, 10)], raceNo: 1, settings: live, winnerLane: 0, fieldSize: 8 });
  assert.equal(t.unbacked, true);
  assert.equal(t.dividendCents, 0);
  assert.equal(t.winningTickets, 0);
  assert.equal(t.breakageCents, t.returnedCents);
  assert.equal(t.retainedCents + t.breakageCents, t.poolCents);
});

test('void and foreign-race tallies never count, and corrections cannot go negative', () => {
  const sales = [sale(0, 5), sale(0, -2), sale(0, 9, 2), sale(0, 50, 1, { void: true }), sale(1, -4)];
  const board = projectTote(sales, 1, live, 8);
  assert.equal(board.perLane[0].tickets, 3);
  assert.equal(board.perLane[1].tickets, 0);
  assert.equal(board.tickets, 3);
  assert.equal(board.poolCents, 600);
  /* With 3 tickets all on lane 0 the whole returned half pays lane 0. */
  assert.equal(board.perLane[0].wouldPayCents, 100);
  assert.equal(board.perLane[1].wouldPayCents, null);
});

test('the retained percentage is honoured exactly at the edges', () => {
  const all = settleTote({ sales: [sale(0, 4)], raceNo: 1, settings: { ...live, retainedPercent: 100 }, winnerLane: 0, fieldSize: 8 });
  assert.equal(all.returnedCents, 0);
  assert.equal(all.dividendCents, 0);
  const none = settleTote({ sales: [sale(0, 4)], raceNo: 1, settings: { ...live, retainedPercent: 0 }, winnerLane: 0, fieldSize: 8 });
  assert.equal(none.retainedCents, 0);
  assert.equal(none.dividendCents, 200);
});

test('the runner auction pays the highest standing bid on the winner', () => {
  const bids = [
    bid(0, 2000, 'Ann'), bid(0, 3500, 'Bob'), bid(0, 3500, 'Cat'),
    bid(1, 1500, 'Dee'), bid(2, 4000, 'Eve', 6, { void: true }), bid(3, 999, 'Fay', 5),
  ];
  const owners = auctionOwners(bids, 6, 8);
  assert.deepEqual(owners, [
    { lane: 0, bidder: 'Bob', cents: 3500 },
    { lane: 1, bidder: 'Dee', cents: 1500 },
  ]);
  const won = settleAuction({ bids, raceNo: 6, retainedPercent: 50, winnerLane: 0, fieldSize: 8 });
  assert.equal(won.poolCents, 5000);
  assert.equal(won.prizeCents, 2500);
  assert.equal(won.retainedCents, 2500);
  assert.deepEqual(won.winningOwner, { bidder: 'Bob', cents: 3500 });
  const unowned = settleAuction({ bids, raceNo: 6, retainedPercent: 50, winnerLane: 5, fieldSize: 8 });
  assert.equal(unowned.prizeCents, 0);
  assert.equal(unowned.retainedCents, 5000);
  assert.equal(unowned.winningOwner, null);
  assert.equal(isAuctionRace(live, 6, 6), true);
  assert.equal(isAuctionRace(live, 5, 6), false);
  assert.equal(isAuctionRace({ ...live, auctionLastRace: false }, 6, 6), false);
  assert.equal(isAuctionRace(DEFAULT_CASH_TOTE, 6, 6), false);
});

test('night proceeds sum only standing races', () => {
  const t = settleTote({ sales: [sale(0, 3), sale(1, 4), sale(2, 6)], raceNo: 1, settings: live, winnerLane: 0, fieldSize: 8 });
  const entry = (over: Partial<RaceHistoryEntry>): RaceHistoryEntry => ({
    raceNo: 1, raceType: 'Heat', seedHex: '00000001', fieldSize: 8, durationMs: 1000, at: 1,
    results: [], potCents: 0, photoFinish: false, ...over,
  });
  const history = [
    entry({ tote: t }),
    entry({ raceNo: 2, tote: t, void: true }),
    entry({ raceNo: 6, auction: settleAuction({ bids: [bid(0, 5000)], raceNo: 6, retainedPercent: 40, winnerLane: 0, fieldSize: 8 }) }),
  ];
  const p = toteProceeds(history);
  assert.equal(p.races, 1);
  assert.equal(p.toteCents, t.retainedCents + t.breakageCents);
  assert.equal(p.auctionCents, 2000);
  assert.equal(p.paidOutCents, t.dividendCents * t.winningTickets + 3000);
});

test('the cash tote is structurally separate from the engine, chips and donations', () => {
  const source = readFileSync('lib/cash-tote.ts', 'utf8');
  for (const forbidden of ['./race-engine', './tote', './settlement', './event-store', './stripe', './use-donations']) {
    assert.equal(source.includes(`from '${forbidden}'`), false, `cash-tote imports ${forbidden}`);
  }
  for (const file of ['lib/race-engine.ts', 'lib/tote.ts', 'lib/stripe.ts', 'lib/stripe-read.ts', 'lib/live/store.ts']) {
    assert.equal(readFileSync(file, 'utf8').includes('cash-tote'), false, `${file} reaches the cash tote`);
  }
});
