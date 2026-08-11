/**
 * Shared domain types.
 *
 * Money is handled in two forms and they are never mixed:
 *   - `cents`  integer minor units, the only form sent to or read from Stripe
 *   - `amount` a decimal AUD number, used for on-screen display only
 * Any value crossing the network boundary is in cents.
 */

export type DonationSource = 'stripe' | 'cash';

export interface Racer {
  /** Lane index, 0-based. Stable for the life of a race. */
  lane: number;
  name: string;
}

export interface Donation {
  id: string;
  /** Race number this donation is attached to. */
  raceNo: number;
  lane: number;
  snailName: string;
  backerName: string;
  cents: number;
  source: DonationSource;
  createdAt: number;
  /** Present for Stripe donations only. */
  sessionId?: string;
  /** Voided entries stay in the ledger for auditability but leave the totals. */
  void?: boolean;
}

export interface RaceResult {
  lane: number;
  name: string;
  place: number;
  finishMs: number;
}

export interface RaceHistoryEntry {
  raceNo: number;
  raceType: string;
  seedHex: string;
  fieldSize: number;
  durationMs: number;
  at: number;
  results: RaceResult[];
  /** Total cents backed on this race, all lanes, all sources. */
  potCents: number;
  photoFinish: boolean;
}

/** A free-to-play wager. No real money, no cash payout. */
export interface Bet {
  id: string;
  raceNo: number;
  lane: number;
  snailName: string;
  punter: string;
  /** Play-money chips staked. */
  chips: number;
  /** Decimal odds locked in at the moment the bet was placed. */
  odds: number;
  settled: boolean;
  won?: boolean;
  returned?: number;
}

export interface EventState {
  version: 3;
  eventId: string;
  clubName: string;
  eventName: string;
  fieldSize: number;
  names: string[];
  goalCents: number;
  goalShow: boolean;
  raceDurationMs: number;
  raceType: string;
  raceNumber: number;
  cashLedger: Donation[];
  history: RaceHistoryEntry[];
  bets: Bet[];
  chipBank: Record<string, number>;
  theme: 'day' | 'night';
  calm: boolean;
  sound: boolean;
  bettingOpen: boolean;
  startedAt: number;
}

/** Wire shape returned by GET /api/donations. */
export interface DonationsResponse {
  ok: boolean;
  configured: boolean;
  donations: Donation[];
  /** Server clock in ms, so the stage can detect a stalled poll. */
  at: number;
  error?: string;
}

/** URL-token payload that the donor phone page decodes. */
export interface LineupToken {
  v: 1;
  e: string;
  r: number;
  c: string;
  n: string[];
}
