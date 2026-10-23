import { courseForRace, designForRace, designNameOf, enabledTrackDesigns, type CourseId, type TrackDesignId } from './courses';
import { DEFAULT_RACE_TYPE, MAX_SNAILS_PER_RACE, MIN_SNAILS_PER_RACE, raceTitle, raceTypeLabel, snailsForRace, type RunSheetRace } from './card';
import { raceMetres } from '../components/sidescroller-geometry';
import type { CameraMode, EventState, RaceHistoryEntry, SurpriseIntensity } from './types';

/**
 * What one race on the run sheet actually runs: its own settings where the
 * run sheet row has them, the night's otherwise. Stage arms a race from this,
 * and the desk, the racecard and Admin describe it from the same place, so
 * the room is never told one track and shown another.
 */
export interface RaceSettings {
  raceNo: number;
  design: TrackDesignId;
  trackShape: 'lanes' | 'circuit';
  /** The course id the plan carries. The straight keeps the rotation's course id so its hash is unchanged. */
  courseId: CourseId;
  designName: string;
  /** Lap length on a circuit; the whole race on the straight. */
  lapMs: number;
  laps: number;
  durationMs: number;
  /** The snails' pace, as a multiple of the standard. */
  snailSpeed: number;
  /** How long the straight is at that pace, in metres (the straight only; a circuit's laps are its length). */
  metres: number;
  intensity: SurpriseIntensity;
  /** The camera the race starts on, or null to keep whatever the desk has. */
  camera: CameraMode | null;
  raceType: string;
  /** "Race 3", or "Final 3" when the race is not a league race. */
  title: string;
  /** "Final", or empty for a league race. */
  typeLabel: string;
  runOff: boolean;
  snails: number[];
}

/** Short names for the surprise levels, for the racecard and the desk. */
export const SURPRISE_LEVEL_NAMES: Record<SurpriseIntensity, string> = {
  calm: 'Calm',
  standard: 'Standard',
  big: 'Big',
  chaos: 'Chaos',
  mayhem: 'Mayhem',
};

type NightSettings = Pick<EventState, 'card' | 'trackDesigns' | 'trackShape' | 'raceDurationMs' | 'laps' | 'intensity' | 'raceType'> & Partial<Pick<EventState, 'snailSpeed'>>;

/** True when the night has a circuit switched on, so the night length is a lap length. */
export const nightHasCircuit = (event: Pick<EventState, 'trackDesigns' | 'trackShape'>): boolean =>
  enabledTrackDesigns(event.trackDesigns, event.trackShape).some((id) => id !== 'straight');

/** The night's lap length (or race length on a straight-only night) and laps. */
export function nightLength(event: Pick<EventState, 'trackDesigns' | 'trackShape' | 'raceDurationMs' | 'laps'>): { lapMs: number; laps: number } {
  const laps = nightHasCircuit(event) ? Math.max(1, event.laps) : 1;
  return { lapMs: Math.round(event.raceDurationMs / laps), laps };
}

/** The night's default race type (a night saved before the league had "Heat" forced on it; the store migrates that). */
export const nightRaceType = (event: Pick<EventState, 'raceType'>): string =>
  event.raceType?.trim() ? event.raceType : DEFAULT_RACE_TYPE;

export function raceSettings(event: NightSettings, raceNo: number): RaceSettings {
  const row: RunSheetRace | undefined = event.card.races?.[raceNo - 1];
  const rotation = designForRace(event.trackDesigns, event.trackShape, raceNo);
  const placed = row?.design
    ? row.design === 'straight'
      ? { trackShape: 'lanes' as const, courseId: courseForRace(raceNo).id }
      : { trackShape: 'circuit' as const, courseId: row.design }
    : rotation;
  const design: TrackDesignId = placed.trackShape === 'lanes' ? 'straight' : placed.courseId;
  const night = nightLength(event);
  let lapMs: number;
  let laps: number;
  let durationMs: number;
  if (placed.trackShape === 'circuit') {
    laps = row?.laps ?? night.laps;
    lapMs = row?.lengthMs ?? night.lapMs;
    /* No override keeps the night's stored duration exactly, as every race did before the run sheet. */
    durationMs = row?.laps === undefined && row?.lengthMs === undefined && nightHasCircuit(event) ? event.raceDurationMs : lapMs * laps;
    /* The snail speed keeps the race its length and puts more (or fewer) laps in it: faster snails go further, never for longer. */
    const speed = event.snailSpeed ?? 1;
    if (speed !== 1) {
      const quicker = Math.max(1, Math.min(30, Math.round(laps * speed)));
      if (quicker !== laps) {
        laps = quicker;
        lapMs = Math.round(durationMs / laps);
      }
    }
  } else {
    laps = 1;
    durationMs = row?.lengthMs ?? event.raceDurationMs;
    lapMs = durationMs;
  }
  const raceType = row?.raceType ?? nightRaceType(event);
  return {
    raceNo,
    design,
    trackShape: placed.trackShape,
    courseId: placed.courseId,
    designName: designNameOf(placed.trackShape, placed.courseId),
    lapMs,
    laps,
    durationMs,
    snailSpeed: event.snailSpeed ?? 1,
    metres: raceMetres(durationMs, event.snailSpeed ?? 1),
    intensity: row?.intensity ?? event.intensity,
    camera: row?.camera ?? null,
    raceType,
    title: raceTitle(raceType, raceNo),
    typeLabel: raceTypeLabel(raceType),
    runOff: Boolean(row?.field?.length),
    snails: snailsForRace(raceNo, event.card),
  };
}

