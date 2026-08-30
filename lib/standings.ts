import type { RaceHistoryEntry } from './types';

/**
 * The night's championship.
 *
 * A single race is one in N and everybody knows it. A table that accumulates
 * across the night gives the room a second, slower story to follow, and it
 * gives the moderator a reason to run a final: the snail at the top of this
 * table has earned the Champion of Champions.
 *
 * Points are by finishing position, so a consistent second beats one lucky
 * win followed by a night at the back. Standings are derived from the race
 * history on every read rather than stored, which means undoing a race
 * corrects the table for free.
 */

/** Points for first, second and third. Everything else scores nothing. */
export const POINTS = [5, 3, 1] as const;

export interface Standing {
  name: string;
  points: number;
  races: number;
  wins: number;
  podiums: number;
  /** Best finishing position achieved, 1 being a win. */
  best: number;
}

export const pointsForPlace = (place: number): number => POINTS[place - 1] ?? 0;

/**
 * Build the table, best first.
 *
 * Keyed by snail name rather than lane: a lane is only an index and gets
 * reused by a different snail the moment the line-up changes, whereas a name
 * is what the room shouts and what the tote board shows.
 */
export function standingsFrom(history: RaceHistoryEntry[]): Standing[] {
  const table = new Map<string, Standing>();

  for (const race of history) {
    /* A voided race is a compensating entry, not a result. */
    if (race.void) continue;
    for (const result of race.results) {
      const name = result.name.trim();
      if (!name) continue;
      const row =
        table.get(name) ??
        { name, points: 0, races: 0, wins: 0, podiums: 0, best: Number.POSITIVE_INFINITY };

      row.races += 1;
      /* A retirement remains a race appearance, but a runner that was safely
         taken out of the race cannot score or improve championship form.
         Missing status is the legacy all-finisher format. */
      if (result.status !== 'retired') {
        row.points += pointsForPlace(result.place);
        if (result.place === 1) row.wins += 1;
        if (result.place <= 3) row.podiums += 1;
        if (result.place < row.best) row.best = result.place;
      }

      table.set(name, row);
    }
  }

  return [...table.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      a.best - b.best ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Whose name goes on this race.
 *
 * Sponsors are cycled in order rather than assigned, so a club can type the
 * list once at the start of the night and every sponsor gets an even share of
 * the races without anyone having to remember whose turn it is.
 */
export function sponsorFor(sponsors: string[], raceNo: number): string {
  const live = sponsors.map((s) => s.trim()).filter(Boolean);
  if (!live.length || raceNo < 1) return '';
  return live[(raceNo - 1) % live.length];
}
