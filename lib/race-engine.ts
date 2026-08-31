/**
 * Race engine.
 *
 * HOW A RACE IS DECIDED - read this before anyone asks you on the night.
 *
 * There are two deliberately versioned paths in this file:
 *
 * - `drawRace` is the legacy all-finisher engine. Its seeded shuffle fixes the
 *   complete order and its surprises are decorative position envelopes.
 * - `drawLockedRacePlan` is the consequential live-field engine. It draws
 *   the runners, every four-beat surprise, every persistent clock consequence
 *   and the complete first-finisher classification before countdown. Its
 *   surprises can change who wins, but runtime animation cannot change the
 *   pre-drawn plan. The first active runner across ends the race; trailing
 *   runners are classified at that instant and safe retirements rank last.
 *
 * Both paths are seeded and replayable, and neither reads donations or bets.
 *
 * Legacy `drawRace` fairness, in four lines:
 *   1. The finishing order is one Fisher-Yates shuffle of the lane indices,
 *      seeded by `seed` and nothing else.
 *   2. Each snail i is given a finish time T[i]; T is a strictly increasing
 *      relabelling of the shuffled order.
 *   3. Position is p(t) = base(u) + sin(pi*u)*A*noise + soft(u)*events(u),
 *      u = t/T[i]. Both drama terms carry an envelope that is exactly 0 at
 *      u=1, so p(T[i]) = 1 exactly, and a ceiling clamp keeps p < 1 for every
 *      u < 1. No snail can arrive early or late no matter what the wobble or
 *      the surprises do.
 *   4. Therefore arrival order == shuffle order, and every lane wins with
 *      probability exactly 1/N.
 *
 * The turbo boosts, shell slips and naps added to the legacy engine by
 * `drawEvents` are drawn from the same seeded stream AFTER its shuffle has
 * already been taken. The locked engine instead turns seeded events into
 * bounded persistent clock shifts and stores their result and audience cues
 * in the plan that the audit module can hash before the gates open.
 *
 * This module is deliberately free of DOM and React so the same code can be
 * unit-checked, replayed from a seed, and driven by the animation loop.
 */

import type {
  LockedRaceCue,
  LockedRaceEvent,
  LockedRacePlan,
  LockedRaceRunner,
  RaceResult,
} from './types';
import type { CourseId } from './courses';
import { MAX_FIELD, MIN_LIVE_FIELD } from './palette';

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

/* ── In-race surprises ─────────────────────────────────────────────────── */

/**
 * What a surprise IS, mechanically: a shove forward or a hold-up. The kind is
 * what the stage dresses the lane with and what the sound is chosen from; the
 * label and the call are what the room gets.
 */
export type RaceEventKind =
  | 'boost'
  | 'surge'
  | 'stumble'
  | 'nap'
  | 'wander'
  | 'chaos'
  | 'swoop'
  | 'plague'
  | 'retire';

/**
 * `wild` is neither good nor bad: the magnitude is drawn either side of zero,
 * so nobody - including the caller - knows which way it went until it lands.
 * It is the tone that keeps a room watching a snail nothing has happened to.
 */
export type EventTone = 'good' | 'bad' | 'wild';

/** Which noise the stage makes. Mapped to a synth voice in `sound.ts`. */
export type EventSound =
  | 'up'
  | 'down'
  | 'nap'
  | 'wander'
  | 'weird'
  | 'swoop'
  | 'plague'
  | 'siren';

/**
 * One kind of surprise, and the range it is drawn from.
 *
 * `mag` is a displacement in progress units at the peak of the event: positive
 * lunges the snail forward, negative holds it up. `from`/`to` bound where in
 * the lane the event may start, which is what stops a nap being drawn two
 * metres from the line where the crowd would read it as a bug. `weight` is
 * rarity - the whole point of a plague is that most races do not have one.
 */
export interface EventSpec {
  kind: RaceEventKind;
  /** Shown on the track as the event lands. */
  label: string;
  /** Commentary lines; {a} is the snail it happened to. One is drawn. */
  calls: string[];
  tone: EventTone;
  sound: EventSound;
  /** Relative frequency. Higher is commoner. */
  weight: number;
  magFrom: number;
  magTo: number;
  spanFrom: number;
  spanTo: number;
  from: number;
  to: number;
}

/**
 * The book of surprises.
 *
 * Twenty-two of them, because five was not enough: a room that has seen
 * LETTUCE BREAK four times in a race has stopped being surprised, and a room
 * that has stopped being surprised has stopped betting. They are weighted so
 * the ordinary ones carry the race and the strange ones are worth waiting
 * for, and the club's own sport is in there because a cricket club laughs
 * hardest at itself.
 *
 * In the legacy engine these are visual envelopes and cannot move a finishing
 * position. In the locked eight-runner engine the same authored set pieces
 * become bounded, persistent clock effects drawn into the pre-race plan, so
 * they can change the winner without runtime randomness.
 */
