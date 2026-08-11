import type { Bet, Donation } from './types';

/**
 * Tote maths.
 *
 * The odds on the board are PARIMUTUEL: they are computed from what the room
 * has actually backed, exactly as a real tote works. They are not a
 * prediction. Every snail wins with probability exactly 1/N because the draw
 * is a uniform shuffle that never reads this file. The board says so out
 * loud, and `fairChance()` below is the number that is actually true.
 *
 * Deliberately no house margin: this is a fundraiser, and shading the odds
 * would only confuse the reconciliation at the end of the night.
 */

export interface LanePool {
  lane: number;
  name: string;
  cents: number;
  backers: number;
  /** Decimal odds: the return per 1 unit staked, including the stake. */
  odds: number;
  /** Share of the pot backed on this lane, 0 to 1. */
  share: number;
}

export const fairChance = (fieldSize: number): number => 1 / Math.max(1, fieldSize);

export function poolsFor(
  donations: Donation[],
  names: string[],
  raceNo: number,
): { lanes: LanePool[]; potCents: number } {
  const live = donations.filter((d) => !d.void && d.raceNo === raceNo);
  const potCents = live.reduce((sum, d) => sum + d.cents, 0);

  const lanes: LanePool[] = names.map((name, lane) => {
    const mine = live.filter((d) => d.lane === lane);
    const cents = mine.reduce((sum, d) => sum + d.cents, 0);
    return {
      lane,
      name,
      cents,
      backers: mine.length,
      share: potCents > 0 ? cents / potCents : 0,
      odds: oddsFor(cents, potCents, names.length),
    };
  });

  return { lanes, potCents };
}

/**
 * Decimal odds from the pool split.
 *
 * With nothing backed anywhere the board opens at the fair price, N-for-1.
 * A lane carrying none of the pot in a live market is capped rather than
 * shown as infinity, because a five-digit price on a projector reads as a
 * bug rather than as a bargain.
 */
export function oddsFor(laneCents: number, potCents: number, fieldSize: number): number {
  if (potCents <= 0) return round2(fieldSize);
  if (laneCents <= 0) return round2(Math.min(fieldSize * 5, 40));
  return round2(Math.max(1.01, potCents / laneCents));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Settle every open bet on `raceNo` against the winning lane. */
export function settleBets(bets: Bet[], raceNo: number, winningLane: number): Bet[] {
  return bets.map((b) => {
    if (b.settled || b.raceNo !== raceNo) return b;
    const won = b.lane === winningLane;
    return {
      ...b,
      settled: true,
      won,
      returned: won ? Math.round(b.chips * b.odds) : 0,
    };
  });
}

export function chipsAfter(bank: number, bets: Bet[]): number {
  return bets.reduce((total, b) => total + (b.settled ? (b.returned ?? 0) : 0), bank);
}
