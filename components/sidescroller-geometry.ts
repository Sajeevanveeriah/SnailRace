import type { LockedRaceEvent } from '@/lib/types';

/**
 * The side-on straight's world, in world units, and the rules that place
 * things in it. Pure functions only, so the layout promises (lanes never
 * overlap, the crowd never covers a lane, no distance post cuts a fence
 * sign, a prop lands on its own target's lane) are checked by unit tests
 * rather than by eye.
 */

/** The stalls are at START_X, the winning post at TRACK_LEN. */
export const TRACK_LEN = 9000;
/** Where every nose starts: the front of the stalls. */
export const START_X = 160;
/** The bottom of every shot: the front of the crowd. */
export const VIEW_H = 1350;
/** The marked lanes. Racecard order, lane 0 on top. */
export const TRACK_TOP = 540;
export const TRACK_BOTTOM = 1262;
/** Every frame shows from the top of the distance-post boards down to the crowd. */
export const REQUIRED_H = VIEW_H - 380;
/** Full field view draws the lanes deeper, so the track owns more of a very wide frame. */
export const FULL_VIEW_EXTRA = 760;
/** The straight is called in metres to go, like a race caller's distance posts. */
export const RACE_METRES = 10;

/* Snail art, unscaled: the front of the foot is the nose. */
export const ART_NOSE = 190;
export const ART_TAIL = 150;
/** Top of the shell above the foot line. */
export const ART_TOP = 166;
/** Bottom of the foot below the foot line. */
export const ART_FOOT = 8;
/** Where the middle of the shell sits above the foot line. */
export const ART_SHELL_Y = 82;

/** How much of its lane a snail stands in: the rest is a gap to the next lane. */
export const LANE_FILL = 0.92;

export interface LaneGeometry {
  /** Top of the lane band. */
  top: number;
  /** Lane band height. */
  pitch: number;
  /** Where the snail's foot sits. */
  y: number;
  /** One scale for every snail, so nobody looks closer or bigger. */
  scale: number;
}

/**
 * Equal lanes, equal snails, no perspective. Every snail stands inside its
 * own lane band, shell to foot, so no shell ever covers a neighbour's number,
 * whatever the field size.
 */
export function laneGeometry(lane: number, fieldSize: number, extra = 0): LaneGeometry {
  const n = Math.max(1, fieldSize);
  const pitch = (TRACK_BOTTOM + extra - TRACK_TOP) / n;
  const scale = Math.min(0.8, (pitch * LANE_FILL) / (ART_TOP + ART_FOOT));
  const top = TRACK_TOP + lane * pitch;
  const slack = (pitch - (ART_TOP + ART_FOOT) * scale) / 2;
  return { top, pitch, y: top + pitch - slack - ART_FOOT * scale, scale };
}

/** World x of a nose at race progress p (0 at the stalls, 1 on the line). */
export const worldX = (p: number): number => START_X + p * (TRACK_LEN - START_X);

/** The gap between two distance posts: the fence is laid out on the same grid. */
export const POST_SPACING = (TRACK_LEN - START_X) / RACE_METRES;

/** Distance posts, metres to go: one on every grid line between the stalls and the post. */
export const DISTANCE_POSTS: { metres: number; x: number }[] = Array.from({ length: RACE_METRES - 1 }, (_, i) => {
  const metres = RACE_METRES - 1 - i;
  return { metres, x: worldX(1 - metres / RACE_METRES) };
});

/** How wide a fence board is, leaving clear fence either side of every post. */
export const FENCE_SIGN_W = Math.round(POST_SPACING * 0.74);

/**
 * The fence boards, one in the middle of each gap between grid lines (the
 * stalls, the posts and the winning post), from well before the start to
 * well past the finish. No post, start line or winning post can cut one.
 */
export function fenceSlots(fromX: number, toX: number): { x: number; w: number }[] {
  const first = Math.floor((fromX - START_X) / POST_SPACING);
  const last = Math.ceil((toX - START_X) / POST_SPACING);
  const slots: { x: number; w: number }[] = [];
  for (let k = first; k < last; k++) {
    const mid = START_X + (k + 0.5) * POST_SPACING;
    slots.push({ x: mid - FENCE_SIGN_W / 2, w: FENCE_SIGN_W });
  }
  return slots;
}

/** Every grid line that carries a post: the stalls, the distance posts, the winning post. */
export const POST_LINES = [START_X, ...DISTANCE_POSTS.map((post) => post.x), TRACK_LEN];