export const EVENT_SPECS: EventSpec[] = [
  /* ── Good ─────────────────────────────────────────────────────────── */
  {
    kind: 'boost', label: 'TURBO SLIME', tone: 'good', sound: 'up', weight: 10,
    calls: [
      '{a} hits the turbo slime and LUNGES!',
      '{a} has found the quick stuff and gone whoosh!',
      'Turbo slime for {a} and it is away!',
    ],
    magFrom: 0.055, magTo: 0.095, spanFrom: 0.1, spanTo: 0.18, from: 0.1, to: 0.62,
  },
  {
    kind: 'surge', label: 'SECOND WIND', tone: 'good', sound: 'up', weight: 9,
    calls: [
      '{a} finds a second wind and is flying home!',
      'Where has {a} found THAT? Second wind!',
      '{a} has come back to life!',
    ],
    magFrom: 0.07, magTo: 0.125, spanFrom: 0.12, spanTo: 0.22, from: 0.5, to: 0.86,
  },
  {
    kind: 'boost', label: 'SLIPSTREAM', tone: 'good', sound: 'up', weight: 8,
    calls: [
      '{a} tucks in behind and gets a tow!',
      '{a} is sitting in the slipstream and being carried along!',
    ],
    magFrom: 0.04, magTo: 0.075, spanFrom: 0.12, spanTo: 0.2, from: 0.15, to: 0.7,
  },
  {
    kind: 'boost', label: 'DOWNHILL RUN', tone: 'good', sound: 'up', weight: 7,
    calls: [
      '{a} has found a bit of downhill and is gathering pace!',
      'Gravity is on the side of {a} here!',
    ],
    magFrom: 0.045, magTo: 0.08, spanFrom: 0.1, spanTo: 0.18, from: 0.12, to: 0.72,
  },
  {
    kind: 'boost', label: 'TRIPLE ESPRESSO', tone: 'good', sound: 'up', weight: 4,
    calls: [
      'Somebody has given {a} a coffee and it is ELECTRIC!',
      '{a} has had a triple shot and is bouncing off the walls!',
    ],
    magFrom: 0.09, magTo: 0.145, spanFrom: 0.06, spanTo: 0.11, from: 0.14, to: 0.74,
  },
  {
    kind: 'surge', label: 'CROWD LIFT', tone: 'good', sound: 'up', weight: 6,
    calls: [
      'The members bar is chanting for {a} and it has responded!',
      'Listen to that! The room has picked {a} up and carried it!',
    ],
    magFrom: 0.05, magTo: 0.09, spanFrom: 0.12, spanTo: 0.2, from: 0.35, to: 0.8,
  },
  {
    kind: 'boost', label: 'FRESH WAX', tone: 'good', sound: 'up', weight: 5,
    calls: [
      'Somebody has waxed the shell of {a} and it is gliding!',
      '{a} is polished up and slipping through the field!',
    ],
    magFrom: 0.04, magTo: 0.07, spanFrom: 0.1, spanTo: 0.17, from: 0.1, to: 0.68,
  },

  /* ── Bad ──────────────────────────────────────────────────────────── */
  {
    kind: 'stumble', label: 'SHELL SLIP', tone: 'bad', sound: 'down', weight: 10,
    calls: [
      '{a} slips on the shell and loses ground!',
      'Oh! {a} has gone sideways there!',
      '{a} cannot get any grip at all!',
    ],
    magFrom: -0.085, magTo: -0.045, spanFrom: 0.08, spanTo: 0.14, from: 0.14, to: 0.8,
  },
  {
    kind: 'nap', label: 'MICRO-NAP', tone: 'bad', sound: 'nap', weight: 8,
    calls: [
      '{a} has stopped for a nap. You would not read about it!',
      '{a} is ASLEEP. Somebody wake it up!',
      'And {a} has decided this is a good spot for a lie down.',
    ],
    magFrom: -0.135, magTo: -0.085, spanFrom: 0.14, spanTo: 0.24, from: 0.18, to: 0.7,
  },
  {
    kind: 'wander', label: 'LETTUCE BREAK', tone: 'bad', sound: 'wander', weight: 8,
    calls: [
      '{a} has spotted a lettuce leaf and wandered wide!',
      'Lunch! {a} has pulled over for a feed!',
      '{a} is more interested in the salad than the race!',
    ],
    magFrom: -0.075, magTo: -0.04, spanFrom: 0.1, spanTo: 0.18, from: 0.16, to: 0.75,
  },
  {
    kind: 'stumble', label: 'GRAVEL PATCH', tone: 'bad', sound: 'down', weight: 7,
    calls: [
      '{a} is into the gravel and it is heavy going!',
      'That is coarse stuff and {a} does not like it one bit!',
    ],
    magFrom: -0.07, magTo: -0.04, spanFrom: 0.1, spanTo: 0.16, from: 0.12, to: 0.78,
  },
  {
    kind: 'nap', label: 'CRAMP', tone: 'bad', sound: 'down', weight: 6,
    calls: [
      '{a} has grabbed at the foot! Cramp!',
      '{a} has pulled up sore!',
    ],
    magFrom: -0.1, magTo: -0.06, spanFrom: 0.1, spanTo: 0.18, from: 0.25, to: 0.76,
  },
  {
    kind: 'wander', label: 'WRONG WAY', tone: 'bad', sound: 'wander', weight: 5,
    calls: [
      '{a} has turned around! Wrong way!',
      'Somebody point {a} at the finish line!',
    ],
    magFrom: -0.11, magTo: -0.07, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.7,
  },
  {
    kind: 'wander', label: 'SNAIL MAIL', tone: 'bad', sound: 'wander', weight: 5,
    calls: [
      '{a} has stopped to check the mail. Snail mail, of course.',
      '{a} is having a chat at the fence!',
    ],
    magFrom: -0.08, magTo: -0.045, spanFrom: 0.12, spanTo: 0.2, from: 0.18, to: 0.72,
  },
  {
    kind: 'nap', label: 'STAGE FRIGHT', tone: 'bad', sound: 'down', weight: 4,
    calls: [
      '{a} has seen the crowd and frozen solid!',
      'Stage fright! {a} has gone right into its shell!',
    ],
    magFrom: -0.115, magTo: -0.07, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.68,
  },
  {
    kind: 'stumble', label: 'BOGGED', tone: 'bad', sound: 'down', weight: 5,
    calls: [
      '{a} is bogged in a soft patch!',
      '{a} has found the one wet spot on the whole track!',
    ],
    magFrom: -0.09, magTo: -0.05, spanFrom: 0.1, spanTo: 0.18, from: 0.15, to: 0.78,
  },

  /* ── Wild: nobody knows which way this one goes ───────────────────── */
  {
    kind: 'chaos', label: 'MYSTERY SLIME', tone: 'wild', sound: 'weird', weight: 7,
    calls: [
      '{a} is into the mystery slime and ANYTHING could happen!',
      'Nobody knows what is in that puddle, and {a} has gone straight through it!',
    ],
    magFrom: -0.11, magTo: 0.11, spanFrom: 0.08, spanTo: 0.16, from: 0.14, to: 0.78,
  },
  {
    kind: 'chaos', label: 'BANANA PEEL', tone: 'wild', sound: 'weird', weight: 5,
    calls: [
      'There is a banana peel on the track and {a} has hit it!',
      '{a} is on the banana and it is out of control!',
    ],
    magFrom: -0.1, magTo: 0.09, spanFrom: 0.06, spanTo: 0.12, from: 0.16, to: 0.76,
  },
  {
    kind: 'chaos', label: 'SNAIL ROMANCE', tone: 'wild', sound: 'weird', weight: 4,
    calls: [
      '{a} has stopped to chat up a passing garden snail!',
      'Love is in the air and {a} has completely forgotten the race!',
    ],
    magFrom: -0.1, magTo: 0.06, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.72,
  },
  {
    kind: 'chaos', label: 'THIRD UMPIRE', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      'They have sent {a} upstairs to the third umpire!',
      'The umpire has his arm out for {a}. This will take a minute.',
    ],
    magFrom: -0.09, magTo: 0.08, spanFrom: 0.08, spanTo: 0.15, from: 0.2, to: 0.74,
  },
  {
    kind: 'chaos', label: 'SLEDGED FROM SLIPS', tone: 'wild', sound: 'weird', weight: 4,
    calls: [
      'Something has been said to {a} from the slips cordon!',
      '{a} has copped an earful and it has fired right up!',
    ],
    magFrom: -0.07, magTo: 0.1, spanFrom: 0.08, spanTo: 0.15, from: 0.22, to: 0.78,
  },
  {
    kind: 'chaos', label: 'SHELL SWAP', tone: 'wild', sound: 'weird', weight: 3,
    calls: [
      '{a} has swapped shells with somebody and it fits terribly!',
      'That is not the shell {a} started in!',
    ],
    magFrom: -0.1, magTo: 0.1, spanFrom: 0.1, spanTo: 0.18, from: 0.24, to: 0.74,
  },
];

/**
 * A surprise that hits several lanes at once.
 *
 * Individual surprises make a race eventful; a field event makes it a story
 * the room tells afterwards. Mechanically it is nothing new - one ordinary
 * event per affected lane, sharing a start, a label and a group id - so the
 * fairness argument does not move an inch. What it buys is one loud call
 * instead of six small ones, and the sight of half the field stopping at the
 * same moment.
 */
export interface SwarmSpec {
  kind: RaceEventKind;
  label: string;
  /** The one call for the whole thing. No {a}: it is bigger than one snail. */
  calls: string[];
  tone: EventTone;
  sound: EventSound;
  weight: number;
  /** How much of the field it takes, as a fraction. */
  shareFrom: number;
  shareTo: number;
  magFrom: number;
  magTo: number;
  spanFrom: number;
  spanTo: number;
  from: number;
  to: number;
}

export const SWARM_SPECS: SwarmSpec[] = [
  {
    kind: 'plague', label: 'THE PLAGUE', tone: 'bad', sound: 'plague', weight: 6,
    calls: [
      'A SHELL PLAGUE is sweeping through the field! They are dropping everywhere!',
      'PLAGUE! Half this field has gone down with it!',
    ],
    shareFrom: 0.4, shareTo: 0.7,
    magFrom: -0.1, magTo: -0.05, spanFrom: 0.12, spanTo: 0.2, from: 0.2, to: 0.68,
  },
  {
    kind: 'swoop', label: 'MAGPIE SWOOP', tone: 'bad', sound: 'swoop', weight: 8,
    calls: [
      'SWOOP! A magpie has come straight through the middle of them!',
      'Look out! The magpie is back and it has scattered the field!',
    ],
    shareFrom: 0.2, shareTo: 0.45,
    magFrom: -0.09, magTo: -0.04, spanFrom: 0.06, spanTo: 0.12, from: 0.15, to: 0.78,
  },
  {
    kind: 'chaos', label: 'SPRINKLERS ON', tone: 'wild', sound: 'siren', weight: 6,
    calls: [
      'The sprinklers have come on! Nobody told the groundsman there was a race!',
      'SPRINKLERS! The whole back straight is under water!',
    ],
    shareFrom: 0.4, shareTo: 0.8,
    magFrom: -0.08, magTo: 0.08, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.72,
  },
  {
    kind: 'chaos', label: 'ROGUE CRICKET BALL', tone: 'wild', sound: 'weird', weight: 7,
    calls: [
      'A cricket ball has entered the field. It has no lane and no apology!',
      'Rogue cricket ball! The middle of the field is taking evasive action!',
    ],
    shareFrom: 0.25, shareTo: 0.5,
    magFrom: -0.075, magTo: 0.055, spanFrom: 0.07, spanTo: 0.13, from: 0.18, to: 0.72,
  },
  {
    kind: 'chaos', label: 'DOG ON THE TRACK', tone: 'wild', sound: 'swoop', weight: 6,
    calls: [
      'THE CLUB DOG IS ON THE TRACK! Absolute carnage!',
      'Somebody grab that dog! It is running the wrong way through the field!',
    ],
    shareFrom: 0.3, shareTo: 0.6,
    magFrom: -0.1, magTo: 0.07, spanFrom: 0.08, spanTo: 0.15, from: 0.2, to: 0.74,
  },
  {
    kind: 'boost', label: 'LETTUCE ON THE TRACK', tone: 'good', sound: 'up', weight: 5,
    calls: [
      'Somebody has thrown a lettuce on the track and this field has ACCELERATED!',
      'Lettuce! The whole field has picked up the pace!',
    ],
    shareFrom: 0.4, shareTo: 0.8,
    magFrom: 0.04, magTo: 0.085, spanFrom: 0.1, spanTo: 0.18, from: 0.15, to: 0.7,
  },
  {
    kind: 'plague', label: 'FALSE START PANIC', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      'Somebody has fired the gun again and half of them have stopped dead!',
      'They think the race has been called back! Chaos in the middle!',
    ],
    shareFrom: 0.3, shareTo: 0.6,
    magFrom: -0.09, magTo: 0.04, spanFrom: 0.07, spanTo: 0.13, from: 0.16, to: 0.6,
  },
  {
    kind: 'plague', label: 'PITCH ROLLER CROSSING', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      'The pitch roller is crossing the track. Slowly, but with total commitment!',
      'Pitch roller on the course! It has right of way and knows it!',
    ],
    shareFrom: 0.25, shareTo: 0.55,
    magFrom: -0.095, magTo: 0.035, spanFrom: 0.1, spanTo: 0.17, from: 0.22, to: 0.72,
  },
];

