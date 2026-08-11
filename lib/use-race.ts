'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  callLine,
  drawRace,
  freshSeed,
  ordinal,
  rankSnails,
  stepRace,
  type DrawnRace,
  type SnailRun,
} from './race-engine';
import { sfx } from './sound';
import type { RaceResult } from './types';

/**
 * Where the snail's nose sits inside its token, as a fraction of token width
 * (the SVG nose is at x=122 of a 132-wide viewBox). Everything in the track
 * geometry hangs off this one number.
 */
const NOSE = 0.924;

/** How much race-time the photo-finish slow-motion covers, at 0.3x speed. */
const SLOWMO_RACE_MS = 620;

export type RacePhase = 'idle' | 'countdown' | 'running' | 'done';

export interface LaneNodes {
  root: HTMLElement;
  field: HTMLElement;
  token: HTMLElement;
  trail: HTMLElement;
  chip: HTMLElement;
  label: HTMLElement;
}

export interface RaceController {
  phase: RacePhase;
  countdown: string;
  status: string;
  commentary: string;
  seedHex: string;
  photoFinish: boolean;
  results: RaceResult[];
  registerLane: (index: number, nodes: LaneNodes | null) => void;
  trackRef: React.RefObject<HTMLDivElement | null>;
  flashRef: React.RefObject<HTMLDivElement | null>;
  start: (names: string[], durationMs: number) => void;
  reset: () => void;
}

interface LiveRace extends DrawnRace {
  raceT: number;
  last: number;
  slow: number;
  placed: number;
  slowmoUsed: boolean;
  /** Race-time at which slow-motion hands back to normal speed. */
  slowUntil: number;
  commentaryAt: number;
  results: RaceResult[];
}

/**
 * Owns the animation loop.
 *
 * Positions are written straight onto the lane elements as CSS custom
 * properties rather than through React state. At six to eight lanes and sixty
 * frames a second, routing geometry through the reconciler would mean roughly
 * five hundred renders per race for numbers no component needs to read.
 * React still drives everything a human reads: phase, status, commentary and
 * the finishing order.
 */
