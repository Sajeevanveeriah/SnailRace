'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { laneColour } from '@/lib/palette';
import { ClubBrand } from './brand/ClubBrand';
import { SurpriseLayer } from './race-broadcast/SurpriseLayer';
import { presentationForMoment, type SurprisePresentation } from './race-broadcast/surprise-presentation';
import { PropGlyph } from './race-broadcast/prop-glyphs';
import { useReducedMotion } from './race-broadcast/useReducedMotion';
import { OfficialResult } from './race-broadcast/BroadcastGraphics';
import { clockText } from '@/lib/broadcast';
import { sponsorsFromRace } from '@/lib/club-sponsors';
import type { SnailRun } from '@/lib/race-engine';
import type { PaintInfo, RaceController, RacePainter, SurprisePhase } from '@/lib/use-race';
import type { CameraMode, LockedRaceEvent, ToteDividend } from '@/lib/types';

/**
 * The side-on cartoon race.
 *
 * Shot the way a race night audience already knows from horse racing and
 * the cartoon race-night films: a straight seen side on from the stand, one
 * snail per marked lane in racecard order (lowest number on top), starting
 * stalls that open at the off, distance posts counting down to a vertical
 * winning post, and a running-order strip along the bottom that names the
 * field leader first. The first nose to the post is the winner on screen,
 * as it is in the result.
 *
 * The camera is tight: it rides with the leading pack so the scenery flies
 * past and a snail is a real size on the projector, and the POSITIONS strip
 * names whoever has dropped out of shot. Full field view widens to every
 * runner. The lanes overlap the way the cartoon films stack their runners,
 * with every saddlecloth number kept clear of the shell below it, and the
 * lower lane is always drawn in front so the stacking order never flickers.
 *
 * Surprises are physical gags. Every twist is staged from the locked plan
 * itself, not from a passing banner: the warning sign goes up, the prop
 * arrives, it lands on the snail (or across the whole field) and stays
 * there for as long as the consequence runs, while the snail it hit shakes,
 * squashes, or lights up and streaks away. A title card slams in with the
 * name of the twist and nothing else: the room reads who it hit from the
 * prop and the saddlecloth numbers, not from a table of seconds.
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
  sponsors?: string[];
  toteResult?: ToteDividend | null;
  numberOffset?: number;
  replay?: boolean;
}

const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/* ── The world ─────────────────────────────────────────────────────────── */

/** World units. The stalls are at START_X, the winning post at TRACK_LEN. */
export const TRACK_LEN = 9000;
/** Where every nose starts: the front of the stalls. */
const START_X = 160;
const VIEW_H = 1350;
/** The narrowest shot, in world units: close enough that a snail is a real size. */
const PACK_VIEW_W = 1900;
/** The widest the following shot goes before it lets the tail of the field go. */
const FOLLOW_MAX_W = 3000;
/** The marked lanes. Racecard order, lane 0 on top. */
const TRACK_TOP = 540;
const TRACK_BOTTOM = 1300;
/** Every frame shows from the distance-post signs down to the crowd. */
const REQUIRED_H = VIEW_H - 380;
/** The straight is called in metres to go, like a race caller's distance posts. */
export const RACE_METRES = 10;
/** Kept for the oval's import shape; the straight follows the field instead. */
export const LEAD_PACK = 4;

/* Snail art, unscaled: the front of the foot is the nose. */
const ART_NOSE = 190;
const ART_TAIL = 150;
const ART_HEIGHT = 176;
/** From the foot line up to the bottom of the saddlecloth number. */
const ART_NUMBER_CLEARANCE = 124;

export interface LaneGeometry {
  /** Top of the lane band. */
  top: number;
  /** Lane band height. */
  pitch: number;
  /** Where the snail's foot sits. */
  y: number;
  /** One scale for every snail, so nobody looks closer or bigger. */
  scale: number;
}

/**
 * Equal lanes, equal snails, no perspective. The snails are allowed to stand
 * taller than their lane, like the cartoon films stack a field, but never so
 * tall that the shell in the lane below covers a saddlecloth number.
 */
export function laneGeometry(lane: number, fieldSize: number): LaneGeometry {
  const n = Math.max(1, fieldSize);
  const pitch = (TRACK_BOTTOM - TRACK_TOP) / n;
  const scale = Math.min(0.8, (pitch * 0.95) / ART_NUMBER_CLEARANCE);
  const top = TRACK_TOP + lane * pitch;
  return { top, pitch, y: top + pitch - 8 * scale - pitch * 0.04, scale };
}

const worldX = (p: number): number => START_X + p * (TRACK_LEN - START_X);

/* ── Scenery, repeating ───────────────────────────────────────────────── */

const SCENE_W = 3200;

/*
 * Each depth of the picture (sky, hills, lake, buildings, and the track world
 * itself) is painted once into its own layer and slid by the camera with a
 * CSS transform. Moving a painted layer is nearly free; re-drawing the whole
 * scene every frame, which a changing viewBox forces, is what made the
 * following shot stutter while the full-course view stayed smooth.
 */