/** Weighted draw from a table, using the race's own stream. */
function pickWeighted<T extends { weight: number }>(rnd: () => number, table: T[]): T {
  let total = 0;
  for (const t of table) total += t.weight;
  let roll = rnd() * total;
  for (const t of table) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return table[table.length - 1];
}

export interface RaceEvent {
  /** Stable within one race, so React can key on it. */
  id: string;
  lane: number;
  kind: RaceEventKind;
  label: string;
  call: string;
  tone: EventTone;
  sound: EventSound;
  /** Progress along the lane at which it starts, 0 to 1. */
  at: number;
  /** How much of the lane it covers. */
  span: number;
  /** Peak displacement in progress units. Signed. */
  mag: number;
  fired: boolean;
  /**
   * Set on every lane caught by the same field event. The stage announces a
   * group once rather than shouting the same thing six times in a second.
   */
  group?: string;
  groupLabel?: string;
  groupCall?: string;
}

/**
 * How many surprises a race of this length carries.
 *
 * A rate with a hard ceiling. One authored beat about every 7.5 seconds gives
 * the caller and crowd time to react; the ceiling keeps long cards varied
 * without turning the broadcast into a notification feed.
 */
export function eventBudget(durationMs: number, fieldSize: number, factor = 1): number {
  /* One authored beat about every 7.5 seconds. The old 0.34-per-second rate
     made a long race feel like a notification feed: plenty happened, but
     nothing had time to land. This keeps a 60-second feature around eight
     individual moments before the occasional field event and finish beat. */
  const byLength = Math.round((durationMs / 7500) * factor);
  return Math.max(2, Math.min(14, byLength, Math.max(2, fieldSize * 2)));
}

/**
 * The Surprise Director's presets.
 *
 * A pure budget multiplier, deliberately: `standard` is exactly 1, so a v3
 * night replayed under v4 deals the identical surprises from the identical
 * stream, and the fairness argument never moves - a preset changes how MANY
 * envelopes are dealt, never what an envelope can do at the line.
 */
export const INTENSITY_FACTOR = {
  calm: 0.5,
  standard: 1,
  big: 1.35,
  chaos: 1.75,
} as const;

export type IntensityId = keyof typeof INTENSITY_FACTOR;

/**
 * Drama at the line.
 *
 * This is the one thing the old book could not do. Every surprise was bounded
 * well short of the finish, so a race that had been decided by two thirds
 * distance simply ran out - and the room, which is watching precisely because
 * it has picked a favourite, had nothing to watch for the last twenty seconds.
 *
 * So: better than half the time, the snail that is going to win gets a wobble
 * inside the last tenth and the one behind it gets a late charge. The leader
 * is visibly reeled in, the gap closes to nothing, the photo-finish camera
 * comes out - and then the winner comes home, because it was always going to.
 *
 * IT CANNOT CHANGE THE RESULT, and this is worth being precise about, because
 * it looks like it should. Position is monotone, so a held snail plateaus and
 * never goes backwards; the bump rides the same envelope as everything else,
 * which is exactly zero at u = 1; and the winner's own curve carries it to the
 * line at its drawn time regardless. What moves is how close the second one
 * gets before that happens. The finish is theatre; the finishing order was
 * settled by the shuffle before any of this was drawn.
 */
function drawFinishDrama(rnd: () => number, order: number[]): RaceEvent[] {
  /* Half the races. Every race would make a grandstand finish routine, which
     is the failure mode this exists to fix. */
  if (rnd() > 0.5) return [];

  const at = 0.855 + rnd() * 0.05;
  const span = 0.075 + rnd() * 0.045;
  const out: RaceEvent[] = [];

  const wobbles = [
    { label: 'LATE WOBBLE', call: '{a} has wobbled with the line in sight!' },
    { label: 'LEGS GONE', call: 'The legs have gone on {a}! This is not over!' },
    { label: 'SHELL WOBBLE', call: '{a} is rolling all over the track and the lead is going!' },
    { label: 'CAUGHT SHORT', call: '{a} has stopped to look at the crowd! What is it doing!' },
  ];
  const charges = [
    { label: 'LATE CHARGE', call: '{a} is FLYING at them! Look at this finish!' },
    { label: 'DESPERATE LUNGE', call: '{a} has thrown everything at it!' },
    { label: 'THE CHASE IS ON', call: '{a} is eating into it with every stride!' },
  ];

  const w = wobbles[Math.floor(rnd() * wobbles.length)];
  out.push({
    id: 'fin-lead',
    lane: order[0],
    kind: 'stumble',
    label: w.label,
    call: w.call,
    tone: 'bad',
    sound: 'down',
    at,
    span,
    mag: -(0.05 + rnd() * 0.055),
    fired: false,
  });

  const c = charges[Math.floor(rnd() * charges.length)];
  out.push({
    id: 'fin-chase',
    lane: order[1],
    kind: 'surge',
    label: c.label,
    call: c.call,
    tone: 'good',
    sound: 'up',
    at: at + 0.008,
    span,
    mag: 0.045 + rnd() * 0.055,
    fired: false,
  });

  /* A third one closing too, if the field is deep enough to notice. */
  if (order.length > 3 && rnd() < 0.5) {
    out.push({
      id: 'fin-third',
      lane: order[2],
      kind: 'surge',
      label: 'COMING FAST',
      call: '{a} is coming at them as well! Three in it!',
      tone: 'good',
      sound: 'up',
      at: at + 0.014,
      span,
      mag: 0.04 + rnd() * 0.045,
      fired: false,
    });
  }

  return out;
}

/**
 * How many field events a race carries.
 *
 * One every forty-five seconds or so, and never in a race too short to have
 * built up a field worth scattering. Rare enough that a plague is still an
 * event; common enough that a five-minute race gets a few.
 */
export function swarmBudget(durationMs: number, fieldSize: number, factor = 1): number {
  if (fieldSize < 4 || durationMs < 25_000) return 0;
  return Math.max(1, Math.min(8, Math.round((durationMs / 45_000) * factor)));
}

/**
 * Deal the surprises.
 *
 * Called only after the finishing order and the finish times have been taken
 * from `rnd`, so nothing here can move a snail's arrival - see the module
 * header. Two events on one lane are kept clear of each other, because
 * overlapping windows read on the projector as one long shapeless drift
 * rather than as two things happening.
 *
 * Field events are dealt first and get the pick of the track. An ordinary
 * surprise can be shuffled along to the next gap; a magpie coming through the
 * middle of the field cannot, because the whole point of it is that it lands
 * on six lanes at the same instant.
 */
