'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { laneColour, type StageThemeId } from '@/lib/palette';
import { ClubBrand } from './brand/ClubBrand';
import { runnerLookAt, type RunnerLook } from '@/lib/presentation/runner-art';
import { courseById, type CourseId } from '@/lib/courses';
import { courseGeometry, kerbRuns, marksAlong, pointOnLane, type CoursePoint } from '@/lib/course-geometry';
import { BroadcastHud } from './race-broadcast/BroadcastHud';
import { TwistCard } from './race-broadcast/SurpriseLayer';
import { presentationForMoment } from './race-broadcast/surprise-presentation';
import { PropGlyph } from './race-broadcast/prop-glyphs';
import { useReducedMotion } from './race-broadcast/useReducedMotion';
import { clockText, lapProgress } from '@/lib/broadcast';
import type { SnailRun } from '@/lib/race-engine';
import type { PaintInfo, RaceController, RacePainter } from '@/lib/use-race';
import type { CameraMode, LockedRaceEvent, RaceResult, ToteDividend } from '@/lib/types';
import { OfficialResult } from './race-broadcast/BroadcastGraphics';
import {
  CameraRig,
  boxOf,
  finishShot,
  fitBox,
  frameClockMs,
  grow,
  holdSpan,
  smoothDamp,
  packShot,
  spanFor,
  toScreen,
  type Box,
  type Rect,
  type ShotKind,
} from './race-broadcast/circuit-camera';
import {
  featuredLane,
  featuredLanes,
  stagedAt,
  stagedFromMoment,
  storyWindows,
  type StagedTwist,
  type StoryWindow,
} from './race-broadcast/twist-staging';
import { CIRCUIT_LAYOUT, circuitLayoutFor, type CircuitLayout } from './race-broadcast/circuit-layout';
import { fieldSpread, gateStagger, lapsDown, lapsDownText, placeTag, snailNumber } from './race-broadcast/standings-format';

interface Props {
  names: string[];
  /** Owner per lane, shown with the name on the official result. */
  owners?: string[];
  race: RaceController;
  surface: StageThemeId;
  laps: number;
  /**
   * Telecast follows the leader and the next two or three runners, the way
   * a horse race is shot; full shows the whole course. The on-screen toggle
   * and the desk both flip it.
   */
  cameraMode?: CameraMode;
  calm: boolean;
  clubName: string;
  raceNo: number;
  courseId: CourseId;
  replay?: boolean;
  fullCourse?: boolean;
  onCourseViewChange?: (value: boolean) => void;
  sponsor?: string;
  /** This race's settled cash tote, for the official result lower third. */
  toteResult?: ToteDividend | null;
  /** Added to every lane number on screen, so race 3 shows snails 21 to 30. */
  numberOffset?: number;
  /** Snail number per lane, for a field that is not a run of numbers (a run-off). Wins over `numberOffset`. */
  numbers?: number[];
}

/** How many runners the telecast shot tries to hold: the leader and three more. */
export const LEAD_PACK = 4;

export { CIRCUIT_LAYOUT, circuitLayoutFor, type CircuitLayout };

/**
 * The lead pack widens to the whole course once the placegetters span this
 * share of the course, and comes back to the pack once they are within the
 * lower share again, so a group on the edge never pumps the zoom.
 */
const FIELD_WIDE_AT = 0.72;
const FIELD_TIGHT_AT = 0.58;


/** Half the side of each runner's own layer, in course units. */
const CHIP = 70;
const PROP_CHIP = 60;
/** Snail length, nose to tail, in course units. */
const SNAIL_LEN = 38;
/** The gap, in course units, between the leader and the second that counts as the field having spread. */
const SPREAD_GAP = SNAIL_LEN * 2;
const SPRITE_W = SNAIL_LEN * 1.1;
const SPRITE_H = SPRITE_W / 1.45;
/** Raster levels for the painted course: the layer is drawn at this multiple of the pane. */
const RASTERS = [1, 1.5, 2, 2.5, 3, 4];

const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/** The colours of each course's ground and track. The figure eight races under lights. */
const LOOK: Record<CourseId, { turf: [string, string]; scene: string; track: string; laneA: string; laneB: string; edge: string; night: boolean }> = {
  'boundary-oval': { turf: ['#245b46', '#28644c'], scene: '#255e48', track: '#dfc391', laneA: '#d6b785', laneB: '#c8a876', edge: '#123c2e', night: false },
  'pavilion-chicane': { turf: ['#265d40', '#2b6746'], scene: '#286243', track: '#dfc391', laneA: '#d6b785', laneB: '#c8a876', edge: '#123c2e', night: false },
  'floodlight-eight': { turf: ['#0d241c', '#10291f'], scene: '#0e261d', track: '#b99d70', laneA: '#b49768', laneB: '#a88c5f', edge: '#06140f', night: true },
  'practice-nets': { turf: ['#2a5f3c', '#2f6842'], scene: '#2c643f', track: '#e0c597', laneA: '#d8bb8a', laneB: '#cbab79', edge: '#14402a', night: false },
};

const wallClockMs = frameClockMs;
/** How long the camera's frame takes to follow the board folding into the tower (the panel's own transition is 0.7 s). */
const VP_GLIDE_S = 0.28;
const setText = (el: Element | null | undefined, text: string) => {
  if (el && el.textContent !== text) el.textContent = text;
};

/**
 * One runner's parts. The chip rides in the camera's painted world and only
 * ever moves by a transform; the art inside it turns with the lane by a
 * transform of its own; the label (number and place tag) lives in screen
 * space over the course, so it is a constant size and never scales with the
 * zoom. Nothing here is laid out from one frame to the next.
 */
interface RunnerNodes {
  chip: HTMLDivElement;
  node: HTMLDivElement;
  art: HTMLDivElement;
  label: HTMLDivElement | null;
  tag: HTMLSpanElement | null;
}

interface Metrics {
  /** Course pane size in CSS pixels. */
  sw: number;
  sh: number;
  /** The mini-map's own size in CSS pixels. */
  mw: number;
  mh: number;
  /** One projector unit in pixels. */
  u: number;
  /** Raster multiple of the camera layer. */
  r: number;
  /** Layer pixels per course unit, and the letterbox offset inside the layer. */
  m: number;
  ox: number;
  oy: number;
  /** Layer pixels per course unit at raster 1. */
  m0: number;
}

/** A single course world owns the lane paint, runner feet and surprise props.
 * The camera only moves the painted world; it can never move a snail off its lane.
 */