export function useRace(onFinish: (race: DrawnRace, results: RaceResult[]) => void): RaceController {
  const [phase, setPhase] = useState<RacePhase>('idle');
  const [countdown, setCountdown] = useState('');
  const [status, setStatus] = useState('Ready to race');
  const [commentary, setCommentary] = useState('');
  const [seedHex, setSeedHex] = useState('');
  const [photoFinish, setPhotoFinish] = useState(false);
  const [results, setResults] = useState<RaceResult[]>([]);

  const lanesRef = useRef<Map<number, LaneNodes>>(new Map());
  const trackRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);

  const raceRef = useRef<LiveRace | null>(null);
  const rafRef = useRef(0);
  /* The loop schedules itself, so it reaches the next tick through a ref
     rather than by naming a callback that has not been declared yet. */
  const frameRef = useRef<(now: number) => void>(() => {});
  const timersRef = useRef<number[]>([]);
  const geomRef = useRef({ travelPx: 0, tokenW: 0, fieldW: 0, labelW: [] as number[] });
  const finishRef = useRef(onFinish);

  /*
   * The caller re-creates `onFinish` whenever the ledger changes, which is
   * constantly. Holding it in a ref that an effect keeps current means the
   * animation loop never has to be torn down and rebuilt mid-race just
   * because a donation landed.
   */
  useEffect(() => {
    finishRef.current = onFinish;
  }, [onFinish]);

  const registerLane = useCallback((index: number, nodes: LaneNodes | null) => {
    if (nodes) lanesRef.current.set(index, nodes);
    else lanesRef.current.delete(index);
  }, []);

  /** Re-read the box model. Called on mount, on resize and before every race. */
  const measure = useCallback(() => {
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
  }, []);

  useEffect(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  const paint = useCallback((snails: SnailRun[]) => {
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
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const reset = useCallback(() => {
    stop();
    clearTimers();
    raceRef.current = null;
    setPhase('idle');
    setCountdown('');
    setCommentary('');
    setPhotoFinish(false);
    setResults([]);
    setStatus('Ready to race');
    trackRef.current?.classList.remove('final-straight', 'photo');
    lanesRef.current.forEach((nodes) => {
      nodes.root.classList.remove('racing', 'finished', 'surging', 'pos-1', 'pos-2', 'pos-3');
      nodes.field.style.setProperty('--x', '0px');
      nodes.trail.style.setProperty('--tp', '0');
      nodes.chip.textContent = '';
    });
  }, [clearTimers, stop]);

  const finish = useCallback(() => {
    const race = raceRef.current;
    stop();
    if (!race) return;

    /*
     * A snail can still be short of the line if the loop hit `tMax` first,
     * which only happens after a tab has been backgrounded. Settle the
     * stragglers by draw order so the announced result always matches the
     * seed rather than the frame count.
     */
    const unplaced = race.snails.filter((s) => !s.done);
    if (unplaced.length) {
      unplaced
        .sort((a, b) => race.order.indexOf(a.lane) - race.order.indexOf(b.lane))
        .forEach((s) => {
          s.p = 1;
          s.done = true;
          s.place = ++race.placed;
          s.finishMs = Math.round(race.raceT);
          race.results.push({ lane: s.lane, name: s.name, place: s.place, finishMs: s.finishMs });
        });
      paint(race.snails);
    }

    const ordered = race.results.slice().sort((a, b) => a.place - b.place);
    setResults(ordered);
    setPhase('done');
    setStatus(ordered[0] ? `${ordered[0].name} wins!` : 'Race over');
    sfx.fanfare();
    finishRef.current(race, ordered);
  }, [paint, stop]);

  const frame = useCallback(
    (now: number) => {
      const race = raceRef.current;
      if (!race) return;

      if (!race.last) race.last = now;
      let dt = now - race.last;
      race.last = now;
      if (dt > 100) dt = 100; // survive GC pauses and tab returns
      race.raceT += dt * race.slow;

      const crossed = stepRace(race.snails, race.raceT, dt, race.placed);
      for (const s of crossed) {
        race.placed = s.place;
        race.results.push({ lane: s.lane, name: s.name, place: s.place, finishMs: s.finishMs });
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

      const { byPosition, ranked } = rankSnails(race.snails);

      if (
        !race.slowmoUsed &&
        byPosition.length > 1 &&
        !byPosition[0].done &&
        byPosition[0].p > 0.88 &&
        byPosition[0].p - byPosition[1].p < 0.04
      ) {
        race.slow = 0.3;
        race.slowmoUsed = true;
        race.slowUntil = race.raceT + SLOWMO_RACE_MS;
        setPhotoFinish(true);
        setStatus('PHOTO FINISH!');
        trackRef.current?.classList.add('photo');
        sfx.photo();
      }

      /*
       * Hand speed back after the moment has landed. Left running, a 0.3x
       * clock turns the last tenth of the track into seven real seconds and
       * the room stops watching.
       */
      if (race.slow < 1 && race.raceT >= race.slowUntil) {
        race.slow = 1;
        trackRef.current?.classList.remove('photo');
      }

      if (byPosition[0].p > 0.8) trackRef.current?.classList.add('final-straight');

      /* Effort cue for anyone moving well above the field average. */
      let mean = 0;
      for (const s of race.snails) mean += s.rate;
      mean /= race.snails.length || 1;
      for (const s of race.snails) {
        lanesRef.current
          .get(s.lane)
          ?.root.classList.toggle('surging', !s.done && mean > 0 && s.rate > mean * 1.15);
      }

      ranked.forEach((s, i) => {
        const chip = lanesRef.current.get(s.lane)?.chip;
        const label = ordinal(i + 1);
        if (chip && chip.textContent !== label) chip.textContent = label;
      });

      paint(race.snails);

      if (race.raceT - race.commentaryAt > 1600) {
        race.commentaryAt = race.raceT;
        const lead = byPosition[0];
        if (lead) setCommentary(callLine(lead.p, lead.name, byPosition[1]?.name ?? lead.name));
      }

      if (race.placed < race.snails.length && race.raceT < race.tMax) {
        rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
      } else {
        finish();
      }
    },
    [finish, paint],
  );

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const start = useCallback(
    (names: string[], durationMs: number) => {
      if (phase === 'countdown' || phase === 'running') return;
      reset();
      measure();

      const drawn = drawRace(freshSeed(), names, durationMs);
      raceRef.current = {
        ...drawn,
        raceT: 0,
        last: 0,
        slow: 1,
        placed: 0,
        slowmoUsed: false,
        slowUntil: 0,
        commentaryAt: -2000,
        results: [],
      };
      setSeedHex(drawn.seedHex);
      setPhase('countdown');
      setStatus('On your marks');

      const steps = ['3', '2', '1', 'GO!'];
      steps.forEach((label, i) => {
        timersRef.current.push(
          window.setTimeout(() => {
            setCountdown(label);
            if (label === 'GO!') sfx.go();
            else sfx.beep();
          }, i * 900),
        );
      });

      timersRef.current.push(
        window.setTimeout(() => {
          setCountdown('');
          setPhase('running');
          setStatus('And they are away!');
          lanesRef.current.forEach((nodes) => nodes.root.classList.add('racing'));
          rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
        }, steps.length * 900),
      );
    },
    [measure, phase, reset],
  );

  useEffect(
    () => () => {
      stop();
      clearTimers();
    },
    [clearTimers, stop],
  );

  return {
    phase,
    countdown,
    status,
    commentary,
    seedHex,
    photoFinish,
    results,
    registerLane,
    trackRef,
    flashRef,
    start,
    reset,
  };
}
