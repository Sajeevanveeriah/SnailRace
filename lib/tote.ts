import type { Bet } from './types';

/**
 * Free fun-chip maths.
 *
 * Donations never enter this module. Every runner carries the same fixed,
 * fair N-for-1 play price and the only pool shown is the room's free chips.
 * That separation is structural: changing a donation can neither change a
 * chip return nor make the race resemble a cash wagering product.
 */

export interface FunChipLane {
  lane: number;
  name: string;
  chips: number;
  backers: number;
  /** Decimal odds: the return per 1 unit staked, including the stake. */
  odds: number;
  /** Share of the free-chip picks on this lane, 0 to 1. */
  share: number;
}

export const fairChance = (fieldSize: number): number => 1 / Math.max(1, fieldSize);

/** The fixed free-chip return for an equal-chance field. */
export const fairFunChipOdds = (fieldSize: number): number =>
  round2(Math.max(1.01, fieldSize));

export function funChipPoolsFor(
  bets: Bet[],
  names: string[],
  raceNo: number,
): { lanes: FunChipLane[]; totalChips: number } {
  const live = bets.filter((bet) => !bet.settled && bet.raceNo === raceNo);
  const totalChips = live.reduce((sum, bet) => sum + bet.chips, 0);
  const odds = fairFunChipOdds(names.length);

  const lanes: FunChipLane[] = names.map((name, lane) => {
    const mine = live.filter((bet) => bet.lane === lane);
    const chips = mine.reduce((sum, bet) => sum + bet.chips, 0);
    return {
      lane,
      name,
      chips,
      backers: mine.length,
      share: totalChips > 0 ? chips / totalChips : 0,
      odds,
    };
  });

  return { lanes, totalChips };
}

/**
 * Decimal odds from the pool split.
 *
 * With nothing backed anywhere the board opens at the fair price, N-for-1.
 * A lane carrying none of the pot in a live market is capped rather than
 * shown as infinity, because a five-digit price on a projector reads as a
 * bug rather than as a bargain.
 */
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
