'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { laneColour, type StageThemeId } from '@/lib/palette';
import { ordinal, type SnailRun } from '@/lib/race-engine';
import { ClubBrand } from './brand/ClubBrand';
import { runnerArtForLane, runnerHueRotation } from '@/lib/presentation/runner-art';
import { courseById, courseRide, type CourseId } from '@/lib/courses';
import { BroadcastHud } from './race-broadcast/BroadcastHud';
import { SurpriseLayer } from './race-broadcast/SurpriseLayer';
import { useReducedMotion } from './race-broadcast/useReducedMotion';
import {
  BLEED,
  Broadcaster,
  clampCameraX,
  clockText,
  FLOOR_H,
  HOARD_H,
  HOARD_TOP,
  HORIZON,
  LAP_LEN,
  laneBands,
  lapProgress,
  MARK_EVERY,
  runnerSafeFrame,
  TRACK_BOTTOM,
  TRACK_TOP,
  VERGE_TOP,
  VIEW_H,
  VIEW_W,
  type LaneBand,
} from '@/lib/broadcast';
import type { PaintInfo, RaceController, RacePainter } from '@/lib/use-race';

/**
 * The race, shot for television.
 *
 * One camera, on the infield, running along the track with the field. Lanes are
 * horizontal bars, every snail holds one for the whole race, and the surface
 * streams past behind them - which is the thing that makes a slow race look
 * fast. The graphics are the other half of it: a clock, a running order and a
 * strap, all of them where a broadcast puts them and none of them over the
 * runners.
 *
 * Two rules keep the frame calm. The camera only ever eases, never cuts, and
 * the zoom is always chosen to contain the runners rather than to find a
 * dramatic close-up. Coverage that reframes constantly is what made the
 * previous view unreadable.
 *
 * As with every renderer here, this is handed the same `p` per snail the
 * engine drew and only decides where to put it, so the fairness proof in
 * `race-engine.ts` covers it unchanged.
 */

interface Props {
  names: string[];
  race: RaceController;
  surface: StageThemeId;
  laps: number;
  /** Let the camera follow the field, or hold a fixed wide. */
  chase: boolean;
  calm: boolean;
  clubName: string;
  raceNo: number;
  courseId: CourseId;
  /**
   * Recorded mode. The coverage is identical; the chrome must not lie about
   * it, so the badge reads REPLAY and the live clock stands down in favour
   * of the transport bar underneath.
   */
  replay?: boolean;
}

/** How fast the camera follows the field along the track. */
const PAN_EASE = 0.12;
/**
 * How fast a re-zoom lands.
 *
 * Fast, deliberately. The director now holds a focal length and steps it only
 * when there is a reason, but easing that step at a crawl turned every step
 * into a twenty-second creep - which from the back of the room is
 * indistinguishable from a lens that never stops moving. At this rate a
 * re-zoom is over in about a third of a second and the picture is then
 * completely still until the next one.
 */
const ZOOM_EASE = 0.12;

/** Parallax: how fast each backdrop layer slides against the track. */
const PX_STAND = 0.16;
const PX_HOARD = 0.55;
const PX_FORE = 1.35;

/** Tile widths for the repeating backdrops, in screen units. */
const TILE_STAND = 400;
const TILE_HOARD = 620;
const TILE_FORE = 300;

interface RunnerNodes {
  g: SVGGElement;
  tag: SVGTextElement;
  pos: SVGTextElement;
}

const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/** A deterministic scatter, so the crowd is identical on server and client. */
function scatter(seed: number, n: number): number[] {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push(s / 4294967296);
  }
  return out;
}