export function Telecast({
  names,
  owners = [],
  race,
  surface,
  laps,
  cameraMode = 'telecast',
  calm,
  clubName,
  raceNo,
  courseId,
  replay = false,
  fullCourse,
  onCourseViewChange,
  sponsor,
  toteResult,
  numberOffset = 0,
  numbers,
}: Props) {
  const { setPainter, releasePainter } = race;
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = calm || prefersReducedMotion;
  const [localCourseView, setCourseView] = useState(false);
  const courseView = fullCourse ?? (localCourseView || cameraMode === 'full');
  const courseViewRef = useRef(false);
  const reduceRef = useRef(reduceMotion);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const runnerLayerRef = useRef<HTMLDivElement>(null);
  const propChipRef = useRef<SVGSVGElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapViewRef = useRef<SVGRectElement>(null);
  const mapDotsRef = useRef(new Map<number, HTMLSpanElement>());
  const labelsRef = useRef<HTMLDivElement>(null);
  const runnersRef = useRef(new Map<number, RunnerNodes>());
  const writtenRef = useRef(new Map<string, string>());
  const metricsRef = useRef<Metrics>({ sw: 0, sh: 0, mw: 0, mh: 0, u: 0, r: 1, m: 0, ox: 0, oy: 0, m0: 0 });
  const rigRef = useRef<CameraRig | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const lapRef = useRef<HTMLSpanElement>(null);
  const lapLabelRef = useRef<HTMLSpanElement>(null);
  const lapBoxRef = useRef<HTMLSpanElement>(null);
  const shotRef = useRef<HTMLSpanElement>(null);
  const lapWipeRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<{ snails: SnailRun[]; info: PaintInfo } | null>(null);
  const phaseRef = useRef<string>(race.phase);
  const resultsRef = useRef<RaceResult[]>(race.results);
  const momentRef = useRef(race.moment);
  const windowsRef = useRef<{ events: LockedRaceEvent[] | null; windows: StoryWindow[] }>({ events: null, windows: [] });
  const stagedRef = useRef<StagedTwist | null>(null);
  const [staged, setStaged] = useState<StagedTwist | null>(null);
  const lappedRef = useRef('');
  const [lapped, setLapped] = useState<ReadonlyMap<number, number>>(() => new Map());
  const lapNowRef = useRef(1);
  const finishLatchRef = useRef(false);
  const propAheadRef = useRef({ value: 90, at: 0 });
  /** How much the runner art is enlarged in a wide shot, so a snail is never a speck. */
  const artScaleRef = useRef(1);
  /** Whether the lead-pack shot has widened to the whole course because the placegetters span most of it. */
  const fieldWideRef = useRef(false);
  /** Each runner's last written edge fade, so the style is only touched when it changes. */
  const fadeRef = useRef(new Map<number, string>());
  /** Whether the field has spread on race time, for the tower's gaps. */
  const spreadRef = useRef(false);
  /* The frame the camera composes in, eased between the gate's and the race's. */
  const vpRef = useRef<{ rect: Rect | null; v: { x: { v: number }; y: { v: number }; w: { v: number }; h: { v: number } }; at: number }>({ rect: null, v: { x: { v: 0 }, y: { v: 0 }, w: { v: 0 }, h: { v: 0 } }, at: 0 });
  /* When the race loop last drew a frame, on the frame clock. */
  const paintedAtRef = useRef(-Infinity);
  const propScaleRef = useRef<SVGGElement>(null);

  const course = courseById(courseId);
  const look = LOOK[courseId];
  const geometry = useMemo(() => courseGeometry(courseId, names.length), [courseId, names.length]);
  const count = names.length;

  /* Fixed furniture of the course, in course units. */
  const furniture = useMemo(() => {
    const outer = geometry.boundaries[geometry.boundaries.length - 1];
    const inner = geometry.boundaries[0];
    const lineA = pointOnLane(inner, 0);
    const lineB = pointOnLane(outer, 0);
    /* The board stands beside the outside of the track at the line. */
    const nx = lineB.x - lineA.x,
      ny = lineB.y - lineA.y;
    const nl = Math.hypot(nx, ny) || 1;
    const label = { x: lineB.x + (nx / nl) * 40, y: lineB.y + (ny / nl) * 40 + 10 };
    const b = geometry.bounds;
    const box: Box = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: Math.max(b.y + b.h, label.y + 8) };
    const crossover = courseId === 'floodlight-eight' ? [{ point: { x: 600, y: 360 }, radius: 130 }] : [];
    const chevrons = marksAlong(geometry.centre, courseId === 'floodlight-eight' ? 16 : 10, [
      { point: pointOnLane(geometry.centre, 0), radius: 90 },
      ...crossover,
    ]);
    /* Kerbs: right through the chicane on both edges, and on the inside of every hairpin. */
    const keep =
      courseId === 'pavilion-chicane'
        ? (p: CoursePoint) => p.x > 540 && p.x < 840 && p.y < 400
        : courseId === 'practice-nets'
          ? (_: CoursePoint, k: number) => Math.abs(k) > 0.025
          : null;
    const kerbs = keep
      ? [...kerbRuns(inner, keep), ...kerbRuns(outer, keep)].map(
          (run) => run.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
        )
      : [];
    return { lineA, lineB, label, box, chevrons, kerbs };
  }, [geometry, courseId]);

  useEffect(() => {
    reduceRef.current = reduceMotion;
  }, [reduceMotion]);
  useEffect(() => {
    resultsRef.current = race.results;
  }, [race.results]);
  useEffect(() => {
    momentRef.current = race.moment;
  }, [race.moment]);
  useEffect(() => {
    courseViewRef.current = courseView;
  }, [courseView]);

  const phase = race.phase as string;
  useEffect(() => {
    phaseRef.current = phase;
    /* The photo at the line: a flash as the winner crosses. */
    if (phase === 'confirming' && !reduceRef.current && flashRef.current) {
      const flash = flashRef.current;
      flash.classList.remove('fire');
      void flash.offsetWidth;
      flash.classList.add('fire');
    }
  }, [phase]);

  const { painter, render } = useMemo(() => {
    const L = CIRCUIT_LAYOUT;
    const write = (el: Element | null | undefined, key: string, attr: string, value: string) => {
      if (!el || writtenRef.current.get(key) === value) return;
      writtenRef.current.set(key, value);
      el.setAttribute(attr, value);
    };
    const style = (el: HTMLElement | SVGElement | null | undefined, key: string, value: string) => {
      if (!el || writtenRef.current.get(key) === value) return;
      writtenRef.current.set(key, value);
      el.style.transform = value;
    };
    const cls = (el: Element | null | undefined, name: string, on: boolean) => {
      if (el && el.classList.contains(name) !== on) el.classList.toggle(name, on);
    };

    /** Layer size for a raster multiple, and where course units land inside it. */
    const setRaster = (r: number) => {
      const met = metricsRef.current;
      const lw = met.sw * r,
        lh = met.sh * r;
      met.r = r;
      met.m = Math.min(lw / 1200, lh / 720);
      met.ox = (lw - 1200 * met.m) / 2;
      met.oy = (lh - 720 * met.m) / 2;
      const camera = cameraRef.current;
      if (camera) {
        camera.style.width = `${lw}px`;
        camera.style.height = `${lh}px`;
      }
      runnerLayerRef.current?.style.setProperty('--chip', `${(2 * CHIP * met.m).toFixed(2)}px`);
      runnerLayerRef.current?.style.setProperty('--prop-chip', `${(2 * PROP_CHIP * met.m).toFixed(2)}px`);
      /* Every layer position changes with the raster. */
      for (const key of [...writtenRef.current.keys()]) if (key.startsWith('c') || key.startsWith('p')) writtenRef.current.delete(key);
    };

    const viewports = () => {
      const { sw, sh, u } = metricsRef.current;
      /* The twist card sits in its own band above the pane, so the whole pane is the race's. */
      const race: Rect = { x: 0, y: 0, w: Math.max(50, sw - (L.tower + L.gap) * u), h: Math.max(50, sh) };
      const gate: Rect = { x: 0, y: u, w: Math.max(50, sw - (L.board + L.gap) * u), h: Math.max(50, sh - 2 * u) };
      const hold: Rect = { ...race, h: Math.max(50, race.h - L.resultH * u) };
      return { race, gate, hold };
    };

    const render = (now: number) => {
      const met = metricsRef.current;
      if (!met.sw || !met.sh) return;
      rigRef.current ??= new CameraRig();
      const rig = rigRef.current;
      const snap = snapshotRef.current;
      const phase = phaseRef.current;
      const reduce = reduceRef.current;

      /* Where every runner is, on its own lane. */
      const pts: (CoursePoint & { angle: number })[] = [];
      const progressOf: number[] = [];
      for (let lane = 0; lane < count; lane++) progressOf[lane] = 0;
      if (snap) for (const s of snap.snails) if (s.lane < count) progressOf[s.lane] = s.p;
      /* At the gate the field fans back across the lanes; the fan eases out over the first strides. */
      const raceTimeMs = snap?.info.raceTimeMs ?? 0;
      for (let lane = 0; lane < count; lane++) {
        const laneGeo = geometry.lanes[lane];
        pts[lane] = pointOnLane(laneGeo, lapProgress(progressOf[lane], laps) - gateStagger(lane, raceTimeMs) / laneGeo.length);
      }
      const ranked = snap?.info.ranked.length ? snap.info.ranked.map((s) => s.lane).filter((l) => l < count) : Array.from({ length: count }, (_, i) => i);
      const leader = ranked[0] ?? 0;
      const leadP = snap?.info.leadP ?? 0;
      const racing = phase === 'running';
      const final = phase === 'confirming' || phase === 'done';
      /* Place badges wait for the field to spread: about 3 s, or the leader a clear two lengths ahead. */
      const second = ranked[1];
      const leadGap = second === undefined ? Infinity : (progressOf[leader] - progressOf[second]) * laps * geometry.lanes[leader].length;
      const spread = racing && fieldSpread(raceTimeMs, leadGap, SPREAD_GAP);
      spreadRef.current = spread;

      /* Laps: the counter, the wipe on every new lap, and who has been lapped. */
      if (laps > 1 && snap && (racing || final)) {
        const lapNow = Math.min(laps, Math.floor(Math.min(0.999999, leadP) * laps) + 1);
        if (lapNow !== lapNowRef.current) {
          const up = lapNow > lapNowRef.current;
          lapNowRef.current = lapNow;
          setText(lapRef.current, `${lapNow}/${laps}`);
          setText(lapLabelRef.current, lapNow === laps ? 'FINAL LAP' : 'LAP');
          cls(lapBoxRef.current, 'is-final', lapNow === laps);
          const wipe = lapWipeRef.current;
          if (up && wipe && !reduce) {
            setText(wipe.firstElementChild, lapNow === laps ? 'FINAL LAP' : `LAP ${lapNow} OF ${laps}`);
            wipe.dataset.final = String(lapNow === laps);
            wipe.classList.remove('run');
            void wipe.offsetWidth;
            wipe.classList.add('run');
          }
        }
        /* Past the line the chip reads the finished state, never FINAL LAP. */
        if (final) {
          setText(lapLabelRef.current, 'FINISHED');
          cls(lapBoxRef.current, 'is-final', true);
        }
      }
      const down = new Map<number, number>();
      if (laps > 1 && snap && racing) {
        for (let lane = 0; lane < count; lane++) {
          const d = lapsDown(leadP, progressOf[lane], laps);
          if (d > 0) down.set(lane, d);
        }
      }
      const downKey = [...down].map(([l, d]) => `${l}:${d}`).join(',');
      if (downKey !== lappedRef.current) {
        lappedRef.current = downKey;
        setLapped(down);
      }

      /* The twist on air, staged from the locked plan itself. */
      let twist: StagedTwist | null = null;
      if (racing && snap) {
        const events = snap.snails[0]?.lockedMotion?.events;
        if (events) {
          if (windowsRef.current.events !== events) windowsRef.current = { events, windows: storyWindows(events) };
          twist = stagedAt(windowsRef.current.windows, snap.info.raceTimeMs);
        } else twist = stagedFromMoment(momentRef.current, leader, snap.info.raceTimeMs);
      }
      if ((twist?.key ?? null) !== (stagedRef.current?.key ?? null)) {
        stagedRef.current = twist;
        setStaged(twist);
      }
      const targets = new Set(twist ? featuredLanes(twist).filter((l) => l < count) : []);

      /* The prop: on the target's own lane, just in front of its nose, and never on the line. */
      let twistPts: CoursePoint[] | undefined;
      let propPoint: CoursePoint | null = null;
      if (twist && targets.size) {
        let lane = featuredLane(twist, leader);
        if (targets.size > 2) lane = [...targets].sort((a, b) => progressOf[b] - progressOf[a])[0];
        if (lane >= count) lane = leader;
        const want = (twist.phase === 'warning' ? 92 : 54) * artScaleRef.current;
        const ahead = propAheadRef.current;
        const dt = ahead.at ? Math.min(0.1, (now - ahead.at) / 1000) : 1;
        ahead.at = now;
        ahead.value = reduce ? want : ahead.value + (want - ahead.value) * (1 - Math.exp(-dt / 0.35));
        const laneGeo = geometry.lanes[lane];
        const len = laneGeo.length;
        let d = lapProgress(progressOf[lane], laps) * len + ahead.value;
        const onLap = ((d % len) + len) % len;
        const clear = 50;
        if (onLap < clear) d += clear - onLap;
        else if (onLap > len - clear) d += len - onLap + clear;
        const prop = pointOnLane(laneGeo, d / len);
        twistPts = [pts[lane], prop];
        propPoint = prop;
        const propChip = propChipRef.current;
        const propAt = `translate3d(${(met.ox + met.m * (prop.x - PROP_CHIP)).toFixed(1)}px, ${(met.oy + met.m * (prop.y - PROP_CHIP)).toFixed(1)}px, 0)`;
        if (propChip && propChip.style.transform !== propAt) propChip.style.transform = propAt;
      } else {
        propAheadRef.current = { value: 96, at: 0 };
      }

      /* The shot. */
      const vps = viewports();
      let kind: ShotKind;
      if (!snap || phase === 'idle' || phase === 'countdown') {
        kind = 'gate';
        finishLatchRef.current = false;
        fieldWideRef.current = false;
      } else if (final) kind = 'hold';
      else if (courseViewRef.current || phase === 'void') kind = 'full';
      else {
        const remaining = (1 - leadP) * laps * geometry.lanes[leader].length;
        const span = furniture.box.x1 - furniture.box.x0;
        /* The finish-line camera takes over for the last tenth or so: as soon as
           the line and the leader fit one shot together. */
        if (leadP > 0.5 && (remaining < span * 0.42 || (leadP >= 0.9 && remaining < span * 0.7))) finishLatchRef.current = true;
        kind = finishLatchRef.current ? 'finish' : 'pack';
      }
      /* The frame the shot is composed in glides between the gate board's
         width and the timing tower's, as the panel itself does, so the
         course never jumps sideways when the board folds into the tower. */
      const vpWant = kind === 'gate' ? vps.gate : kind === 'hold' ? vps.hold : vps.race;
      const vpLive = vpRef.current;
      const vpDt = vpLive.at ? Math.min(0.1, Math.max(0, (now - vpLive.at) / 1000)) : 0;
      if (!vpLive.rect || reduce || !snap || phase === 'idle') {
        vpLive.rect = { ...vpWant };
        vpLive.v = { x: { v: 0 }, y: { v: 0 }, w: { v: 0 }, h: { v: 0 } };
      } else {
        const r = vpLive.rect;
        r.x = smoothDamp(r.x, vpWant.x, vpLive.v.x, VP_GLIDE_S, vpDt);
        r.y = smoothDamp(r.y, vpWant.y, vpLive.v.y, VP_GLIDE_S, vpDt);
        r.w = smoothDamp(r.w, vpWant.w, vpLive.v.w, VP_GLIDE_S, vpDt);
        r.h = smoothDamp(r.h, vpWant.h, vpLive.v.h, VP_GLIDE_S, vpDt);
      }
      vpLive.at = now;
      const vp: Rect = { ...vpLive.rect };
      const courseSpan = furniture.box.x1 - furniture.box.x0;
      const line = [furniture.lineA, furniture.lineB, { x: furniture.label.x, y: furniture.label.y + 6 }];
      let target;
      const packSpan = Math.max(340, Math.min(courseSpan * 0.6, 640));
      /* A twist far from the leader gets the shot to itself while it plays. */
      const twistAlone = twistPts !== undefined && spanFor(grow(boxOf([...twistPts, pts[leader]]), 60), vp) > packSpan;
      /* The placegetters: the leader and the next two, who are always in the shot. */
      const placegetters = ranked.slice(0, 3).map((l) => pts[l]);
      if (kind === 'gate' || kind === 'full') target = fitBox(grow(furniture.box, 20), vp);
      else if (kind === 'pack') {
        /* Once the placegetters span most of the course, the whole course is the shot. */
        const need = holdSpan(vp, placegetters) / courseSpan;
        if (need > FIELD_WIDE_AT) fieldWideRef.current = true;
        else if (need < FIELD_TIGHT_AT) fieldWideRef.current = false;
        target = fieldWideRef.current
          ? fitBox(grow(furniture.box, 20), vp)
          : packShot({
              vp,
              leader: pts[leader],
              chasers: ranked.slice(1, LEAD_PACK).map((l) => pts[l]),
              twist: twistPts,
              minSpan: 300,
              maxSpan: packSpan,
            });
      } else if (kind === 'finish') {
        target = finishShot(vp, line, ranked.slice(0, 3).map((l) => pts[l]), 320, courseSpan * 0.8);
      } else {
        const winner = resultsRef.current[0]?.lane ?? leader;
        const close = ranked.filter((l) => l !== winner && Math.hypot(pts[l].x - pts[winner].x, pts[l].y - pts[winner].y) < 140).map((l) => pts[l]);
        target = finishShot(vp, line, [pts[winner], ...close], 280, courseSpan * 0.6, 44);
      }
      const shot = rig.step(target, kind, now, {
        vp,
        reduce,
        /* The third and second, the twist's snail and prop, then the leader, who wins any tie. */
        keepIn: kind === 'pack' ? (twistAlone ? twistPts : [...placegetters.slice(1).reverse(), ...(twistPts ?? []), pts[leader]]) : undefined,
      });
      const wide = kind === 'full' || (kind === 'pack' && fieldWideRef.current);
      setText(shotRef.current, wide ? 'FULL FIELD' : kind === 'pack' ? 'LEAD PACK' : kind === 'finish' || kind === 'hold' ? 'FINISH LINE' : '');
      write(wrapRef.current, 'shot', 'data-shot', kind);

      /*
       * Paint the course at a raster that keeps the closest shot sharp.
       * Repainting the course at a new raster costs frames, so it is done at
       * the gate, for the tightest shot the race can take (the finish hold),
       * and never while the race is running: the camera then only ever
       * scales one painted layer, which is smooth.
       */
      const tightest = Math.max(shot.z, target.z, vps.race.w / 280);
      const want = (kind === 'gate' ? tightest : Math.max(shot.z, target.z)) / met.m0;
      const fitR = RASTERS.find((r) => r >= want * 0.92) ?? RASTERS[RASTERS.length - 1];
      const maxR = Math.max(1, Math.sqrt(36e6 / Math.max(1, met.sw * met.sh)));
      const nextR = Math.min(fitR, RASTERS.filter((r) => r <= maxR).pop() ?? 1);
      /* Rastered once at the gate; never while the race is running. */
      if (kind === 'gate' ? nextR !== met.r : !racing && nextR > met.r) setRaster(nextR);

      const s = shot.z / met.m;
      const tx = vp.x + vp.w / 2 - shot.z * shot.cx - s * met.ox;
      const ty = vp.y + vp.h / 2 - shot.z * shot.cy - s * met.oy;
      style(cameraRef.current, 'camera', `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${s.toFixed(4)})`);

      /* Runners: feet on the lane, art along the lane, number and tag upright and a constant size on screen. */
      const z = shot.z;
      const wholeShot = wide || kind === 'gate';
      /* A snail is at least 3.4u of art on screen, growing to 4.3u as the
         camera pulls out to the whole course, so the back of the room can
         still pick out a shell. It follows the zoom, so a cut never pops the
         art; in the close shots it is drawn at its course size. */
      const wholeZ = fitBox(grow(furniture.box, 20), vp).z;
      const pulledOut = Math.min(1, Math.max(0, (wholeZ * 1.6 - z) / (wholeZ * 0.6)));
      /* Badges, tags and the smallest snail grow with the course: measured on the race frame, so they hold still through the race. */
      const raceH = fitBox(grow(furniture.box, 20), vps.race).z * (furniture.box.y1 - furniture.box.y0 + 40);
      const labelK = Math.round(Math.min(L.labelMax, Math.max(1, raceH / (L.labelBase * met.u))) * 50) / 50;
      if (labelsRef.current && writtenRef.current.get('label-k') !== String(labelK)) {
        writtenRef.current.set('label-k', String(labelK));
        labelsRef.current.style.setProperty('--label-k', String(labelK));
      }
      const artScale = Math.round(Math.max(1, ((3.4 + 0.9 * pulledOut) * met.u * labelK) / (SPRITE_W * z)) * 1000) / 1000;
      artScaleRef.current = artScale;
      write(propScaleRef.current, 'prop-scale', 'transform', `scale(${artScale})`);
      const badgeU = (wholeShot ? CIRCUIT_LAYOUT.badge * 0.78 : CIRCUIT_LAYOUT.badge) * labelK;
      /* A runner crossing the frame edge fades over about a length rather than being sliced. */
      const fadeW = Math.max(1, SPRITE_W * artScale * z);
      const paneW = kind === 'gate' ? met.sw : vp.x + vp.w;
      /* The badge radius on screen is fixed in projector units; in course units it shrinks as the camera tightens. */
      const badgeR = (badgeU * met.u) / z;
      cls(labelsRef.current, 'is-wide', wholeShot);
      /* Place tags, front runners first, skipping any that would sit on one already shown. */
      const shownTags: CoursePoint[] = [];
      const tagClear = (p: CoursePoint) => {
        const clear = shownTags.every((q) => Math.abs(q.x - p.x) > badgeR * 4.2 || Math.abs(q.y - p.y) > badgeR * 1.8);
        if (clear) shownTags.push(p);
        return clear;
      };
      const order = final ? [...resultsRef.current.map((r) => r.lane), ...ranked] : ranked;
      const tagOrder = [...new Set([...order, ...Array.from({ length: count }, (_, i) => i)])];
      const placeByLane = new Map<number, number>();
      if (final) for (const r of resultsRef.current) placeByLane.set(r.lane, r.place);
      ranked.forEach((lane, i) => {
        if (!final) placeByLane.set(lane, i + 1);
      });
      for (const lane of tagOrder) {
        const nodes = runnersRef.current.get(lane);
        if (!nodes || lane >= count) continue;
        const pt = pts[lane];
        style(nodes.chip, `c${lane}`, `translate3d(${(met.ox + met.m * (pt.x - CHIP)).toFixed(1)}px, ${(met.oy + met.m * (pt.y - CHIP)).toFixed(1)}px, 0)`);
        write(nodes.node, `d${lane}`, 'data-progress', String(progressOf[lane]));
        /* The heading is coarse enough that a straight writes nothing frame to frame. */
        const angle = Math.round(pt.angle * 2) / 2;
        const cos = Math.cos((angle * Math.PI) / 180),
          sin = Math.sin((angle * Math.PI) / 180);
        const flip = cos < 0;
        style(nodes.art, `a${lane}`, `rotate(${angle + (flip ? 180 : 0)}deg) scale(${flip ? -artScale : artScale}, ${artScale})`);
        const back = SNAIL_LEN * artScale * 0.92 + badgeR;
        const bx = -cos * back,
          by = -sin * back;
        /* The label sits behind the shell, in screen pixels over the pane. */
        const at = toScreen({ x: pt.x + bx, y: pt.y + by }, shot, vp);
        /* A runner on the top edge keeps its tag inside the pane. */
        at.y = Math.max(at.y, met.u * 3.6 * labelK);
        const { label, tag: tagNode } = nodes;
        style(label, `l${lane}`, `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`);
        const place = placeByLane.get(lane) ?? 0;
        const behind = down.get(lane) ?? 0;
        let tag = '';
        let tone = '';
        if (final) {
          /* Every snail wears its final place; the front of the field is
             tagged first, so a crowded tag gives way to the one ahead of it. */
          tag = place === 1 ? 'WINNER' : place ? placeTag(place) : '';
          tone = place === 1 ? 'win' : place <= 3 ? `p${place}` : 'place';
        } else if (racing && behind > 0) {
          tag = lapsDownText(behind);
          tone = 'lapped';
        } else if (racing && spread && place >= 1 && place <= 3) {
          tag = placeTag(place);
          tone = `p${place}`;
        }
        const tagAt = { x: pt.x + bx, y: pt.y + by - badgeR * 2.1 };
        if (tag && !tagClear(tagAt)) tag = '';
        /* Labels that would sit on the twist's prop step back so the prop reads. */
        const onProp = propPoint !== null && !targets.has(lane) && Math.hypot(pt.x + bx - propPoint.x, pt.y + by - propPoint.y) < 40 * artScale + badgeR * 1.5;
        cls(label, 'is-quiet', onProp);
        if (tagNode && tagNode.textContent !== tag) tagNode.textContent = tag;
        write(tagNode, `g${lane}`, 'data-tone', tag ? tone : 'none');
        /* The front of the race is drawn on top, so the leaders' tags are never under a backmarker. */
        const rank = ranked.indexOf(lane);
        const zIndex = String(count - (rank < 0 ? count : rank));
        if (nodes.chip.style.zIndex !== zIndex) {
          nodes.chip.style.zIndex = zIndex;
          if (label) label.style.zIndex = zIndex;
        }
        cls(nodes.node, 'is-leader', racing && lane === leader);
        cls(nodes.node, 'is-lapped', racing && behind > 0);
        cls(nodes.node, 'is-winner', final && place === 1);
        cls(nodes.node, 'is-target', targets.has(lane));
        if (targets.has(lane)) write(nodes.node, `k${lane}`, 'data-tone', twist?.tone ?? 'wild');
        const retired = Boolean(snap?.snails.find((sn) => sn.lane === lane)?.retired);
        cls(nodes.node, 'retired', retired);
        const sp = toScreen(pt, shot, vp);
        const edge = Math.min(sp.x, paneW - sp.x, sp.y, met.sh - sp.y);
        const fade = Math.min(1, Math.max(0, (edge + fadeW * 0.2) / fadeW));
        const fadeKey = (Math.round(fade * 20) / 20).toFixed(2);
        if (fadeRef.current.get(lane) !== fadeKey) {
          fadeRef.current.set(lane, fadeKey);
          const value = fadeKey === '1.00' ? '' : fadeKey;
          nodes.chip.style.opacity = value;
          if (label) label.style.opacity = value;
        }
      }

      /* The mini-map: every runner as a dot, and the box the camera is showing. */
      const map = mapRef.current;
      if (map && met.mw && met.mh) {
        const mapOn = kind === 'pack' || kind === 'finish';
        cls(map, 'is-on', mapOn);
        /* The tower gives the foot of the column to the map only while the map is up. */
        cls(wrapRef.current, 'map-on', mapOn);
        /* The map's view box, fitted inside the map the way the SVG fits it. */
        const b = furniture.box;
        const vbw = b.x1 - b.x0 + 60,
          vbh = b.y1 - b.y0 + 60;
        const k = Math.min(met.mw / vbw, met.mh / vbh);
        const mx = (met.mw - vbw * k) / 2 - (b.x0 - 30) * k;
        const my = (met.mh - vbh * k) / 2 - (b.y0 - 30) * k;
        for (let lane = 0; lane < count; lane++) {
          const dot = mapDotsRef.current.get(lane);
          if (!dot) continue;
          style(dot, `m${lane}`, `translate3d(${(mx + pts[lane].x * k).toFixed(1)}px, ${(my + pts[lane].y * k).toFixed(1)}px, 0)`);
          cls(dot, 'is-leader', lane === leader && snap !== null);
        }
        const view = mapViewRef.current;
        if (view) {
          /* The frame box moves in steps of a few map pixels: no relayout for a drift the eye cannot see. */
          const step = Math.max(1, 3 / k);
          const w = Math.round(vp.w / z / step) * step,
            h = Math.round(vp.h / z / step) * step;
          write(view, 'vx', 'x', (Math.round((shot.cx - w / 2) / step) * step).toFixed(0));
          write(view, 'vy', 'y', (Math.round((shot.cy - h / 2) / step) * step).toFixed(0));
          write(view, 'vw', 'width', w.toFixed(0));
          write(view, 'vh', 'height', h.toFixed(0));
        }
      }
    };

    const measure = () => {
      const scene = sceneRef.current;
      const wrap = wrapRef.current;
      if (!wrap?.clientHeight) return;
      const met = metricsRef.current;
      /* The projector unit, measured against the broadcast box itself. */
      met.u = Math.min(wrap.clientWidth / 100, (wrap.clientHeight * 1.7778) / 100);
      wrap.style.setProperty('--u', `${met.u.toFixed(3)}px`);
      const b = furniture.box;
      const layout = circuitLayoutFor(wrap.clientWidth, wrap.clientHeight, (b.x1 - b.x0 + 40) / (b.y1 - b.y0 + 40));
      /* The pane's new size reaches the scene's observer, which measures again. */
      if (wrap.dataset.layout !== layout) wrap.dataset.layout = layout;
      if (!scene?.clientHeight) return;
      met.sw = scene.clientWidth;
      met.sh = scene.clientHeight;
      met.m0 = Math.min(met.sw / 1200, met.sh / 720);
      const map = mapRef.current;
      met.mw = map?.clientWidth ?? 0;
      met.mh = map?.clientHeight ?? 0;
      /* Every map dot moves with the map's size. */
      for (const key of [...writtenRef.current.keys()]) if (key.startsWith('m')) writtenRef.current.delete(key);
      setRaster(met.r || 1);
    };

    const painter: RacePainter = {
      measure,
      start: () => {
        /* Only the runners' layer changes at the off: touching the course
           SVG would repaint the whole high-resolution course in one frame. */
        runnerLayerRef.current?.classList.add('racing');
      },
      reset: () => {
        snapshotRef.current = null;
        writtenRef.current.clear();
        rigRef.current?.reset();
        vpRef.current.rect = null;
        finishLatchRef.current = false;
        lapNowRef.current = 1;
        runnerLayerRef.current?.classList.remove('racing');
        runnersRef.current.forEach((nodes) => nodes.node.classList.remove('finished', 'retired', 'is-winner', 'is-leader', 'is-lapped', 'is-target'));
        fadeRef.current.clear();
        fieldWideRef.current = false;
        setText(clockRef.current, '0:00.0');
        setText(lapRef.current, `1/${laps}`);
        setText(lapLabelRef.current, 'LAP');
        lapBoxRef.current?.classList.remove('is-final');
        lapWipeRef.current?.classList.remove('run');
      },
      paint: (snails, info) => {
        snapshotRef.current = { snails, info };
        for (const snail of info.justFinished) runnersRef.current.get(snail.lane)?.node.classList.add('finished');
        setText(clockRef.current, clockText(info.raceTimeMs));
        /* Draw in the same frame the positions were worked out, so the
           runners and the camera always move by one frame's worth. */
        const now = wallClockMs();
        paintedAtRef.current = now;
        render(now);
      },
    };
    return { painter, render };
  }, [geometry, laps, count, furniture]);

  useEffect(() => {
    setPainter(painter);
    painter.reset();
    painter.measure();
    return () => releasePainter(painter);
  }, [painter, setPainter, releasePainter]);
  useEffect(() => {
    const observer = new ResizeObserver(() => painter.measure());
    if (wrapRef.current) observer.observe(wrapRef.current);
    if (sceneRef.current) observer.observe(sceneRef.current);
    if (mapRef.current) observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, [painter]);
  /* One loop moves the camera and the runners; the race loop only hands over positions. */
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      /* While the race loop is painting, it draws; this loop covers the
         gate, the hold and anything else with no race clock running. */
      const now = wallClockMs();
      if (now - paintedAtRef.current > 50) render(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [render]);

  const showResult = (phase === 'confirming' || phase === 'done') && race.results.length > 0;
  const presentation = staged
    ? presentationForMoment({ id: 0, text: staged.commentaryText, tone: 'hot', label: staged.label, kind: staged.kind })
    : null;
  const L = CIRCUIT_LAYOUT;
  const layoutVars = {
    '--scene-top': `calc(var(--u) * ${L.sceneTop})`,
    '--gap': `calc(var(--u) * ${L.gap})`,
    '--tower-w': `calc(var(--u) * ${L.tower})`,
    '--board-w': `calc(var(--u) * ${L.board})`,
    '--side-w': `calc(var(--u) * ${L.side})`,
    '--side-top': `calc(var(--u) * ${L.sideTop})`,
    '--map-w': `calc(var(--u) * ${L.mapW})`,
    '--map-h': `calc(var(--u) * ${L.mapH})`,
    '--result-h': `calc(var(--u) * ${L.resultH})`,
    '--turf': look.scene,
  } as CSSProperties;

  return (
    <div
      ref={wrapRef}
      className={`track-wrap tv-wrap race-broadcast course-broadcast circuit-broadcast ${look.night ? 'is-night' : ''} ${reduceMotion ? 'calm race-motion-reduced' : ''}`}
      style={layoutVars}
      data-surface={surface}
      data-race-phase={phase}
      data-reduced-motion={String(reduceMotion)}
      data-weather={race.weather}
      data-course={courseId}
      data-camera={courseView ? 'course' : 'trackside'}
      data-runners={count}
    >
      <div className="course-scene" ref={sceneRef}>
        <div className="course-camera" ref={cameraRef}>
          <svg
            ref={svgRef}
            className="tv"
            viewBox="0 0 1200 720"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${course.name}: ${count} snails racing in marked lanes over ${laps} ${laps === 1 ? 'lap' : 'laps'}`}
          >
            <CourseArt
              courseId={courseId}
              look={look}
              geometry={geometry}
              furniture={furniture}
            />
          </svg>
          <div className="tv-runner-layer tv-runners" ref={runnerLayerRef} aria-hidden="true">
            {staged && presentation ? (
              <svg
                key={staged.eventId}
                ref={propChipRef}
                className={`course-prop-chip course-prop course-prop-${presentation.cue}`}
                data-phase={staged.phase}
                data-tone={staged.tone}
                viewBox={`${-PROP_CHIP} ${-PROP_CHIP} ${2 * PROP_CHIP} ${2 * PROP_CHIP}`}
              >
                <ellipse className="course-impact" rx="30" ry="12" />
                <g ref={propScaleRef}>
                <g className="course-prop-motion">
                  {presentation.art ? (
                    <image className="course-prop-image" href={`${ART_BASE}/surprises/${presentation.art}.webp`} x="-28" y="-28" width="56" height="56" />
                  ) : presentation.glyph ? (
                    <g className="course-prop-symbol course-prop-vector" data-glyph={presentation.glyph} transform="scale(0.92) translate(0 32)">
                      <PropGlyph id={presentation.glyph} />
                    </g>
                  ) : (
                    <text className="course-prop-symbol" y="12" textAnchor="middle" fontSize="36">
                      {presentation.symbol}
                    </text>
                  )}
                </g>
                </g>
              </svg>
            ) : null}
            {names.map((name, lane) => (
              <RunnerChip
                key={lane}
                lane={lane}
                name={name}
                number={snailNumber(lane, numberOffset, numbers)}
                look={runnerLookAt(lane, names.length, numberOffset, numbers)}
                onNodes={(nodes) => {
                  if (nodes) runnersRef.current.set(lane, nodes);
                  else runnersRef.current.delete(lane);
                }}
              />
            ))}
          </div>
        </div>
        <div className="tv-runner-labels" ref={labelsRef} aria-hidden="true">
          {names.map((_, lane) => (
            <RunnerLabel
              key={lane}
              lane={lane}
              number={snailNumber(lane, numberOffset, numbers)}
              onNodes={(label, tag) => {
                const nodes = runnersRef.current.get(lane);
                if (nodes) {
                  nodes.label = label;
                  nodes.tag = tag;
                }
              }}
            />
          ))}
        </div>
        <div ref={flashRef} className="circuit-finish-flash" aria-hidden="true" />
        {race.countdown ? (
          <div className="countdown" aria-hidden="true">
            <span key={race.countdown} data-go={String(/GO/i.test(race.countdown))}>
              {race.countdown}
            </span>
          </div>
        ) : null}
        <button
          type="button"
          className="race-camera-toggle"
          aria-pressed={courseView}
          disabled={phase === 'idle' || phase === 'countdown'}
          onClick={() => {
            const next = !courseViewRef.current;
            courseViewRef.current = next;
            if (onCourseViewChange) onCourseViewChange(next);
            else setCourseView(next);
          }}
        >
          {courseView ? 'Telecast' : 'Full field'}
        </button>
      </div>
      <TwistCard twist={staged} />
      <div ref={mapRef} className="circuit-minimap" aria-hidden="true">
        <svg
          className="circuit-minimap-art"
          viewBox={`${furniture.box.x0 - 30} ${furniture.box.y0 - 30} ${furniture.box.x1 - furniture.box.x0 + 60} ${furniture.box.y1 - furniture.box.y0 + 60}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <path d={geometry.centre.path} className="circuit-minimap-track" strokeWidth={geometry.trackWidth * 0.62} />
          <line x1={furniture.lineA.x} y1={furniture.lineA.y} x2={furniture.lineB.x} y2={furniture.lineB.y} className="circuit-minimap-line" />
          <rect ref={mapViewRef} className="circuit-minimap-view" rx="12" />
        </svg>
        {names.map((_, lane) => (
          <span
            key={lane}
            className="circuit-minimap-dot"
            style={{ background: laneColour(lane).shell }}
            ref={(dot) => {
              if (dot) mapDotsRef.current.set(lane, dot);
              else mapDotsRef.current.delete(lane);
            }}
          />
        ))}
      </div>
      {showResult ? (
        <OfficialResult
          results={race.results}
          raceNo={raceNo}
          sponsor={sponsor}
          tote={toteResult}
          replay={replay}
          runnerSponsors={owners}
          numberOffset={numberOffset}
          numbers={numbers}
        />
      ) : null}
      <BroadcastHud
        brand={
          <ClubBrand
            className="club-brand tv-club-brand"
            imageClassName="club-brand-logo tv-club-logo"
            nameClassName="tv-club-name"
            priority
          />
        }
        race={race}
        names={names}
        numberOffset={numberOffset}
        numbers={numbers}
        raceNo={raceNo}
        courseName={course.name}
        replay={replay}
        laps={laps}
        lapped={lapped}
        clockRef={clockRef}
        lapRef={lapRef}
        lapLabelRef={lapLabelRef}
        lapBoxRef={lapBoxRef}
        shotRef={shotRef}
        lapWipeRef={lapWipeRef}
        spreadRef={spreadRef}
      />
      <span className="sr-only">{clubName}</span>
    </div>
  );
}

