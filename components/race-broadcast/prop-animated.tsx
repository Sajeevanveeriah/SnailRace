import type { ReactNode } from 'react';
import type { PropGlyphId } from './prop-glyphs';

/**
 * Animated versions of the props that carry the night's big gags. Same
 * 64 x 64 box and the same bottom-centre origin as `prop-glyphs.tsx`, same
 * ink outline and palette, but built from moving parts: the magpie's wings
 * flap and its beak snaps, the roller's drum turns, the plague's swarm
 * circles, the sprinkler swings and throws water. The motion is all CSS
 * (`pa-*` classes in `race-broadcast.css`) on parts inside a prop's own
 * compositor layer, so it costs the track nothing.
 *
 * Each moving part is drawn around (0, 0) inside a group that places it, so
 * its rotation or scale turns about the right point (a wing about its
 * shoulder, a drum about its axle) without `transform-box` guesswork.
 */

const ink = '#24171b';
const cream = '#fff9ed';
const gold = '#e8b55e';
const maroon = '#b3141c';
const water = '#3b93e6';
const leaf = '#8ee05d';
const leafDark = '#4fae2e';
const grass = '#2f8f3a';
const steel = '#8d97a6';
const slate = '#3a3f4a';
const OUTLINE = 2.4;
const DETAIL = 1.6;

const Shadow = ({ w = 28 }: { w?: number }) => <ellipse className="pa-shadow" cx="0" cy="-1" rx={w} ry="3.5" fill="#000" opacity=".18" />;

