import type { RaceResult } from '@/lib/types';

/**
 * Timing-tower wording for the circuits. Pure, so the gap the room reads is
 * the gap the tests pin.
 */

/** Whole laps a runner is behind the leader, on a race of `laps` laps. */
export function lapsDown(leaderP: number, runnerP: number, laps: number): number {
  if (laps < 2) return 0;
  return Math.max(0, Math.floor((leaderP - runnerP) * laps + 1e-9));
}

export function lapsDownText(down: number): string {
  return down <= 0 ? '' : `+${down} ${down === 1 ? 'LAP' : 'LAPS'}`;
}

/**
 * The gap after the line: the winner's time, then each runner's margin
 * behind the winner. A runner still out on the course when the winner
 * crossed is quoted from where it stood, at the winner's own pace, or in
 * laps when it had been lapped. Never "classified".
 */
export function finalGapText(result: RaceResult, winner: RaceResult | undefined, laps: number): string {
  if (result.status === 'retired') return 'RET';
  const winnerMs = winner?.finishMs ?? null;
  if (result.finishMs != null) {
    if (!winner || result.lane === winner.lane || winnerMs == null) return `${(result.finishMs / 1000).toFixed(1)}s`;
    return `+${Math.max(0, (result.finishMs - winnerMs) / 1000).toFixed(1)}s`;
  }
  const at = result.progressAtStop;
  if (at == null) return '';
  const down = lapsDown(1, at, laps);
  if (down > 0) return lapsDownText(down);
  if (winnerMs == null) return '';
  return `+${Math.max(0.1, (1 - at) * (winnerMs / 1000)).toFixed(1)}s`;
}

/**
 * The snail number a lane wears on screen: the race's own list when it has
 * one (a run-off of snails 3, 17, 26 ...), else the card's run of numbers.
 */
export function snailNumber(lane: number, numberOffset = 0, numbers?: readonly number[] | null): number {
  const listed = numbers?.[lane];
  return typeof listed === 'number' && Number.isFinite(listed) ? listed : numberOffset + lane + 1;
}

/** "1ST", "2ND", "11TH": the tag on a snail's shell after the line. */
export function placeTag(place: number): string {
  const tens = place % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'TH' : place % 10 === 1 ? 'ST' : place % 10 === 2 ? 'ND' : place % 10 === 3 ? 'RD' : 'TH';
  return `${place}${suffix}`;
}

const TRAILING_LINK = /\s+(?:the|of|and|de|von|van|la|le|a)$/i;

/**
 * The name a compact tower row can hold on one line: whole words up to
 * `max` characters, never ending on a joining word ("Speedy Gonzales the
 * Third of Geelong West" reads "Speedy Gonzales").
 */
export function towerName(name: string, max = 18): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  const words = trimmed.split(/\s+/);
  let out = words[0];
  for (const word of words.slice(1)) {
    if (`${out} ${word}`.length > max) break;
    out = `${out} ${word}`;
  }
  while (TRAILING_LINK.test(out)) out = out.replace(TRAILING_LINK, '');
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** How long the field has to spread before place badges and gaps go up, in ms. */
export const SPREAD_MS = 3000;

/**
 * Whether the field has spread enough for place badges and gaps to mean
 * anything: about three seconds into the race, or sooner once the leader is
 * clear of the second runner by `minGap` (in whatever unit `gap` is quoted
 * in). At the off every runner is on the line and a 1ST badge on a pile
 * tells the room nothing.
 */
export function fieldSpread(raceTimeMs: number, gap: number, minGap: number): boolean {
  if (raceTimeMs >= SPREAD_MS) return true;
  /* Never while the gate's fan is still easing out, or the badges could disagree with the picture. */
  return raceTimeMs >= GATE_FAN_MS && gap >= minGap;
}

/** How long the gate's fan takes to ease out once they are off, in ms. */
export const GATE_FAN_MS = 2000;

/** The seconds in a tower gap such as "+0.4s"; 0 for a leader, a time or RET. */
export function gapSeconds(gapText: string): number {
  const m = /^\+(\d+(?:\.\d+)?)s$/.exec(gapText);
  return m ? Number(m[1]) : 0;
}

/**
 * How far behind the line a lane is drawn at the gate, in course units: the
 * field fans back across the lanes in a shallow diagonal instead of standing
 * in one vertical pile. The stagger eases out over the first `fadeMs` of
 * running, slower than the runners move, so nobody is ever drawn going
 * backwards.
 */
export function gateStagger(lane: number, raceTimeMs: number, perLane = 14, fadeMs = GATE_FAN_MS): number {
  const left = raceTimeMs <= 0 ? 1 : Math.max(0, 1 - raceTimeMs / fadeMs);
  return lane * perLane * left;
}
