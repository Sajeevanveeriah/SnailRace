'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { laneColour } from '@/lib/palette';
import { ClubBrand } from './brand/ClubBrand';
import { SurpriseLayer } from './race-broadcast/SurpriseLayer';
import { presentationForMoment } from './race-broadcast/surprise-presentation';
import { PropGlyph } from './race-broadcast/prop-glyphs';
import { useReducedMotion } from './race-broadcast/useReducedMotion';
import { OfficialResult } from './race-broadcast/BroadcastGraphics';
import { clockText } from '@/lib/broadcast';
import type { SnailRun } from '@/lib/race-engine';
import type { PaintInfo, RaceController, RacePainter } from '@/lib/use-race';
import type { CameraMode, ToteDividend } from '@/lib/types';

/**
 * The side-on cartoon race.
 *
 * Shot the way a race night audience already knows from horse racing and
 * the cartoon race-night films: a straight seen side on from the stand, one
 * snail per marked lane in racecard order (lowest number on top), starting
 * stalls that open at the off, distance posts counting down to a vertical
 * winning post, and a running-order strip along the bottom that names the
 * field leader first. Every snail is the same size and never hides another,
 * so every saddlecloth number stays readable. The first nose to the post is
 * the winner on screen, as it is in the result. The camera follows the field
 * and keeps every lane in frame; Full field view widens to every runner.
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
/** The narrowest shot, in world units. */
const PACK_VIEW_W = 2600;
/** The widest the following shot goes before it lets the tail of the field go. */
const FOLLOW_MAX_W = 4400;
/** The marked lanes. Racecard order, lane 0 on top. */
const TRACK_TOP = 540;
const TRACK_BOTTOM = 1300;
/** Every frame shows from the fence signs down to the front rail. */
const REQUIRED_H = VIEW_H - 360;
/** The straight is called in metres to go, like a race caller's distance posts. */
export const RACE_METRES = 10;
/** Kept for the oval's import shape; the straight follows the field instead. */
export const LEAD_PACK = 4;

/* Snail art, unscaled: the front of the foot is the nose. */
const ART_NOSE = 190;
const ART_TAIL = 150;
const ART_HEIGHT = 176;

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

/** Equal lanes, equal snails: no perspective, so no runner covers another. */
export function laneGeometry(lane: number, fieldSize: number): LaneGeometry {
  const n = Math.max(1, fieldSize);
  const pitch = (TRACK_BOTTOM - TRACK_TOP) / n;
  const scale = Math.min(0.62, (pitch * 0.97) / ART_HEIGHT);
  const top = TRACK_TOP + lane * pitch;
  return { top, pitch, y: top + pitch - 8 * scale - pitch * 0.04, scale };
}

const worldX = (p: number): number => START_X + p * (TRACK_LEN - START_X);

/* ── Scenery, repeating ───────────────────────────────────────────────── */

const SCENE_W = 3200;

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

