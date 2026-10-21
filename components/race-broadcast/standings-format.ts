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
