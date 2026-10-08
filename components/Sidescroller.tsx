'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
 * A straight track seen from the grandstand: big numbered snails crawling
 * left to right, scenery sliding past behind them, a silhouetted crowd in
 * front, and a progress bar along the bottom that fills as the leader goes.
 * The camera pans with the leading pack and the finish banner scrolls into
 * view for the run home. Surprises land on the snail they hit as large props.
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

/** World units. The start banner is at 0, the finish post at TRACK_LEN. */
export const TRACK_LEN = 9000;
/** Snails start a little behind the banner and cross a little past the post. */
const START_X = 160;
const VIEW_H = 1350;
/** How wide the lead-pack window is, in world units. */
const PACK_VIEW_W = 2600;
const TRACK_TOP = 640;
const TRACK_BOTTOM = 1170;
const CROWD_TOP = 1150;
export const LEAD_PACK = 4;

/** Lane bands, nearest lane last so it is drawn on top. */
function laneY(lane: number, fieldSize: number): { y: number; scale: number } {
  const n = Math.max(1, fieldSize);
  const depth = n === 1 ? 0 : 1 - lane / (n - 1); // 0 nearest (lane 0), 1 farthest
  const y = TRACK_BOTTOM - 24 - depth * (TRACK_BOTTOM - TRACK_TOP - 70);
  const scale = 0.9 - depth * 0.4;
  return { y, scale };
}

const worldX = (p: number): number => START_X + p * (TRACK_LEN - START_X);

/* ── Scenery, repeating ───────────────────────────────────────────────── */

const SCENE_W = 3200;

function Mountains() {
  return (
    <g transform="translate(0 -120)">
      <path d="M0 520 L260 300 L520 470 L760 240 L1040 480 L1300 330 L1560 500 L1800 290 L2100 470 L2400 310 L2700 490 L3000 360 L3200 470 L3200 560 L0 560Z" fill="#6c4b7a" />
      <path d="M0 560 L180 440 L420 520 L700 400 L980 540 L1240 450 L1500 560 L1760 430 L2050 540 L2320 460 L2600 560 L2860 470 L3200 550 L3200 600 L0 600Z" fill="#a85c3b" />
      <path d="M730 262 L760 240 L790 262 L775 268 L760 258 L745 268Z" fill="#fff8f0" />
      <path d="M1770 310 L1800 290 L1830 312 L1815 318 L1800 308 L1785 318Z" fill="#fff8f0" />
    </g>
  );
}

