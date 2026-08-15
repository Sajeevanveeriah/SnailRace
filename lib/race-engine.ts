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
 *   3. Position is p(t) = base(u) + sin(pi*u)*A*noise + soft(u)*events(u),
 *      u = t/T[i]. Both drama terms carry an envelope that is exactly 0 at
 *      u=1, so p(T[i]) = 1 exactly, and a ceiling clamp keeps p < 1 for every
 *      u < 1. No snail can arrive early or late no matter what the wobble or
 *      the surprises do.
 *   4. Therefore arrival order == shuffle order, and every lane wins with
 *      probability exactly 1/N.
 *
 * The turbo boosts, shell slips and naps added in `drawEvents` are drawn from
 * the same seeded stream AFTER the shuffle has already been taken, so they
 * are replayable, they are visible in the printed seed, and they cannot
 * reorder a field that was decided before they were generated.
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

/* ── In-race surprises ─────────────────────────────────────────────────── */

export type RaceEventKind = 'boost' | 'surge' | 'stumble' | 'nap' | 'wander';

export type EventTone = 'good' | 'bad';

/**
 * One kind of surprise, and the range it is drawn from.
 *
 * `mag` is a displacement in progress units at the peak of the event: positive
 * lunges the snail forward, negative holds it up. `from`/`to` bound where in
 * the lane the event may start, which is what stops a nap being drawn two
 * metres from the line where the crowd would read it as a bug.
 */
export interface EventSpec {
  kind: RaceEventKind;
  /** Shown on the track as the event lands. */
  label: string;
  /** Commentary line; {a} is the snail it happened to. */
  call: string;
  tone: EventTone;
  magFrom: number;
  magTo: number;
  spanFrom: number;
  spanTo: number;
  from: number;
  to: number;
}

export const EVENT_SPECS: EventSpec[] = [
  {
    kind: 'boost',
    label: 'TURBO SLIME',
    call: '{a} hits the turbo slime and LUNGES!',
    tone: 'good',
    magFrom: 0.055, magTo: 0.095,
    spanFrom: 0.1, spanTo: 0.18,
    from: 0.1, to: 0.62,
  },
  {
    kind: 'surge',
    label: 'SECOND WIND',
    call: '{a} finds a second wind and is flying home!',
    tone: 'good',
    magFrom: 0.07, magTo: 0.125,
    spanFrom: 0.12, spanTo: 0.22,
    from: 0.5, to: 0.86,
  },
  {
    kind: 'stumble',
    label: 'SHELL SLIP',
    call: '{a} slips on the shell and loses ground!',
    tone: 'bad',
    magFrom: -0.085, magTo: -0.045,
    spanFrom: 0.08, spanTo: 0.14,
    from: 0.14, to: 0.8,
  },
  {
    kind: 'nap',
    label: 'MICRO-NAP',
    call: '{a} has stopped for a nap - you would not read about it!',
    tone: 'bad',
    magFrom: -0.135, magTo: -0.085,
    spanFrom: 0.14, spanTo: 0.24,
    from: 0.18, to: 0.7,
  },
  {
    kind: 'wander',
    label: 'LETTUCE BREAK',
    call: '{a} has spotted a lettuce leaf and wandered wide!',
    tone: 'bad',
    magFrom: -0.075, magTo: -0.04,
    spanFrom: 0.1, spanTo: 0.18,
    from: 0.16, to: 0.75,
  },
];

export interface RaceEvent {
  /** Stable within one race, so React can key on it. */
  id: string;
  lane: number;
  kind: RaceEventKind;
  label: string;
  call: string;
  tone: EventTone;
  /** Progress along the lane at which it starts, 0 to 1. */
  at: number;
  /** How much of the lane it covers. */
  span: number;
  /** Peak displacement in progress units. Signed. */
  mag: number;
  fired: boolean;
}

/** How many surprises a race of this length carries. */
export function eventBudget(durationMs: number, fieldSize: number): number {
  const byLength = Math.round((durationMs / 1000) * 0.34);
  return Math.max(2, Math.min(12, byLength, fieldSize * 2));
}