/** "30 s", "1 min 30 s". */
export function seconds(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** "30 s" on the straight, "2 laps of 20 s" on a circuit. */
export const lengthPhrase = (s: Pick<RaceSettings, 'trackShape' | 'laps' | 'lapMs' | 'durationMs'>): string =>
  s.trackShape === 'circuit'
    ? `${s.laps} ${s.laps === 1 ? 'lap' : 'laps'} of ${seconds(s.lapMs)}`
    : seconds(s.durationMs);

/** One line for the desk and the racecard: "Side-on straight, 30 s, Standard surprises". */
export const raceSummary = (s: RaceSettings): string =>
  `${s.designName}, ${lengthPhrase(s)}, ${SURPRISE_LEVEL_NAMES[s.intensity]} surprises`;

/** The snail number that ran in a lane of a recorded race. */
export function snailOfLane(entry: Pick<RaceHistoryEntry, 'raceNo' | 'snails' | 'snailOffset'>, lane: number): number {
  return entry.snails?.[lane] ?? (entry.snailOffset ?? (entry.raceNo - 1) * 10) + lane + 1;
}

/** How a recorded race reads on the desk: what it actually ran on, from its own record. */
export function ranSummary(entry: RaceHistoryEntry): string {
  const name = entry.trackShape ? designNameOf(entry.trackShape, entry.courseId ?? entry.racePlan?.courseId) : 'Recorded race';
  const laps = entry.laps ?? 1;
  const length = entry.trackShape === 'circuit' ? lengthPhrase({ trackShape: 'circuit', laps, lapMs: entry.durationMs / laps, durationMs: entry.durationMs }) : seconds(entry.durationMs);
  return `${name}, ${length}${entry.intensity ? `, ${SURPRISE_LEVEL_NAMES[entry.intensity]} surprises` : ''}`;
}

/**
 * The field for a winners' run-off: tonight's winners, race by race. Fewer
 * than eight are topped up with the runners-up (then thirds) of each race in
 * turn; more than twelve keep the twelve who won in the best time for their
 * race length.
 */
export function championField(history: RaceHistoryEntry[]): number[] {
  const races = history.filter((h) => !h.void && h.results.length).slice().sort((a, b) => a.raceNo - b.raceNo);
  const placed = (place: number) =>
    races
      .map((h) => {
        const r = h.results.find((x) => x.place === place);
        return r ? { snail: snailOfLane(h, r.lane), pace: r.finishMs !== null && h.durationMs ? r.finishMs / h.durationMs : 9, raceNo: h.raceNo } : null;
      })
      .filter((x): x is { snail: number; pace: number; raceNo: number } => x !== null);
  const field: number[] = [];
  let winners = placed(1);
  if (winners.length > MAX_SNAILS_PER_RACE) {
    winners = winners.slice().sort((a, b) => a.pace - b.pace).slice(0, MAX_SNAILS_PER_RACE).sort((a, b) => a.raceNo - b.raceNo);
  }
  for (const w of winners) if (!field.includes(w.snail)) field.push(w.snail);
  for (let place = 2; place <= 3 && field.length < MIN_SNAILS_PER_RACE; place++) {
    for (const r of placed(place)) {
      if (field.length >= MIN_SNAILS_PER_RACE) break;
      if (!field.includes(r.snail)) field.push(r.snail);
    }
  }
  return field;
}
