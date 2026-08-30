import type { RaceMoment } from '@/lib/use-race';

export type SurpriseArtId =
  | 'cricket-ball'
  | 'sprinkler'
  | 'pitch-roller'
  | 'club-dog'
  | 'lettuce-crate'
  | 'magpie'
  | 'groundskeeper-boot'
  | 'boundary-bee';

export interface SurprisePresentation {
  art: SurpriseArtId | null;
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
  { matches: ['CRICKET BALL'], value: { art: 'cricket-ball', cue: 'roll' } },
  { matches: ['SPRINKLER'], value: { art: 'sprinkler', cue: 'spray' } },
  { matches: ['PITCH ROLLER'], value: { art: 'pitch-roller', cue: 'cross' } },
  { matches: ['DOG ON THE TRACK', 'CLUB DOG'], value: { art: 'club-dog', cue: 'dash' } },
  { matches: ['LETTUCE'], value: { art: 'lettuce-crate', cue: 'drop' } },
  { matches: ['MAGPIE', 'SWOOP'], value: { art: 'magpie', cue: 'swoop' } },
  { matches: ['GROUNDSKEEPER'], value: { art: 'groundskeeper-boot', cue: 'cross' } },
  { matches: ['BOUNDARY BEE'], value: { art: 'boundary-bee', cue: 'swoop' } },
  { matches: ['PLAGUE', 'FALSE START'], value: { art: null, cue: 'burst' } },
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
    cue: moment.big ? 'burst' : 'drop',
  };
}
