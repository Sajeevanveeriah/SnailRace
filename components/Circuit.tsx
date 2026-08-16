'use client';

import { useEffect, useMemo, useRef } from 'react';
import { laneColour, type StageThemeId } from '@/lib/palette';
import { ordinal, type SnailRun } from '@/lib/race-engine';
import {
  COURSE_H,
  COURSE_W,
  courseById,
  lapPosition,
  laneOffset,
  pointAt,
  sampleCourse,
  spacingFor,
  type SampledCourse,
} from '@/lib/course';
import { CameraDirector } from '@/lib/camera';
import { hexToSeed } from '@/lib/race-engine';
import type { PaintInfo, RaceController, RacePainter } from '@/lib/use-race';

/**
 * The circuit: the field runs laps of a closed course.
 *
 * This is the other implementation of `RacePainter`. It is handed exactly the
 * same `p` per snail as the straight track and only differs in where it puts
 * it - `p` becomes a distance around the loop instead of an x offset - so the
 * fairness argument in `race-engine.ts` covers this renderer unchanged.
 *
 * Two things make it worth the extra code over lanes:
 *   - Laps. A three-lap race is three times the race for the same lap length,
 *     and the lap counter gives the room a second thing to follow.
 *   - The camera. The frame is not fixed: it tracks the field, closing in when
 *     the pack is tight and pulling back when it strings out, which is what
 *     makes a two-minute race watchable.
 *
 * Everything is written straight to SVG attributes from the paint callback.
 * Twenty snails through React state at sixty frames a second would be twelve
 * hundred renders a second for numbers nothing reads.
 */

interface Props {
  names: string[];
  race: RaceController;
  surface: StageThemeId;
  courseId: string;
  laps: number;
  /** Let the director cut between shots, or hold the whole course in frame. */
  chase: boolean;
  calm: boolean;
}

/**
 * Per-frame approach rates.
 *
 * A cut is instant. Easing 55% of the way and settling over the next few
 * frames was neither a cut nor a move - it lurched, and with a flash frame
 * over the top it read as a flicker. A real cut is just the next frame from
 * a different camera, so that is what this does. Within a shot the camera
 * drifts slowly, which is what makes it feel operated rather than mechanical.
 */
const CAM_EASE = 0.055;
const CAM_CUT_EASE = 1;

interface SnailNodes {
  g: SVGGElement;
  body: SVGGElement;
  chip: SVGTextElement;
  fx: SVGTextElement;
}

