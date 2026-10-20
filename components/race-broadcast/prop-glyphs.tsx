import type { ReactNode } from 'react';

/**
 * Vector props for the surprises that have no painted production art.
 *
 * Drawn in a 64 x 64 box whose bottom-centre sits on the lane, exactly like
 * the PNG props, so the same arrival and reaction animations apply. Vectors
 * rather than emoji: an emoji is whatever font the projector laptop happens
 * to ship, and on some venue machines it is a hollow box.
 */
export type PropGlyphId =
  | 'ice-cream-van'
  | 'rain-cloud'
  | 'crowd-wave'
  | 'invader'
  | 'covers'
  | 'drinks-cart'
  | 'sightscreen'
  | 'spinner'
  | 'review'
  | 'teacup'
  | 'camera'
  | 'sunscreen'
  | 'wind'
  | 'coffee'
  | 'banana'
  | 'zzz'
  | 'letter'
  | 'heart'
  | 'umpire'
  | 'megaphone'
  | 'swap'
  | 'bolt'
  | 'warning'
  | 'slime'
  | 'hand'
  | 'u-turn'
  | 'ale'
  | 'watermelon'
  | 'boom-gate'
  | 'rocket'
  | 'magnet'
  | 'caterpillar'
  | 'speed-camera'
  | 'bat'
  | 'sausage'
  | 'kookaburra'
  | 'trampoline'
  | 'wombat'
  | 'mower'
  | 'pitch-roller'
  | 'lettuce'
  | 'plague'
  | 'cricket-ball'
  | 'sprinkler'
  | 'dog'
  | 'magpie'
  | 'boot'
  | 'bee';

const ink = '#24171b';
const cream = '#fff9ed';
const gold = '#e8b55e';
const maroon = '#b3141c';
const blue = '#1c4fa0';