export function drawEvents(
  rnd: () => number,
  fieldSize: number,
  durationMs: number,
  factor = 1,
): RaceEvent[] {
  const target = eventBudget(durationMs, fieldSize, factor);
  const events: RaceEvent[] = [];
  const perLane = new Map<number, RaceEvent[]>();

  const clashes = (lane: number, at: number, span: number): boolean => {
    const mine = perLane.get(lane);
    if (!mine) return false;
    return mine.some((e) => at < e.at + e.span + 0.06 && e.at < at + span + 0.06);
  };

  const add = (event: RaceEvent) => {
    events.push(event);
    const mine = perLane.get(event.lane) ?? [];
    mine.push(event);
    perLane.set(event.lane, mine);
  };

  /* ── Field events first ─────────────────────────────────────────── */

  const swarms = swarmBudget(durationMs, fieldSize, factor);
  for (let g = 0; g < swarms; g++) {
    const spec = pickWeighted(rnd, SWARM_SPECS);
    const span = spec.spanFrom + rnd() * (spec.spanTo - spec.spanFrom);
    const room = Math.max(0.01, spec.to - spec.from - span);
    const at = spec.from + rnd() * room;
    const call = spec.calls[Math.floor(rnd() * spec.calls.length)];

    const share = spec.shareFrom + rnd() * (spec.shareTo - spec.shareFrom);
    const wanted = Math.max(2, Math.min(fieldSize, Math.round(fieldSize * share)));

    /* A shuffled lane list, so the same lanes are not always the unlucky
       ones and the choice is still drawn from the race's own stream. */
    const lanes: number[] = [];
    for (let i = 0; i < fieldSize; i++) lanes.push(i);
    for (let j = fieldSize - 1; j > 0; j--) {
      const k = Math.floor(rnd() * (j + 1));
      const t = lanes[j];
      lanes[j] = lanes[k];
      lanes[k] = t;
    }

    const group = `sw${g}`;
    let taken = 0;
    for (const lane of lanes) {
      if (taken >= wanted) break;
      if (clashes(lane, at, span)) continue;
      taken += 1;
      add({
        id: `${group}-${lane}`,
        lane,
        kind: spec.kind,
        label: spec.label,
        call,
        tone: spec.tone,
        sound: spec.sound,
        /* Spread by a hair so the field does not move as one block: a magpie
           reaches the near lanes a moment before the far ones. */
        at: Math.min(0.94, at + rnd() * 0.015),
        span,
        mag: spec.magFrom + rnd() * (spec.magTo - spec.magFrom),
        fired: false,
        group,
        groupLabel: spec.label,
        groupCall: call,
      });
    }
  }

  /* ── Then the ordinary run of surprises ─────────────────────────── */

  /* Bounded: a crowded field can refuse placements, and the race still runs. */
  for (let guard = 0; guard < target * 14 && events.length < target; guard++) {
    const spec = pickWeighted(rnd, EVENT_SPECS);
    const lane = Math.floor(rnd() * fieldSize);
    const span = spec.spanFrom + rnd() * (spec.spanTo - spec.spanFrom);
    const room = Math.max(0.01, spec.to - spec.from - span);
    const at = spec.from + rnd() * room;

    if (clashes(lane, at, span)) continue;

    add({
      id: `fx${events.length}`,
      lane,
      kind: spec.kind,
      label: spec.label,
      call: spec.calls[Math.floor(rnd() * spec.calls.length)],
      tone: spec.tone,
      sound: spec.sound,
      at,
      span,
      mag: spec.magFrom + rnd() * (spec.magTo - spec.magFrom),
      fired: false,
    });
  }

  return events.sort((a, b) => a.at - b.at);
}

/**
 * Displacement contributed by `events` at progress `u`, plus whichever event
 * is currently loudest so the lane can be dressed to match.
 *
 * The half-sine window is 0 at both ends of the event, so a surprise always
 * hands the snail back to its own curve.
 */
export function eventBump(
  events: RaceEvent[],
  u: number,
): { bump: number; active: RaceEventKind | null; started: RaceEvent[] } {
  let bump = 0;
  let active: RaceEventKind | null = null;
  let loudest = 0;
  const started: RaceEvent[] = [];

  for (const e of events) {
    const d = u - e.at;
    if (d <= 0 || d >= e.span) continue;
    const w = e.mag * Math.sin((Math.PI * d) / e.span);
    bump += w;
    if (Math.abs(w) > loudest) {
      loudest = Math.abs(w);
      active = e.kind;
    }
    if (!e.fired) {
      e.fired = true;
      started.push(e);
    }
  }

  return { bump, active, started };
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
  /** Surprises drawn for this lane, in the order they will land. */
  events: RaceEvent[];
  /** Which surprise is currently dressing the lane, if any. */
  effect: RaceEventKind | null;
  /** New locked races use a persistent race clock rather than zero-sum bumps. */
  lockedMotion?: {
    baseFinishMs: number;
    events: LockedRaceEvent[];
  };
  retired?: boolean;
  retiredAtMs?: number;
  retiredP?: number;
  lockedPlace?: number;
}

/**
 * Conditions for the race.
 *
 * Weather is scenery and commentary only - it never touches a position, so it
 * needs no place in the fairness argument. It exists because a five-minute
 * race wants a variable the room can see from the first second, and "they are
 * running in a downpour tonight" is a condition every supporter understands.
 */
export type Weather = 'clear' | 'drizzle' | 'downpour';

export const WEATHER_CALL: Record<Weather, string> = {
  clear: 'Perfect conditions over the course tonight.',
  drizzle: 'A bit of drizzle about - the track is greasy out there.',
  downpour: 'They are racing in a downpour! Slime everywhere!',
};

export interface DrawnRace {
  seed: number;
  seedHex: string;
  snails: SnailRun[];
  order: number[];
  photoFinish: boolean;
  /** Every surprise in the race, all lanes, ordered by where it lands. */
  events: RaceEvent[];
  weather: Weather;
  durationMs: number;
  /** Hard stop for the animation loop. */
  tMax: number;
  /** Present only for the versioned consequential engine. */
  lockedPlan?: LockedRacePlan;
}

export function drawRace(
  seed: number,
  names: string[],
  durationMs: number,
  surprises = true,
  intensity: IntensityId = 'standard',
): DrawnRace {
  const n = names.length;
  const { order, rnd } = drawOrder(seed, n);
  const factor = INTENSITY_FACTOR[intensity] ?? 1;

  const photoFinish = rnd() < 0.25; // one race in four is a genuine squeaker

  /*
   * Finish times are strictly increasing along the drawn order - both
   * candidates in the min() strictly exceed the previous time, so no two
   * snails can ever share a T. A flat cap here once produced ties at the
   * tail of the field, and a tie let frame order decide places instead of
   * the draw.
   *
   * The gaps are a fraction of the race rather than a fixed number of
   * milliseconds: on a 45-second marathon a flat 300ms gap put the whole
   * field across the line in one indistinguishable clump.
   */
  const T = new Array<number>(n);
  T[order[0]] = durationMs;
  for (let j = 1; j < n; j++) {
    const gap =
      j === 1 && photoFinish
        ? durationMs * (0.006 + rnd() * 0.009)
        : durationMs * (0.018 + rnd() * 0.052);
    T[order[j]] = Math.min(T[order[j - 1]] + gap, durationMs * 1.24 + j * 90);
  }

  const events = surprises ? drawEvents(rnd, n, durationMs, factor) : [];
  if (surprises && n > 1) events.push(...drawFinishDrama(rnd, order));

  /* Drawn last, so adding it cannot shift the order or the surprises. */
  const roll = rnd();
  const weather: Weather = roll < 0.6 ? 'clear' : roll < 0.85 ? 'drizzle' : 'downpour';

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
      events: events.filter((e) => e.lane === i),
      effect: null,
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
    events,
    weather,
    durationMs,
    tMax: Math.max(...T) + 1500,
  };
}

/* ── Versioned consequential live-field engine ─────────────────────── */

/** Kept as the default and for old integrations that imported this symbol. */
export const LOCKED_RACE_FIELD_SIZE = 8;
export const MIN_LOCKED_RACE_FIELD_SIZE = MIN_LIVE_FIELD;
export const MAX_LOCKED_RACE_FIELD_SIZE = MAX_FIELD;
export const RETIREMENT_CHANCE_DENOMINATOR = 32;

export const validLockedRaceFieldSize = (size: number): boolean =>
  Number.isSafeInteger(size) &&
  size >= MIN_LOCKED_RACE_FIELD_SIZE &&
  size <= MAX_LOCKED_RACE_FIELD_SIZE;

