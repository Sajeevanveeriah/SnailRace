import type { ShowPhase, SurpriseIntensity } from './types';

/** The countdown before the off: four beats of 900 ms (3, 2, 1, GO). */
export const COUNTDOWN_MS = 3600;
/** The line is held while the field runs in before the result stands. */
export const RUN_IN_MS = 2500;

/**
 * The run of show.
 *
 * A race night is a sequence a volunteer steps through with one button, not a
 * settings page they navigate. Each phase is a projector screen; the forward
 * key advances; `race` hands over to the existing race lifecycle and comes
 * back through `results`. The order below is the night Fundeo-style products
 * taught rooms to expect, rebuilt with entirely original NDCC presentation.
 */

export interface ShowPhaseSpec {
  id: ShowPhase;
  /** Console label. */
  label: string;
  /** What the projector's phase strip calls it. */
  screen: string;
  /** What the forward button offers next from here. */
  advance: string;
}

export const SHOW_PHASES: ShowPhaseSpec[] = [
  { id: 'lobby', label: 'Doors open', screen: 'WELCOME', advance: 'Show the racecard' },
  { id: 'racecard', label: 'Racecard', screen: 'RACECARD', advance: 'To the gate' },
  { id: 'race', label: 'Race', screen: 'RACE', advance: 'Start the race' },
  { id: 'results', label: 'Results', screen: 'RESULT', advance: 'Next' },
  { id: 'championship', label: 'Quaddie', screen: 'QUADDIE', advance: 'Next race' },
  { id: 'finale', label: 'Finale', screen: 'THANK YOU', advance: 'Night complete' },
  /* Retired screens. Kept so an older saved night still names its phase. */
  { id: 'market', label: 'Market', screen: 'RACECARD', advance: 'To the gate' },
  { id: 'intermission', label: 'Intermission', screen: 'WELCOME', advance: 'Show the racecard' },
];

export const showPhaseSpec = (id: ShowPhase): ShowPhaseSpec =>
  SHOW_PHASES.find((p) => p.id === id) ?? SHOW_PHASES[0];

export interface ShowContext {
  racesRun: number;
  plannedRaces: number;
  /** The quaddie board is shown after a result only while the quaddie is live. */
  quaddieLive?: boolean;
  /**
   * The race the gate would arm next, from `nextRaceNumber`. When it is past
   * the run sheet the card is complete, however the counts came about.
   */
  nextRaceNo?: number;
}

/** The card is complete: every race on the run sheet has run. */
export const cardComplete = (ctx: ShowContext): boolean =>
  ctx.racesRun >= ctx.plannedRaces || (ctx.nextRaceNo !== undefined && ctx.nextRaceNo > ctx.plannedRaces);

/**
 * The race the show arms next: one past the latest race that stands. The
 * stored race number normally says the same, but a run sheet shrunk below
 * the races already run, or a backup from mid-night, must never put a race
 * that is already in the history back on the racecard or at the gate.
 */
export function nextRaceNumber(raceNumber: number, history: readonly { raceNo: number; void?: boolean }[]): number {
  let last = Math.max(0, raceNumber);
  for (const entry of history) if (!entry.void && entry.raceNo > last) last = entry.raceNo;
  return last + 1;
}

/** Whether a race number already stands in the history (a void does not count). */
export const raceHasRun = (raceNo: number, history: readonly { raceNo: number; void?: boolean }[]): boolean =>
  history.some((entry) => !entry.void && entry.raceNo === raceNo);

/**
 * Where the forward button goes. The loop is racecard, race, results, then
 * the quaddie board when one is running, then racecard again until the card
 * is complete, then finale. There is no market screen: a snail is bought
 * before the night, not picked between races. A racecard or gate left up
 * after the card is complete goes to the finale too, never to a race that
 * has already run.
 */
export function nextShowPhase(current: ShowPhase, ctx: ShowContext): ShowPhase {
  const afterResult = (): ShowPhase => (cardComplete(ctx) ? 'finale' : 'racecard');
  switch (current) {
    case 'lobby':
    case 'intermission':
      return 'racecard';
    case 'racecard':
    case 'market':
      return cardComplete(ctx) ? 'finale' : 'race';
    case 'race':
      return 'results';
    case 'results':
      return ctx.quaddieLive ? 'championship' : afterResult();
    case 'championship':
      return afterResult();
    case 'finale':
      return 'finale';
  }
}

