import type { RaceMoment } from '@/lib/use-race';
import type { PropGlyphId } from './prop-glyphs';

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
  /** Painted production art, when a PNG exists for the set piece. */
  art: SurpriseArtId | null;
  /** Vector prop drawn in code; preferred over the text symbol on the course. */
  glyph?: PropGlyphId;
  /** Text fallback for surfaces that cannot draw a prop. */
  symbol: string;
  cue: 'roll' | 'spray' | 'cross' | 'dash' | 'drop' | 'swoop' | 'burst' | 'stomp' | 'gate' | 'launch' | 'pull' | 'swing';
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
  /* The twists: physical gags, matched first so their wording cannot fall
     through to an older entry. */
  { matches: ['BIG BOOT'], value: { art: 'groundskeeper-boot', symbol: '🥾', cue: 'stomp' } },
  { matches: ['SNAIL ALE'], value: { art: null, glyph: 'ale', symbol: '🍺', cue: 'drop' } },
  { matches: ['WATERMELON'], value: { art: null, glyph: 'watermelon', symbol: '🍉', cue: 'drop' } },
  { matches: ['BOOM GATE'], value: { art: null, glyph: 'boom-gate', symbol: '🚧', cue: 'gate' } },
  { matches: ['CATAPULT'], value: { art: null, glyph: 'rocket', symbol: '🚀', cue: 'launch' } },
  { matches: ['BUNCH-UP', 'MAGNET'], value: { art: null, glyph: 'magnet', symbol: '🧲', cue: 'pull' } },
  { matches: ['CATERPILLAR'], value: { art: null, glyph: 'caterpillar', symbol: '🐛', cue: 'cross' } },
  { matches: ['SPEED CAMERA'], value: { art: null, glyph: 'speed-camera', symbol: '📸', cue: 'burst' } },
  { matches: ['THE BAT'], value: { art: null, glyph: 'bat', symbol: '🏏', cue: 'swing' } },
  { matches: ['CONTAGIOUS'], value: { art: 'plague-cloud', symbol: '☣', cue: 'burst' } },
  { matches: ['SAUSAGE SIZZLE'], value: { art: null, glyph: 'sausage', symbol: '🌭', cue: 'drop' } },
  { matches: ['KOOKABURRA'], value: { art: null, glyph: 'kookaburra', symbol: '🐦', cue: 'drop' } },
  { matches: ['TRAMPOLINE'], value: { art: null, glyph: 'trampoline', symbol: '⤴', cue: 'launch' } },
  { matches: ['WOMBAT'], value: { art: null, glyph: 'wombat', symbol: '🐾', cue: 'cross' } },
  { matches: ['MOWER'], value: { art: null, glyph: 'mower', symbol: '🚜', cue: 'dash' } },
  { matches: ['HAILSTORM'], value: { art: null, glyph: 'rain-cloud', symbol: '🌨', cue: 'burst' } },
  { matches: ['LEAF BLOWER'], value: { art: null, glyph: 'wind', symbol: '💨', cue: 'burst' } },
  { matches: ['EARTH TREMOR'], value: { art: null, glyph: 'warning', symbol: '⚠', cue: 'burst' } },
  { matches: ['LUCKY DIP'], value: { art: null, glyph: 'swap', symbol: '⇄', cue: 'burst' } },
  { matches: ['POSSUM'], value: { art: null, glyph: 'wombat', symbol: '🐾', cue: 'drop' } },
  { matches: ['RUNAWAY DRONE'], value: { art: null, glyph: 'camera', symbol: '📷', cue: 'swoop' } },
  { matches: ["SLIP 'N' SLIDE"], value: { art: null, glyph: 'slime', symbol: '💧', cue: 'dash' } },
  { matches: ['CHEER SQUAD'], value: { art: null, glyph: 'megaphone', symbol: '📣', cue: 'burst' } },
  { matches: ['ROAD WORKS'], value: { art: null, glyph: 'warning', symbol: '⚠', cue: 'drop' } },

  /* Painted set pieces. */
  { matches: ['CRICKET BALL'], value: { art: 'cricket-ball', symbol: '●', cue: 'roll' } },
  { matches: ['SPRINKLER'], value: { art: 'sprinkler', symbol: '💦', cue: 'spray' } },
  { matches: ['PITCH ROLLER'], value: { art: 'pitch-roller', symbol: '⚙', cue: 'cross' } },
  { matches: ['DOG ON THE TRACK', 'CLUB DOG'], value: { art: 'club-dog', symbol: '🐕', cue: 'dash' } },
  { matches: ['LETTUCE'], value: { art: 'lettuce-crate', symbol: '🥬', cue: 'drop' } },
  { matches: ['MAGPIE', 'SWOOP'], value: { art: 'magpie', symbol: '🐦', cue: 'swoop' } },
  { matches: ['GROUNDSKEEPER'], value: { art: 'groundskeeper-boot', symbol: '🥾', cue: 'cross' } },
  { matches: ['BOUNDARY BEE'], value: { art: 'boundary-bee', symbol: '🐝', cue: 'swoop' } },
  { matches: ['PLAGUE'], value: { art: 'plague-cloud', symbol: '☣', cue: 'burst' } },

  /* The second book: vector props. */
  { matches: ['ICE CREAM'], value: { art: null, glyph: 'ice-cream-van', symbol: '🍦', cue: 'cross' } },
  { matches: ['RAIN SQUALL', 'RAIN'], value: { art: null, glyph: 'rain-cloud', symbol: '🌧', cue: 'burst' } },
  { matches: ['MEXICAN WAVE', 'HOME CROWD ROAR'], value: { art: null, glyph: 'crowd-wave', symbol: '🙌', cue: 'burst' } },
  { matches: ['PITCH INVADER'], value: { art: null, glyph: 'invader', symbol: '🏃', cue: 'dash' } },
  { matches: ['COVERS'], value: { art: null, glyph: 'covers', symbol: '▰', cue: 'cross' } },
  { matches: ['DRINKS CART'], value: { art: null, glyph: 'drinks-cart', symbol: '🛒', cue: 'cross' } },
  { matches: ['SIGHTSCREEN'], value: { art: null, glyph: 'sightscreen', symbol: '▭', cue: 'drop' } },
  { matches: ['MYSTERY SPINNER'], value: { art: null, glyph: 'spinner', symbol: '●', cue: 'roll' } },
  { matches: ['DRS REVIEW'], value: { art: null, glyph: 'review', symbol: '📺', cue: 'burst' } },
  { matches: ['TEA INTERVAL'], value: { art: null, glyph: 'teacup', symbol: '☕', cue: 'drop' } },
  { matches: ['SELFIE'], value: { art: null, glyph: 'camera', symbol: '📷', cue: 'drop' } },
  { matches: ['SUNSCREEN'], value: { art: null, glyph: 'sunscreen', symbol: '🧴', cue: 'drop' } },
  { matches: ['TAILWIND'], value: { art: null, glyph: 'wind', symbol: '💨', cue: 'burst' } },
  { matches: ['DRINKS BREAK'], value: { art: null, glyph: 'drinks-cart', symbol: '🥤', cue: 'burst' } },
  { matches: ['DEW'], value: { art: null, glyph: 'slime', symbol: '💧', cue: 'drop' } },

  /* The deck: late and field-wide cards drawn on top of both books. */
  { matches: ['BIG FREEZE', 'FREEZE'], value: { art: null, glyph: 'hand', symbol: '✋', cue: 'burst' } },
  { matches: ['HEADWIND'], value: { art: null, glyph: 'wind', symbol: '💨', cue: 'burst' } },
  { matches: ['REVERSE GEAR'], value: { art: null, glyph: 'u-turn', symbol: '↩', cue: 'cross' } },
  { matches: ['LUCKY LAST'], value: { art: null, glyph: 'bolt', symbol: '⚡', cue: 'burst' } },

  /* The first book's lighter moments, now drawn rather than typed. */
  { matches: ['BANANA'], value: { art: null, glyph: 'banana', symbol: '🍌', cue: 'drop' } },
  { matches: ['ESPRESSO'], value: { art: null, glyph: 'coffee', symbol: '☕', cue: 'burst' } },
  { matches: ['MICRO-NAP', 'STAGE FRIGHT'], value: { art: null, glyph: 'zzz', symbol: '💤', cue: 'drop' } },
  { matches: ['SNAIL MAIL'], value: { art: null, glyph: 'letter', symbol: '✉', cue: 'drop' } },
  { matches: ['WRONG WAY'], value: { art: null, glyph: 'u-turn', symbol: '↩', cue: 'cross' } },
  { matches: ['SNAIL ROMANCE'], value: { art: null, glyph: 'heart', symbol: '♥', cue: 'burst' } },
  { matches: ['THIRD UMPIRE'], value: { art: null, glyph: 'umpire', symbol: '☝', cue: 'burst' } },
  { matches: ['SLEDGED', 'CROWD LIFT'], value: { art: null, glyph: 'megaphone', symbol: '📣', cue: 'burst' } },
  { matches: ['SHELL SWAP'], value: { art: null, glyph: 'swap', symbol: '⇄', cue: 'cross' } },
  { matches: ['TURBO', 'SECOND WIND', 'SLIPSTREAM', 'DOWNHILL', 'FRESH WAX'], value: { art: null, glyph: 'bolt', symbol: '⚡', cue: 'burst' } },
  { matches: ['SHELL SLIP', 'GRAVEL', 'CRAMP', 'BOGGED'], value: { art: null, glyph: 'warning', symbol: '⚠', cue: 'drop' } },
  { matches: ['MYSTERY SLIME'], value: { art: null, glyph: 'slime', symbol: '◉', cue: 'burst' } },
  { matches: ['FALSE START'], value: { art: null, glyph: 'hand', symbol: '✋', cue: 'burst' } },
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