/**
 * Club-safe retirement mechanisms. They echo familiar cricket-ground
 * mishaps without copying another race product's titles, scripts or art.
 * Every line says that the runner is safe and out of the race.
 */
export const RETIREMENT_SPECS = [
  {
    code: 'groundskeeper-boot-scare',
    label: 'GROUNDSKEEPER BOOT SCARE',
    reveal: '{a} has pulled into the safe lane as the groundskeeper\'s boot steps across.',
    commentary: '{a} is safely with the marshal after that boot scare, but their race is over.',
  },
  {
    code: 'boundary-bee-scare',
    label: 'BOUNDARY BEE SCARE',
    reveal: 'A boundary bee has startled {a}, and the marshal is moving in.',
    commentary: '{a} is safely off the course after that sting scare, but their race is over.',
  },
  {
    code: 'roller-obstruction',
    label: 'ROLLER OBSTRUCTION',
    reveal: 'The pitch roller has blocked {a}\'s lane. The marshal is there.',
    commentary: '{a} has been escorted safely around the roller obstruction, but their race is over.',
  },
  {
    code: 'loose-cricket-ball',
    label: 'LOOSE CRICKET BALL',
    reveal: 'A loose cricket ball has rolled into {a}\'s lane.',
    commentary: '{a} has pulled up safely while the ball is cleared, but their race is over.',
  },
  {
    code: 'sprinkler-stop',
    label: 'SPRINKLER STOP',
    reveal: 'The sprinklers have caught {a}, and the marshal has called them in.',
    commentary: '{a} is safe and drying off beside the course, but their race is over.',
  },
] as const;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const fillRunner = (line: string, name: string): string => line.replace(/\{a\}/g, name);

/** Persistent clock shift contributed by one locked event. */
function lockedShiftAt(event: LockedRaceEvent, lane: number, raceT: number): number {
  const delta = event.clockDeltaMsByLane[lane] ?? 0;
  if (delta === 0 || raceT <= event.effectAtMs) return 0;
  const elapsed = raceT - event.effectAtMs;
  if (delta < 0) {
    /* One millisecond of race clock is withheld per millisecond. The runner
       can stop, but the effective clock can never run backwards. */
    return -Math.min(-delta, elapsed);
  }
  const span = Math.max(1, event.effectEndMs - event.effectAtMs);
  const x = clamp(elapsed / span, 0, 1);
  const eased = x * x * (3 - 2 * x);
  return delta * eased;
}

function retirementFor(events: LockedRaceEvent[], lane: number): LockedRaceEvent | undefined {
  return events.find((event) => event.consequence === 'retire' && event.targetLanes.includes(lane));
}

function effectiveClockAt(
  runner: LockedRaceRunner,
  events: LockedRaceEvent[],
  raceT: number,
): number {
  const retirement = retirementFor(events, runner.lane);
  const t = retirement && raceT >= retirement.effectAtMs ? retirement.effectAtMs : raceT;
  let clock = t;
  for (const event of events) {
    if (!event.targetLanes.includes(runner.lane) || event.consequence === 'retire') continue;
    clock += lockedShiftAt(event, runner.lane, t);
  }
  return Math.max(0, clock);
}

function progressForLockedRunner(
  runner: LockedRaceRunner,
  events: LockedRaceEvent[],
  raceT: number,
): number {
  const u = clamp(effectiveClockAt(runner, events, raceT) / runner.baseFinishMs, 0, 1);
  return u * u * (3 - 2 * u);
}

/** Pure progress lookup used by generation, animation, replay and verification. */
export function lockedProgressAt(plan: LockedRacePlan, lane: number, raceT: number): number {
  const runner = plan.runners.find((candidate) => candidate.lane === lane);
  if (!runner) return 0;
  const progress = progressForLockedRunner(runner, plan.events, raceT);
  return lane === plan.winnerLane && raceT < plan.stopAtMs && progress >= 1
    ? 1 - Number.EPSILON
    : progress;
}

function lockedCrossingTime(runner: LockedRaceRunner, events: LockedRaceEvent[]): number | null {
  if (retirementFor(events, runner.lane)) return null;
  let low = 0;
  let high = Math.ceil(runner.baseFinishMs + 5000);
  while (effectiveClockAt(runner, events, high) < runner.baseFinishMs) high *= 2;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (effectiveClockAt(runner, events, mid) >= runner.baseFinishMs) high = mid;
    else low = mid + 1;
  }
  return low;
}

function consequenceFor(delta: number): LockedRaceEvent['consequence'] {
  return delta >= 0 ? 'advance' : 'delay';
}

/**
 * Draw the entire consequential race before countdown. The returned value is
 * plain immutable data: result, event wording and every cue are already fixed.
 */
