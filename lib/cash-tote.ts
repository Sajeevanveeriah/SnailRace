import type {
  AuctionBid,
  AuctionSettlement,
  CashToteSettings,
  RaceHistoryEntry,
  ToteDividend,
  ToteSale,
} from './types';

/**
 * Permit-gated cash tote maths.
 *
 * This module is deliberately an island. It imports nothing from the race
 * engine, the free fun-chip maths, the settlement path or the donation
 * ledger, and none of those import it: a cash tote can read a result that
 * already exists, and that is the only direction the data flows.
 *
 * It is also OFF by default and refuses to go live without the operator's
 * permit attestation. The app records that attestation; it does not claim
 * the club's activity is lawful. The club obtains its own advice.
 *
 * Rounding follows the convention a room already understands from a racing
 * tote: dividends are rounded DOWN to the nearest ten cents and the breakage
 * stays with the club. Every number is in integer cents.
 */

export const DEFAULT_CASH_TOTE: CashToteSettings = {
  enabled: false,
  permitAcknowledgedAt: null,
  permitReference: '',
  ticketCents: 200,
  retainedPercent: 50,
  auctionLastRace: true,
  auctionRetainedPercent: 50,
};

export const TICKET_PRICE_OPTIONS_CENTS = [100, 200, 500, 1000] as const;

const clampPercent = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback;

/** Bring a stored or hand-edited settings object back to something safe. */
export function normaliseCashTote(value: unknown): CashToteSettings {
  const base = { ...DEFAULT_CASH_TOTE };
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<CashToteSettings>;
  const reference = typeof v.permitReference === 'string' ? v.permitReference.slice(0, 80) : '';
  const acknowledgedAt =
    typeof v.permitAcknowledgedAt === 'number' && Number.isFinite(v.permitAcknowledgedAt) && v.permitAcknowledgedAt > 0
      ? v.permitAcknowledgedAt
      : null;
  const ticketCents =
    typeof v.ticketCents === 'number' && Number.isSafeInteger(v.ticketCents) && v.ticketCents >= 50 && v.ticketCents <= 10_000
      ? v.ticketCents
      : base.ticketCents;
  return {
    /* Enabled survives only with a complete attestation behind it. */
    enabled: v.enabled === true && acknowledgedAt !== null && reference.trim().length > 0,
    permitAcknowledgedAt: acknowledgedAt,
    permitReference: reference,
    ticketCents,
    retainedPercent: clampPercent(v.retainedPercent, base.retainedPercent),
    auctionLastRace: v.auctionLastRace !== false,
    auctionRetainedPercent: clampPercent(v.auctionRetainedPercent, base.auctionRetainedPercent),
  };
}

/** The gate. Nothing tote-related renders or settles unless this is true. */
export const toteIsLive = (settings: CashToteSettings): boolean =>
  settings.enabled &&
  settings.permitAcknowledgedAt !== null &&
  settings.permitReference.trim().length > 0;

/** Round down to the nearest ten cents. */
export const roundDownTo10c = (cents: number): number => Math.floor(Math.max(0, cents) / 10) * 10;

/** Standing ticket counts per lane for one race. Never below zero. */
export function ticketsByLane(sales: ToteSale[], raceNo: number, fieldSize: number): number[] {
  const out = new Array<number>(fieldSize).fill(0);
  for (const sale of sales) {
    if (sale.void || sale.raceNo !== raceNo) continue;
    if (sale.lane < 0 || sale.lane >= fieldSize) continue;
    out[sale.lane] += sale.tickets;
  }
  return out.map((n) => Math.max(0, n));
}

export const totalTickets = (perLane: number[]): number => perLane.reduce((s, n) => s + n, 0);

export interface ToteProjection {
  lane: number;
  tickets: number;
  /** What one ticket on this runner would pay if it won right now. Null with no tickets. */
  wouldPayCents: number | null;
}

/** The board the room sees while the market is open. */
export function projectTote(
  sales: ToteSale[],
  raceNo: number,
  settings: CashToteSettings,
  fieldSize: number,
): { perLane: ToteProjection[]; poolCents: number; returnedCents: number; tickets: number } {
  const perLane = ticketsByLane(sales, raceNo, fieldSize);
  const tickets = totalTickets(perLane);
  const poolCents = tickets * settings.ticketCents;
  const returnedCents = poolCents - retainedFrom(poolCents, settings.retainedPercent);
  return {
    perLane: perLane.map((n, lane) => ({
      lane,
      tickets: n,
      wouldPayCents: n > 0 ? roundDownTo10c(returnedCents / n) : null,
    })),
    poolCents,
    returnedCents,
    tickets,
  };
}

