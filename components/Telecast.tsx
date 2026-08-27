'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { laneColour, type StageThemeId } from '@/lib/palette';
import { ordinal, type SnailRun } from '@/lib/race-engine';
import {
  BLEED,
  Broadcaster,
  clockText,
  FLOOR_H,
  HOARD_H,
  HOARD_TOP,
  HORIZON,
  LAP_LEN,
  laneBands,
  MARK_EVERY,
  SNAIL_H,
  TRACK_BOTTOM,
  TRACK_TOP,
  VERGE_TOP,
  VIEW_H,
  VIEW_W,
  type LaneBand,
} from '@/lib/broadcast';
import type { BoardRow, PaintInfo, RaceController, RacePainter } from '@/lib/use-race';

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
  replay = false,
}: Props) {
  const { setPainter } = race;

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
  const timeRef = useRef({ ms: 0, last: 0, running: false });

  const bands = useMemo(() => laneBands(names.length), [names.length]);
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
          `translate(${(sx + fn(lane) * cam.z).toFixed(1)} ${groundY(b).toFixed(1)})`,
        );
      });
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
        clock.last = performance.now();
        clock.running = true;
      },

      reset: () => {
        svgRef.current?.classList.remove('racing', 'photo', 'run-home');
        directorRef.current.reset();
        clock.ms = 0;
        clock.running = false;
        /* Open on the gate, wide enough to see the whole field line up. */
        cam.x = 260;
        cam.z = 0.5;
        write();
        placeAll(() => 0);
        nodesRef.current.forEach((n) => {
          n.g.classList.remove('finished', 'surging', 'fx-up', 'fx-down', 'named');
          n.tag.textContent = '';
          n.pos.textContent = '';
        });
        if (clockRef.current) clockRef.current.textContent = '0:00.0';
        if (lapRef.current) lapRef.current.textContent = laps > 1 ? `LAP 1/${laps}` : '';
        if (shotRef.current) shotRef.current.textContent = '';
      },

      paint: (snails: SnailRun[], info: PaintInfo) => {
        const now = performance.now();
        if (clock.running) {
          const dt = Math.min(100, now - clock.last);
          clock.last = now;
          clock.ms += dt;
        }

        const sx = VIEW_W / 2 - cam.x * cam.z;
        for (const s of snails) {
          const n = nodesRef.current.get(s.lane);
          const b = bands[s.lane];
          if (!n || !b) continue;

          const x = sx + s.p * totalWorld * cam.z;
          n.g.setAttribute('transform', `translate(${x.toFixed(1)} ${groundY(b).toFixed(1)})`);

          n.g.classList.toggle(
            'surging',
            !s.done && info.meanRate > 0 && s.rate > info.meanRate * 1.15,
          );
          const up = s.effect === 'boost' || s.effect === 'surge';
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
          const tag = live && !live.group ? live.label : '';
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

        /* Where to point. With the camera off, hold the whole race in frame. */
        let targetX: number;
        let targetZ: number;
        if (chase) {
          const framing = directorRef.current.update({
            tMs: clock.ms,
            worldByPosition: info.byPosition.map((s) => s.p * totalWorld),
            finishWorld: totalWorld,
            leadP: info.leadP,
            finalStraight: info.finalStraight,
            photoFinish: info.photoFinish,
          });
          targetX = framing.camX;
          targetZ = framing.zoom;
          if (shotRef.current && shotRef.current.textContent !== framing.label) {
            shotRef.current.textContent = framing.label;
          }
        } else {
          targetX = totalWorld / 2;
          targetZ = (VIEW_W - 200) / totalWorld;
          if (shotRef.current) shotRef.current.textContent = 'WIDE';
        }

        cam.x += (targetX - cam.x) * PAN_EASE;
        cam.z += (targetZ - cam.z) * ZOOM_EASE;
        write();
      },
    };
  }, [bands, chase, compact, laps, totalWorld]);

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
    if (!svg || !race.moment?.big || calm) return;
    svg.classList.add('jolt');
    const t = window.setTimeout(() => svg.classList.remove('jolt'), 700);
    return () => {
      window.clearTimeout(t);
      svg.classList.remove('jolt');
    };
  }, [race.moment?.id, race.moment?.big, calm]);

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

  const running = race.phase === 'running' || race.phase === 'countdown';

  return (
    <div
      ref={wrapRef}
      className={`track-wrap tv-wrap ${calm ? 'calm' : ''}`}
      data-surface={surface}
      data-weather={race.phase === 'idle' ? 'clear' : race.weather}
    >
      <svg
        ref={svgRef}
        className={`tv ${compact ? 'compact' : ''}`}
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

        {/* The runners. */}
        <g className="tv-runners">
          {order.map((lane) => {
            const c = laneColour(lane);
            const b = bands[lane];
            const s = b?.scale ?? 1;
            const top = -(SNAIL_H * s);
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
                  } as React.CSSProperties
                }
              >
                {/* Art scales with the lane's distance from the camera; the
                    labels do not, so a far-side name is as readable as a near
                    one. */}
                <g className="tv-art" transform={`scale(${s.toFixed(3)})`}>
                  <ellipse className="tv-shadow" cx={0} cy={3} rx={36} ry={7} />
                  <path className="tv-slime" d="M-30 0 H-104" />
                  <g className="tv-flex">
                    <path
                      className="tv-foot"
                      d="M-34 0 Q-42 -13 -22 -17 L16 -18 Q36 -17 39 -6 Q40 0 32 0 Z"
                    />
                    <path className="tv-foot-lit" d="M-24 -12 Q-2 -16 24 -12" />
                    <circle className="tv-shell" cx={-8} cy={-27} r={19} />
                    <path
                      className="tv-spiral"
                      d="M-8 -27 a4 4 0 1 0 3.6 2.4 a8.6 8.6 0 1 1 -11.2 -5.2 a13.6 13.6 0 1 1 -2.4 19.4"
                    />
                    <ellipse className="tv-shell-lit" cx={-15} cy={-34} rx={6.5} ry={4.2} />
                    <g className="tv-head">
                      <path className="tv-neck" d="M20 -14 Q33 -19 35 -28" />
                      <path className="tv-stalk" d="M34 -27 Q40 -37 42 -45" />
                      <path className="tv-stalk" d="M28 -28 Q31 -39 30 -47" />
                      <circle className="tv-eye" cx={42.5} cy={-46.5} r={4.2} />
                      <circle className="tv-eye" cx={30} cy={-48.5} r={4.2} />
                      <circle className="tv-pupil" cx={43.8} cy={-47} r={1.9} />
                      <circle className="tv-pupil" cx={31.2} cy={-49} r={1.9} />
                    </g>
                  </g>
                </g>

                {/* Name super. Lanes are separated vertically, so two runners
                    level with each other can never print over one another. */}
                <g className="tv-super" transform={`translate(0 ${(top - 12).toFixed(1)})`}>
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

      <div className="tv-top" aria-hidden="true">
        <span className={`tv-live ${race.phase === 'void' ? 'tv-void' : ''} ${replay ? 'tv-replay' : ''}`}>
          <i />{' '}
          {replay
            ? 'REPLAY'
            : race.phase === 'done'
              ? 'FINISHED'
              : race.phase === 'void'
                ? 'VOID'
                : race.phase === 'idle'
                  ? 'READY'
                  : 'LIVE'}
        </span>
        <span className="tv-title">
          {clubName} · Race {raceNo}
        </span>
        <span ref={lapRef} className="tv-lap num" />
        {replay ? null : (
          <span ref={clockRef} className="tv-clock num">
            0:00.0
          </span>
        )}
        <span ref={shotRef} className="tv-shot num" />
      </div>

      <RunningOrder race={race} names={names} open={running || race.phase === 'done'} />

      <div className="tv-strap">
        <span className="tv-strap-badge">{race.phase === 'done' ? 'RESULT' : 'ON THE CALL'}</span>
        <p className="tv-strap-line">{race.commentary || race.status}</p>
      </div>

      {race.countdown ? (
        <div className="countdown" aria-hidden="true">
          <span key={race.countdown}>{race.countdown}</span>
        </div>
      ) : null}

      {/* A surprise gets a lower third, not a card across the track. */}
      {race.moment && race.phase === 'running' ? (
        <p
          key={race.moment.id}
          className={`tv-flash moment-${race.moment.tone} ${race.moment.big ? 'tv-flash-big' : ''}`}
          aria-hidden="true"
        >
          {race.moment.big ? <b>FIELD EVENT</b> : null}
          {race.moment.text}
        </p>
      ) : null}

      {race.photoFinish && race.phase === 'running' ? (
        <p className="photo-banner">PHOTO FINISH</p>
      ) : null}
    </div>
  );
}

/**
 * The running order, bottom left, exactly where a broadcast keeps it.
 *
 * Fed from the loop's own board feed rather than from race state, so it
 * updates a few times a second without re-rendering the stage. Six rows: past
 * that it stops being glanceable and the tote board carries the rest.
 */
function RunningOrder({
  race,
  names,
  open,
}: {
  race: RaceController;
  names: string[];
  open: boolean;
}) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const { onBoard } = race;

  useEffect(() => onBoard(setRows), [onBoard]);

  /* Between races there is no order to show; derived, not synchronised. */
  const shown = race.phase === 'idle' ? [] : rows.slice(0, 6);
  if (!open || !shown.length) return null;

  return (
    <ol className="tv-order" aria-label="Running order">
      {shown.map((r) => (
        <li key={r.lane} className="tv-order-row">
          <span className="tv-order-pos num">{r.place}</span>
          <i className="tv-order-dot" style={{ background: laneColour(r.lane).shell }} />
          <span className="tv-order-name">{names[r.lane] ?? `Lane ${r.lane + 1}`}</span>
          <span className="tv-order-gap num">{r.gapText}</span>
        </li>
      ))}
    </ol>
  );
}