const LAYER_TOP = VIEW_H - 1700;
const LAYER_H = 1820;
/** Local box of a repeating scenery layer: three copies and a margin. */
const SCENERY_BOX = { x: -400, w: SCENE_W * 3 + 800 };
/** Local box of the track world, wide enough for any shot the camera takes. */
const WORLD_BOX = { x: -1500, w: TRACK_LEN + 3000 };
type LayerName = 'sky' | 'mountains' | 'lake' | 'buildings' | 'fence' | 'world' | 'crowd';
/*
 * The fence and the crowd move with the track but repeat, so each is its own
 * layer at factor 1: the world layer never repaints for them, and the crowd's
 * bob runs on the compositor instead of restyling the world every frame.
 */
const SCENERY_LAYERS: { name: Exclude<LayerName, 'world'>; factor: number }[] = [
  { name: 'sky', factor: 0 },
  { name: 'mountains', factor: 0.12 },
  { name: 'lake', factor: 0.25 },
  { name: 'buildings', factor: 0.5 },
  { name: 'fence', factor: 1 },
  { name: 'crowd', factor: 1 },
];
/** The crowd bobs in three groups, out of step, so the stand never moves as one. */
const CROWD_PHASES = [0, 1, 2];
/*
 * Each runner, with its tag, is drawn into its own small chip that the camera
 * world carries and a transform slides along. Moving a snail inside the world
 * picture made the browser redraw the track under it every frame; a chip is
 * painted once and only its own little animations repaint.
 */
const CHIP = { x: -720, y: -340, w: 1160, h: 420 };
const wallClockMs = () => performance.now();

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