function Lake() {
  return (
    <g transform="translate(0 -120)">
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
    <g transform="translate(0 -120)">
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

function Crowd() {
  /* Heads and raised arms, drawn once and repeated. */
  const heads = Array.from({ length: 14 }, (_, i) => i * 230 + 60);
  return (
    <g fill="#4b2a5e">
      <rect x="0" y={CROWD_TOP + 70} width={SCENE_W} height="200" />
      {heads.map((x, i) => (
        <g key={x}>
          <circle cx={x} cy={CROWD_TOP + 60} r="42" />
          <rect x={x - 70} y={CROWD_TOP + 90} width="140" height="120" rx="30" />
          {i % 3 === 0 ? <rect x={x + 44} y={CROWD_TOP - 10} width="18" height="90" rx="9" transform={`rotate(-20 ${x + 53} ${CROWD_TOP + 80})`} /> : null}
          {i % 4 === 1 ? <rect x={x - 62} y={CROWD_TOP - 4} width="18" height="90" rx="9" transform={`rotate(22 ${x - 53} ${CROWD_TOP + 80})`} /> : null}
        </g>
      ))}
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
      <g className="side-art" transform={`scale(${scale})`}>
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
        <text x="-20" y="-52" textAnchor="middle" fontSize="92" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#fff" stroke="#2a1a1a" strokeWidth="6" paintOrder="stroke">{number}</text>
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
  const leaderRef = useRef<HTMLSpanElement>(null);
  const snapshotRef = useRef<{ snails: SnailRun[]; info: PaintInfo } | null>(null);
  const momentRef = useRef(race.moment);
  const aspectRef = useRef(16 / 9);
  const camRef = useRef({ x: 0, w: PACK_VIEW_W });

  const lanes = useMemo(() => names.map((_, lane) => laneY(lane, names.length)), [names]);
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
    const paint: RacePainter['paint'] = (snails, info) => {
      snapshotRef.current = { snails, info };
      const xs: number[] = [];
      const framed = new Set(info.ranked.slice(0, LEAD_PACK).map((s) => s.lane));
      for (const snail of snails) {
        const node = nodesRef.current.get(snail.lane);
        node?.classList.toggle('retired', Boolean(snail.retired));
        node?.classList.toggle('fx-up', snail.effect === 'boost' || snail.effect === 'surge');
        node?.classList.toggle('fx-down', snail.effect === 'stumble' || snail.effect === 'nap');
        const x = place(snail.lane, snail.p);
        if (courseViewRef.current || framed.has(snail.lane) || info.finalStraight) xs.push(x);
      }
      for (const snail of info.justFinished) nodesRef.current.get(snail.lane)?.classList.add('finished');

      /* The prop sits on the snail it hits; a field-wide one sits mid-shot. */
      const moment = momentRef.current;
      if (moment && propRef.current) {
        const targets = moment.targetLanes ?? [info.ranked[0]?.lane ?? 0];
        const big = targets.length > 2;
        const target = snails.find((s) => s.lane === targets[0]);
        if (big) {
          propRef.current.setAttribute('data-size', 'field');
          const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : worldX(info.leadP);
          propRef.current.setAttribute('transform', `translate(${mid} ${TRACK_TOP + 120})`);
        } else if (target) {
          const geo = lanes[target.lane];
          propRef.current.setAttribute('data-size', 'single');
          const ahead = moment.phase === 'warning' ? 260 : moment.phase === 'reveal' ? 120 : 0;
          propRef.current.setAttribute('transform', `translate(${worldX(target.p) + ahead} ${geo.y})`);
          xs.push(worldX(target.p) + ahead);
        }
      }

      /* Camera: the lead pack in a window that never jumps, with the finish
         banner kept in frame for the run home. */
      const aspect = aspectRef.current;
      const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
      const wantW = courseViewRef.current
        ? Math.max(PACK_VIEW_W, span + 900)
        : Math.max(PACK_VIEW_W, Math.min(span + 700, PACK_VIEW_W * 1.6));
      const left = xs.length ? Math.min(...xs) : worldX(info.leadP);
      const right = xs.length ? Math.max(...xs) : left;
      /* Full field view centres the window on the whole field; the lead-pack
         shot sits the leaders a little right of centre with room to run into. */
      let targetX = (left + right) / 2 - wantW * (courseViewRef.current ? 0.5 : 0.42);
      if (info.finalStraight) targetX = Math.max(targetX, TRACK_LEN + 300 - wantW);
      targetX = Math.max(-200, Math.min(TRACK_LEN + 400 - wantW, targetX));
      const cam = camRef.current;
      const ease = reduceMotion ? 1 : 0.1;
      cam.x += (targetX - cam.x) * ease;
      cam.w += (wantW - cam.w) * ease;
      const viewW = cam.w;
      const viewH = viewW / aspect;
      const viewY = VIEW_H - viewH;
      svgRef.current?.setAttribute('viewBox', `${cam.x} ${viewY} ${viewW} ${viewH}`);
      /* Parallax: the sky stays, hills drift, buildings slide, track and crowd move with the camera. */
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
      shift('crowd', 1);
      layers.sky?.setAttribute('transform', `translate(${cam.x} 0)`);

      if (clockRef.current) clockRef.current.textContent = clockText(info.raceTimeMs);
      if (barRef.current) {
        const lead = Math.min(1, Math.max(0, info.leadP));
        barRef.current.style.setProperty('--lead', String(lead));
        barRef.current.setAttribute('aria-valuenow', String(Math.round(lead * 90) / 10));
      }
      if (leaderRef.current) {
        const lead = info.ranked[0];
        const text = lead ? `${numberOffset + lead.lane + 1} ${names[lead.lane]} leads` : '';
        if (leaderRef.current.textContent !== text) leaderRef.current.textContent = text;
      }
    };
    return {
      measure: () => {
        const scene = sceneRef.current;
        if (scene?.clientHeight) aspectRef.current = scene.clientWidth / scene.clientHeight;
        const snapshot = snapshotRef.current;
        if (snapshot) paint(snapshot.snails, snapshot.info);
      },
      start: () => {
        svgRef.current?.classList.add('racing');
      },
      reset: () => {
        snapshotRef.current = null;
        svgRef.current?.classList.remove('racing');
        camRef.current = { x: -200, w: PACK_VIEW_W };
        nodesRef.current.forEach((node, lane) => {
          place(lane, 0);
          node.classList.remove('finished', 'retired', 'fx-up', 'fx-down');
        });
        if (clockRef.current) clockRef.current.textContent = '0:00.0';
        if (barRef.current) {
          barRef.current.style.setProperty('--lead', '0');
          barRef.current.setAttribute('aria-valuenow', '0');
        }
        if (leaderRef.current) leaderRef.current.textContent = '';
        const aspect = aspectRef.current;
        const viewH = PACK_VIEW_W / aspect;
        svgRef.current?.setAttribute('viewBox', `-200 ${VIEW_H - viewH} ${PACK_VIEW_W} ${viewH}`);
        const layers = layerRefs.current;
        for (const name of ['mountains', 'lake', 'buildings', 'fence', 'crowd']) layers[name]?.setAttribute('transform', `translate(${-200 - SCENE_W} 0)`);
        layers.sky?.setAttribute('transform', 'translate(-200 0)');
      },
      paint,
    };
  }, [lanes, names, numberOffset, reduceMotion]);

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
  const bar = Array.from({ length: 9 }, (_, i) => i + 1);

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
          viewBox={`-200 0 ${PACK_VIEW_W} ${VIEW_H}`}
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
                <rect x="0" y="580" width={SCENE_W} height="60" fill="#e8e4dc" stroke="#2a1a1a" strokeWidth="4" />
                {signs.slice(0, 4).map((text, k) => (
                  <g key={k} transform={`translate(${k * (SCENE_W / 4) + 160} 0)`}>
                    <rect x="0" y="588" width="520" height="44" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="3" />
                    <text x="260" y="621" textAnchor="middle" fontSize="30" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">{text}</text>
                  </g>
                ))}
              </g>
            ))}
          </g>
          {/* The track itself is world-fixed. */}
          <rect x="-4000" y={TRACK_TOP} width={TRACK_LEN + 8000} height={TRACK_BOTTOM - TRACK_TOP} fill="#9a8a62" />
          <rect x="-4000" y={TRACK_TOP} width={TRACK_LEN + 8000} height="14" fill="#6b5d3c" />
          <rect x="-4000" y={TRACK_BOTTOM - 14} width={TRACK_LEN + 8000} height="14" fill="#6b5d3c" />
          {Array.from({ length: 10 }, (_, i) => i).map((i) => (
            <text key={i} x={worldX(i / 9) - 10} y={TRACK_BOTTOM - 26} fontSize="30" fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff" opacity=".45">{i === 0 ? '' : i}</text>
          ))}
          {/* Start banner */}
          <g transform={`translate(${START_X - 120} 0)`}>
            <rect x="-10" y="570" width="300" height="60" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
            <text x="140" y="616" textAnchor="middle" fontSize="44" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">START</text>
            <rect x="110" y="630" width="60" height="540" fill="#fff" opacity=".35" />
          </g>
          {/* Finish banner and the red line */}
          <g transform={`translate(${TRACK_LEN} 0)`}>
            <rect x="-150" y="570" width="320" height="60" fill="#fff6d8" stroke="#2a1a1a" strokeWidth="4" />
            <text x="10" y="616" textAnchor="middle" fontSize="44" fontWeight="900" fontFamily="Arial Black, Arial, sans-serif" fill="#a81d2f">FINISH</text>
            <path d={`M0 630 L-130 ${TRACK_BOTTOM}`} stroke="#e8262b" strokeWidth="26" strokeLinecap="round" />
            <path d={`M0 630 L-130 ${TRACK_BOTTOM}`} stroke="#fff" strokeWidth="6" strokeDasharray="28 28" opacity=".6" />
          </g>
          <g className="tv-runners side-runners">
            {names
              .map((name, lane) => ({ name, lane }))
              .sort((a, b) => b.lane - a.lane)
              .map(({ name, lane }) => (
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
          <g ref={(g) => { layerRefs.current.crowd = g; }}>
            {copies.map((i) => <g key={i} transform={`translate(${i * SCENE_W} 0)`}><Crowd /></g>)}
          </g>
        </svg>
      </div>

      {/* The progress bar: nine marks and the flag, filled by the leader. */}
      <div className="side-progress" ref={barRef} role="progressbar" aria-label="Leader's progress to the finish" aria-valuemin={0} aria-valuemax={9} aria-valuenow={0}>
        <div className="side-progress-fill" aria-hidden="true" />
        <ol aria-hidden="true">
          {bar.map((n) => <li key={n}><span className="num">{n}</span></li>)}
        </ol>
        <span className="side-flag" aria-hidden="true" />
      </div>

      {showResult ? (
        <OfficialResult results={race.results} raceNo={raceNo} sponsor={sponsor} tote={toteResult} replay={replay} runnerSponsors={owners} />
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
