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
  | 'seagull'
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
  | 'u-turn';

const ink = '#24171b';
const cream = '#fff9ed';
const gold = '#e8b55e';
const maroon = '#b3141c';
const blue = '#1c4fa0';

export const PROP_GLYPHS: Record<PropGlyphId, ReactNode> = {
  seagull: (
    <g>
      <path d="M4 -36 Q -14 -52 -30 -40 Q -16 -42 -6 -32 Z" fill={cream} stroke={ink} strokeWidth="1.5" />
      <path d="M4 -36 Q 22 -52 38 -40 Q 24 -42 14 -32 Z" fill={cream} stroke={ink} strokeWidth="1.5" />
      <ellipse cx="4" cy="-30" rx="12" ry="7" fill={cream} stroke={ink} strokeWidth="1.5" />
      <circle cx="13" cy="-33" r="5" fill={cream} stroke={ink} strokeWidth="1.5" />
      <path d="M17 -33 L26 -31 L17 -29 Z" fill={gold} stroke={ink} strokeWidth="1" />
      <circle cx="14" cy="-34" r="1.2" fill={ink} />
    </g>
  ),
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
};

export function PropGlyph({ id }: { id: PropGlyphId }) {
  return <g className="course-prop-glyph">{PROP_GLYPHS[id]}</g>;
}
