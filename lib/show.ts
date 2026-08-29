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
  { id: 'racecard', label: 'Racecard', screen: 'RACECARD', advance: 'Open the fun-chip market' },
  { id: 'market', label: 'Market open', screen: 'MARKET OPEN', advance: 'Lock and race' },
  { id: 'race', label: 'Race', screen: 'RACE', advance: 'Start the race' },
  { id: 'results', label: 'Results', screen: 'RESULT', advance: 'Show the championship' },
  { id: 'championship', label: 'Championship', screen: 'CHAMPIONSHIP', advance: 'Next race' },
  { id: 'intermission', label: 'Intermission', screen: 'INTERMISSION', advance: 'Back to racing' },
  { id: 'finale', label: 'Finale', screen: 'THANK YOU', advance: 'End of night' },
];

export const showPhaseSpec = (id: ShowPhase): ShowPhaseSpec =>
  SHOW_PHASES.find((p) => p.id === id) ?? SHOW_PHASES[0];

export interface ShowContext {
  racesRun: number;
  plannedRaces: number;
}

/**
 * Where the forward button goes. The loop is
 * racecard, market, race, results, championship, then racecard again until
 * the card is complete, then finale. Intermission is a moderator choice,
 * never forced into the loop.
 */
export function nextShowPhase(current: ShowPhase, ctx: ShowContext): ShowPhase {
  switch (current) {
    case 'lobby':
      return 'racecard';
    case 'racecard':
      return 'market';
    case 'market':
      return 'race';
    case 'race':
      return 'results';
    case 'results':
      return 'championship';
    case 'championship':
    case 'intermission':
      return ctx.racesRun >= ctx.plannedRaces ? 'finale' : 'racecard';
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

const pick = <T,>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)];

/**
 * What the caller says as each segment opens. One line per advance, so the
 * host has a voice without becoming noise; the race itself keeps the richer
 * live commentary it already has. Every line describes actual event state.
 */
export function hostLineFor(phase: ShowPhase, ctx: HostContext): string {
  switch (phase) {
    case 'lobby':
      return `Welcome to ${ctx.eventName}, racing for ${ctx.clubName}. Find a seat, the first field is nearly ready.`;
    case 'racecard':
      return ctx.raceNo === 1
        ? `Tonight's card: ${ctx.plannedRaces} races. Remember, the chips are fun chips with no monetary value, every snail has an equal chance, and every dollar donated goes straight to the club.`
        : `Here is the field for race ${ctx.raceNo} of ${ctx.plannedRaces}${ctx.sponsor ? `, proudly sponsored by ${ctx.sponsor}` : ''}.`;
    case 'market':
      return pick([
        `The fun-chip market is open for race ${ctx.raceNo}. Get your chips on - they are worth nothing and that is the point.`,
        `Chips in for race ${ctx.raceNo}! The market closes at the gate.`,
      ]);
    case 'race':
      return `They are heading to the gate for race ${ctx.raceNo}. Last chips now - the market locks when the lights go.`;
    case 'results':
      return 'And that is the result, drawn before a single snail moved. Settling the fun chips now.';
    case 'championship':
      return ctx.leaderName
        ? `After ${ctx.raceNo} ${ctx.raceNo === 1 ? 'race' : 'races'}, ${ctx.leaderName} leads the championship.`
        : 'Here is how the championship stands.';
    case 'intermission':
      return 'Time for a short break. Stretch the legs, back the club at the bar, and we race again shortly.';
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
