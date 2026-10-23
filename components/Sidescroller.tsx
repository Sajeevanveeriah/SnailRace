'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { laneColour } from '@/lib/palette';
import { ClubBrand } from './brand/ClubBrand';
import { presentationForMoment, type SurprisePresentation } from './race-broadcast/surprise-presentation';
import { PropGlyph } from './race-broadcast/prop-glyphs';
import { useReducedMotion } from './race-broadcast/useReducedMotion';
import { OfficialResult } from './race-broadcast/BroadcastGraphics';
import { frameClockMs, smoothDamp } from './race-broadcast/circuit-camera';
import { clockText } from '@/lib/broadcast';
import { sponsorsFromRace } from '@/lib/club-sponsors';
import { ordinal, type SnailRun } from '@/lib/race-engine';
import { STORY_CARD_MS, STORY_GAP_MS, STORY_READ_MS, type PaintInfo, type RaceController, type RacePainter, type SurprisePhase } from '@/lib/use-race';
import type { CameraMode, LockedRaceEvent, RaceResult, ToteDividend } from '@/lib/types';
import {
  ART_NOSE,
  ART_SHELL_Y,
  ART_TAIL,
  CROWD_BASE,
  FULL_VIEW_EXTRA,
  RACE_METRES,
  requiredViewH,
  START_X,
  TRACK_BOTTOM,
  TRACK_TOP,
  VIEW_H,
  featuredLane,
  fenceSlots,
  flagFont,
  FLAG_FONT,
  FLAG_H_MAX,
  isFieldTwist,
  laneGeometry,
  propLanes,
  runInStep,
  splashKicker,
  straightTrack,
  type RunInRunner,
  type StraightTrack,
} from './sidescroller-geometry';

export { TRACK_LEN, RACE_METRES, laneGeometry, type LaneGeometry } from './sidescroller-geometry';
import { SponsorBadge } from './SponsorLogo';

/**
 * The side-on cartoon race.
 *
 * Shot the way a race night audience already knows from horse racing and
 * the cartoon race-night films: a straight seen side on from the stand, one
 * snail per marked lane in racecard order (lowest number on top), starting
 * stalls that open at the off, distance posts counting down to a vertical
 * winning post, and a running-order strip along the bottom that names the
 * leaders. The first nose to the post is the winner on screen, as it is in
 * the result.
 *
 * Every snail stands inside its own lane and carries its name on a flag
 * behind it, so the room can read who is who anywhere on the track. The
 * camera rides with the leading pack, frames the winning post for the run
 * home, and holds on the line for the photo once the winner is in.
 *
 * Surprises are physical gags, one at a time. Every twist is staged from
 * the locked plan itself: an INCOMING card names it and its prop looms in
 * front of each runner it will hit, then the card turns to TWIST, BOOST or
 * OUT as the prop lands. Props sit in the target's own lane just ahead of
 * its nose and the snails are always drawn above them.
 *
 * Same painter seam as the oval: the engine hands over one progress number
 * per snail per frame and this only decides where on the screen it lands.
 * Everything is drawn in code so nothing depends on the projector laptop's
 * fonts or on anyone else's artwork.
 */

interface Props {
  names: string[];
  owners?: string[];
  race: RaceController;
  calm: boolean;
  clubName: string;
  raceNo: number;
  cameraMode?: CameraMode;
  fullCourse?: boolean;
  onCourseViewChange?: (value: boolean) => void;
  sponsor?: string;
  /** The sponsored race's own name, shown on the banner over the line. */
  sponsorTitle?: string;
  sponsors?: string[];
  /** How long the straight is, in metres: the snails cover it at the night's pace in the race's time. */
  metres?: number;
  toteResult?: ToteDividend | null;
  numberOffset?: number;
  /** Snail number per lane when the field is not consecutive (a run-off). */
  numbers?: number[];
  replay?: boolean;
}

/** Kept for the oval's import shape; the straight follows the field instead. */
export const LEAD_PACK = 4;

/** The narrowest shot, in world units: close enough that a snail is a real size. */
const PACK_VIEW_W = 1900;
/** The widest the following shot goes before it lets the tail of the field go. */
const FOLLOW_MAX_W = 3000;
/** The straight camera's pan and zoom settle times, in seconds. */
const CAM_PAN_S = 0.35;
const CAM_ZOOM_S = 0.6;
/** The opening shot starts at least this far back; further when the name flags need it. */
const OPEN_X = -460;
/** From here to the post the winning post is always in the shot. */
const FRAME_FINISH_FROM = 0.82;
/** Where the winning post sits across the frame while the camera holds on the line. */
const FINISH_HOLD_AT = 0.6;
/** The photo-finish still, before the rest of the field runs in. */
const PHOTO_MS = 750;
/** For the first second the running order stays in draw order: nobody has gone anywhere yet. */
const ORDER_FROZEN_MS = 1000;
/** A glyph is 64 units square, drawn at 6x inside the prop. */
const GLYPH_UNITS = 64 * 6;
/** How tall a prop stands, in lanes. */
const PROP_LANES = 1.9;
/** A prop's own layer, in its unscaled units: room for the glyph and for it to swoop, loom and bounce. */
const PROP_BOX = { x: -720, y: -1000, w: 1440, h: 1240 };

/* ── Scenery, repeating ───────────────────────────────────────────────── */

const SCENE_W = 3200;

/*
 * Each depth of the picture (sky, hills, lake, buildings, the track world and
 * the crowd) is painted once into its own layer and slid by the camera with a
 * CSS transform. Moving a painted layer is nearly free; re-drawing the whole
 * scene every frame, which a changing viewBox forces, made the following
 * shot stutter.
 */
const LAYER_TOP = VIEW_H - 1700;
const LAYER_H = 1820 + FULL_VIEW_EXTRA;
/** Local box of a repeating scenery layer: three copies and a margin. */
const SCENERY_BOX = { x: -400, w: SCENE_W * 3 + 800 };
/** Left edge of the track world, wide enough for any shot the camera takes; it runs 1500 past the post. */
const WORLD_X = -1500;
const worldBoxOf = (track: StraightTrack) => ({ x: WORLD_X, w: track.trackLen + 1500 - WORLD_X });
type LayerName = 'sky' | 'mountains' | 'lake' | 'buildings' | 'world' | 'crowd';
/*
 * The crowd moves with the track but repeats, so it is its own layer at
 * factor 1: the world layer never repaints for it, and the crowd's bob runs
 * on the compositor instead of restyling the world every frame. The fence is
 * part of the world, so its boards sit on the same grid as the posts.
 */
const SCENERY_LAYERS: { name: Exclude<LayerName, 'world'>; factor: number }[] = [
  { name: 'sky', factor: 0 },
  { name: 'mountains', factor: 0.12 },
  { name: 'lake', factor: 0.25 },
  { name: 'buildings', factor: 0.5 },
  { name: 'crowd', factor: 1 },
];
/** The crowd bobs in three groups, out of step, so the stand never moves as one. */
const CROWD_PHASES = [0, 1, 2];
/*
 * Each runner, with its flag, is drawn into its own small chip that the camera
 * world carries and a transform slides along. Moving a snail inside the world
 * picture made the browser redraw the track under it every frame; a chip is
 * painted once and only its own little animations repaint.
 */
const CHIP = { x: -1100, y: -340, w: 1540, h: 420 };
const wallClockMs = () => performance.now();

/** One projector unit in pixels: 1% of the widest 16:9 frame that fits the window. */
const unitPx = () => (typeof window === 'undefined' ? 12.8 : Math.min(window.innerWidth / 100, (window.innerHeight * 1.7778) / 100));

/**
 * Shrink a line of text to fit its box, never below `min` of its size. Reads
 * layout, so it runs only when the text or the box changes.
 */
function fitText(el: HTMLElement | null, min = 0.6): void {
  if (!el) return;
  el.style.setProperty('--fit', '1');
  el.classList.remove('fit-wrap');
  let fit = 1;
  const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  while (over() && fit > min) {
    fit = Math.max(min, fit - 0.06);
    el.style.setProperty('--fit', fit.toFixed(2));
  }
  /* Still too long at the smallest size: let it take a second line rather than run off. */
  if (over()) el.classList.add('fit-wrap');
}

/**
 * A value that stays on screen for `ms` after it has gone, flagged as
 * leaving, so a card can ease out instead of vanishing.
 */
function useLingering<T>(value: T | null, ms: number, keyOf: (item: T) => string): { shown: T | null; leaving: boolean } {
  const [state, setState] = useState<{ shown: T | null; leaving: boolean }>({ shown: value, leaving: false });
  if (value !== null && (state.shown === null || state.leaving || keyOf(state.shown) !== keyOf(value))) {
    setState({ shown: value, leaving: false });
  } else if (value === null && state.shown !== null && !state.leaving) {
    setState({ shown: state.shown, leaving: true });
  }
  useEffect(() => {
    if (!state.leaving) return;
    const id = window.setTimeout(() => setState({ shown: null, leaving: false }), ms);
    return () => window.clearTimeout(id);
  }, [state, ms]);
  return state;
}

function Mountains() {
  return (
    <g transform="translate(0 -220)">
      <path d="M0 520 L260 300 L520 470 L760 240 L1040 480 L1300 330 L1560 500 L1800 290 L2100 470 L2400 310 L2700 490 L3000 360 L3200 470 L3200 560 L0 560Z" fill="#6c4b7a" />
      <path d="M0 560 L180 440 L420 520 L700 400 L980 540 L1240 450 L1500 560 L1760 430 L2050 540 L2320 460 L2600 560 L2860 470 L3200 550 L3200 600 L0 600Z" fill="#a85c3b" />
      <path d="M730 262 L760 240 L790 262 L775 268 L760 258 L745 268Z" fill="#fff8f0" />
      <path d="M1770 310 L1800 290 L1830 312 L1815 318 L1800 308 L1785 318Z" fill="#fff8f0" />
    </g>
  );
}

