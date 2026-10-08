import type { ShowPhase, SurpriseIntensity } from './types';

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
  { id: 'finale', label: 'Finale', screen: 'THANK YOU', advance: 'End of night' },
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
}

/**
 * Where the forward button goes. The loop is racecard, race, results, then
 * the quaddie board when one is running, then racecard again until the card
 * is complete, then finale. There is no market screen: a snail is bought
 * before the night, not picked between races.
 */
export function nextShowPhase(current: ShowPhase, ctx: ShowContext): ShowPhase {
  const afterResult = (): ShowPhase => (ctx.racesRun >= ctx.plannedRaces ? 'finale' : 'racecard');
  switch (current) {
    case 'lobby':
    case 'intermission':
      return 'racecard';
    case 'racecard':
    case 'market':
      return 'race';
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
        ? `Tonight's card: ${ctx.plannedRaces} races of ten snails, every one named by the person who bought it. Every snail has an equal chance.`
        : `Here is the field for race ${ctx.raceNo} of ${ctx.plannedRaces}${ctx.sponsor ? `, proudly sponsored by ${ctx.sponsor}` : ''}.`;
    case 'race':
      return pickFor(
        [
          `The field is heading to the gate for race ${ctx.raceNo}. Find your snail and get behind it.`,
          `Race ${ctx.raceNo}. Ten snails, ten owners, one winner. Cheer yours home.`,
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
