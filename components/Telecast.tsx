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
import { useReducedMotion } from './race-broadcast/useReducedMotion';
import { clockText, lapProgress } from '@/lib/broadcast';
import type { SnailRun } from '@/lib/race-engine';
import type { PaintInfo, RaceController, RacePainter } from '@/lib/use-race';

interface Props {
  names: string[];
  race: RaceController;
  surface: StageThemeId;
  laps: number;
  chase: boolean;
  calm: boolean;
  clubName: string;
  raceNo: number;
  courseId: CourseId;
  replay?: boolean;
}
const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/** A single course world owns the lane paint, runner feet and surprise props.
 * Camera changes only the SVG viewBox; it can never move a snail off its lane.
 */
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
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = calm || prefersReducedMotion;
  const [courseView, setCourseView] = useState(false);
  const courseViewRef = useRef(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef(new Map<number, SVGGElement>());
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
    const place = (lane: number, progress: number) => {
      const point = pointOnLane(
        geometry.lanes[lane],
        lapProgress(progress, laps),
      );
      const node = nodesRef.current.get(lane);
      node?.setAttribute('transform', `translate(${point.x} ${point.y})`);
      node?.setAttribute('data-progress', String(progress));
      node
        ?.querySelector('.course-runner-number')
        ?.setAttribute(
          'transform',
          `translate(${-Math.cos((point.angle * Math.PI) / 180) * 36 * spriteScale} ${-Math.sin((point.angle * Math.PI) / 180) * 36 * spriteScale}) scale(${Math.max(0.3, spriteScale)})`,
        );

      // Turn the artwork with the lane tangent; its centre stays on the painted lane.
      node
        ?.querySelector('.tv-art')
        ?.setAttribute(
          'transform',
          `rotate(${point.angle + (Math.cos((point.angle * Math.PI) / 180) < 0 ? 180 : 0)}) scale(${Math.cos((point.angle * Math.PI) / 180) < 0 ? -spriteScale : spriteScale} ${spriteScale})`,
        );
      return point;
    };
    const paint: RacePainter['paint'] = (snails, info) => {
      snapshotRef.current = { snails, info };
      const positions = snails.map((snail) => {
        const node = nodesRef.current.get(snail.lane);
        node?.classList.toggle('retired', Boolean(snail.retired));
        node?.classList.toggle(
          'fx-up',
          snail.effect === 'boost' || snail.effect === 'surge',
        );
        return place(snail.lane, snail.p);
      });
      for (const snail of info.justFinished)
        nodesRef.current.get(snail.lane)?.classList.add('finished');
      if (clockRef.current)
        clockRef.current.textContent = clockText(info.raceTimeMs);
      if (lapRef.current)
        lapRef.current.textContent = `LAP ${Math.min(laps, Math.floor(info.leadP * laps) + 1)}/${laps}`;
      if (shotRef.current)
        shotRef.current.textContent = info.finalStraight
          ? 'FINISH LINE'
          : courseViewRef.current
            ? 'FULL COURSE'
            : 'FOLLOW FIELD';
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
        chase &&
        !reduceMotion &&
        !courseViewRef.current &&
        positions.length
      ) {
        const xs = positions.map((p) => p.x),
          ys = positions.map((p) => p.y);
        w = Math.max(260, Math.max(...xs) - Math.min(...xs) + 100);
        h = Math.max(100, Math.max(...ys) - Math.min(...ys) + 90);
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
      svgRef.current?.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    };
    return {
      measure: () => {
        const scene = sceneRef.current;
        if (scene?.clientHeight)
          aspectRef.current = scene.clientWidth / scene.clientHeight;
        const snapshot = snapshotRef.current;
        if (snapshot) paint(snapshot.snails, snapshot.info);
      },
      start: () => {
        svgRef.current?.classList.add('racing');
      },
      reset: () => {
        snapshotRef.current = null;
        svgRef.current?.classList.remove('racing');
        svgRef.current?.setAttribute('viewBox', '0 0 1200 720');
        nodesRef.current.forEach((node, lane) => {
          place(lane, 0);
          node.classList.remove('finished', 'retired', 'fx-up');
        });
        if (clockRef.current) clockRef.current.textContent = '0:00.0';
        if (lapRef.current) lapRef.current.textContent = `LAP 1/${laps}`;
      },
      paint,
    };
  }, [geometry, laps, chase, reduceMotion, spriteScale]);

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

  const phase = race.phase as string;
  const confirming = phase === 'confirming';
  const moment = phase === 'running' ? race.moment : null;
  const presentation = presentationForMoment(moment);
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
              RACE NIGHT / SAJ
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
            <g className="tv-runners">
              {names.map((name, lane) => (
                <g
                  key={lane}
                  ref={(node) => {
                    if (node) nodesRef.current.set(lane, node);
                    else nodesRef.current.delete(lane);
                  }}
                  className="tv-runner"
                  data-lane={lane}
                >
                  <title>
                    {lane + 1}. {name}
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
                      {lane + 1}
                    </text>
                  </g>
                </g>
              ))}
            </g>
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
      </div>
      <div className="course-director-bar">
        <span>{clubName} / SAJ RACE NIGHT</span>
        <button
          type="button"
          className="race-camera-toggle"
          aria-pressed={courseView}
          disabled={phase === 'idle' || phase === 'countdown'}
          onClick={() => {
            courseViewRef.current = !courseViewRef.current;
            setCourseView(courseViewRef.current);
            const snapshot = snapshotRef.current;
            if (snapshot) painter.paint(snapshot.snails, snapshot.info);
          }}
        >
          {courseView ? 'Follow field' : 'Full course view'}
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
