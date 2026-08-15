'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Snail } from './Snail';
import { laneColour, type StageThemeId } from '@/lib/palette';
import { ordinal, type RaceEvent, type SnailRun } from '@/lib/race-engine';
import type { PaintInfo, RaceController, RacePainter } from '@/lib/use-race';

/**
 * The straight track: one lane per snail, left to right.
 *
 * This is the renderer that reads best on a bad projector and to a screen
 * reader, so it stays the option a nervous moderator can fall back to. The
 * circuit in `Circuit.tsx` is the other implementation of the same
 * `RacePainter` seam - both are handed the same `p` per snail and only differ
 * in where they put it.
 */

interface Props {
  names: string[];
  race: RaceController;
  surface: StageThemeId;
}

/**
 * Where the snail's nose sits inside its token, as a fraction of token width
 * (the SVG nose is at x=122 of a 132-wide viewBox). The lane geometry hangs
 * off this one number.
 */
const NOSE = 0.924;

/** Marker glyphs. The shape says "help" or "trouble" before the colour does. */
const PAD_MARK: Record<string, string> = {
  boost: '»',
  surge: '»',
  stumble: '!',
  nap: 'z',
  wander: '?',
};

interface LaneNodes {
  root: HTMLElement;
  field: HTMLElement;
  token: HTMLElement;
  trail: HTMLElement;
  chip: HTMLElement;
  label: HTMLElement;
  fx: HTMLElement;
}