export function Circuit({ names, race, surface, courseId, laps, chase, calm }: Props) {
  const { setPainter } = race;
  const def = useMemo(() => courseById(courseId), [courseId]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<Map<number, SnailNodes>>(new Map());
  const courseRef = useRef<SampledCourse | null>(null);
  const camRef = useRef({ x: 0, y: 0, w: COURSE_W, h: COURSE_H });
  const lapRef = useRef<HTMLSpanElement | null>(null);
  const camLabelRef = useRef<HTMLSpanElement | null>(null);
  const directorRef = useRef(new CameraDirector(1));
  /** Course-space position of the start/finish line, for the finish shot. */
  const finishRef = useRef<{ x: number; y: number } | null>(null);
  /*
   * Per-frame mutable state lives in refs rather than in the painter closure:
   * a value reassigned inside a memo would be reset every time the memo is
   * rebuilt, which happens whenever the field size or lap count changes.
   */
  const camTargetRef = useRef({ x: 0, y: 0, w: COURSE_W, h: COURSE_H });
  const pointsRef = useRef(new Map<number, { x: number; y: number }>());
  const clockRef = useRef({ ms: 0, cutEase: 0 });

  /*
   * Sampling walks the path 1400 times through the SVG geometry API, which is
   * a layout read per step. Doing it once per course rather than per frame is
   * the difference between a smooth race and a slideshow.
   */
  /*
   * Re-seed the director whenever a race is drawn, so the shot sequence is
   * reproducible from the same seed as the race itself. Keyed on the seed
   * rather than done in `reset`, which runs before the new seed is published.
   */
  useEffect(() => {
    if (race.seedHex) directorRef.current.reset(hexToSeed(race.seedHex) ?? 1);
  }, [race.seedHex]);

  useEffect(() => {
    const sampled = sampleCourse(def);
    courseRef.current = sampled;
    const line = pointAt(sampled, 0);
    finishRef.current = { x: line.x, y: line.y };
  }, [def]);

  const spacing = spacingFor(names.length);
  /*
   * Past a dozen runners a name is wider than the gap between two lanes, so
   * the field is labelled by number and the tote board carries the names.
   */
  const compact = names.length > 12;

  const painter = useMemo<RacePainter>(() => {
    const camTarget = camTargetRef.current;
    const points = pointsRef.current;
    const clock = clockRef.current;

    const wholeCourse = () => {
      camTarget.x = 0;
      camTarget.y = 0;
      camTarget.w = COURSE_W;
      camTarget.h = COURSE_H;
    };

    /*
     * A cut is a near-instant reframe, then the ease relaxes back to a drift
     * over the following frames. Interpolating a cut at the drift rate turns
     * every one of them into a slow zoom, which looks like a mistake.
     */
    const applyCam = (immediate: boolean) => {
      const cam = camRef.current;
      const k = immediate ? 1 : Math.max(CAM_EASE, clock.cutEase);
      /* One frame at full rate, then straight back to the drift. */
      clock.cutEase = 0;
      cam.x += (camTarget.x - cam.x) * k;
      cam.y += (camTarget.y - cam.y) * k;
      cam.w += (camTarget.w - cam.w) * k;
      cam.h += (camTarget.h - cam.h) * k;
      const svg = svgRef.current;
      if (!svg) return;
      svg.setAttribute(
        'viewBox',
        `${cam.x.toFixed(1)} ${cam.y.toFixed(1)} ${cam.w.toFixed(1)} ${cam.h.toFixed(1)}`,
      );
      /*
       * Type is drawn in course units, so a tight shot would blow a name up
       * to fill the screen. Publishing the zoom lets the labels counter-scale
       * and stay the same size on the projector at every focal length, which
       * is how a real broadcast's name supers behave.
       */
      svg.style.setProperty('--cam-k', (cam.w / COURSE_W).toFixed(4));
    };

    return {
      measure: () => {
        /* Nothing to read: the SVG is authored in course units and scales
           itself, so a resize costs no recalculation here. */
      },

      start: () => {
        svgRef.current?.classList.add('racing');
      },

      reset: () => {
        svgRef.current?.classList.remove('racing', 'photo', 'final-straight');
        wholeCourse();
        applyCam(true);
        clock.ms = 0;
        clock.cutEase = 0;
        points.clear();
        directorRef.current.reset();
        if (lapRef.current) lapRef.current.textContent = '';
        if (camLabelRef.current) camLabelRef.current.textContent = '';
        const course = courseRef.current;
        nodesRef.current.forEach((n, lane) => {
          n.g.classList.remove('finished', 'surging', 'fx-up', 'fx-down', 'pos-1', 'pos-2', 'pos-3');
          n.chip.textContent = '';
          n.fx.textContent = '';
          if (course) {
            const at = pointAt(course, 0);
            const off = laneOffset(lane, names.length, spacing);
            n.g.setAttribute(
              'transform',
              `translate(${(at.x + at.nx * off).toFixed(1)} ${(at.y + at.ny * off).toFixed(1)})`,
            );
            n.body.setAttribute('transform', `rotate(${at.angle.toFixed(1)})`);
          }
        });
      },

      paint: (snails: SnailRun[], info: PaintInfo) => {
        const course = courseRef.current;
        if (!course) return;

        /* The loop drives frames, so its cadence is the clock the director
           cuts on. Roughly a frame at sixty per second. */
        clock.ms += 16.7;
        let cutTo: number | null = null;

        for (const s of snails) {
          const n = nodesRef.current.get(s.lane);
          if (!n) continue;

          const { u } = lapPosition(s.p, laps);
          const at = pointAt(course, u);
          const off = laneOffset(s.lane, names.length, spacing);
          const x = at.x + at.nx * off;
          const y = at.y + at.ny * off;

          n.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          /*
           * The body rotates to face along the course; the label group does
           * not, so a name stays horizontal and readable even where the snail
           * is running upside down round the far side of the loop.
           */
          n.body.setAttribute('transform', `rotate(${at.angle.toFixed(1)})`);
          points.set(s.lane, { x, y });

          n.g.classList.toggle(
            'surging',
            !s.done && info.meanRate > 0 && s.rate > info.meanRate * 1.15,
          );
          const up = s.effect === 'boost' || s.effect === 'surge';
          const down = s.effect !== null && !up;
          const had = n.g.classList.contains('fx-up') || n.g.classList.contains('fx-down');
          n.g.classList.toggle('fx-up', up);
          n.g.classList.toggle('fx-down', down);
          /* A surprise starting is a reason to cut. One that is already
             running is not, or the camera would sit on it for its whole span. */
          if ((up || down) && !had) cutTo = s.lane;

          const tag = s.effect ? (s.events.find((e) => e.kind === s.effect)?.label ?? '') : '';
          if (n.fx.textContent !== tag) n.fx.textContent = tag;
        }

        for (const s of info.justFinished) {
          const n = nodesRef.current.get(s.lane);
          if (!n) continue;
          n.g.classList.add('finished');
          n.g.classList.remove('surging');
          if (s.place <= 3) n.g.classList.add(`pos-${s.place}`);
        }

        info.ranked.forEach((s, i) => {
          const n = nodesRef.current.get(s.lane);
          const label = ordinal(i + 1);
          if (n && n.chip.textContent !== label) n.chip.textContent = label;
        });

        svgRef.current?.classList.toggle('photo', info.photoFinish);
        if (info.finalStraight) svgRef.current?.classList.add('final-straight');

        const leader = info.byPosition[0];
        if (lapRef.current && leader) {
          const { lap } = lapPosition(leader.p, laps);
          const text = `Lap ${Math.min(lap, laps)} of ${laps}`;
          if (lapRef.current.textContent !== text) lapRef.current.textContent = text;
        }

        /*
         * Hand the frame to the director, which cuts between shots the way a
         * race broadcast does. With the director off the whole course is held
         * in frame, which is what a moderator wants when the room is small
         * enough to read it all at once.
         */
        if (chase) {
          const framing = directorRef.current.update({
            tMs: clock.ms,
            points,
            leadLane: info.byPosition[0]?.lane ?? 0,
            chaseLane: info.byPosition[1]?.lane ?? info.byPosition[0]?.lane ?? 0,
            leadP: info.leadP,
            finalStraight: info.finalStraight,
            photoFinish: info.photoFinish,
            finishAt: finishRef.current,
            minWidth: names.length * spacing + 240,
            cutTo,
          });
          camTarget.x = framing.rect.x;
          camTarget.y = framing.rect.y;
          camTarget.w = framing.rect.w;
          camTarget.h = framing.rect.h;

          if (framing.cut) clock.cutEase = CAM_CUT_EASE;
          if (camLabelRef.current && camLabelRef.current.textContent !== framing.label) {
            camLabelRef.current.textContent = framing.label;
          }
        } else {
          wholeCourse();
          if (camLabelRef.current) camLabelRef.current.textContent = '';
        }
        applyCam(false);
      },
    };
  }, [chase, laps, names.length, spacing]);

  useEffect(() => {
    setPainter(painter);
    painter.reset();
    return () => setPainter(null);
  }, [painter, setPainter]);

  const nodeRef =
    (lane: number) =>
    (g: SVGGElement | null) => {
      if (!g) {
        nodesRef.current.delete(lane);
        return;
      }
      const nodes: SnailNodes = {
        g,
        body: g.querySelector('.c-body') as SVGGElement,
        chip: g.querySelector('.c-chip') as SVGTextElement,
        fx: g.querySelector('.c-fx') as SVGTextElement,
      };
      if (nodes.body && nodes.chip && nodes.fx) {
        nodesRef.current.set(lane, nodes);
      }
    };

  return (
    <div
      className={`track-wrap circuit-wrap ${calm ? 'calm' : ''}`}
      data-surface={surface}
      data-weather={race.phase === 'idle' ? 'clear' : race.weather}
    >
      <svg
        ref={svgRef}
        className="circuit"
        viewBox={`0 0 ${COURSE_W} ${COURSE_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${def.label} circuit, ${laps} ${laps === 1 ? 'lap' : 'laps'}, ${names.length} snails`}
      >
        <defs>
          <radialGradient id="c-pond">
            <stop offset="0%" stopColor="#2f7fbf" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#123f66" stopOpacity="0.75" />
          </radialGradient>
        </defs>

        {/* Scenery first, so the track is always drawn over the top of it. */}
        <g className="c-scenery" aria-hidden="true">
          {def.scenery.map((s, i) => {
            if (s.kind === 'pond') {
              return <ellipse key={i} cx={s.x} cy={s.y} rx={s.r} ry={s.r * 0.62} fill="url(#c-pond)" />;
            }
            if (s.kind === 'grandstand') {
              return (
                <g key={i}>
                  <rect
                    x={s.x - s.r} y={s.y - 34} width={s.r * 2} height={44}
                    rx={8} className="c-stand"
                  />
                  {Array.from({ length: Math.round(s.r / 11) }, (_, k) => (
                    <circle
                      key={k}
                      cx={s.x - s.r + 10 + k * 22}
                      cy={s.y - 20 + (k % 2) * 9}
                      r={4.4}
                      className="c-fan"
                    />
                  ))}
                </g>
              );
            }
            if (s.kind === 'lettuce') {
              return (
                <g key={i} className="c-lettuce">
                  {Array.from({ length: 5 }, (_, k) => (
                    <circle
                      key={k}
                      cx={s.x + Math.cos((k / 5) * 6.283) * s.r * 0.55}
                      cy={s.y + Math.sin((k / 5) * 6.283) * s.r * 0.4}
                      r={s.r * 0.34}
                    />
                  ))}
                </g>
              );
            }
            if (s.kind === 'mud') {
              return <ellipse key={i} cx={s.x} cy={s.y} rx={s.r} ry={s.r * 0.55} className="c-mud" />;
            }
            return (
              <g key={i} className="c-tree">
                <rect x={s.x - 3} y={s.y} width={6} height={s.r * 0.8} rx={2} className="c-trunk" />
                <circle cx={s.x} cy={s.y} r={s.r * 0.62} />
              </g>
            );
          })}
        </g>

        {/* The course: a wide dark bed, a soft verge and a dashed centreline. */}
        <path className="c-verge" d={def.d} strokeWidth={names.length * spacing + 74} />
        <path className="c-bed" d={def.d} strokeWidth={names.length * spacing + 54} />
        <path className="c-centre" d={def.d} strokeWidth={2} />

        <StartLine def={def} width={names.length * spacing + 54} />

        <g className="c-runners">
          {names.map((name, i) => {
            const c = laneColour(i);
            return (
              <g
                key={`${i}-${name}`}
                ref={nodeRef(i)}
                className="c-runner"
                style={
                  {
                    '--shell': c.shell,
                    '--shell-dk': c.dark,
                    '--body': c.body,
                    '--glow': c.glow,
                  } as React.CSSProperties
                }
              >
                <g className="c-body">
                  {/* Small, flat and top-down: a side-on snail reads as lying
                      down once the course turns it through 180 degrees. */}
                  <ellipse className="c-foot" cx={0} cy={0} rx={24} ry={13} />
                  <circle className="c-shell" cx={-5} cy={0} r={12} />
                  {/* A spiral, because at a close-up a plain disc reads as a
                      beetle. It is the one line that says "snail". */}
                  <path
                    className="c-spiral"
                    d="M-5 0 a2.6 2.6 0 1 0 2.4 1.6 a5.6 5.6 0 1 1 -7.4 -3.4 a8.8 8.8 0 1 1 -1.7 12.6"
                  />
                  <path className="c-stalk" d="M17 -5 L23 -12" />
                  <path className="c-stalk" d="M17 5 L23 12" />
                  <circle className="c-eye" cx={24} cy={-13} r={3} />
                  <circle className="c-eye" cx={24} cy={13} r={3} />
                </g>
                {/*
                  Labels are staggered above and below the snail by lane, so
                  two runners side by side never print on top of each other.
                */}
                <text className="c-chip num" x={0} y={i % 2 ? -20 : 30} textAnchor="middle" />
                <text className="c-name" x={0} y={i % 2 ? -33 : 43} textAnchor="middle">
                  {compact ? i + 1 : name}
                </text>
                <text className="c-fx" x={0} y={i % 2 ? -46 : 56} textAnchor="middle" />
              </g>
            );
          })}
        </g>
      </svg>

      {/* Broadcast furniture: which shot is live, and how far in we are. */}
      {race.weather !== 'clear' && race.phase !== 'idle' ? (
        <div className="c-rain" aria-hidden="true" />
      ) : null}

      <span ref={camLabelRef} className="cam-pill" aria-hidden="true" />
      <span ref={lapRef} className="lap-pill num" aria-live="polite" />

      {race.countdown ? (
        <div className="countdown" aria-hidden="true">
          <span key={race.countdown}>{race.countdown}</span>
        </div>
      ) : null}

      {race.moment && race.phase === 'running' ? (
        <p key={race.moment.id} className={`moment moment-${race.moment.tone}`} aria-hidden="true">
          {race.moment.text}
        </p>
      ) : null}

      {race.photoFinish && race.phase === 'running' ? (
        <p className="photo-banner">PHOTO FINISH</p>
      ) : null}
    </div>
  );
}

/** Chequered bar across the track at u = 0, where every lap is counted. */
function StartLine({ def, width }: { def: { d: string }; width: number }) {
  const ref = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', def.d);
    const p = path.getPointAtLength(0);
    const ahead = path.getPointAtLength(Math.min(6, path.getTotalLength()));
    const angle = (Math.atan2(ahead.y - p.y, ahead.x - p.x) * 180) / Math.PI;
    g.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${angle})`);
  }, [def.d]);

  /*
   * Two columns of alternating squares. One column reads as a dotted line
   * rather than as a start line, because the dark squares vanish into the
   * track behind them.
   */
  const rows = Math.max(5, Math.round(width / 13));
  const cell = width / rows;
  return (
    <g ref={ref} className="c-start" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) =>
        [0, 1].map((col) => (
          <rect
            key={`${i}-${col}`}
            x={-cell + col * cell}
            y={-width / 2 + i * cell}
            width={cell}
            height={cell}
            fill={(i + col) % 2 ? '#f5f5f7' : '#1b1e26'}
            opacity={0.95}
          />
        )),
      )}
    </g>
  );
}
