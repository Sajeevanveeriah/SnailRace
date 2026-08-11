/**
 * Race engine.
 *
 * HOW THE RACE IS DECIDED - read this before anyone asks you on the night.
 *
 * The finishing order is drawn by a seeded shuffle the instant Start is
 * pressed, before a single snail moves. The seed is printed on screen. The
 * animation that follows is decorative: it cannot change the result, and the
 * draw never reads the donations or the bets.
 *
 * Fairness, in four lines:
 *   1. The finishing order is one Fisher-Yates shuffle of the lane indices,
 *      seeded by `seed` and nothing else.
 *   2. Each snail i is given a finish time T[i]; T is a strictly increasing
 *      relabelling of the shuffled order.
 *   3. Position is p(t) = base(u) + A*sin(pi*u)*noise, u = t/T[i]. The
 *      envelope sin(pi*u) is exactly 0 at u=1, so p(T[i]) = 1 exactly, and a
 *      ceiling clamp keeps p < 1 for every u < 1. No snail can arrive early
 *      or late no matter what the noise does.
 *   4. Therefore arrival order == shuffle order, and every lane wins with
 *      probability exactly 1/N.
 *
 * This module is deliberately free of DOM and React so the same code can be
 * unit-checked, replayed from a seed, and driven by the animation loop.
 */

