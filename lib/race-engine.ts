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
  MotionProfile,
  RaceResult,
} from './types';
import type { CourseId } from './courses';
import { MAX_FIELD, MIN_LIVE_FIELD } from './palette';
import { CLUB } from './club';

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
  | 'siren'
  | 'rain'
  | 'wave';

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
      '{a} hits the turbo slime and lunges!',
      '{a} has found the quick stuff and gone whoosh!',
      'Turbo slime for {a} and it is away!',
    ],
    magFrom: 0.055, magTo: 0.095, spanFrom: 0.1, spanTo: 0.18, from: 0.1, to: 0.62,
  },
  {
    kind: 'surge', label: 'SECOND WIND', tone: 'good', sound: 'up', weight: 9,
    calls: [
      '{a} finds a second wind and is flying home!',
      'Where has {a} found that? Second wind!',
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
      'Somebody has given {a} a coffee and it is electric!',
      '{a} has had a triple shot and is bouncing off the walls!',
    ],
    magFrom: 0.09, magTo: 0.145, spanFrom: 0.06, spanTo: 0.11, from: 0.14, to: 0.74,
  },
  {
    kind: 'surge', label: 'CROWD LIFT', tone: 'good', sound: 'up', weight: 6,
    calls: [
      'The members bar is chanting for {a} and it has responded!',
      'Listen to that! The room is carrying {a}!',
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
      '{a} is asleep. Somebody wake it up!',
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
      '{a} is into the mystery slime and anything could happen!',
      '{a} has gone straight through the mystery puddle!',
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
      'Love is in the air and {a} has forgotten the race!',
    ],
    magFrom: -0.1, magTo: 0.06, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.72,
  },
  {
    kind: 'chaos', label: 'THIRD UMPIRE', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      'They have sent {a} upstairs to the third umpire!',
      '{a} is waiting on the umpire. This will take a minute.',
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

  /* ── The second book: more of the ground, more of the club ────────── */
  {
    kind: 'boost', label: 'SIGHTSCREEN SHORTCUT', tone: 'good', sound: 'up', weight: 6,
    calls: [
      '{a} has ducked behind the sightscreen and come out the other side ahead!',
      'Nobody saw {a} go past the sightscreen, but there it is!',
    ],
    magFrom: 0.045, magTo: 0.085, spanFrom: 0.08, spanTo: 0.15, from: 0.12, to: 0.7,
  },
  {
    kind: 'surge', label: 'DRINKS BREAK ENERGY', tone: 'good', sound: 'up', weight: 6,
    calls: [
      '{a} has had a sports drink at the boundary and it has worked!',
      'Hydrated and dangerous: {a} is motoring!',
    ],
    magFrom: 0.05, magTo: 0.09, spanFrom: 0.1, spanTo: 0.18, from: 0.3, to: 0.78,
  },
  {
    kind: 'boost', label: 'TAILWIND', tone: 'good', sound: 'up', weight: 7,
    calls: [
      'A gust off the bay has got in behind {a}!',
      '{a} has caught the tailwind and it is sailing!',
    ],
    magFrom: 0.04, magTo: 0.075, spanFrom: 0.12, spanTo: 0.2, from: 0.1, to: 0.72,
  },
  {
    kind: 'surge', label: 'HOME CROWD ROAR', tone: 'good', sound: 'wave', weight: 5,
    calls: [
      'The home crowd has found its voice and {a} has heard it!',
      'Listen to the members for {a}! It is lifting!',
    ],
    magFrom: 0.05, magTo: 0.095, spanFrom: 0.1, spanTo: 0.18, from: 0.4, to: 0.82,
  },
  {
    kind: 'nap', label: 'TEA INTERVAL', tone: 'bad', sound: 'nap', weight: 6,
    calls: [
      '{a} has stopped for tea. It is not tea time!',
      'Scones and a sit down for {a}!',
    ],
    magFrom: -0.12, magTo: -0.07, spanFrom: 0.12, spanTo: 0.2, from: 0.2, to: 0.7,
  },
  {
    kind: 'wander', label: 'SELFIE STOP', tone: 'bad', sound: 'wander', weight: 6,
    calls: [
      '{a} has stopped for a selfie with the front row!',
      'Smile! {a} is posing for the members and going nowhere!',
    ],
    magFrom: -0.08, magTo: -0.045, spanFrom: 0.1, spanTo: 0.18, from: 0.18, to: 0.74,
  },
  {
    kind: 'stumble', label: 'DEW ON THE OUTFIELD', tone: 'bad', sound: 'down', weight: 7,
    calls: [
      '{a} has hit the dew and it is spinning its wheels!',
      'Heavy dew out there and {a} has found the worst of it!',
    ],
    magFrom: -0.075, magTo: -0.04, spanFrom: 0.1, spanTo: 0.17, from: 0.12, to: 0.78,
  },
  {
    kind: 'nap', label: 'SUNSCREEN STOP', tone: 'bad', sound: 'wander', weight: 5,
    calls: [
      '{a} has pulled over to reapply the sunscreen. Slip, slop, slow.',
      'Sun safety first for {a}, racing second!',
    ],
    magFrom: -0.1, magTo: -0.06, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.72,
  },
  {
    kind: 'stumble', label: 'COVERS CREW', tone: 'bad', sound: 'down', weight: 4,
    calls: [
      'The covers crew is dragging the sheet straight across {a}!',
      '{a} is caught under the covers! Somebody lift the corner!',
    ],
    magFrom: -0.1, magTo: -0.055, spanFrom: 0.1, spanTo: 0.17, from: 0.2, to: 0.74,
  },
  {
    kind: 'chaos', label: 'DRS REVIEW', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      '{a} has been sent upstairs for a review!',
      'Reviewing! {a} is waiting on the third umpire!',
    ],
    magFrom: -0.09, magTo: 0.09, spanFrom: 0.08, spanTo: 0.15, from: 0.2, to: 0.74,
  },
  {
    kind: 'chaos', label: 'MYSTERY SPINNER', tone: 'wild', sound: 'weird', weight: 4,
    calls: [
      'A mystery spinner has turned square in front of {a}!',
      '{a} has read the wrong one! Which way is that going?',
    ],
    magFrom: -0.1, magTo: 0.1, spanFrom: 0.08, spanTo: 0.16, from: 0.18, to: 0.76,
  },
  {
    kind: 'chaos', label: 'SIGHTSCREEN GLARE', tone: 'wild', sound: 'weird', weight: 4,
    calls: [
      'The sightscreen glare is right in the eyes of {a}!',
      '{a} cannot see a thing and is guessing the line!',
    ],
    magFrom: -0.08, magTo: 0.07, spanFrom: 0.08, spanTo: 0.15, from: 0.16, to: 0.74,
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
      'A shell plague is sweeping the field! They are dropping everywhere!',
      'Plague! Half this field has gone down with it!',
    ],
    shareFrom: 0.4, shareTo: 0.7,
    magFrom: -0.1, magTo: -0.05, spanFrom: 0.12, spanTo: 0.2, from: 0.2, to: 0.68,
  },
  {
    kind: 'swoop', label: 'MAGPIE SWOOP', tone: 'bad', sound: 'swoop', weight: 8,
    calls: [
      'Swoop! A magpie has come straight through the middle of them!',
      'Look out! A magpie has scattered the field!',
    ],
    shareFrom: 0.2, shareTo: 0.45,
    magFrom: -0.09, magTo: -0.04, spanFrom: 0.06, spanTo: 0.12, from: 0.15, to: 0.78,
  },
  {
    kind: 'chaos', label: 'SPRINKLERS ON', tone: 'wild', sound: 'siren', weight: 6,
    calls: [
      'The sprinklers are on! Nobody told the groundsman there was a race!',
      'Sprinklers! Half the course is under water!',
    ],
    shareFrom: 0.4, shareTo: 0.8,
    magFrom: -0.08, magTo: 0.08, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.72,
  },
  {
    kind: 'chaos', label: 'ROGUE CRICKET BALL', tone: 'wild', sound: 'weird', weight: 7,
    calls: [
      'A cricket ball has entered the field. It has no lane and no apology!',
      'Rogue cricket ball! The runners are taking evasive action!',
    ],
    shareFrom: 0.25, shareTo: 0.5,
    magFrom: -0.075, magTo: 0.055, spanFrom: 0.07, spanTo: 0.13, from: 0.18, to: 0.72,
  },
  {
    kind: 'chaos', label: 'DOG ON THE TRACK', tone: 'wild', sound: 'swoop', weight: 6,
    calls: [
      'The club dog is on the track! Absolute carnage!',
      'Somebody grab that dog! It is running the wrong way through the field!',
    ],
    shareFrom: 0.3, shareTo: 0.6,
    magFrom: -0.1, magTo: 0.07, spanFrom: 0.08, spanTo: 0.15, from: 0.2, to: 0.74,
  },
  {
    kind: 'boost', label: 'LETTUCE ON THE TRACK', tone: 'good', sound: 'up', weight: 5,
    calls: [
      'Somebody has thrown a lettuce on the track and they have taken off!',
      'Lettuce! Half the field has picked up the pace!',
    ],
    shareFrom: 0.4, shareTo: 0.8,
    magFrom: 0.04, magTo: 0.085, spanFrom: 0.1, spanTo: 0.18, from: 0.15, to: 0.7,
  },
  {
    kind: 'plague', label: 'FALSE START PANIC', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      'Somebody has fired the gun again and half of them have stopped dead!',
      'They think the race has been called back! Chaos out there!',
    ],
    shareFrom: 0.3, shareTo: 0.6,
    magFrom: -0.09, magTo: 0.04, spanFrom: 0.07, spanTo: 0.13, from: 0.16, to: 0.6,
  },
  {
    kind: 'plague', label: 'PITCH ROLLER CROSSING', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      'The pitch roller is crossing. Slowly, but with total commitment!',
      'Pitch roller on the course! It has right of way and knows it!',
    ],
    shareFrom: 0.25, shareTo: 0.55,
    magFrom: -0.095, magTo: 0.035, spanFrom: 0.1, spanTo: 0.17, from: 0.22, to: 0.72,
  },

  /* ── The second book of field incidents ───────────────────────────── */
  {
    kind: 'plague', label: 'RAIN SQUALL', tone: 'bad', sound: 'rain', weight: 5,
    calls: [
      'A squall is across the ground! Half the field has stopped to shelter!',
      'Rain! The outfield is under water and half the field is bogged!',
    ],
    shareFrom: 0.35, shareTo: 0.7,
    magFrom: -0.09, magTo: -0.045, spanFrom: 0.1, spanTo: 0.18, from: 0.2, to: 0.7,
  },
  {
    kind: 'boost', label: 'MEXICAN WAVE', tone: 'good', sound: 'wave', weight: 5,
    calls: [
      'The crowd has started a wave and it has carried half the field with it!',
      'Here comes the wave! Everybody up, and everybody faster!',
    ],
    shareFrom: 0.4, shareTo: 0.8,
    magFrom: 0.04, magTo: 0.08, spanFrom: 0.1, spanTo: 0.18, from: 0.18, to: 0.72,
  },
  {
    kind: 'swoop', label: 'MAGPIE RAID', tone: 'bad', sound: 'swoop', weight: 6,
    calls: [
      'Magpies! Somebody dropped a chip and the whole family is here!',
      'A magpie raid! They are after the lettuce and the runners scatter!',
    ],
    shareFrom: 0.25, shareTo: 0.5,
    magFrom: -0.085, magTo: -0.04, spanFrom: 0.06, spanTo: 0.12, from: 0.15, to: 0.76,
  },
  {
    kind: 'chaos', label: 'ICE CREAM VAN', tone: 'wild', sound: 'wander', weight: 5,
    calls: [
      'The ice cream van is here and half the field has gone for a cone!',
      'Ice cream! Some have sped up to get there, some have stopped to eat!',
    ],
    shareFrom: 0.3, shareTo: 0.6,
    magFrom: -0.09, magTo: 0.07, spanFrom: 0.1, spanTo: 0.17, from: 0.2, to: 0.72,
  },
  {
    kind: 'chaos', label: 'PITCH INVADER', tone: 'wild', sound: 'siren', weight: 4,
    calls: [
      'A pitch invader is running across the course! The runners dodge!',
      'Somebody has run on! Security is slower than the snails!',
    ],
    shareFrom: 0.25, shareTo: 0.55,
    magFrom: -0.09, magTo: 0.06, spanFrom: 0.08, spanTo: 0.14, from: 0.2, to: 0.72,
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
  /* Nothing is safe: the most surprises the book and the deck will deal. */
  mayhem: 2.2,
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
    { label: 'LATE CHARGE', call: '{a} is flying at them! Look at this finish!' },
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
    motion?: MotionProfile;
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

/**
 * Retirements are a Chaos and Mayhem thing. A paid snail knocked out of a
 * Standard race six seconds in was the single most complained-about moment
 * of the last night: at the lower levels every runner finishes.
 */
export const RETIREMENT_LEVELS: readonly IntensityId[] = ['chaos', 'mayhem'];

/** A retirement never lands before this share of the race has been run. */
export const RETIREMENT_EARLIEST = 0.5;

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
  {
    code: 'magpie-scare',
    label: 'MAGPIE SCARE',
    reveal: 'A magpie has swooped at {a}, and the marshal is walking it off the course.',
    commentary: '{a} is safe under the marshal\'s hat after that magpie scare, but their race is over.',
  },
  {
    code: 'covers-call',
    label: 'COVERS CALL',
    reveal: 'The covers are coming on over {a}\'s lane. The marshal has called it in.',
    commentary: '{a} has been lifted safely clear before the covers went on, but their race is over.',
  },
  {
    code: 'drinks-cart-crossing',
    label: 'DRINKS CART CROSSING',
    reveal: 'The drinks cart is crossing {a}\'s lane and the marshal has stopped the runner.',
    commentary: '{a} has been walked safely around the drinks cart, but their race is over.',
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

/**
 * The lively profile: at pace from the gates, and every runner jockeying
 * around its own line.
 *
 * `u` is the runner's effective clock as a share of its base finish time.
 * The first engine mapped it through a smoothstep, which is why the field
 * crawled off the gates and crawled again at the post: the derivative of
 * that curve is zero at both ends. This one is linear, with a wobble whose
 * phase is driven by the same effective clock, so a held runner's wobble
 * freezes with it and a boosted one surges with it.
 *
 * Fairness is unchanged. The wobble is zero at u = 0 and u = 1, so a runner
 * is on the line exactly when its clock reaches its base finish time, and
 * its amplitude is bounded so the curve is strictly increasing: the on-screen
 * position is still a pure, monotone function of the race clock and can
 * never run backwards or cross the post early.
 */
export function livelyProgress(runner: LockedRaceRunner, u: number): number {
  const k = (runner.w1 * runner.baseFinishMs) / 4000;
  const amplitude = Math.min(0.02, 0.85 / (Math.PI + k));
  return u + amplitude * Math.sin(Math.PI * u) * Math.sin(k * u + runner.ph1);
}

function progressForLockedRunner(
  runner: LockedRaceRunner,
  events: LockedRaceEvent[],
  raceT: number,
  motion?: MotionProfile,
): number {
  const u = clamp(effectiveClockAt(runner, events, raceT) / runner.baseFinishMs, 0, 1);
  if (motion === 'lively') return clamp(livelyProgress(runner, u), 0, 1);
  return u * u * (3 - 2 * u);
}

/** Pure progress lookup used by generation, animation, replay and verification. */
export function lockedProgressAt(plan: LockedRacePlan, lane: number, raceT: number): number {
  const runner = plan.runners.find((candidate) => candidate.lane === lane);
  if (!runner) return 0;
  const progress = progressForLockedRunner(runner, plan.events, raceT, plan.motion);
  return lane === plan.winnerLane && raceT < plan.stopAtMs && progress >= 1
    ? 1 - Number.EPSILON
    : progress;
}

/** A runner running in never gets closer than this to the one classified ahead of it. */
const RUN_IN_GAP = 0.004;
/** Nobody but the winner is drawn as having crossed: the official result classifies the rest. */
const RUN_IN_CEILING = 1 - 1e-4;

/**
 * Where every runner is during the finish hold, at race time `raceT` from
 * the stop onwards. The field keeps running in at its own pace, but no
 * runner is ever drawn past the one classified ahead of it, so the picture
 * always agrees with the official result. Retired runners stay where they
 * stopped and the winner stays on the line. Non-decreasing in `raceT`, and
 * equal to the published `progressAtStop` at the stop itself.
 */
export function runInProgress(plan: LockedRacePlan, raceT: number): Map<number, number> {
  const out = new Map<number, number>();
  const t = Math.max(raceT, plan.stopAtMs);
  let ahead = 1;
  for (const result of [...plan.results].sort((a, b) => a.place - b.place)) {
    const atStop = lockedProgressAt(plan, result.lane, plan.stopAtMs);
    if (result.lane === plan.winnerLane) {
      out.set(result.lane, 1);
      continue;
    }
    if (result.status === 'retired') {
      out.set(result.lane, atStop);
      continue;
    }
    const runner = plan.runners.find((candidate) => candidate.lane === result.lane);
    const raw = runner ? progressForLockedRunner(runner, plan.events, t, plan.motion) : atStop;
    const cap = ahead >= 1 ? RUN_IN_CEILING : ahead - RUN_IN_GAP;
    const p = Math.max(atStop, Math.min(raw, cap, RUN_IN_CEILING));
    out.set(result.lane, p);
    ahead = p;
  }
  return out;
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

/* ── Twist timing: the contract with the renderers ──────────────────── */

/**
 * Every twist is one story on air: an INCOMING warning, the hit, the hit
 * card parked on screen, then a breath before the next. These numbers are
 * what the renderers and the caller rely on, so they are exported and
 * tested rather than implied.
 */
/** The warning goes up this long before the hit. */
export const TWIST_WARNING_MS = 2600;
/** The promise: no warning is ever shorter than this. */
export const TWIST_MIN_WARNING_MS = 2500;
/** The snail's name comes up this long before the hit. */
export const TWIST_REVEAL_MS = 1000;
/** The hit card stays up this long after the hit. */
export const TWIST_HOLD_MS = 2800;
/** And the screen has this long to itself before the next warning. */
export const TWIST_GAP_MS = 400;
/** The promise: two hits are never closer than this. */
export const TWIST_MIN_SPACING_MS = 3000;
/**
 * The planner's spacing between hits. One story is warning + hold + gap
 * (5.8 s); the extra keeps that true after the final length fit, which can
 * shorten the whole race by a few per cent.
 */
export const TWIST_SPACING_MS = 6200;
/** "At the post" cards land with the leader this far home. */
export const POST_PROGRESS = { from: 0.9, to: 0.95, max: 0.96 } as const;
/** How long before the line an "at the post" twist would like to hit, so its call is said before the winner's. */
export const POST_LINE_CLEAR_MS = 4400;
/** The race finishes within this share of its set length. */
export const RACE_LENGTH_TOLERANCE = 0.03;

/**
 * How many twist cards the room sees in a race at each Surprise director
 * level: ordinary surprises, field incidents, deck cards and retirements
 * all count, because each one is a warning card and a hit card on screen.
 * A short race cannot fit the spacing above, so it gets fewer: see
 * `twistRange`.
 */
export const INTENSITY_RANGES: Record<IntensityId, { readonly min: number; readonly max: number }> = {
  calm: { min: 0, max: 1 },
  standard: { min: 2, max: 3 },
  big: { min: 3, max: 4 },
  chaos: { min: 4, max: 5 },
  mayhem: { min: 6, max: 8 },
};

/** What the Admin option says, built from the same numbers the planner uses. */
export function intensityLabel(intensity: IntensityId): string {
  const names: Record<IntensityId, string> = {
    calm: 'Calm', standard: 'Standard', big: 'Big night', chaos: 'Chaos', mayhem: 'Mayhem',
  };
  const { min, max } = INTENSITY_RANGES[intensity];
  const gentle = intensity === 'calm' ? ' gentle' : '';
  return `${names[intensity]} (${min} to ${max}${gentle} twists a race)`;
}

/**
 * The levels whose twists run deep into the run home: nobody is safe until
 * the line. At these levels an ordinary twist may land with the leader about
 * nine tenths home, and the "at the post" card lands later still.
 */
export const LATE_LEVELS: readonly IntensityId[] = ['big', 'chaos', 'mayhem'];

/** Where the hit before an "at the post" card must be done by, as a share of the race. */
const postFloor = (late: boolean): number => (late ? 0.9 : 0.86);

/** The window of the race an ordinary twist may hit in. */
function hitWindow(durationMs: number, withPost: boolean, late = false): { from: number; to: number } {
  const from = Math.max(TWIST_WARNING_MS + 400, Math.round(durationMs * 0.12));
  /* Ordinary twists are over before the last 15% at the gentler levels,
     which leaves the run home to the leaders; at the wild levels they run
     to the last 8%. A short race keeps the middle of the race. */
  let to = late
    ? Math.min(
        Math.round(durationMs * 0.88),
        Math.max(Math.round(durationMs * 0.92) - TWIST_HOLD_MS - TWIST_GAP_MS, Math.round(durationMs * 0.6)),
      )
    : Math.min(
        Math.round(durationMs * 0.8),
        Math.max(Math.round(durationMs * 0.85) - TWIST_HOLD_MS - TWIST_GAP_MS, Math.round(durationMs * 0.6)),
      );
  if (withPost) to = Math.min(to, Math.round(durationMs * postFloor(late)) - TWIST_SPACING_MS);
  return { from, to };
}

const slotsIn = (window: { from: number; to: number }): number =>
  window.to < window.from ? 0 : Math.floor((window.to - window.from) / TWIST_SPACING_MS) + 1;

/** The most twists a race of this length can carry and keep every story apart. */
export const twistCapacity = (durationMs: number): number => slotsIn(hitWindow(durationMs, false));

/**
 * The twist count a race of this length and level will show: the level's
 * range, capped by what fits. A 7 second race fits one, a 15 second race
 * two, a 30 second race four, a minute seven.
 */
export function twistRange(intensity: IntensityId, durationMs: number): { min: number; max: number } {
  const range = INTENSITY_RANGES[intensity] ?? INTENSITY_RANGES.standard;
  const cap = twistCapacity(durationMs);
  /* A race longer than a minute keeps the level's rate: twice as long, twice the twists. */
  const k = Math.max(1, durationMs / 60_000);
  return { min: Math.min(Math.round(range.min * k), cap), max: Math.min(Math.round(range.max * k), cap) };
}

/** Chance that a race at this level ends with an "at the post" card. */
const POST_CHANCE: Record<IntensityId, number> = {
  calm: 0, standard: 0.3, big: 0.55, chaos: 0.8, mayhem: 0.95,
};

/**
 * Where the twists are dealt from at each level: the single-runner book,
 * the field incidents and the deck. Calm keeps to small single-runner
 * moments.
 */
const SOURCE_MIX: Record<IntensityId, { book: number; field: number; deck: number }> = {
  calm: { book: 1, field: 0, deck: 0 },
  standard: { book: 0.5, field: 0.2, deck: 0.3 },
  big: { book: 0.4, field: 0.25, deck: 0.35 },
  chaos: { book: 0.3, field: 0.25, deck: 0.45 },
  mayhem: { book: 0.25, field: 0.25, deck: 0.5 },
};

/**
 * The mood of each twist. Boosts are the rare ones: a night where the
 * crowd keeps carrying a chaser past the leader reads as a fix.
 */
const TONE_MIX: Record<'good' | 'bad' | 'wild', number> = { good: 0.2, bad: 0.5, wild: 0.3 };

/**
 * Twists of one family are the same gag to the room: two lettuces or two
 * crowd lifts in one race is a repeat whatever the card says. A race deals
 * each family at most once.
 */
export function twistFamily(label: string): string {
  const value = label.toUpperCase();
  const families: Array<[RegExp, string]> = [
    [/LETTUCE/, 'lettuce'],
    [/SPRINKLER/, 'sprinkler'],
    [/MAGPIE|SWOOP/, 'magpie'],
    [/PLAGUE/, 'plague'],
    [/CROWD|CHEER|WAVE/, 'crowd'],
    [/ROLLER/, 'roller'],
    [/RAIN|HAIL|SQUALL/, 'weather'],
    [/WIND\b|HEADWIND|TAILWIND/, 'wind'],
    [/SIGHTSCREEN/, 'sightscreen'],
    [/UMPIRE|DRS/, 'umpire'],
    [/SHELL SWAP/, 'swap'],
    [/GROUNDSKEEPER|BOOT/, 'boot'],
    [/DRINKS/, 'drinks'],
    [/DOG/, 'dog'],
    [/MYSTERY/, 'mystery'],
  ];
  return families.find(([pattern]) => pattern.test(value))?.[1] ?? value;
}

/* ── Live captions ──────────────────────────────────────────────────── */

/** A strap line the room can read in one go at 1280x720. */
export const CAPTION_TARGET = 72;
/** No caption is ever longer than this. */
export const CAPTION_MAX = 90;

/**
 * A long name, cut back to whole words. "Speedy Gonzales the Third of
 * Geelong West" is "Speedy Gonzales" on the strap when the full name will
 * not fit; a short name is left alone.
 */
export function shortName(name: string, max = 18): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  const words = trimmed.split(/\s+/);
  let kept = 1;
  while (kept < words.length && words.slice(0, kept + 1).join(' ').length <= max) kept++;
  /* Never stop on a joining word ("Speedy Gonzales the"), and never on a
     possessive ("Nan's" for Nan's Favourite) or a bare title ("Sir"):
     take the next word instead, a little over length, or drop back. */
  while (kept > 1 && SHORT_NAME_JOINER.test(words[kept - 1])) kept--;
  const bare = kept === 1 && (SHORT_NAME_JOINER.test(words[0]) || SHORT_NAME_TITLE.test(words[0]));
  if (kept < words.length && (bare || /['\u2019]s?$/i.test(words[kept - 1])) && words.slice(0, kept + 1).join(' ').length <= max + 6) kept++;
  const out = words.slice(0, kept).join(' ');
  return out.length > max + 6 ? out.slice(0, max) : out;
}

const SHORT_NAME_JOINER = /^(?:the|of|and|de|von|van|la|le|a)$/i;
/* A title alone is no name: "Sir" is not Sir Slimes-a-Lot. */
const SHORT_NAME_TITLE = /^(?:sir|dame|lady|lord|mr|mrs|ms|miss|dr|captain|capt|king|queen|prince|princess|saint|st)\.?$/i;

/** The first line that reads in one go, else the first that fits, else the shortest. */
export function fitCaption(candidates: readonly string[]): string {
  const lines = candidates.filter((line) => line.trim().length > 0);
  if (!lines.length) return '';
  return (
    lines.find((line) => line.length <= CAPTION_TARGET) ??
    lines.find((line) => line.length <= CAPTION_MAX) ??
    lines.reduce((best, line) => (line.length < best.length ? line : best))
  );
}

/** Where a runner is, said the way a caller says it. */
export function positionPhrase(rank: number, fieldSize: number): string {
  if (rank <= 0) return 'the leader';
  if (rank >= fieldSize - 1) return 'in last';
  return `in ${ordinal(rank + 1)}`;
}

/** Give a book line the target's live position: "{a} slips" becomes "{a}, {pos}, slips". */
function withPosition(line: string): string {
  if (line.includes('{pos}')) return line;
  const at = line.indexOf('{a}');
  if (at < 0) return line;
  const next = line.charAt(at + 3);
  const insert = /[A-Za-z ]/.test(next) && next !== '' ? '{a}, {pos},' : '{a}, {pos}';
  return `${line.slice(0, at)}${insert}${line.slice(at + 3)}`;
}

interface CaptionFill {
  a?: string;
  b?: string;
  pos?: string;
}

/* With no place to quote, "{a}, {pos}, slips" reads "{a} slips". */
const fillCaption = (line: string, fill: CaptionFill): string =>
  (fill.pos ? line : line.replace(/, \{pos\},?/g, ''))
    .replace(/\{a\}/g, fill.a ?? '')
    .replace(/\{b\}/g, fill.b ?? '')
    .replace(/\{pos\}/g, fill.pos ?? '');

/** Every caption is offered full names first, then short names, then the terse form. */
function fitWithNames(lines: readonly string[], fill: CaptionFill): string {
  const short: CaptionFill = {
    ...fill,
    a: fill.a === undefined ? undefined : shortName(fill.a),
    b: fill.b === undefined ? undefined : shortName(fill.b),
  };
  const tiny: CaptionFill = {
    ...fill,
    a: fill.a === undefined ? undefined : shortName(fill.a, 12),
    b: fill.b === undefined ? undefined : shortName(fill.b, 12),
  };
  return fitCaption([
    ...lines.map((line) => fillCaption(line, fill)),
    ...lines.map((line) => fillCaption(line, short)),
    ...lines.map((line) => fillCaption(line, tiny)),
  ]);
}

/**
 * A twist's hit caption: one line drawn from its book, then its siblings,
 * full names, then short names, until one fits the strap; a terse
 * "{a}, {pos}: label!" line only when no natural line fits. Lines with no runner in them are used as they are.
 */
export function composeTwistCaption(
  lines: readonly string[],
  label: string,
  fill: { a?: string; b?: string; pos?: string },
  rnd: () => number = Math.random,
): string {
  const start = Math.floor(rnd() * lines.length);
  const ordered = [...lines.slice(start), ...lines.slice(0, start)];
  const named = ordered.some((line) => line.includes('{a}'));
  const terse = !named
    ? []
    : ordered.some((line) => line.includes('{b}')) && fill.b
      ? [`{a} and {b}: ${label.toLowerCase()}!`]
      : [`{a}, {pos}: ${label.toLowerCase()}!`];
  /* A natural line with a shortened name reads better than the terse form
     with the full name, so the terse form is only a last resort. */
  const natural = fitWithNames(ordered, fill);
  return terse.length ? fitCaption([natural, fitWithNames(terse, fill)]) : natural;
}

/* ── The deck ───────────────────────────────────────────────────────── */

/** Races shorter than this deal no "at the post" cards: there is no room for the warning and the line. */
export const DECK_MIN_DURATION_MS = 12_000;
/**
 * The most one runner's clock can be shifted over a race, as a share of race
 * time, every book and card added together. Wide enough that a night of
 * twists lands on screen, narrow enough that no snail teleports or stands
 * still for a third of the race.
 */
export const LANE_CLOCK_CAP = 0.3;
/** What the planner spends, leaving room for the final length fit. */
const PLAN_CLOCK_CAP = 0.27;

/** What a twist did when it was dealt: the clock shifts and who the caption is about. */
export interface DealtTwist {
  deltas: Record<number, number>;
  /** The runner the caption names. */
  featured?: number;
  /** A second runner the caption names, for the two-runner gags. */
  partner?: number;
  /** A caption chosen by the deal itself, when the card can go two ways. */
  call?: string;
}

export interface DeckCard {
  id: string;
  label: string;
  kind: RaceEventKind;
  tone: EventTone;
  sound: EventSound;
  /** Dealt at most once a night. */
  once: boolean;
  /** How often the card comes up against the rest of the deck; 1 when absent. */
  weight?: number;
  /** Lands at the finish post, with the leader about 90 to 96% home. */
  post?: boolean;
  /** The INCOMING card. Never names a runner or a place: the order can change before the hit. */
  warning: string;
  /**
   * Hit captions. {a} is the featured runner, {pos} its live place at the
   * hit ("the leader", "in 6th"), {b} a second runner.
   */
  calls: string[];
  /**
   * Decide the clock consequence per lane. `lanes` are the active runners,
   * leader first at the moment the card lands. Signed milliseconds; negative
   * holds a snail up, positive sends it on.
   */
  deal: (rnd: () => number, lanes: number[], durationMs: number) => DealtTwist;
}

const share = (rnd: () => number, durationMs: number, from: number, to: number): number =>
  Math.round(durationMs * (from + rnd() * (to - from)));

/**
 * One runner for a single-runner twist. Anyone can be hit. The front half
 * is a little more likely than the back, because that is where the camera
 * is, but the leader is no more likely than the runner behind it, so over a
 * night the leader is hit a little less often than pure chance.
 */
export function pickTarget(rnd: () => number, lanes: readonly number[]): number {
  const half = Math.ceil(lanes.length / 2);
  const weights = lanes.map((_, rank) => (rank === 0 ? 1 : rank <= half ? 1.25 : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rnd() * total;
  for (let rank = 0; rank < lanes.length; rank++) {
    roll -= weights[rank];
    if (roll <= 0) return lanes[rank];
  }
  return lanes[lanes.length - 1];
}

/** A random set of `count` runners, kept in running order. */
function randomSubset(rnd: () => number, lanes: readonly number[], count: number): number[] {
  const pool = [...lanes];
  const picked = new Set<number>();
  while (picked.size < Math.min(count, lanes.length) && pool.length) {
    picked.add(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return lanes.filter((lane) => picked.has(lane));
}

/** A run of `count` neighbours in the running order, starting anywhere. */
function randomRun(rnd: () => number, lanes: readonly number[], count: number): number[] {
  const size = Math.min(count, lanes.length);
  const start = Math.floor(rnd() * (lanes.length - size + 1));
  return lanes.slice(start, start + size);
}

export const DECK_CARDS: readonly DeckCard[] = [
  /* ── At the post: the last card of the race, close to the line ─────── */
  {
    id: 'plague-line', label: 'PLAGUE AT THE LINE', kind: 'plague', tone: 'bad', sound: 'plague', once: true, post: true,
    warning: 'The vet has seen something near the finish and is running.',
    calls: [
      'Plague at the line! {a}, {pos}, is the first to shake it off!',
      'They have all stopped at the post! {a}, {pos}, recovers first!',
    ],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      let featured = lanes[0];
      let least = Infinity;
      for (const lane of lanes) {
        const delay = share(rnd, durationMs, 0.04, 0.09);
        deltas[lane] = -delay;
        if (delay < least) {
          least = delay;
          featured = lane;
        }
      }
      return { deltas, featured };
    },
  },
  {
    id: 'magpie-post', label: 'MAGPIE AT THE POST', kind: 'swoop', tone: 'bad', sound: 'swoop', once: true, post: true,
    warning: 'A magpie has landed on the finish post.',
    calls: [
      'Swoop at the post! {a}, {pos}, has ducked with the line in sight!',
      'The magpie is down on them! {a}, {pos}, has had to duck!',
    ],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const hit = randomSubset(rnd, lanes, Math.max(2, Math.round(lanes.length * (0.4 + rnd() * 0.2))));
      for (const lane of hit) deltas[lane] = -share(rnd, durationMs, 0.04, 0.08);
      return { deltas, featured: hit[0] };
    },
  },
  {
    id: 'watermelon', label: 'WATERMELON AT THE POST', kind: 'nap', tone: 'bad', sound: 'nap', once: true, post: true,
    warning: 'Somebody has left a slice of watermelon near the winning post.',
    calls: [
      'Watermelon! {a}, {pos}, has stopped for a feed at the line!',
      'Watermelon at the post! {a}, {pos}, cannot walk past it!',
    ],
    deal: (rnd, lanes, durationMs) => {
      /* Somebody near the post: any of the front four, the leader no more often than the rest. */
      const front = lanes.slice(0, Math.min(4, lanes.length));
      const lane = front[Math.floor(rnd() * front.length)];
      return { deltas: { [lane]: -share(rnd, durationMs, 0.05, 0.08) }, featured: lane };
    },
  },

  /* ── The rest of the deck: any time in the body of the race ─────────── */
  {
    id: 'freeze', label: 'THE BIG FREEZE', kind: 'chaos', tone: 'wild', sound: 'siren', once: true,
    warning: 'The starter has a hand up. Something is not right.',
    calls: ['Freeze! {a}, {pos}, is the first one moving!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const hold = share(rnd, durationMs, 0.04, 0.06);
      const lucky = lanes[Math.floor(rnd() * lanes.length)];
      for (const lane of lanes) deltas[lane] = lane === lucky ? share(rnd, durationMs, 0.02, 0.04) : -hold;
      return { deltas, featured: lucky };
    },
  },
  {
    id: 'headwind', label: 'HEADWIND', kind: 'stumble', tone: 'bad', sound: 'rain', once: false,
    warning: 'The flags on the pavilion have swung right round.',
    calls: ['Headwind! Only {a}, {pos}, has found some shelter!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const sheltered = lanes[Math.floor(rnd() * lanes.length)];
      for (const lane of lanes) deltas[lane] = lane === sheltered ? share(rnd, durationMs, 0.015, 0.035) : -share(rnd, durationMs, 0.03, 0.05);
      return { deltas, featured: sheltered };
    },
  },
  {
    id: 'reverse', label: 'REVERSE GEAR', kind: 'wander', tone: 'bad', sound: 'wander', once: true,
    warning: 'One of the runners is looking over its shoulder.',
    calls: ['Reverse gear! {a}, {pos}, is going the wrong way!'],
    deal: (rnd, lanes, durationMs) => {
      const lane = pickTarget(rnd, lanes);
      return { deltas: { [lane]: -share(rnd, durationMs, 0.07, 0.1) }, featured: lane };
    },
  },
  {
    id: 'lucky-last', label: 'LUCKY LAST', kind: 'surge', tone: 'good', sound: 'up', once: false,
    warning: 'Somebody at the back has just woken up.',
    calls: ['{a}, {pos}, has lit the afterburners and is flying!'],
    deal: (rnd, lanes, durationMs) => {
      const last = lanes[lanes.length - 1];
      return { deltas: { [last]: share(rnd, durationMs, 0.06, 0.09) }, featured: last };
    },
  },
  {
    id: 'groundskeeper', label: 'GROUNDSKEEPER SHUFFLE', kind: 'stumble', tone: 'bad', sound: 'down', once: false,
    warning: 'The groundskeeper is walking onto the course with a bucket.',
    calls: ['The groundskeeper has picked up {a}, {pos}, and put it back!'],
    deal: (rnd, lanes, durationMs) => {
      const lane = pickTarget(rnd, lanes);
      return { deltas: { [lane]: -share(rnd, durationMs, 0.05, 0.08) }, featured: lane };
    },
  },
  {
    id: 'late-swap', label: 'LATE SHELL SWAP', kind: 'chaos', tone: 'wild', sound: 'weird', once: false,
    warning: 'Two of the runners are far too close to each other.',
    calls: ['Shell swap! {a} and {b} have gone through each other!'],
    deal: (rnd, lanes, durationMs) => {
      const pair = randomRun(rnd, lanes, 2);
      const swing = share(rnd, durationMs, 0.035, 0.055);
      return { deltas: { [pair[0]]: -swing, [pair[1]]: swing }, featured: pair[1], partner: pair[0] };
    },
  },
  {
    id: 'sprinkler-straight', label: 'LATE SPRINKLERS', kind: 'stumble', tone: 'bad', sound: 'down', once: false,
    warning: 'The sprinkler timer has just clicked.',
    calls: ['Sprinklers! {a}, {pos}, has hit the wet patch first!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const hit = randomSubset(rnd, lanes, Math.max(2, Math.round(lanes.length * (0.3 + rnd() * 0.3))));
      for (const lane of hit) deltas[lane] = -share(rnd, durationMs, 0.035, 0.065);
      return { deltas, featured: hit[0] };
    },
  },

  /* ── The twists: physical gags the whole room can read ─────────────── */
  {
    id: 'big-boot', label: 'THE BIG BOOT', kind: 'stumble', tone: 'bad', sound: 'down', once: true,
    warning: 'A very large shadow has fallen across the course.',
    calls: [
      'The boot! A giant boot has come down on {a}, {pos}!',
      'Stomp! {a}, {pos}, has been trodden on! Can it shake it off?',
    ],
    deal: (rnd, lanes, durationMs) => {
      const lane = pickTarget(rnd, lanes);
      return { deltas: { [lane]: -share(rnd, durationMs, 0.07, 0.1) }, featured: lane };
    },
  },
  {
    id: 'snail-ale', label: 'SNAIL ALE HAPPY HOUR', kind: 'nap', tone: 'wild', sound: 'weird', once: false,
    warning: 'The Snail Ale sign has just lit up beside the track.',
    calls: ['Happy hour! All but {a}, {pos}, have stopped for a Snail Ale!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const driver = lanes[Math.floor(rnd() * lanes.length)];
      for (const lane of lanes) deltas[lane] = lane === driver ? share(rnd, durationMs, 0.03, 0.05) : -share(rnd, durationMs, 0.04, 0.07);
      return { deltas, featured: driver };
    },
  },
  {
    id: 'boom-gate', label: 'BOOM GATE', kind: 'chaos', tone: 'wild', sound: 'siren', once: false,
    warning: 'The boom gate lights have started flashing across the course.',
    calls: ['Boom gate down! {a}, {pos}, got through and the rest are stuck!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const through = 1 + Math.floor(rnd() * Math.min(3, lanes.length - 2));
      for (const lane of lanes.slice(through)) deltas[lane] = -share(rnd, durationMs, 0.04, 0.07);
      return { deltas, featured: lanes[through - 1] };
    },
  },
  {
    id: 'catapult', label: 'THE CATAPULT', kind: 'surge', tone: 'good', sound: 'up', once: false,
    warning: 'The groundskeeper is winding something up behind the field.',
    calls: ['Catapult! {a}, {pos}, has been flung up the course!'],
    deal: (rnd, lanes, durationMs) => {
      const back = lanes.slice(Math.floor(lanes.length / 2));
      const lane = back[Math.floor(rnd() * back.length)];
      return { deltas: { [lane]: share(rnd, durationMs, 0.07, 0.1) }, featured: lane };
    },
  },
  {
    id: 'bunch-up', label: 'THE BIG BUNCH-UP', kind: 'chaos', tone: 'wild', sound: 'wave', once: true,
    warning: 'The stewards have wheeled a giant magnet onto the course.',
    calls: ['The magnet! The field bunches and {a}, {pos}, is pulled up!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const n = lanes.length;
      const swing = share(rnd, durationMs, 0.05, 0.07);
      lanes.forEach((lane, rank) => {
        const bias = (n - 1 - 2 * rank) / (n - 1);
        deltas[lane] = -Math.round(swing * bias);
      });
      return { deltas, featured: lanes[n - 1] };
    },
  },
  {
    id: 'caterpillar', label: 'CATERPILLAR CROSSING', kind: 'wander', tone: 'bad', sound: 'wander', once: false,
    warning: 'A very long caterpillar is heading for the course.',
    calls: ['Caterpillar! {a}, {pos}, has to wait for every one of those legs!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const group = randomRun(rnd, lanes, 3);
      for (const lane of group) deltas[lane] = -share(rnd, durationMs, 0.04, 0.07);
      return { deltas, featured: group[0] };
    },
  },
  {
    id: 'the-bat', label: 'THE BAT', kind: 'stumble', tone: 'wild', sound: 'weird', once: false, weight: 3,
    warning: 'One of the runners has found a cricket bat beside the track.',
    calls: [
      'The bat! {a} has clobbered {b} and is through!',
      'The bat! {a} has swung it at {b}! That is not in the rules!',
    ],
    deal: (rnd, lanes, durationMs) => {
      /* A runner outside the lead picks up the bat; the snail directly in front of it wears it. */
      const rank = 1 + Math.floor(rnd() * (lanes.length - 1));
      const batter = lanes[rank];
      const victim = lanes[rank - 1];
      return { deltas: { [victim]: -share(rnd, durationMs, 0.05, 0.08), [batter]: share(rnd, durationMs, 0.02, 0.03) }, featured: batter, partner: victim };
    },
  },
  {
    id: 'contagion', label: 'CONTAGIOUS PLAGUE', kind: 'plague', tone: 'bad', sound: 'plague', once: false, weight: 2,
    warning: 'The vet is running onto the course with a mask on.',
    calls: ['Plague! {a}, {pos}, has caught it, and so have its neighbours!'],
    deal: (rnd, lanes, durationMs) => {
      /* It starts with one runner and spreads to its neighbours in the running order. */
      const deltas: Record<number, number> = {};
      const centre = Math.floor(rnd() * lanes.length);
      const group = lanes.slice(Math.max(0, centre - 1), centre + 2);
      for (const lane of group) {
        deltas[lane] = -share(rnd, durationMs, lane === lanes[centre] ? 0.06 : 0.035, lane === lanes[centre] ? 0.08 : 0.055);
      }
      return { deltas, featured: lanes[centre] };
    },
  },
  {
    id: 'speed-camera', label: 'OFFICER JACKS SPEED CAMERA', kind: 'stumble', tone: 'bad', sound: 'siren', once: false,
    warning: 'Officer Jack has set up his speed camera on the rail.',
    calls: ['Flash! Officer Jack has pulled {a}, {pos}, over for speeding!'],
    deal: (rnd, lanes, durationMs) => {
      const lane = pickTarget(rnd, lanes);
      return { deltas: { [lane]: -share(rnd, durationMs, 0.05, 0.08) }, featured: lane };
    },
  },
  {
    id: 'sausage-sizzle', label: 'SAUSAGE SIZZLE', kind: 'nap', tone: 'bad', sound: 'weird', once: false,
    warning: 'Somebody has fired up the barbecue beside the track.',
    calls: ['Sausage sizzle! {a}, {pos}, and half the field have stopped!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const hungry = randomSubset(rnd, lanes, Math.max(2, Math.ceil(lanes.length / 2)));
      for (const lane of hungry) deltas[lane] = -share(rnd, durationMs, 0.04, 0.06);
      return { deltas, featured: hungry[0] };
    },
  },
  {
    id: 'kookaburra', label: 'KOOKABURRA LAUGH', kind: 'stumble', tone: 'bad', sound: 'weird', once: false,
    warning: 'A kookaburra has landed on the rail and is looking at the field.',
    calls: ['The kookaburra is laughing and {a}, {pos}, has joined in!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const group = randomRun(rnd, lanes, 3);
      for (const lane of group) deltas[lane] = -share(rnd, durationMs, 0.04, 0.06);
      return { deltas, featured: group[0] };
    },
  },
  {
    id: 'trampoline', label: 'THE TRAMPOLINE', kind: 'surge', tone: 'good', sound: 'up', once: false,
    warning: 'Somebody has dragged a trampoline onto the course.',
    calls: ['Boing! {a}, {pos}, has hit the trampoline!'],
    deal: (rnd, lanes, durationMs) => {
      const middle = lanes.slice(1, Math.max(2, lanes.length - 1));
      const lane = middle[Math.floor(rnd() * middle.length)];
      return { deltas: { [lane]: share(rnd, durationMs, 0.06, 0.09) }, featured: lane };
    },
  },
  {
    id: 'wombat', label: 'WOMBAT CROSSING', kind: 'wander', tone: 'bad', sound: 'wander', once: false,
    warning: 'Something round and furry is heading for the track.',
    calls: ['A wombat has sat down and {a}, {pos}, cannot get round it!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const picked = randomSubset(rnd, lanes, 3);
      for (const lane of picked) deltas[lane] = -share(rnd, durationMs, 0.04, 0.07);
      return { deltas, featured: picked[0] };
    },
  },
  {
    id: 'mower', label: 'RIDE-ON MOWER', kind: 'surge', tone: 'good', sound: 'up', once: false,
    warning: 'The groundskeeper has started the ride-on mower behind the field.',
    calls: ['The mower is on the course and {a}, {pos}, leads the escape!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const back = lanes.slice(-Math.min(3, lanes.length - 1));
      for (const lane of back) deltas[lane] = share(rnd, durationMs, 0.035, 0.06);
      return { deltas, featured: back[0] };
    },
  },
  {
    id: 'leaf-blower', label: 'LEAF BLOWER', kind: 'chaos', tone: 'wild', sound: 'wave', once: false,
    warning: 'The groundskeeper has a leaf blower and no idea which way it is pointing.',
    calls: ['Leaf blower! {a}, {pos}, and its neighbours are in the gale!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const group = randomRun(rnd, lanes, 3);
      /* Which way it points is a coin toss: hold them up or blow them on. */
      if (rnd() < 0.5) {
        for (const lane of group) deltas[lane] = -share(rnd, durationMs, 0.03, 0.06);
        return { deltas, featured: group[0], call: 'Leaf blower! {a}, {pos}, and its neighbours are stuck!' };
      }
      for (const lane of group) deltas[lane] = share(rnd, durationMs, 0.03, 0.06);
      return { deltas, featured: group[0], call: 'Leaf blower! {a}, {pos}, and its neighbours are flying!' };
    },
  },
  {
    id: 'tremor', label: 'EARTH TREMOR', kind: 'chaos', tone: 'wild', sound: 'wave', once: true,
    warning: 'The drinks on the bar have started to rattle.',
    calls: ['Earth tremor! {a}, {pos}, has come out of it best!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      let featured = lanes[0];
      let best = -Infinity;
      for (const lane of lanes) {
        let shift = Math.round(durationMs * (rnd() * 0.09 - 0.045));
        if (Math.abs(shift) < durationMs * 0.025) shift = Math.round((shift < 0 ? -1 : 1) * durationMs * 0.025);
        deltas[lane] = shift;
        if (shift > best) {
          best = shift;
          featured = lane;
        }
      }
      return { deltas, featured };
    },
  },
  {
    id: 'lucky-dip', label: 'LUCKY DIP', kind: 'chaos', tone: 'wild', sound: 'weird', once: false,
    warning: 'A bucket of numbered shells has appeared at the rail.',
    calls: ['Lucky dip! {a}, {pos}, drew the good one!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const pool = [...lanes];
      const pick = () => pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const winners = [pick(), pick()].filter((lane) => lane !== undefined);
      const losers = [pick(), pick()].filter((lane) => lane !== undefined);
      for (const lane of winners) deltas[lane] = share(rnd, durationMs, 0.04, 0.07);
      for (const lane of losers) deltas[lane] = -share(rnd, durationMs, 0.04, 0.06);
      return { deltas, featured: winners[0] };
    },
  },
  {
    id: 'possum', label: 'POSSUM ON THE LOOSE', kind: 'wander', tone: 'bad', sound: 'wander', once: false,
    warning: 'Something has fallen out of the gum tree by the scoreboard.',
    calls: ['A possum has dropped in front of {a}, {pos}!'],
    deal: (rnd, lanes, durationMs) => {
      const lane = pickTarget(rnd, lanes);
      return { deltas: { [lane]: -share(rnd, durationMs, 0.06, 0.09) }, featured: lane };
    },
  },
  {
    id: 'drone', label: 'RUNAWAY DRONE', kind: 'swoop', tone: 'bad', sound: 'swoop', once: false,
    warning: 'The club drone has stopped answering the remote.',
    calls: ['The runaway drone has buzzed {a}, {pos}, and the one beside it!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const pair = randomRun(rnd, lanes, 2);
      for (const lane of pair) deltas[lane] = -share(rnd, durationMs, 0.04, 0.07);
      return { deltas, featured: pair[0] };
    },
  },
  {
    id: 'slip-slide', label: "SLIP 'N' SLIDE", kind: 'surge', tone: 'good', sound: 'up', once: false,
    warning: 'Somebody has rolled a slip and slide across the course.',
    calls: ["Slip 'n' slide! {a}, {pos}, has gone sliding up the field!"],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const picked = randomSubset(rnd, lanes, 3);
      for (const lane of picked) deltas[lane] = share(rnd, durationMs, 0.035, 0.07);
      return { deltas, featured: picked[0] };
    },
  },
  {
    id: 'cheer-squad', label: 'CHEER SQUAD', kind: 'surge', tone: 'good', sound: 'up', once: false,
    warning: 'The junior cheer squad has found the back of the field.',
    calls: ['The cheer squad is screaming for {a}, {pos}, and it is flying!'],
    deal: (rnd, lanes, durationMs) => {
      const lane = lanes[lanes.length - 1];
      return { deltas: { [lane]: share(rnd, durationMs, 0.06, 0.09) }, featured: lane };
    },
  },
  {
    id: 'road-works', label: 'ROAD WORKS', kind: 'stumble', tone: 'bad', sound: 'down', once: false,
    warning: 'A man in a hi-vis vest is putting out cones on the course.',
    calls: ['Road works! {a} and {b} are stuck at the lollipop sign!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      const pair = randomRun(rnd, lanes, 2);
      for (const lane of pair) deltas[lane] = -share(rnd, durationMs, 0.04, 0.06);
      return { deltas, featured: pair[0], partner: pair[1] };
    },
  },
  {
    id: 'hailstorm', label: 'HAILSTORM', kind: 'plague', tone: 'bad', sound: 'rain', once: true,
    warning: 'The sky over the pavilion has gone very dark, very fast.',
    calls: ['Hail! Heads in, and {a}, {pos}, is the first one out!'],
    deal: (rnd, lanes, durationMs) => {
      const deltas: Record<number, number> = {};
      let featured = lanes[0];
      let least = Infinity;
      for (const lane of lanes) {
        const hold = share(rnd, durationMs, 0.03, 0.06);
        deltas[lane] = -hold;
        if (hold < least) {
          least = hold;
          featured = lane;
        }
      }
      return { deltas, featured };
    },
  },
];

/** Once-a-night card ids a plan dealt, to be excluded from later races. */
export const dealtDeckCards = (plan: LockedRacePlan): string[] =>
  plan.events
    .filter((event) => event.id.startsWith('deck-'))
    .map((event) => event.id.slice('deck-'.length))
    .filter((id) => DECK_CARDS.some((card) => card.id === id && card.once));

/* ── The twist pool: the book, the field incidents and the deck ───────── */

type TwistSource = 'book' | 'field' | 'deck';

interface TwistDef {
  /** Event id stem. Deck cards keep `deck-<card id>` for the once-a-night ledger. */
  id: string;
  source: TwistSource;
  label: string;
  kind: RaceEventKind;
  tone: EventTone;
  sound: EventSound;
  family: string;
  weight: number;
  once: boolean;
  post: boolean;
  warning: string;
  calls: readonly string[];
  /** Share of the race the on-air window covers, for the book's envelopes. */
  span: number;
  /** Several runners at once: must reach at least two to be the story it says. */
  field: boolean;
  deal: (rnd: () => number, lanes: number[], durationMs: number, gentle: boolean) => DealtTwist;
}

/** A book magnitude, in race milliseconds, inside the visible floor and the per-twist cap. */
function bookDelta(mag: number, durationMs: number, gentle: boolean): number {
  const cap = Math.round(durationMs * (gentle ? 0.05 : 0.08));
  let delta = clamp(Math.round(mag * durationMs * 0.8 * (gentle ? 0.6 : 1)), -cap, cap);
  const minimum = Math.max(50, Math.round(durationMs * 0.025));
  if (Math.abs(delta) < minimum) delta = (mag < 0 ? -1 : 1) * minimum;
  return delta;
}

/** Every twist caption book, by label, for the strap-length tests. */
export const twistCaptionBooks = (): Array<{ label: string; calls: readonly string[] }> =>
  TWIST_POOL.map((def) => ({ label: def.label, calls: def.calls }));

const TWIST_POOL: readonly TwistDef[] = [
  ...EVENT_SPECS.map((spec, index): TwistDef => ({
    id: `book-${index}`,
    source: 'book',
    label: spec.label,
    kind: spec.kind,
    tone: spec.tone,
    sound: spec.sound,
    family: twistFamily(spec.label),
    weight: spec.weight,
    once: false,
    post: false,
    warning: `${spec.label} is approaching the course.`,
    calls: spec.calls.map(withPosition),
    span: (spec.spanFrom + spec.spanTo) / 2,
    field: false,
    deal: (rnd, lanes, durationMs, gentle) => {
      const lane = pickTarget(rnd, lanes);
      const mag = spec.magFrom + rnd() * (spec.magTo - spec.magFrom);
      return { deltas: { [lane]: bookDelta(mag, durationMs, gentle) }, featured: lane };
    },
  })),
  ...SWARM_SPECS.map((spec, index): TwistDef => ({
    id: `field-${index}`,
    source: 'field',
    label: spec.label,
    kind: spec.kind,
    tone: spec.tone,
    sound: spec.sound,
    family: twistFamily(spec.label),
    weight: spec.weight,
    once: false,
    post: false,
    warning: `${spec.label} is approaching the course.`,
    calls: spec.calls,
    span: (spec.spanFrom + spec.spanTo) / 2,
    field: true,
    deal: (rnd, lanes, durationMs) => {
      const fraction = spec.shareFrom + rnd() * (spec.shareTo - spec.shareFrom);
      const wanted = Math.max(2, Math.min(lanes.length, Math.round(lanes.length * fraction)));
      const hit = randomSubset(rnd, lanes, wanted);
      const deltas: Record<number, number> = {};
      for (const lane of hit) deltas[lane] = bookDelta(spec.magFrom + rnd() * (spec.magTo - spec.magFrom), durationMs, false);
      return { deltas, featured: hit[0] };
    },
  })),
  ...DECK_CARDS.map((card): TwistDef => ({
    id: `deck-${card.id}`,
    source: 'deck',
    label: card.label,
    kind: card.kind,
    tone: card.tone,
    sound: card.sound,
    family: twistFamily(card.label),
    weight: card.weight ?? 1,
    once: card.once,
    post: Boolean(card.post),
    warning: card.warning,
    calls: card.calls,
    span: 0,
    field: false,
    deal: (rnd, lanes, durationMs) => card.deal(rnd, lanes, durationMs),
  })),
];

/** Weighted draw without replacement: the whole list, most likely first. */
function weightedOrder<T>(rnd: () => number, items: readonly T[], weight: (item: T) => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (pool.length) {
    const total = pool.reduce((sum, item) => sum + Math.max(0.0001, weight(item)), 0);
    let roll = rnd() * total;
    let index = 0;
    while (index < pool.length - 1 && roll >= Math.max(0.0001, weight(pool[index]))) {
      roll -= Math.max(0.0001, weight(pool[index]));
      index += 1;
    }
    out.push(pool.splice(index, 1)[0]);
  }
  return out;
}

/** Who the caption is about, kept beside the event until the race is final. */
interface CaptionPlan {
  calls: readonly string[];
  featured?: number;
  partner?: number;
  /** A two-way card's own choice of line. */
  call?: string;
  retirement?: (typeof RETIREMENT_SPECS)[number];
}

interface TwistBuild {
  events: LockedRaceEvent[];
  captions: Map<string, CaptionPlan>;
  /** False when a planned twist could not be fitted, so the caller can try again. */
  complete: boolean;
}

interface TwistContext {
  seed: number;
  attempt: number;
  names: string[];
  durationMs: number;
  intensity: IntensityId;
  runners: LockedRaceRunner[];
  motion: MotionProfile;
  dealtCards: readonly string[];
  allowPost: boolean;
  commentaryDelayMs: number;
}

/** Ranked active lanes at race time `at`, leader first. */
function rankedAt(runners: LockedRaceRunner[], events: LockedRaceEvent[], at: number, motion: MotionProfile): number[] {
  return runners
    .filter((runner) => {
      const retirement = retirementFor(events, runner.lane);
      return !retirement || retirement.effectAtMs > at;
    })
    .map((runner) => ({ lane: runner.lane, p: progressForLockedRunner(runner, events, at, motion) }))
    .sort((a, b) => b.p - a.p)
    .map((row) => row.lane);
}

function earliestCrossingOf(runners: LockedRaceRunner[], events: LockedRaceEvent[]): number {
  const times = runners
    .map((runner) => lockedCrossingTime(runner, events))
    .filter((at): at is number => at !== null);
  return times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
}

/** The hold window a delay occupies on its lane: the clock is withheld for |delta| ms. */
const holdOverlaps = (events: LockedRaceEvent[], lane: number, from: number, to: number): boolean =>
  events.some((event) => {
    const delta = event.clockDeltaMsByLane[lane] ?? 0;
    if (!event.targetLanes.includes(lane) || delta >= 0) return false;
    return event.effectAtMs <= to + 300 && from <= event.effectAtMs + Math.abs(delta) + 300;
  });

/**
 * Deal the race's twists, in the order they will happen.
 *
 * The count comes from the level and the length. The hits are laid out
 * first, one story apart, then dealt from the first to the last: each twist
 * sees the field exactly as the earlier twists have left it, so a twist
 * aimed at "anyone in the front half" really is aimed at the front half the
 * room will see. Later twists can never move a runner before their own hit,
 * so nothing dealt afterwards can make an earlier choice wrong.
 */
function planTwists(ctx: TwistContext): TwistBuild {
  const { durationMs, intensity, runners, motion, names } = ctx;
  const events: LockedRaceEvent[] = [];
  const captions = new Map<string, CaptionPlan>();
  const totals = new Array<number>(names.length).fill(0);
  const totalCap = Math.round(durationMs * PLAN_CLOCK_CAP);
  const visibleMs = Math.round(durationMs * 0.022);
  const gentle = intensity === 'calm';

  /* The count and the retirement do not change between attempts. */
  const countRnd = mulberry32(ctx.seed ^ 0x434f4d45);
  const salt = Math.imul(ctx.attempt + 1, 0x9e3779b1);
  const timeRnd = mulberry32((ctx.seed ^ 0x54494d45 ^ salt) >>> 0);
  const pickRnd = mulberry32((ctx.seed ^ 0x4445434b ^ salt) >>> 0);
  const retirementRnd = mulberry32(ctx.seed ^ 0x52455431);

  const late = LATE_LEVELS.includes(intensity);
  const range = twistRange(intensity, durationMs);
  const count = range.min + Math.floor(countRnd() * (range.max - range.min + 1));
  if (count <= 0) return { events, captions, complete: true };

  /* The same four draws at every level, so the stream is one stream. */
  const retireChance = retirementRnd();
  const retireSpec = RETIREMENT_SPECS[Math.floor(retirementRnd() * RETIREMENT_SPECS.length)];
  const retireLane = Math.floor(retirementRnd() * names.length);
  const retireRoll = retirementRnd();
  const retiring = RETIREMENT_LEVELS.includes(intensity) && retireChance < 1 / RETIREMENT_CHANCE_DENOMINATOR;

  const postCards = TWIST_POOL.filter((def) => def.post && !(def.once && ctx.dealtCards.includes(def.id.slice('deck-'.length))));
  const postWanted =
    ctx.allowPost &&
    durationMs >= DECK_MIN_DURATION_MS &&
    postCards.length > 0 &&
    !(retiring && count === 1) &&
    slotsIn(hitWindow(durationMs, true, late)) + 1 >= count &&
    countRnd() < POST_CHANCE[intensity];
  const ordinary = count - (postWanted ? 1 : 0);

  const window = hitWindow(durationMs, postWanted, late);
  const slack = Math.max(0, window.to - window.from - (ordinary - 1) * TWIST_SPACING_MS);
  const offsets = Array.from({ length: ordinary }, () => Math.round(timeRnd() * slack)).sort((a, b) => a - b);
  const times = offsets.map((offset, index) => window.from + offset + index * TWIST_SPACING_MS);
  /* Never in the first half of the race as it will actually run: the
     retirement takes one of the later slots, or none. The final length fit
     can stretch the race by up to FIT_RATIO.to, so the slot clears that too. */
  const retireSlots = Array.from(times.keys()).filter((slot) => times[slot] >= durationMs * RETIREMENT_EARLIEST * FIT_RATIO.to);
  const retireSlot = retiring && retireSlots.length ? retireSlots[Math.floor(retireRoll * retireSlots.length)] : -1;

  /* A retirement is a gag too: no magpie swoop in the race a magpie scare retires a runner. */
  const usedFamilies = new Set<string>(retireSlot >= 0 ? [twistFamily(retireSpec.label)] : []);
  const mix = SOURCE_MIX[intensity];
  let complete = true;

  /** Clamp, cap and hold-check a deal; return what is left of it, or null. */
  const settle = (def: TwistDef, dealt: DealtTwist, at: number): Record<number, number> | null => {
    const kept: Record<number, number> = {};
    const lanes = Object.keys(dealt.deltas).map(Number);
    for (const lane of lanes) {
      const wanted = dealt.deltas[lane];
      const next = clamp(totals[lane] + wanted, -totalCap, totalCap);
      const delta = next - totals[lane];
      if (Math.abs(delta) < visibleMs) continue;
      /* Two holds at once on one lane would run its clock backwards. */
      if (delta < 0 && holdOverlaps(events, lane, at, at + Math.abs(delta))) continue;
      kept[lane] = delta;
    }
    const keptLanes = Object.keys(kept).map(Number);
    if (!keptLanes.length) return null;
    /* A card that is about several runners must still reach several. */
    if ((def.field || lanes.length > 1) && keptLanes.length < 2) return null;
    /* A runner the caption names as touched must still be touched. */
    if (dealt.featured !== undefined && dealt.featured in dealt.deltas && !(dealt.featured in kept)) return null;
    if (dealt.partner !== undefined && dealt.partner in dealt.deltas && !(dealt.partner in kept)) return null;
    return kept;
  };

  const eventFor = (def: TwistDef, at: number, deltas: Record<number, number>): LockedRaceEvent => {
    const targetLanes = Object.keys(deltas).map(Number).sort((a, b) => a - b);
    const magnitude = Math.max(...targetLanes.map((lane) => Math.abs(deltas[lane])));
    const span = Math.round(def.span * durationMs);
    return {
      id: def.source === 'deck' ? def.id : `${def.id}-${events.length}`,
      kind: def.kind,
      label: def.label,
      tone: def.tone,
      sound: def.sound,
      targetLanes,
      consequence: consequenceFor(deltas[targetLanes[0]]),
      warningAtMs: at - TWIST_WARNING_MS,
      revealAtMs: at - TWIST_REVEAL_MS,
      effectAtMs: at,
      commentaryAtMs: at + ctx.commentaryDelayMs,
      effectEndMs: at + Math.max(span, magnitude, 350),
      clockDeltaMsByLane: deltas,
      warningText: def.warning,
      revealText: '',
      commentaryText: '',
    };
  };

  /** Try to deal one twist at `at`; commit it and return true when it fits. */
  const tryDeal = (def: TwistDef, at: number, mustFinishAfter: number): boolean => {
    const ranked = rankedAt(runners, events, at, motion);
    if (ranked.length < 2) return false;
    const dealt = def.deal(pickRnd, ranked, durationMs, gentle);
    const deltas = settle(def, dealt, at);
    if (!deltas) return false;
    const event = eventFor(def, at, deltas);
    events.push(event);
    /* Every hit, and every hit still to come, lands before the finish. */
    if (earliestCrossingOf(runners, events) <= mustFinishAfter) {
      events.pop();
      return false;
    }
    for (const lane of event.targetLanes) totals[lane] += deltas[lane];
    usedFamilies.add(def.family);
    captions.set(event.id, { calls: def.calls, featured: dealt.featured, partner: dealt.partner, call: dealt.call });
    return true;
  };

  for (let slot = 0; slot < times.length; slot++) {
    const at = times[slot];
    const nextHit = slot + 1 < times.length ? times[slot + 1] : postWanted ? Math.round(durationMs * postFloor(late)) : at;
    const mustFinishAfter = nextHit + TWIST_REVEAL_MS + ctx.commentaryDelayMs + 400;

    if (slot === retireSlot) {
      /* Never the leader: the runner in front at the hit is left out of the draw. */
      const active = rankedAt(runners, events, at, motion).slice(1);
      const lane = active.includes(retireLane) ? retireLane : active[Math.floor(retireRoll * active.length)];
      const id = 'ret-0';
      events.push({
        id,
        kind: 'retire',
        label: retireSpec.label,
        tone: 'bad',
        sound: 'down',
        targetLanes: [lane],
        consequence: 'retire',
        warningAtMs: at - TWIST_WARNING_MS,
        revealAtMs: at - TWIST_REVEAL_MS,
        effectAtMs: at,
        commentaryAtMs: at + ctx.commentaryDelayMs,
        effectEndMs: at + 900,
        clockDeltaMsByLane: { [lane]: 0 },
        warningText: 'Course marshals are watching something near the boundary.',
        revealText: '',
        commentaryText: '',
        retirementCode: retireSpec.code,
        retirementLabel: retireSpec.label,
      });
      if (earliestCrossingOf(runners, events) > mustFinishAfter) {
        captions.set(id, { calls: [], featured: lane, retirement: retireSpec });
        continue;
      }
      events.pop();
    }

    /* The mood first, then the source, then the twist itself. */
    const toneRoll = pickRnd();
    const tone: EventTone = toneRoll < TONE_MIX.good ? 'good' : toneRoll < TONE_MIX.good + TONE_MIX.bad ? 'bad' : 'wild';
    const sourceRoll = pickRnd();
    const source: TwistSource = sourceRoll < mix.book ? 'book' : sourceRoll < mix.book + mix.field ? 'field' : 'deck';
    const eligible = (def: TwistDef) =>
      !def.post &&
      !usedFamilies.has(def.family) &&
      !(def.once && ctx.dealtCards.includes(def.id.slice('deck-'.length))) &&
      (mix[def.source] > 0) &&
      (!gentle || def.source === 'book');
    const preferred = weightedOrder(pickRnd, TWIST_POOL.filter((def) => eligible(def) && def.source === source && def.tone === tone), (def) => def.weight);
    const anyTone = weightedOrder(pickRnd, TWIST_POOL.filter((def) => eligible(def) && def.source === source && def.tone !== tone), (def) => def.weight);
    const anySource = weightedOrder(pickRnd, TWIST_POOL.filter((def) => eligible(def) && def.source !== source), (def) => def.weight);
    let placed = false;
    for (const def of [...preferred, ...anyTone, ...anySource]) {
      if (tryDeal(def, at, mustFinishAfter)) {
        placed = true;
        break;
      }
    }
    if (!placed) complete = false;
  }

  if (postWanted) {
    const last = events.reduce((latest, event) => Math.max(latest, event.effectAtMs), -Infinity);
    const earliest = Math.max(window.from, Number.isFinite(last) ? last + TWIST_SPACING_MS : 0, TWIST_WARNING_MS + 400);
    const target = durationMs < 20_000
      ? POST_PROGRESS.from - 0.02 + timeRnd() * (POST_PROGRESS.to - POST_PROGRESS.from)
      : POST_PROGRESS.from + timeRnd() * (POST_PROGRESS.to - POST_PROGRESS.from);
    const leaderAt = (t: number): number => {
      const ranked = rankedAt(runners, events, t, motion);
      return ranked.length ? progressForLockedRunner(runners[ranked[0]], events, t, motion) : 0;
    };
    let placed = false;
    const finish = earliestCrossingOf(runners, events);
    let at = earliest;
    while (at < finish && leaderAt(at) < target) at += 50;
    /* The caller's line for the hit wants about four seconds before the
       winner is called: bring the hit forward for it, but never out of the
       last stretch the card is named for. */
    if (finish - at < POST_LINE_CLEAR_MS) {
      let floor = earliest;
      while (floor < at && leaderAt(floor) < POST_PROGRESS.from - 0.025) floor += 50;
      at = Math.max(floor, finish - POST_LINE_CLEAR_MS);
    }
    for (const def of weightedOrder(pickRnd, postCards.filter((card) => !usedFamilies.has(card.family)), (card) => card.weight)) {
      if (placed) break;
      if (leaderAt(at) > POST_PROGRESS.max) break;
      /* The hit card is up before the line: the hit, the caption and a beat. */
      if (tryDeal(def, at, at + ctx.commentaryDelayMs + 700)) placed = true;
    }
    if (!placed) complete = false;
  }

  events.sort((a, b) => a.effectAtMs - b.effectAtMs || a.id.localeCompare(b.id));
  return { events, captions, complete };
}

/**
 * How far off its set length a dealt race may finish and still be fitted
 * exactly. Shrinking a race by more than about 6% would squeeze two stories
 * closer than one warning, card and breath.
 */
const FIT_RATIO = { from: 0.915, to: 1.06 } as const;

/** Scale every clock in a plan by `k`: the race, its twists and their effects. */
function scaleRace(runners: LockedRaceRunner[], events: LockedRaceEvent[], k: number, commentaryDelayMs: number): void {
  for (const runner of runners) runner.baseFinishMs = Math.round(runner.baseFinishMs * k);
  for (const event of events) {
    const at = Math.round(event.effectAtMs * k);
    const length = event.effectEndMs - event.effectAtMs;
    event.effectAtMs = at;
    event.effectEndMs = at + Math.max(350, Math.round(length * k));
    for (const key of Object.keys(event.clockDeltaMsByLane)) {
      const lane = Number(key);
      event.clockDeltaMsByLane[lane] = Math.round(event.clockDeltaMsByLane[lane] * k);
    }
    /* The warning and the reveal are on the room's clock, not the race's:
       they keep their full length whatever the fit did. */
    event.warningAtMs = Math.max(0, at - TWIST_WARNING_MS);
    event.revealAtMs = Math.max(event.warningAtMs + 1, at - TWIST_REVEAL_MS);
    event.commentaryAtMs = at + commentaryDelayMs;
  }
}

/** How long a twist's caption is on air and being read, from its hit. */
export const CAPTION_READ_MS = 3000;

/** Write every twist caption from the running order at its hit. */
function writeCaptions(
  runners: LockedRaceRunner[],
  events: LockedRaceEvent[],
  captions: Map<string, CaptionPlan>,
  names: string[],
  motion: MotionProfile,
  rnd: () => number,
): void {
  for (const event of events) {
    const plan = captions.get(event.id);
    const featured = plan?.featured ?? event.targetLanes[0];
    const ranked = rankedAt(runners, events, event.effectAtMs, motion);
    const nameOf = (lane: number | undefined) => (lane === undefined ? undefined : names[lane]);
    /* The caption stays up for a few seconds while a held snail drops
       places, so its place is quoted only when the board shows that same
       place from the hit until the room has read it; otherwise the line
       names the snail without one. */
    const phraseAt = (at: number) => {
      const order = rankedAt(runners, events, at, motion);
      const rank = order.indexOf(featured);
      return positionPhrase(rank < 0 ? order.length - 1 : rank, order.length);
    };
    const readEnd = Math.min(event.effectAtMs + CAPTION_READ_MS, earliestCrossingOf(runners, events) - 1);
    let pos: string | undefined = phraseAt(event.effectAtMs);
    for (let at = event.effectAtMs + 200; pos && at <= readEnd; at += 200) if (phraseAt(at) !== pos) pos = undefined;

    if (plan?.retirement) {
      event.featuredLane = event.targetLanes[0];
      const name = names[event.targetLanes[0]];
      event.revealText = fitWithNames([plan.retirement.reveal], { a: name });
      event.commentaryText = fitWithNames([plan.retirement.commentary], { a: name });
      continue;
    }

    const targetNames = event.targetLanes.map((lane) => names[lane]);
    if (targetNames.length === 1) {
      event.revealText = fitCaption([
        `${targetNames[0]}: ${event.label}`,
        `${shortName(targetNames[0])}: ${event.label}`,
        `${shortName(targetNames[0], 12)}: ${event.label}`,
      ]);
    } else if (targetNames.length === ranked.length) {
      event.revealText = `${event.label}: the whole field`;
    } else {
      const firstLane = ranked.find((lane) => event.targetLanes.includes(lane)) ?? event.targetLanes[0];
      const first = names[firstLane];
      const others = targetNames.length - 1;
      event.revealText = fitCaption([
        targetNames.length === 2 ? `${event.label}: ${targetNames.join(' and ')}` : '',
        targetNames.length === 2 ? `${event.label}: ${targetNames.map((name) => shortName(name)).join(' and ')}` : '',
        `${event.label}: ${shortName(first)} and ${others} more`,
        `${event.label}: ${targetNames.length} runners`,
      ]);
    }

    const pool = plan?.call ? [plan.call] : plan?.calls ?? [];
    if (!pool.length) {
      event.commentaryText = fitCaption([`${event.label}!`]);
      continue;
    }
    if (pool.some((line) => line.includes('{a}')) && featured !== undefined) event.featuredLane = featured;
    event.commentaryText = composeTwistCaption(pool, event.label, {
      a: nameOf(featured),
      b: nameOf(plan?.partner),
      pos,
    }, rnd);
  }
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
  dealtCards: readonly string[] = [],
): LockedRacePlan {
  if (!validLockedRaceFieldSize(names.length)) {
    throw new RangeError(
      `The consequential race requires ${MIN_LOCKED_RACE_FIELD_SIZE} to ${MAX_LOCKED_RACE_FIELD_SIZE} runners.`,
    );
  }
  if (!Number.isFinite(durationMs) || durationMs < 1000) {
    throw new RangeError('Race duration must be at least 1000ms.');
  }

  /* The seeded cast: a uniform shuffle gives every lane the same chance of
     the quickest base time, and nothing below looks at a lane's number. */
  const source = drawRace(seed, names, durationMs, false, intensity);
  const motion: MotionProfile = 'lively';
  const commentaryDelayMs = Math.max(1, Math.min(250, Math.round(durationMs * 0.015)));
  const castRunners = (): LockedRaceRunner[] => source.snails.map((snail) => ({
    lane: snail.lane,
    name: snail.name,
    baseFinishMs: Math.round(snail.T),
    A: snail.A,
    w1: snail.w1,
    w2: snail.w2,
    ph1: snail.ph1,
    ph2: snail.ph2,
  }));

  /*
   * Twists move the finish: a held leader crosses late, a boosted chaser
   * early. The whole race is therefore fitted to its set length at the end
   * (every clock scaled together, which cannot change who crosses first).
   * A deal that would need more than a few per cent of fit is redrawn
   * first, so the spacing between stories survives the fit. The redraw
   * looks only at the finish time, never at who wins, so every lane keeps
   * exactly the same chance.
   */
  const fits = (stop: number): number => {
    const ratio = stop / durationMs;
    return Math.max(0, FIT_RATIO.from - ratio, ratio - FIT_RATIO.to);
  };
  let best: { runners: LockedRaceRunner[]; build: TwistBuild; error: number } | null = null;
  for (let attempt = 0; attempt < 8 && surprises; attempt++) {
    const runners = castRunners();
    let build = planTwists({
      seed, attempt, names, durationMs, intensity, runners, motion, dealtCards, allowPost: true, commentaryDelayMs,
    });
    if (!build.complete) {
      build = planTwists({
        seed, attempt, names, durationMs, intensity, runners, motion, dealtCards, allowPost: false, commentaryDelayMs,
      });
    }
    const stop = earliestCrossingOf(runners, build.events);
    const error = fits(stop);
    const better = !best || (build.complete && !best.build.complete) || (build.complete === best.build.complete && error < best.error);
    if (better) best = { runners, build, error };
    if (build.complete && error === 0) break;
  }
  const runners = best?.runners ?? castRunners();
  const events = best?.build.events ?? [];
  const captions = best?.build.captions ?? new Map<string, CaptionPlan>();

  if (events.length) {
    const stop = earliestCrossingOf(runners, events);
    const k = clamp(durationMs / stop, 1 / FIT_RATIO.to, 1 / FIT_RATIO.from);
    scaleRace(runners, events, k, commentaryDelayMs);
  }
  writeCaptions(runners, events, captions, names, motion, mulberry32(seed ^ 0x43415054));

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
      const dp = progressForLockedRunner(b, events, stopAtMs, motion) - progressForLockedRunner(a, events, stopAtMs, motion);
      return dp || (priority.get(a.lane)! - priority.get(b.lane)!);
    });
  const retired = runners
    .filter((runner) => retirementFor(events, runner.lane))
    .sort((a, b) => a.lane - b.lane);
  const classified = [...active, ...retired];
  const results: RaceResult[] = classified.map((runner, index) => {
    const retirement = retirementFor(events, runner.lane);
    const progress = progressForLockedRunner(runner, events, stopAtMs, motion);
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
    motion,
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
        motion: plan.motion,
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
      let p = progressForLockedRunner(runner, s.lockedMotion.events, raceT, s.lockedMotion.motion);
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
    '{a} with the tidy start, and {b} is right there with it.',
    '{a} leads them out. {b} tucked in nicely behind.',
    '{a} has the rail early. {b} is sniffing around.',
    'Clean getaway for {a}. Long way to go, mind.',
    '{a} sets the pace. {b} is not impressed one bit.',
  ],
  mid: [
    '{a} looks settled up front. That never lasts out here.',
    '{a} and {b} are making a proper race of it now!',
    '{a} holds the front, {b} just waiting for a slip.',
    'Halfway home, and {a} has {b} for company.',
    '{a} holds the front. Can {b} find another gear?',
  ],
  late: [
    '{a} can see the line! {b} is throwing everything at it!',
    '{a} needs every millimetre of that lead now!',
    '{a} can see the line, and the room is on its feet!',
  ],
} as const;

/**
 * Lines for a situation rather than a stage of the race.
 *
 * `{g}` is the real margin, in lengths, and `{c}` is whoever is third. Every
 * one of them is chosen from a measurement, so none can say something the
 * picture does not show.
 */
export const MARGIN_LINES = [
  '{a} leads by {g}, and {b} is hanging in there.',
  '{a} by {g} from {b}, with {c} in third.',
  '{a} still in front, {g} up on {b}.',
  '{a} from {b} by {g}. Lovely stuff.',
  '{b} is chasing hard, {g} back from {a}.',
] as const;

/** Only when the top two are inside 0.3 seconds of each other. */
export const TIGHT_LINES = [
  'You could throw a blanket over {a} and {b}!',
  'Nothing in it! {a} and {b}, shell for shell!',
  '{a} and {b}, side by side! Neither giving an inch!',
  '{g} in it between {a} and {b}! Cannot split them!',
  'Side by side, {a} and {b}! This is a cracker!',
] as const;

export const CLEAR_LINES = [
  '{a} has broken the elastic! {g} clear!',
  '{a} is gone. {b} is racing for second now.',
  'Look at that, {a} has put {g} on the field!',
  '{b} will need a miracle to reel in {a} from here.',
  '{a} is {g} clear! Somebody wake {b} up!',
] as const;

/** Kept for the archive; the caller no longer talks about the back of the field. */
export const BACK_MARKER_LINES = [
  '{d} is last and appears to be taking in the scenery.',
  '{d} is running a private event at the back. Good luck to it.',
  '{d} has work to do and no visible urgency about doing it.',
] as const;

/** A runner moving into the top three. Said by name, with the place. */
export const OVERTAKE_LINES = [
  '{a} goes past {b} and into {n}!',
  'Lovely move! {a} goes past {b} for {n}!',
  '{a} takes {n} off {b} and does not look back!',
  'Cheeky! {a} goes past {b}, up into {n}!',
  '{a} is up to {n}, past {b}!',
] as const;

/** The last stretch, quoted in distance rather than in adjectives. */
export const RUN_HOME_LINES = [
  '{m} to run and it is {a} by {g}! Come on!',
  'Inside the last {m}! {a}, with {b} breathing down its shell!',
  '{m} left, {b} is {g} behind {a} and closing!',
  'Turns for home! {a} by {g}, {m} to go!',
] as const;

/**
 * What the caller says in the beat after a surprise, instead of going
 * straight back to the run of play. It is the difference between a caller
 * and a list of events.
 */
export const REACTION_LINES = {
  good: [
    'Oh, look at that!',
    'Where on earth did that come from?',
    'The crowd loved that one!',
    'Well, that changes things!',
    'Go on, little one!',
  ],
  bad: [
    'Oh no! Poor thing!',
    'That has got to hurt.',
    'Not the timing you want, is it?',
    'Ouch. Right in the slime.',
    'You have to feel for that one.',
  ],
  wild: [
    'Well, I did not see that coming!',
    'What is going on out there?',
    'Absolute chaos, and I love it!',
    `Only at ${CLUB.place}!`,
    'The stewards will want a look at that!',
  ],
} as const;

/** Every lap of a circuit: "Lap 2 of 4". {n} is the lap being started, {t} the total. */
export const LAP_LINES = [
  'Lap {n} of {t}, {a} leads {b}.',
  'Lap {n} of {t}, and it is {a} from {b}.',
  'Into lap {n} of {t}, {a} in front of {b}.',
] as const;

/** The last lap of a race of two or more. */
export const BELL_LAP_LINES = [
  'Final lap! {a} leads {b}!',
  'Final lap! {a} in front, {b} chasing!',
  'Final lap, and it is {a} from {b}!',
] as const;

/** Called when the leader changes hands. The loudest line in the book. */
export const LEAD_CHANGE_LINES = [
  'And {a} hits the front! {b} had no answer!',
  '{a} takes the lead! Sorry {b}, not tonight!',
  'New leader! {a} snatches it from {b}!',
  '{a} sweeps around {b} and hits the front!',
  'Here comes {a}! Takes the lead off {b}!',
  'Look at {a} go! New leader, and {b} is rattled!',
] as const;

/**
 * Quarter, half and three-quarter marks, so a long race keeps its shape.
 * Which line is said depends on the live gap between the top two: these are
 * for a gap of a length or two; `SECTOR_TIGHT_LINES` and `SECTOR_CLEAR_LINES`
 * cover the rest.
 */
export const SECTOR_LINES: Record<number, string> = {
  1: 'A quarter gone, {a} leads {b} by {g}.',
  2: 'Halfway, {a} leads {b} by {g}.',
  3: 'Three-quarter mark, {a} leads {b} by {g}.',
};
export const SECTOR_TIGHT_LINES: Record<number, string> = {
  1: 'A quarter gone, and {a} and {b} are locked together.',
  2: 'Halfway, and {a} and {b} are side by side!',
  3: 'Three-quarter mark, {a} and {b} together!',
};
export const SECTOR_CLEAR_LINES: Record<number, string> = {
  1: 'A quarter gone, {a} is {g} clear of {b}.',
  2: 'Halfway, and {a} is {g} clear of {b}.',
  3: 'Three-quarter mark, {a} is {g} clear!',
};

/** Before the gates: the starter's line and the conditions, varied race to race. */
export const STARTER_LINES = [
  "Under starter's orders.",
  "They are under starter's orders.",
  'Under orders, and the gates are set.',
  'The starter has them under orders.',
  "All in line, under starter's orders.",
] as const;

export const WEATHER_LINES: Record<Weather, readonly string[]> = {
  clear: ['Perfect conditions tonight.', 'A clear night and a fast track.', 'Not a breath of wind out there.', 'Track is lovely and slimy tonight.', 'Deep breaths, everyone.'],
  drizzle: ['Drizzle about, and a greasy track.', 'Light rain, so mind the slime.', 'It is damp out there tonight.'],
  downpour: ['They are racing in a downpour!', 'Rain is bucketing down out there!', 'Wet tonight, slime everywhere!'],
};

export type CommentaryRandom = () => number;

const pick = <T>(pool: readonly T[], rnd: CommentaryRandom = Math.random): T =>
  pool[Math.floor(rnd() * pool.length)];

/**
 * The countdown line: the starter and the conditions. Never the same line
 * twice running, so a night of ten races does not open ten times alike.
 */
export function countdownLine(weather: Weather, rnd: CommentaryRandom = Math.random, previous?: string): string {
  const conditions = WEATHER_LINES[weather] ?? WEATHER_LINES.clear;
  for (let tries = 0; tries < 12; tries++) {
    const line = `${pick(STARTER_LINES, rnd)} ${pick(conditions, rnd)}`;
    if (line !== previous) return line;
  }
  const line = `${STARTER_LINES[0]} ${conditions[0]}`;
  return line === previous ? `${STARTER_LINES[1]} ${conditions[0]}` : line;
}

/**
 * How long a snail is, as a fraction of one lap.
 *
 * The margins a broadcast quotes are in lengths, not in percentages, and a
 * length is a real distance on this track: a lap is 4,000 world units and a
 * snail is about 170 of them, so a lap is roughly twenty-three and a half of
 * them nose to tail.
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

/** "Together" and "going to the line" are only ever said under this gap. */
export const TOGETHER_SECONDS = 0.3;

/* ── Per-track wording ──────────────────────────────────────────────── */

/**
 * The words that belong to a course. The side-on straight and the oval have
 * a straight before the line; the chicane, the figure eight and the
 * switchback do not, and the caller never says one is there.
 */
export type TrackWording = 'straight' | 'oval' | 'chicane' | 'eight' | 'switchback';

export function trackWording(trackShape: 'lanes' | 'circuit' | undefined, courseId?: string): TrackWording {
  if (trackShape !== 'circuit') return 'straight';
  if (courseId === 'pavilion-chicane') return 'chicane';
  if (courseId === 'floodlight-eight') return 'eight';
  if (courseId === 'practice-nets') return 'switchback';
  return 'oval';
}

export const hasHomeStraight = (wording: TrackWording): boolean => wording === 'straight' || wording === 'oval';

export const RUN_HOME_BY_TRACK: Record<TrackWording, readonly string[]> = {
  straight: ['Here they come down the straight! {a} from {b}!', 'Into the straight, and it is {a} from {b}!', 'Down the straight they come! {a} hanging on, {b} coming!'],
  oval: ['Into the home straight! {a} from {b}!', 'Here they come down the home straight! {a} leads {b}!'],
  chicane: ['Into the last bend! {a} from {b}!', 'Through the last bend and home! {a} leads {b}!'],
  eight: ['Home stretch! {a} from {b}!', 'Off the crossover and into the home stretch! {a} leads {b}!'],
  switchback: ['Through the last turn and to the line! {a} from {b}!', 'Home stretch! {a} leads {b} to the line!'],
};

/** The recorded run-home call that suits the course: no "straight" where there is none. */
export const runHomeCue = (wording: TrackWording): 'final' | 'finalCircuit' =>
  hasHomeStraight(wording) ? 'final' : 'finalCircuit';

const fill = (line: string, a: string, b: string, c = ''): string =>
  line.replace(/\{a\}/g, a).replace(/\{b\}/g, b).replace(/\{c\}/g, c);

/** Fill a two-name line and keep it on one strap: full names, then short, then shorter. */
function fitPair(lines: readonly string[], a: string, b: string, extra: (line: string) => string = (line) => line): string {
  const variants: string[] = [];
  for (const [x, y] of [[a, b], [shortName(a), shortName(b)], [shortName(a, 12), shortName(b, 12)]]) {
    for (const line of lines) variants.push(extra(fill(line, x, y)));
  }
  return fitCaption(variants);
}

/** Lines starting with the drawn one, then the rest of its pool. */
function rotate<T>(pool: readonly T[], rnd: CommentaryRandom): T[] {
  const start = Math.floor(rnd() * pool.length);
  return [...pool.slice(start), ...pool.slice(0, start)];
}

export function runHomeLine(wording: TrackWording, a: string, b: string, rnd: CommentaryRandom = Math.random): string {
  return fitPair(rotate(RUN_HOME_BY_TRACK[wording], rnd), a, b);
}

/** Two of them inside {@link TOGETHER_SECONDS} with the line in sight. */
export function togetherLine(a: string, b: string, rnd: CommentaryRandom = Math.random): string {
  return fitPair(rotate(['{a} and {b} together, this is going to the line!', 'Nothing between {a} and {b} and the line is coming!'], rnd), a, b);
}

/** The winner, and how close it was. */
export function winnerLine(name: string, onTheLine: boolean): string {
  return fitCaption([
    `${name} ${onTheLine ? 'wins it on the line! What a finish!' : 'wins! Take a bow!'}`,
    `${name} ${onTheLine ? 'wins it on the line!' : 'wins!'}`,
    `${shortName(name)} ${onTheLine ? 'wins it on the line!' : 'wins!'}`,
  ]);
}

/** What the caller can see, so it can talk about that rather than the clock. */
export interface CallContext {
  leadP: number;
  lead: string;
  chase: string;
  /** Third place, for the lines that mention it. */
  third: string;
  /** Whoever is last. Kept for old callers; never called any more. */
  tail: string;
  /** The real margin between first and second, in lengths. */
  gapLengths: number;
  /** How far the leader has left, in lengths. */
  toGoLengths: number;
  /** The margin between first and second in seconds; "together" needs under 0.3. */
  gapSeconds?: number;
}

/**
 * Pick a run-of-play line for what is actually happening.
 *
 * Every branch here is driven by a measurement off the track: the margin in
 * lengths and seconds, the distance left to run, who is actually third.
 */
export function callLine(ctx: CallContext, rnd: CommentaryRandom = Math.random): string {
  const g = lengthPhrase(ctx.gapLengths);
  const together = (ctx.gapSeconds ?? (ctx.gapLengths < 0.6 ? 0 : 1)) < TOGETHER_SECONDS;
  const say = (pool: readonly string[]) => {
    const lines = rotate(pool, rnd);
    const variants: string[] = [];
    for (const [a, b, c] of [
      [ctx.lead, ctx.chase, ctx.third],
      [shortName(ctx.lead), shortName(ctx.chase), shortName(ctx.third)],
      [shortName(ctx.lead, 12), shortName(ctx.chase, 12), shortName(ctx.third, 12)],
    ]) {
      for (const line of lines) {
        variants.push(fill(line, a, b, c).replace('{g}', g).replace('{m}', lengthPhrase(ctx.toGoLengths)));
      }
    }
    return fitCaption(variants);
  };

  if (ctx.leadP > 0.86) return say(RUN_HOME_LINES);
  if (together && ctx.leadP > 0.15) return say(TIGHT_LINES);
  if (ctx.gapLengths > 4 && ctx.leadP > 0.3) return say(CLEAR_LINES);
  if (ctx.leadP < 0.3 && rnd() < 0.4) return say(COMMENTARY.early);
  /* Otherwise quote the margin, which is what a race caller does most of the time. */
  return say(MARGIN_LINES);
}

/** A snail has actually passed another one into the top three. Said by name, with the place. */
export function overtakeLine(
  mover: string,
  passed: string,
  place: number,
  rnd: CommentaryRandom = Math.random,
): string {
  return fitPair(rotate(OVERTAKE_LINES, rnd), mover, passed, (line) => line.replace('{n}', ordinal(place)));
}

/** The beat after a surprise. Said only if the caller has room for it. */
export const reactionLine = (tone: EventTone, rnd: CommentaryRandom = Math.random): string =>
  pick(REACTION_LINES[tone], rnd);

export function leadChangeLine(
  newLeader: string,
  deposed: string,
  rnd: CommentaryRandom = Math.random,
): string {
  return fitPair(rotate(LEAD_CHANGE_LINES, rnd), newLeader, deposed);
}

/** A sector call, its recorded cue, and which takes of that cue say the same thing. */
export interface SectorCall {
  text: string;
  cue: 'quarter' | 'half' | 'threeQuarter' | 'clear' | 'early' | 'mid';
  takes?: number[];
}

/**
 * The quarter, half or three-quarter call, worded from the live gap so the
 * strap and the clip agree: "locked together" only when they are, "clear"
 * only when the leader is.
 */
export function sectorCall(
  sector: number,
  leadName: string,
  chaserName: string,
  gapLengths: number,
  gapSeconds: number,
  wording: TrackWording = 'straight',
): SectorCall | null {
  if (!SECTOR_LINES[sector]) return null;
  const g = lengthPhrase(gapLengths);
  const withGap = (line: string) => line.replace('{g}', g);
  const cue = sector === 1 ? 'quarter' : sector === 2 ? 'half' : 'threeQuarter';
  if (gapSeconds < TOGETHER_SECONDS || gapLengths < 0.6) {
    /* The first three-quarter take says "coming to the turn": not on the straight. */
    const takes = cue === 'threeQuarter' && wording === 'straight' ? [2, 3] : undefined;
    return { text: fitPair([SECTOR_TIGHT_LINES[sector]], leadName, chaserName), cue, takes };
  }
  if (gapLengths >= 2.5) {
    return { text: fitPair([SECTOR_CLEAR_LINES[sector]], leadName, chaserName, withGap), cue: 'clear' };
  }
  return {
    text: fitPair([SECTOR_LINES[sector]], leadName, chaserName, withGap),
    cue: sector === 1 ? 'early' : sector === 2 ? 'mid' : 'threeQuarter',
    takes: sector === 3 ? [3] : undefined,
  };
}

/** The old sector call, text only. */
export function sectorLine(sector: number, leadName: string, chaserName: string, gapLengths = 1, gapSeconds = 1): string | null {
  return sectorCall(sector, leadName, chaserName, gapLengths, gapSeconds)?.text ?? null;
}

/**
 * The call as the leader crosses to start a new lap: "Lap 2 of 4, Turbo
 * leads Rocket." `lap` is the one being started, so the last one is the
 * final lap.
 */
export function lapLine(
  lap: number,
  laps: number,
  a: string,
  b: string,
  rnd: CommentaryRandom = Math.random,
): string {
  const pool = lap === laps ? BELL_LAP_LINES : LAP_LINES;
  return fitPair(rotate(pool, rnd), a, b, (line) => line.replace('{n}', String(lap)).replace('{t}', String(laps)));
}

/** The call for a surprise, e.g. "Gary hits the turbo slime and lunges!". */
export const eventLine = (event: RaceEvent, name: string): string =>
  fitCaption([
    event.call.replace(/\{a\}/g, name),
    event.call.replace(/\{a\}/g, shortName(name)),
    event.call.replace(/\{a\}/g, shortName(name, 12)),
  ]);