/**
 * The shares of a chip each part of the art takes, with the feet point at
 * the chip's centre: the sprite's nose-to-tail box, its halo and its shadow,
 * in course units of the chip's side (2 x CHIP).
 */
const pct = (units: number) => `${((units / (2 * CHIP)) * 100).toFixed(2)}%`;
const SPRITE_BOX = { left: pct(CHIP - SPRITE_W * 0.94), top: pct(CHIP - SPRITE_H * 0.7), width: pct(SPRITE_W), height: pct(SPRITE_H) };
const HALO_BOX = { left: pct(CHIP - SNAIL_LEN * 0.45 - SNAIL_LEN * 0.78), top: pct(CHIP - SNAIL_LEN * 0.5), width: pct(SNAIL_LEN * 1.56), height: pct(SNAIL_LEN) };
const SHADOW_BOX = { left: pct(CHIP - SNAIL_LEN * 0.45 - SNAIL_LEN * 0.5), top: pct(CHIP + 2 - 6), width: pct(SNAIL_LEN), height: pct(12) };

/**
 * One runner's own small layer in the painted world: shadow, halo and art.
 * The whole chip slides by a transform; the art inside turns by a transform;
 * neither is ever laid out again once drawn.
 */
function RunnerChip({ lane, name, number, look, onNodes }: { lane: number; name: string; number: number; look: RunnerLook; onNodes: (nodes: RunnerNodes | null) => void }) {
  return (
    <div
      className="tv-runner-chip"
      ref={(chip) => {
        if (!chip) {
          onNodes(null);
          return;
        }
        const node = chip.querySelector<HTMLDivElement>('.tv-runner');
        const art = chip.querySelector<HTMLDivElement>('.tv-art');
        if (!node || !art) return;
        /* The label is attached when its own node mounts. */
        onNodes({ chip, node, art, label: null, tag: null });
      }}
    >
      <div className="tv-runner" data-lane={lane} title={`${number}. ${name}`}>
        <div className="tv-art">
          <span className="tv-runner-halo" style={HALO_BOX} />
          <span className="tv-runner-shadow" style={SHADOW_BOX} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="tv-snail-sprite"
            src={look.art.src}
            alt=""
            draggable={false}
            style={{ ...SPRITE_BOX, filter: `hue-rotate(${look.hue}deg)` }}
          />
        </div>
      </div>
    </div>
  );
}

