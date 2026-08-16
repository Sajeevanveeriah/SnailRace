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
          {/*
            Everything below exists to stop the course reading as a diagram.
            Flat fills at projector scale look like a wireframe; a surface
            needs a light direction, an edge and some grain before a room
            accepts it as ground.
          */}
          <radialGradient id="c-pond" cx="38%" cy="32%">
            <stop offset="0%" stopColor="#6fc0e8" />
            <stop offset="55%" stopColor="#2f7fbf" />
            <stop offset="100%" stopColor="#0d3652" />
          </radialGradient>

          <linearGradient id="c-grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d4a2b" />
            <stop offset="100%" stopColor="#0e2a19" />
          </linearGradient>

          <linearGradient id="c-dirt" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" stopColor="#6b5540" />
            <stop offset="45%" stopColor="#54412f" />
            <stop offset="100%" stopColor="#3b2d20" />
          </linearGradient>

          <linearGradient id="c-roof" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a4150" />
            <stop offset="100%" stopColor="#232833" />
          </linearGradient>

          <radialGradient id="c-canopy" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#57a86a" />
            <stop offset="100%" stopColor="#24603a" />
          </radialGradient>

          {/* Mown stripes, the thing that makes turf read as turf. */}
          <pattern id="c-mow" width="46" height="46" patternUnits="userSpaceOnUse">
            <rect width="46" height="46" fill="url(#c-grass)" />
            <rect width="23" height="46" fill="#ffffff" opacity="0.028" />
          </pattern>

          {/* Grain on the racing surface, so it is not a flat brown band. */}
          <filter id="c-grain" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.16" />
            </feComponentTransfer>
            <feComposite operator="in" in2="SourceGraphic" />
          </filter>

          <filter id="c-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" />
          </filter>

          {/* A stadium lit from above: bright in the middle, dark at the edges. */}
          <radialGradient id="c-vignette" cx="50%" cy="42%">
            <stop offset="62%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.34" />
          </radialGradient>
        </defs>

        {/* The ground the whole thing sits on. */}
        <rect x={-400} y={-400} width={COURSE_W + 800} height={COURSE_H + 800} fill="url(#c-mow)" />

        {/* Scenery first, so the track is always drawn over the top of it. */}
        <g className="c-scenery" aria-hidden="true">
          {def.scenery.map((s, i) => {
            if (s.kind === 'pond') {
              return <ellipse key={i} cx={s.x} cy={s.y} rx={s.r} ry={s.r * 0.62} fill="url(#c-pond)" />;
            }
            if (s.kind === 'grandstand') {
              /* Tiered seating under a roof, and a crowd with a bit of
                 colour in it. A grey box with dots reads as a car park. */
              const rows = 3;
              const seats = Math.round(s.r / 9);
              return (
                <g key={i}>
                  <rect x={s.x - s.r} y={s.y - 50} width={s.r * 2} height={56} rx={6} className="c-stand" />
                  {Array.from({ length: rows }, (_, r) =>
                    Array.from({ length: seats }, (_, k) => (
                      <circle
                        key={`${r}-${k}`}
                        cx={s.x - s.r + 12 + k * ((s.r * 2 - 24) / Math.max(1, seats - 1))}
                        cy={s.y - 40 + r * 13}
                        r={3.6}
                        className="c-fan"
                        style={{ opacity: 0.35 + ((r * 7 + k * 3) % 5) * 0.13 }}
                      />
                    )),
                  )}
                  <rect x={s.x - s.r - 8} y={s.y - 60} width={s.r * 2 + 16} height={13} rx={5} fill="url(#c-roof)" />
                  <rect x={s.x - s.r - 8} y={s.y - 60} width={s.r * 2 + 16} height={3} rx={2} fill="#ffffff" opacity="0.16" />
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
              return (
                <g key={i}>
                  <ellipse cx={s.x} cy={s.y} rx={s.r} ry={s.r * 0.55} className="c-mud" />
                  <ellipse cx={s.x - s.r * 0.2} cy={s.y - s.r * 0.12} rx={s.r * 0.45} ry={s.r * 0.2}
                           fill="#ffffff" opacity="0.05" />
                </g>
              );
            }
            /* A tree needs a shadow and a lit side or it is a green dot. */
            return (
              <g key={i} className="c-tree">
                <ellipse cx={s.x + 5} cy={s.y + s.r * 0.85} rx={s.r * 0.7} ry={s.r * 0.22}
                         fill="#000" opacity="0.32" />
                <rect x={s.x - 3.5} y={s.y} width={7} height={s.r * 0.85} rx={3} className="c-trunk" />
                <circle cx={s.x} cy={s.y} r={s.r * 0.66} fill="url(#c-canopy)" />
                <circle cx={s.x - s.r * 0.28} cy={s.y - s.r * 0.3} r={s.r * 0.3}
                        fill="#ffffff" opacity="0.09" />
              </g>
            );
          })}
        </g>

        {/*
          The racing surface, built up the way a real one is: a worn verge,
          the dirt itself, a grain pass over it, painted edges and a racing
          line down the middle.
        */}
        <path className="c-verge" d={def.d} strokeWidth={names.length * spacing + 96} />
        <path className="c-bed" d={def.d} strokeWidth={names.length * spacing + 62} />
        <path className="c-grain" d={def.d} strokeWidth={names.length * spacing + 62} filter="url(#c-grain)" />
        <path className="c-edge" d={def.d} strokeWidth={names.length * spacing + 62} />
        <path className="c-edge-in" d={def.d} strokeWidth={names.length * spacing + 24} />
        <path className="c-centre" d={def.d} strokeWidth={2.5} />

        <StartLine def={def} width={names.length * spacing + 62} />

        <rect x={-400} y={-400} width={COURSE_W + 800} height={COURSE_H + 800}
              fill="url(#c-vignette)" pointerEvents="none" />

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
                {/*
                  A snail from above, built in the order light hits it: the
                  slime it is sitting in, a contact shadow, the soft foot, the
                  shell with a spiral and a highlight, then the stalks. Flat
                  shapes were the whole reason this read as a diagram.
                */}
                <g className="c-body">
                  {/* Inside the rotated group, so the trail follows the
                      heading rather than always pointing left. */}
                  <ellipse className="c-slime" cx={-34} cy={0} rx={32} ry={8} />
                  <ellipse className="c-shadow" cx={2} cy={5} rx={26} ry={13} />
                  <ellipse className="c-foot" cx={0} cy={0} rx={25} ry={13} />
                  <ellipse className="c-foot-lit" cx={4} cy={-3} rx={17} ry={6} />
                  <circle className="c-shell" cx={-6} cy={0} r={13.5} />
                  <path
                    className="c-spiral"
                    d="M-6 0 a3 3 0 1 0 2.7 1.8 a6.3 6.3 0 1 1 -8.3 -3.8 a9.9 9.9 0 1 1 -1.9 14.2"
                  />
                  <ellipse className="c-shell-lit" cx={-10} cy={-5} rx={5} ry={3.4} />
                  <g className="c-head">
                    <path className="c-stalk" d="M17 -5 Q22 -10 24 -15" />
                    <path className="c-stalk" d="M17 5 Q22 10 24 15" />
                    <circle className="c-eye" cx={24.5} cy={-15.5} r={3.4} />
                    <circle className="c-eye" cx={24.5} cy={15.5} r={3.4} />
                    <circle className="c-pupil" cx={25.6} cy={-16} r={1.5} />
                    <circle className="c-pupil" cx={25.6} cy={15} r={1.5} />
                  </g>
                </g>
                {/*
                  Labels are staggered above and below the snail by lane, so
                  two runners side by side never print on top of each other.
                */}
                <text className="c-chip num" x={-6} y={i % 2 ? -26 : 40} textAnchor="end" />
                <text className="c-name" x={0} y={i % 2 ? -26 : 40} textAnchor="start">
                  {compact ? i + 1 : name}
                </text>
                <text className="c-fx" x={0} y={i % 2 ? -44 : 58} textAnchor="middle" />
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