/** What the forward button offers from here, given where it would go. */
export function advanceLabel(current: ShowPhase, ctx: ShowContext): string {
  const next = nextShowPhase(current, ctx);
  if (current === 'finale') return showPhaseSpec('finale').advance;
  if (next === 'finale' && current !== 'results' && current !== 'championship') return 'To the thank you screen';
  return showPhaseSpec(current).advance;
}

/* ── An armed race after a reload ──────────────────────────────────────── */

export interface ArmedRaceClock {
  lockedAt: number;
  startedAt: number;
  plan: { stopAtMs: number };
}

export type InterruptedRace =
  /** Locked but never started: a Phone Play lock still pending, or a reload between the lock and the off. */
  | { kind: 'armed' }
  /** Started, and the room was watching it when the page went: it restarts from the gate. */
  | { kind: 'interrupted'; raceTimeMs: number }
  /** Started so long ago that its result stood before the page came back: record it. */
  | { kind: 'finished'; raceTimeMs: number };

/**
 * What a held race plan found at load means for the show. The plan is
 * deterministic: everything the race does is drawn before the off, so a
 * race the page lost can be judged from the wall clock alone. `startedAt`
 * is written at the off and is strictly after `lockedAt`; equal means the
 * race never left the gate.
 */
export function interruptedRace(held: ArmedRaceClock, now: number): InterruptedRace {
  if (held.startedAt <= held.lockedAt) return { kind: 'armed' };
  const raceTimeMs = now - held.startedAt - COUNTDOWN_MS;
  if (raceTimeMs >= held.plan.stopAtMs + RUN_IN_MS) return { kind: 'finished', raceTimeMs };
  return { kind: 'interrupted', raceTimeMs: Math.max(0, raceTimeMs) };
}

/** The line the gate shows for a held race, in the room's words unless a Phone Play room is attached. */
export function heldRaceLine(raceNo: number, verdict: InterruptedRace['kind'], phonePlay: boolean): string {
  if (phonePlay) return 'Recovered the exact held race plan. Selections stay closed; retry the same Phone Play lock without redrawing.';
  if (verdict === 'armed') return `Race ${raceNo} is ready. Start it.`;
  return `Race ${raceNo} was interrupted. Start it again.`;
}

/* ── The host's structured segments ────────────────────────────────────── */

export interface HostContext {
  clubName: string;
  eventName: string;
  raceNo: number;
  plannedRaces: number;
  sponsor?: string;
  leaderName?: string;
  intensity: SurpriseIntensity;
}

const pickFor = <T,>(pool: readonly T[], key: string): T => {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return pool[(hash >>> 0) % pool.length];
};

/**
 * What the caller says as each segment opens. One line per advance, so the
 * host has a voice without becoming noise; the race itself keeps the richer
 * live commentary it already has. Every line describes actual event state.
 */
export function hostLineFor(phase: ShowPhase, ctx: HostContext): string {
  switch (phase) {
    case 'lobby':
      return `Welcome to ${ctx.eventName}. Settle in - the first field for ${ctx.clubName} is nearly ready.`;
    case 'racecard':
    case 'market':
      return ctx.raceNo === 1
        ? `Tonight's card: ${ctx.plannedRaces} races, every snail named by the person who bought it. Every snail has an equal chance.`
        : `Here is the field for race ${ctx.raceNo} of ${ctx.plannedRaces}${ctx.sponsor ? `, proudly sponsored by ${ctx.sponsor}` : ''}.`;
    case 'race':
      return pickFor(
        [
          `The field is heading to the gate for race ${ctx.raceNo}. Find your snail and get behind it.`,
          `Race ${ctx.raceNo}. Every snail has an owner and only one wins. Cheer yours home.`,
          `They are coming out for race ${ctx.raceNo}. Owners, this is your moment.`,
        ],
        `${ctx.eventName}:${ctx.raceNo}:race`,
      );
    case 'results':
      return 'And that is the result, drawn before a single snail moved.';
    case 'championship':
      return 'Here is how the quaddie stands after that leg.';
    case 'intermission':
      return 'Time for a short break. Stretch the legs, support the club if you can, and we race again shortly.';
    case 'finale':
      return `That is the card complete. Thank you for racing with ${ctx.clubName} - every dollar tonight goes to the club. Safe travels home.`;
  }
}

/** Market countdown warnings, called by the timer as the lock approaches. */
export function marketWarning(secondsLeft: 30 | 10 | 5): string {
  switch (secondsLeft) {
    case 30:
      return 'Thirty seconds on the fun-chip market!';
    case 10:
      return 'Ten seconds! Final chips!';
    case 5:
      return 'Five seconds - the market is closing!';
  }
}