function Scenery({ clubName }: { clubName: string }) {
  const short = clubName.split(' ')[0].toUpperCase();
  return (
    <g transform="translate(0 -220)">
      <Tree x={120} />
      <Building x={300} w={220} label="CLUBROOMS" colour="#f0a25a" />
      <Tree x={620} />
      <Building x={760} w={260} label="CANTEEN" colour="#8fc9f0" dome />
      <Tree x={1120} />
      <Building x={1300} w={240} label={short} colour="#c98bd8" />
      <Tree x={1640} />
      <Building x={1820} w={300} label="SNAIL TV" colour="#f4f1ea" dome />
      <Tree x={2220} />
      <Building x={2400} w={220} label="NETS" colour="#9cd36f" />
      <Tree x={2760} />
      <Tree x={2980} />
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
      <g className="side-art" transform={`scale(${scale}) translate(${-ART_NOSE} 0)`}>
        <ellipse cx="0" cy="8" rx="150" ry="14" fill="#000" opacity=".18" />
        {/* foot */}
        <path className="side-foot" d="M-150 0 Q-150 -40 -100 -46 L120 -46 Q190 -46 190 -4 Q190 8 170 8 L-130 8 Q-150 8 -150 0Z" fill="#e9b96a" stroke="#2a1a1a" strokeWidth="5" />
        {/* eye stalks */}
        <g className="tv-snail-sprite side-stalks">
          <path d="M150 -44 L185 -120" stroke="#e9b96a" strokeWidth="9" strokeLinecap="round" />
          <path d="M165 -44 L210 -108" stroke="#e9b96a" strokeWidth="9" strokeLinecap="round" />
          <circle cx="186" cy="-124" r="11" fill="#fff" stroke="#2a1a1a" strokeWidth="4" />
          <circle cx="211" cy="-112" r="11" fill="#fff" stroke="#2a1a1a" strokeWidth="4" />
          <circle cx="189" cy="-124" r="4" fill="#1b1a19" />
          <circle cx="214" cy="-112" r="4" fill="#1b1a19" />
        </g>
        {/* shell */}
        <ellipse cx="-20" cy="-82" rx="112" ry="84" fill={c.shell} stroke="#2a1a1a" strokeWidth="6" />
        <path d="M-20 -82 m-70 0 a70 70 0 1 1 140 0 a50 50 0 1 1 -100 0 a30 30 0 1 1 60 0" fill="none" stroke="#2a1a1a" strokeWidth="5" opacity=".35" />
        <text x="-20" y={number >= 10 ? -46 : -42} textAnchor="middle" fontSize={number >= 100 ? 78 : number >= 10 ? 104 : 120} fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#fff" stroke="#2a1a1a" strokeWidth="8" paintOrder="stroke">{number}</text>
        {/* mouth */}
        <path d="M150 -16 Q165 -8 178 -18" fill="none" stroke="#2a1a1a" strokeWidth="4" strokeLinecap="round" />
      </g>
    </g>
  );
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
  const layerRefs = useRef<Record<string, SVGGElement | null>>({});
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

  const lanes = useMemo(() => names.map((_, lane) => laneGeometry(lane, names.length)), [names]);
  const snailLen = (ART_NOSE + ART_TAIL) * (lanes[0]?.scale ?? 0.5);
  const signs = useMemo(() => {
    const list = [clubName.toUpperCase(), 'SNAIL RACING', sponsor ? `PRESENTED BY ${sponsor.toUpperCase()}` : 'A NIGHT AT THE RACES', ...sponsors.map((s) => s.toUpperCase())];
    return list.filter(Boolean);
  }, [clubName, sponsor, sponsors]);

  const painter = useMemo<RacePainter>(() => {
    const place = (lane: number, progress: number) => {
      const node = nodesRef.current.get(lane);
      const geo = lanes[lane];
      const x = worldX(progress);
      node?.setAttribute('transform', `translate(${x} ${geo.y})`);
      node?.setAttribute('data-progress', String(progress));
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
    const paint: RacePainter['paint'] = (snails, info) => {
      snapshotRef.current = { snails, info };
      /* The stalls follow the race clock, so a replay or a seek opens and shuts them too. */
      svgRef.current?.classList.toggle('gates-open', info.raceTimeMs > 0);
      for (const snail of snails) {
        const node = nodesRef.current.get(snail.lane);
        node?.classList.toggle('retired', Boolean(snail.retired));
        node?.classList.toggle('fx-up', snail.effect === 'boost' || snail.effect === 'surge');
        node?.classList.toggle('fx-down', snail.effect === 'stumble' || snail.effect === 'nap');
        place(snail.lane, snail.p);
      }
      for (const snail of info.justFinished) nodesRef.current.get(snail.lane)?.classList.add('finished');

      /*
       * Camera: follow the field. The leader is always in shot with room to
       * run into; runners behind are added in running order while they fit
       * the widest following shot, so a strung-out field keeps the race up
       * front on screen and the running-order strip names the rest. Full
       * field view takes everyone. Every lane is always in frame.
       */
      const aspect = aspectRef.current;
      const narrowest = minW();
      const maxW = courseViewRef.current ? Infinity : Math.max(narrowest, Math.min(FOLLOW_MAX_W, narrowest * 1.7));
      const order = info.ranked.length ? info.ranked : snails;
      const headroom = 420;
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
      const moment = momentRef.current;
      if (moment && propRef.current) {
        const targets = moment.targetLanes ?? [info.ranked[0]?.lane ?? 0];
        const big = targets.length > 2;
        const target = snails.find((s) => s.lane === targets[0]);
        const scale = lanes[0]?.scale ?? 0.5;
        if (big) {
          propRef.current.setAttribute('data-size', 'field');
          propRef.current.setAttribute('transform', `translate(${(left + right) / 2} ${TRACK_TOP + (TRACK_BOTTOM - TRACK_TOP) * 0.78}) scale(${Math.max(0.6, scale * 1.6)})`);
        } else if (target) {
          const geo = lanes[target.lane];
          propRef.current.setAttribute('data-size', 'single');
          const ahead = moment.phase === 'warning' ? 220 : moment.phase === 'reveal' ? 110 : 0;
          const x = worldX(target.p) + ahead;
          propRef.current.setAttribute('transform', `translate(${x} ${geo.y}) scale(${Math.max(0.42, scale * 1.15)})`);
          right = Math.max(right, x + 240);
        }
      }

      /* The run home: once the winning post can join the shot, it stays in it. */
      if (info.finalStraight && TRACK_LEN + 320 - left <= maxW) right = Math.max(right, TRACK_LEN + 320);
      const wantW = Math.max(narrowest, right - left);
      let targetX = right - wantW + (wantW - (right - left)) * 0.5 * (courseViewRef.current ? 1 : 0.3);
      targetX = Math.max(-260, Math.min(TRACK_LEN + 460 - wantW, targetX));
      const cam = camRef.current;
      const ease = reduceMotion ? 1 : 0.1;
      cam.x += (targetX - cam.x) * ease;
      cam.w += (wantW - cam.w) * ease;
      /* Never narrower than every lane allows, even mid-ease. */
      const viewW = Math.max(cam.w, narrowest);
      const viewH = viewW / aspect;
      const viewY = VIEW_H - viewH;
      svgRef.current?.setAttribute('viewBox', `${cam.x} ${viewY} ${viewW} ${viewH}`);
      /* Parallax: the sky stays, hills drift, buildings slide, the fence moves with the track. */
      const layers = layerRefs.current;
      const shift = (name: string, factor: number) => {
        const g = layers[name];
        if (!g) return;
        const offset = -cam.x * factor;
        g.setAttribute('transform', `translate(${cam.x + (offset % SCENE_W) - SCENE_W} 0)`);
      };
      shift('mountains', 0.12);
      shift('lake', 0.25);
      shift('buildings', 0.5);
      shift('fence', 1);
      layers.sky?.setAttribute('transform', `translate(${cam.x} 0)`);

      if (clockRef.current) clockRef.current.textContent = clockText(info.raceTimeMs);
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
        if (scene?.clientHeight) aspectRef.current = scene.clientWidth / scene.clientHeight;
        const snapshot = snapshotRef.current;
        if (snapshot) paint(snapshot.snails, snapshot.info);
        else {
          const w = minW();
          svgRef.current?.setAttribute('viewBox', `-260 ${VIEW_H - w / aspectRef.current} ${w} ${w / aspectRef.current}`);
        }
      },
      start: () => {
        svgRef.current?.classList.add('racing');
      },
      reset: () => {
        snapshotRef.current = null;
        svgRef.current?.classList.remove('racing', 'gates-open');
        const w = minW();
        camRef.current = { x: -260, w };
        nodesRef.current.forEach((node, lane) => {
          place(lane, 0);
          node.classList.remove('finished', 'retired', 'fx-up', 'fx-down');
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
        const viewH = w / aspectRef.current;
        svgRef.current?.setAttribute('viewBox', `-260 ${VIEW_H - viewH} ${w} ${viewH}`);
        const layers = layerRefs.current;
        for (const name of ['mountains', 'lake', 'buildings', 'fence']) layers[name]?.setAttribute('transform', `translate(${-260 - SCENE_W} 0)`);
        layers.sky?.setAttribute('transform', 'translate(-260 0)');
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
  const moment = phase === 'running' ? race.moment : null;
  const presentation = presentationForMoment(moment);
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
        <svg
          ref={svgRef}
          className="tv"
          viewBox={`-260 ${VIEW_H - REQUIRED_H} ${REQUIRED_H * (16 / 9)} ${REQUIRED_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Straight track: ${names.length} snails racing side on to the finish`}
        >
          <g ref={(g) => { layerRefs.current.sky = g; }}>
            <rect className="tv-art-background" x="-20000" y="-20000" width="60000" height="20600" fill="#7cc6ff" />
            <circle cx="2100" cy="140" r="90" fill="#ffe36b" />
            <g fill="#fff" opacity=".9">
              <ellipse cx="400" cy="200" rx="160" ry="46" />
              <ellipse cx="470" cy="180" rx="90" ry="40" />
              <ellipse cx="1500" cy="150" rx="190" ry="50" />
              <ellipse cx="1560" cy="128" rx="100" ry="44" />
            </g>
          </g>
          <g ref={(g) => { layerRefs.current.mountains = g; }}>
            {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Mountains /></g>)}
          </g>
          <g ref={(g) => { layerRefs.current.lake = g; }}>
            {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Lake /></g>)}
          </g>
          <g ref={(g) => { layerRefs.current.buildings = g; }}>
            {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Scenery clubName={clubName} /></g>)}
          </g>
          {/* The fence and its signs move with the track. */}
          <g ref={(g) => { layerRefs.current.fence = g; }}>
            {copies.map((i) => (
              <g key={i} transform={`translate(${i * SCENE_W} 0)`}>
                <rect x="0" y="468" width={SCENE_W} height="60" fill="#e8e4dc" stroke="#2a1a1a" strokeWidth="4" />
                {signs.slice(0, 4).map((text, k) => (
                  <g key={k} transform={`translate(${k * (SCENE_W / 4) + 160} 0)`}>
                    <rect x="0" y="476" width="520" height="44" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" />
                    <text x="260" y="509" textAnchor="middle" fontSize="30" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">{text}</text>
                  </g>
                ))}
              </g>
            ))}
          </g>
          {/* The track itself is world-fixed: one marked lane per snail. */}
          <rect x="-4000" y={TRACK_TOP} width={TRACK_LEN + 8000} height={TRACK_BOTTOM - TRACK_TOP} fill="#9a8a62" />
          {lanes.map((geo, lane) => (
            <rect key={`band-${lane}`} className="side-lane" x="-4000" y={geo.top} width={TRACK_LEN + 8000} height={geo.pitch} fill={lane % 2 ? '#93825a' : '#a3936a'} />
          ))}
          {lanes.slice(1).map((geo, i) => (
            <line key={`rail-${i}`} x1="-4000" x2={TRACK_LEN + 4000} y1={geo.top} y2={geo.top} stroke="#fff" strokeWidth="4" strokeDasharray="40 30" opacity=".55" />
          ))}
          {/* The inside rail, and the front rail with grass in front of it. */}
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
          <g className="tv-runners side-runners">
            {names.map((name, lane) => (
              <SnailSprite
                key={lane}
                lane={lane}
                number={numberOffset + lane + 1}
                name={name}
                scale={lanes[lane].scale}
                nodeRef={(node) => {
                  if (node) nodesRef.current.set(lane, node);
                  else nodesRef.current.delete(lane);
                }}
              />
            ))}
          </g>
          {moment && presentation ? (
            <g ref={propRef} className={`course-prop side-prop side-prop-${presentation.cue}`} data-phase={moment.phase ?? 'effect'} aria-hidden="true">
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
      </div>

      {/* The running order, leader first, as a racing telecast shows it, and the distance to go. */}
      <div className="side-progress" ref={barRef} role="progressbar" aria-label="Metres the leader has covered" aria-valuemin={0} aria-valuemax={RACE_METRES} aria-valuenow={0}>
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
