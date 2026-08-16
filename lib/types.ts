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
  /** Race number this donation is attached to. 0 for direct donations. */
  raceNo: number;
  /** Lane index, 0-based. -1 for direct QR donations backing no snail. */
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

/**
 * A surprise that landed during a race: a turbo boost, a shell slip, a nap.
 *
 * Theatre only. Every one of these is drawn from the race seed after the
 * finishing order has already been settled, so the highlight reel explains
 * what the room saw without any of it having changed who won.
 */
export interface RaceHighlight {
  /** Race-time the surprise landed, in milliseconds. */
  atMs: number;
  lane: number;
  name: string;
  kind: string;
  label: string;
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
  /** Who put their name to this race. Empty when nobody sponsored it. */
  sponsor?: string;
  /*
   * Snapshots taken before the race settled, so the console can undo it
   * exactly. Reversing the arithmetic instead would have to re-derive a
   * streak that was already overwritten, and a wrong reversal is worse than
   * no undo when a club is reconciling chips in front of the room.
   */
  chipBankBefore?: Record<string, number>;
  streaksBefore?: Record<string, number>;
  /** Surprises that landed, oldest first. Absent on nights from an older build. */
  highlights?: RaceHighlight[];
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
  /** Which renderer the stage uses: straight lanes, or laps of a circuit. */
  trackShape: 'lanes' | 'circuit';
  /** Which circuit, when trackShape is 'circuit'. */
  courseId: string;
  /** Laps of the circuit. Total race time is lap length times laps. */
  laps: number;
  /** Let the camera director cut between shots, or hold the whole course. */
  chaseCam: boolean;
  /** Whether in-race surprises are dealt. Never affects the finishing order. */
  surprises: boolean;
  raceType: string;
  raceNumber: number;
  /** Sponsors, used in order and cycled. One line per race on the stage. */
  sponsors: string[];
  cashLedger: Donation[];
  history: RaceHistoryEntry[];
  bets: Bet[];
  chipBank: Record<string, number>;
  /** Consecutive winning races per punter, keyed the same way as chipBank. */
  streaks: Record<string, number>;
  /** Which lighting the track runs under. Information design never changes. */
  stageTheme: 'midnight' | 'turf' | 'dusk';
  calm: boolean;
  sound: boolean;
  /** Music and crowd ambience. Independent of `sound`, which gates everything. */
  music: boolean;
  /** The spoken race caller. Independent of `music`, gated by `sound`. */
  caller: boolean;
  /**
   * Bumped when the shipped mix changes, so a saved night picks up new levels
   * instead of keeping a mix that was too quiet to hear in a function room.
   */
  audioRev: number;
  /** Master level, 0 to 1. */
  volume: number;
  /** Music bus level, 0 to 1. Sits under the effects by default. */
  musicVolume: number;
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
