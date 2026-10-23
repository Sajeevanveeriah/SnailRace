import type { ReactNode } from 'react';
import { ANIMATED_GLYPHS } from './prop-animated';

/**
 * The prop set: one illustrated cartoon for every surprise on every course.
 *
 * Every prop is drawn in a 64 x 64 box whose bottom-centre (0, 0) sits on the
 * track surface, the same way on the straight and on the circuits. One style
 * throughout: a bold ink outline (OUTLINE units at this size), flat fills from
 * one palette, and no hairline drawings. Anything that would be a line (a
 * handle, an arm, a gust, a jet of water) is a filled shape or an ink stroke
 * with a colour stroke on top, so it reads as solid from the back of the room.
 *
 * Vectors rather than emoji: an emoji is whatever font the projector laptop
 * happens to ship, and on some venue machines it is a hollow box.
 */
export type PropGlyphId =
  | 'ice-cream-van'
  | 'rain-cloud'
  | 'hail'
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
  | 'headwind'
  | 'coffee'
  | 'banana'
  | 'zzz'
  | 'letter'
  | 'heart'
  | 'umpire'
  | 'megaphone'
  | 'swap'
  | 'bolt'
  | 'clover'
  | 'warning'
  | 'slime'
  | 'puddle'
  | 'mud'
  | 'gravel'
  | 'cones'
  | 'tremor'
  | 'ice-pack'
  | 'freeze'
  | 'hand'
  | 'u-turn'
  | 'dizzy'
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
  | 'possum'
  | 'mower'
  | 'leaf-blower'
  | 'drone'
  | 'lucky-dip'
  | 'pitch-roller'
  | 'lettuce'
  | 'plague'
  | 'cricket-ball'
  | 'sprinkler'
  | 'dog'
  | 'magpie'
  | 'boot'
  | 'bee';

/* One palette for the whole set. */
const ink = '#24171b';
const cream = '#fff9ed';
const gold = '#e8b55e';
const maroon = '#b3141c';
const blue = '#1c4fa0';
const water = '#3b93e6';
const leaf = '#8ee05d';
const leafDark = '#4fae2e';
const grass = '#2f8f3a';
const steel = '#8d97a6';
const slate = '#3a3f4a';
const skin = '#f2c8a0';
const earth = '#8a5a32';
const orange = '#ff8a1f';
const ice = '#bfe7ff';

/** The outline every main shape wears. */
const OUTLINE = 2.4;
/** The outline on small details inside a shape. */
const DETAIL = 1.6;

/** A solid "line": an ink stroke with a colour stroke on top, so it reads as a filled band. */
function Band({ d, colour, width = 4 }: { d: string; colour: string; width?: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={ink} strokeWidth={width + OUTLINE * 1.4} />
      <path d={d} stroke={colour} strokeWidth={width} />
    </g>
  );
}

/** A filled water drop, tip up, centred on (x, y). */
function Drop({ x, y, s = 1, colour = water }: { x: number; y: number; s?: number; colour?: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 -6 C3 -2 4.5 1 4.5 3 A4.5 4.5 0 0 1 -4.5 3 C-4.5 1 -3 -2 0 -6 Z"
      fill={colour}
      stroke={ink}
      strokeWidth={DETAIL}
      strokeLinejoin="round"
    />
  );
}

/** A soft ground shadow, so a prop sits on the track rather than floating over it. */
function Shadow({ w = 28 }: { w?: number }) {
  return <ellipse cx="0" cy="-1" rx={w} ry="3.5" fill="#000" opacity=".18" />;
}

/** The cartoon cloud the weather props share, its base at y = 0 of its own group. */
const CLOUD = 'M-28 0 a11 11 0 0 1 4 -20 a14 14 0 0 1 24 -10 a14 14 0 0 1 26 6 a11 11 0 0 1 2 24 Z';

