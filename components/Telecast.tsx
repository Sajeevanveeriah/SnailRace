'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { laneColour, type StageThemeId } from '@/lib/palette';
import { ClubBrand } from './brand/ClubBrand';
import {
  runnerArtForLane,
  runnerHueRotation,
} from '@/lib/presentation/runner-art';
import { courseById, type CourseId } from '@/lib/courses';
import { courseGeometry, pointOnLane } from '@/lib/course-geometry';
import { BroadcastHud } from './race-broadcast/BroadcastHud';
import { SurpriseLayer } from './race-broadcast/SurpriseLayer';
import { presentationForMoment } from './race-broadcast/surprise-presentation';
import { PropGlyph } from './race-broadcast/prop-glyphs';
import { useReducedMotion } from './race-broadcast/useReducedMotion';
import { clockText, lapProgress } from '@/lib/broadcast';
import type { SnailRun } from '@/lib/race-engine';
import type { PaintInfo, RaceController, RacePainter } from '@/lib/use-race';
import type { CameraMode, ToteDividend } from '@/lib/types';
import { OfficialResult } from './race-broadcast/BroadcastGraphics';

interface Props {
  names: string[];
  /** Owner per lane, shown beside the name on the running order. */
  owners?: string[];
  race: RaceController;
  surface: StageThemeId;
  laps: number;
  /**
   * Telecast frames the leading pack, the way a horse race is shot; full
   * shows the whole course. The on-screen toggle and the desk both flip it.
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
}

/** How many runners the telecast shot keeps in frame: the leader and three more. */
export const LEAD_PACK = 4;
const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/**
 * The camera layer is drawn at this multiple of the scene and moved with a
 * CSS transform, so the browser slides an already painted picture instead of
 * repainting the whole course every frame. Shots tighter than this go soft.
 */
const CAMERA_RASTER = 2;
/** Seconds for the camera to cover most of the way to a new shot. */
const PAN_EASE_S = 0.35;
const ZOOM_EASE_S = 0.8;
/** Real time between paints; the race clock slows for photo finishes. */
const wallClockMs = () => performance.now();
const setText = (el: Element | null, text: string) => {
  if (el && el.textContent !== text) el.textContent = text;
};
/** Half the side of each runner's own layer, in course units. */
const CHIP = 60;

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
}: Props) {
  const { setPainter } = race;
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = calm || prefersReducedMotion;
  const [localCourseView, setCourseView] = useState(false);
  const courseView = fullCourse ?? (localCourseView || cameraMode === 'full');
  const courseViewRef = useRef(false);
  const outOfShotRef = useRef<HTMLParagraphElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const sceneSizeRef = useRef({ w: 0, h: 0 });
  /** The shot on screen now, eased towards each frame's target. */
  const shotRectRef = useRef<{ x: number; y: number; w: number; h: number; at: number } | null>(null);
  const nodesRef = useRef(new Map<number, SVGGElement>());
  /*
   * Every runner sits in its own small composited layer above the course, so a
   * moving snail is a compositor move: the big course picture is painted once
   * and never repainted under them.
   */
  const chipsRef = useRef(new Map<number, SVGSVGElement>());
  const runnerLayerRef = useRef<HTMLDivElement>(null);
  /** Last transforms written per runner, so an unchanged one is never rewritten. */
  const writtenRef = useRef(new Map<string, string>());
  const propRef = useRef<SVGGElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const lapRef = useRef<HTMLSpanElement>(null);
  const shotRef = useRef<HTMLSpanElement>(null);
  const snapshotRef = useRef<{ snails: SnailRun[]; info: PaintInfo } | null>(
    null,
  );
  const momentRef = useRef(race.moment);
  const aspectRef = useRef(1.67);
  const course = courseById(courseId);
  const geometry = useMemo(
    () => courseGeometry(courseId, names.length),
    [courseId, names.length],
  );
  const spriteScale = Math.min(1, geometry.laneWidth / 36);

  const painter = useMemo<RacePainter>(() => {
    /** Where course units land inside the camera layer: its scale and the letterbox offset. */
    const metrics = () => {
      const { w: sw, h: sh } = sceneSizeRef.current;
      const dw = sw * CAMERA_RASTER,
        dh = sh * CAMERA_RASTER;
      const m = Math.min(dw / 1200, dh / 720) || 1;
      return { m, ox: (dw - 1200 * m) / 2, oy: (dh - 720 * m) / 2 };
    };
    /** Write an attribute only when it changes: an unchanged write still repaints. */
    const write = (el: Element | null | undefined, key: string, attr: string, value: string) => {
      if (!el || writtenRef.current.get(key) === value) return;
      writtenRef.current.set(key, value);
      el.setAttribute(attr, value);
    };
    const place = (lane: number, progress: number) => {
      const point = pointOnLane(
        geometry.lanes[lane],
        lapProgress(progress, laps),
      );
      const node = nodesRef.current.get(lane);
      const chip = chipsRef.current.get(lane);
      if (chip) {
        const { m, ox, oy } = metrics();
        chip.style.transform = `translate3d(${(ox + m * (point.x - CHIP)).toFixed(2)}px, ${(oy + m * (point.y - CHIP)).toFixed(2)}px, 0)`;
      }
      node?.setAttribute('data-progress', String(progress));
      /* Rounded to a tenth of a degree: on a straight the turn stops changing and the layer stops repainting. */
      const angle = Math.round(point.angle * 10) / 10;
      const cos = Math.cos((angle * Math.PI) / 180);
      const sin = Math.sin((angle * Math.PI) / 180);
      write(
        node?.querySelector('.course-runner-number'),
        `n${lane}`,
        'transform',
        `translate(${(-cos * 36 * spriteScale).toFixed(1)} ${(-sin * 36 * spriteScale).toFixed(1)}) scale(${Math.max(0.3, spriteScale)})`,
      );

      // Turn the artwork with the lane tangent; its centre stays on the painted lane.
      write(
        node?.querySelector('.tv-art'),
        `a${lane}`,
        'transform',
        `rotate(${angle + (cos < 0 ? 180 : 0)}) scale(${cos < 0 ? -spriteScale : spriteScale} ${spriteScale})`,
      );
      return point;
    };
    const paint: RacePainter['paint'] = (snails, info) => {
      snapshotRef.current = { snails, info };
      /*
       * Every runner is placed on its lane every frame. The camera then
       * frames only the leading pack: the leader and the next three, like a
       * horse-race telecast that follows the front of the field and lets the
       * tail drop out of shot. A strip under the picture names who is behind
       * the shot, so no owner loses their snail.
       */
      const framed = new Set(info.ranked.slice(0, LEAD_PACK).map((s) => s.lane));
      const positions: { x: number; y: number }[] = [];
      const behind: number[] = [];
      for (const snail of snails) {
        const node = nodesRef.current.get(snail.lane);
        node?.classList.toggle('retired', Boolean(snail.retired));
        node?.classList.toggle(
          'fx-up',
          snail.effect === 'boost' || snail.effect === 'surge',
        );
        const point = place(snail.lane, snail.p);
        if (framed.has(snail.lane) || info.finalStraight) positions.push(point);
        else behind.push(snail.lane);
      }
      if (outOfShotRef.current) {
        const list = courseViewRef.current || info.finalStraight || !behind.length
          ? ''
          : `Behind the shot: ${info.ranked
              .filter((s) => behind.includes(s.lane))
              .map((s) => numberOffset + s.lane + 1)
              .join('  ')}`;
        if (outOfShotRef.current.textContent !== list) outOfShotRef.current.textContent = list;
      }
      for (const snail of info.justFinished)
        nodesRef.current.get(snail.lane)?.classList.add('finished');
      /* Text is only written when it changes: a rewrite every frame relays out the whole page. */
      setText(clockRef.current, clockText(info.raceTimeMs));
      setText(lapRef.current, `LAP ${Math.min(laps, Math.floor(info.leadP * laps) + 1)}/${laps}`);
      setText(shotRef.current, info.finalStraight ? 'FINISH LINE' : courseViewRef.current ? 'FULL COURSE' : 'LEAD PACK');
      const moment = momentRef.current;
      if (moment && propRef.current) {
        const target = snails.find(
          (s) => s.lane === (moment.targetLanes?.[0] ?? info.ranked[0]?.lane),
        );
        if (target) {
          const ahead =
            moment.phase === 'warning'
              ? 0.025
              : moment.phase === 'reveal'
                ? 0.012
                : 0;
          const p = pointOnLane(
            geometry.lanes[target.lane],
            lapProgress(target.p, laps) + ahead,
          );
          propRef.current.setAttribute('transform', `translate(${p.x} ${p.y})`);
          positions.push(p);
        }
      }
      let x = 0,
        y = 0,
        w = 1200,
        h = 720;
      if (
        !reduceMotion &&
        !courseViewRef.current &&
        positions.length
      ) {
        const xs = positions.map((p) => p.x),
          ys = positions.map((p) => p.y);
        w = Math.max(320, Math.max(...xs) - Math.min(...xs) + 140);
        h = Math.max(120, Math.max(...ys) - Math.min(...ys) + 110);
        x = (Math.min(...xs) + Math.max(...xs) - w) / 2;
        y = (Math.min(...ys) + Math.max(...ys) - h) / 2;
      }
      // Fit, never slice. Every runner and prop remains inside the reserved scene.
      const aspect = aspectRef.current;
      if (w / h < aspect) {
        const next = h * aspect;
        x -= (next - w) / 2;
        w = next;
      } else {
        const next = w / aspect;
        y -= (next - h) / 2;
        h = next;
      }
      /*
       * Ease towards the new shot rather than cutting to it. The pack changes
       * shape every time a runner joins or drops out of the leading four, and
       * a camera that follows that frame by frame lurches.
       */
      const now = wallClockMs();
      const prev = shotRectRef.current;
      const settle = !prev || reduceMotion || Math.abs(prev.w / w - 1) > 1.5;
      if (prev && !settle) {
        const dt = Math.min(0.1, Math.max(0, (now - prev.at) / 1000));
        const pan = 1 - Math.exp(-dt / PAN_EASE_S);
        const zoom = 1 - Math.exp(-dt / ZOOM_EASE_S);
        const cx = prev.x + prev.w / 2 + (x + w / 2 - prev.x - prev.w / 2) * pan;
        const cy = prev.y + prev.h / 2 + (y + h / 2 - prev.y - prev.h / 2) * pan;
        const nw = prev.w + (w - prev.w) * zoom;
        const nh = nw / aspect;
        x = cx - nw / 2;
        y = cy - nh / 2;
        w = nw;
        h = nh;
      }
      shotRectRef.current = { x, y, w, h, at: now };
      frame(x, y, w);
    };
    /* Place the painted world so the shot (x, y, w) fills the scene. */
    const frame = (x: number, y: number, w: number) => {
      const camera = cameraRef.current;
      const { w: sw, h: sh } = sceneSizeRef.current;
      if (!camera || !sw || !sh) return;
      const dw = sw * CAMERA_RASTER,
        dh = sh * CAMERA_RASTER;
      const m = Math.min(dw / 1200, dh / 720);
      const ox = (dw - 1200 * m) / 2,
        oy = (dh - 720 * m) / 2;
      const s = sw / w / m;
      camera.style.transform = `translate3d(${(-s * (ox + m * x)).toFixed(2)}px, ${(-s * (oy + m * y)).toFixed(2)}px, 0) scale(${s.toFixed(5)})`;
    };
    const frameWhole = () => {
      const aspect = aspectRef.current;
      let w = 1200,
        h = 720,
        x = 0,
        y = 0;
      if (w / h < aspect) {
        w = h * aspect;
        x = (1200 - w) / 2;
      } else {
        h = w / aspect;
        y = (720 - h) / 2;
      }
      frame(x, y, w);
    };
    return {
      measure: () => {
        const scene = sceneRef.current;
        if (scene?.clientHeight) {
          aspectRef.current = scene.clientWidth / scene.clientHeight;
          sceneSizeRef.current = { w: scene.clientWidth, h: scene.clientHeight };
          runnerLayerRef.current?.style.setProperty('--chip', `${(2 * CHIP * metrics().m).toFixed(2)}px`);
        }
        shotRectRef.current = null;
        const snapshot = snapshotRef.current;
        if (snapshot) paint(snapshot.snails, snapshot.info);
        else {
          frameWhole();
          nodesRef.current.forEach((node, lane) => place(lane, Number(node.getAttribute('data-progress') ?? 0)));
        }
      },
      start: () => {
        svgRef.current?.classList.add('racing');
        runnerLayerRef.current?.classList.add('racing');
      },
      reset: () => {
        snapshotRef.current = null;
        svgRef.current?.classList.remove('racing');
        runnerLayerRef.current?.classList.remove('racing');
        shotRectRef.current = null;
        writtenRef.current.clear();
        frameWhole();
        nodesRef.current.forEach((node, lane) => {
          place(lane, 0);
          node.classList.remove('finished', 'retired', 'fx-up');
        });
        if (clockRef.current) clockRef.current.textContent = '0:00.0';
        if (lapRef.current) lapRef.current.textContent = `LAP 1/${laps}`;
      },
      paint,
    };
  }, [geometry, laps, reduceMotion, spriteScale, numberOffset]);

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
  const finishA = pointOnLane(geometry.boundaries[0], 0);
  const finishB = pointOnLane(
    geometry.boundaries[geometry.boundaries.length - 1],
    0,
  );
  return (
    <div
      className={`track-wrap tv-wrap race-broadcast course-broadcast ${reduceMotion ? 'calm race-motion-reduced' : ''}`}
      data-surface={surface}
      data-race-phase={phase}
      data-reduced-motion={String(reduceMotion)}
      data-weather={race.weather}
      data-course={courseId}
      data-camera={courseView ? 'course' : 'trackside'}
    >
      <div className="course-scene" ref={sceneRef}>
        <div className="course-camera" ref={cameraRef}>
        <svg
          ref={svgRef}
          className="tv"
          viewBox="0 0 1200 720"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${course.name}: ${names.length} snails racing in marked lanes over ${laps} ${laps === 1 ? 'lap' : 'laps'}`}
        >
          <defs>
            <pattern
              id="course-grass"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <rect width="80" height="80" fill="#245b46" />
              <rect width="40" height="80" fill="#28644c" />
            </pattern>
            <pattern
              id="course-chequers"
              width="12"
              height="12"
              patternUnits="userSpaceOnUse"
            >
              <rect width="12" height="12" fill="#fff9ed" />
              <path d="M0 0H6V6H0ZM6 6H12V12H6Z" fill="#24171b" />
            </pattern>
          </defs>
          <rect
            className="tv-art-background"
            x="0"
            y="0"
            width="1200"
            height="720"
            fill="url(#course-grass)"
          />
          <g className="course-world">
            <rect
              x="515"
              y="290"
              width="170"
              height="140"
              rx="12"
              fill="#bfae78"
              opacity=".35"
            />
            <path
              d="M540 310H660M540 410H660M550 300V320M650 300V320M550 400V420M650 400V420"
              stroke="#fff9ed"
              strokeWidth="3"
              opacity=".5"
            />
            <text
              className="course-club-mark"
              x="600"
              y="355"
              textAnchor="middle"
            >
              NDCC
            </text>
            <text
              className="course-production-mark"
              x="600"
              y="383"
              textAnchor="middle"
            >
              SNAIL RACE NIGHT
            </text>
            <path
              d={geometry.centre.path}
              fill="none"
              stroke="#123c2e"
              strokeWidth={geometry.trackWidth + 20}
              strokeLinejoin="round"
            />
            <path
              d={geometry.centre.path}
              fill="none"
              stroke="#dfc391"
              strokeWidth={geometry.trackWidth + 6}
              strokeLinejoin="round"
            />
            {geometry.lanes.map((lane, i) => (
              <path
                key={i}
                className="course-lane"
                data-lane={i}
                d={lane.path}
                fill="none"
                stroke={i % 2 ? '#c8a876' : '#d6b785'}
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
                strokeWidth={
                  i === 0 || i === geometry.boundaries.length - 1 ? 2.5 : 1
                }
                opacity=".8"
              />
            ))}
            <path
              d={`M${finishA.x} ${finishA.y}L${finishB.x} ${finishB.y}`}
              stroke="url(#course-chequers)"
              strokeWidth="15"
            />
            <text
              x={finishA.x - 12}
              y={finishA.y - 20}
              fill="#fff9ed"
              fontSize="14"
              fontWeight="900"
            >
              START / FINISH
            </text>
            {moment && presentation ? (
              <g
                ref={propRef}
                className={`course-prop course-prop-${presentation.cue}`}
                data-phase={moment.phase ?? 'effect'}
                aria-hidden="true"
              >
                <ellipse
                  className="course-impact"
                  rx="33"
                  ry="13"
                  fill="none"
                  stroke="#ffe6a5"
                  strokeWidth="3"
                />
                <g className="course-prop-motion">
                  {presentation.art ? (
                    <image
                      className="course-prop-image"
                      href={`${ART_BASE}/surprises/${presentation.art}.png`}
                      x="-32"
                      y="-62"
                      width="64"
                      height="64"
                    />
                  ) : presentation.glyph ? (
                    <g className="course-prop-symbol course-prop-vector" data-glyph={presentation.glyph}>
                      <PropGlyph id={presentation.glyph} />
                    </g>
                  ) : (
                    <text
                      className="course-prop-symbol"
                      y="-12"
                      textAnchor="middle"
                      fontSize="36"
                    >
                      {presentation.symbol}
                    </text>
                  )}
                </g>
              </g>
            ) : null}
          </g>
        </svg>
          <div className="tv-runner-layer tv-runners" ref={runnerLayerRef} aria-hidden="true">
              {names.map((name, lane) => (
                <svg
                  key={lane}
                  className="tv-runner-chip"
                  viewBox={`${-CHIP} ${-CHIP} ${2 * CHIP} ${2 * CHIP}`}
                  ref={(chip) => {
                    if (chip) chipsRef.current.set(lane, chip);
                    else chipsRef.current.delete(lane);
                  }}
                >
                <g
                  ref={(node) => {
                    if (node) nodesRef.current.set(lane, node);
                    else nodesRef.current.delete(lane);
                  }}
                  className="tv-runner"
                  data-lane={lane}
                >
                  <title>
                    {numberOffset + lane + 1}. {name}
                  </title>
                  <g className="tv-art">
                    <ellipse
                      cx="0"
                      cy="0"
                      rx="18"
                      ry="4"
                      fill="#27160f"
                      opacity=".3"
                    />
                    <image
                      className="tv-snail-sprite"
                      href={runnerArtForLane(lane).src}
                      x="-27"
                      y="-17"
                      width="54"
                      height="34"
                      preserveAspectRatio="xMidYMax meet"
                      style={{
                        filter: `hue-rotate(${runnerHueRotation(lane)}deg)`,
                      }}
                    />
                  </g>
                  <g
                    className="course-runner-number"
                    transform={`translate(0 ${-34 * spriteScale}) scale(${Math.max(0.3, spriteScale)})`}
                  >
                    <circle
                      r="9"
                      fill={laneColour(lane).dark}
                      stroke="#fff"
                      strokeWidth="1.3"
                    />
                    <text
                      y="3.5"
                      textAnchor="middle"
                      fill="#fff"
                      fontSize="10"
                      fontWeight="800"
                    >
                      {numberOffset + lane + 1}
                    </text>
                  </g>
                </g>
                </svg>
              ))}
          </div>
        </div>
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
        />
      ) : null}
      <div className="course-director-bar">
        <span>{clubName}</span>
        <p ref={outOfShotRef} className="course-out-of-shot num" aria-live="off" />
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
        owners={owners}
        numberOffset={numberOffset}
        raceNo={raceNo}
        courseName={course.name}
        replay={replay}
        confirming={confirming}
        running={phase === 'running' || phase === 'countdown' || confirming}
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
    </div>
  );
}