/* The crowd on the front rail. Heads stand this far below the track at rest,
   and the bob lifts them by at most CROWD_BOB, so they never reach a lane. */
export const CROWD_BASE = VIEW_H + 46;
export const CROWD_MAX_FIGURE = 102;
export const CROWD_BOB = 24;
export const crowdTop = (): number => CROWD_BASE - CROWD_MAX_FIGURE - CROWD_BOB;

/* ── Twists ───────────────────────────────────────────────────────────── */

/** A twist that holds three or more runners at once covers the field. */
export const isFieldTwist = (event: Pick<LockedRaceEvent, 'targetLanes'>): boolean => event.targetLanes.length > 2;

/**
 * The lanes a twist's prop lands in: every runner it holds up, or when it
 * holds nobody up (a boost), every runner it reaches. The bat's batter and
 * the shell swap's lucky one are not hit, so they get no prop.
 */
export function propLanes(event: Pick<LockedRaceEvent, 'targetLanes' | 'clockDeltaMsByLane'>): number[] {
  const held = event.targetLanes.filter((lane) => (event.clockDeltaMsByLane[lane] ?? 0) < 0);
  return held.length ? held : [...event.targetLanes];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The runner a twist's caption is about, when the event data says so: an
 * explicit featured lane if the engine sends one, else the one target whose
 * name the caption uses (the longest name wins, so "Snail 1" never claims
 * "Snail 10"), else, for a hold over the whole field, the runner held for
 * the least time, which is the one that recovers first.
 */
export function featuredLane(
  event: Pick<LockedRaceEvent, 'targetLanes' | 'clockDeltaMsByLane' | 'commentaryText'> & { featuredLane?: number },
  names: readonly string[],
): number | null {
  if (typeof event.featuredLane === 'number' && event.targetLanes.includes(event.featuredLane)) return event.featuredLane;
  const text = event.commentaryText ?? '';
  const named = event.targetLanes
    .filter((lane) => names[lane] && new RegExp(`(^|[^\\w])${escapeRegExp(names[lane])}(?![\\w])`, 'i').test(text))
    .sort((a, b) => names[b].length - names[a].length);
  if (named.length) {
    const longest = names[named[0]].length;
    const tied = named.filter((lane) => names[lane].length === longest);
    if (tied.length === 1) return tied[0];
  }
  const deltas = event.targetLanes.map((lane) => event.clockDeltaMsByLane[lane] ?? 0);
  if (event.targetLanes.length > 2 && deltas.every((delta) => delta < 0)) {
    let best = event.targetLanes[0];
    for (const lane of event.targetLanes) {
      if ((event.clockDeltaMsByLane[lane] ?? 0) > (event.clockDeltaMsByLane[best] ?? 0)) best = lane;
    }
    return best;
  }
  return null;
}

/** The word on the twist card: what the room is being told. */
export function splashKicker(phase: 'warning' | 'effect', tone: 'good' | 'bad' | 'wild', consequence?: 'advance' | 'delay' | 'retire'): 'INCOMING' | 'OUT' | 'BOOST' | 'TWIST' {
  if (phase === 'warning') return 'INCOMING';
  if (consequence === 'retire') return 'OUT';
  return tone === 'good' ? 'BOOST' : 'TWIST';
}

/* ── The finish ───────────────────────────────────────────────────────── */

export interface RunInRunner {
  lane: number;
  /** Official place; runners come home in this order. */
  place: number;
  p: number;
  /** Progress per millisecond, the runner's own recent pace. */
  rate: number;
  retired?: boolean;
}

/** How far past the line a snail runs out before it stops. */
export const RUN_OUT = 0.04;

/**
 * One step of the run-in after the winner has crossed: the rest of the field
 * keeps coming at its own pace, but never passes a runner placed ahead of it
 * before that runner is home, so the picture can never contradict the result.
 */
export function runInStep(runners: RunInRunner[], dtMs: number): RunInRunner[] {
  const ordered = [...runners].sort((a, b) => a.place - b.place);
  const out = new Map<number, RunInRunner>();
  let ahead: RunInRunner | null = null;
  for (const runner of ordered) {
    if (runner.retired) {
      out.set(runner.lane, runner);
      continue;
    }
    let p = Math.min(1 + RUN_OUT, runner.p + Math.max(0, runner.rate) * dtMs);
    if (ahead && ahead.p < 1) p = Math.min(p, ahead.p - 0.002);
    p = Math.max(runner.p, p);
    const next = { ...runner, p };
    out.set(runner.lane, next);
    ahead = next;
  }
  return runners.map((runner) => out.get(runner.lane) ?? runner);
}