function Lake() {
  return (
    <g transform="translate(0 -220)">
      <rect x="0" y="590" width="3200" height="60" fill="#2d7fd1" />
      <path d="M0 600 Q400 585 800 600 T1600 600 T2400 600 T3200 600 L3200 650 L0 650Z" fill="#3b93e6" />
      <rect x="0" y="648" width="3200" height="26" fill="#7cb342" />
    </g>
  );
}

function Tree({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="-8" y="640" width="16" height="40" fill="#5b3a1e" />
      <path d="M0 540 L48 610 L18 610 L52 660 L-52 660 L-18 610 L-48 610Z" fill="#1f7a3a" />
      <path d="M0 540 L30 584 L-30 584Z" fill="#2c9a4c" />
    </g>
  );
}

function Building({ x, w, label, colour, dome = false }: { x: number; w: number; label: string; colour: string; dome?: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      {dome ? (
        <path d={`M0 700 Q${w / 2} 560 ${w} 700Z`} fill={colour} stroke="#2a1a1a" strokeWidth="4" />
      ) : (
        <rect x="0" y="600" width={w} height="100" fill={colour} stroke="#2a1a1a" strokeWidth="4" rx="6" />
      )}
      {!dome ? <rect x={w * 0.15} y="630" width={w * 0.22} height="32" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" /> : null}
      {!dome ? <rect x={w * 0.6} y="630" width={w * 0.22} height="32" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" /> : null}
      <rect x={w * 0.5 - 70} y="572" width="140" height="34" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" />
      <text x={w * 0.5} y="597" textAnchor="middle" fontSize="24" fontWeight="900" fontFamily="Arial, sans-serif" fill="#1b1a19">{label}</text>
    </g>
  );
}

/** The snail-shell houses and the ambulance of a cartoon race-night town. */
function ShellHouse({ x, colour }: { x: number; colour: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <path d="M0 700 Q0 580 80 580 Q160 580 160 660 Q160 700 120 700 Z" fill={colour} stroke="#2a1a1a" strokeWidth="4" />
      <path d="M60 640 a36 36 0 1 1 72 0 a26 26 0 1 1 -52 0 a14 14 0 1 1 28 0" fill="none" stroke="#2a1a1a" strokeWidth="3" opacity=".4" />
      <rect x="18" y="650" width="26" height="50" fill="#5b3a1e" stroke="#2a1a1a" strokeWidth="3" />
      <rect x="104" y="636" width="22" height="22" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" />
    </g>
  );
}

function Ambulance({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className="side-ambulance">
        <rect x="0" y="636" width="150" height="54" rx="10" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
        <rect x="104" y="648" width="36" height="24" fill="#8fc9f0" stroke="#2a1a1a" strokeWidth="3" />
        <rect x="36" y="648" width="30" height="8" fill="#e8262b" />
        <rect x="47" y="637" width="8" height="30" fill="#e8262b" />
        <rect x="62" y="624" width="20" height="14" rx="4" fill="#3b93e6" stroke="#2a1a1a" strokeWidth="3" />
        <circle cx="34" cy="692" r="12" fill="#2a1a1a" />
        <circle cx="118" cy="692" r="12" fill="#2a1a1a" />
      </g>
    </g>
  );
}

function Scenery({ clubName }: { clubName: string }) {
  const short = clubName.split(' ')[0].toUpperCase();
  return (
    <g transform="translate(0 -220)">
      <Tree x={120} />
      <Building x={300} w={220} label="CLUBROOMS" colour="#f0a25a" />
      <ShellHouse x={560} colour="#c98bd8" />
      <Tree x={760} />
      <Building x={860} w={260} label="CANTEEN" colour="#8fc9f0" dome />
      <Ambulance x={1150} />
      <Building x={1340} w={240} label={short} colour="#c98bd8" />
      <Tree x={1640} />
      <Building x={1760} w={300} label="SNAIL TV" colour="#f4f1ea" dome />
      <ShellHouse x={2100} colour="#f0a25a" />
      <Tree x={2320} />
      <Building x={2420} w={220} label="NETS" colour="#9cd36f" />
      <ShellHouse x={2700} colour="#8fc9f0" />
      <Tree x={2920} />
      <Tree x={3080} />
    </g>
  );
}

/** The crowd in front of the rail: one of the three groups of heads and arms that bob while they race. */
function Crowd({ phase }: { phase: number }) {
  const heads = Array.from({ length: 26 }, (_, i) => i).filter((i) => i % 3 === phase);
  return (
    <g className="side-crowd">
      {heads.map((i) => {
        const x = i * (SCENE_W / 26) + ((i * 37) % 50);
        const h = 34 + ((i * 13) % 24);
        const fill = i % 3 === 0 ? '#4a2a5e' : i % 3 === 1 ? '#5a3272' : '#3f2554';
        return (
          <g key={i} transform={`translate(${x} ${CROWD_BASE})`}>
            <g className="side-fan">
              <path d={`M-30 0 L-22 -${h} L-34 -${h + 30} L-26 -${h + 36} L-12 -${h + 4} L12 -${h + 4} L26 -${h + 36} L34 -${h + 30} L22 -${h} L30 0Z`} fill={fill} />
              <circle cx="0" cy={-h - 20} r="24" fill={fill} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** A fence board: a sponsor's words, squeezed to the board rather than cut off. */
type FenceBoardContent = string | { src: string } | { sponsor: string };

/** The race sponsor's banner, over the winning post. */
function FinishBanner({ sponsor, title }: { sponsor: string; title?: string }) {
  const text = (title || sponsor).toUpperCase();
  const w = Math.max(620, Math.min(1200, 140 + text.length * 23));
  const sub = title ? `SPONSORED BY ${sponsor.toUpperCase()}` : 'RACE SPONSOR';
  return (
    <g className="side-finish-banner">
      <rect x={-w / 2} y={318} width={w} height={80} rx={12} fill="#0f1e33" stroke="#f5b700" strokeWidth={6} />
      <svg x={-w / 2 + 10} y={322} width={62} height={72} viewBox="0 0 100 116"><SponsorBadge name={sponsor} /></svg>
      <text x={-w / 2 + 84} y={356} fontSize={32} fontWeight={900} fontFamily="Arial Black, Arial, sans-serif" fill="#fff" textLength={Math.min(w - 100, text.length * 22)} lengthAdjust="spacingAndGlyphs">{text}</text>
      <text x={-w / 2 + 84} y={386} fontSize={22} fontWeight={800} fontFamily="Arial, sans-serif" fill="#f5b700" letterSpacing={2}>{sub}</text>
    </g>
  );
}

function FenceBoard({ x, w, board }: { x: number; w: number; board: FenceBoardContent | undefined }) {
  if (!board) return null;
  if (typeof board !== 'string' && 'sponsor' in board) {
    const name = board.sponsor.toUpperCase();
    return (
      <g className="side-fence-sponsor">
        <rect x={x} y="436" width={w} height="92" rx="6" fill="#0f1e33" stroke="#f5b700" strokeWidth="4" />
        <svg x={x + 8} y={440} width={72} height={84} viewBox="0 0 100 116"><SponsorBadge name={board.sponsor} /></svg>
        <text x={x + 90} y="496" fontSize="36" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#fff" textLength={Math.min(w - 104, name.length * 26)} lengthAdjust="spacingAndGlyphs">{name}</text>
      </g>
    );
  }
  if (typeof board !== 'string') {
    return (
      <g className="side-fence-logo">
        <rect x={x + w * 0.12} y="440" width={w * 0.76} height="88" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
        <image href={board.src} x={x + w * 0.12 + 8} y="444" width={w * 0.76 - 16} height="80" preserveAspectRatio="xMidYMid meet" />
      </g>
    );
  }
  const fontSize = 30;
  const room = w - 36;
  /* Arial Black capitals run about 0.74 em; anything longer is fitted to the board. */
  const tooLong = board.length * fontSize * 0.74 > room;
  return (
    <g>
      <rect x={x} y="476" width={w} height="44" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" />
      <text
        x={x + w / 2}
        y="509"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="900"
        fontFamily="Arial Black, Arial, sans-serif"
        fill="#a81d2f"
        textLength={tooLong ? room : undefined}
        lengthAdjust={tooLong ? 'spacingAndGlyphs' : undefined}
      >
        {board}
      </text>
    </g>
  );
}

/* ── The snail ────────────────────────────────────────────────────────── */

function SnailSprite({ lane, number, name, scale, nodeRef }: {
  lane: number;
  number: number;
  name: string;
  scale: number;
  nodeRef: (node: SVGGElement | null) => void;
}) {
  const c = laneColour(lane);
  return (
    <g ref={nodeRef} className="tv-runner side-runner" data-lane={lane} data-scale={scale}>
      <title>{number}. {name}</title>
      {/* Speed lines and dust when a snail is streaking. */}
      <g className="side-speed" transform={`scale(${scale}) translate(${-ART_NOSE} 0)`} aria-hidden="true">
        <path d="M-170 -110 H-280 M-180 -70 H-320 M-170 -30 H-270" stroke="#fff" strokeWidth="12" strokeLinecap="round" opacity=".85" />
        <circle className="side-dust side-dust-1" cx="-190" cy="0" r="22" fill="#e9dcc0" opacity=".8" />
        <circle className="side-dust side-dust-2" cx="-230" cy="-10" r="16" fill="#e9dcc0" opacity=".7" />
      </g>
      <g className="side-art" transform={`scale(${scale}) translate(${-ART_NOSE} 0)`}>
        <ellipse cx="0" cy="8" rx="150" ry="14" fill="#000" opacity=".18" />
        <g className="side-body">
          {/* foot */}
          <path className="side-foot" d="M-150 0 Q-150 -40 -100 -46 L120 -46 Q190 -46 190 -4 Q190 8 170 8 L-130 8 Q-150 8 -150 0Z" fill="#e9b96a" stroke="#2a1a1a" strokeWidth="5" />
          {/* eye stalks */}
          <g className="tv-snail-sprite side-stalks">
            <path d="M150 -44 L185 -120" stroke="#e9b96a" strokeWidth="9" strokeLinecap="round" />
            <path d="M165 -44 L210 -108" stroke="#e9b96a" strokeWidth="9" strokeLinecap="round" />
            <circle cx="186" cy="-124" r="11" fill="#fff" stroke="#2a1a1a" strokeWidth="4" />
            <circle cx="211" cy="-112" r="11" fill="#fff" stroke="#2a1a1a" strokeWidth="4" />
            <circle className="side-pupil" cx="189" cy="-124" r="4" fill="#1b1a19" />
            <circle className="side-pupil" cx="214" cy="-112" r="4" fill="#1b1a19" />
          </g>
          {/* shell, with the saddlecloth number as big as the shell allows */}
          <g className="side-shell">
            <ellipse cx="-20" cy="-82" rx="112" ry="84" fill={c.shell} stroke="#2a1a1a" strokeWidth="6" />
            <path d="M-20 -82 m-70 0 a70 70 0 1 1 140 0 a50 50 0 1 1 -100 0 a30 30 0 1 1 60 0" fill="none" stroke="#2a1a1a" strokeWidth="5" opacity=".35" />
            <text x="-20" y={number >= 100 ? -52 : number >= 10 ? -40 : -36} textAnchor="middle" fontSize={number >= 100 ? 84 : number >= 10 ? 116 : 132} fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#fff" stroke="#2a1a1a" strokeWidth="10" paintOrder="stroke" letterSpacing={number >= 10 ? -6 : 0}>{number}</text>
          </g>
          {/* mouth */}
          <path className="side-mouth" d="M150 -16 Q165 -8 178 -18" fill="none" stroke="#2a1a1a" strokeWidth="4" strokeLinecap="round" />
        </g>
        {/* dizzy stars while stuck */}
        <g className="side-dizzy" aria-hidden="true">
          <path d="M-60 -170 l12 27 30 3 -22 20 6 30 -26 -15 -26 15 6 -30 -22 -20 30 -3Z" fill="#ffe36b" stroke="#2a1a1a" strokeWidth="4" />
          <path d="M40 -175 l9 20 22 3 -16 15 4 22 -19 -12 -19 12 4 -22 -16 -15 22 -3Z" fill="#ffe36b" stroke="#2a1a1a" strokeWidth="4" />
        </g>
      </g>
    </g>
  );
}

/** Flag sizes as shares of the lane, so a flag never reaches the next lane. */
const FLAG_H = 0.66;
/** How long a flag may run, in multiples of its font size. */
const FLAG_MAX_EMS = 24;

/**
 * The snail's name on a flag trailing behind it, inside its own lane, so a
 * flag never covers another runner. It turns red when the snail is held up,
 * green when it is sent on, and gold for the winner.
 */
function SnailFlag({ lane, pitch, scale, name, nodeRef }: {
  lane: number;
  pitch: number;
  scale: number;
  name: string;
  nodeRef: (node: SVGGElement | null) => void;
}) {
  const c = laneColour(lane);
  const h = pitch * FLAG_H;
  const tail = -(ART_NOSE + ART_TAIL) * scale - pitch * 0.12;
  return (
    <g transform={`translate(${tail.toFixed(1)} ${(-ART_SHELL_Y * scale).toFixed(1)})`}>
      <g
        ref={nodeRef}
        className="side-name-flag"
        data-lane={lane}
        data-tone="none"
        data-pitch={pitch.toFixed(2)}
        style={{ '--shell': c.shell } as CSSProperties}
        aria-hidden="true"
      >
        <rect className="side-name-flag-box" x={-pitch * 3} y={-h / 2} width={pitch * 3} height={h} rx={h * 0.22} />
        <text className="side-name-flag-text" x={-pitch * 0.2} y={pitch * FLAG_FONT * 0.36} textAnchor="end" fontSize={pitch * FLAG_FONT} fontWeight="900" fontFamily="Arial Black, Arial, sans-serif">{name}</text>
      </g>
    </g>
  );
}

/* ── Staging a twist from the plan ───────────────────────────────────── */

interface StagedTwist {
  key: string;
  eventId: string;
  phase: SurprisePhase;
  label: string;
  kind: string;
  tone: 'good' | 'bad' | 'wild';
  targetLanes: number[];
  /** The lanes that get a prop: the runners it hits. */
  propLanes: number[];
  /** The runner the caption is about, when the event data says who. */
  featured: number | null;
  /** Three or more runners: a band falls across the field as well. */
  field: boolean;
  consequence?: 'advance' | 'delay' | 'retire';
  commentaryText: string;
  presentation: SurprisePresentation;
  /** Where this came from, so the two paths can never both draw a prop. */
  source: 'plan' | 'moment';
}

/** How long a landed twist owns the screen: the slam, the read, the park. The caller gates on the same clock. */
const EFFECT_ON_AIR_MS = STORY_CARD_MS;
/** The least a landed card stays up when the next hit arrives on its heels. */
const MIN_READ_MS = STORY_READ_MS;

interface StoryWindow {
  event: LockedRaceEvent;
  /** When the INCOMING card may go up: never inside the previous story. */
  onAirMs: number;
  /** When this story has finished owning the screen. */
  offAirMs: number;
  /** The staged twist for each phase, built once. */
  staged: Partial<Record<SurprisePhase, StagedTwist>>;
}

/**
 * The plan's twists laid out as one story at a time. Each twist's warning
 * waits for the previous story to park; a twist whose turn never comes
 * before its own hit goes on air at the hit with no warning, and the card
 * before it parks early. The consequence on the snail is unchanged either
 * way: this is only what the cards say, and the windows never overlap.
 */
function storyWindows(events: LockedRaceEvent[]): StoryWindow[] {
  const sorted = [...events].sort((a, b) => a.effectAtMs - b.effectAtMs || a.id.localeCompare(b.id));
  const windows: StoryWindow[] = [];
  let busyUntil = -Infinity;
  for (const event of sorted) {
    const previous = windows[windows.length - 1];
    const onAirMs = Math.min(event.effectAtMs, Math.max(event.warningAtMs, busyUntil));
    if (previous && onAirMs < previous.offAirMs + STORY_GAP_MS) {
      const cardUp = Math.max(previous.onAirMs, previous.event.effectAtMs);
      previous.offAirMs = Math.min(onAirMs, Math.max(cardUp + MIN_READ_MS, onAirMs - STORY_GAP_MS));
    }
    const offAirMs = Math.max(event.effectAtMs, onAirMs) + EFFECT_ON_AIR_MS;
    windows.push({ event, onAirMs, offAirMs, staged: {} });
    busyUntil = offAirMs + STORY_GAP_MS;
  }
  return windows;
}

/** The twist on air at race-time `t`: the latest story that has started and not yet parked. */
function stagedFromPlan(windows: StoryWindow[], t: number, names: readonly string[]): StagedTwist | null {
  let best: StoryWindow | null = null;
  for (const w of windows) {
    if (t < w.onAirMs || t >= w.offAirMs) continue;
    if (!best || w.event.effectAtMs > best.event.effectAtMs) best = w;
  }
  if (!best) return null;
  const { event } = best;
  const phase: SurprisePhase = t < event.effectAtMs ? 'warning' : 'effect';
  const cached = best.staged[phase];
  if (cached) return cached;
  const presentation = presentationForMoment({ id: 0, text: event.commentaryText, tone: 'hot', label: event.label, kind: event.kind }) ?? { art: null, symbol: '!', cue: 'drop' };
  const staged: StagedTwist = {
    key: `${event.id}:${phase}`,
    eventId: event.id,
    phase,
    label: event.label,
    kind: event.kind,
    tone: event.tone,
    targetLanes: event.targetLanes,
    propLanes: propLanes(event),
    featured: featuredLane(event, names),
    field: isFieldTwist(event),
    consequence: event.consequence === 'retire' ? 'retire' : event.consequence === 'advance' ? 'advance' : 'delay',
    commentaryText: event.commentaryText,
    presentation,
    source: 'plan',
  };
  best.staged[phase] = staged;
  return staged;
}

/* ── The renderer ─────────────────────────────────────────────────────── */

interface FinishHold {
  runners: RunInRunner[];
  startedAt: number;
  lastAt: number;
  crossed: Set<number>;
  photo: boolean;
}

export function Sidescroller({
  names,
  owners = [],
  race,
  calm,
  clubName,
  raceNo,
  cameraMode = 'telecast',
  fullCourse,
  onCourseViewChange,
  sponsor,
  sponsorTitle,
  sponsors = [],
  metres = RACE_METRES,
  toteResult,
  numberOffset = 0,
  numbers,
  replay = false,
}: Props) {
  const { setPainter, releasePainter } = race;
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = calm || prefersReducedMotion;
  /* Read by the painter through a ref: a Calm toggle mid-race must not
     rebuild the painter, which would reset the scene to the start line. */
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);
  const [localCourseView, setCourseView] = useState(false);
  const courseView = fullCourse ?? (localCourseView || cameraMode === 'full');
  const courseViewRef = useRef(false);

  const sceneRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef(new Map<number, SVGGElement>());
  const flagNodesRef = useRef(new Map<number, SVGGElement>());
  const chipsRef = useRef(new Map<number, HTMLDivElement>());
  const chipLayerRef = useRef<HTMLDivElement>(null);
  const layerWrapRefs = useRef<Partial<Record<LayerName, HTMLDivElement | null>>>({});
  /** World units to layer pixels, fixed per screen size so layers paint once. */
  const rasterRef = useRef(1);
  const sceneWidthRef = useRef(0);
  const propNodesRef = useRef(new Map<number, HTMLElement>());
  /** Each runner's last painted progress, for a re-measure between frames. */
  const progressRef = useRef(new Map<number, number>());
  /** The twist card's width, measured when it changes rather than read every frame. */
  const cardWidthRef = useRef(0);
  /** True from the off until the reset: the runners bob while racing. */
  const racingRef = useRef(false);
  const clockRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const toGoRef = useRef<HTMLSpanElement>(null);
  const orderRefs = useRef(new Map<number, HTMLLIElement>());
  const splashRef = useRef<HTMLDivElement>(null);
  const strapRef = useRef<HTMLParagraphElement>(null);
  const plateNameRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const snapshotRef = useRef<{ snails: SnailRun[]; info: PaintInfo } | null>(null);
  const momentRef = useRef(race.moment);
  const aspectRef = useRef(16 / 9);
  const camRef = useRef({ x: OPEN_X, w: PACK_VIEW_W });
  /* The camera's speed on each axis, and its estimate of how fast the shot itself is moving. */
  const camMotionRef = useRef({ vx: { v: 0 }, vw: { v: 0 }, speed: 0, lastTarget: null as number | null });
  const lastPaintRef = useRef(0);
  const namesRef = useRef(names);
  /* The twist on air, derived from the plan on every frame; React only hears
     about it when it changes, which is a handful of times a race. */
  const stagedRef = useRef<StagedTwist | null>(null);
  const [staged, setStaged] = useState<StagedTwist | null>(null);
  const flagRef = useRef(new Map<number, string>());
  const windowsRef = useRef<{ events: LockedRaceEvent[] | null; windows: StoryWindow[] }>({ events: null, windows: [] });
  /* The hold on the line after the winner crosses, while the field runs in. */
  const finishRef = useRef<FinishHold | null>(null);

  /* The lanes are deeper in full field view; the painter reads them through
     a ref so a camera change never rebuilds (and resets) the painter mid-race. */
  const extra = courseView ? FULL_VIEW_EXTRA : 0;
  const lanes = useMemo(() => names.map((_, lane) => laneGeometry(lane, names.length, extra)), [names, extra]);
  const lanesRef = useRef(lanes);
  const track = useMemo(() => straightTrack(metres), [metres]);
  const trackRef = useRef(track);
  const worldBox = worldBoxOf(track);
  const trackBottom = TRACK_BOTTOM + extra;
  const signs = useMemo(() => {
    const list = [clubName.toUpperCase(), sponsor ? `${(sponsorTitle || `PRESENTED BY ${sponsor}`).toUpperCase()}` : 'SNAIL RACING', ...sponsors.map((s) => s.toUpperCase())];
    return list.filter(Boolean);
  }, [clubName, sponsor, sponsors]);
  /* Two club sponsors' logos on the fence each race, a different pair every race. */
  const fenceLogos = useMemo(() => sponsorsFromRace(raceNo).slice(0, 2), [raceNo]);
  /* The fence boards, on the post grid from behind the stalls to past the post. */
  const fenceBoards = useMemo(() => {
    const own: FenceBoardContent | undefined = sponsor ? { sponsor } : undefined;
    const boards: (FenceBoardContent | undefined)[] = own
      ? [own, signs[1], fenceLogos[0], own, signs[0], fenceLogos[1]]
      : [signs[0], fenceLogos[0], signs[1], fenceLogos[1]];
    return fenceSlots(WORLD_X, WORLD_X + worldBoxOf(track).w).map((slot, i) => ({ ...slot, board: boards[((i % boards.length) + boards.length) % boards.length] }));
  }, [signs, fenceLogos, sponsor, track]);

  const painter = useMemo(() => {
    const place = (lane: number, progress: number) => {
      const geo = lanesRef.current[lane];
      const x = trackRef.current.worldX(progress);
      progressRef.current.set(lane, progress);
      if (!geo) return x;
      const k = rasterRef.current;
      const chip = chipsRef.current.get(lane);
      /* The slither: a small bob, out of step lane to lane, carried by the same transform that moves the runner. */
      const bob = racingRef.current && !reduceMotionRef.current ? Math.sin(frameClockMs() / 145 + lane * 1.7) * 7 * geo.scale : 0;
      if (chip) chip.style.transform = `translate3d(${((x + CHIP.x - WORLD_X) * k).toFixed(2)}px, ${((geo.y + CHIP.y - LAYER_TOP + bob) * k).toFixed(2)}px, 0)`;
      return x;
    };
    /** Put a prop's layer at world (x, y), drawn at `scale`: a transform on the compositor, never a repaint of the track. */
    const placeProp = (node: HTMLElement | undefined, x: number, y: number, scale: number) => {
      if (!node) return;
      const k = rasterRef.current;
      const size = `${(PROP_BOX.w * scale * k).toFixed(1)}x${(PROP_BOX.h * scale * k).toFixed(1)}`;
      if (node.dataset.size !== size) {
        node.dataset.size = size;
        node.style.width = `${(PROP_BOX.w * scale * k).toFixed(1)}px`;
        node.style.height = `${(PROP_BOX.h * scale * k).toFixed(1)}px`;
      }
      node.style.transform = `translate3d(${((x + PROP_BOX.x * scale - WORLD_X) * k).toFixed(2)}px, ${((y + PROP_BOX.y * scale - LAYER_TOP) * k).toFixed(2)}px, 0)`;
    };
    /** The narrowest shot that still shows every lane at this screen shape. */
    const extraNow = () => (courseViewRef.current ? FULL_VIEW_EXTRA : 0);
    const snailLenNow = () => (ART_NOSE + ART_TAIL) * (lanesRef.current[0]?.scale ?? 0.5);
    /* How wide each runner's name flag is, so the opening shot can show them all. */
    const flagWidths = new Map<number, number>();
    /** Where the opening shot starts: back far enough to read every name flag behind the stalls. */
    const openX = () => {
      const pitch = lanesRef.current[0]?.pitch ?? 70;
      const widest = Math.max(0, ...flagWidths.values());
      return Math.min(OPEN_X, START_X - snailLenNow() - pitch * 0.12 - widest - pitch * 0.6);
    };
    const minW = () => {
      const aspect = aspectRef.current;
      const required = requiredViewH(extraNow());
      /* A portrait phone gets a close shot of the track rather than a frame of sky. */
      return aspect < 1.2 ? required * aspect * 1.15 : Math.max(PACK_VIEW_W, required * aspect);
    };
    /** Screen pixels per world unit at the widest following shot: the flags are sized for it, so they never read under the floor. */
    const followScale = () => {
      const narrowest = minW();
      const widest = Math.max(narrowest, Math.min(FOLLOW_MAX_W, narrowest * 1.12));
      return (sceneWidthRef.current || 1) / widest;
    };
    /** Fit a leader's name into its slot in the positions strip. */
    /* Never under the 1.6u floor: the leader's 2.7u steps down to 0.6 of itself, the next two's 2.1u to 0.77, then a name wraps to two lines. */
    const fitOrderName = (el: HTMLLIElement) => fitText(el.querySelector('.side-order-name') as HTMLElement | null, el.dataset.rank === '1' ? 0.6 : 0.77);
    const setOrder = (ranked: SnailRun[]) => {
      ranked.forEach((s, i) => {
        const el = orderRefs.current.get(s.lane);
        if (!el) return;
        const rank = String(i + 1);
        if (el.dataset.rank !== rank) {
          const wasLeader = Number(el.dataset.rank) <= 3;
          el.dataset.rank = rank;
          el.style.order = rank;
          if (i < 3 || wasLeader) fitOrderName(el);
        }
        el.classList.toggle('done', s.done);
        el.classList.toggle('retired', Boolean(s.retired));
      });
    };
    /**
     * Write a snail's flag: its name, or its placing once it is home, in the
     * colour of what is happening to it. Sized to its text, and squeezed to
     * the most a lane allows rather than cut off.
     */
    const setFlag = (lane: number, text: string, tone: string, force = false) => {
      if (!force && flagRef.current.get(lane) === `${tone}|${text}`) return;
      flagRef.current.set(lane, `${tone}|${text}`);
      const flag = flagNodesRef.current.get(lane);
      const label = flag?.querySelector('.side-name-flag-text') as SVGTextElement | null;
      const box = flag?.querySelector('.side-name-flag-box') as SVGRectElement | null;
      if (!flag || !label || !box) return;
      flag.setAttribute('data-tone', tone);
      if (label.textContent !== text) label.textContent = text;
      const pitch = Number(flag.dataset.pitch);
      const font = flagFont(pitch, followScale(), unitPx());
      const max = font * FLAG_MAX_EMS;
      const pad = pitch * 0.2;
      /* The box grows with the font, up to most of the lane. */
      const h = Math.min(pitch * FLAG_H_MAX, Math.max(pitch * FLAG_H, font * 1.3));
      box.setAttribute('y', String(-h / 2));
      box.setAttribute('height', String(h));
      box.setAttribute('rx', String(h * 0.22));
      label.setAttribute('y', String(font * 0.36));
      label.setAttribute('font-size', String(font));
      label.removeAttribute('textLength');
      label.removeAttribute('lengthAdjust');
      let width = 0;
      try {
        width = label.getComputedTextLength();
      } catch {
        width = text.length * font * 0.7;
      }
      if (!width) width = text.length * font * 0.7;
      if (width > max) {
        /* A little smaller first (never under the floor), then squeezed: a long name is never cut short. */
        const smaller = Math.max(0.92, max / width);
        label.setAttribute('font-size', String(font * smaller));
        width *= smaller;
        if (width > max) {
          label.setAttribute('textLength', String(max));
          label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
          width = max;
        }
      }
      box.setAttribute('x', String(-(width + pad * 2)));
      box.setAttribute('width', String(width + pad * 2));
      flagWidths.set(lane, width + pad * 2);
    };
    /** Where a repeating layer drawn at this parallax factor starts, in world x. */
    const sceneryAt = (camX: number, factor: number) =>
      factor === 0 ? camX : camX + ((-camX * factor) % SCENE_W) - SCENE_W;
    /*
     * Point the camera at world x camX with a shot viewW by viewH, bottom
     * anchored on the ground line. Only layer transforms change; the crowd
     * copies jump a whole scenery width now and then, never per frame.
     */
    const frame = (camX: number, viewW: number, viewH: number) => {
      const sceneW = sceneWidthRef.current;
      if (!sceneW) return;
      const extraY = extraNow();
      const viewY = VIEW_H + extraY - viewH;
      const k = rasterRef.current;
      const s = sceneW / viewW;
      const put = (name: LayerName, boxX: number, originX: number) => {
        const el = layerWrapRefs.current[name];
        if (!el) return;
        const tx = (boxX + originX - camX) * s;
        /* The crowd stands on the ground line, which the deeper lanes push down. */
        const ty = (LAYER_TOP - viewY + (name === 'crowd' ? extraY : 0)) * s;
        el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${(s / k).toFixed(5)})`;
      };
      for (const layer of SCENERY_LAYERS) put(layer.name, SCENERY_BOX.x, sceneryAt(camX, layer.factor));
      put('world', WORLD_X, 0);
      /* Keep the twist card clear of the winning post once it is in shot. */
      const card = splashRef.current;
      if (card) {
        const finishPx = (trackRef.current.trackLen - camX) * s;
        const half = cardWidthRef.current / 2;
        const margin = unitPx() * 1.5;
        let centre = sceneW / 2;
        /* The START board, while it is in shot, keeps the card to its right. */
        const startPx = (START_X + 160 - camX) * s;
        if (startPx > 0 && startPx < sceneW && centre - half - margin < startPx) centre = Math.min(sceneW - half - margin, startPx + half + margin);
        if (finishPx > 0 && finishPx < sceneW && centre + half + margin > finishPx) centre = Math.max(half + margin, finishPx - half - margin);
        const value = `${Math.round(centre - sceneW / 2)}px`;
        if (card.style.getPropertyValue('--splash-shift') !== value) card.style.setProperty('--splash-shift', value);
      }
    };
    /*
     * Ease the camera towards a shot with a critically damped follow: no
     * step in position or speed when the shot changes (a runner joining,
     * a prop, the run home), and it aims ahead by the shot's own smoothed
     * speed so riding with the pack carries no lag.
     */
    const ease = (targetX: number, wantW: number) => {
      const narrowest = minW();
      const cam = camRef.current;
      const motion = camMotionRef.current;
      const now = frameClockMs();
      const dt = (lastPaintRef.current ? Math.min(100, now - lastPaintRef.current) : 16.7) / 1000;
      lastPaintRef.current = now;
      if (reduceMotionRef.current) {
        cam.x = targetX;
        cam.w = wantW;
        motion.vx.v = 0;
        motion.vw.v = 0;
      } else {
        if (motion.lastTarget !== null && dt > 0) {
          const v = (targetX - motion.lastTarget) / dt;
          /* A jump in the shot is not a speed: only the steady ride is led. */
          if (Math.abs(v) <= Math.max(4 * Math.abs(motion.speed), 2000)) motion.speed += (v - motion.speed) * (1 - Math.exp(-dt / 0.3));
        }
        motion.lastTarget = targetX;
        cam.x = smoothDamp(cam.x, targetX + motion.speed * CAM_PAN_S, motion.vx, CAM_PAN_S, dt);
        cam.w = smoothDamp(cam.w, wantW, motion.vw, CAM_ZOOM_S, dt);
      }
      /* Never narrower than every lane allows, even mid-ease. */
      const viewW = Math.max(cam.w, narrowest);
      frame(cam.x, viewW, viewW / aspectRef.current);
    };
    /** Size every layer for this screen: crisp at the closest shot the camera takes. */
    const sizeLayers = () => {
      const sceneW = sceneWidthRef.current;
      if (!sceneW) return;
      const k = sceneW / minW();
      rasterRef.current = k;
      for (const name of [...SCENERY_LAYERS.map((l) => l.name), 'world' as const]) {
        const el = layerWrapRefs.current[name];
        if (!el) continue;
        const w = name === 'world' ? worldBoxOf(trackRef.current).w : SCENERY_BOX.w;
        el.style.width = `${Math.ceil(w * k)}px`;
        el.style.height = `${Math.ceil(LAYER_H * k)}px`;
      }
      chipLayerRef.current?.style.setProperty('--chip-w', `${(CHIP.w * k).toFixed(2)}px`);
      chipLayerRef.current?.style.setProperty('--chip-h', `${(CHIP.h * k).toFixed(2)}px`);
    };

    /* Each runner's recent pace, for the run-in after the winner is home. */
    const paceRef = new Map<number, { p: number; t: number; rate: number }>();

    const paint = (snails: SnailRun[], info: PaintInfo) => {
      snapshotRef.current = { snails, info };
      const t = info.raceTimeMs;
      /* The stalls follow the race clock, so a replay or a seek opens and shuts them too. */
      svgRef.current?.classList.toggle('gates-open', t > 0);
      svgRef.current?.classList.toggle('run-home', info.finalStraight);
      layerWrapRefs.current.crowd?.classList.toggle('run-home', info.finalStraight);

      /* Stage the twist from the plan itself: it is on air from its warning
         until its consequence has run, which is how long the room needs. */
      const planEvents = snails[0]?.lockedMotion?.events;
      let next: StagedTwist | null = null;
      if (planEvents) {
        if (windowsRef.current.events !== planEvents) windowsRef.current = { events: planEvents, windows: storyWindows(planEvents) };
        next = stagedFromPlan(windowsRef.current.windows, t, namesRef.current);
      } else {
        const moment = momentRef.current;
        if (moment && info.leadP <= 1) {
          const key = `moment-${moment.id}-${moment.phase ?? ''}`;
          const targets = moment.targetLanes ?? [info.ranked[0]?.lane ?? 0];
          next = stagedRef.current?.key === key ? stagedRef.current : {
            key,
            eventId: moment.eventId ?? `moment-${moment.id}`,
            phase: moment.phase === 'warning' || moment.phase === 'reveal' ? 'warning' : 'effect',
            label: moment.label ?? moment.text,
            kind: moment.kind ?? '',
            tone: moment.tone === 'good' ? 'good' : moment.tone === 'bad' ? 'bad' : 'wild',
            targetLanes: targets,
            propLanes: targets,
            featured: targets.length === 1 ? targets[0] : null,
            field: targets.length > 2,
            consequence: moment.consequence,
            commentaryText: moment.text,
            presentation: presentationForMoment(moment) ?? { art: null, symbol: '!', cue: 'drop' },
            source: 'moment',
          };
        }
      }
      if ((next?.key ?? null) !== (stagedRef.current?.key ?? null)) {
        stagedRef.current = next;
        setStaged(next);
      }
      const twist = stagedRef.current;

      for (const snail of snails) {
        const node = nodesRef.current.get(snail.lane);
        if (!node) continue;
        node.classList.toggle('retired', Boolean(snail.retired));
        /* The reaction follows the consequence, not the name of the gag. */
        let delta = 0;
        if (snail.lockedMotion) {
          /* The newest consequence on this lane is the one to show: a boost
             still easing in loses to a hold that has just landed. */
          const live = snail.lockedMotion.events
            .filter((event) => event.targetLanes.includes(snail.lane) && t >= event.effectAtMs && t < event.effectEndMs && (event.clockDeltaMsByLane[snail.lane] ?? 0) !== 0)
            .sort((x, y) => y.effectAtMs - x.effectAtMs)[0];
          delta = live?.clockDeltaMsByLane[snail.lane] ?? 0;
        } else {
          delta = snail.effect === 'boost' || snail.effect === 'surge' ? 1 : snail.effect === 'stumble' || snail.effect === 'nap' || snail.effect === 'wander' ? -1 : 0;
        }
        const up = !snail.done && delta > 0;
        const down = !snail.done && !snail.retired && delta < 0;
        node.classList.toggle('fx-up', up);
        node.classList.toggle('fx-down', down);
        /* The runner the caption names (the first to shake off the plague) is lit up. */
        const featured = Boolean(twist && twist.phase === 'effect' && twist.featured === snail.lane && twist.field);
        node.classList.toggle('featured', featured);
        const name = namesRef.current[snail.lane] ?? '';
        if (snail.done && !snail.retired && snail.place === 1) setFlag(snail.lane, `WINNER  ${name}`, 'win');
        else if (snail.retired) setFlag(snail.lane, `OUT  ${name}`, 'out');
        else setFlag(snail.lane, name, featured || up ? 'up' : down ? 'down' : 'none');
        place(snail.lane, snail.p);

        /* Pace over the last half second, never below the snail's average. */
        const pace = paceRef.get(snail.lane);
        if (!pace || t < pace.t) paceRef.set(snail.lane, { p: snail.p, t, rate: t > 0 ? snail.p / t : 0 });
        else if (t - pace.t >= 250) {
          const recent = (snail.p - pace.p) / (t - pace.t);
          paceRef.set(snail.lane, { p: snail.p, t, rate: Math.max(recent, t > 0 ? (snail.p / t) * 0.7 : 0) });
        }
      }
      for (const snail of info.justFinished) nodesRef.current.get(snail.lane)?.classList.add('finished');

      /*
       * Camera: ride with the leading pack. The leader is always in shot with
       * room to run into; runners behind are added in running order while
       * they fit a tight following shot, so the picture stays close and the
       * scenery moves, and the running-order strip names the rest. For the
       * run home the winning post joins the shot and stays in it. Full field
       * view takes everyone. Every lane is always in frame.
       */
      const narrowest = minW();
      const maxW = courseViewRef.current ? Infinity : Math.max(narrowest, Math.min(FOLLOW_MAX_W, narrowest * 1.12));
      const order = info.ranked.length ? info.ranked : snails;
      const headroom = 380;
      const leadP = order[0]?.p ?? 0;
      const { worldX, trackLen } = trackRef.current;
      const leadX = worldX(leadP);
      const snailLen = snailLenNow();
      let right = leadX + headroom;
      let left = leadX - snailLen - 140;
      if (leadP >= FRAME_FINISH_FROM || info.finalStraight) {
        right = Math.max(right, trackLen + 320);
        left = Math.max(Math.min(left, right - narrowest), right - maxW);
      }

      /*
       * The props: one per runner it hits, a lane tall, just in front of that
       * runner's nose, so it never covers a saddlecloth number; the snails
       * are drawn above the props regardless. A field-wide twist also lays a
       * tint across every lane, under the snails.
       */
      if (twist) {
        const laneList = lanesRef.current;
        const byLane = new Map(snails.map((s) => [s.lane, s]));
        if (twist.presentation.cue === 'gate') {
          /* The boom gate drops across the track just in front of the first runner it stopped. */
          const node = propNodesRef.current.get(-1);
          const stopped = twist.propLanes.map((lane) => byLane.get(lane)).filter((s): s is SnailRun => Boolean(s));
          const frontP = stopped.length ? Math.max(...stopped.map((s) => s.p)) : leadP;
          const pitch = laneList[0]?.pitch ?? 70;
          const x = worldX(frontP) + pitch * 1.6;
          const scale = ((TRACK_BOTTOM + extraNow() - TRACK_TOP) * 0.5) / GLYPH_UNITS;
          placeProp(node, x, TRACK_BOTTOM + extraNow(), scale);
          right = Math.max(right, x + 200);
        } else {
          for (const lane of twist.propLanes) {
            const node = propNodesRef.current.get(lane);
            const snail = byLane.get(lane);
            const geo = laneList[lane];
            if (!node || !snail || !geo) continue;
            /* Taller than its lane so it reads from the back; the snails and flags are drawn over it, so it never hides one. */
            const scale = (geo.pitch * PROP_LANES) / GLYPH_UNITS;
            const half = (GLYPH_UNITS / 2) * scale;
            /* In the warning the prop looms a little further up the lane; it lands right in front. */
            const gap = twist.phase === 'warning' ? geo.pitch * 0.9 : geo.pitch * 0.22;
            const x = worldX(snail.p) + 40 * geo.scale + gap + half;
            placeProp(node, x, geo.y, scale);
            if (snail.p >= leadP - 0.02) right = Math.max(right, x + half + 60);
          }
        }
      }

      for (const snail of order) {
        const tail = worldX(snail.p) - snailLen - 140;
        if (tail >= left) continue;
        if (right - tail > maxW) break;
        left = tail;
      }

      const wantW = Math.max(narrowest, right - left);
      let targetX = right - wantW + (wantW - (right - left)) * 0.5 * (courseViewRef.current ? 1 : 0.3);
      targetX = Math.max(openX(), Math.min(trackLen + 460 - wantW, targetX));
      ease(targetX, wantW);

      const clock = clockText(t);
      if (clockRef.current && clockRef.current.textContent !== clock) clockRef.current.textContent = clock;
      const lead = Math.min(1, Math.max(0, info.leadP));
      if (barRef.current) {
        /* A transform on the fill alone: a custom property on the bar restyled the whole running-order strip every frame. */
        const fill = `scaleX(${lead.toFixed(4)})`;
        if (fillRef.current && fillRef.current.style.transform !== fill) fillRef.current.style.transform = fill;
        const now = String(Math.round(lead * trackRef.current.metres * 10) / 10);
        if (barRef.current.getAttribute('aria-valuenow') !== now) barRef.current.setAttribute('aria-valuenow', now);
      }
      if (toGoRef.current) {
        const text = lead >= 1 ? 'FINISH' : `${((1 - lead) * trackRef.current.metres).toFixed(1)} m to go`;
        if (toGoRef.current.textContent !== text) toGoRef.current.textContent = text;
      }
      /* Nobody has gone anywhere in the first second: the order stays as drawn. */
      setOrder(t < ORDER_FROZEN_MS ? [...snails].sort((a, b) => a.lane - b.lane) : order);
    };

    /**
     * The winner is home. Hold the shot on the line: a photo-finish still
     * first, then the rest of the field runs in at its own pace, in the
     * official order, each one's flag showing its placing as it crosses.
     */
    const beginFinish = (results: RaceResult[]) => {
      const snapshot = snapshotRef.current;
      if (!snapshot || finishRef.current) return;
      const placeOf = new Map(results.map((r) => [r.lane, r.place]));
      const finish: FinishHold = {
        runners: snapshot.snails.map((s) => ({
          lane: s.lane,
          place: placeOf.get(s.lane) ?? 99,
          p: s.p,
          rate: paceRef.get(s.lane)?.rate ?? 0,
          retired: s.retired,
        })),
        startedAt: wallClockMs(),
        lastAt: wallClockMs(),
        crossed: new Set(snapshot.snails.filter((s) => s.p >= 1).map((s) => s.lane)),
        photo: !reduceMotionRef.current,
      };
      finishRef.current = finish;
      sceneRef.current?.classList.toggle('side-photo', finish.photo);
      setOrder(
        [...snapshot.snails].sort((a, b) => (placeOf.get(a.lane) ?? 99) - (placeOf.get(b.lane) ?? 99)),
      );
    };
    const finishFrame = () => {
      const finish = finishRef.current;
      if (!finish) return;
      const now = wallClockMs();
      const dt = Math.min(100, now - finish.lastAt);
      finish.lastAt = now;
      const held = now - finish.startedAt < PHOTO_MS && finish.photo;
      if (!held) {
        if (finish.photo) {
          finish.photo = false;
          const scene = sceneRef.current;
          scene?.classList.replace('side-photo', 'side-photo-out');
          window.setTimeout(() => scene?.classList.remove('side-photo-out'), 320);
        }
        finish.runners = runInStep(finish.runners, dt);
        for (const runner of finish.runners) {
          place(runner.lane, runner.p);
          if (runner.retired || runner.p < 1 || finish.crossed.has(runner.lane)) continue;
          finish.crossed.add(runner.lane);
          nodesRef.current.get(runner.lane)?.classList.add('finished');
          const name = namesRef.current[runner.lane] ?? '';
          if (runner.place <= 3) setFlag(runner.lane, `${ordinal(runner.place).toUpperCase()}  ${name}`, 'placed');
        }
      }
      const narrowest = minW();
      ease(trackRef.current.trackLen - narrowest * FINISH_HOLD_AT, narrowest);
    };
    const endFinish = () => {
      finishRef.current = null;
      sceneRef.current?.classList.remove('side-photo', 'side-photo-out');
    };

    return {
      measure: () => {
        const scene = sceneRef.current;
        if (scene?.clientHeight) {
          const resized = sceneWidthRef.current !== scene.clientWidth || aspectRef.current !== scene.clientWidth / scene.clientHeight;
          aspectRef.current = scene.clientWidth / scene.clientHeight;
          sceneWidthRef.current = scene.clientWidth;
          sizeLayers();
          /* The flags are sized for the screen: a new size re-sizes them. */
          if (resized) flagRef.current.forEach((value, lane) => {
            const [tone, ...rest] = value.split('|');
            setFlag(lane, rest.join('|'), tone, true);
          });
        }
        const snapshot = snapshotRef.current;
        if (finishRef.current) {
          finishFrame();
        } else if (snapshot) paint(snapshot.snails, snapshot.info);
        else {
          const w = minW();
          /* The opening shot is where the race camera starts, so the gates opening is not a jump cut. */
          const x = openX();
          camRef.current = { x, w };
          camMotionRef.current = { vx: { v: 0 }, vw: { v: 0 }, speed: 0, lastTarget: null };
          frame(x, w, w / aspectRef.current);
          /* The chips are sized in layer pixels, so a new size moves them too. */
          nodesRef.current.forEach((_, lane) => place(lane, progressRef.current.get(lane) ?? 0));
        }
        orderRefs.current.forEach((el) => { if (Number(el.dataset.rank) <= 3) fitOrderName(el); });
      },
      start: () => {
        racingRef.current = true;
        sceneRef.current?.querySelectorAll('svg.tv, svg.side-layer-art, .side-runner-chip, .side-crowd-phase').forEach((svg) => svg.classList.add('racing'));
      },
      reset: () => {
        racingRef.current = false;
        snapshotRef.current = null;
        endFinish();
        paceRef.clear();
        sceneRef.current?.querySelectorAll('svg.tv, svg.side-layer-art, .side-runner-chip, .side-crowd-phase').forEach((svg) => svg.classList.remove('racing'));
        svgRef.current?.classList.remove('racing', 'gates-open', 'run-home');
        layerWrapRefs.current.crowd?.classList.remove('run-home');
        const w = minW();
        camRef.current = { x: OPEN_X, w };
        camMotionRef.current = { vx: { v: 0 }, vw: { v: 0 }, speed: 0, lastTarget: null };
        lastPaintRef.current = 0;
        stagedRef.current = null;
        setStaged(null);
        flagRef.current.clear();
        nodesRef.current.forEach((node, lane) => {
          place(lane, 0);
          node.classList.remove('finished', 'retired', 'fx-up', 'fx-down', 'featured');
          setFlag(lane, namesRef.current[lane] ?? '', 'none', true);
        });
        orderRefs.current.forEach((el, lane) => {
          el.dataset.rank = String(lane + 1);
          el.style.order = String(lane + 1);
          el.classList.remove('done', 'retired');
        });
        orderRefs.current.forEach((el) => { if (Number(el.dataset.rank) <= 3) fitOrderName(el); });
        if (clockRef.current) clockRef.current.textContent = '0:00.0';
        if (barRef.current) {
          if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
          barRef.current.setAttribute('aria-valuenow', '0');
        }
        if (toGoRef.current) toGoRef.current.textContent = `${trackRef.current.metres.toFixed(1)} m to go`;
        const x = openX();
        camRef.current = { x, w };
        camMotionRef.current = { vx: { v: 0 }, vw: { v: 0 }, speed: 0, lastTarget: null };
        frame(x, w, w / aspectRef.current);
      },
      paint,
      beginFinish,
      finishFrame,
      endFinish,
      /** Re-measure every flag, after the names or the lanes change. */
      /* Back to each runner's current name; the next paint puts back what is happening to it. */
      refreshFlags: () => {
        flagNodesRef.current.forEach((_, lane) => setFlag(lane, namesRef.current[lane] ?? '', 'none', true));
      },
    } satisfies RacePainter & Record<string, unknown>;
  }, []);

  /* Before the first paint, so the scenery is sized and placed on the very first frame and never pops in. */
  useLayoutEffect(() => {
    setPainter(painter);
    painter.reset();
    painter.measure();
    return () => releasePainter(painter);
  }, [painter, setPainter, releasePainter]);
  useEffect(() => {
    const observer = new ResizeObserver(() => painter.measure());
    if (sceneRef.current) observer.observe(sceneRef.current);
    return () => observer.disconnect();
  }, [painter]);
  useEffect(() => {
    momentRef.current = race.moment;
    const snapshot = snapshotRef.current;
    if (snapshot) painter.paint(snapshot.snails, snapshot.info);
  }, [race.moment, painter]);
  useLayoutEffect(() => {
    lanesRef.current = lanes;
    trackRef.current = track;
    namesRef.current = names;
    courseViewRef.current = courseView;
    /* Deeper lanes change the shot and every flag: re-measure, then repaint the last frame. */
    painter.refreshFlags();
    painter.measure();
  }, [courseView, lanes, names, painter, track]);

  const phase = race.phase as string;
  const confirming = phase === 'confirming';
  const finished = confirming || phase === 'done';
  /* The finish: hold on the line while the field runs in, behind the winner card too. */
  useEffect(() => {
    if (!finished) return;
    painter.beginFinish(race.results);
    let raf = 0;
    const until = wallClockMs() + 9000;
    const tick = () => {
      painter.finishFrame();
      if (wallClockMs() < until) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [finished, painter, race.results]);
  useEffect(() => {
    if (phase === 'idle' || phase === 'countdown') painter.endFinish();
  }, [phase, painter]);

  const twist = phase === 'running' ? staged : null;
  const card = useLingering(twist, 420, (item) => item.key);
  const countdown = useLingering(race.countdown || null, 420, (item) => item);
  const showResult = phase === 'done' && race.results.length > 0;
  const label = replay ? 'REPLAY' : confirming ? 'FINISH' : phase === 'done' ? 'OFFICIAL' : phase === 'void' ? 'VOID' : phase === 'running' ? 'LIVE' : 'READY';
  const announcement = confirming || phase === 'done' || phase === 'void' ? race.status : race.commentary || race.status;
  const winner = finished ? race.results.find((r) => r.place === 1) : undefined;
  /* Scenery is drawn three times across so a shift never shows an edge. */
  const copies = [0, 1, 2];

  /* The commentary always fits its strap on one line, shrinking rather than running off. */
  useLayoutEffect(() => {
    fitText(strapRef.current, 0.58);
  }, [announcement]);
  /* The title shrinks before it is ever clipped, whatever room the club name leaves it. */
  useLayoutEffect(() => {
    fitText(titleRef.current, 0.67);
  }, [phase]);
  useEffect(() => {
    const onResize = () => {
      fitText(strapRef.current, 0.58);
      fitText(titleRef.current, 0.67);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  /* A long twist name shrinks to fit its card, and a long winner's name its plate. */
  useLayoutEffect(() => {
    fitText(splashRef.current?.querySelector('.side-splash-title') as HTMLElement | null, 0.6);
    /* Measured once per card, so the camera never reads layout in its frame. */
    cardWidthRef.current = splashRef.current?.offsetWidth ?? 0;
  }, [card.shown]);
  useLayoutEffect(() => {
    fitText(plateNameRef.current, 0.55);
  }, [winner?.name]);

  return (
    <div
      className={`track-wrap tv-wrap race-broadcast course-broadcast side-broadcast ${reduceMotion ? 'calm race-motion-reduced' : ''} ${showResult ? 'has-result' : ''} ${names.length >= 10 ? 'side-field-big' : ''}`}
      style={{ '--field': names.length } as CSSProperties}
      data-race-phase={phase}
      data-reduced-motion={String(reduceMotion)}
      data-weather={race.weather}
      data-camera={courseView ? 'course' : 'trackside'}
      data-renderer="sidescroller"
    >
      <div className="course-scene side-scene" ref={sceneRef}>
        <div className="side-layer" aria-hidden="true" ref={(el) => { layerWrapRefs.current.sky = el; }}>
          <svg className="side-layer-art" viewBox={`${SCENERY_BOX.x} ${LAYER_TOP} ${SCENERY_BOX.w} ${LAYER_H}`} preserveAspectRatio="none">
            <rect className="tv-art-background" x="-20000" y="-20000" width="60000" height="20600" fill="#7cc6ff" />
            <circle cx="2100" cy="140" r="90" fill="#ffe36b" />
            <g fill="#fff" opacity=".9">
              <ellipse cx="400" cy="200" rx="160" ry="46" />
              <ellipse cx="470" cy="180" rx="90" ry="40" />
              <ellipse cx="1500" cy="150" rx="190" ry="50" />
              <ellipse cx="1560" cy="128" rx="100" ry="44" />
            </g>
          </svg>
        </div>
        <div className="side-layer" aria-hidden="true" ref={(el) => { layerWrapRefs.current.mountains = el; }}>
          <svg className="side-layer-art" viewBox={`${SCENERY_BOX.x} ${LAYER_TOP} ${SCENERY_BOX.w} ${LAYER_H}`} preserveAspectRatio="none">
            {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Mountains /></g>)}
          </svg>
        </div>
        <div className="side-layer" aria-hidden="true" ref={(el) => { layerWrapRefs.current.lake = el; }}>
          <svg className="side-layer-art" viewBox={`${SCENERY_BOX.x} ${LAYER_TOP} ${SCENERY_BOX.w} ${LAYER_H}`} preserveAspectRatio="none">
            {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Lake /></g>)}
          </svg>
        </div>
        <div className="side-layer" aria-hidden="true" ref={(el) => { layerWrapRefs.current.buildings = el; }}>
          <svg className="side-layer-art" viewBox={`${SCENERY_BOX.x} ${LAYER_TOP} ${SCENERY_BOX.w} ${LAYER_H}`} preserveAspectRatio="none">
            {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Scenery clubName={clubName} /></g>)}
          </svg>
        </div>
        <div className="side-layer side-world" ref={(el) => { layerWrapRefs.current.world = el; }}>
          <svg
            ref={svgRef}
            className="tv"
            viewBox={`${worldBox.x} ${LAYER_TOP} ${worldBox.w} ${LAYER_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Straight track: ${names.length} snails racing side on to the finish`}
          >
            {/* The fence and its boards, on the same grid as the posts so no post cuts a board. */}
            <rect x={worldBox.x} y="468" width={worldBox.w} height="60" fill="#e8e4dc" stroke="#2a1a1a" strokeWidth="4" />
            {fenceBoards.map((slot) => (
              <FenceBoard key={slot.x} x={slot.x} w={slot.w} board={slot.board} />
            ))}
            {/* The track itself is world-fixed: one marked lane per snail. */}
            <rect x={worldBox.x} y={TRACK_TOP} width={worldBox.w} height={trackBottom - TRACK_TOP} fill="#9a8a62" />
            {lanes.map((geo, lane) => (
              <rect key={`band-${lane}`} className="side-lane" x={worldBox.x} y={geo.top} width={worldBox.w} height={geo.pitch} fill={lane % 2 ? '#93825a' : '#a3936a'} />
            ))}
            {lanes.slice(1).map((geo, i) => (
              <line key={`rail-${i}`} x1={worldBox.x} x2={worldBox.x + worldBox.w} y1={geo.top} y2={geo.top} stroke="#fff" strokeWidth="4" strokeDasharray="40 30" opacity=".55" />
            ))}
            {/* The inside rail, and the front rail with the crowd in front of it. */}
            <rect x={worldBox.x} y={TRACK_TOP - 12} width={worldBox.w} height="14" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
            <rect x={worldBox.x} y={trackBottom} width={worldBox.w} height={VIEW_H - TRACK_BOTTOM + 200} fill="#5fa83a" />
            <rect x={worldBox.x} y={trackBottom + 4} width={worldBox.w} height="14" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
            {/* Distance posts: metres to go, the caller's markers, each on its own grid line. */}
            {track.distancePosts.map(({ metres, x }) => (
              <g key={`post-${metres}`} className="side-post" transform={`translate(${x} 0)`}>
                <line x1="0" x2="0" y1={TRACK_TOP} y2={trackBottom} stroke="#fff" strokeWidth="4" opacity=".22" />
                <rect x="-7" y={TRACK_TOP - 92} width="14" height="82" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
                <rect x="-56" y={TRACK_TOP - 152} width="112" height="62" rx="8" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
                <text x="0" y={TRACK_TOP - 107} textAnchor="middle" fontSize="42" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">{metres}m</text>
              </g>
            ))}
            {/* The stalls. */}
            <g className="side-start">
              <rect x={START_X - 150} y="400" width="300" height="60" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
              <text x={START_X} y="446" textAnchor="middle" fontSize="44" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">START</text>
              <rect x={START_X - 6} y={TRACK_TOP} width="12" height={trackBottom - TRACK_TOP} fill="#fff" opacity=".7" />
            </g>
            <g className="side-gates" aria-hidden="true">
              <rect className="side-gate-frame" x={START_X + 44} y={TRACK_TOP - 30} width="34" height={trackBottom - TRACK_TOP + 46} fill="#2f6f3a" stroke="#2a1a1a" strokeWidth="4" />
              {lanes.map((geo, lane) => (
                <rect key={`gate-${lane}`} className="side-gate" style={{ '--i': lane } as CSSProperties} x={START_X + 50} y={geo.top + 6} width="22" height={geo.pitch - 12} fill="#fff" stroke="#a81d2f" strokeWidth="5" />
              ))}
            </g>
            {/* The winning post: a red line straight across, judged on the nose. */}
            <g className="side-finish" transform={`translate(${track.trackLen} 0)`}>
              <rect x="-160" y="400" width="320" height="60" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
              <text x="0" y="446" textAnchor="middle" fontSize="44" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">FINISH</text>
              <rect x="-10" y={TRACK_TOP} width="20" height={trackBottom - TRACK_TOP} fill="#e8262b" />
              <line x1="0" x2="0" y1={TRACK_TOP} y2={trackBottom} stroke="#fff" strokeWidth="6" strokeDasharray="28 28" opacity=".7" />
              <rect x="-8" y="460" width="16" height={TRACK_TOP - 460} fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
              {sponsor ? <FinishBanner sponsor={sponsor} title={sponsorTitle} /> : null}
            </g>
            {twist && twist.field ? (
              <rect key={`band-${twist.key}`} className={`side-band tone-${twist.tone}`} data-phase={twist.phase} x={worldBox.x} width={worldBox.w} y={TRACK_TOP} height={trackBottom - TRACK_TOP} aria-hidden="true" />
            ) : null}
          </svg>
          <div className="side-runner-layer tv-runners side-runners" ref={chipLayerRef}>
            {/* The props, each on its own small layer under the snails: they move and animate without repainting the track. */}
            {twist
              ? (twist.presentation.cue === 'gate' ? [-1] : twist.propLanes).map((lane) => (
                  <div
                    key={`${twist.key}:${lane}`}
                    className="side-prop-chip"
                    ref={(node) => {
                      if (node) propNodesRef.current.set(lane, node);
                      else propNodesRef.current.delete(lane);
                    }}
                    aria-hidden="true"
                  >
                  <svg className="side-chip-art" viewBox={`${PROP_BOX.x} ${PROP_BOX.y} ${PROP_BOX.w} ${PROP_BOX.h}`}>
                    <g
                      className={`course-prop side-prop side-prop-${twist.presentation.cue}`}
                      data-lane={lane}
                      data-phase={twist.phase}
                      data-tone={twist.tone}
                      data-glyph={twist.presentation.glyph ?? ''}
                    >
                      <g className="course-prop-motion side-prop-motion">
                        {twist.presentation.glyph ? (
                          <g className="course-prop-symbol course-prop-vector" transform="scale(6)" data-glyph={twist.presentation.glyph}>
                            <PropGlyph id={twist.presentation.glyph} animated />
                          </g>
                        ) : (
                          <text className="course-prop-symbol" y="-60" textAnchor="middle" fontSize="300">{twist.presentation.symbol}</text>
                        )}
                      </g>
                    </g>
                  </svg>
                  </div>
                ))
              : null}
            {names.map((name, lane) => (
              /* An HTML layer carries the runner: moving an <svg> root by transform made the browser lay its insides out again every frame. */
              <div
                key={lane}
                className="side-runner-chip"
                ref={(node) => {
                  if (node) chipsRef.current.set(lane, node);
                  else chipsRef.current.delete(lane);
                }}
              >
              <svg className="side-chip-art" viewBox={`${CHIP.x} ${CHIP.y} ${CHIP.w} ${CHIP.h}`}>
                <SnailSprite
                  lane={lane}
                  number={numbers?.[lane] ?? numberOffset + lane + 1}
                  name={name}
                  scale={lanes[lane].scale}
                  nodeRef={(node) => {
                    if (node) nodesRef.current.set(lane, node);
                    else nodesRef.current.delete(lane);
                  }}
                />
                {/* After the sprite, so speed lines and dust never cross the name. */}
                <SnailFlag
                  lane={lane}
                  pitch={lanes[lane].pitch}
                  scale={lanes[lane].scale}
                  name={name}
                  nodeRef={(node) => {
                    if (node) flagNodesRef.current.set(lane, node);
                    else flagNodesRef.current.delete(lane);
                  }}
                />
              </svg>
              </div>
            ))}
          </div>
        </div>
        {/* The crowd in front of the rail, a layer above the track and below every lane. */}
        <div className="side-layer side-crowd-layer" aria-hidden="true" ref={(el) => { layerWrapRefs.current.crowd = el; }}>
          {CROWD_PHASES.map((crowdPhase) => (
            <div key={crowdPhase} className={`side-crowd-phase side-crowd-phase-${crowdPhase}`}>
              <svg className="side-layer-art" viewBox={`${SCENERY_BOX.x} ${LAYER_TOP} ${SCENERY_BOX.w} ${LAYER_H}`} preserveAspectRatio="none">
                {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Crowd phase={crowdPhase} /></g>)}
              </svg>
            </div>
          ))}
        </div>

        {/* The twist card: one card for every course, over the top of the course, never over a lane. */}
        {card.shown ? (
          <div
            ref={splashRef}
            key={card.shown.key}
            className={`side-splash side-splash-${card.shown.phase} tone-${card.shown.tone}${card.leaving ? ' side-splash-leaving' : ''}`}
            data-twist={card.shown.eventId}
            data-kicker={splashKicker(card.shown.phase === 'warning' ? 'warning' : 'effect', card.shown.tone, card.shown.consequence).toLowerCase()}
            role="status"
            aria-live="assertive"
            aria-atomic="true"
          >
            <span className="side-splash-kicker">{splashKicker(card.shown.phase === 'warning' ? 'warning' : 'effect', card.shown.tone, card.shown.consequence)}</span>
            <strong className="side-splash-title">{card.shown.label}</strong>
          </div>
        ) : null}

        {/* The count to the off: one digit at a time on a dark plate, then GO. */}
        {countdown.shown ? (
          <div className={`side-countdown${countdown.leaving ? ' side-countdown-leaving' : ''}${countdown.shown.startsWith('GO') ? ' side-countdown-go' : ''}`} aria-hidden="true">
            <span key={countdown.shown} className="side-countdown-digit num">{countdown.shown}</span>
          </div>
        ) : null}

        {/* The finish: a flash for the photo, and the winner named clear of the line. */}
        {confirming ? <div className="side-photo-flash" aria-hidden="true" /> : null}
        {winner ? (
          <div className="side-finish-plate" style={{ '--shell': laneColour(winner.lane).shell } as CSSProperties} aria-hidden="true">
            <span className="side-finish-kicker">{phase === 'done' ? 'OFFICIAL' : 'WINNER'}</span>
            <span className="side-finish-num num">{numbers?.[winner.lane] ?? numberOffset + winner.lane + 1}</span>
            <strong ref={plateNameRef} className="side-finish-name">{winner.name}</strong>
          </div>
        ) : null}
      </div>

      {/* The running order, leader first, as a racing telecast shows it: the top three by name. */}
      <div className="side-progress" ref={barRef} role="progressbar" aria-label="Leader's progress to the finish, in metres" aria-valuemin={0} aria-valuemax={RACE_METRES} aria-valuenow={0}>
        <ol className="side-order" aria-hidden="true">
          {names.map((name, lane) => {
            const c = laneColour(lane);
            return (
              <li
                key={lane}
                data-rank={lane + 1}
                title={name}
                style={{ order: lane + 1, '--shell': c.shell, '--shell-dk': c.dark } as CSSProperties}
                ref={(node) => {
                  if (node) orderRefs.current.set(lane, node);
                  else orderRefs.current.delete(lane);
                }}
              >
                <span className="side-order-num num">{numbers?.[lane] ?? numberOffset + lane + 1}</span>
                <span className="side-order-name">{name}</span>
              </li>
            );
          })}
        </ol>
        <span className="side-flag" aria-hidden="true" />
        <div className="side-progress-fill" ref={fillRef} aria-hidden="true" />
      </div>

      {showResult ? (
        <OfficialResult results={race.results} raceNo={raceNo} sponsor={sponsor} tote={toteResult} replay={replay} runnerSponsors={owners} numberOffset={numberOffset} numbers={numbers} />
      ) : null}

      <div className="course-director-bar">
        <button
          type="button"
          className="race-camera-toggle"
          aria-pressed={courseView}
          disabled={phase === 'idle' || phase === 'countdown'}
          onClick={() => {
            courseViewRef.current = !courseViewRef.current;
            if (onCourseViewChange) onCourseViewChange(courseViewRef.current);
            else setCourseView(courseViewRef.current);
            const snapshot = snapshotRef.current;
            if (snapshot) painter.paint(snapshot.snails, snapshot.info);
          }}
        >
          {courseView ? 'Telecast' : 'Full field'}
        </button>
      </div>

      <section className="race-hud" aria-label={`Race ${raceNo} status`}>
        <div className="tv-top">
          <ClubBrand className="club-brand tv-club-brand" imageClassName="club-brand-logo tv-club-logo" nameClassName="tv-club-name" priority />
          <span className={`tv-live ${phase === 'running' ? 'tv-live-on' : ''} ${phase === 'void' ? 'tv-void' : ''} ${replay ? 'tv-replay' : ''} ${confirming ? 'tv-confirming-badge' : ''}`}>
            <i aria-hidden="true" /> {label}
          </span>
          <span className="tv-race-chip num">RACE {raceNo}</span>
          <span ref={titleRef} className="tv-title">SNAIL RACING</span>
          {race.photoFinish && phase !== 'done' ? <span className="tv-photo num" role="status">PHOTO FINISH</span> : null}
          <span ref={toGoRef} className="side-togo num" aria-hidden="true">{RACE_METRES.toFixed(1)} m to go</span>
          {replay ? null : (
            <span ref={clockRef} className="tv-clock num" role="timer" aria-label="Elapsed race time">0:00.0</span>
          )}
        </div>
        <div className="tv-strap">
          <span className="tv-strap-badge" aria-hidden="true">{confirming || phase === 'done' ? 'RESULT' : 'COMMENTARY'}</span>
          <p ref={strapRef} className="tv-strap-line" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        </div>
      </section>
    </div>
  );
}