export function Telecast({
  names,
  race,
  surface,
  laps,
  chase,
  calm,
  clubName,
  raceNo,
  courseId,
  replay = false,
}: Props) {
  const { setPainter } = race;
  const [courseView, setCourseView] = useState(false);
  const courseViewRef = useRef(false);
  const overviewRef = useRef<SVGGElement | null>(null);
  const overviewPathRef = useRef<SVGPathElement | null>(null);
  const snapshotRef = useRef<{ snails: SnailRun[]; info: PaintInfo } | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = calm || prefersReducedMotion;

  const momentRef = useRef(race.moment);
  useEffect(() => { momentRef.current = race.moment; }, [race.moment]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<Map<number, RunnerNodes>>(new Map());
  const standRef = useRef<SVGGElement | null>(null);
  const hoardRef = useRef<SVGGElement | null>(null);
  const foreRef = useRef<SVGGElement | null>(null);
  const marksRef = useRef<SVGGElement | null>(null);
  const propsRef = useRef<SVGGElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const lapRef = useRef<HTMLSpanElement | null>(null);
  const shotRef = useRef<HTMLSpanElement | null>(null);
  const mapPathRef = useRef<SVGPathElement | null>(null);
  const mapLeaderRef = useRef<SVGCircleElement | null>(null);

  /**
   * The visible slice of the authored frame.
   *
   * The frame is authored 16:9, but a projector, a laptop and a phone are
   * not, and `slice` on a wider screen crops top AND bottom - which is how
   * the outside lanes and the strap ended up off the bottom of the picture.
   * So the viewBox is fitted to the container instead: the width is always
   * the full authored width, the height is whatever the container's shape
   * allows, and it is anchored to the BOTTOM. Sky is what gets cropped on a
   * letterbox screen; the track and the graphics band never do.
   */
  const vbRef = useRef({ x: 0, y: 0, w: VIEW_W, h: VIEW_H });

  const directorRef = useRef(new Broadcaster());
  const camRef = useRef({ x: 0, z: 0.5 });
  const timeRef = useRef({ ms: 0 });

  const bands = useMemo(() => laneBands(names.length), [names.length]);
  const course = useMemo(() => courseById(courseId), [courseId]);
  const totalWorld = Math.max(1, laps) * LAP_LEN;
  /** Past a dozen lanes a band is thinner than a name, so names are rationed. */
  const compact = names.length > 12;

  /** Where a snail's foot meets the ground, given its lane. */
  const groundY = (b: LaneBand) => b.y + b.h * 0.2;

  const painter = useMemo<RacePainter>(() => {
    const cam = camRef.current;
    const clock = timeRef.current;

    const write = () => {
      const sx = VIEW_W / 2 - cam.x * cam.z;

      const vb = vbRef.current;
      svgRef.current?.setAttribute(
        'viewBox',
        `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`,
      );

      if (marksRef.current) {
        marksRef.current.setAttribute(
          'transform',
          `translate(${sx.toFixed(1)} 0) scale(${cam.z.toFixed(4)} 1)`,
        );
      }
      /* Props carry text and chequers, so they are placed individually rather
         than squashed by a horizontal scale. There are only a handful. */
      if (propsRef.current) {
        const kids = propsRef.current.children;
        for (let i = 0; i < kids.length; i++) {
          const el = kids[i] as SVGGElement;
          const w = Number(el.dataset.world ?? 0);
          el.setAttribute('transform', `translate(${(sx + w * cam.z).toFixed(1)} 0)`);
        }
      }
      /* Backdrops repeat, so they only ever need to slide within one tile. */
      const slide = (
        node: SVGGElement | null,
        factor: number,
        tile: number,
      ) => {
        if (!node) return;
        const off = -(((cam.x * cam.z * factor) % tile) + tile) % tile;
        node.setAttribute('transform', `translate(${off.toFixed(1)} 0)`);
      };
      slide(standRef.current, PX_STAND, TILE_STAND);
      slide(hoardRef.current, PX_HOARD, TILE_HOARD);
      slide(foreRef.current, PX_FORE, TILE_FORE);
    };

    const placeAll = (fn: (lane: number) => number) => {
      nodesRef.current.forEach((n, lane) => {
        const b = bands[lane];
        if (!b) return;
        const sx = VIEW_W / 2 - cam.x * cam.z;
        n.g.setAttribute(
          'transform',
          `translate(${(sx + fn(lane) * cam.z).toFixed(1)} ${(groundY(b) + courseRide(course.id, 0) * 10).toFixed(1)})`,
        );
      });
    };

    const wideCamera = () => {
      const vb = vbRef.current;
      const safe = runnerSafeFrame(vb.x, vb.w);
      const z = (safe.right - safe.left) / (totalWorld + 520);
      const centre = (safe.left + safe.right) / 2;
      return {
        x: totalWorld / 2 + (VIEW_W / 2 - centre) / z,
        z,
        safe,
      };
    };

    return {
      measure: () => {
        /*
         * Fit the window to the screen rather than the screen to the window.
         * The height is the smallest that still clears the track and both
         * graphics bands, the width follows from the container's shape, and
         * the whole thing is anchored to the bottom - so a letterbox screen
         * loses sky and never a lane.
         */
        const el = wrapRef.current;
        const vb = vbRef.current;
        const cw = el?.clientWidth ?? 0;
        const ch = el?.clientHeight ?? 0;
        const aspect = cw > 0 && ch > 0 ? cw / ch : VIEW_W / VIEW_H;

        vb.h = Math.min(VIEW_H, Math.max(FLOOR_H, VIEW_W / aspect));
        vb.w = vb.h * aspect;
        vb.x = (VIEW_W - vb.w) / 2;
        vb.y = VIEW_H - vb.h;
        write();
      },

      start: () => {
        svgRef.current?.classList.add('racing');
        clock.ms = 0;
      },

      reset: () => {
        snapshotRef.current = null;
        courseViewRef.current = false;
        setCourseView(false);
        svgRef.current?.classList.remove('racing', 'photo', 'run-home');
        directorRef.current.reset();
        clock.ms = 0;

        /* Reduced motion holds one wide camera. Runner translation remains
           essential race information; camera travel and parallax do not. */
        const wide = wideCamera();
        cam.x = reduceMotion ? wide.x : 260;
        cam.z = reduceMotion ? wide.z : 0.5;
        write();
        placeAll(() => 0);
        nodesRef.current.forEach((n) => {
          n.g.classList.remove('finished', 'surging', 'fx-up', 'fx-down', 'named', 'retired');
          n.tag.textContent = '';
          n.pos.textContent = '';
        });
        if (clockRef.current) clockRef.current.textContent = '0:00.0';
        if (lapRef.current) lapRef.current.textContent = laps > 1 ? `LAP 1/${laps}` : '';
        if (shotRef.current) shotRef.current.textContent = '';
      },

      paint: (snails: SnailRun[], info: PaintInfo) => {
        snapshotRef.current = { snails, info };
        clock.ms = info.raceTimeMs;
        for (const s of snails) {
          const n = nodesRef.current.get(s.lane);
          const b = bands[s.lane];
          if (!n || !b) continue;

          n.g.classList.toggle(
            'surging',
            !s.done && info.meanRate > 0 && s.rate > info.meanRate * 1.15,
          );
          n.g.classList.toggle('retired', Boolean(s.retired));
          const activeEvent = s.lockedMotion?.events.find((event) => event.targetLanes.includes(s.lane) && info.raceTimeMs >= event.effectAtMs && info.raceTimeMs < event.effectEndMs);
          const up = activeEvent ? activeEvent.consequence === 'advance' : s.effect === 'boost' || s.effect === 'surge';
          const down = s.effect !== null && !up;
          n.g.classList.toggle('fx-up', up);
          n.g.classList.toggle('fx-down', down);

          /*
           * A field event already has a card of its own across the bottom of
           * the screen. Flagging it again on each of the six lanes it hit
           * printed "LETTUCE ON THE TRACK" six times across the picture, which
           * is the same stutter the commentary was fixed for.
           */
          const live = s.effect ? s.events.find((e) => e.kind === s.effect) : undefined;
          const tag = activeEvent ? (activeEvent.targetLanes.length === 1 ? activeEvent.label : '') : live && !live.group ? live.label : '';
          if (n.tag.textContent !== tag) n.tag.textContent = tag;
        }

        for (const s of info.justFinished) {
          nodesRef.current.get(s.lane)?.g.classList.add('finished');
        }

        info.ranked.forEach((s, i) => {
          const n = nodesRef.current.get(s.lane);
          if (!n) return;
          const label = ordinal(i + 1);
          if (n.pos.textContent !== label) n.pos.textContent = label;
          /*
           * In a big field the lanes are thinner than a line of type, so
           * supering all twenty names stacks them three lanes deep. A
           * broadcast names the runners in contention and lets the running
           * order carry the rest, which is what this does.
           */
          if (compact) n.g.classList.toggle('named', i < 3 || s.effect !== null);
        });

        svgRef.current?.classList.toggle('photo', info.photoFinish);
        if (info.finalStraight) svgRef.current?.classList.add('run-home');

        if (clockRef.current) clockRef.current.textContent = clockText(clock.ms);
        if (lapRef.current && laps > 1) {
          const lap = Math.min(laps, Math.floor(info.leadP * laps) + 1);
          const text = `LAP ${lap}/${laps}`;
          if (lapRef.current.textContent !== text) lapRef.current.textContent = text;
        }

        const mapPath = mapPathRef.current;
        const mapLeader = mapLeaderRef.current;
        if (mapPath && mapLeader) {
          const length = mapPath.getTotalLength();
          const point = mapPath.getPointAtLength(length * lapProgress(info.leadP, laps));
          mapLeader.setAttribute('cx', point.x.toFixed(1));
          mapLeader.setAttribute('cy', point.y.toFixed(1));
        }

        /* Where to point. With the camera off, hold the whole race in frame. */
        let targetX: number;
        let targetZ: number;
        let safeFrame = runnerSafeFrame(vbRef.current.x, vbRef.current.w);
        if (chase && !reduceMotion) {
          const framing = directorRef.current.update({
            tMs: clock.ms,
            worldByPosition: info.byPosition.map((s) => s.p * totalWorld),
            finishWorld: totalWorld,
            leadP: info.leadP,
            finalStraight: info.finalStraight,
            photoFinish: info.photoFinish,
            safeLeft: safeFrame.left,
            safeRight: safeFrame.right,
          });
          targetX = framing.camX;
          targetZ = framing.zoom;
          safeFrame = { left: framing.safeLeft, right: framing.safeRight };
          if (shotRef.current && shotRef.current.textContent !== framing.label) {
            shotRef.current.textContent = framing.label;
          }
        } else {
          const wide = wideCamera();
          targetX = wide.x;
          targetZ = wide.z;
          safeFrame = wide.safe;
          if (shotRef.current) shotRef.current.textContent = 'WIDE';
        }

        if (reduceMotion) {
          cam.x = targetX;
          cam.z = targetZ;
        } else {
          cam.x += (targetX - cam.x) * PAN_EASE;
          /* Widen immediately; only a decorative zoom-in is eased. */
          cam.z = targetZ < cam.z ? targetZ : cam.z + (targetZ - cam.z) * ZOOM_EASE;

          /* Pan easing may not temporarily strand the first or last runner.
             Clamp the eased camera to the current unobscured window. */
          const positions = info.byPosition.map((snail) => snail.p * totalWorld);
          if (info.finalStraight) positions.push(totalWorld);
          cam.x = clampCameraX(cam.x, cam.z, positions, safeFrame);
        }
        write();
        // Paint runners and scenery through the same final camera transform.
        const sx = VIEW_W / 2 - cam.x * cam.z;
        const overview = courseViewRef.current;
        const path = overviewPathRef.current;
        const safe = runnerSafeFrame(vbRef.current.x, vbRef.current.w);
        const vb = vbRef.current;
        const portrait = vb.w < vb.h;
        const left = portrait ? vb.x + 24 : safe.left;
        const availableWidth = portrait ? vb.w - 48 : safe.right - safe.left;
        const top = vb.y + (portrait ? 240 : 180);
        const availableHeight = Math.max(100, VIEW_H - top - 150);
        const courseScale = Math.min(availableWidth / 120, availableHeight / 72);
        const ow = 120 * courseScale;
        const oh = 72 * courseScale;
        const ox = left + (availableWidth - ow) / 2;
        const oy = top + (availableHeight - oh) / 2;
        const laneSpacing = Math.min(22, courseScale * 9 / names.length);
        overviewRef.current?.setAttribute('transform', `translate(${ox} ${oy}) scale(${courseScale})`);
        const pathLength = path?.getTotalLength() ?? 0;
        for (const snail of snails) {
          const node = nodesRef.current.get(snail.lane);
          const band = bands[snail.lane];
          if (!node || !band) continue;
          let x = sx + snail.p * totalWorld * cam.z;
          let y = groundY(band) + courseRide(course.id, snail.p) * 10;
          let facing = 1;
          if (overview && path && pathLength > 0) {
            const distance = lapProgress(snail.p, laps) * pathLength;
            const point = path.getPointAtLength(distance);
            const before = path.getPointAtLength(Math.max(0, distance - 0.2));
            const after = path.getPointAtLength(Math.min(pathLength, distance + 0.2));
            const dx = (after.x - before.x) * ow / 120;
            const dy = (after.y - before.y) * oh / 72;
            const magnitude = Math.hypot(dx, dy) || 1;
            const offset = (snail.lane - (names.length - 1) / 2) * laneSpacing;
            x = ox + point.x * ow / 120 - dy / magnitude * offset;
            y = oy + point.y * oh / 72 + dx / magnitude * offset;
            facing = dx < 0 ? -1 : 1;
          }
          node.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          if (momentRef.current?.targetLanes?.[0] === snail.lane) {
            wrapRef.current?.style.setProperty('--surprise-x', `${Math.max(15, Math.min(70, (x - vbRef.current.x) / vbRef.current.w * 100))}%`);
            wrapRef.current?.style.setProperty('--surprise-y', `${Math.max(28, Math.min(76, (y - vbRef.current.y) / vbRef.current.h * 100))}%`);
          }
          const art = node.g.querySelector('.tv-art');
          node.g.querySelector('.tv-course-number')?.setAttribute('transform', `scale(${laneSpacing / 22})`);
          const size = overview ? Math.min(0.42, ow / 1200) : band.scale;
          art?.setAttribute('transform', `scale(${size * facing} ${size})`);
        }
      },
    };
  }, [bands, chase, compact, course.id, laps, names.length, reduceMotion, totalWorld]);

  useEffect(() => {
    setPainter(painter);
    painter.reset();
    return () => setPainter(null);
  }, [painter, setPainter]);

  /*
   * A field event knocks the camera. One short jolt, keyed on the moment id so
   * a second plague replays it, and never in calm mode - it is the one piece
   * of motion here that a sensitive viewer would notice.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !race.moment?.big || reduceMotion) return;
    svg.classList.add('jolt');
    const t = window.setTimeout(() => svg.classList.remove('jolt'), 700);
    return () => {
      window.clearTimeout(t);
      svg.classList.remove('jolt');
    };
  }, [race.moment?.id, race.moment?.big, reduceMotion]);

  /*
   * Cinema mode changes the height of the stage without the window resizing,
   * and that is exactly the moment the frame's shape changes most. Watching
   * the element itself catches it; the window resize handler in the loop
   * never would.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => painter.measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [painter]);

  /*
   * Park the effect flag just clear of the name it sits beside. Guessing the
   * width from the character count put "TURBO SLIME" through the middle of
   * "Nightwatchman"; the text metric is exact, and measuring it once per race
   * costs nothing. Repeated after the webfont lands, because the first read
   * is against the fallback face.
   */
  useEffect(() => {
    const place = () => {
      nodesRef.current.forEach((n) => {
        const name = n.g.querySelector('.tv-name') as SVGTextElement | null;
        if (!name) return;
        let w = 0;
        try {
          w = name.getComputedTextLength();
        } catch {
          w = 0;
        }
        n.tag.setAttribute('x', String(Math.round(w) + 16));
      });
    };
    place();
    document.fonts?.ready.then(place).catch(() => {});
  }, [names]);

  const nodeRef =
    (lane: number) =>
    (g: SVGGElement | null) => {
      if (!g) {
        nodesRef.current.delete(lane);
        return;
      }
      const nodes: RunnerNodes = {
        g,
        tag: g.querySelector('.tv-tag') as SVGTextElement,
        pos: g.querySelector('.tv-pos') as SVGTextElement,
      };
      if (nodes.tag && nodes.pos) nodesRef.current.set(lane, nodes);
    };

  /* Runners are drawn far side first, so a near snail passing one on the far
     side of the track occludes it rather than being drawn underneath. */
  const order = useMemo(
    () => names.map((_, i) => i).sort((a, b) => b - a),
    [names],
  );

  const marks = useMemo(() => {
    const out: number[] = [];
    for (let w = 0; w <= totalWorld + MARK_EVERY; w += MARK_EVERY) out.push(w);
    return out;
  }, [totalWorld]);

  const gantries = useMemo(() => {
    const out: { world: number; label: string; kind: 'start' | 'lap' | 'finish' }[] = [
      { world: 0, label: 'START', kind: 'start' },
    ];
    for (let l = 1; l < laps; l++) {
      out.push({ world: l * LAP_LEN, label: `LAP ${l + 1}`, kind: 'lap' });
    }
    out.push({ world: totalWorld, label: 'FINISH', kind: 'finish' });
    return out;
  }, [laps, totalWorld]);

  const phase = race.phase as string;
  const confirming = phase === 'confirming';
  const running = phase === 'running' || phase === 'countdown' || confirming;

  return (
    <div
      ref={wrapRef}
      className={`track-wrap tv-wrap race-broadcast ${reduceMotion ? 'calm race-motion-reduced' : ''} ${confirming ? 'race-confirming' : ''}`}
      data-surface={surface}
      data-race-phase={phase}
      data-reduced-motion={reduceMotion ? 'true' : 'false'}
      data-weather={race.phase === 'idle' ? 'clear' : race.weather}
      data-course={course.id}
      data-camera={courseView ? 'course' : 'trackside'}
    >
      <svg
        ref={svgRef}
        className={`tv ${compact ? 'compact' : ''} ${confirming ? 'tv-confirming' : ''}`}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Trackside coverage of ${names.length} snails over ${laps} ${laps === 1 ? 'lap' : 'laps'}`}
      >
        <defs>
          <linearGradient id="tv-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0b1220" />
            <stop offset="60%" stopColor="#16233a" />
            <stop offset="100%" stopColor="#2b3550" />
          </linearGradient>

          <linearGradient id="tv-track" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8a3f2c" />
            <stop offset="45%" stopColor="#a04c33" />
            <stop offset="100%" stopColor="#bb5c3d" />
          </linearGradient>

          <linearGradient id="tv-verge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1c4a2c" />
            <stop offset="100%" stopColor="#2a6b3d" />
          </linearGradient>

          <linearGradient id="tv-fore" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#123222" />
            <stop offset="100%" stopColor="#08160f" />
          </linearGradient>

          <linearGradient id="tv-stand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b2231" />
            <stop offset="100%" stopColor="#2c3547" />
          </linearGradient>

          {/* The whole frame is darker at the edges, the way a lit stadium is. */}
          <radialGradient id="tv-vig" cx="50%" cy="52%">
            <stop offset="58%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.4" />
          </radialGradient>

          <filter id="tv-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>

          {/* One bay of grandstand, repeated along the far side. */}
          <g id="tv-bay">
            <path
              d={`M0 ${HORIZON} L28 ${HORIZON - 128} L${TILE_STAND - 28} ${HORIZON - 128} L${TILE_STAND} ${HORIZON} Z`}
              fill="url(#tv-stand)"
            />
            {scatter(9001, 96).map((r, i) => {
              const row = i % 8;
              const col = Math.floor(i / 8);
              return (
                <circle
                  key={i}
                  className="tv-fan"
                  cx={34 + col * 28 + r * 16}
                  cy={HORIZON - 116 + row * 14 + r * 4}
                  r={3.4}
                  style={{ opacity: 0.3 + r * 0.6 }}
                />
              );
            })}
            <rect x={0} y={HORIZON - 138} width={TILE_STAND} height={12} fill="#151b27" />
            <rect x={0} y={HORIZON - 138} width={TILE_STAND} height={3} fill="#fff" opacity="0.12" />
            {/* Floodlight on a mast above the stand. */}
            <rect x={TILE_STAND / 2 - 3} y={HORIZON - 210} width={6} height={74} fill="#1a202c" />
            <rect x={TILE_STAND / 2 - 30} y={HORIZON - 232} width={60} height={24} rx={4} fill="#2b3344" />
            <ellipse
              className="tv-flood"
              cx={TILE_STAND / 2}
              cy={HORIZON - 220}
              rx={54}
              ry={22}
              fill="#ffeec2"
              opacity="0.2"
            />
          </g>

          {/* One advertising board, repeated. */}
          <g id="tv-board">
            <rect x={6} y={HOARD_TOP} width={TILE_HOARD - 12} height={HOARD_H} rx={4} className="tv-hoard" />
            {/* Trimmed to what fits one board. A club name longer than the
                hoarding used to run into the next one along. */}
            <text
              className="tv-hoard-text"
              x={TILE_HOARD / 2}
              y={HOARD_TOP + HOARD_H * 0.64}
              textAnchor="middle"
              textLength={TILE_HOARD - 60}
              lengthAdjust="spacingAndGlyphs"
            >
              {clubName.toUpperCase().slice(0, 34)}
            </text>
          </g>

          {/* Grass at the camera's feet, out of focus. */}
          <g id="tv-tuft">
            {scatter(4242, 10).map((r, i) => (
              <ellipse
                key={i}
                cx={i * 30 + r * 18}
                cy={TRACK_BOTTOM + 34 + r * 30}
                rx={22 + r * 20}
                ry={9 + r * 7}
                fill="#0d2417"
                opacity={0.75}
              />
            ))}
          </g>
        </defs>

        {/* Sky, then the stand, then the boards: three depths of parallax. */}
        <rect x={-BLEED} y={-200} width={VIEW_W + BLEED * 2} height={HORIZON + 200} fill="url(#tv-sky)" />

        <g ref={standRef} className="tv-layer" aria-hidden="true">
          {Array.from(
            { length: Math.ceil((VIEW_W + BLEED * 2) / TILE_STAND) + 2 },
            (_, i) => (
              <use
                key={i}
                href="#tv-bay"
                x={(i - Math.ceil(BLEED / TILE_STAND) - 1) * TILE_STAND}
              />
            ),
          )}
        </g>

        <g ref={hoardRef} className="tv-layer" aria-hidden="true">
          {Array.from(
            { length: Math.ceil((VIEW_W + BLEED * 2) / TILE_HOARD) + 2 },
            (_, i) => (
              <use
                key={i}
                href="#tv-board"
                x={(i - Math.ceil(BLEED / TILE_HOARD) - 1) * TILE_HOARD}
              />
            ),
          )}
        </g>

        {/* Grass between the boards and the outside lane. */}
        <rect x={-BLEED} y={VERGE_TOP} width={VIEW_W + BLEED * 2} height={TRACK_TOP - VERGE_TOP} fill="url(#tv-verge)" />

        {/* The racing surface and its lanes. Static: the track does not move,
            the marks painted on it do. */}
        <rect x={-BLEED} y={TRACK_TOP} width={VIEW_W + BLEED * 2} height={TRACK_BOTTOM - TRACK_TOP} fill="url(#tv-track)" />

        <g className="tv-lanes" aria-hidden="true">
          {bands.map((b) => (
            <g key={b.lane}>
              <rect
                x={-BLEED}
                y={b.y - b.h / 2}
                width={VIEW_W + BLEED * 2}
                height={b.h}
                fill="#000"
                opacity={b.lane % 2 ? 0.07 : 0}
              />
              <line
                className="tv-lane-line"
                x1={-BLEED}
                y1={b.y - b.h / 2}
                x2={VIEW_W + BLEED}
                y2={b.y - b.h / 2}
                strokeWidth={Math.max(1.4, 3 - b.depth * 1.4)}
              />
            </g>
          ))}
          <line className="tv-lane-line kerb" x1={-BLEED} y1={TRACK_BOTTOM} x2={VIEW_W + BLEED} y2={TRACK_BOTTOM} />
        </g>

        {/* The authored oval is the visual source of truth. The geometry and
            finish gantries remain code-native above it, so fairness and
            projector scaling are unchanged. */}
        <image
          className="tv-art-background"
          href={`${ART_BASE}/snail-race-oval.webp`}
          x={0}
          y={0}
          width={VIEW_W}
          height={VIEW_H}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        />

        <g className={`tv-course-features tv-course-features-${course.id}`} aria-hidden="true">
          {course.id === 'boundary-oval' ? (
            <>
              <path className="tv-boundary-rope" d={`M-40 ${VERGE_TOP + 14} Q ${VIEW_W / 2} ${VERGE_TOP - 8} ${VIEW_W + 40} ${VERGE_TOP + 14}`} />
              {[140, 510, 880, 1250, 1620].map((x) => <path key={x} className="tv-boundary-flag" d={`M${x} ${VERGE_TOP + 10} v-54 l28 10 -28 11`} />)}
            </>
          ) : null}
          {course.id === 'pavilion-chicane' ? (
            <>
              {[260, 450, 640, 830, 1020, 1210].map((x, i) => (
                <path key={x} className="tv-chicane-chevron" d={`M${x} ${VERGE_TOP - 36} l${i % 2 ? -34 : 34} 24 l${i % 2 ? 34 : -34} 24`} />
              ))}
              <text className="tv-course-feature-label" x={VIEW_W / 2} y={VERGE_TOP - 46} textAnchor="middle">PAVILION CHICANE</text>
            </>
          ) : null}
          {course.id === 'floodlight-eight' ? (
            <>
              <path className="tv-crossover" d={`M${VIEW_W * 0.35} ${TRACK_TOP + 20} L${VIEW_W * 0.65} ${TRACK_BOTTOM - 20} M${VIEW_W * 0.65} ${TRACK_TOP + 20} L${VIEW_W * 0.35} ${TRACK_BOTTOM - 20}`} />
              <text className="tv-course-feature-label" x={VIEW_W / 2} y={VERGE_TOP - 46} textAnchor="middle">FLOODLIGHT CROSSOVER</text>
            </>
          ) : null}
          {course.id === 'practice-nets' ? (
            <>
              {[180, 500, 820, 1140, 1460, 1780].map((x) => <path key={x} className="tv-net-post" d={`M${x} ${VERGE_TOP - 110} V${TRACK_BOTTOM}`} />)}
              <path className="tv-net-mesh" d={`M180 ${VERGE_TOP - 100} H1780 M180 ${VERGE_TOP - 62} H1780 M180 ${VERGE_TOP - 24} H1780`} />
              <text className="tv-course-feature-label" x={VIEW_W / 2} y={VERGE_TOP - 120} textAnchor="middle">PRACTICE NETS SWITCHBACK</text>
            </>
          ) : null}
        </g>

        {/* Cross marks painted on the surface. These are the speed. */}
        <g ref={marksRef} className="tv-marks" aria-hidden="true">
          {marks.map((w, i) => (
            <line
              key={w}
              x1={w}
              y1={TRACK_TOP}
              x2={w}
              y2={TRACK_BOTTOM}
              vectorEffect="non-scaling-stroke"
              strokeWidth={i % 5 === 0 ? 3 : 1.4}
              opacity={i % 5 === 0 ? 0.3 : 0.13}
              stroke="#fff"
            />
          ))}
        </g>

        {/* Start, lap and finish gantries: placed individually so their type
            and chequers are never squashed by the horizontal zoom. */}
        <g ref={propsRef} className="tv-props" aria-hidden="true">
          {gantries.map((g) => (
            <g key={`${g.kind}-${g.world}`} data-world={g.world} className={`tv-gantry tv-${g.kind}`}>
              <rect x={-4} y={TRACK_TOP} width={8} height={TRACK_BOTTOM - TRACK_TOP} fill="#f4f5f8" opacity="0.9" />
              {/* A chequer needs both columns on every row: one column of
                  alternating squares reads as a dashed line, not a flag. */}
              {g.kind === 'finish'
                ? Array.from({ length: 22 }, (_, i) =>
                    [0, 1].map((col) => (
                      <rect
                        key={`${i}-${col}`}
                        x={col ? 4 : -13}
                        y={TRACK_TOP + i * ((TRACK_BOTTOM - TRACK_TOP) / 22)}
                        width={9}
                        height={(TRACK_BOTTOM - TRACK_TOP) / 22}
                        fill={(i + col) % 2 ? '#12141a' : '#f4f5f8'}
                      />
                    )),
                  )
                : null}
              <rect x={-6} y={VERGE_TOP - 74} width={12} height={78} fill="#2a3242" />
              <rect x={-92} y={VERGE_TOP - 108} width={184} height={40} rx={6} className="tv-gantry-plate" />
              <text className="tv-gantry-text" x={0} y={VERGE_TOP - 80} textAnchor="middle">
                {g.label}
              </text>
            </g>
          ))}
        </g>

        <g className="tv-course-overview" aria-hidden="true">
          <rect x={-BLEED} y={0} width={VIEW_W + BLEED * 2} height={VIEW_H} fill="#123c30" />
          <g ref={overviewRef}>
            <path d={course.mapPath} fill="none" stroke="#f4e5bf" strokeWidth="13" strokeLinejoin="round" strokeLinecap="round" />
            <path ref={overviewPathRef} d={course.mapPath} fill="none" stroke="#b77948" strokeWidth="11" strokeLinejoin="round" strokeLinecap="round" />
            <path d={course.mapPath} fill="none" stroke="#ead29c" strokeWidth="0.4" strokeDasharray="2 2" />
          </g>
        </g>

        {/* The runners. */}
        <g className="tv-runners">
          {order.map((lane) => {
            const c = laneColour(lane);
            const b = bands[lane];
            const s = b?.scale ?? 1;
            return (
              <g
                key={lane}
                ref={nodeRef(lane)}
                className="tv-runner"
                style={
                  {
                    '--shell': c.shell,
                    '--shell-dk': c.dark,
                    '--body': c.body,
                    '--glow': c.glow,
                    '--runner-hue': `${runnerHueRotation(lane)}deg`,
                  } as React.CSSProperties
                }
              >
                {/* Art scales with the lane's distance from the camera; the
                    labels do not, so a far-side name is as readable as a near
                    one. */}
                <g className="tv-art" transform={`scale(${s.toFixed(3)})`}>
                  <ellipse className="tv-shadow" cx={0} cy={3} rx={36} ry={7} />
                  <path className="tv-slime" d="M-30 0 H-104" />
                  <image
                    className="tv-snail-sprite"
                    href={runnerArtForLane(lane).src}
                    x={-74}
                    y={-84}
                    width={148}
                    height={92}
                    preserveAspectRatio="xMidYMax meet"
                  />
                </g>

                <g className="tv-course-number" aria-hidden="true">
                  <circle cx="0" cy="0" r="10" fill={c.dark} stroke="#fff" strokeWidth="1.5" />
                  <text x="0" y="4" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{lane + 1}</text>
                </g>
                {/* Name super. Lanes are separated vertically, so two runners
                    level with each other can never print over one another. */}
                <g className="tv-super" transform={`translate(${(76 * s + 8).toFixed(1)} ${(-24 * s).toFixed(1)})`}>
                  <text className="tv-pos num" x={-8} y={0} textAnchor="end" />
                  <text className="tv-name" x={0} y={0} textAnchor="start">
                    {names[lane]}
                  </text>
                  {/* On the same line as the name rather than above it: a
                      second line of type is tall enough to land in the lane
                      behind, where it reads as that snail's label. */}
                  <text
                    className="tv-tag"
                    x={Math.round(names[lane].length * 10.6) + 16}
                    y={0}
                    textAnchor="start"
                  />
                </g>
              </g>
            );
          })}
        </g>

        {/* Out-of-focus grass across the bottom of frame, the near bank. */}
        <rect x={-BLEED} y={TRACK_BOTTOM} width={VIEW_W + BLEED * 2} height={VIEW_H - TRACK_BOTTOM + 200} fill="url(#tv-fore)" />
        <g ref={foreRef} className="tv-layer" filter="url(#tv-blur)" aria-hidden="true">
          {Array.from(
            { length: Math.ceil((VIEW_W + BLEED * 2) / TILE_FORE) + 2 },
            (_, i) => (
              <use
                key={i}
                href="#tv-tuft"
                x={(i - Math.ceil(BLEED / TILE_FORE) - 1) * TILE_FORE}
              />
            ),
          )}
        </g>

        <rect x={-BLEED} y={-200} width={VIEW_W + BLEED * 2} height={VIEW_H + 400} fill="url(#tv-vig)" pointerEvents="none" />
      </svg>

      {race.weather !== 'clear' && race.phase !== 'idle' ? (
        <div className="tv-rain" aria-hidden="true" />
      ) : null}

      {/* ── Broadcast graphics ──────────────────────────────────────────── */}

      <button type="button" className="race-camera-toggle" aria-pressed={courseView} disabled={phase === 'idle' || phase === 'countdown'}
        onClick={() => {
          courseViewRef.current = !courseViewRef.current;
          setCourseView(courseViewRef.current);
          const snapshot = snapshotRef.current;
          if (snapshot) painter.paint(snapshot.snails, snapshot.info);
        }}>
        {courseView ? 'Trackside view' : 'Full course view'}
      </button>
      <aside className="race-course-map" aria-label={`${course.name} course map`}>
        <span>COURSE</span>
        <strong>{course.name}</strong>
        <svg viewBox="0 0 120 72" role="img" aria-label={`${course.name}: ${course.description}`}>
          <path className="course-map-shadow" d={course.mapPath} />
          <path ref={mapPathRef} className="course-map-line" d={course.mapPath} style={{ stroke: course.accent }} />
          <circle ref={mapLeaderRef} className="course-map-leader" cx="18" cy="36" r="5" />
        </svg>
      </aside>

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
        raceNo={raceNo}
        courseName={course.name}
        replay={replay}
        confirming={confirming}
        running={running}
        clockRef={clockRef}
        lapRef={lapRef}
        shotRef={shotRef}
      />

      {race.countdown ? (
        <div className="countdown" aria-hidden="true">
          <span key={race.countdown}>{race.countdown}</span>
        </div>
      ) : null}

      <SurpriseLayer race={race} names={names} />

      {race.photoFinish && race.phase === 'running' ? (
        <p className="photo-banner">PHOTO FINISH</p>
      ) : null}
    </div>
  );
}