export function drawLockedRacePlan(
  seed: number,
  names: string[],
  durationMs: number,
  surprises = true,
  intensity: IntensityId = 'standard',
  laps = 1,
  trackShape: 'lanes' | 'circuit' = 'circuit',
  courseId: CourseId = 'boundary-oval',
): LockedRacePlan {
  if (!validLockedRaceFieldSize(names.length)) {
    throw new RangeError(
      `The consequential race requires ${MIN_LOCKED_RACE_FIELD_SIZE} to ${MAX_LOCKED_RACE_FIELD_SIZE} runners.`,
    );
  }
  if (!Number.isFinite(durationMs) || durationMs < 1000) {
    throw new RangeError('Race duration must be at least 1000ms.');
  }

  /* Reuse the established seeded cast and surprise book as source material.
     The legacy result remains available for old histories; the plan below
     gives those surprises persistent consequences and draws a new result. */
  const source = drawRace(seed, names, durationMs, surprises, intensity);
  /* Keep the fourth beat before even the earliest mechanically possible
     finish (84% after the cumulative consequence cap). At normal show
     lengths this remains the familiar quarter-second commentary beat. */
  const commentaryDelayMs = Math.max(1, Math.min(250, Math.round(durationMs * 0.015)));
  const runners: LockedRaceRunner[] = source.snails.map((snail) => ({
    lane: snail.lane,
    name: snail.name,
    baseFinishMs: Math.round(snail.T),
    A: snail.A,
    w1: snail.w1,
    w2: snail.w2,
    ph1: snail.ph1,
    ph2: snail.ph2,
  }));

  const grouped = new Map<string, LockedRaceEvent>();
  for (const event of source.events) {
    if (event.id.startsWith('fin-')) continue;
    const effectAtMs = Math.round(event.at * durationMs);
    /* Leave enough course for the complete four-beat sequence and the
       consequence to be read before the first possible finish. */
    if (effectAtMs > durationMs * 0.72) continue;
    const key = event.group ?? event.id;
    const cap = Math.round(durationMs * 0.06);
    let delta = clamp(Math.round(event.mag * durationMs * 0.55), -cap, cap);
    const minimum = Math.max(50, Math.round(durationMs * 0.004));
    if (Math.abs(delta) < minimum) delta = (event.mag < 0 ? -1 : 1) * minimum;

    const hit = grouped.get(key);
    if (hit) {
      if (!hit.targetLanes.includes(event.lane)) hit.targetLanes.push(event.lane);
      hit.clockDeltaMsByLane[event.lane] = delta;
      hit.effectAtMs = Math.min(hit.effectAtMs, effectAtMs);
      hit.effectEndMs = Math.max(
        hit.effectEndMs,
        effectAtMs + Math.max(Math.round(event.span * durationMs), Math.abs(delta)),
      );
      continue;
    }

    grouped.set(key, {
      id: key,
      kind: event.kind,
      label: event.groupLabel ?? event.label,
      tone: event.tone,
      sound: event.sound,
      targetLanes: [event.lane],
      consequence: consequenceFor(delta),
      warningAtMs: Math.max(0, effectAtMs - 1400),
      revealAtMs: Math.max(1, effectAtMs - 700),
      effectAtMs,
      commentaryAtMs: effectAtMs + commentaryDelayMs,
      effectEndMs:
        effectAtMs + Math.max(Math.round(event.span * durationMs), Math.abs(delta), 350),
      clockDeltaMsByLane: { [event.lane]: delta },
      warningText: `${event.groupLabel ?? event.label} is approaching the course.`,
      revealText: '',
      commentaryText: event.groupCall ?? event.call,
    });
  }

  const events = [...grouped.values()].sort(
    (a, b) => a.effectAtMs - b.effectAtMs || a.id.localeCompare(b.id),
  );

  /* Bound the sum per lane. Intensity may deal more events, but it cannot turn
     one runner's clock into an implausible teleport or an endless stop. */
  const totals = new Array<number>(names.length).fill(0);
  const totalCap = Math.round(durationMs * 0.16);
  for (const event of events) {
    event.targetLanes.sort((a, b) => a - b);
    for (const lane of event.targetLanes) {
      const wanted = event.clockDeltaMsByLane[lane] ?? 0;
      const next = clamp(totals[lane] + wanted, -totalCap, totalCap);
      event.clockDeltaMsByLane[lane] = next - totals[lane];
      totals[lane] = next;
    }
    const firstDelta = event.clockDeltaMsByLane[event.targetLanes[0]] ?? 0;
    event.consequence = consequenceFor(firstDelta);
    const targetNames = event.targetLanes.map((lane) => names[lane]);
    event.revealText =
      targetNames.length === 1
        ? `${targetNames[0]}: ${event.label}`
        : `${event.label}: ${targetNames.join(', ')}`;
    event.commentaryText = fillRunner(event.commentaryText, targetNames[0]);
    event.revealAtMs = Math.max(event.warningAtMs + 1, event.revealAtMs);
  }

  /* Retirement is a race-level rarity, never multiplied by the intensity
     preset and never more than one runner. */
  const retirementRnd = mulberry32(seed ^ 0x52455431);
  if (surprises && retirementRnd() < 1 / RETIREMENT_CHANCE_DENOMINATOR) {
    const spec = RETIREMENT_SPECS[Math.floor(retirementRnd() * RETIREMENT_SPECS.length)];
    const lane = Math.floor(retirementRnd() * names.length);
    const effectAtMs = Math.round(durationMs * (0.38 + retirementRnd() * 0.2));
    const name = names[lane];
    events.push({
      id: 'ret-0',
      kind: 'retire',
      label: spec.label,
      tone: 'bad',
      sound: 'down',
      targetLanes: [lane],
      consequence: 'retire',
      warningAtMs: Math.max(0, effectAtMs - 1400),
      revealAtMs: Math.max(1, effectAtMs - 700),
      effectAtMs,
      commentaryAtMs: effectAtMs + commentaryDelayMs,
      effectEndMs: effectAtMs + 900,
      clockDeltaMsByLane: { [lane]: 0 },
      warningText: 'Course marshals are watching something near the boundary.',
      revealText: fillRunner(spec.reveal, name),
      commentaryText: fillRunner(spec.commentary, name),
      retirementCode: spec.code,
      retirementLabel: spec.label,
    });
    events.sort((a, b) => a.effectAtMs - b.effectAtMs || a.id.localeCompare(b.id));
  }

  const phaseOrder: Record<LockedRaceCue['phase'], number> = {
    warning: 0,
    reveal: 1,
    effect: 2,
    commentary: 3,
  };
  const cues: LockedRaceCue[] = events.flatMap((event) => [
    {
      id: `${event.id}-warning`, eventId: event.id, phase: 'warning' as const,
      atMs: event.warningAtMs, text: event.warningText, tone: 'wild' as const,
      sound: 'siren', big: event.targetLanes.length > 1,
    },
    {
      id: `${event.id}-reveal`, eventId: event.id, phase: 'reveal' as const,
      atMs: event.revealAtMs, text: event.revealText, lane: event.targetLanes[0],
      tone: event.tone, big: event.targetLanes.length > 1,
    },
    {
      id: `${event.id}-effect`, eventId: event.id, phase: 'effect' as const,
      atMs: event.effectAtMs, text: event.label, lane: event.targetLanes[0],
      tone: event.tone, sound: event.sound, big: event.targetLanes.length > 1,
    },
    {
      id: `${event.id}-commentary`, eventId: event.id, phase: 'commentary' as const,
      atMs: event.commentaryAtMs, text: event.commentaryText, lane: event.targetLanes[0],
      tone: event.tone, big: event.targetLanes.length > 1,
    },
  ]).sort(
    (a, b) =>
      a.atMs - b.atMs ||
      phaseOrder[a.phase] - phaseOrder[b.phase] ||
      a.eventId.localeCompare(b.eventId),
  );

  /* Make integer crossing times unique. A frame may contain more than one
     crossing, but the locked first crossing always belongs to one runner. */
  const priority = new Map(source.order.map((lane, index) => [lane, index]));
  let crossings = runners
    .map((runner) => ({ runner, at: lockedCrossingTime(runner, events) }))
    .filter((row): row is { runner: LockedRaceRunner; at: number } => row.at !== null)
    .sort((a, b) => a.at - b.at || (priority.get(a.runner.lane)! - priority.get(b.runner.lane)!));
  for (let i = 1; i < crossings.length; i++) {
    if (crossings[i].at > crossings[i - 1].at) continue;
    crossings[i].runner.baseFinishMs += crossings[i - 1].at - crossings[i].at + 1;
    crossings[i].at = lockedCrossingTime(crossings[i].runner, events)!;
  }
  crossings = crossings.sort(
    (a, b) => a.at - b.at || (priority.get(a.runner.lane)! - priority.get(b.runner.lane)!),
  );

  const winnerLane = crossings[0].runner.lane;
  const stopAtMs = crossings[0].at;
  const active = runners
    .filter((runner) => !retirementFor(events, runner.lane))
    .sort((a, b) => {
      if (a.lane === winnerLane) return -1;
      if (b.lane === winnerLane) return 1;
      const dp = progressForLockedRunner(b, events, stopAtMs) - progressForLockedRunner(a, events, stopAtMs);
      return dp || (priority.get(a.lane)! - priority.get(b.lane)!);
    });
  const retired = runners
    .filter((runner) => retirementFor(events, runner.lane))
    .sort((a, b) => a.lane - b.lane);
  const classified = [...active, ...retired];
  const results: RaceResult[] = classified.map((runner, index) => {
    const retirement = retirementFor(events, runner.lane);
    const progress = progressForLockedRunner(runner, events, stopAtMs);
    if (retirement) {
      return {
        lane: runner.lane,
        name: runner.name,
        place: index + 1,
        finishMs: null,
        status: 'retired',
        progressAtStop: Number(progress.toFixed(6)),
        retiredAtMs: retirement.effectAtMs,
        retirementCode: retirement.retirementCode,
        retirementLabel: retirement.retirementLabel,
      };
    }
    return {
      lane: runner.lane,
      name: runner.name,
      place: index + 1,
      finishMs: runner.lane === winnerLane ? stopAtMs : null,
      status: runner.lane === winnerLane ? 'finished' : 'classified',
      progressAtStop: Number(progress.toFixed(6)),
    };
  });

  const secondAt = crossings[1]?.at ?? Number.POSITIVE_INFINITY;
  return {
    schema: 1,
    engine: 'consequential-eight-v1',
    seed: seed >>> 0,
    seedHex: seedToHex(seed),
    names: names.slice(),
    durationMs: Math.round(durationMs),
    laps: Math.max(1, Math.round(laps)),
    surprises,
    intensity,
    trackShape,
    courseId,
    weather: source.weather,
    photoFinish: secondAt - stopAtMs <= durationMs * 0.015,
    runners,
    events,
    cues: cues.filter((cue) => cue.atMs < stopAtMs),
    results,
    winnerLane,
    stopAtMs,
  };
}

