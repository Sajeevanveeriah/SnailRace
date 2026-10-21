import { STORY_CARD_MS, STORY_GAP_MS, STORY_READ_MS, type RaceMoment } from '@/lib/use-race';

/** The least a hit card stays up before the next warning may replace it. */
const HIT_READ_MS = Math.max(STORY_READ_MS, 1200);
import type { LockedRaceEvent } from '@/lib/types';

/**
 * Which twist card is on air, derived from the locked plan on every frame.
 *
 * Every twist gets two cards: an INCOMING warning from its warning time to
 * its hit, then the hit card (TWIST, BOOST or OUT) for a read, then clear.
 * Only one story is on air at once: a warning waits for the card before it
 * to park, and a hit is never shown late.
 */

export type TwistPhase = 'warning' | 'effect';

export interface StagedTwist {
  key: string;
  eventId: string;
  phase: TwistPhase;
  label: string;
  kind: string;
  tone: 'good' | 'bad' | 'wild';
  targetLanes: number[];
  /** Signed clock shift per affected lane, when the engine knows it. */
  deltaByLane: Record<number, number>;
  consequence: 'advance' | 'delay' | 'retire';
  commentaryText: string;
  /** Race time of the hit, so a renderer can ease its prop into place. */
  effectAtMs: number;
}

export interface StoryWindow {
  event: LockedRaceEvent;
  /** When the INCOMING card may go up: never inside the previous story. */
  onAirMs: number;
  /** When this story has finished owning the screen. */
  offAirMs: number;
}

export function storyWindows(events: readonly LockedRaceEvent[]): StoryWindow[] {
  const sorted = [...events].sort((a, b) => a.effectAtMs - b.effectAtMs || a.id.localeCompare(b.id));
  const windows: StoryWindow[] = [];
  for (const event of sorted) {
    const previous = windows[windows.length - 1];
    /* The warning goes up at its own time, or once the hit before has had
       its readable beat, whichever is later; never after its own hit. */
    let onAirMs = event.warningAtMs;
    if (previous) {
      const hitUp = Math.max(previous.onAirMs, previous.event.effectAtMs);
      onAirMs = Math.max(onAirMs, hitUp + HIT_READ_MS + STORY_GAP_MS);
      /* The card before parks to make room: its full stay when the plan
         leaves room, a readable beat when it does not. */
      previous.offAirMs = Math.min(previous.offAirMs, Math.max(hitUp + HIT_READ_MS, onAirMs - STORY_GAP_MS));
    }
    onAirMs = Math.min(onAirMs, event.effectAtMs);
    const offAirMs = Math.max(event.effectAtMs, onAirMs) + STORY_CARD_MS;
    windows.push({ event, onAirMs, offAirMs });
  }
  return windows;
}

const consequenceOf = (value: string | undefined): StagedTwist['consequence'] =>
  value === 'retire' ? 'retire' : value === 'advance' ? 'advance' : 'delay';

/** The twist on air at race time `t`, or null between stories. */
export function stagedAt(windows: readonly StoryWindow[], t: number): StagedTwist | null {
  let best: StoryWindow | null = null;
  for (const w of windows) {
    if (t < w.onAirMs || t >= w.offAirMs) continue;
    if (!best || w.event.effectAtMs > best.event.effectAtMs) best = w;
  }
  if (!best) return null;
  const { event } = best;
  const phase: TwistPhase = t < event.effectAtMs ? 'warning' : 'effect';
  return {
    key: `${event.id}:${phase}`,
    eventId: event.id,
    phase,
    label: event.label,
    kind: event.kind,
    tone: event.tone,
    targetLanes: event.targetLanes,
    deltaByLane: event.clockDeltaMsByLane,
    consequence: consequenceOf(event.consequence),
    commentaryText: event.commentaryText,
    effectAtMs: event.effectAtMs,
  };
}

/** Older unlocked races only have the live moment; stage that instead. */
export function stagedFromMoment(moment: RaceMoment | null, fallbackLane: number, t: number): StagedTwist | null {
  if (!moment || !moment.phase) return null;
  const phase: TwistPhase = moment.phase === 'warning' || moment.phase === 'reveal' ? 'warning' : 'effect';
  const tone = moment.tone === 'good' ? 'good' : moment.tone === 'bad' ? 'bad' : 'wild';
  const targets = moment.targetLanes?.length ? moment.targetLanes : [fallbackLane];
  return {
    key: `moment-${moment.eventId ?? moment.id}:${phase}`,
    eventId: moment.eventId ?? `moment-${moment.id}`,
    phase,
    label: moment.label ?? moment.text,
    kind: moment.kind ?? '',
    tone,
    targetLanes: targets,
    deltaByLane: moment.deltaMs ? { [targets[0]]: moment.deltaMs } : {},
    consequence: consequenceOf(moment.consequence ?? (tone === 'good' ? 'advance' : 'delay')),
    commentaryText: moment.text,
    effectAtMs: phase === 'effect' ? t : t + 1000,
  };
}

/** The card's kicker: the same four words the side-on straight uses. */
export function twistKicker(twist: Pick<StagedTwist, 'phase' | 'consequence' | 'tone'>): 'INCOMING' | 'OUT' | 'BOOST' | 'TWIST' {
  if (twist.phase === 'warning') return 'INCOMING';
  if (twist.consequence === 'retire') return 'OUT';
  if (twist.tone === 'good' || twist.consequence === 'advance') return 'BOOST';
  return 'TWIST';
}

/**
 * The snails that wear this card's consequence: the boosted ones on a BOOST,
 * the held or knocked-out ones on a TWIST or OUT. A card that names a pair
 * (the deposed leader and the chaser it lifts) features only the side the
 * card is about.
 */
export function featuredLanes(twist: Pick<StagedTwist, 'targetLanes' | 'deltaByLane' | 'consequence'>): number[] {
  const sign = twist.consequence === 'advance' ? 1 : -1;
  const matching = twist.targetLanes.filter((lane) => sign * (twist.deltaByLane[lane] ?? 0) > 0);
  return matching.length ? matching : twist.targetLanes.slice();
}

/** The snail the prop lands in front of: the first that wears the consequence. */
export function featuredLane(twist: Pick<StagedTwist, 'targetLanes' | 'deltaByLane' | 'consequence'>, fallback: number): number {
  return featuredLanes(twist)[0] ?? fallback;
}