export const PROP_GLYPHS: Record<PropGlyphId, ReactNode> = {
  'ice-cream-van': (
    <g>
      <Shadow w={30} />
      <rect x="-30" y="-42" width="54" height="32" rx="5" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-30" y="-42" width="54" height="9" rx="3" fill={maroon} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-24" y="-29" width="17" height="12" rx="2" fill={ice} stroke={ink} strokeWidth={DETAIL} />
      <circle cx="-18" cy="-8" r="7" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="12" cy="-8" r="7" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-18" cy="-8" r="2.6" fill={cream} />
      <circle cx="12" cy="-8" r="2.6" fill={cream} />
      <path d="M8 -54 L15 -42 L1 -42 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <circle cx="8" cy="-56" r="6" fill="#ffc4d6" stroke={ink} strokeWidth={DETAIL} />
    </g>
  ),
  'rain-cloud': (
    <g>
      <g transform="translate(0 -24)">
        <path d={CLOUD} fill="#8fa3bf" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
        <path d="M-12 -12 q4 3 8 0 M6 -12 q4 3 8 0" fill="none" stroke={ink} strokeWidth={DETAIL} strokeLinecap="round" />
        <path d="M-4 -5 q3 -3 6 0" fill="none" stroke={ink} strokeWidth={DETAIL} strokeLinecap="round" />
      </g>
      <Drop x={-16} y={-14} />
      <Drop x={-2} y={-8} />
      <Drop x={12} y={-15} />
      <Drop x={22} y={-6} s={0.8} />
    </g>
  ),
  hail: (
    <g>
      <g transform="translate(0 -26)">
        <path d={CLOUD} fill="#5d6b82" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
        <path d="M-15 -16 l8 3 M15 -16 l-8 3" stroke={ink} strokeWidth={2.4} strokeLinecap="round" />
        <circle cx="-9" cy="-10" r="2" fill={cream} />
        <circle cx="9" cy="-10" r="2" fill={cream} />
        <path d="M-5 -3 q5 -4 10 0" fill="none" stroke={ink} strokeWidth={DETAIL} strokeLinecap="round" />
      </g>
      {[[-18, -16], [-6, -10], [8, -17], [19, -9], [-24, -4], [2, -3], [24, -2]].map(([x, y]) => (
        <circle key={`${x}:${y}`} cx={x} cy={y} r="3.6" fill={cream} stroke={ink} strokeWidth={DETAIL} />
      ))}
    </g>
  ),
  'crowd-wave': (
    <g>
      <Shadow w={30} />
      {[
        { x: -20, lift: 0, shirt: maroon },
        { x: 0, lift: 8, shirt: gold },
        { x: 20, lift: 0, shirt: blue },
      ].map(({ x, lift, shirt }) => (
        <g key={x} transform={`translate(${x} ${-lift})`}>
          <Band d="M-6 -24 L-11 -40" colour={skin} width={3.6} />
          <Band d="M6 -24 L11 -40" colour={skin} width={3.6} />
          <path d="M-9 0 V-20 a9 9 0 0 1 18 0 V0 Z" fill={shirt} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
          <circle cx="0" cy="-32" r="7" fill={skin} stroke={ink} strokeWidth={OUTLINE} />
          <path d="M-3 -30 q3 3 6 0" fill={ink} stroke={ink} strokeWidth="1" />
        </g>
      ))}
    </g>
  ),
  invader: (
    <g>
      <Shadow w={16} />
      <Band d="M-6 -36 L-18 -46" colour={skin} width={4} />
      <Band d="M6 -36 L18 -28" colour={skin} width={4} />
      <Band d="M-4 -22 L-12 -3" colour={blue} width={5} />
      <Band d="M4 -22 L13 -5" colour={blue} width={5} />
      <rect x="-8" y="-42" width="16" height="22" rx="4" fill={maroon} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="0" cy="-50" r="7.5" fill={skin} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-3 -48 q3 3 6 0" fill="none" stroke={ink} strokeWidth={DETAIL} strokeLinecap="round" />
    </g>
  ),
  covers: (
    <g>
      <Shadow w={32} />
      <path d="M-32 -4 L-24 -30 L30 -30 L22 -4 Z" fill="#3b82f6" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-8 -30 L-14 -4 M8 -30 L2 -4" stroke={cream} strokeWidth="2.4" opacity=".55" />
      <rect x="-26" y="-40" width="58" height="11" rx="5.5" fill="#2563eb" stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-20" cy="-34.5" r="3" fill={cream} stroke={ink} strokeWidth={DETAIL} />
    </g>
  ),
  'drinks-cart': (
    <g>
      <Shadow w={26} />
      <rect x="-24" y="-30" width="46" height="22" rx="4" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-24" y="-30" width="46" height="6" rx="3" fill={maroon} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-20" y="-46" width="9" height="16" rx="2.5" fill="#ffb347" stroke={ink} strokeWidth={DETAIL} />
      <rect x="-7" y="-46" width="9" height="16" rx="2.5" fill="#7fd1ff" stroke={ink} strokeWidth={DETAIL} />
      <rect x="6" y="-46" width="9" height="16" rx="2.5" fill="#b6f27a" stroke={ink} strokeWidth={DETAIL} />
      <Band d="M22 -26 L30 -40" colour={slate} width={3} />
      <circle cx="-14" cy="-6" r="6" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="12" cy="-6" r="6" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
    </g>
  ),
  sightscreen: (
    <g>
      <Shadow w={30} />
      {/* The frame and wheels the screen is pushed around the boundary on. */}
      <rect x="-24" y="-20" width="6" height="16" fill={steel} stroke={ink} strokeWidth={DETAIL} />
      <rect x="18" y="-20" width="6" height="16" fill={steel} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-30" y="-10" width="60" height="6" rx="3" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-22" cy="-3" r="4.5" fill={ink} />
      <circle cx="22" cy="-3" r="4.5" fill={ink} />
      <circle cx="-22" cy="-3" r="1.6" fill={cream} />
      <circle cx="22" cy="-3" r="1.6" fill={cream} />
      {/* The screen: white slats in a dark frame. */}
      <rect x="-30" y="-58" width="60" height="40" rx="3" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-26" y="-54" width="52" height="32" fill="#ffffff" stroke={ink} strokeWidth={DETAIL} />
      <path d="M-26 -46 H26 M-26 -38 H26 M-26 -30 H26" stroke="#d7dde6" strokeWidth="2" />
      <path d="M-20 -50 L-10 -50 L-22 -26 L-26 -26 L-26 -40 Z" fill="#eef5ff" opacity=".9" />
      {/* The glare. */}
      <path d="M24 -62 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  spinner: (
    <g>
      <circle cx="0" cy="-24" r="18" fill={maroon} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-14 -33 Q0 -22 14 -33" fill="none" stroke={cream} strokeWidth="2.4" strokeDasharray="3 2.5" />
      <path d="M-14 -15 Q0 -26 14 -15" fill="none" stroke={cream} strokeWidth="2.4" strokeDasharray="3 2.5" />
      <path d="M-26 -50 q8 -8 16 -2 l-4 4 q-4 -3 -8 2 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <path d="M26 2 q-8 8 -16 2 l4 -4 q4 3 8 -2 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  review: (
    <g>
      <Shadow w={18} />
      <rect x="-5" y="-18" width="10" height="14" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-16" y="-6" width="32" height="6" rx="3" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-30" y="-54" width="60" height="38" rx="5" fill={ink} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-26" y="-50" width="52" height="30" rx="2" fill={blue} />
      <text x="0" y="-30" textAnchor="middle" fontSize="13" fontWeight="900" fill={gold} fontFamily="Arial Black, Arial, sans-serif">
        REVIEW
      </text>
    </g>
  ),
  teacup: (
    <g>
      <Shadow w={22} />
      <path d="M-22 -4 H22 Q20 2 0 2 Q-20 2 -22 -4 Z" fill={cream} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-18 -32 H14 V-16 a12 12 0 0 1 -12 10 h-8 a12 12 0 0 1 -12 -10 Z" fill={cream} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M14 -28 a8 8 0 0 1 0 16" fill="none" stroke={ink} strokeWidth="4.4" />
      <path d="M14 -28 a8 8 0 0 1 0 16" fill="none" stroke={cream} strokeWidth="1.8" />
      <rect x="-18" y="-26" width="32" height="4" fill={maroon} />
      <path d="M-8 -40 q4 -5 0 -10 M2 -40 q4 -5 0 -10" fill="none" stroke="#b9c3d0" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  camera: (
    <g>
      <rect x="-26" y="-42" width="52" height="32" rx="6" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-12" y="-49" width="22" height="9" rx="2.5" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <circle cx="0" cy="-26" r="11" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="0" cy="-26" r="6" fill={blue} stroke={ink} strokeWidth={DETAIL} />
      <circle cx="-2" cy="-28" r="1.8" fill={cream} />
      <rect x="14" y="-38" width="7" height="5" rx="1" fill={gold} stroke={ink} strokeWidth={DETAIL} />
    </g>
  ),
  sunscreen: (
    <g>
      <Shadow w={16} />
      <rect x="-13" y="-42" width="26" height="40" rx="6" fill={orange} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-8" y="-51" width="16" height="10" rx="2.5" fill={cream} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-9" y="-30" width="18" height="12" rx="2" fill={cream} stroke={ink} strokeWidth={DETAIL} />
      <text x="0" y="-20.5" textAnchor="middle" fontSize="9" fontWeight="900" fill={ink} fontFamily="Arial Black, Arial, sans-serif">
        50+
      </text>
      <circle cx="24" cy="-46" r="7" fill={gold} stroke={ink} strokeWidth={DETAIL} />
    </g>
  ),
  wind: (
    <g>
      <Band d="M-30 -40 H8 a7 7 0 1 0 -7 -7" colour={cream} width={4.5} />
      <Band d="M-30 -26 H20 a8 8 0 1 1 -8 8" colour={cream} width={4.5} />
      <Band d="M-24 -12 H4 a5 5 0 1 0 -5 -5" colour={cream} width={4} />
      <path d="M22 -50 q8 -2 10 6 q-8 2 -10 -6 Z" fill={leaf} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <path d="M-30 -52 q6 -6 12 0 q-6 6 -12 0 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  headwind: (
    <g>
      {/* A cloud with its cheeks puffed, blowing back down the course at the snail. */}
      <g transform="translate(6 -24) scale(.86)">
        <path d={CLOUD} fill="#dfe8f2" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
        <circle cx="-14" cy="-12" r="4" fill="#ffb3b3" />
        <circle cx="-8" cy="-17" r="2.2" fill={ink} />
        <circle cx="2" cy="-17" r="2.2" fill={ink} />
        <ellipse cx="-20" cy="-9" rx="3" ry="3.5" fill={ink} />
      </g>
      <Band d="M-24 -36 H-32" colour={cream} width={3.5} />
      <Band d="M-20 -26 H-34" colour={cream} width={3.5} />
      <Band d="M-24 -16 H-32" colour={cream} width={3.5} />
    </g>
  ),
  coffee: (
    <g>
      <Shadow w={16} />
      <path d="M-14 -36 H14 L10 -4 H-10 Z" fill="#8b5a2b" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <rect x="-12" y="-26" width="24" height="9" fill={cream} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-17" y="-43" width="34" height="8" rx="2.5" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-6 -50 q4 -5 0 -10 M4 -50 q4 -5 0 -10" fill="none" stroke="#b9c3d0" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  banana: (
    <g>
      <Shadow w={24} />
      <path d="M-26 -22 Q-6 -2 22 -14 Q26 -10 20 -6 Q-10 8 -30 -16 Z" fill="#f5c400" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-22 -16 Q-6 -2 16 -10" fill="none" stroke="#c99a00" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 -14 l5 -5 l3 3 l-5 5 Z" fill={earth} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  zzz: (
    <g fill={cream} stroke={ink} strokeWidth="3" paintOrder="stroke" strokeLinejoin="round" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900">
      <text x="-24" y="-6" fontSize="18">z</text>
      <text x="-8" y="-22" fontSize="24">z</text>
      <text x="10" y="-40" fontSize="30">z</text>
    </g>
  ),
  letter: (
    <g>
      <Shadow w={24} />
      <rect x="-26" y="-38" width="52" height="34" rx="4" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-26 -38 L0 -18 L26 -38" fill="none" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <rect x="12" y="-34" width="10" height="9" rx="1" fill={maroon} stroke={ink} strokeWidth={DETAIL} />
      <path d="M-28 -50 l6 6 M-20 -54 l2 8" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  heart: (
    <g>
      <path d="M0 -6 C-32 -28 -18 -56 0 -42 C18 -56 32 -28 0 -6 Z" fill="#ff5d7a" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-14 -38 q2 -6 8 -6" fill="none" stroke="#ffd1dc" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  umpire: (
    <g>
      <Shadow w={14} />
      <Band d="M9 -40 L20 -56 L20 -62" colour={skin} width={4.5} />
      <rect x="-10" y="-42" width="20" height="26" rx="4" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <Band d="M-5 -16 L-6 -2" colour={slate} width={5} />
      <Band d="M5 -16 L6 -2" colour={slate} width={5} />
      <circle cx="0" cy="-50" r="8" fill={skin} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-12 -55 H12 L8 -60 H-8 Z" fill={cream} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  megaphone: (
    <g>
      <Shadow w={20} />
      <Band d="M-16 -26 L-18 -12" colour={slate} width={4} />
      <path d="M-28 -36 H-12 L16 -52 V-12 L-12 -28 H-28 Z" fill={maroon} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M16 -52 q6 20 0 40" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-32" y="-37" width="6" height="10" rx="2" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <path d="M24 -40 q5 8 0 16 l-2 -2 q4 -6 0 -12 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <path d="M29 -48 q10 16 0 32 l-3 -2 q8 -14 0 -28 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  swap: (
    <g>
      <Band d="M-26 -38 H18" colour={gold} width={5} />
      <path d="M16 -47 L28 -38 L16 -29 Z" fill={gold} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <Band d="M26 -16 H-18" colour={gold} width={5} />
      <path d="M-16 -25 L-28 -16 L-16 -7 Z" fill={gold} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
    </g>
  ),
  bolt: (
    <g>
      <path d="M6 -60 L-20 -24 H-3 L-10 -2 L20 -36 H3 Z" fill="#ffe36b" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M2 -52 L-12 -28" stroke="#fff6c2" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  clover: (
    <g>
      <Band d="M0 -24 Q2 -10 8 -2" colour={grass} width={3.5} />
      {[0, 90, 180, 270].map((angle) => (
        <path
          key={angle}
          transform={`translate(0 -30) rotate(${angle + 45})`}
          d="M0 0 C-4 -6 -12 -8 -12 -15 A6 6 0 0 1 0 -17 A6 6 0 0 1 12 -15 C12 -8 4 -6 0 0 Z"
          fill={leaf}
          stroke={ink}
          strokeWidth={OUTLINE}
          strokeLinejoin="round"
        />
      ))}
      <circle cx="0" cy="-30" r="3" fill={gold} stroke={ink} strokeWidth={DETAIL} />
    </g>
  ),
  warning: (
    <g>
      <Shadow w={14} />
      <rect x="-3" y="-24" width="6" height="22" fill={steel} stroke={ink} strokeWidth={DETAIL} />
      <path d="M0 -60 L28 -18 H-28 Z" fill={gold} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <rect x="-3" y="-48" width="6" height="16" rx="3" fill={ink} />
      <circle cx="0" cy="-26" r="3.2" fill={ink} />
    </g>
  ),
  slime: (
    <g>
      <path d="M-28 -6 Q-26 -28 -8 -24 Q-2 -42 12 -32 Q30 -34 26 -12 Q30 -2 10 -2 Q-6 4 -28 -6 Z" fill="#8ee05d" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <circle cx="-8" cy="-14" r="3.4" fill="#d6ff9a" />
      <circle cx="10" cy="-20" r="2.4" fill="#d6ff9a" />
      <Drop x={24} y={-40} colour="#8ee05d" />
    </g>
  ),
  puddle: (
    <g>
      {/* A slick of water on the track: the wet patch a snail slides on. */}
      <path d="M-32 -4 Q-30 -14 -14 -13 Q-6 -20 8 -15 Q28 -16 30 -6 Q30 2 10 1 Q-8 4 -24 1 Q-32 0 -32 -4 Z" fill={water} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-18 -7 q6 -3 12 0 M6 -9 q6 -3 12 0" fill="none" stroke={ice} strokeWidth="2.6" strokeLinecap="round" />
      <Drop x={-14} y={-28} />
      <Drop x={4} y={-36} s={1.2} />
      <Drop x={20} y={-26} s={0.9} />
    </g>
  ),
  mud: (
    <g>
      {/* A wet, boggy patch with a reed tuft and a splash: stuck fast. */}
      <path d="M-32 -3 Q-30 -11 -14 -10 Q-4 -14 10 -11 Q30 -12 31 -4 Q30 2 10 1 Q-8 3 -24 1 Q-32 1 -32 -3 Z" fill="#5a3a1e" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-20 -5 q6 -3 12 0 M4 -6 q6 -3 12 0" fill="none" stroke="#a87a4a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M-22 -9 L-26 -30 L-20 -10 L-18 -34 L-15 -10 L-10 -26 L-12 -9 Z" fill={grass} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <Drop x={10} y={-24} colour="#8a5a32" />
      <Drop x={22} y={-30} colour="#8a5a32" s={0.8} />
    </g>
  ),
  gravel: (
    <g>
      <Shadow w={30} />
      {/* A spilled heap of loose stones across the lane. */}
      <path d="M-30 -2 Q-24 -24 -4 -26 Q18 -28 30 -2 Z" fill="#a89a84" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      {[
        [-18, -8, 6, 4.5, '#8c8273'],
        [-4, -14, 7, 5, '#c4b8a4'],
        [12, -9, 6.5, 4.5, '#7d7466'],
        [2, -4, 5, 3.5, '#b3a690'],
        [-10, -20, 5, 3.5, '#9a8f7e'],
        [8, -20, 4.5, 3.2, '#d1c7b5'],
        [22, -5, 4.5, 3.2, '#9a8f7e'],
      ].map(([x, y, rx, ry, fill]) => (
        <ellipse key={`${x}:${y}`} cx={x} cy={y} rx={rx} ry={ry} fill={fill as string} stroke={ink} strokeWidth={DETAIL} />
      ))}
      <ellipse cx="-30" cy="-3" rx="3.5" ry="2.6" fill="#8c8273" stroke={ink} strokeWidth={DETAIL} />
      <ellipse cx="31" cy="-3" rx="3" ry="2.2" fill="#c4b8a4" stroke={ink} strokeWidth={DETAIL} />
    </g>
  ),
  cones: (
    <g>
      <Shadow w={30} />
      {[
        { x: -12, s: 1 },
        { x: 18, s: 0.72 },
      ].map(({ x, s }) => (
        <g key={x} transform={`translate(${x} 0) scale(${s})`}>
          <rect x="-16" y="-6" width="32" height="6" rx="2" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
          <path d="M-12 -6 L-4 -50 H4 L12 -6 Z" fill={orange} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
          <path d="M-8.4 -26 H8.4 L9.6 -18 H-9.6 Z M-5.6 -40 H5.6 L6.6 -34 H-6.6 Z" fill={cream} />
        </g>
      ))}
    </g>
  ),
  tremor: (
    <g>
      {/* The track heaves up and cracks open. */}
      <path d="M-32 0 Q-28 -16 -14 -18 L-6 -26 L4 -18 Q24 -20 32 0 Z" fill={earth} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-6 -26 L-2 -16 L-8 -10 L-2 -2 L4 -10 L0 -16 L4 -18 Z" fill={ink} />
      <path d="M-22 -10 q4 -4 8 0" fill="none" stroke="#b0784a" strokeWidth="2.6" strokeLinecap="round" />
      {[[-18, -32, -12], [18, -32, 12]].map(([x, y, dx]) => (
        <path key={x} d={`M${x} ${y} l${dx / 3} -6 l${dx / 6} 3 l${dx / 3} -7`} fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </g>
  ),
  'ice-pack': (
    <g>
      <Shadow w={22} />
      <rect x="-24" y="-34" width="48" height="30" rx="9" fill={ice} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-6" y="-29" width="12" height="20" rx="2" fill={maroon} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-10" y="-25" width="20" height="12" rx="2" fill={maroon} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-5" y="-29" width="10" height="20" fill={maroon} />
      <rect x="-12" y="-42" width="24" height="9" rx="3" fill={cream} stroke={ink} strokeWidth={DETAIL} />
      <path d="M-18 -18 q2 -6 6 -8" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  freeze: (
    <g>
      <Shadow w={24} />
      {/* A block of ice with a shiver in it. */}
      <rect x="-24" y="-46" width="48" height="44" rx="6" fill={ice} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-18 -40 L-6 -40 L-18 -24 Z" fill="#ffffff" opacity=".85" />
      <circle cx="-7" cy="-26" r="2.4" fill={ink} />
      <circle cx="7" cy="-26" r="2.4" fill={ink} />
      <path d="M-8 -16 l4 -3 l4 3 l4 -3 l4 3" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 -58 v12 M16 -55 l12 6 M28 -55 l-12 6" stroke={blue} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  hand: (
    <g>
      <path d="M-14 -4 V-30 a4 4 0 0 1 8 0 V-40 a4 4 0 0 1 8 0 V-36 a4 4 0 0 1 8 0 V-26 a4 4 0 0 1 8 0 V-14 Q18 2 2 2 H-4 Q-14 2 -14 -4 Z" fill={skin} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-6 -12 q6 4 14 0" fill="none" stroke="#d9a47a" strokeWidth="2.2" strokeLinecap="round" />
    </g>
  ),
  'u-turn': (
    <g>
      <Shadow w={12} />
      <rect x="-3" y="-28" width="6" height="26" fill={steel} stroke={ink} strokeWidth={DETAIL} />
      <circle cx="0" cy="-42" r="20" fill={blue} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-8 -32 V-44 a8 8 0 0 1 16 0 V-40" fill="none" stroke={cream} strokeWidth="4.4" strokeLinecap="round" />
      <path d="M2 -42 L8 -34 L14 -42 Z" fill={cream} />
    </g>
  ),
  dizzy: (
    <g>
      {/* Stars going round: the wobble when the legs go. */}
      <ellipse cx="0" cy="-34" rx="26" ry="9" fill="none" stroke={ink} strokeWidth="3" strokeDasharray="6 5" opacity=".55" />
      {[[-22, -36, 1], [6, -44, 1.2], [22, -30, 0.9]].map(([x, y, s]) => (
        <path
          key={x}
          transform={`translate(${x} ${y}) scale(${s})`}
          d="M0 -9 L2.6 -3 L9 -2.6 L4 1.6 L5.6 8 L0 4.4 L-5.6 8 L-4 1.6 L-9 -2.6 L-2.6 -3 Z"
          fill="#ffe36b"
          stroke={ink}
          strokeWidth={DETAIL}
          strokeLinejoin="round"
        />
      ))}
    </g>
  ),
  /* The twists. */
  ale: (
    <g>
      <Shadow w={20} />
      <path d="M-20 -44 H14 V-4 Q14 0 10 0 H-16 Q-20 0 -20 -4 Z" fill={gold} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M14 -36 h8 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-8" fill="none" stroke={ink} strokeWidth="6" />
      <path d="M14 -36 h8 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-8" fill="none" stroke={gold} strokeWidth="2.4" />
      <path d="M-24 -46 Q-20 -58 -8 -54 Q-2 -64 10 -56 Q22 -58 18 -44 Z" fill={cream} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-12 -36 V-10 M2 -36 V-10" stroke="#fff5cc" strokeWidth="3" strokeLinecap="round" opacity=".8" />
    </g>
  ),
  watermelon: (
    <g>
      <Shadow w={30} />
      <path d="M-30 -4 A30 30 0 0 1 30 -4 Z" fill={grass} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-25 -4 A25 25 0 0 1 25 -4 Z" fill="#ff5a6e" stroke={ink} strokeWidth={DETAIL} />
      <circle cx="-10" cy="-12" r="2.4" fill={ink} />
      <circle cx="4" cy="-19" r="2.4" fill={ink} />
      <circle cx="12" cy="-10" r="2.4" fill={ink} />
      <circle cx="-2" cy="-8" r="2.4" fill={ink} />
    </g>
  ),
  'boom-gate': (
    <g>
      <rect x="-31" y="-22" width="13" height="22" rx="2" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-24.5" cy="-28" r="5.5" fill="#ff3b3b" stroke={ink} strokeWidth={OUTLINE} />
      <g className="prop-gate-arm">
        <rect x="-26" y="-36" width="60" height="9" rx="2.5" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
        <rect x="-14" y="-36" width="10" height="9" fill={maroon} />
        <rect x="6" y="-36" width="10" height="9" fill={maroon} />
        <rect x="26" y="-36" width="7" height="9" fill={maroon} />
      </g>
    </g>
  ),
  rocket: (
    <g>
      <path d="M0 -62 Q16 -44 14 -16 H-14 Q-16 -44 0 -62 Z" fill={cream} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-14 -30 L-26 -12 H-14 Z M14 -30 L26 -12 H14 Z" fill={maroon} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <circle cx="0" cy="-38" r="5.5" fill={blue} stroke={ink} strokeWidth={DETAIL} />
      <path d="M-8 -16 Q0 4 8 -16 Z" fill={orange} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  magnet: (
    <g>
      <path d="M-24 -10 V-34 a24 24 0 0 1 48 0 V-10 H10 V-34 a10 10 0 0 0 -20 0 V-10 Z" fill="#d12a2a" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <rect x="-24" y="-18" width="14" height="10" fill={cream} stroke={ink} strokeWidth={DETAIL} />
      <rect x="10" y="-18" width="14" height="10" fill={cream} stroke={ink} strokeWidth={DETAIL} />
    </g>
  ),
  caterpillar: (
    <g>
      <Shadow w={30} />
      <circle cx="-24" cy="-9" r="8" fill={leaf} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-10" cy="-13" r="8" fill="#6fcf45" stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="4" cy="-9" r="8" fill={leaf} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="18" cy="-13" r="8" fill="#6fcf45" stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="30" cy="-12" r="9" fill={gold} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="33" cy="-14" r="1.8" fill={ink} />
      <path d="M28 -20 l-2 -8 M34 -20 l3 -8" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  bat: (
    <g className="prop-bat">
      <path d="M-6 -2 L-2 -22 L14 -60 Q20 -70 26 -66 Q32 -62 28 -52 L12 -16 L8 2 Z" fill={gold} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-8 4 L-2 -14 L8 -10 L2 8 Z" fill="#5b3a1e" stroke={ink} strokeWidth={OUTLINE} />
      <path d="M30 -70 l6 -6 M36 -58 l8 0 M22 -78 l0 -8" stroke={ink} strokeWidth="2.8" strokeLinecap="round" />
    </g>
  ),
  'speed-camera': (
    <g>
      <rect x="-5" y="-22" width="10" height="22" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <rect x="-26" y="-46" width="52" height="26" rx="5" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-9" cy="-33" r="7.5" fill={blue} stroke={cream} strokeWidth="2.4" />
      <rect x="6" y="-39" width="13" height="9" rx="1.5" fill={cream} stroke={ink} strokeWidth={DETAIL} />
      <path className="prop-flash" d="M-34 -54 l6 6 M34 -54 l-6 6 M0 -58 v8" stroke={gold} strokeWidth="3.4" strokeLinecap="round" />
    </g>
  ),
  sausage: (
    <g>
      <rect x="-30" y="-14" width="60" height="6" rx="2" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <Band d="M-24 -8 L-28 0" colour={slate} width={2.6} />
      <Band d="M24 -8 L28 0" colour={slate} width={2.6} />
      <path d="M-22 -16 Q-24 -30 0 -30 Q24 -30 22 -16 Z" fill="#f2d39a" stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-20" y="-31" width="40" height="10" rx="5" fill="#a8452a" stroke={ink} strokeWidth={DETAIL} />
      <path d="M-14 -26 Q-6 -22 2 -26 T16 -26" fill="none" stroke="#f5c400" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M-10 -38 q-4 -6 0 -10 M2 -40 q-4 -6 0 -10 M14 -38 q-4 -6 0 -10" fill="none" stroke="#b9c3d0" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  kookaburra: (
    <g>
      <rect x="-30" y="-10" width="60" height="6" rx="2" fill="#8a6540" stroke={ink} strokeWidth={DETAIL} />
      <path d="M-10 -10 Q-22 -30 -6 -40 Q8 -46 14 -34 Q18 -22 6 -10 Z" fill="#c9a77c" stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-12 -14 Q-26 -26 -20 -36 Q-12 -30 -4 -18 Z" fill="#6b4a2e" stroke={ink} strokeWidth={DETAIL} />
      <circle cx="6" cy="-38" r="9" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M0 -40 L14 -40" stroke="#6b4a2e" strokeWidth="2.6" />
      <path d="M13 -38 L30 -36 L13 -32 Z" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <circle cx="9" cy="-41" r="1.8" fill={ink} />
      <path d="M20 -50 l4 -4 M26 -46 l6 -2 M16 -54 l1 -6" stroke={gold} strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  trampoline: (
    <g>
      <Band d="M-26 -14 L-22 -1" colour={slate} width={3} />
      <Band d="M26 -14 L22 -1" colour={slate} width={3} />
      <ellipse cx="0" cy="-16" rx="30" ry="7" fill={blue} stroke={ink} strokeWidth={OUTLINE} />
      <ellipse cx="0" cy="-17" rx="22" ry="4" fill="#123a7a" />
      <path d="M-12 -30 Q0 -58 12 -30" fill="none" stroke={gold} strokeWidth="3" strokeDasharray="4 4" />
      <path d="M8 -36 l6 6 l-8 2" fill="none" stroke={gold} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  wombat: (
    <g>
      <Shadow w={28} />
      <ellipse cx="0" cy="-16" rx="26" ry="16" fill="#8a7a6a" stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="20" cy="-22" r="11" fill="#9a8a7a" stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="14" cy="-32" r="4" fill="#8a7a6a" stroke={ink} strokeWidth={DETAIL} />
      <circle cx="26" cy="-32" r="4" fill="#8a7a6a" stroke={ink} strokeWidth={DETAIL} />
      <ellipse cx="28" cy="-19" rx="4" ry="3" fill={ink} />
      <circle cx="20" cy="-25" r="1.8" fill={ink} />
      <path d="M-18 -2 v2 M-6 -1 v2 M8 -1 v2" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
    </g>
  ),
  possum: (
    <g>
      <Shadow w={26} />
      {/* Big eyes, big ears and a curled bushy tail. */}
      <path d="M-14 -12 Q-34 -14 -30 -34 Q-28 -46 -18 -42 Q-24 -32 -16 -24 Z" fill="#6f6a72" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <ellipse cx="-2" cy="-14" rx="16" ry="12" fill="#9b96a0" stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="16" cy="-24" r="11" fill="#9b96a0" stroke={ink} strokeWidth={OUTLINE} />
      <ellipse cx="10" cy="-36" rx="4.5" ry="6" fill="#ffc4d6" stroke={ink} strokeWidth={DETAIL} />
      <ellipse cx="22" cy="-36" rx="4.5" ry="6" fill="#ffc4d6" stroke={ink} strokeWidth={DETAIL} />
      <circle cx="13" cy="-25" r="3.6" fill={ink} />
      <circle cx="21" cy="-25" r="3.6" fill={ink} />
      <circle cx="12" cy="-26" r="1.2" fill={cream} />
      <circle cx="20" cy="-26" r="1.2" fill={cream} />
      <circle cx="27" cy="-20" r="2.2" fill="#ff8fab" stroke={ink} strokeWidth="1" />
      <path d="M-10 -2 v2 M4 -2 v2" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
    </g>
  ),
  mower: (
    <g>
      <Shadow w={28} />
      <rect x="-26" y="-22" width="44" height="14" rx="3" fill={grass} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-6" y="-38" width="14" height="16" rx="2" fill={gold} stroke={ink} strokeWidth={OUTLINE} />
      <Band d="M8 -38 L20 -46" colour={slate} width={3} />
      <circle cx="-16" cy="-6" r="8" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="14" cy="-6" r="6" fill={slate} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-16" cy="-6" r="3" fill={cream} />
      <path d="M-34 -12 q-6 -2 -8 -6 q5 0 8 6 Z M-34 -4 q-7 0 -9 -3 q5 -1 9 3 Z" fill="#7cc96a" stroke={ink} strokeWidth="1.2" />
    </g>
  ),
  'leaf-blower': (
    <g>
      <Shadow w={24} />
      {/* The backpack motor, the tube, and the leaves it is throwing. */}
      <rect x="-28" y="-40" width="20" height="26" rx="5" fill={orange} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="-18" cy="-27" r="6" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <Band d="M-10 -24 Q2 -24 8 -14 L18 -8" colour={slate} width={5} />
      <rect x="-26" y="-14" width="16" height="10" rx="3" fill={slate} stroke={ink} strokeWidth={DETAIL} />
      <path d="M20 -22 q8 -2 10 6 q-8 2 -10 -6 Z" fill={leaf} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <path d="M24 -38 q8 -4 12 3 q-8 4 -12 -3 Z" fill={gold} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <path d="M10 -44 q6 -6 12 0 q-6 6 -12 0 Z" fill={orange} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
    </g>
  ),
  drone: (
    <g>
      {/* A quadcopter out of control, nose down. */}
      <g transform="rotate(-10 0 -34)">
        <rect x="-30" y="-46" width="16" height="4" rx="2" fill={slate} stroke={ink} strokeWidth={DETAIL} />
        <rect x="14" y="-46" width="16" height="4" rx="2" fill={slate} stroke={ink} strokeWidth={DETAIL} />
        <ellipse cx="-22" cy="-50" rx="11" ry="3" fill={ice} stroke={ink} strokeWidth={DETAIL} />
        <ellipse cx="22" cy="-50" rx="11" ry="3" fill={ice} stroke={ink} strokeWidth={DETAIL} />
        <Band d="M-22 -44 L-12 -36 M22 -44 L12 -36" colour={slate} width={2.6} />
        <rect x="-14" y="-42" width="28" height="14" rx="6" fill={cream} stroke={ink} strokeWidth={OUTLINE} />
        <circle cx="0" cy="-26" r="5.5" fill={slate} stroke={ink} strokeWidth={DETAIL} />
        <circle cx="0" cy="-26" r="2.4" fill={blue} />
        <circle cx="9" cy="-36" r="2" fill="#ff3b3b" />
      </g>
    </g>
  ),
  'lucky-dip': (
    <g>
      <Shadow w={22} />
      {/* A prize sack, tied off, with a question mark on it. */}
      <path d="M-22 -4 Q-30 -28 -10 -36 L-14 -44 Q0 -40 14 -44 L10 -36 Q30 -28 22 -4 Q0 2 -22 -4 Z" fill="#c98a4b" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <rect x="-12" y="-40" width="24" height="5" rx="2.5" fill={maroon} stroke={ink} strokeWidth={DETAIL} />
      <text x="0" y="-9" textAnchor="middle" fontSize="24" fontWeight="900" fill={cream} stroke={ink} strokeWidth="2.6" paintOrder="stroke" fontFamily="Arial Black, Arial, sans-serif">
        ?
      </text>
    </g>
  ),
  /* The set pieces, drawn flat so they sit in the same cartoon as the snails and the town. */
  'pitch-roller': (
    <g>
      <Shadow w={28} />
      {/* The handle, as a solid bar with a grip. */}
      <Band d="M-4 -30 L-28 -54" colour={gold} width={5} />
      <rect x="-40" y="-60" width="16" height="9" rx="4" fill={maroon} stroke={ink} strokeWidth={OUTLINE} transform="rotate(-45 -32 -55.5)" />
      {/* The yoke over the drum. */}
      <path d="M-18 -22 A22 22 0 0 1 26 -22 L20 -22 A16 16 0 0 0 -12 -22 Z" fill={maroon} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      {/* The heavy drum. */}
      <circle cx="4" cy="-21" r="19" fill="#5f7d4e" stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="4" cy="-21" r="12" fill="#86a86e" stroke={ink} strokeWidth={DETAIL} />
      <circle cx="4" cy="-21" r="4.5" fill={gold} stroke={ink} strokeWidth={DETAIL} />
      <path d="M-8 -32 q5 -5 12 -5" fill="none" stroke="#a9c792" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  lettuce: (
    <g>
      <Shadow w={30} />
      <rect x="-28" y="-22" width="56" height="22" rx="3" fill="#b07a3c" stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-28 -14 h56 M-28 -7 h56" stroke={ink} strokeWidth="1.4" opacity=".5" />
      <path d="M-26 -22 q-8 -16 6 -22 q4 -12 16 -8 q10 -10 20 0 q12 -4 12 10 q8 8 -4 20 Z" fill={leaf} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-18 -30 q6 -8 14 -2 M2 -38 q8 -6 14 2" fill="none" stroke={leafDark} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  plague: (
    <g>
      <path d="M-30 -14 a12 12 0 0 1 10 -22 a14 14 0 0 1 26 -6 a13 13 0 0 1 22 10 a10 10 0 0 1 0 20 H-24 a9 9 0 0 1 -6 -2 Z" fill="#8c57c7" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-16 -22 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0 M8 -28 a5 5 0 1 1 10 0 a5 5 0 1 1 -10 0" fill="#b7ee63" stroke={ink} strokeWidth={DETAIL} />
      <circle cx="-9" cy="-22" r="2.2" fill={ink} />
      <circle cx="13" cy="-28" r="1.8" fill={ink} />
      <Drop x={-20} y={-4} colour="#b7ee63" />
      <Drop x={0} y={-2} colour="#b7ee63" s={0.85} />
      <Drop x={20} y={-4} colour="#b7ee63" />
    </g>
  ),
  'cricket-ball': (
    <g>
      <Shadow w={18} />
      <circle cx="0" cy="-19" r="18" fill={maroon} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-6 -35 q-6 16 0 32 M6 -35 q6 16 0 32" fill="none" stroke={cream} strokeWidth="2" strokeDasharray="2.4 2.4" />
      <path d="M-10 -30 q4 -4 9 -4" fill="none" stroke="#e8545a" strokeWidth="3" strokeLinecap="round" />
      <path d="M-26 -26 h-8 M-28 -16 h-10 M-24 -6 h-7" stroke={ink} strokeWidth="3" strokeLinecap="round" opacity=".55" />
    </g>
  ),
  sprinkler: (
    <g>
      <Shadow w={18} />
      {/* A garden sprinkler on its spike, throwing fat drops either side. */}
      <path d="M-14 -2 Q-14 -12 0 -12 Q14 -12 14 -2 Z" fill={grass} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <rect x="-4" y="-28" width="8" height="17" rx="2" fill={steel} stroke={ink} strokeWidth={OUTLINE} />
      <rect x="-15" y="-36" width="30" height="10" rx="5" fill={gold} stroke={ink} strokeWidth={OUTLINE} />
      <circle cx="0" cy="-31" r="2.6" fill={ink} />
      <path d="M-15 -34 Q-26 -46 -30 -38 Q-24 -38 -15 -30 Z" fill={water} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <path d="M15 -34 Q26 -46 30 -38 Q24 -38 15 -30 Z" fill={water} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
      <Drop x={-24} y={-52} />
      <Drop x={24} y={-52} />
      <Drop x={-8} y={-50} s={0.85} />
      <Drop x={8} y={-50} s={0.85} />
      <Drop x={-30} y={-26} s={0.8} />
      <Drop x={30} y={-26} s={0.8} />
    </g>
  ),
  dog: (
    <g>
      <Shadow w={26} />
      <path d="M-28 -6 q-4 -22 10 -24 h26 q12 0 14 12 l2 12 Z" fill="#d9a066" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-26 -6 v6 M-14 -6 v6 M10 -6 v6 M20 -6 v6" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="24" cy="-32" r="11" fill="#d9a066" stroke={ink} strokeWidth={OUTLINE} />
      <path d="M14 -40 q-6 -10 2 -12 q4 4 2 12 Z" fill="#b5804a" stroke={ink} strokeWidth={DETAIL} />
      <circle cx="33" cy="-32" r="2.6" fill={ink} />
      <circle cx="27" cy="-36" r="1.8" fill={ink} />
      <Band d="M-28 -24 q-10 -6 -8 -16" colour="#d9a066" width={3} />
      <path d="M28 -24 q4 6 0 8 q-3 -2 0 -8 Z" fill="#e05a5a" stroke={ink} strokeWidth="1.2" />
    </g>
  ),
  magpie: (
    <g>
      <path d="M-26 -34 q10 -12 24 -8 l20 8 q6 2 10 10 l-6 2 l-14 -2 l-20 8 Z" fill={ink} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-14 -36 q8 -4 16 0 l-6 10 Z" fill={cream} />
      <path d="M8 -28 l-10 14 l18 -6 Z" fill={cream} stroke={ink} strokeWidth="1.2" />
      <circle cx="18" cy="-36" r="2" fill={cream} />
      <path d="M28 -32 l10 2 l-10 3 Z" fill={gold} stroke={ink} strokeWidth="1.2" />
      <path d="M-6 -46 q-2 -6 -8 -4 M-16 -50 q-2 -6 -8 -3" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" opacity=".6" />
    </g>
  ),
  boot: (
    <g>
      <Shadow w={26} />
      <path d="M-18 -54 h26 v26 q16 2 22 14 q2 8 -6 12 h-42 Z" fill="#6b4a2e" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M-20 -2 h50 q4 0 4 -4 v-2 h-54 Z" fill={ink} />
      <path d="M-18 -54 h26 v6 h-26 Z" fill="#8a6540" />
      <path d="M-10 -44 l12 -4 M-10 -36 l12 -4 M-10 -28 l12 -4" stroke={gold} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="-12" cy="-45" r="1.8" fill={gold} />
      <circle cx="2" cy="-49" r="1.8" fill={gold} />
    </g>
  ),
  bee: (
    <g>
      <ellipse cx="0" cy="-28" rx="18" ry="12" fill={gold} stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-8 -40 v24 M2 -40 v24 M11 -38 v20" stroke={ink} strokeWidth="4" />
      <ellipse cx="-8" cy="-44" rx="10" ry="6" fill={cream} stroke={ink} strokeWidth={DETAIL} opacity=".95" />
      <ellipse cx="8" cy="-44" rx="10" ry="6" fill={cream} stroke={ink} strokeWidth={DETAIL} opacity=".95" />
      <circle cx="16" cy="-30" r="2.2" fill={ink} />
      <path d="M-18 -26 l-8 2 l8 3 Z" fill={ink} />
      <path d="M-26 -14 q-6 4 -10 10" fill="none" stroke={ink} strokeWidth="2" strokeDasharray="2 3" />
    </g>
  ),
};

/**
 * A prop. `animated` swaps in the moving version where one exists (see
 * `prop-animated.tsx`); every other prop gets a gentle idle motion from the
 * stylesheet, so nothing on the course stands dead still.
 */
export function PropGlyph({ id, animated = false }: { id: PropGlyphId; animated?: boolean }) {
  const moving = animated ? ANIMATED_GLYPHS[id] : undefined;
  return (
    <g className={`course-prop-glyph${animated ? (moving ? ' is-animated' : ' is-idle') : ''}`} data-glyph={id}>
      {moving ?? PROP_GLYPHS[id]}
    </g>
  );
}