/** The club's share of a pool, rounded to the cent. */
export const retainedFrom = (poolCents: number, percent: number): number =>
  Math.round((poolCents * clampPercent(percent, 0)) / 100);

/** Settle one race's tote against the lane that won. Pure. */
export function settleTote(input: {
  sales: ToteSale[];
  raceNo: number;
  settings: CashToteSettings;
  winnerLane: number;
  fieldSize: number;
}): ToteDividend {
  const perLane = ticketsByLane(input.sales, input.raceNo, input.fieldSize);
  const tickets = totalTickets(perLane);
  const poolCents = tickets * input.settings.ticketCents;
  const retainedCents = retainedFrom(poolCents, input.settings.retainedPercent);
  const returnedCents = poolCents - retainedCents;
  const winningTickets = perLane[input.winnerLane] ?? 0;
  const dividendCents = winningTickets > 0 ? roundDownTo10c(returnedCents / winningTickets) : 0;
  const paid = dividendCents * winningTickets;
  return {
    raceNo: input.raceNo,
    ticketCents: input.settings.ticketCents,
    retainedPercent: input.settings.retainedPercent,
    perLane: perLane.map((n, lane) => ({ lane, tickets: n })),
    tickets,
    poolCents,
    retainedCents,
    returnedCents,
    winnerLane: input.winnerLane,
    winningTickets,
    dividendCents,
    breakageCents: returnedCents - paid,
    unbacked: winningTickets === 0,
  };
}

/** Highest standing bid per runner. Ties go to the earlier bid. */
export function auctionOwners(
  bids: AuctionBid[],
  raceNo: number,
  fieldSize: number,
): AuctionSettlement['owners'] {
  const best = new Map<number, AuctionBid>();
  for (const bid of bids) {
    if (bid.void || bid.raceNo !== raceNo || bid.cents <= 0) continue;
    if (bid.lane < 0 || bid.lane >= fieldSize) continue;
    const current = best.get(bid.lane);
    if (!current || bid.cents > current.cents || (bid.cents === current.cents && bid.createdAt < current.createdAt)) {
      best.set(bid.lane, bid);
    }
  }
  return [...best.values()]
    .sort((a, b) => a.lane - b.lane)
    .map((bid) => ({ lane: bid.lane, bidder: bid.bidder.trim() || 'Anonymous', cents: bid.cents }));
}

/** Settle the runner auction against the lane that won. Pure. */
export function settleAuction(input: {
  bids: AuctionBid[];
  raceNo: number;
  retainedPercent: number;
  winnerLane: number;
  fieldSize: number;
}): AuctionSettlement {
  const owners = auctionOwners(input.bids, input.raceNo, input.fieldSize);
  const poolCents = owners.reduce((s, o) => s + o.cents, 0);
  const retainedCents = retainedFrom(poolCents, input.retainedPercent);
  const winner = owners.find((o) => o.lane === input.winnerLane) ?? null;
  const prizeCents = winner ? roundDownTo10c(poolCents - retainedCents) : 0;
  return {
    raceNo: input.raceNo,
    retainedPercent: input.retainedPercent,
    owners,
    poolCents,
    /* An unowned winner leaves the whole pool with the club. */
    retainedCents: winner ? poolCents - prizeCents : poolCents,
    prizeCents,
    winnerLane: input.winnerLane,
    winningOwner: winner ? { bidder: winner.bidder, cents: winner.cents } : null,
  };
}

/** Everything the club keeps from the tote and auction across the night. */
export function toteProceeds(history: RaceHistoryEntry[]): {
  toteCents: number;
  auctionCents: number;
  paidOutCents: number;
  races: number;
} {
  let toteCents = 0;
  let auctionCents = 0;
  let paidOutCents = 0;
  let races = 0;
  for (const entry of history) {
    if (entry.void) continue;
    if (entry.tote) {
      races += 1;
      toteCents += entry.tote.retainedCents + entry.tote.breakageCents;
      paidOutCents += entry.tote.dividendCents * entry.tote.winningTickets;
    }
    if (entry.auction) {
      auctionCents += entry.auction.retainedCents;
      paidOutCents += entry.auction.prizeCents;
    }
  }
  return { toteCents, auctionCents, paidOutCents, races };
}

/** Is this race the auctioned one? Only the last race on the card, when enabled. */
export const isAuctionRace = (settings: CashToteSettings, raceNo: number, plannedRaces: number): boolean =>
  toteIsLive(settings) && settings.auctionLastRace && raceNo === plannedRaces;