const drop = 'M0 -6 C3 -2 4.5 1 4.5 3 A4.5 4.5 0 0 1 -4.5 3 C-4.5 1 -3 -2 0 -6 Z';
const Drop = ({ x, y, s = 1, colour = water, className, delay = 0 }: { x: number; y: number; s?: number; colour?: string; className?: string; delay?: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <path className={className} style={delay ? { animationDelay: `${delay}s` } : undefined} transform={`scale(${s})`} d={drop} fill={colour} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
  </g>
);

/** One fly of a swarm: a dark body and two pale wings that blur. */
const Fly = ({ r, delay, size = 1, reverse = false }: { r: number; delay: number; size?: number; reverse?: boolean }) => (
  <g className={reverse ? 'pa-orbit pa-orbit-rev' : 'pa-orbit'} style={{ animationDelay: `${delay}s` }}>
    <g transform={`translate(${r} 0) scale(${size})`}>
      <ellipse cx="0" cy="0" rx="3.2" ry="2.2" fill={ink} />
      <g className="pa-buzz">
        <ellipse cx="-1" cy="-2.6" rx="2.4" ry="1.5" fill="#e9f7ff" stroke={ink} strokeWidth=".7" />
        <ellipse cx="1.4" cy="-2.4" rx="2.4" ry="1.5" fill="#e9f7ff" stroke={ink} strokeWidth=".7" />
      </g>
    </g>
  </g>
);

export const ANIMATED_GLYPHS: Partial<Record<PropGlyphId, ReactNode>> = {
  /* An Australian magpie on the attack: black and white, red eye, pale beak, wings flapping. */
  magpie: (
    <g className="pa-magpie">
      <Shadow w={16} />
      <g className="pa-dive">
        {/* Far wing, behind the body. */}
        <g transform="translate(-4 -40)">
          <g className="pa-flap pa-flap-far">
            <path d="M0 0 C-8 -14 -26 -22 -40 -20 C-30 -14 -26 -8 -20 -4 C-26 -4 -30 0 -32 4 C-20 4 -10 4 0 2 Z" fill="#2c2226" stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
          </g>
        </g>
        {/* Tail. */}
        <path d="M-18 -36 L-38 -32 L-36 -26 L-16 -30 Z" fill={ink} stroke={ink} strokeWidth={DETAIL} strokeLinejoin="round" />
        <path d="M-30 -33 L-36 -32 L-35 -28 L-30 -29 Z" fill={cream} />
        {/* Body: black breast, white nape and back. */}
        <path d="M-20 -36 C-16 -46 0 -48 12 -44 C18 -42 22 -36 20 -30 C12 -24 -6 -24 -18 -30 Z" fill={ink} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
        <path d="M-14 -40 C-6 -46 6 -47 13 -44 L10 -39 C2 -41 -6 -39 -12 -36 Z" fill={cream} />
        {/* Legs tucked. */}
        <path d="M0 -26 l-3 6 M6 -26 l1 6" stroke={slate} strokeWidth="2" strokeLinecap="round" />
        {/* Head with the snapping beak. */}
        <g transform="translate(20 -42)">
          <circle cx="0" cy="0" r="8.5" fill={ink} stroke={ink} strokeWidth={OUTLINE} />
          <circle cx="3" cy="-2" r="2.2" fill="#d12a2a" stroke={cream} strokeWidth=".8" />
          <circle cx="3.4" cy="-2.2" r=".8" fill={ink} />
          <path d="M5 -6 q4 -2 3 2" fill="none" stroke={cream} strokeWidth="1.2" opacity=".9" />
          <g transform="translate(7 1)">
            <path className="pa-beak-top" d="M0 -3 L14 0 L0 1 Z" fill="#d9dde3" stroke={ink} strokeWidth="1.1" strokeLinejoin="round" />
            <path className="pa-beak-low" d="M0 1 L12 2 L0 4 Z" fill="#b9c0c8" stroke={ink} strokeWidth="1.1" strokeLinejoin="round" />
          </g>
        </g>
        {/* Near wing, white shoulder patch, over the body. */}
        <g transform="translate(-2 -38)">
          <g className="pa-flap">
            <path d="M0 0 C-6 -16 -22 -28 -40 -28 C-30 -20 -28 -14 -22 -8 C-28 -8 -32 -4 -34 2 C-22 4 -10 4 0 2 Z" fill={ink} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
            <path d="M-4 -2 C-8 -10 -14 -16 -22 -18 C-18 -12 -14 -8 -10 -3 Z" fill={cream} />
          </g>
        </g>
        {/* The swoop call. */}
        <g className="pa-squawk">
          <path d="M40 -48 l6 -4 M42 -40 l8 0 M40 -32 l6 4" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </g>
    </g>
  ),

  /* The pitch roller: the drum turns, clippings fly, and it trundles. */
  'pitch-roller': (
    <g className="pa-roller">
      <Shadow w={30} />
      <g className="pa-trundle">
        <path d="M-4 -30 L-28 -54" stroke={ink} strokeWidth={5 + OUTLINE * 1.4} strokeLinecap="round" />
        <path d="M-4 -30 L-28 -54" stroke={gold} strokeWidth={5} strokeLinecap="round" />
        <rect x="-40" y="-60" width="16" height="9" rx="4" fill={maroon} stroke={ink} strokeWidth={OUTLINE} transform="rotate(-45 -32 -55.5)" />
        <path d="M-18 -22 A22 22 0 0 1 26 -22 L20 -22 A16 16 0 0 0 -12 -22 Z" fill={maroon} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
        <g transform="translate(4 -21)">
          <g className="pa-spin">
            <circle cx="0" cy="0" r="19" fill="#5f7d4e" stroke={ink} strokeWidth={OUTLINE} />
            <circle cx="0" cy="0" r="12" fill="#86a86e" stroke={ink} strokeWidth={DETAIL} />
            <path d="M0 -19 V19 M-19 0 H19 M-13.4 -13.4 L13.4 13.4 M13.4 -13.4 L-13.4 13.4" stroke={ink} strokeWidth="1.8" opacity=".55" />
            <circle cx="0" cy="0" r="4.5" fill={gold} stroke={ink} strokeWidth={DETAIL} />
            <circle cx="0" cy="-15.5" r="2.2" fill={cream} stroke={ink} strokeWidth="1" />
          </g>
        </g>
      </g>
      {[0, 0.25, 0.5].map((d, i) => (
        <path key={i} className="pa-clip" style={{ animationDelay: `${d}s` }} d={`M${-16 - i * 4} -4 l-3 -4 l2 -1 l3 4 Z`} fill={leafDark} stroke={ink} strokeWidth=".8" />
      ))}
    </g>
  ),

  /* The plague: a sick purple cloud, pulsing, its swarm circling and green drips falling. */
  plague: (
    <g className="pa-plague">
      <Shadow w={30} />
      <g transform="translate(0 -26)">
        <g className="pa-pulse">
          <path d="M-30 12 a12 12 0 0 1 10 -22 a14 14 0 0 1 26 -6 a13 13 0 0 1 22 10 a10 10 0 0 1 0 20 H-24 a9 9 0 0 1 -6 -2 Z" fill="#8c57c7" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
          <path d="M-16 4 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0 M8 -2 a5 5 0 1 1 10 0 a5 5 0 1 1 -10 0" fill="#b7ee63" stroke={ink} strokeWidth={DETAIL} />
          <circle className="pa-blink" cx="-9" cy="4" r="2.2" fill={ink} />
          <circle className="pa-blink" cx="13" cy="-2" r="1.8" fill={ink} />
          <path d="M-8 12 q4 -3 8 0" fill="none" stroke={ink} strokeWidth={DETAIL} strokeLinecap="round" />
        </g>
        <Fly r={30} delay={0} />
        <Fly r={24} delay={-0.4} size={0.9} reverse />
        <Fly r={36} delay={-0.9} size={0.8} />
        <Fly r={20} delay={-1.3} size={0.85} reverse />
        <Fly r={33} delay={-1.7} size={1.1} reverse />
        <Fly r={27} delay={-2.1} size={0.75} />
      </g>
      <Drop x={-18} y={-8} colour="#b7ee63" className="pa-drip" />
      <Drop x={2} y={-6} colour="#b7ee63" s={0.85} className="pa-drip" delay={0.35} />
      <Drop x={20} y={-8} colour="#b7ee63" className="pa-drip" delay={0.7} />
    </g>
  ),

  /* A garden sprinkler: the head swings, water arcs out both sides. */
  sprinkler: (
    <g className="pa-sprinkler">
      <Shadow w={20} />
      <path d="M-14 -2 Q-14 -12 0 -12 Q14 -12 14 -2 Z" fill={grass} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <rect x="-4" y="-28" width="8" height="17" rx="2" fill={steel} stroke={ink} strokeWidth={OUTLINE} />
      <g transform="translate(0 -31)">
        <g className="pa-swing">
          <rect x="-15" y="-5" width="30" height="10" rx="5" fill={gold} stroke={ink} strokeWidth={OUTLINE} />
          <circle cx="0" cy="0" r="2.6" fill={ink} />
          {/* The jets: drops leave the nozzles and fly out in arcs. */}
          {[0, 0.18, 0.36, 0.54].map((d) => (
            <g key={`l${d}`}>
              <circle className="pa-jet-l" style={{ animationDelay: `${d}s` }} cx="-15" cy="-2" r="3" fill={water} stroke={ink} strokeWidth="1" />
              <circle className="pa-jet-r" style={{ animationDelay: `${d + 0.09}s` }} cx="15" cy="-2" r="3" fill={water} stroke={ink} strokeWidth="1" />
            </g>
          ))}
          <path className="pa-mist" d="M-15 -3 Q-34 -26 -46 -6 M15 -3 Q34 -26 46 -6" fill="none" stroke="#9fd0ff" strokeWidth="5" strokeLinecap="round" opacity=".55" />
        </g>
      </g>
      <ellipse className="pa-puddle" cx="0" cy="-1" rx="34" ry="3" fill="#7fbdf5" opacity=".5" />
    </g>
  ),

  /* A crate of lettuce, leaves shaking as they are munched, bits flying. */
  lettuce: (
    <g className="pa-lettuce">
      <Shadow w={30} />
      <rect x="-28" y="-22" width="56" height="22" rx="3" fill="#b07a3c" stroke={ink} strokeWidth={OUTLINE} />
      <path d="M-28 -14 h56 M-28 -7 h56" stroke={ink} strokeWidth="1.4" opacity=".5" />
      <g transform="translate(0 -22)">
        <g className="pa-wobble">
          <path d="M-26 0 q-8 -16 6 -22 q4 -12 16 -8 q10 -10 20 0 q12 -4 12 10 q8 8 -4 20 Z" fill={leaf} stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
          <path d="M-18 -8 q6 -8 14 -2 M2 -16 q8 -6 14 2" fill="none" stroke={leafDark} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </g>
      {[[-10, 0], [6, 0.3], [16, 0.6]].map(([x, d]) => (
        <path key={x} className="pa-crumb" style={{ animationDelay: `${d}s` }} d={`M${x} -40 q3 -4 6 0 q-3 3 -6 0 Z`} fill={leaf} stroke={ink} strokeWidth=".8" />
      ))}
    </g>
  ),

  /* A new cricket ball, seam spinning, bouncing through. */
  'cricket-ball': (
    <g className="pa-ball">
      <ellipse className="pa-ball-shadow" cx="0" cy="-1" rx="18" ry="3.5" fill="#000" opacity=".2" />
      <g className="pa-bounce">
        <g transform="translate(0 -19)">
          <g className="pa-spin pa-spin-fast">
            <circle cx="0" cy="0" r="18" fill={maroon} stroke={ink} strokeWidth={OUTLINE} />
            <path d="M-6 -16 q-6 16 0 32 M6 -16 q6 16 0 32" fill="none" stroke={cream} strokeWidth="2" strokeDasharray="2.4 2.4" />
            <path d="M-10 -11 q4 -4 9 -4" fill="none" stroke="#e8545a" strokeWidth="3" strokeLinecap="round" />
          </g>
        </g>
        <path className="pa-speed" d="M-26 -26 h-8 M-28 -16 h-10 M-24 -6 h-7" stroke={ink} strokeWidth="3" strokeLinecap="round" opacity=".55" />
      </g>
    </g>
  ),

  /* A kelpie on the loose: legs going, tail wagging, tongue out. */
  dog: (
    <g className="pa-dog">
      <Shadow w={26} />
      <g className="pa-trot">
        <g transform="translate(-28 -24)"><g className="pa-wag"><path d="M0 0 q-10 -6 -8 -16" fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round" /><path d="M0 0 q-10 -6 -8 -16" fill="none" stroke="#d9a066" strokeWidth="3.4" strokeLinecap="round" /></g></g>
        {[[-24, 'a'], [-12, 'b'], [10, 'b'], [20, 'a']].map(([x, k]) => (
          <g key={`${x}`} transform={`translate(${x} -8)`}>
            <g className={`pa-leg pa-leg-${k}`}><path d="M0 0 v9" stroke={ink} strokeWidth="4.4" strokeLinecap="round" /></g>
          </g>
        ))}
        <path d="M-28 -6 q-4 -22 10 -24 h26 q12 0 14 12 l2 12 Z" fill="#d9a066" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
        <path d="M-20 -26 h20 q6 0 8 6 h-30 Z" fill="#3a2a20" opacity=".55" />
        <circle cx="24" cy="-32" r="11" fill="#d9a066" stroke={ink} strokeWidth={OUTLINE} />
        <path d="M14 -40 q-6 -10 2 -12 q4 4 2 12 Z" fill="#b5804a" stroke={ink} strokeWidth={DETAIL} />
        <circle cx="33" cy="-32" r="2.6" fill={ink} />
        <circle cx="27" cy="-36" r="1.8" fill={ink} />
        <g transform="translate(28 -24)"><path className="pa-tongue" d="M0 0 q4 6 0 8 q-3 -2 0 -8 Z" fill="#e05a5a" stroke={ink} strokeWidth="1.2" /></g>
      </g>
    </g>
  ),

  /* A bee: wings a blur, zig-zagging. */
  bee: (
    <g className="pa-bee">
      <g className="pa-zigzag">
        <g transform="translate(0 -44)">
          <g className="pa-buzz">
            <ellipse cx="-8" cy="0" rx="10" ry="6" fill={cream} stroke={ink} strokeWidth={DETAIL} opacity=".95" />
            <ellipse cx="8" cy="0" rx="10" ry="6" fill={cream} stroke={ink} strokeWidth={DETAIL} opacity=".95" />
          </g>
        </g>
        <ellipse cx="0" cy="-28" rx="18" ry="12" fill={gold} stroke={ink} strokeWidth={OUTLINE} />
        <path d="M-8 -40 v24 M2 -40 v24 M11 -38 v20" stroke={ink} strokeWidth="4" />
        <circle cx="16" cy="-30" r="2.2" fill={ink} />
        <path d="M-18 -26 l-8 2 l8 3 Z" fill={ink} />
      </g>
    </g>
  ),

  /* The rain cloud: drops fall on a loop. */
  'rain-cloud': (
    <g className="pa-rain">
      <g transform="translate(0 -30)">
        <g className="pa-drift">
          <path d="M-28 0 a11 11 0 0 1 4 -20 a14 14 0 0 1 24 -10 a14 14 0 0 1 26 6 a11 11 0 0 1 2 24 Z" fill="#8fa3bf" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
          <path d="M-12 -12 q4 3 8 0 M6 -12 q4 3 8 0" fill="none" stroke={ink} strokeWidth={DETAIL} strokeLinecap="round" />
        </g>
      </g>
      {[[-18, 0], [-6, 0.2], [6, 0.45], [18, 0.1], [-12, 0.6], [12, 0.75]].map(([x, d]) => (
        <Drop key={`${x}:${d}`} x={x} y={-24} s={0.85} className="pa-fall" delay={d} />
      ))}
    </g>
  ),

  hail: (
    <g className="pa-hail">
      <g transform="translate(0 -32)">
        <g className="pa-drift">
          <path d="M-28 0 a11 11 0 0 1 4 -20 a14 14 0 0 1 24 -10 a14 14 0 0 1 26 6 a11 11 0 0 1 2 24 Z" fill="#5d6b82" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
          <path d="M-15 -16 l8 3 M15 -16 l-8 3" stroke={ink} strokeWidth={2.4} strokeLinecap="round" />
        </g>
      </g>
      {[[-18, 0], [-6, 0.25], [8, 0.5], [20, 0.12], [-24, 0.62], [2, 0.38], [24, 0.8]].map(([x, d]) => (
        <g key={`${x}:${d}`} transform={`translate(${x} -26)`}>
          <circle className="pa-fall" style={{ animationDelay: `${d}s` }} cx="0" cy="0" r="3.6" fill={cream} stroke={ink} strokeWidth={DETAIL} />
        </g>
      ))}
    </g>
  ),

  /* The big boot: stomps, with a dust ring each time it lands. */
  boot: (
    <g className="pa-boot">
      <Shadow w={26} />
      <g className="pa-stomp">
        <path d="M-18 -54 h26 v26 q16 2 22 14 q2 8 -6 12 h-42 Z" fill="#6b4a2e" stroke={ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
        <path d="M-20 -2 h50 q4 0 4 -4 v-2 h-54 Z" fill={ink} />
        <path d="M-18 -54 h26 v6 h-26 Z" fill="#8a6540" />
        <path d="M-10 -44 l12 -4 M-10 -36 l12 -4 M-10 -28 l12 -4" stroke={gold} strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <ellipse className="pa-dust" cx="0" cy="-3" rx="30" ry="6" fill="none" stroke="#c9b08a" strokeWidth="3" />
    </g>
  ),
};

/** True when a prop has moving parts of its own. */
export const isAnimatedGlyph = (id: PropGlyphId): boolean => id in ANIMATED_GLYPHS;
