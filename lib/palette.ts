/**
 * Lane colours spread across hue AND lightness so they stay distinct through
 * projector gamma and for colour-blind viewers. Lane number and name pill
 * carry the same identity, so colour is never the only cue.
 */
export interface LaneColour {
  shell: string;
  dark: string;
  body: string;
  glow: string;
}

export const PALETTE: LaneColour[] = [
  { shell: '#ff4d3d', dark: '#a52418', body: '#ffd9c2', glow: '255 77 61' },
  { shell: '#ffb020', dark: '#a86800', body: '#ffe9c4', glow: '255 176 32' },
  { shell: '#26c6a6', dark: '#0b6b58', body: '#c8f2e8', glow: '38 198 166' },
  { shell: '#4c8dff', dark: '#1c4699', body: '#d3e2ff', glow: '76 141 255' },
  { shell: '#c46bff', dark: '#6f2ba3', body: '#ecd8ff', glow: '196 107 255' },
  { shell: '#b7e43b', dark: '#5f7d0d', body: '#eef8cf', glow: '183 228 59' },
  { shell: '#ff7ab8', dark: '#a32f68', body: '#ffdcec', glow: '255 122 184' },
  { shell: '#00c2d1', dark: '#046b75', body: '#c6f2f6', glow: '0 194 209' },
];

export const laneColour = (lane: number): LaneColour => PALETTE[lane % PALETTE.length];

export const MIN_FIELD = 4;
export const MAX_FIELD = 8;

export const DEFAULT_NAMES = [
  'Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher',
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