/** Build mutable animation state without mutating the stored locked plan. */
export function instantiateLockedRace(plan: LockedRacePlan): DrawnRace {
  if (plan.engine !== 'consequential-eight-v1' || !validLockedRaceFieldSize(plan.names.length)) {
    throw new RangeError('Unsupported locked race plan.');
  }
  const runtimeEvents: RaceEvent[] = plan.events.flatMap((event) =>
    event.targetLanes.map((lane) => ({
      id: `${event.id}-${lane}`,
      lane,
      kind: (event.consequence === 'retire' ? 'retire' : event.kind) as RaceEventKind,
      label: event.label,
      call: event.commentaryText,
      tone: event.tone,
      sound: event.sound as EventSound,
      at: event.effectAtMs / Math.max(1, plan.durationMs),
      span: (event.effectEndMs - event.effectAtMs) / Math.max(1, plan.durationMs),
      mag: (event.clockDeltaMsByLane[lane] ?? 0) / Math.max(1, plan.durationMs),
      fired: false,
      ...(event.targetLanes.length > 1
        ? {
            group: event.id,
            groupLabel: event.label,
            groupCall: event.commentaryText,
          }
        : {}),
    })),
  ).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const resultByLane = new Map(plan.results.map((result) => [result.lane, result]));
  const snails: SnailRun[] = plan.runners.map((runner) => {
    const result = resultByLane.get(runner.lane)!;
    return {
      lane: runner.lane,
      name: runner.name,
      T: result.finishMs ?? runner.baseFinishMs,
      A: runner.A,
      w1: runner.w1,
      w2: runner.w2,
      ph1: runner.ph1,
      ph2: runner.ph2,
      p: 0,
      prevP: 0,
      rate: 0,
      done: false,
      place: 0,
      finishMs: 0,
      events: runtimeEvents.filter((event) => event.lane === runner.lane),
      effect: null,
      lockedMotion: {
        baseFinishMs: runner.baseFinishMs,
        events: plan.events,
      },
      retired: false,
      lockedPlace: result.place,
    };
  });

  return {
    seed: plan.seed,
    seedHex: plan.seedHex,
    snails,
    order: plan.results.slice().sort((a, b) => a.place - b.place).map((result) => result.lane),
    photoFinish: plan.photoFinish,
    events: runtimeEvents,
    weather: plan.weather,
    durationMs: plan.durationMs,
    tMax: plan.stopAtMs,
    lockedPlan: plan,
  };
}

/**
 * Advance every snail to race-time `raceT`.
 *
 * `dt` is only used for the rate estimate that drives the "surging" cue, so a
 * dropped frame changes the sparkle and never the geometry: position is a
 * pure function of raceT.
 *
 * Returns the lanes that crossed the line on this step in finishing order,
 * and any surprises that started on this step so the stage can announce them.
 */
