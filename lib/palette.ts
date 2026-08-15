/**
 * Lane colours spread across hue AND lightness so they stay distinct through
 * projector gamma and for colour-blind viewers. Lane number and name pill
 * carry the same identity, so colour is never the only cue.
 *
 * Twelve entries because the field can now run to twelve lanes; the hues are
 * ordered so that neighbouring lane numbers are never neighbouring hues.
 */
export interface LaneColour {
  shell: string;
  dark: string;
  body: string;
  glow: string;
}

export const PALETTE: LaneColour[] = [
  { shell: '#ff5f52', dark: '#8f2119', body: '#ffd7cd', glow: '255 95 82' },
  { shell: '#3ca5ff', dark: '#14508f', body: '#cfe6ff', glow: '60 165 255' },
  { shell: '#ffb224', dark: '#8f6100', body: '#ffe7bd', glow: '255 178 36' },
  { shell: '#34d399', dark: '#0e6b4a', body: '#c9f5e4', glow: '52 211 153' },
  { shell: '#a86bff', dark: '#54269b', body: '#e6d6ff', glow: '168 107 255' },
  { shell: '#b7e43b', dark: '#5a740f', body: '#ecf8c8', glow: '183 228 59' },
  { shell: '#ff7ab8', dark: '#94305f', body: '#ffd9ea', glow: '255 122 184' },
  { shell: '#00c2d1', dark: '#045f66', body: '#c2f1f5', glow: '0 194 209' },
  { shell: '#e3b269', dark: '#7d5a24', body: '#f7e6c9', glow: '227 178 105' },
  { shell: '#7a7bff', dark: '#33349b', body: '#dcdcff', glow: '122 123 255' },
  { shell: '#e35ad8', dark: '#7d1f75', body: '#f8d3f4', glow: '227 90 216' },
  { shell: '#dde3ec', dark: '#6f7889', body: '#f4f6fa', glow: '221 227 236' },
];

/** Quiet grey for entries that belong to no lane, e.g. direct QR donations. */
const NEUTRAL: LaneColour = {
  shell: '#8e8e93',
  dark: '#48484a',
  body: '#e5e5ea',
  glow: '142 142 147',
};

export const laneColour = (lane: number): LaneColour =>
  lane < 0 ? NEUTRAL : PALETTE[lane % PALETTE.length];

export const MIN_FIELD = 3;
export const MAX_FIELD = 20;

/** One default name per possible lane, so padding a saved night is total. */
export const DEFAULT_NAMES = [
  'Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt',
  'Comet', 'Dasher', 'Escar-go', 'Shellby', 'Gary', 'Slugger',
  'Sheldon', 'Trundler', 'Slime Shady', 'Nightwatchman',
  'Golden Duck', 'Shell Warne', 'Slow Burn', 'The Yorker',
];

export const NAME_POOL = [
  'Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher',
  'Escar-go', 'Slime Shady', 'Sheldon', 'Usain Bolt-ish', 'Shellby', 'Gary',
  'Slugger', 'Snailsy', 'The Gastropod', 'Slow Burn', 'Mollusc Magic',
  'Shell Warne', 'Slime Ponting', 'Adam Gil-crawl', 'Snail Bradman',
  'Mitchell Starch', 'Pat Slummins', 'Nathan Slyon', 'Steve Smithereens',
  'Trundler', 'Nightwatchman', 'Silly Mid-Off', 'The Yorker', 'Golden Duck',
];

export const QUICK_AMOUNTS_CENTS = [500, 1000, 2000, 5000, 10000];

/**
 * How long the field takes to get home.
 *
 * Longer races are the point: the surprises in `lib/race-engine.ts` are dealt
 * in proportion to the duration, so a 45-second marathon carries a dozen
 * things going wrong rather than the two a sprint has room for.
 */
export const RACE_LENGTHS = [
  { ms: 45_000, label: 'Marathon, 45s' },
  { ms: 30_000, label: 'Long, 30s' },
  { ms: 20_000, label: 'Feature, 20s' },
  { ms: 12_000, label: 'Standard, 12s' },
  { ms: 7_000, label: 'Sprint, 7s' },
] as const;

/**
 * Stage themes: the surface the race is run on. Each one keeps the same
 * information design and only re-lights the scene, so a theme change can
 * never cost readability.
 */
export const STAGE_THEMES = [
  { id: 'midnight', label: 'Midnight', a: '#0b101c', b: '#080c14', line: '255 255 255' },
  { id: 'turf', label: 'Night turf', a: '#0c1e15', b: '#081510', line: '210 255 220' },
  { id: 'dusk', label: 'Dusk', a: '#171023', b: '#0e0a18', line: '235 220 255' },
] as const;

export type StageThemeId = (typeof STAGE_THEMES)[number]['id'];

/**
 * Draw a fresh set of names without repeats. Lives here rather than in the
 * console component so the randomness sits outside a React render path.
 */
export function drawNames(count: number = MAX_FIELD): string[] {
  const pool = NAME_POOL.slice();
  const picked: string[] = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}