/** mulberry32: small, fast, fully deterministic from a 32-bit seed. */
export function mulberry32(a: number): () => number {
  let s = a;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedToHex = (seed: number): string =>
  (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');

export function hexToSeed(hex: string): number | null {
  const v = parseInt(String(hex).trim().replace(/^0x/i, ''), 16);
  return Number.isFinite(v) ? v >>> 0 : null;
}

/**
 * Fisher-Yates over lane indices. order[0] is the winner, order[1] second and
 * so on. Its only inputs are the seed and the size of the field - the
 * donation ledger and the bet book are not in scope here and are never read.
 */
export function drawOrder(seed: number, n: number): { order: number[]; rnd: () => number } {
  const rnd = mulberry32(seed);
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let j = n - 1; j > 0; j--) {
    const k = Math.floor(rnd() * (j + 1));
    const tmp = order[j];
    order[j] = order[k];
    order[k] = tmp;
  }
  return { order, rnd };
}

export interface SnailRun {
  lane: number;
  name: string;
  /** Finish time in race-milliseconds. */
  T: number;
  /** Wobble amplitude. */
  A: number;
  w1: number;
  w2: number;
  ph1: number;
  ph2: number;
  /** Live position, 0 at the gate, 1 at the line. */
  p: number;
  prevP: number;
  /** Position units per millisecond, used for the effort cue. */
  rate: number;
  done: boolean;
  place: number;
  finishMs: number;
}

export interface DrawnRace {
  seed: number;
  seedHex: string;
  snails: SnailRun[];
  order: number[];
  photoFinish: boolean;
  /** Hard stop for the animation loop. */
  tMax: number;
}

export function drawRace(
  seed: number,
  names: string[],
  durationMs: number,
): DrawnRace {
  const n = names.length;
  const { order, rnd } = drawOrder(seed, n);

  const photoFinish = rnd() < 0.25; // one race in four is a genuine squeaker

  /*
   * Finish times are strictly increasing along the drawn order - both
   * candidates in the min() strictly exceed the previous time, so no two
   * snails can ever share a T. A flat cap here once produced ties at the
   * tail of the field, and a tie let frame order decide places instead of
   * the draw.
   */
  const T = new Array<number>(n);
  T[order[0]] = durationMs;
  for (let j = 1; j < n; j++) {
    const gap = j === 1 && photoFinish ? 60 + rnd() * 90 : 180 + rnd() * 520;
    T[order[j]] = Math.min(T[order[j - 1]] + gap, durationMs + 2400 + j * 90);
  }

  const snails: SnailRun[] = [];
  for (let i = 0; i < n; i++) {
    snails.push({
      lane: i,
      name: names[i],
      T: T[i],
      A: 0.055 + rnd() * 0.045,
      w1: 0.6 + rnd() * 0.8,
      w2: 1.3 + rnd() * 1.0,
      ph1: rnd() * Math.PI * 2,
      ph2: rnd() * Math.PI * 2,
      p: 0,
      prevP: 0,
      rate: 0,
      done: false,
      place: 0,
      finishMs: 0,
    });
  }

  /*
   * Authored drama. Which snail gets which role is decided purely by the
   * shuffle above, so this adds theatre without touching the odds.
   */
  snails[order[0]].ph1 = Math.PI; // winner starts sluggish, comes home
  snails[order[0]].A = 0.1;
  snails[order[n - 1]].ph1 = 0; // back marker bolts early, burns out
  snails[order[n - 1]].A = 0.1;

  return {
    seed,
    seedHex: seedToHex(seed),
    snails,
    order,
    photoFinish,
    tMax: Math.max(...T) + 1500,
  };
}

/**
 * Advance every snail to race-time `raceT`.
 *
 * `dt` is only used for the rate estimate that drives the "surging" cue, so a
 * dropped frame changes the sparkle and never the geometry: position is a
 * pure function of raceT.
 *
 * Returns the lanes that crossed the line on this step, in finishing order.
 */
export function stepRace(snails: SnailRun[], raceT: number, dt: number, placed: number): SnailRun[] {
  const crossed: SnailRun[] = [];

  for (const s of snails) {
    if (s.done) continue;

    const u = Math.min(raceT / s.T, 1);
    const base = u * u * (3 - 2 * u); // smoothstep
    const env = Math.sin(Math.PI * u); // exactly 0 at both ends
    const tSec = raceT / 1000;
    const noise =
      0.62 * Math.sin(s.w1 * tSec + s.ph1) + 0.38 * Math.sin(s.w2 * tSec + s.ph2);

    let p = base + s.A * env * noise;
    const ceil = base + (1 - base) * 0.9; // never close more than 90% of the gap
    if (p > ceil) p = ceil;
    if (p < 0) p = 0;
    if (p < s.p) p = s.p; // monotone: no reversing

    s.rate = (p - s.prevP) / (dt || 16);
    s.prevP = p;
    s.p = p;

    if (u >= 1) {
      s.p = 1;
      s.done = true;
      crossed.push(s);
    }
  }

  /*
   * Two snails can cross during the same animation frame. Places are dealt
   * by finish time, not by lane iteration order, so the announced result is
   * identical to the drawn order even when a frame swallows two arrivals.
   */
  crossed.sort((a, b) => a.T - b.T);
  let nextPlace = placed;
  for (const s of crossed) {
    s.place = ++nextPlace;
    s.finishMs = Math.round(raceT);
  }

  return crossed;
}

/**
 * Two orderings, deliberately. `byPosition` drives the drama cues; `ranked`
 * drives what the crowd reads. Once a snail is home its place is settled -
 * ranking it by p would put every finisher on 1.0 and shuffle the chips into
 * an order that contradicts the announced result.
 */
export function rankSnails(snails: SnailRun[]): { byPosition: SnailRun[]; ranked: SnailRun[] } {
  const byPosition = snails.slice().sort((a, b) => b.p - a.p);
  const ranked = snails.slice().sort((a, b) => {
    if (a.done && b.done) return a.place - b.place;
    if (a.done) return -1;
    if (b.done) return 1;
    return b.p - a.p;
  });
  return { byPosition, ranked };
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Replay a past race from its printed seed. Used by the verification panel. */
export function verifyDraw(seedHex: string, fieldSize: number): number[] | null {
  const seed = hexToSeed(seedHex);
  if (seed === null) return null;
  return drawOrder(seed, fieldSize).order;
}

/** A fresh seed for a new race. Time and entropy, never the ledger. */
export function freshSeed(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    return (Date.now() ^ buf[0]) >>> 0;
  }
  return (Date.now() ^ (Math.random() * 4294967296)) >>> 0;
}

export const COMMENTARY = {
  early: [
    '{a} out of the gate first!',
    "They're away - {a} shows early pace.",
    '{a} leads them out.',
    '{a} slimes into an early lead!',
  ],
  mid: [
    '{a} hits the front!',
    '{b} is reeling in {a}!',
    'Nothing between {a} and {b}!',
    '{a} kicks clear!',
    '{b} finds another gear!',
    '{a} under pressure from {b}!',
  ],
  late: [
    '{a} into the final straight!',
    '{b} is closing fast!',
    'This is going to be tight!',
    '{a} holding on!',
    '{b} charging home!',
  ],
} as const;

/** Pick a line for the current phase of the race, with the names filled in. */
export function callLine(leadP: number, leadName: string, chaserName: string): string {
  const phase = leadP < 0.3 ? 'early' : leadP < 0.72 ? 'mid' : 'late';
  const pool = COMMENTARY[phase];
  const line = pool[Math.floor(Math.random() * pool.length)];
  return line.replace('{a}', leadName).replace('{b}', chaserName);
}