export function stepRace(
  snails: SnailRun[],
  raceT: number,
  dt: number,
  placed: number,
): { crossed: SnailRun[]; fired: { event: RaceEvent; snail: SnailRun }[] } {
  const crossed: SnailRun[] = [];
  const fired: { event: RaceEvent; snail: SnailRun }[] = [];

  for (const s of snails) {
    if (s.done) continue;

    if (s.lockedMotion) {
      const runner: LockedRaceRunner = {
        lane: s.lane,
        name: s.name,
        baseFinishMs: s.lockedMotion.baseFinishMs,
        A: s.A,
        w1: s.w1,
        w2: s.w2,
        ph1: s.ph1,
        ph2: s.ph2,
      };
      const retirement = retirementFor(s.lockedMotion.events, s.lane);
      let p = progressForLockedRunner(runner, s.lockedMotion.events, raceT);
      if (!retirement && raceT < s.T && p >= 1) p = 1 - Number.EPSILON;
      const activeEvent = s.lockedMotion.events.find(
        (event) =>
          event.targetLanes.includes(s.lane) &&
          raceT >= event.effectAtMs &&
          raceT < event.effectEndMs,
      );
      s.effect = activeEvent
        ? ((activeEvent.consequence === 'retire' ? 'retire' : activeEvent.kind) as RaceEventKind)
        : null;
      s.p = Math.max(s.p, p);
      s.rate = (s.p - s.prevP) / (dt || 16);
      s.prevP = s.p;

      if (retirement && raceT >= retirement.effectAtMs) {
        s.retired = true;
        s.retiredAtMs = retirement.effectAtMs;
        s.retiredP = s.p;
        s.done = true;
        s.effect = 'retire';
        s.place = s.lockedPlace ?? 0;
        continue;
      }

      /* Crossing times in the locked plan are integer race milliseconds.
         The easing can reach the mathematical line a fraction earlier, but
         the published stop frame - and therefore every trailing coordinate
         in the complete result - is authoritative. */
      if (
        raceT >= s.T &&
        effectiveClockAt(runner, s.lockedMotion.events, raceT) >= runner.baseFinishMs
      ) {
        s.p = 1;
        s.prevP = 1;
        s.done = true;
        s.effect = null;
        s.place = s.lockedPlace ?? 0;
        s.finishMs = Math.round(s.T);
        crossed.push(s);
      }
      continue;
    }

    const u = Math.min(raceT / s.T, 1);
    const base = u * u * (3 - 2 * u); // smoothstep
    const env = Math.sin(Math.PI * u); // exactly 0 at both ends
    const tSec = raceT / 1000;
    const noise =
      0.62 * Math.sin(s.w1 * tSec + s.ph1) + 0.38 * Math.sin(s.w2 * tSec + s.ph2);

    /*
     * Surprises ride a flatter envelope than the wobble. `env` itself has
     * already fallen to a third by the time a snail is nine tenths home,
     * which is exactly where a "second wind" needs to be legible; raising it
     * to a fractional power keeps the window near 1 for most of the lane
     * while still being exactly 0 at u=1, which is the only property the
     * fairness argument depends on.
     */
    const { bump, active, started } = s.events.length
      ? eventBump(s.events, u)
      : { bump: 0, active: null, started: [] as RaceEvent[] };
    s.effect = active;
    for (const e of started) fired.push({ event: e, snail: s });
    const envSoft = bump === 0 ? 0 : Math.pow(env, 0.35);

    let p = base + s.A * env * noise + envSoft * bump;
    const ceil = base + (1 - base) * 0.9; // never close more than 90% of the gap
    if (p > ceil) p = ceil;
    if (p < 0) p = 0;
    /*
     * Monotone: no reversing. A stumble therefore reads as the snail being
     * stuck rather than sliding backwards, which is both kinder to the
     * animation and the reason a negative bump can never cost a place.
     */
    if (p < s.p) p = s.p;

    s.rate = (p - s.prevP) / (dt || 16);
    s.prevP = p;
    s.p = p;

    if (u >= 1) {
      s.p = 1;
      s.done = true;
      s.effect = null;
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
    if (s.lockedMotion) {
      s.place = s.lockedPlace ?? ++nextPlace;
      s.finishMs = Math.round(s.T);
    } else {
      s.place = ++nextPlace;
      s.finishMs = Math.round(raceT);
    }
  }

  return { crossed, fired };
}

/**
 * Two orderings, deliberately. `byPosition` drives the drama cues; `ranked`
 * drives what the crowd reads. Once a snail is home its place is settled -
 * ranking it by p would put every finisher on 1.0 and shuffle the chips into
 * an order that contradicts the announced result.
 */
export function rankSnails(snails: SnailRun[]): { byPosition: SnailRun[]; ranked: SnailRun[] } {
  const byPosition = snails.slice().sort((a, b) => {
    if (a.retired && !b.retired) return 1;
    if (!a.retired && b.retired) return -1;
    return b.p - a.p || a.lane - b.lane;
  });
  const ranked = snails.slice().sort((a, b) => {
    if (a.retired && b.retired) return (a.lockedPlace ?? a.place) - (b.lockedPlace ?? b.place);
    if (a.retired) return 1;
    if (b.retired) return -1;
    if (a.done && b.done) return a.place - b.place;
    if (a.done) return -1;
    if (b.done) return 1;
    return b.p - a.p || a.lane - b.lane;
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
    '{a} has made the tidy start. {b} is keeping it honest.',
    '{a} leads them out, antennae down and businesslike.',
    '{a} has the rail. {b} is close enough to read the shell pattern.',
    'A clean getaway for {a}. Nobody panic, there is a long way to crawl.',
    '{a} sets the pace. {b} has declined to be impressed.',
  ],
  mid: [
    '{a} looks settled. That is usually when this event stops being sensible.',
    '{b} is closing on {a}, slowly in absolute terms and rapidly for a snail.',
    '{a} and {b} are making a proper race of it now.',
    '{a} holds the front. {b} is waiting for one bad patch of turf.',
    '{b} has found another gear. Nobody ask where it was hiding.',
    'Halfway home, and {a} has {b} for company.',
  ],
  late: [
    '{a} turns for home. {b} has not received the message.',
    '{b} is closing. This has become unnecessarily dramatic.',
    '{a} can see the line, which is more than we can say for the rest of them.',
    '{b} is throwing everything at it, including basic snail dignity.',
    '{a} needs every millimetre of that lead.',
    'The room is up. {a} and {b} are still arguing over it.',
  ],
} as const;

/**
 * Lines for a situation rather than a stage of the race.
 *
 * A caller that only knows how far in it is has nothing to say when the top
 * two are locked together or when the leader has gone eight lengths clear -
 * which is exactly when the room most wants to be told what it is looking at.
 * `{g}` is the real margin, in lengths, and `{c}` is whoever is third.
 */
export const MARGIN_LINES = [
  '{a} leads by {g} from {b}.',
  '{a} has {g} on {b}, with {c} holding third.',
  '{a} in front. {b} is {g} away and paying attention.',
  '{a} from {b} by {g}. That gap is not getting comfortable.',
] as const;

export const TIGHT_LINES = [
  'You could throw a blanket over {a} and {b}!',
  'Nothing in it! {a} and {b} are locked together!',
  '{a} and {b}, side by side, neither giving an inch!',
  '{g} in it between {a} and {b}!',
] as const;

export const CLEAR_LINES = [
  '{a} has broken the elastic! {g} clear!',
  '{a} is gone. {b} is running for second now.',
  'That is {g} {a} has put on the field.',
  '{b} will need a miracle to reel in {a} from {g} back.',
] as const;

export const BACK_MARKER_LINES = [
  '{d} is last and appears to be taking in the scenery.',
  '{d} is running a private event at the back. Good luck to it.',
  '{d} has work to do and no visible urgency about doing it.',
] as const;

/** Called when a snail actually changes places, anywhere in the field. */
export const OVERTAKE_LINES = [
  '{a} goes past {b} and into {n}!',
  '{a} is up to {n}, past {b}!',
  'Nice move by {a}, {b} has been passed for {n}!',
  '{a} takes {n} off {b}!',
] as const;

/** The last stretch, quoted in distance rather than in adjectives. */
export const RUN_HOME_LINES = [
  '{m} to run and it is {a} by {g}!',
  'Inside the last {m}! {a} from {b}!',
  '{m} left, {b} is {g} away and closing!',
] as const;

/**
 * What the caller says in the beat after a surprise, instead of going
 * straight back to the run of play. It is the difference between a caller
 * and a list of events.
 */
export const REACTION_LINES = {
  good: [
    'What a turn of speed!',
    'That has changed everything!',
    'The room has come alive!',
    'You do not see that every day!',
  ],
  bad: [
    'That is dreadful timing.',
    'A small disaster, beautifully executed.',
    'You have to feel for that snail.',
    'That has turned a promising crawl into paperwork.',
  ],
  wild: [
    'What on earth was that?',
    'Nobody has any idea what just happened!',
    'The stewards are going to have a look at that one.',
    'I have called a lot of these and I have never seen that.',
  ],
} as const;

/** Lap calls. A long race needs a rhythm, and laps are the natural one. */
export const LAP_LINES = [
  '{a} leads them across the line to start lap {n}!',
  'Lap {n} begins and it is {a} in front from {b}.',
  'Onto lap {n} - {a} by a whisker from {b}.',
  '{a} starts lap {n} with {b} all over the back of it.',
] as const;

export const BELL_LAP_LINES = [
  'THE BELL! Last lap, and {a} leads!',
  'Bell lap! {a} in front, {b} coming for it!',
  'One lap to run and {a} has it by a nose!',
] as const;

/** Called when the leader changes hands. The loudest line in the book. */
export const LEAD_CHANGE_LINES = [
  'LEAD CHANGE! {a} snatches it from {b}!',
  '{a} goes past {b}! What a move!',
  'A new leader - {a} takes it up!',
  '{a} sweeps around {b} and hits the front!',
] as const;

/** Quarter, half and three-quarter marks, so a long race keeps its shape. */
export const SECTOR_LINES: Record<number, string> = {
  1: 'Quarter of the way and {a} leads {b}.',
  2: 'HALFWAY - {a} by a nose from {b}.',
  3: 'Three-quarter mark, {a} in front and {b} winding up.',
};

export type CommentaryRandom = () => number;

const pick = <T>(pool: readonly T[], rnd: CommentaryRandom = Math.random): T =>
  pool[Math.floor(rnd() * pool.length)];

const fill = (line: string, a: string, b: string, c = ''): string =>
  line.replace('{a}', a).replace('{b}', b).replace('{c}', c);

/** Pick a line for the current phase of the race, with the names filled in. */
/**
 * How long a snail is, as a fraction of one lap.
 *
 * The margins a broadcast quotes are in lengths, not in percentages, and a
 * length is a real distance on this track: a lap is 4,000 world units and a
 * snail is about 170 of them, so a lap is roughly twenty-three and a half of
 * them nose to tail. Quoting the number the room can actually count off the
 * screen is what separates a caller from a progress bar.
 */
export const LENGTHS_PER_LAP = 23.5;

/** A margin, said the way a caller says it. */
export function lengthPhrase(lengths: number): string {
  const n = Math.abs(lengths);
  if (n < 0.25) return 'a nose';
  if (n < 0.6) return 'half a length';
  if (n < 1.5) return 'a length';
  if (n < 2.5) return 'two lengths';
  if (n < 3.5) return 'three lengths';
  if (n < 6) return `${Math.round(n)} lengths`;
  if (n < 12) return 'a big gap';
  return 'a mile';
}

/** What the caller can see, so it can talk about that rather than the clock. */
export interface CallContext {
  leadP: number;
  lead: string;
  chase: string;
  /** Third place, for the lines that mention it. */
  third: string;
  /** Whoever is last. Occasionally the funniest thing on the track. */
  tail: string;
  /** The real margin between first and second, in lengths. */
  gapLengths: number;
  /** How far the leader has left, in lengths. */
  toGoLengths: number;
}

/**
 * Pick a line for what is actually happening.
 *
 * Every branch here is driven by a measurement off the track: the margin in
 * lengths, the distance left to run, who is actually third. The phase pools
 * are the last resort rather than the first, because "they are away and {a}
 * shows early pace" is true of every race ever run and therefore tells the
 * room nothing about this one.
 */
export function callLine(ctx: CallContext, rnd: CommentaryRandom = Math.random): string {
  const g = lengthPhrase(ctx.gapLengths);
  const say = (pool: readonly string[]) =>
    fill(pick(pool, rnd), ctx.lead, ctx.chase, ctx.third)
      .replace('{d}', ctx.tail)
      .replace('{g}', g)
      .replace('{m}', lengthPhrase(ctx.toGoLengths));

  if (ctx.leadP > 0.86) return say(RUN_HOME_LINES);
  if (ctx.gapLengths < 0.6 && ctx.leadP > 0.15) return say(TIGHT_LINES);
  if (ctx.gapLengths > 4 && ctx.leadP > 0.3) return say(CLEAR_LINES);
  if (ctx.tail && ctx.tail !== ctx.lead && ctx.leadP > 0.25 && rnd() < 0.12) {
    return say(BACK_MARKER_LINES);
  }
  /* Otherwise quote the margin, which is what a race caller does most of the
     time, and only fall back to colour when there is nothing to quote. */
  if (rnd() < 0.54) return say(MARGIN_LINES);
  const phase = ctx.leadP < 0.3 ? 'early' : ctx.leadP < 0.72 ? 'mid' : 'late';
  return say(COMMENTARY[phase]);
}

/** A snail has actually passed another one. Said by name, with the place. */
export function overtakeLine(
  mover: string,
  passed: string,
  place: number,
  rnd: CommentaryRandom = Math.random,
): string {
  return fill(pick(OVERTAKE_LINES, rnd), mover, passed, '').replace('{n}', ordinal(place));
}

/** The beat after a surprise. Said only if the caller has room for it. */
export const reactionLine = (tone: EventTone, rnd: CommentaryRandom = Math.random): string =>
  pick(REACTION_LINES[tone], rnd);

export function leadChangeLine(
  newLeader: string,
  deposed: string,
  rnd: CommentaryRandom = Math.random,
): string {
  return fill(pick(LEAD_CHANGE_LINES, rnd), newLeader, deposed);
}

export function sectorLine(sector: number, leadName: string, chaserName: string): string | null {
  const line = SECTOR_LINES[sector];
  return line ? fill(line, leadName, chaserName) : null;
}

/**
 * The call as the leader crosses to start a new lap. `lap` is the one being
 * started, so the bell goes with the last one.
 */
export function lapLine(
  lap: number,
  laps: number,
  a: string,
  b: string,
  rnd: CommentaryRandom = Math.random,
): string {
  const pool = lap === laps ? BELL_LAP_LINES : LAP_LINES;
  return fill(pick(pool, rnd), a, b).replace('{n}', String(lap));
}

/** The call for a surprise, e.g. "Gary hits the turbo slime and LUNGES!". */
export const eventLine = (event: RaceEvent, name: string): string =>
  event.call.replace('{a}', name);