/** The crowd on the front rail: one of the three groups of heads and arms that bob while they race. */
function Crowd({ phase }: { phase: number }) {
  const heads = Array.from({ length: 26 }, (_, i) => i).filter((i) => i % 3 === phase);
  return (
    <g className="side-crowd">
      {heads.map((i) => {
        const x = i * (SCENE_W / 26) + ((i * 37) % 50);
        const h = 54 + ((i * 13) % 24);
        const fill = i % 3 === 0 ? '#4a2a5e' : i % 3 === 1 ? '#5a3272' : '#3f2554';
        return (
          <g key={i} transform={`translate(${x} ${VIEW_H + 40})`}>
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
        {/* shell */}
        <g className="side-shell">
          <ellipse cx="-20" cy="-82" rx="112" ry="84" fill={c.shell} stroke="#2a1a1a" strokeWidth="6" />
          <path d="M-20 -82 m-70 0 a70 70 0 1 1 140 0 a50 50 0 1 1 -100 0 a30 30 0 1 1 60 0" fill="none" stroke="#2a1a1a" strokeWidth="5" opacity=".35" />
          <text x="-20" y={number >= 10 ? -46 : -42} textAnchor="middle" fontSize={number >= 100 ? 78 : number >= 10 ? 104 : 120} fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#fff" stroke="#2a1a1a" strokeWidth="8" paintOrder="stroke">{number}</text>
        </g>
        {/* mouth */}
        <path className="side-mouth" d="M150 -16 Q165 -8 178 -18" fill="none" stroke="#2a1a1a" strokeWidth="4" strokeLinecap="round" />
        </g>
        {/* dizzy stars while stuck */}
        <g className="side-dizzy" aria-hidden="true">
          <path d="M-60 -200 l12 27 30 3 -22 20 6 30 -26 -15 -26 15 6 -30 -22 -20 30 -3Z" fill="#ffe36b" stroke="#2a1a1a" strokeWidth="4" />
          <path d="M40 -225 l9 20 22 3 -16 15 4 22 -19 -12 -19 12 4 -22 -16 -15 22 -3Z" fill="#ffe36b" stroke="#2a1a1a" strokeWidth="4" />
        </g>
      </g>
    </g>
  );
}

/** The tag over a snail: what just happened to it, in words the back row can read. Drawn above every prop. */
function SnailTag({ lane, offset, nodeRef }: { lane: number; offset: string; nodeRef: (node: SVGGElement | null) => void }) {
  return (
    <g transform={offset}>
    <g ref={nodeRef} className="side-tag" data-lane={lane} aria-hidden="true">
      <rect className="side-tag-box" x="-90" y="-44" width="180" height="48" rx="10" />
      <text className="side-tag-text" x="0" y="-10" textAnchor="middle" fontSize="34" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" />
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
  /** Signed clock shift per affected lane, when the engine knows it. */
  deltaByLane: Record<number, number>;
  consequence?: 'advance' | 'delay' | 'retire';
  warningText: string;
  commentaryText: string;
  big: boolean;
  /** Where this came from, so the two paths can never both draw a prop. */
  source: 'plan' | 'moment';
}

/** How long an effect stays staged on screen after it lands, at least. */
const EFFECT_ON_AIR_MS = 2600;

const phaseRank: Record<SurprisePhase, number> = { warning: 0, reveal: 1, effect: 2 };

/**
 * The twist on air at race-time `t`, from the locked plan's own events.
 *
 * A landing effect owns the screen for `EFFECT_ON_AIR_MS`; after that it
 * has had its title and its prop merely stays with its snail, so a newer
 * card's warning or reveal takes over the moment it starts (the tags keep
 * the older consequence readable). Without that a long hold would swallow
 * the next card's build-up.
 */
function stagedFromPlan(events: LockedRaceEvent[], t: number): StagedTwist | null {
  let best: { event: LockedRaceEvent; phase: SurprisePhase; rank: number } | null = null;
  for (const event of events) {
    if (t < event.warningAtMs) continue;
    const end = Math.max(event.effectEndMs, event.effectAtMs + EFFECT_ON_AIR_MS);
    if (t >= end) continue;
    const phase: SurprisePhase = t < event.revealAtMs ? 'warning' : t < event.effectAtMs ? 'reveal' : 'effect';
    const rank = phase === 'effect' && t >= event.effectAtMs + EFFECT_ON_AIR_MS ? -1 : phaseRank[phase];
    if (
      !best ||
      rank > best.rank ||
      (rank === best.rank && event.effectAtMs > best.event.effectAtMs)
    ) best = { event, phase, rank };
  }
  if (!best) return null;
  const { event, phase } = best;
  return {
    key: `${event.id}:${phase}`,
    eventId: event.id,
    phase,
    label: event.label,
    kind: event.kind,
    tone: event.tone,
    targetLanes: event.targetLanes,
    deltaByLane: event.clockDeltaMsByLane,
    consequence: event.consequence === 'retire' ? 'retire' : event.consequence === 'advance' ? 'advance' : 'delay',
    warningText: event.warningText,
    commentaryText: event.commentaryText,
    /* Two snails is a duel (the bat and its victim, a shell swap); a field twist is three or more. */
    big: event.targetLanes.length > 2,
    source: 'plan',
  };
}

/* ── The renderer ─────────────────────────────────────────────────────── */

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
  sponsors = [],
  toteResult,
  numberOffset = 0,
  replay = false,
}: Props) {
  const { setPainter } = race;
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = calm || prefersReducedMotion;
  const [localCourseView, setCourseView] = useState(false);
  const courseView = fullCourse ?? (localCourseView || cameraMode === 'full');
  const courseViewRef = useRef(false);

  const sceneRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef(new Map<number, SVGGElement>());
  const tagNodesRef = useRef(new Map<number, SVGGElement>());
  const chipsRef = useRef(new Map<number, SVGSVGElement>());
  const chipLayerRef = useRef<HTMLDivElement>(null);
    const layerWrapRefs = useRef<Partial<Record<LayerName, HTMLDivElement | null>>>({});
  /** World units to layer pixels, fixed per screen size so layers paint once. */
  const rasterRef = useRef(1);
  const sceneWidthRef = useRef(0);
  const propRef = useRef<SVGGElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const toGoRef = useRef<HTMLSpanElement>(null);
  const orderRefs = useRef(new Map<number, HTMLLIElement>());
  const leaderRef = useRef<HTMLSpanElement>(null);
  const snapshotRef = useRef<{ snails: SnailRun[]; info: PaintInfo } | null>(null);
  const momentRef = useRef(race.moment);
  const aspectRef = useRef(16 / 9);
  const camRef = useRef({ x: -200, w: PACK_VIEW_W });
  const lastPaintRef = useRef(0);
  /* The twist on air, derived from the plan on every frame; React only hears
     about it when it changes, which is a handful of times a race. */
  const stagedRef = useRef<StagedTwist | null>(null);
  const [staged, setStaged] = useState<StagedTwist | null>(null);
  const tagRef = useRef(new Map<number, string>());

  const lanes = useMemo(() => names.map((_, lane) => laneGeometry(lane, names.length)), [names]);
  const snailLen = (ART_NOSE + ART_TAIL) * (lanes[0]?.scale ?? 0.5);
  const signs = useMemo(() => {
    const list = [clubName.toUpperCase(), sponsor ? `PRESENTED BY ${sponsor.toUpperCase()}` : 'SNAIL RACING', ...sponsors.map((s) => s.toUpperCase())];
    return list.filter(Boolean);
  }, [clubName, sponsor, sponsors]);
  /* Two club sponsors' logos on the fence each race, a different pair every race. */
  const fenceLogos = useMemo(() => sponsorsFromRace(raceNo).slice(0, 2), [raceNo]);

  const painter = useMemo<RacePainter>(() => {
    const place = (lane: number, progress: number) => {
      const geo = lanes[lane];
      const x = worldX(progress);
      const k = rasterRef.current;
      const chip = chipsRef.current.get(lane);
      if (chip) chip.style.transform = `translate3d(${((x + CHIP.x - WORLD_BOX.x) * k).toFixed(2)}px, ${((geo.y + CHIP.y - LAYER_TOP) * k).toFixed(2)}px, 0)`;
      nodesRef.current.get(lane)?.setAttribute('data-progress', String(progress));
      return x;
    };
    /** The narrowest shot that still shows every lane at this screen shape. */
    const minW = () => {
      const aspect = aspectRef.current;
      /* A portrait phone gets a close shot of the track rather than a frame of sky. */
      return aspect < 1.2 ? REQUIRED_H * aspect * 1.15 : Math.max(PACK_VIEW_W, REQUIRED_H * aspect);
    };
    const setOrder = (ranked: SnailRun[]) => {
      ranked.forEach((s, i) => {
        const el = orderRefs.current.get(s.lane);
        if (!el) return;
        const rank = String(i + 1);
        if (el.dataset.rank !== rank) {
          el.dataset.rank = rank;
          el.style.order = rank;
        }
        el.classList.toggle('done', s.done);
        el.classList.toggle('retired', Boolean(s.retired));
      });
    };
    const setTag = (lane: number, text: string, tone: string) => {
      if (tagRef.current.get(lane) === `${tone}|${text}`) return;
      tagRef.current.set(lane, `${tone}|${text}`);
      const tag = tagNodesRef.current.get(lane);
      const label = tag?.querySelector('.side-tag-text') as SVGTextElement | null;
      const box = tag?.querySelector('.side-tag-box') as SVGRectElement | null;
      if (!tag || !label || !box) return;
      label.textContent = text;
      tag.setAttribute('data-tone', tone);
      tag.classList.toggle('on', Boolean(text));
      const w = Math.max(120, text.length * 21 + 36);
      box.setAttribute('x', String(-w / 2));
      box.setAttribute('width', String(w));
    };
    /** Where a repeating layer drawn at this parallax factor starts, in world x. */
    const sceneryAt = (camX: number, factor: number) =>
      factor === 0 ? camX : camX + ((-camX * factor) % SCENE_W) - SCENE_W;
    /*
     * Point the camera at world x camX with a shot viewW by viewH, bottom
     * anchored on the ground line. Only layer transforms change; the fence and
     * crowd copies jump a whole scenery width now and then, never per frame.
     */
    const frame = (camX: number, viewW: number, viewH: number) => {
      const sceneW = sceneWidthRef.current;
      if (!sceneW) return;
      const viewY = VIEW_H - viewH;
      const k = rasterRef.current;
      const s = sceneW / viewW;
      const place = (name: LayerName, boxX: number, originX: number) => {
        const el = layerWrapRefs.current[name];
        if (!el) return;
        const tx = (boxX + originX - camX) * s;
        const ty = (LAYER_TOP - viewY) * s;
        el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${(s / k).toFixed(5)})`;
      };
      for (const layer of SCENERY_LAYERS) place(layer.name, SCENERY_BOX.x, sceneryAt(camX, layer.factor));
      place('world', WORLD_BOX.x, 0);
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
        const w = name === 'world' ? WORLD_BOX.w : SCENERY_BOX.w;
        el.style.width = `${Math.ceil(w * k)}px`;
        el.style.height = `${Math.ceil(LAYER_H * k)}px`;
      }
      chipLayerRef.current?.style.setProperty('--chip-w', `${(CHIP.w * k).toFixed(2)}px`);
      chipLayerRef.current?.style.setProperty('--chip-h', `${(CHIP.h * k).toFixed(2)}px`);
    };
    const paint: RacePainter['paint'] = (snails, info) => {
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
        next = stagedFromPlan(planEvents, t);
      } else {
        const moment = momentRef.current;
        if (moment && info.leadP <= 1) {
          next = {
            key: `moment-${moment.id}`,
            eventId: moment.eventId ?? `moment-${moment.id}`,
            phase: moment.phase ?? 'effect',
            label: moment.label ?? moment.text,
            kind: moment.kind ?? '',
            tone: moment.tone === 'good' ? 'good' : moment.tone === 'bad' ? 'bad' : 'wild',
            targetLanes: moment.targetLanes ?? [info.ranked[0]?.lane ?? 0],
            deltaByLane: moment.deltaMs && moment.targetLanes?.length ? { [moment.targetLanes[0]]: moment.deltaMs } : {},
            consequence: moment.consequence,
            warningText: moment.text,
            commentaryText: moment.text,
            big: Boolean(moment.big),
            source: 'moment',
          };
        }
      }
      if ((next?.key ?? null) !== (stagedRef.current?.key ?? null)) {
        stagedRef.current = next;
        setStaged(next);
      }

      for (const snail of snails) {
        const node = nodesRef.current.get(snail.lane);
        if (!node) continue;
        node.classList.toggle('retired', Boolean(snail.retired));
        /* The reaction follows the consequence, not the name of the gag. */
        let delta = 0;
        let live: LockedRaceEvent | undefined;
        if (snail.lockedMotion) {
          /* The newest consequence on this lane is the one to show: a boost
             still easing in loses the tag to a hold that has just landed. */
          live = snail.lockedMotion.events
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
        const place1 = snail.done && !snail.retired && snail.place === 1;
        /* The snail's own number says who it is; the only word over a shell is the winner's. */
        if (place1) setTag(snail.lane, 'WINNER!', 'win');
        else setTag(snail.lane, '', 'none');
        place(snail.lane, snail.p);
      }
      for (const snail of info.justFinished) nodesRef.current.get(snail.lane)?.classList.add('finished');

      /*
       * Camera: ride with the leading pack. The leader is always in shot with
       * room to run into; runners behind are added in running order while
       * they fit a tight following shot, so the picture stays close and the
       * scenery moves, and the running-order strip names the rest. Full
       * field view takes everyone. Every lane is always in frame.
       */
      const aspect = aspectRef.current;
      const narrowest = minW();
      const maxW = courseViewRef.current ? Infinity : Math.max(narrowest, Math.min(FOLLOW_MAX_W, narrowest * 1.3));
      const order = info.ranked.length ? info.ranked : snails;
      const headroom = 380;
      const leadX = worldX(order[0]?.p ?? 0);
      let right = leadX + headroom;
      let left = leadX - snailLen - 140;
      for (const snail of order) {
        const tail = worldX(snail.p) - snailLen - 140;
        if (tail >= left) continue;
        if (right - tail > maxW) break;
        left = tail;
      }

      /* The prop sits on the snail it hits; a field-wide one sits mid-shot. */
      const twist = stagedRef.current;
      if (twist && propRef.current) {
        const targets = twist.targetLanes.length ? twist.targetLanes : [info.ranked[0]?.lane ?? 0];
        const presentation = presentationForMoment({ id: 0, text: twist.commentaryText, tone: 'hot', label: twist.label, kind: twist.kind });
        const cue = presentation?.cue ?? 'drop';
        const scale = lanes[0]?.scale ?? 0.5;
        const big = targets.length > 2 || cue === 'pull';
        const held = targets.filter((lane) => (twist.deltaByLane[lane] ?? 0) < 0);
        if (cue === 'gate') {
          /* The gate drops just in front of the first snail it stopped. */
          const stopped = snails.filter((s) => held.includes(s.lane));
          const frontP = stopped.length ? Math.max(...stopped.map((s) => s.p)) : (order[0]?.p ?? 0);
          const x = worldX(frontP) + 150;
          propRef.current.setAttribute('data-size', 'field');
          propRef.current.setAttribute('transform', `translate(${x} ${TRACK_BOTTOM + 10}) scale(${Math.max(0.7, scale * 2.2)})`);
          right = Math.max(right, x + 260);
        } else if (big) {
          propRef.current.setAttribute('data-size', 'field');
          propRef.current.setAttribute('transform', `translate(${(left + right) / 2} ${TRACK_TOP + (TRACK_BOTTOM - TRACK_TOP) * 0.8}) scale(${Math.max(0.55, scale * 1.4)})`);
        } else {
          /* The prop lands on the snail that wears the consequence: the one
             the bat hit, not the one swinging it. */
          const featured = snails.find((s) => s.lane === (held[0] ?? targets[0]));
          if (featured) {
            const geo = lanes[featured.lane];
            propRef.current.setAttribute('data-size', 'single');
            const ahead = twist.phase === 'warning' ? 260 : twist.phase === 'reveal' ? 120 : 0;
            const x = worldX(featured.p) - (cue === 'stomp' ? snailLen * 0.35 : 0) + ahead;
            const propScale = Math.max(0.5, scale * (cue === 'stomp' ? 2.2 : 1.35));
            propRef.current.setAttribute('transform', `translate(${x} ${geo.y}) scale(${propScale})`);
            right = Math.max(right, x + 280);
          }
        }
      }

      /* The run home: once the winning post can join the shot, it stays in it. */
      if (info.finalStraight && TRACK_LEN + 320 - left <= maxW) right = Math.max(right, TRACK_LEN + 320);
      const wantW = Math.max(narrowest, right - left);
      let targetX = right - wantW + (wantW - (right - left)) * 0.5 * (courseViewRef.current ? 1 : 0.3);
      targetX = Math.max(-260, Math.min(TRACK_LEN + 460 - wantW, targetX));
      const cam = camRef.current;
      /* Eased by elapsed time, not per frame, so a late frame catches up
         instead of letting the snails slide against the scenery. */
      const now = wallClockMs();
      const dt = lastPaintRef.current ? Math.min(100, now - lastPaintRef.current) : 16.7;
      lastPaintRef.current = now;
      const ease = reduceMotion ? 1 : 1 - Math.pow(0.9, dt / 16.7);
      cam.x += (targetX - cam.x) * ease;
      cam.w += (wantW - cam.w) * ease;
      /* Never narrower than every lane allows, even mid-ease. */
      const viewW = Math.max(cam.w, narrowest);
      const viewH = viewW / aspect;
      frame(cam.x, viewW, viewH);

      const clock = clockText(t);
      if (clockRef.current && clockRef.current.textContent !== clock) clockRef.current.textContent = clock;
      const lead = Math.min(1, Math.max(0, info.leadP));
      if (barRef.current) {
        barRef.current.style.setProperty('--lead', String(lead));
        barRef.current.setAttribute('aria-valuenow', String(Math.round(lead * RACE_METRES * 10) / 10));
      }
      if (toGoRef.current) {
        const text = lead >= 1 ? 'FINISH' : `${((1 - lead) * RACE_METRES).toFixed(1)} m to go`;
        if (toGoRef.current.textContent !== text) toGoRef.current.textContent = text;
      }
      setOrder(order);
      if (leaderRef.current) {
        const first = info.ranked[0];
        const text = first ? `${numberOffset + first.lane + 1} ${names[first.lane]} ${first.done ? 'wins' : 'leads'}` : '';
        if (leaderRef.current.textContent !== text) leaderRef.current.textContent = text;
      }
    };
    return {
      measure: () => {
        const scene = sceneRef.current;
        if (scene?.clientHeight) {
          aspectRef.current = scene.clientWidth / scene.clientHeight;
          sceneWidthRef.current = scene.clientWidth;
          sizeLayers();
        }
        const snapshot = snapshotRef.current;
        if (snapshot) paint(snapshot.snails, snapshot.info);
        else {
          const w = minW();
          /* The opening shot is where the race camera starts, so the gates opening is not a jump cut. */
          camRef.current = { x: -260, w };
          frame(-260, w, w / aspectRef.current);
          /* The chips are sized in layer pixels, so a new size moves them too. */
          nodesRef.current.forEach((node, lane) => place(lane, Number(node.dataset.progress ?? 0)));
        }
      },
      start: () => {
        sceneRef.current?.querySelectorAll('svg.tv, svg.side-layer-art, svg.side-runner-chip, .side-crowd-phase').forEach((svg) => svg.classList.add('racing'));
      },
      reset: () => {
        snapshotRef.current = null;
        sceneRef.current?.querySelectorAll('svg.tv, svg.side-layer-art, svg.side-runner-chip, .side-crowd-phase').forEach((svg) => svg.classList.remove('racing'));
        svgRef.current?.classList.remove('racing', 'gates-open', 'run-home');
        layerWrapRefs.current.crowd?.classList.remove('run-home');
        const w = minW();
        camRef.current = { x: -260, w };
        lastPaintRef.current = 0;
        stagedRef.current = null;
        setStaged(null);
        tagRef.current.clear();
        nodesRef.current.forEach((node, lane) => {
          place(lane, 0);
          node.classList.remove('finished', 'retired', 'fx-up', 'fx-down');
          const tag = tagNodesRef.current.get(lane);
          tag?.classList.remove('on');
          const label = tag?.querySelector('.side-tag-text');
          if (label) label.textContent = '';
        });
        orderRefs.current.forEach((el, lane) => {
          el.dataset.rank = String(lane + 1);
          el.style.order = String(lane + 1);
          el.classList.remove('done', 'retired');
        });
        if (clockRef.current) clockRef.current.textContent = '0:00.0';
        if (barRef.current) {
          barRef.current.style.setProperty('--lead', '0');
          barRef.current.setAttribute('aria-valuenow', '0');
        }
        if (toGoRef.current) toGoRef.current.textContent = `${RACE_METRES.toFixed(1)} m to go`;
        if (leaderRef.current) leaderRef.current.textContent = '';
        frame(-260, w, w / aspectRef.current);
      },
      paint,
    };
  }, [lanes, names, numberOffset, reduceMotion, snailLen]);

  useEffect(() => {
    setPainter(painter);
    painter.reset();
    painter.measure();
    return () => setPainter(null);
  }, [painter, setPainter]);
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
  useEffect(() => {
    courseViewRef.current = courseView;
    const snapshot = snapshotRef.current;
    if (snapshot) painter.paint(snapshot.snails, snapshot.info);
  }, [courseView, painter]);

  const phase = race.phase as string;
  const confirming = phase === 'confirming';
  const twist = phase === 'running' ? staged : null;
  const presentation: SurprisePresentation | null = twist
    ? presentationForMoment({ id: 0, text: twist.commentaryText, tone: 'hot', label: twist.label, kind: twist.kind })
    : null;
  const showResult = (phase === 'confirming' || phase === 'done') && race.results.length > 0;
  const label = replay ? 'REPLAY' : confirming ? 'FINISH' : phase === 'done' ? 'OFFICIAL' : phase === 'void' ? 'VOID' : phase === 'idle' ? 'READY' : 'LIVE';
  const announcement = confirming || phase === 'done' || phase === 'void' ? race.status : race.commentary || race.status;
  /* Scenery is drawn three times across so a shift never shows an edge. */
  const copies = [0, 1, 2];

  return (
    <div
      className={`track-wrap tv-wrap race-broadcast course-broadcast side-broadcast ${reduceMotion ? 'calm race-motion-reduced' : ''}`}
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
        {/* The fence and its signs move with the track. */}
        <div className="side-layer" aria-hidden="true" ref={(el) => { layerWrapRefs.current.fence = el; }}>
          <svg className="side-layer-art" viewBox={`${SCENERY_BOX.x} ${LAYER_TOP} ${SCENERY_BOX.w} ${LAYER_H}`} preserveAspectRatio="none">
            <g>
              {copies.map((i) => (
                <g key={i} transform={`translate(${i * SCENE_W} 0)`}>
                  <rect x="0" y="468" width={SCENE_W} height="60" fill="#e8e4dc" stroke="#2a1a1a" strokeWidth="4" />
                  {[signs[0], fenceLogos[0], signs[1], fenceLogos[1]].map((board, k) => (
                    <g key={k} transform={`translate(${k * (SCENE_W / 4) + 160} 0)`}>
                      {typeof board === 'string' ? (
                        <>
                          <rect x="0" y="476" width="520" height="44" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" />
                          <text x="260" y="509" textAnchor="middle" fontSize="30" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">{board}</text>
                        </>
                      ) : board ? (
                        <g className="side-fence-logo">
                          <rect x="60" y="440" width="400" height="88" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
                          <image href={board.src} x="68" y="444" width="384" height="80" preserveAspectRatio="xMidYMid meet" />
                        </g>
                      ) : null}
                    </g>
                  ))}
                </g>
              ))}
            </g>
          </svg>
        </div>
        <div className="side-layer side-world" ref={(el) => { layerWrapRefs.current.world = el; }}>
        <svg
          ref={svgRef}
          className="tv"
          viewBox={`${WORLD_BOX.x} ${LAYER_TOP} ${WORLD_BOX.w} ${LAYER_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Straight track: ${names.length} snails racing side on to the finish`}
        >
          {/* The track itself is world-fixed: one marked lane per snail. */}
          <rect x="-4000" y={TRACK_TOP} width={TRACK_LEN + 8000} height={TRACK_BOTTOM - TRACK_TOP} fill="#9a8a62" />
          {lanes.map((geo, lane) => (
            <rect key={`band-${lane}`} className="side-lane" x="-4000" y={geo.top} width={TRACK_LEN + 8000} height={geo.pitch} fill={lane % 2 ? '#93825a' : '#a3936a'} />
          ))}
          {lanes.slice(1).map((geo, i) => (
            <line key={`rail-${i}`} x1="-4000" x2={TRACK_LEN + 4000} y1={geo.top} y2={geo.top} stroke="#fff" strokeWidth="4" strokeDasharray="40 30" opacity=".55" />
          ))}
          {/* The inside rail, and the front rail with the crowd in front of it. */}
          <rect x="-4000" y={TRACK_TOP - 12} width={TRACK_LEN + 8000} height="14" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
          <rect x="-4000" y={TRACK_BOTTOM} width={TRACK_LEN + 8000} height={VIEW_H - TRACK_BOTTOM + 40} fill="#5fa83a" />
          <rect x="-4000" y={TRACK_BOTTOM + 4} width={TRACK_LEN + 8000} height="14" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
          {/* Distance posts: metres to go, the caller's markers. */}
          {Array.from({ length: RACE_METRES - 1 }, (_, i) => RACE_METRES - 1 - i).map((m) => {
            const x = worldX(1 - m / RACE_METRES);
            return (
              <g key={`post-${m}`} className="side-post" transform={`translate(${x} 0)`}>
                <line x1="0" x2="0" y1={TRACK_TOP} y2={TRACK_BOTTOM} stroke="#fff" strokeWidth="4" opacity=".22" />
                <rect x="-7" y={TRACK_TOP - 92} width="14" height="82" fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
                <rect x="-50" y={TRACK_TOP - 150} width="100" height="58" rx="8" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
                <text x="0" y={TRACK_TOP - 108} textAnchor="middle" fontSize="38" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">{m}m</text>
              </g>
            );
          })}
          {/* The stalls: saddlecloth numbers behind, a gate in front of every nose. */}
          <g className="side-start">
            <rect x={START_X - 90} y="400" width="300" height="60" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
            <text x={START_X + 60} y="446" textAnchor="middle" fontSize="44" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">START</text>
            <rect x={START_X - 6} y={TRACK_TOP} width="12" height={TRACK_BOTTOM - TRACK_TOP} fill="#fff" opacity=".7" />
            {lanes.map((geo, lane) => {
              const c = laneColour(lane);
              const size = Math.min(84, geo.pitch * 0.8);
              return (
                <g key={`stall-${lane}`}>
                  <rect x={START_X - snailLen - 70 - size} y={geo.top + (geo.pitch - size) / 2} width={size} height={size} rx="10" fill={c.shell} stroke="#2a1a1a" strokeWidth="4" />
                  <text x={START_X - snailLen - 70 - size / 2} y={geo.top + geo.pitch / 2 + size * 0.2} textAnchor="middle" fontSize={size * (numberOffset + lane + 1 >= 100 ? 0.42 : 0.56)} fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#fff" stroke="#2a1a1a" strokeWidth="5" paintOrder="stroke">{numberOffset + lane + 1}</text>
                </g>
              );
            })}
          </g>
          <g className="side-gates" aria-hidden="true">
            <rect x={START_X + 44} y={TRACK_TOP - 30} width="34" height={TRACK_BOTTOM - TRACK_TOP + 46} fill="#2f6f3a" stroke="#2a1a1a" strokeWidth="4" />
            {lanes.map((geo, lane) => (
              <rect key={`gate-${lane}`} x={START_X + 50} y={geo.top + 6} width="22" height={geo.pitch - 12} fill="#fff" stroke="#a81d2f" strokeWidth="5" />
            ))}
          </g>
          {/* The winning post: a red line straight across, judged on the nose. */}
          <g className="side-finish" transform={`translate(${TRACK_LEN} 0)`}>
            <rect x="-160" y="400" width="320" height="60" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
            <text x="0" y="446" textAnchor="middle" fontSize="44" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">FINISH</text>
            <rect x="-10" y={TRACK_TOP} width="20" height={TRACK_BOTTOM - TRACK_TOP} fill="#e8262b" />
            <line x1="0" x2="0" y1={TRACK_TOP} y2={TRACK_BOTTOM} stroke="#fff" strokeWidth="6" strokeDasharray="28 28" opacity=".7" />
            <rect x="-8" y="460" width="16" height={TRACK_TOP - 460} fill="#fff" stroke="#2a1a1a" strokeWidth="3" />
          </g>
          {twist && presentation ? (
            <g key={twist.key} ref={propRef} className={`course-prop side-prop side-prop-${presentation.cue}`} data-phase={twist.phase} data-tone={twist.tone} aria-hidden="true">
              <ellipse className="course-impact" rx="150" ry="40" fill="none" stroke="#ffe6a5" strokeWidth="10" />
              <g className="course-prop-motion side-prop-motion">
                {presentation.art ? (
                  <image className="course-prop-image" href={`${ART_BASE}/surprises/${presentation.art}.png`} x="-220" y="-460" width="440" height="440" />
                ) : presentation.glyph ? (
                  <g className="course-prop-symbol course-prop-vector" transform="scale(6) translate(0 -8)" data-glyph={presentation.glyph}>
                    <PropGlyph id={presentation.glyph} />
                  </g>
                ) : (
                  <text className="course-prop-symbol" y="-80" textAnchor="middle" fontSize="220">{presentation.symbol}</text>
                )}
              </g>
            </g>
          ) : null}
        </svg>
        <div className="side-runner-layer tv-runners side-runners" ref={chipLayerRef}>
          {names.map((name, lane) => (
            <svg
              key={lane}
              className="side-runner-chip"
              viewBox={`${CHIP.x} ${CHIP.y} ${CHIP.w} ${CHIP.h}`}
              ref={(node) => {
                if (node) chipsRef.current.set(lane, node);
                else chipsRef.current.delete(lane);
              }}
            >
              <SnailSprite
                lane={lane}
                number={numberOffset + lane + 1}
                name={name}
                scale={lanes[lane].scale}
                nodeRef={(node) => {
                  if (node) nodesRef.current.set(lane, node);
                  else nodesRef.current.delete(lane);
                }}
              />
              <SnailTag
                lane={lane}
                offset={`translate(${-ART_NOSE * lanes[lane].scale + 20} ${-ART_HEIGHT * lanes[lane].scale - 26})`}
                nodeRef={(node) => {
                  if (node) tagNodesRef.current.set(lane, node);
                  else tagNodesRef.current.delete(lane);
                }}
              />
            </svg>
          ))}
        </div>
        </div>
        {/* The crowd in front of the rail, a layer above the track. */}
        <div className="side-layer side-crowd-layer" aria-hidden="true" ref={(el) => { layerWrapRefs.current.crowd = el; }}>
          {CROWD_PHASES.map((phase) => (
            <div key={phase} className={`side-crowd-phase side-crowd-phase-${phase}`}>
              <svg className="side-layer-art" viewBox={`${SCENERY_BOX.x} ${LAYER_TOP} ${SCENERY_BOX.w} ${LAYER_H}`} preserveAspectRatio="none">
                {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Crowd phase={phase} /></g>)}
              </svg>
            </div>
          ))}
        </div>

        {/* The title card: just the name of the twist. The prop shows who it hit. */}
        {twist ? (
          <div key={twist.key} className={`side-splash side-splash-${twist.phase} tone-${twist.tone}`} data-twist={twist.eventId} aria-hidden="true">
            {twist.phase === 'warning' ? (
              <>
                <span className="side-splash-kicker">INCOMING</span>
                <strong className="side-splash-title">{twist.warningText}</strong>
              </>
            ) : twist.phase === 'reveal' ? (
              <>
                <span className="side-splash-kicker">LOOK OUT</span>
                <strong className="side-splash-title">{twist.label}</strong>
              </>
            ) : (
              <strong className="side-splash-title">{twist.label}</strong>
            )}
          </div>
        ) : null}
      </div>

      {/* The running order, leader first, as a racing telecast shows it, and the distance to go. */}
      <div className="side-progress" ref={barRef} role="progressbar" aria-label="Leader's progress to the finish, in metres" aria-valuemin={0} aria-valuemax={RACE_METRES} aria-valuenow={0}>
        <span className="side-order-label" aria-hidden="true">POSITIONS</span>
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
                <span className="num">{numberOffset + lane + 1}</span>
              </li>
            );
          })}
        </ol>
        <span ref={toGoRef} className="side-togo num" aria-hidden="true">{RACE_METRES.toFixed(1)} m to go</span>
        <span className="side-flag" aria-hidden="true" />
        <div className="side-progress-fill" aria-hidden="true" />
      </div>

      {showResult ? (
        <OfficialResult results={race.results} raceNo={raceNo} sponsor={sponsor} tote={toteResult} replay={replay} runnerSponsors={owners} numberOffset={numberOffset} />
      ) : null}

      <div className="course-director-bar">
        <span ref={leaderRef} className="side-leader" aria-live="off" />
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
          {courseView ? 'Lead pack' : 'Full field view'}
        </button>
      </div>

      <section className="race-hud" aria-label={`Race ${raceNo} status`}>
        <div className="tv-top">
          <ClubBrand className="club-brand tv-club-brand" imageClassName="club-brand-logo tv-club-logo" nameClassName="tv-club-name" priority />
          <span className={`tv-live ${phase === 'void' ? 'tv-void' : ''} ${replay ? 'tv-replay' : ''} ${confirming ? 'tv-confirming-badge' : ''}`}>
            <i aria-hidden="true" /> {label}
          </span>
          <span className="tv-race-chip num">RACE {raceNo}</span>
          <span className="tv-title">SNAIL RACING</span>
          {replay ? null : (
            <span ref={clockRef} className="tv-clock num" role="timer" aria-label="Elapsed race time">0:00.0</span>
          )}
          {race.photoFinish && phase !== 'done' ? <span className="tv-photo num" role="status">PHOTO FINISH</span> : null}
        </div>
        <div className="tv-strap">
          <span className="tv-strap-badge" aria-hidden="true">{confirming || phase === 'done' ? 'RESULT' : 'COMMENTARY'}</span>
          <p className="tv-strap-line" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        </div>
      </section>
      {race.countdown ? (
        <div className="countdown" aria-hidden="true">
          <span key={race.countdown}>{race.countdown}</span>
        </div>
      ) : null}
      <SurpriseLayer race={race} names={names} />
    </div>
  );
}
