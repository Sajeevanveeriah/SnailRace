import type { RaceMoment } from '@/lib/use-race';

export type SurpriseArtId =
  | 'cricket-ball'
  | 'sprinkler'
  | 'pitch-roller'
  | 'club-dog'
  | 'lettuce-crate'
  | 'magpie'
  | 'groundskeeper-boot'
  | 'boundary-bee'
  | 'plague-cloud';

export interface SurprisePresentation {
  art: SurpriseArtId | null;
  symbol: string;
  cue: 'roll' | 'spray' | 'cross' | 'dash' | 'drop' | 'swoop' | 'burst';
}

interface PresentableMoment extends RaceMoment {
  /** Newer engines provide structured presentation data; older archives do not. */
  label?: string;
  kind?: string;
}

const PRESENTATIONS: ReadonlyArray<{
  matches: readonly string[];
  value: SurprisePresentation;
}> = [
  { matches: ['CRICKET BALL'], value: { art: 'cricket-ball', symbol: '●', cue: 'roll' } },
  { matches: ['SPRINKLER'], value: { art: 'sprinkler', symbol: '💦', cue: 'spray' } },
  { matches: ['PITCH ROLLER'], value: { art: 'pitch-roller', symbol: '⚙', cue: 'cross' } },
  { matches: ['DOG ON THE TRACK', 'CLUB DOG'], value: { art: 'club-dog', symbol: '🐕', cue: 'dash' } },
  { matches: ['LETTUCE'], value: { art: 'lettuce-crate', symbol: '🥬', cue: 'drop' } },
  { matches: ['MAGPIE', 'SWOOP'], value: { art: 'magpie', symbol: '🐦', cue: 'swoop' } },
  { matches: ['GROUNDSKEEPER'], value: { art: 'groundskeeper-boot', symbol: '🥾', cue: 'cross' } },
  { matches: ['BOUNDARY BEE'], value: { art: 'boundary-bee', symbol: '🐝', cue: 'swoop' } },
  { matches: ['PLAGUE'], value: { art: 'plague-cloud', symbol: '☣', cue: 'burst' } },
  { matches: ['BANANA'], value: { art: null, symbol: '🍌', cue: 'drop' } },
  { matches: ['ESPRESSO'], value: { art: null, symbol: '☕', cue: 'burst' } },
  { matches: ['MICRO-NAP', 'STAGE FRIGHT'], value: { art: null, symbol: '💤', cue: 'drop' } },
  { matches: ['SNAIL MAIL'], value: { art: null, symbol: '✉', cue: 'drop' } },
  { matches: ['WRONG WAY'], value: { art: null, symbol: '↩', cue: 'cross' } },
  { matches: ['SNAIL ROMANCE'], value: { art: null, symbol: '♥', cue: 'burst' } },
  { matches: ['THIRD UMPIRE'], value: { art: null, symbol: '☝', cue: 'burst' } },
  { matches: ['SLEDGED', 'CROWD LIFT'], value: { art: null, symbol: '📣', cue: 'burst' } },
  { matches: ['SHELL SWAP'], value: { art: null, symbol: '⇄', cue: 'cross' } },
  { matches: ['TURBO', 'SECOND WIND', 'SLIPSTREAM', 'DOWNHILL', 'FRESH WAX'], value: { art: null, symbol: '⚡', cue: 'burst' } },
  { matches: ['SHELL SLIP', 'GRAVEL', 'CRAMP', 'BOGGED'], value: { art: null, symbol: '⚠', cue: 'drop' } },
  { matches: ['MYSTERY SLIME'], value: { art: null, symbol: '◉', cue: 'burst' } },
  { matches: ['FALSE START'], value: { art: null, symbol: '✋', cue: 'burst' } },
];

/**
 * Prefer structured labels when the engine supplies them, then fall back to
 * the archived commentary text. The result is presentation-only and cannot
 * affect race geometry or settlement.
 */
export function presentationForMoment(moment: RaceMoment | null): SurprisePresentation | null {
  if (!moment) return null;
  const presentable = moment as PresentableMoment;
  const haystack = `${presentable.kind ?? ''} ${presentable.label ?? ''} ${moment.text}`.toUpperCase();
  return PRESENTATIONS.find((entry) => entry.matches.some((term) => haystack.includes(term)))?.value ?? {
    art: null,
    symbol: '!',
    cue: moment.big ? 'burst' : 'drop',
  };
}