export function RaceTrack({ names, race, surface }: Props) {
  const { setPainter } = race;
  const lanesRef = useRef<Map<number, LaneNodes>>(new Map());
  const trackRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const geomRef = useRef({ travelPx: 0, tokenW: 0, fieldW: 0, labelW: [] as number[] });

  /*
   * The pads are drawn per lane, so group once rather than filtering the whole
   * list inside every lane's render.
   */
  const padsByLane = useMemo(() => {
    const map = new Map<number, RaceEvent[]>();
    for (const e of race.events) {
      const list = map.get(e.lane);
      if (list) list.push(e);
      else map.set(e.lane, [e]);
    }
    return map;
  }, [race.events]);

  /*
   * One callback ref per lane, holding the nodes the animation loop writes
   * to. Collecting them here means the loop never queries the DOM mid-frame,
   * and React still owns creation and teardown.
   */
  const laneRef = useCallback(
    (index: number) => (root: HTMLDivElement | null) => {
      if (!root) {
        lanesRef.current.delete(index);
        return;
      }
      const nodes: LaneNodes = {
        root,
        field: root.querySelector('.field') as HTMLElement,
        token: root.querySelector('.token') as HTMLElement,
        trail: root.querySelector('.trail') as HTMLElement,
        chip: root.querySelector('.pos-chip') as HTMLElement,
        label: root.querySelector('.label') as HTMLElement,
        fx: root.querySelector('.fx-pill') as HTMLElement,
      };
      if (nodes.field && nodes.token && nodes.trail && nodes.chip && nodes.label && nodes.fx) {
        lanesRef.current.set(index, nodes);
      }
    },
    [],
  );

  const painter = useMemo<RacePainter>(() => {
    /** Re-read the box model. Called on mount, on resize and before every race. */
    const measure = () => {
      const first = lanesRef.current.get(0);
      if (!first) return;
      const fieldW = first.field.clientWidth;
      const tokenW = first.token.offsetWidth;
      geomRef.current.fieldW = fieldW;
      geomRef.current.tokenW = tokenW;
      geomRef.current.travelPx = Math.max(10, fieldW - NOSE * tokenW);
      geomRef.current.labelW = [...lanesRef.current.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, n]) => n.label.offsetWidth);
    };

    const place = (snails: SnailRun[]) => {
      const { travelPx, tokenW, fieldW, labelW } = geomRef.current;
      for (const s of snails) {
        const nodes = lanesRef.current.get(s.lane);
        if (!nodes) continue;

        const x = s.p * travelPx;
        /*
         * `--x` lives on the lane field, not the token, so the snail and its
         * name pill can read the same position while being laid out
         * independently. The pill sits at the top of the lane instead of
         * hanging off the token, which is what stops a tall snail pushing its
         * own name out through the top of the track.
         */
        nodes.field.style.setProperty('--x', `${x.toFixed(2)}px`);
        nodes.trail.style.setProperty('--tp', s.p.toFixed(4));

        /*
         * Keep the name pill inside its lane. Without this a long name is
         * sliced in half by the finish line at the exact moment it matters.
         */
        const centre = x + tokenW / 2;
        const half = (labelW[s.lane] ?? 0) / 2;
        let lx = 0;
        if (half * 2 < fieldW) {
          if (centre - half < 0) lx = half - centre;
          if (centre + half + lx > fieldW) lx = fieldW - centre - half;
        }
        nodes.label.style.setProperty('--lx', `${lx.toFixed(1)}px`);
      }
    };

    return {
      measure,

      start: () => {
        lanesRef.current.forEach((nodes) => nodes.root.classList.add('racing'));
      },

      reset: () => {
        trackRef.current?.classList.remove('final-straight', 'photo');
        trackRef.current?.style.setProperty('--race-p', '0');
        lanesRef.current.forEach((nodes) => {
          nodes.root.classList.remove(
            'racing', 'finished', 'surging', 'pos-1', 'pos-2', 'pos-3', 'fx-up', 'fx-down',
          );
          nodes.field.style.setProperty('--x', '0px');
          nodes.trail.style.setProperty('--tp', '0');
          nodes.chip.textContent = '';
          nodes.fx.textContent = '';
        });
      },

      paint: (snails: SnailRun[], info: PaintInfo) => {
        for (const s of info.justFinished) {
          const nodes = lanesRef.current.get(s.lane);
          if (nodes) {
            nodes.root.classList.add('finished');
            nodes.root.classList.remove('surging');
            if (s.place <= 3) nodes.root.classList.add(`pos-${s.place}`);
          }
          if (s.place === 1 && flashRef.current) {
            flashRef.current.classList.remove('fire');
            void flashRef.current.offsetWidth; // restart the keyframe
            flashRef.current.classList.add('fire');
          }
        }

        trackRef.current?.classList.toggle('photo', info.photoFinish);
        if (info.finalStraight) trackRef.current?.classList.add('final-straight');
        trackRef.current?.style.setProperty('--race-p', info.leadP.toFixed(4));

        for (const s of snails) {
          const nodes = lanesRef.current.get(s.lane);
          if (!nodes) continue;
          nodes.root.classList.toggle(
            'surging',
            !s.done && info.meanRate > 0 && s.rate > info.meanRate * 1.15,
          );

          /* Dress the lane for whichever surprise is currently acting on it. */
          const up = s.effect === 'boost' || s.effect === 'surge';
          const down = s.effect !== null && !up;
          nodes.root.classList.toggle('fx-up', up);
          nodes.root.classList.toggle('fx-down', down);
          const tag = s.effect ? (s.events.find((e) => e.kind === s.effect)?.label ?? '') : '';
          if (nodes.fx.textContent !== tag) nodes.fx.textContent = tag;
        }

        info.ranked.forEach((s, i) => {
          const chip = lanesRef.current.get(s.lane)?.chip;
          const label = ordinal(i + 1);
          if (chip && chip.textContent !== label) chip.textContent = label;
        });

        place(snails);
      },
    };
  }, []);

  useEffect(() => {
    setPainter(painter);
    return () => setPainter(null);
  }, [painter, setPainter]);

  return (
    <div ref={trackRef} className="track-wrap" data-surface={surface}>
      <div
        className="lanes"
        role="list"
        aria-label="Racing lanes"
        style={{ '--n': names.length } as React.CSSProperties}
      >
        {names.map((name, i) => {
          const c = laneColour(i);
          return (
            <div
              key={`${i}-${name}`}
              ref={laneRef(i)}
              className="lane"
              role="listitem"
              aria-label={`Lane ${i + 1}, ${name}`}
              style={
                {
                  '--shell': c.shell,
                  '--shell-dk': c.dark,
                  '--body': c.body,
                  '--glow': c.glow,
                } as React.CSSProperties
              }
            >
              <div className="rail">
                <span className="lane-badge num">{i + 1}</span>
              </div>
              <div className="field">
                <div className="gate" aria-hidden="true" />
                <div className="ticks" aria-hidden="true">
                  <i style={{ '--at': 0.25 } as React.CSSProperties} />
                  <i style={{ '--at': 0.5 } as React.CSSProperties} />
                  <i style={{ '--at': 0.75 } as React.CSSProperties} />
                </div>
                <div className="pads" aria-hidden="true">
                  {(padsByLane.get(i) ?? []).map((e) => (
                    <i
                      key={e.id}
                      className={`pad pad-${e.tone}`}
                      style={
                        { '--at': e.at, '--span': e.span } as React.CSSProperties
                      }
                    >
                      <b>{PAD_MARK[e.kind] ?? '*'}</b>
                    </i>
                  ))}
                </div>
                <div className="trail" aria-hidden="true" />
                <span className="label">
                  <span className="pos-chip num" aria-hidden="true" />
                  <span className="name-pill">{name}</span>
                  <span className="fx-pill" aria-hidden="true" />
                </span>
                <div className="token">
                  <Snail />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="finish" aria-hidden="true">
        <div className="finish-chequer" />
        <div className="finish-banner">FINISH</div>
      </div>

      <div ref={flashRef} className="flash" aria-hidden="true" />

      {race.phase === 'running' ? (
        <div className="race-progress" aria-hidden="true">
          <i />
        </div>
      ) : null}

      {race.countdown ? (
        <div className="countdown" aria-hidden="true">
          <span key={race.countdown}>{race.countdown}</span>
        </div>
      ) : null}

      {/*
        Surprises are announced twice over: here for the room at the back, and
        in the commentary rail, which is also what a screen reader follows.
      */}
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