export const PROP_GLYPHS: Record<PropGlyphId, ReactNode> = {
  'ice-cream-van': (
    <g>
      <rect x="-30" y="-40" width="52" height="30" rx="4" fill={cream} stroke={ink} strokeWidth="2" />
      <rect x="-30" y="-40" width="52" height="8" fill={maroon} />
      <rect x="-24" y="-28" width="16" height="12" fill="#9fd3ff" stroke={ink} strokeWidth="1.2" />
      <circle cx="-18" cy="-6" r="6" fill={ink} />
      <circle cx="12" cy="-6" r="6" fill={ink} />
      <circle cx="-18" cy="-6" r="2.5" fill={cream} />
      <circle cx="12" cy="-6" r="2.5" fill={cream} />
      <path d="M8 -52 L14 -40 L2 -40 Z" fill={gold} stroke={ink} strokeWidth="1.2" />
      <circle cx="8" cy="-54" r="5" fill="#ffd1dc" stroke={ink} strokeWidth="1.2" />
    </g>
  ),
  'rain-cloud': (
    <g>
      <path d="M-26 -30 a12 12 0 0 1 20 -10 a14 14 0 0 1 26 4 a10 10 0 0 1 2 20 H-22 a10 10 0 0 1 -4 -14 Z" fill="#9aa7b8" stroke={ink} strokeWidth="1.5" />
      {[-16, -6, 4, 14].map((x) => (
        <path key={x} d={`M${x} -12 l-4 10`} stroke={blue} strokeWidth="2.5" strokeLinecap="round" />
      ))}
    </g>
  ),
  'crowd-wave': (
    <g>
      {[-24, -12, 0, 12, 24].map((x, i) => (
        <g key={x} transform={`translate(${x} ${-22 - (i === 2 ? 10 : i === 1 || i === 3 ? 6 : 0)})`}>
          <circle r="5" fill={gold} stroke={ink} strokeWidth="1.2" />
          <path d="M-6 6 l-4 -12 M6 6 l4 -12" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
          <rect x="-4" y="5" width="8" height="10" rx="2" fill={maroon} />
        </g>
      ))}
    </g>
  ),
  invader: (
    <g>
      <circle cx="0" cy="-48" r="6" fill="#f2c8a0" stroke={ink} strokeWidth="1.2" />
      <rect x="-7" y="-41" width="14" height="18" rx="3" fill={maroon} stroke={ink} strokeWidth="1.2" />
      <path d="M-7 -36 l-12 -8 M7 -36 l12 8" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M-4 -23 l-8 20 M4 -23 l10 18" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  covers: (
    <g>
      <path d="M-32 -6 L-24 -30 L30 -30 L22 -6 Z" fill="#3b82f6" stroke={ink} strokeWidth="1.5" />
      <path d="M-24 -30 L-20 -40 L34 -40 L30 -30" fill="#2563eb" stroke={ink} strokeWidth="1.5" />
      <path d="M-8 -30 L-14 -6 M8 -30 L2 -6" stroke={cream} strokeWidth="1.5" opacity=".6" />
    </g>
  ),
  'drinks-cart': (
    <g>
      <rect x="-24" y="-30" width="44" height="22" rx="3" fill={cream} stroke={ink} strokeWidth="1.8" />
      <rect x="-20" y="-44" width="8" height="14" rx="2" fill="#ffb347" stroke={ink} strokeWidth="1.2" />
      <rect x="-8" y="-44" width="8" height="14" rx="2" fill="#7fd1ff" stroke={ink} strokeWidth="1.2" />
      <rect x="4" y="-44" width="8" height="14" rx="2" fill="#b6f27a" stroke={ink} strokeWidth="1.2" />
      <circle cx="-14" cy="-4" r="5" fill={ink} />
      <circle cx="10" cy="-4" r="5" fill={ink} />
    </g>
  ),
  sightscreen: (
    <g>
      <rect x="-26" y="-50" width="52" height="40" fill={cream} stroke={ink} strokeWidth="2" />
      <path d="M-18 -50 V-10 M-6 -50 V-10 M6 -50 V-10 M18 -50 V-10" stroke={ink} strokeWidth="1" opacity=".4" />
      <path d="M-20 -10 V0 M20 -10 V0" stroke={ink} strokeWidth="2.5" />
    </g>
  ),
  spinner: (
    <g>
      <circle cx="0" cy="-26" r="16" fill={maroon} stroke={ink} strokeWidth="1.5" />
      <path d="M-14 -34 Q0 -24 14 -34 M-14 -18 Q0 -28 14 -18" fill="none" stroke={cream} strokeWidth="1.6" />
      <path d="M-28 -46 q8 -6 14 0 M20 -6 q6 6 12 0" fill="none" stroke={gold} strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  review: (
    <g>
      <rect x="-28" y="-50" width="56" height="34" rx="3" fill={ink} stroke={gold} strokeWidth="2" />
      <text x="0" y="-27" textAnchor="middle" fontSize="13" fontWeight="900" fill={gold} fontFamily="Arial, sans-serif">
        REVIEW
      </text>
      <path d="M-6 -16 V-4 M6 -16 V-4 M-12 -4 H12" stroke={ink} strokeWidth="2.5" />
    </g>
  ),
  teacup: (
    <g>
      <path d="M-18 -30 H14 V-14 a12 12 0 0 1 -12 10 h-8 a12 12 0 0 1 -12 -10 Z" fill={cream} stroke={ink} strokeWidth="1.8" />
      <path d="M14 -28 a7 7 0 0 1 0 14" fill="none" stroke={ink} strokeWidth="1.8" />
      <path d="M-20 -2 H20" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      <path d="M-8 -40 q3 -4 0 -8 M0 -40 q3 -4 0 -8" fill="none" stroke="#9aa7b8" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ),
  camera: (
    <g>
      <rect x="-24" y="-40" width="48" height="30" rx="5" fill={ink} stroke={gold} strokeWidth="1.5" />
      <rect x="-10" y="-46" width="20" height="8" rx="2" fill={ink} />
      <circle cx="0" cy="-25" r="10" fill={cream} stroke={gold} strokeWidth="1.5" />
      <circle cx="0" cy="-25" r="5" fill={blue} />
      <circle cx="16" cy="-34" r="2" fill={gold} />
    </g>
  ),
  sunscreen: (
    <g>
      <rect x="-12" y="-40" width="24" height="34" rx="5" fill="#ffb347" stroke={ink} strokeWidth="1.8" />
      <rect x="-7" y="-48" width="14" height="9" rx="2" fill={cream} stroke={ink} strokeWidth="1.5" />
      <text x="0" y="-18" textAnchor="middle" fontSize="11" fontWeight="900" fill={ink} fontFamily="Arial, sans-serif">
        50+
      </text>
      <circle cx="24" cy="-44" r="6" fill={gold} />
    </g>
  ),
  wind: (
    <g>
      <path d="M-30 -36 H10 a6 6 0 1 0 -6 -6" fill="none" stroke={cream} strokeWidth="3" strokeLinecap="round" />
      <path d="M-30 -24 H22 a7 7 0 1 1 -7 7" fill="none" stroke={cream} strokeWidth="3" strokeLinecap="round" />
      <path d="M-24 -12 H4 a5 5 0 1 0 -5 -5" fill="none" stroke={cream} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  coffee: (
    <g>
      <path d="M-14 -36 H14 L10 -8 H-10 Z" fill="#8b5a2b" stroke={ink} strokeWidth="1.8" />
      <rect x="-16" y="-42" width="32" height="7" rx="2" fill={cream} stroke={ink} strokeWidth="1.5" />
      <path d="M-6 -50 q3 -4 0 -8 M4 -50 q3 -4 0 -8" fill="none" stroke="#9aa7b8" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ),
  banana: (
    <g>
      <path d="M-26 -24 Q-6 -2 22 -14 Q26 -10 20 -6 Q-10 8 -30 -18 Z" fill={gold} stroke={ink} strokeWidth="1.8" />
      <path d="M22 -14 l6 -6" stroke={ink} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  zzz: (
    <g fill={cream} stroke={ink} strokeWidth="0.8" fontFamily="Arial, sans-serif" fontWeight="900">
      <text x="-20" y="-10" fontSize="16">z</text>
      <text x="-6" y="-24" fontSize="22">z</text>
      <text x="12" y="-40" fontSize="28">z</text>
    </g>
  ),
  letter: (
    <g>
      <rect x="-24" y="-36" width="48" height="32" rx="3" fill={cream} stroke={ink} strokeWidth="1.8" />
      <path d="M-24 -36 L0 -16 L24 -36" fill="none" stroke={ink} strokeWidth="1.8" />
      <rect x="10" y="-32" width="10" height="8" fill={maroon} />
    </g>
  ),
  heart: (
    <g>
      <path d="M0 -8 C-30 -28 -18 -52 0 -40 C18 -52 30 -28 0 -8 Z" fill="#ff5d7a" stroke={ink} strokeWidth="1.8" />
    </g>
  ),
  umpire: (
    <g>
      <circle cx="0" cy="-50" r="7" fill="#f2c8a0" stroke={ink} strokeWidth="1.2" />
      <rect x="-10" y="-56" width="20" height="4" fill={cream} stroke={ink} strokeWidth="1" />
      <rect x="-9" y="-42" width="18" height="22" rx="3" fill={cream} stroke={ink} strokeWidth="1.2" />
      <path d="M9 -40 l12 -16" stroke="#f2c8a0" strokeWidth="5" strokeLinecap="round" />
      <path d="M9 -40 l12 -16" stroke={ink} strokeWidth="1" strokeLinecap="round" opacity=".4" />
      <path d="M21 -56 l0 -8" stroke="#f2c8a0" strokeWidth="4" strokeLinecap="round" />
    </g>
  ),
  megaphone: (
    <g>
      <path d="M-26 -30 H-10 L18 -46 V-6 L-10 -22 H-26 Z" fill={maroon} stroke={ink} strokeWidth="1.8" />
      <path d="M-22 -22 l4 14 h8 l-4 -14" fill={ink} />
      <path d="M22 -34 q8 8 0 16 M27 -40 q14 14 0 28" fill="none" stroke={gold} strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  swap: (
    <g fill="none" stroke={cream} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-26 -34 H22 l-8 -8 M22 -34 l-8 8" />
      <path d="M26 -16 H-22 l8 -8 M-22 -16 l8 8" />
    </g>
  ),
  bolt: (
    <g>
      <path d="M6 -56 L-18 -24 H-2 L-8 -2 L18 -34 H2 Z" fill={gold} stroke={ink} strokeWidth="1.8" strokeLinejoin="round" />
    </g>
  ),
  warning: (
    <g>
      <path d="M0 -54 L28 -6 H-28 Z" fill={gold} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M0 -40 V-22" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <circle cx="0" cy="-14" r="2.5" fill={ink} />
    </g>
  ),
  slime: (
    <g>
      <path d="M-28 -10 Q-26 -30 -8 -26 Q-2 -42 12 -32 Q30 -34 26 -12 Q30 -2 10 -2 Q-6 4 -28 -10 Z" fill="#8ee05d" stroke={ink} strokeWidth="1.8" />
      <circle cx="-8" cy="-16" r="3" fill="#d6ff9a" />
      <circle cx="10" cy="-20" r="2" fill="#d6ff9a" />
    </g>
  ),
  hand: (
    <g>
      <path d="M-14 -4 V-30 a4 4 0 0 1 8 0 V-40 a4 4 0 0 1 8 0 V-36 a4 4 0 0 1 8 0 V-26 a4 4 0 0 1 8 0 V-14 Q18 2 2 2 H-4 Q-14 2 -14 -4 Z" fill="#f2c8a0" stroke={ink} strokeWidth="1.8" strokeLinejoin="round" />
    </g>
  ),
  'u-turn': (
    <g fill="none" stroke={cream} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-18 -4 V-30 a18 18 0 0 1 36 0 V-16" />
      <path d="M10 -24 l8 8 l8 -8" />
    </g>
  ),
  /* The twists. */
  ale: (
    <g>
      <path d="M-20 -44 H14 V-4 Q14 0 10 0 H-16 Q-20 0 -20 -4 Z" fill={gold} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 -36 h8 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-8" fill="none" stroke={ink} strokeWidth="2.5" />
      <path d="M-24 -46 Q-20 -58 -8 -54 Q-2 -64 10 -56 Q22 -58 18 -44 Z" fill={cream} stroke={ink} strokeWidth="1.8" />
      <path d="M-12 -36 V-10 M2 -36 V-10" stroke="#fff5cc" strokeWidth="3" strokeLinecap="round" opacity=".8" />
    </g>
  ),
  watermelon: (
    <g>
      <path d="M-30 -10 A30 30 0 0 1 30 -10 Z" fill="#2f8f3a" stroke={ink} strokeWidth="2" />
      <path d="M-25 -10 A25 25 0 0 1 25 -10 Z" fill="#ff5a6e" stroke={ink} strokeWidth="1.5" />
      <circle cx="-10" cy="-18" r="2.2" fill={ink} />
      <circle cx="4" cy="-24" r="2.2" fill={ink} />
      <circle cx="12" cy="-15" r="2.2" fill={ink} />
    </g>
  ),
  'boom-gate': (
    <g>
      <rect x="-30" y="-20" width="12" height="22" fill={ink} />
      <circle cx="-24" cy="-26" r="5" fill="#ff3b3b" stroke={ink} strokeWidth="1.5" />
      <g className="prop-gate-arm">
        <rect x="-26" y="-34" width="60" height="8" rx="2" fill={cream} stroke={ink} strokeWidth="1.5" />
        <rect x="-14" y="-34" width="10" height="8" fill={maroon} />
        <rect x="6" y="-34" width="10" height="8" fill={maroon} />
        <rect x="26" y="-34" width="8" height="8" fill={maroon} />
      </g>
    </g>
  ),
  rocket: (
    <g>
      <path d="M0 -62 Q16 -44 14 -16 H-14 Q-16 -44 0 -62 Z" fill={cream} stroke={ink} strokeWidth="2" />
      <path d="M-14 -30 L-26 -12 H-14 Z M14 -30 L26 -12 H14 Z" fill={maroon} stroke={ink} strokeWidth="1.5" />
      <circle cx="0" cy="-38" r="5" fill={blue} stroke={ink} strokeWidth="1.5" />
      <path d="M-8 -16 Q0 4 8 -16 Z" fill={gold} stroke={ink} strokeWidth="1.5" />
    </g>
  ),
  magnet: (
    <g>
      <path d="M-24 -10 V-34 a24 24 0 0 1 48 0 V-10 H10 V-34 a10 10 0 0 0 -20 0 V-10 Z" fill="#d12a2a" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <rect x="-24" y="-18" width="14" height="10" fill={cream} stroke={ink} strokeWidth="1.5" />
      <rect x="10" y="-18" width="14" height="10" fill={cream} stroke={ink} strokeWidth="1.5" />
    </g>
  ),
  caterpillar: (
    <g>
      <circle cx="-24" cy="-10" r="8" fill="#8ee05d" stroke={ink} strokeWidth="1.5" />
      <circle cx="-10" cy="-14" r="8" fill="#6fcf45" stroke={ink} strokeWidth="1.5" />
      <circle cx="4" cy="-10" r="8" fill="#8ee05d" stroke={ink} strokeWidth="1.5" />
      <circle cx="18" cy="-14" r="8" fill="#6fcf45" stroke={ink} strokeWidth="1.5" />
      <circle cx="30" cy="-12" r="9" fill={gold} stroke={ink} strokeWidth="1.5" />
      <circle cx="33" cy="-14" r="1.6" fill={ink} />
      <path d="M28 -20 l-2 -8 M34 -20 l3 -8" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ),
  bat: (
    <g className="prop-bat">
      <path d="M-6 -2 L-2 -22 L14 -60 Q20 -70 26 -66 Q32 -62 28 -52 L12 -16 L8 2 Z" fill={gold} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M-8 4 L-2 -14 L8 -10 L2 8 Z" fill="#5b3a1e" stroke={ink} strokeWidth="2" />
      <path d="M30 -70 l6 -6 M36 -58 l8 0 M22 -78 l0 -8" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  'speed-camera': (
    <g>
      <rect x="-6" y="-22" width="12" height="22" fill={ink} />
      <rect x="-24" y="-44" width="48" height="24" rx="4" fill="#3a3f4a" stroke={ink} strokeWidth="2" />
      <circle cx="-8" cy="-32" r="7" fill={blue} stroke={cream} strokeWidth="2" />
      <rect x="6" y="-38" width="12" height="8" fill={cream} />
      <path className="prop-flash" d="M-34 -52 l6 6 M34 -52 l-6 6 M0 -56 v8" stroke={gold} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  sausage: (
    <g>
      <rect x="-30" y="-14" width="60" height="6" rx="2" fill="#3a3f4a" stroke={ink} strokeWidth="1.5" />
      <path d="M-24 -8 L-28 2 M24 -8 L28 2" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M-22 -16 Q-24 -30 0 -30 Q24 -30 22 -16 Z" fill="#f2d39a" stroke={ink} strokeWidth="1.8" />
      <rect x="-20" y="-30" width="40" height="9" rx="4.5" fill="#a8452a" stroke={ink} strokeWidth="1.5" />
      <path d="M-14 -26 Q-6 -22 2 -26 T16 -26" fill="none" stroke="#f5c400" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M-10 -38 q-4 -6 0 -10 M2 -40 q-4 -6 0 -10 M14 -38 q-4 -6 0 -10" fill="none" stroke="#c9c2b5" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  kookaburra: (
    <g>
      <rect x="-30" y="-10" width="60" height="5" fill={cream} stroke={ink} strokeWidth="1.5" />
      <path d="M-10 -10 Q-22 -30 -6 -40 Q8 -46 14 -34 Q18 -22 6 -10 Z" fill="#c9a77c" stroke={ink} strokeWidth="1.8" />
      <path d="M-12 -14 Q-26 -26 -20 -36 Q-12 -30 -4 -18 Z" fill="#6b4a2e" stroke={ink} strokeWidth="1.5" />
      <circle cx="6" cy="-38" r="9" fill={cream} stroke={ink} strokeWidth="1.8" />
      <path d="M0 -40 L14 -40" stroke="#6b4a2e" strokeWidth="2.5" />
      <path d="M13 -38 L30 -36 L13 -32 Z" fill="#3a3f4a" stroke={ink} strokeWidth="1.2" />
      <circle cx="9" cy="-41" r="1.6" fill={ink} />
      <path d="M20 -50 l4 -4 M26 -46 l6 -2 M16 -54 l1 -6" stroke={gold} strokeWidth="2.2" strokeLinecap="round" />
    </g>
  ),
  trampoline: (
    <g>
      <path d="M-28 -16 L-24 0 M28 -16 L24 0 M0 -16 L0 0" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="0" cy="-16" rx="30" ry="7" fill={blue} stroke={ink} strokeWidth="2" />
      <ellipse cx="0" cy="-17" rx="22" ry="4" fill="#123a7a" />
      <path d="M-12 -30 Q0 -58 12 -30" fill="none" stroke={gold} strokeWidth="2.5" strokeDasharray="4 4" />
      <path d="M8 -36 l6 6 l-8 2" fill="none" stroke={gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  wombat: (
    <g>
      <ellipse cx="0" cy="-16" rx="26" ry="16" fill="#8a7a6a" stroke={ink} strokeWidth="2" />
      <circle cx="20" cy="-22" r="11" fill="#9a8a7a" stroke={ink} strokeWidth="2" />
      <circle cx="14" cy="-32" r="4" fill="#8a7a6a" stroke={ink} strokeWidth="1.5" />
      <circle cx="26" cy="-32" r="4" fill="#8a7a6a" stroke={ink} strokeWidth="1.5" />
      <ellipse cx="28" cy="-19" rx="4" ry="3" fill={ink} />
      <circle cx="20" cy="-25" r="1.6" fill={ink} />
      <path d="M-18 -2 v2 M-6 -1 v2 M8 -1 v2" stroke={ink} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  mower: (
    <g>
      <rect x="-26" y="-22" width="44" height="14" rx="3" fill="#2f8f3a" stroke={ink} strokeWidth="2" />
      <rect x="-6" y="-38" width="14" height="16" rx="2" fill={gold} stroke={ink} strokeWidth="1.8" />
      <path d="M8 -38 L20 -46" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="-16" cy="-6" r="8" fill={ink} />
      <circle cx="14" cy="-6" r="6" fill={ink} />
      <circle cx="-16" cy="-6" r="3" fill={cream} />
      <path d="M-34 -10 l-6 -4 M-34 -4 l-8 0 M-34 2 l-6 3" stroke="#7cc96a" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  /* The set pieces that used to be painted photographs, redrawn flat so
     they sit in the same cartoon as the snails and the town. */
  'pitch-roller': (
    <g>
      <path d="M-12 -40 L-34 -58" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M-34 -58 L-42 -56" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <rect x="-14" y="-46" width="40" height="20" rx="4" fill="#2f8f3a" stroke={ink} strokeWidth="2" />
      <circle cx="12" cy="-20" r="20" fill="#9c5a3c" stroke={ink} strokeWidth="2.2" />
      <circle cx="12" cy="-20" r="13" fill="#b86f49" stroke={ink} strokeWidth="1.5" />
      <circle cx="12" cy="-20" r="3" fill={ink} />
      <path d="M12 -33 v26 M-1 -20 h26" stroke={ink} strokeWidth="1.5" opacity=".5" />
      <circle cx="-20" cy="-10" r="8" fill="#3a3f4a" stroke={ink} strokeWidth="2" />
      <circle cx="-20" cy="-10" r="2.5" fill={cream} />
    </g>
  ),
  lettuce: (
    <g>
      <rect x="-28" y="-22" width="56" height="22" rx="3" fill="#b07a3c" stroke={ink} strokeWidth="2" />
      <path d="M-28 -14 h56 M-28 -7 h56" stroke={ink} strokeWidth="1.2" opacity=".5" />
      <path d="M-26 -22 q-8 -16 6 -22 q4 -12 16 -8 q10 -10 20 0 q12 -4 12 10 q8 8 -4 20 Z" fill="#8ee05d" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M-18 -30 q6 -8 14 -2 M2 -38 q8 -6 14 2" fill="none" stroke="#4fae2e" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  plague: (
    <g>
      <path d="M-30 -14 a12 12 0 0 1 10 -22 a14 14 0 0 1 26 -6 a13 13 0 0 1 22 10 a10 10 0 0 1 0 20 H-24 a9 9 0 0 1 -6 -2 Z" fill="#8c57c7" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M-16 -22 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0 M8 -28 a5 5 0 1 1 10 0 a5 5 0 1 1 -10 0" fill="#b7ee63" stroke={ink} strokeWidth="1.5" />
      <circle cx="-9" cy="-22" r="2" fill={ink} />
      <circle cx="13" cy="-28" r="1.6" fill={ink} />
      <path d="M-22 -4 q-3 6 0 10 M0 -2 q-3 6 0 10 M20 -4 q-3 6 0 10" fill="none" stroke="#b7ee63" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  'cricket-ball': (
    <g>
      <circle cx="0" cy="-18" r="18" fill={maroon} stroke={ink} strokeWidth="2.2" />
      <path d="M-6 -34 q-6 16 0 32 M6 -34 q6 16 0 32" fill="none" stroke={cream} strokeWidth="1.6" strokeDasharray="2 2" />
      <path d="M-28 -24 l-8 -2 M-30 -14 l-8 2 M-26 -6 l-6 4" stroke={ink} strokeWidth="2" strokeLinecap="round" opacity=".6" />
    </g>
  ),
  sprinkler: (
    <g>
      <rect x="-4" y="-26" width="8" height="26" fill="#3a3f4a" stroke={ink} strokeWidth="1.5" />
      <rect x="-12" y="-34" width="24" height="10" rx="3" fill="#6b7280" stroke={ink} strokeWidth="1.5" />
      <path d="M-8 -36 q-16 -14 -28 -8 M0 -36 q0 -20 0 -26 M8 -36 q16 -14 28 -8" fill="none" stroke={blue} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="-30" cy="-50" r="2.5" fill={blue} />
      <circle cx="30" cy="-50" r="2.5" fill={blue} />
      <circle cx="0" cy="-66" r="2.5" fill={blue} />
      <circle cx="-18" cy="-58" r="2" fill={blue} />
      <circle cx="18" cy="-58" r="2" fill={blue} />
    </g>
  ),
  dog: (
    <g>
      <path d="M-28 -6 q-4 -22 10 -24 h26 q12 0 14 12 l2 12 Z" fill="#d9a066" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M-26 -6 v6 M-14 -6 v6 M10 -6 v6 M20 -6 v6" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="-32" r="11" fill="#d9a066" stroke={ink} strokeWidth="2" />
      <path d="M14 -40 q-6 -10 2 -12 q4 4 2 12 Z" fill="#b5804a" stroke={ink} strokeWidth="1.5" />
      <circle cx="33" cy="-32" r="2.5" fill={ink} />
      <circle cx="27" cy="-36" r="1.6" fill={ink} />
      <path d="M-28 -24 q-10 -6 -8 -16" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <path d="M30 -24 q4 4 0 6" fill="none" stroke="#e05a5a" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  magpie: (
    <g>
      <path d="M-26 -34 q10 -12 24 -8 l20 8 q6 2 10 10 l-6 2 l-14 -2 l-20 8 Z" fill={ink} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M-14 -36 q8 -4 16 0 l-6 10 Z" fill={cream} />
      <path d="M8 -28 l-10 14 l18 -6 Z" fill={cream} stroke={ink} strokeWidth="1" />
      <circle cx="18" cy="-36" r="1.8" fill={cream} />
      <path d="M28 -32 l10 2 l-10 3 Z" fill={gold} stroke={ink} strokeWidth="1" />
      <path d="M-6 -46 q-2 -6 -8 -4 M-16 -50 q-2 -6 -8 -3" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" opacity=".6" />
    </g>
  ),
  boot: (
    <g>
      <path d="M-18 -54 h26 v26 q16 2 22 14 q2 8 -6 12 h-42 Z" fill="#6b4a2e" stroke={ink} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M-20 -2 h50 q4 0 4 -4 v-2 h-54 Z" fill={ink} />
      <path d="M-18 -54 h26 v6 h-26 Z" fill="#8a6540" />
      <path d="M-10 -44 l12 -4 M-10 -36 l12 -4 M-10 -28 l12 -4" stroke={gold} strokeWidth="2" strokeLinecap="round" />
      <circle cx="-12" cy="-45" r="1.6" fill={gold} />
      <circle cx="2" cy="-49" r="1.6" fill={gold} />
    </g>
  ),
  bee: (
    <g>
      <ellipse cx="0" cy="-28" rx="18" ry="12" fill={gold} stroke={ink} strokeWidth="2" />
      <path d="M-8 -40 v24 M2 -40 v24 M11 -38 v20" stroke={ink} strokeWidth="4" />
      <ellipse cx="-8" cy="-44" rx="10" ry="6" fill={cream} stroke={ink} strokeWidth="1.5" opacity=".9" />
      <ellipse cx="8" cy="-44" rx="10" ry="6" fill={cream} stroke={ink} strokeWidth="1.5" opacity=".9" />
      <circle cx="16" cy="-30" r="2" fill={ink} />
      <path d="M18 -28 l8 2" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      <path d="M-26 -18 q-6 4 -10 10" fill="none" stroke={ink} strokeWidth="1.5" strokeDasharray="2 3" />
    </g>
  ),
};

export function PropGlyph({ id }: { id: PropGlyphId }) {
  return <g className="course-prop-glyph">{PROP_GLYPHS[id]}</g>;
}