/** A runner's number badge and place tag, in screen space over the course, a constant size whatever the zoom. */
function RunnerLabel({ lane, number, onNodes }: { lane: number; number: number; onNodes: (label: HTMLDivElement | null, tag: HTMLSpanElement | null) => void }) {
  const colour = laneColour(lane);
  return (
    <div
      className="tv-runner-label"
      data-lane={lane}
      ref={(label) => onNodes(label, label?.querySelector<HTMLSpanElement>('.tv-runner-tag') ?? null)}
    >
      <span className="tv-runner-tag" data-tone="none" />
      <span className="course-runner-number num" style={{ background: colour.dark }} data-digits={String(number).length}>
        {number}
      </span>
    </div>
  );
}

type Furniture = {
  lineA: CoursePoint;
  lineB: CoursePoint;
  label: CoursePoint;
  box: Box;
  chevrons: (CoursePoint & { angle: number })[];
  kerbs: string[];
};

/** The painted course: ground, track, lanes, kerbs, chevrons, the line and the course's own scenery. */
function CourseArt({
  courseId,
  look,
  geometry,
  furniture,
}: {
  courseId: CourseId;
  look: (typeof LOOK)[CourseId];
  geometry: ReturnType<typeof courseGeometry>;
  furniture: Furniture;
}): ReactNode {
  const { lineA, lineB, label, chevrons, kerbs } = furniture;
  const id = courseId;
  return (
    <>
      <defs>
        <pattern id={`turf-${id}`} width="80" height="80" patternUnits="userSpaceOnUse">
          <rect width="80" height="80" fill={look.turf[0]} />
          <rect width="40" height="80" fill={look.turf[1]} />
        </pattern>
        <pattern id="course-chequers" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#fff9ed" />
          <path d="M0 0H6V6H0ZM6 6H12V12H6Z" fill="#24171b" />
        </pattern>
        <radialGradient id="flood-pool">
          <stop offset="0" stopColor="#fff6d6" stopOpacity=".42" />
          <stop offset=".55" stopColor="#fff2c4" stopOpacity=".16" />
          <stop offset="1" stopColor="#fff2c4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect className="tv-art-background" x="-1200" y="-720" width="3600" height="2160" fill={`url(#turf-${id})`} />
      <g className="course-world">
        {id === 'boundary-oval' ? (
          <g className="course-plate" aria-hidden="true">
            <rect x="520" y="310" width="160" height="100" rx="12" fill="#bfae78" opacity=".32" />
            <text className="course-club-mark" x="600" y="374" textAnchor="middle">
              NDCC
            </text>
          </g>
        ) : null}
        {id === 'pavilion-chicane' ? <Pavilion /> : null}
        {id === 'floodlight-eight' ? <Floodlights /> : null}
        <path d={geometry.centre.path} fill="none" stroke={look.edge} strokeWidth={geometry.trackWidth + 20} strokeLinejoin="round" />
        <path d={geometry.centre.path} fill="none" stroke={look.track} strokeWidth={geometry.trackWidth + 6} strokeLinejoin="round" />
        {geometry.lanes.map((lane, i) => (
          <path
            key={i}
            className="course-lane"
            data-lane={i}
            d={lane.path}
            fill="none"
            stroke={i % 2 ? look.laneB : look.laneA}
            strokeWidth={geometry.laneWidth}
            strokeLinejoin="round"
          />
        ))}
        {geometry.boundaries.map((lane, i) => (
          <path
            key={i}
            d={lane.path}
            fill="none"
            stroke="#fff5dc"
            strokeWidth={i === 0 || i === geometry.boundaries.length - 1 ? 3 : 1}
            opacity=".8"
          />
        ))}
        {kerbs.map((d, i) => (
          <g key={i} className="course-kerb">
            <path d={d} fill="none" stroke="#fff9ed" strokeWidth="10" strokeLinecap="butt" />
            <path d={d} fill="none" stroke="#c8202b" strokeWidth="10" strokeDasharray="10 10" strokeLinecap="butt" />
          </g>
        ))}
        {chevrons.map((c, i) => (
          <path
            key={i}
            className={`course-chevron ${id === 'floodlight-eight' ? 'is-bright' : ''}`}
            d="M-10 -15 L6 0 L-10 15"
            transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.angle.toFixed(1)})`}
          />
        ))}
        {id === 'floodlight-eight' ? (
          <g className="course-flood-pools" aria-hidden="true">
            <ellipse cx="400" cy="360" rx="300" ry="230" fill="url(#flood-pool)" />
            <ellipse cx="800" cy="360" rx="300" ry="230" fill="url(#flood-pool)" />
            <ellipse cx="600" cy="360" rx="160" ry="130" fill="url(#flood-pool)" />
          </g>
        ) : null}
        <path className="course-finish-glow" d={`M${lineA.x} ${lineA.y}L${lineB.x} ${lineB.y}`} />
        <path d={`M${lineA.x} ${lineA.y}L${lineB.x} ${lineB.y}`} stroke="url(#course-chequers)" strokeWidth="14" />
        <text className="course-start-label" x={label.x} y={label.y} textAnchor="middle">
          START / FINISH
        </text>
      </g>
    </>
  );
}

/** The pavilion, in the infield below the chicane that is named after it. */
function Pavilion() {
  return (
    <g className="course-pavilion" aria-hidden="true" transform="translate(690 448)">
      <rect x="-120" y="-22" width="240" height="60" rx="4" fill="#f3e6c8" stroke="#3b2a1e" strokeWidth="3" />
      <path d="M-134 -20 L0 -62 L134 -20 Z" fill="#8c2a2f" stroke="#3b2a1e" strokeWidth="3" strokeLinejoin="round" />
      <rect x="-14" y="-52" width="28" height="18" fill="#f3e6c8" stroke="#3b2a1e" strokeWidth="2" />
      {[-96, -64, -32, 32, 64, 96].map((x) => (
        <rect key={x} x={x - 9} y="-10" width="18" height="22" fill="#3d5a73" stroke="#3b2a1e" strokeWidth="2" />
      ))}
      <rect x="-14" y="2" width="28" height="36" fill="#6b3b22" stroke="#3b2a1e" strokeWidth="2" />
    </g>
  );
}

/** Four light towers and the glow they throw. */
function Floodlights() {
  const towers = [
    [170, 110],
    [1030, 110],
    [170, 615],
    [1030, 615],
  ];
  return (
    <g className="course-floodlights" aria-hidden="true">
      {towers.map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${x < 600 ? (y < 360 ? 45 : -45) : y < 360 ? -45 : 45})`}>
          <circle r="70" fill="url(#flood-pool)" />
          <line x1="0" y1="0" x2="0" y2={y < 360 ? -34 : 34} stroke="#0b0d10" strokeWidth="4" opacity=".55" />
          <rect x="-15" y="-11" width="30" height="22" rx="1.5" fill="#3a3f47" stroke="#0b0d10" strokeWidth="2" />
          {[-9, 0, 9].flatMap((dx) =>
            [-5, 5].map((dy) => <rect key={`${dx}${dy}`} x={dx - 3.5} y={dy - 3.5} width="7" height="7" fill="#fff8d8" />),
          )}
        </g>
      ))}
    </g>
  );
}
