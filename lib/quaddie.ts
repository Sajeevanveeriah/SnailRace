import { raceForSnail, validSnailNo } from './card';
import type { RaceHistoryEntry } from './types';

/**
 * The quaddie.
 *
 * Four nominated races on the card. One entry names a winner in each of the
 * four legs; an entry that picks all four shares the pool with every other
 * entry that did. The club keeps a stated share, dividends round down to ten
 * cents, and a pool nobody wins stays with the club and the screen says so.
 *
 * Like the cash tote this is a PERMIT-GATED product. It is off until the
 * operator records the club's permit or authority reference and attests to
 * it, and nothing here is readable by the race engine. Entries are recorded
 * at the desk; the money is taken at the table or through the club's own
 * Stripe link and reconciled separately.
 */

export interface QuaddieSettings {
  enabled: boolean;
  permitAcknowledgedAt: number | null;
  permitReference: string;
  /** The four race numbers, ascending. */
  legs: number[];
  /** One entry, in cents. */
  entryCents: number;
  /** Share of the pool the club keeps, 0 to 100. */
  retainedPercent: number;
}

export interface QuaddieEntry {
  id: string;
  /** Who holds the ticket, as shown on the board. */
  holder: string;
  /** Snail number picked per leg, in leg order. */
  picks: number[];
  createdAt: number;
  void?: boolean;
}

export const DEFAULT_QUADDIE: QuaddieSettings = {
  enabled: false,
  permitAcknowledgedAt: null,
  permitReference: '',
  legs: [3, 5, 7, 9],
  entryCents: 1000,
  retainedPercent: 20,
};

export const QUADDIE_LEGS = 4;

export const quaddieIsLive = (settings: QuaddieSettings): boolean =>
  settings.enabled &&
  settings.permitAcknowledgedAt !== null &&
  settings.permitReference.trim().length > 0 &&
  settings.legs.length === QUADDIE_LEGS;

export function normaliseQuaddie(value: unknown): QuaddieSettings {
  const base = { ...DEFAULT_QUADDIE, legs: DEFAULT_QUADDIE.legs.slice() };
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<QuaddieSettings>;
  const reference = typeof v.permitReference === 'string' ? v.permitReference.slice(0, 80) : '';
  const acknowledgedAt =
    typeof v.permitAcknowledgedAt === 'number' && Number.isFinite(v.permitAcknowledgedAt) && v.permitAcknowledgedAt > 0
      ? v.permitAcknowledgedAt
      : null;
  const legs = Array.isArray(v.legs)
    ? [...new Set(v.legs.filter((n): n is number => Number.isSafeInteger(n) && n >= 1 && n <= 12))].sort((a, b) => a - b)
    : base.legs;
  return {
    /* Never live from storage without its attestation. */
    enabled: v.enabled === true && acknowledgedAt !== null && reference.trim().length > 0,
    permitAcknowledgedAt: acknowledgedAt,
    permitReference: reference,
    legs: legs.length === QUADDIE_LEGS ? legs : base.legs,
    entryCents:
      Number.isSafeInteger(v.entryCents) && Number(v.entryCents) >= 100 && Number(v.entryCents) <= 100_000
        ? Number(v.entryCents)
        : base.entryCents,
    retainedPercent:
      Number.isFinite(v.retainedPercent) && Number(v.retainedPercent) >= 0 && Number(v.retainedPercent) <= 100
        ? Math.round(Number(v.retainedPercent))
        : base.retainedPercent,
  };
}

export const validQuaddieEntry = (value: unknown): value is QuaddieEntry => {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<QuaddieEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.holder === 'string' &&
    Array.isArray(e.picks) &&
    e.picks.length === QUADDIE_LEGS &&
    e.picks.every((n) => validSnailNo(n)) &&
    Number.isFinite(e.createdAt)
  );
};

/** A pick is valid only if the snail actually runs in that leg. */
export const picksMatchLegs = (picks: number[], legs: number[]): boolean =>
  picks.length === legs.length && picks.every((snail, i) => validSnailNo(snail) && raceForSnail(snail) === legs[i]);

/** Winning snail number for a race, from the standing result, or null. */
export function winnerSnailFor(history: RaceHistoryEntry[], raceNo: number): number | null {
  const entry = history.find((h) => h.raceNo === raceNo && !h.void);
  const winner = entry?.results.find((r) => r.place === 1);
  if (!entry || !winner) return null;
  return (raceNo - 1) * 10 + winner.lane + 1;
}

export interface QuaddieLegStatus {
  raceNo: number;
  index: number;
  winnerSnail: number | null;
  winnerName: string | null;
  /** Entries still alive after this leg. Null until the leg has run. */
  alive: number | null;
}

export interface QuaddieStatus {
  live: boolean;
  legs: QuaddieLegStatus[];
  entries: number;
  poolCents: number;
  retainedCents: number;
  returnedCents: number;
  /** How many legs have a standing result. */
  legsRun: number;
  /** Entries alive after the legs that have run. */
  alive: QuaddieEntry[];
  /** Entries that won all four legs, once every leg has run. */
  winners: QuaddieEntry[];
  complete: boolean;
  /** Payout per winning entry, rounded down to ten cents. */
  dividendCents: number;
  breakageCents: number;
  unwon: boolean;
}

export const roundDownTo10c = (cents: number): number => Math.floor(Math.max(0, cents) / 10) * 10;

export function quaddieStatus(
  settings: QuaddieSettings,
  entries: QuaddieEntry[],
  history: RaceHistoryEntry[],
): QuaddieStatus {
  const live = quaddieIsLive(settings);
  const standing = entries.filter((e) => !e.void && picksMatchLegs(e.picks, settings.legs));
  const poolCents = standing.length * settings.entryCents;
  const retainedCents = Math.round((poolCents * settings.retainedPercent) / 100);
  const returnedCents = poolCents - retainedCents;

  let alive = standing;
  let legsRun = 0;
  const legs: QuaddieLegStatus[] = settings.legs.map((raceNo, index) => {
    const winnerSnail = winnerSnailFor(history, raceNo);
    const entry = history.find((h) => h.raceNo === raceNo && !h.void);
    const winnerName = entry?.results.find((r) => r.place === 1)?.name ?? null;
    if (winnerSnail === null || legsRun < index) {
      return { raceNo, index, winnerSnail: null, winnerName: null, alive: null };
    }
    legsRun += 1;
    alive = alive.filter((e) => e.picks[index] === winnerSnail);
    return { raceNo, index, winnerSnail, winnerName, alive: alive.length };
  });

  const complete = legsRun === settings.legs.length;
  const winners = complete ? alive : [];
  const dividendCents = complete && winners.length ? roundDownTo10c(returnedCents / winners.length) : 0;
  const breakageCents = complete && winners.length ? returnedCents - dividendCents * winners.length : 0;
  return {
    live,
    legs,
    entries: standing.length,
    poolCents,
    retainedCents,
    returnedCents,
    legsRun,
    alive,
    winners,
    complete,
    dividendCents,
    breakageCents,
    unwon: complete && winners.length === 0,
  };
}

/** Entries close the moment the first leg is armed or run. */
export const quaddieOpen = (settings: QuaddieSettings, history: RaceHistoryEntry[], racing: boolean, nextRaceNo: number): boolean =>
  quaddieIsLive(settings) &&
  winnerSnailFor(history, settings.legs[0]) === null &&
  !(racing && nextRaceNo === settings.legs[0]);