/**
 * Deal the surprises.
 *
 * Called only after the finishing order and the finish times have been taken
 * from `rnd`, so nothing here can move a snail's arrival - see the module
 * header. Two events on one lane are kept clear of each other, because
 * overlapping windows read on the projector as one long shapeless drift
 * rather than as two things happening.
 */
export function drawEvents(
  rnd: () => number,
  fieldSize: number,
  durationMs: number,
): RaceEvent[] {
  const target = eventBudget(durationMs, fieldSize);
  const events: RaceEvent[] = [];
  const perLane = new Map<number, RaceEvent[]>();

  /* Bounded: a crowded field can refuse placements, and the race still runs. */
  for (let guard = 0; guard < target * 14 && events.length < target; guard++) {
    const spec = EVENT_SPECS[Math.floor(rnd() * EVENT_SPECS.length)];
    const lane = Math.floor(rnd() * fieldSize);
    const span = spec.spanFrom + rnd() * (spec.spanTo - spec.spanFrom);
    const room = Math.max(0.01, spec.to - spec.from - span);
    const at = spec.from + rnd() * room;

    const mine = perLane.get(lane) ?? [];
    const clash = mine.some((e) => at < e.at + e.span + 0.06 && e.at < at + span + 0.06);
    if (clash) continue;

    const event: RaceEvent = {
      id: `fx${events.length}`,
      lane,
      kind: spec.kind,
      label: spec.label,
      call: spec.call,
      tone: spec.tone,
      at,
      span,
      mag: spec.magFrom + rnd() * (spec.magTo - spec.magFrom),
      fired: false,
    };
    events.push(event);
    mine.push(event);
    perLane.set(lane, mine);
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
}

export interface DrawnRace {
  seed: number;
  seedHex: string;
  snails: SnailRun[];
  order: number[];
  photoFinish: boolean;
  /** Every surprise in the race, all lanes, ordered by where it lands. */
  events: RaceEvent[];
  durationMs: number;
  /** Hard stop for the animation loop. */
  tMax: number;
}

export function drawRace(
  seed: number,
  names: string[],
  durationMs: number,
  surprises = true,
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

  const events = surprises ? drawEvents(rnd, n, durationMs) : [];

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
    durationMs,
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
    s.place = ++nextPlace;
    s.finishMs = Math.round(raceT);
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
    '{a} sets the tempo, {b} tucked in behind.',
    'A clean getaway and {a} has the rail.',
    '{b} is already hunting down {a}.',
  ],
  mid: [
    '{a} hits the front!',
    '{b} is reeling in {a}!',
    'Nothing between {a} and {b}!',
    '{a} kicks clear!',
    '{b} finds another gear!',
    '{a} under pressure from {b}!',
    '{a} and {b} are trading blows out there.',
    '{b} has come from nowhere!',
    'The gap is opening for {a}.',
    '{a} looks comfortable - for now.',
  ],
  late: [
    '{a} into the final straight!',
    '{b} is closing fast!',
    'This is going to be tight!',
    '{a} holding on!',
    '{b} charging home!',
    '{a} can see the line!',
    '{b} throws everything at it!',
    'The room is on its feet for {a}!',
    'Two lengths to run and {b} will not give in!',
  ],
} as const;

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

const pick = <T>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)];

const fill = (line: string, a: string, b: string): string =>
  line.replace('{a}', a).replace('{b}', b);

/** Pick a line for the current phase of the race, with the names filled in. */
export function callLine(leadP: number, leadName: string, chaserName: string): string {
  const phase = leadP < 0.3 ? 'early' : leadP < 0.72 ? 'mid' : 'late';
  return fill(pick(COMMENTARY[phase]), leadName, chaserName);
}

export function leadChangeLine(newLeader: string, deposed: string): string {
  return fill(pick(LEAD_CHANGE_LINES), newLeader, deposed);
}

export function sectorLine(sector: number, leadName: string, chaserName: string): string | null {
  const line = SECTOR_LINES[sector];
  return line ? fill(line, leadName, chaserName) : null;
}

/** The call for a surprise, e.g. "Gary hits the turbo slime and LUNGES!". */
export const eventLine = (event: RaceEvent, name: string): string =>
  event.call.replace('{a}', name);
