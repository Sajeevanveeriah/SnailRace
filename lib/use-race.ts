'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  callLine,
  drawRace,
  eventLine,
  freshSeed,
  leadChangeLine,
  ordinal,
  rankSnails,
  sectorLine,
  stepRace,
  type DrawnRace,
  type RaceEvent,
  type SnailRun,
} from './race-engine';
import { setIntensity, sfx, startTrack } from './sound';
import type { RaceHighlight, RaceResult } from './types';

/**
 * Where the snail's nose sits inside its token, as a fraction of token width
 * (the SVG nose is at x=122 of a 132-wide viewBox). Everything in the track
 * geometry hangs off this one number.
 */
const NOSE = 0.924;

/** How much race-time the photo-finish slow-motion covers, at 0.3x speed. */
const SLOWMO_RACE_MS = 620;

/** How long a surprise banner stays up, in real milliseconds. */
const MOMENT_MS = 1800;

/**
 * Past this point the banner is muted.
 *
 * It sits across the middle of the track, and a card covering the leaders as
 * they come to the line would cost the room the one moment it came for. The
 * commentary rail still carries every call.
 */
const MOMENT_UNTIL = 0.82;

/**
 * A lead change before this point is just the field sorting itself out at the
 * gate, and calling every one of them cheapens the ones that matter.
 */
const LEAD_CHANGE_FROM = 0.12;

export type RacePhase = 'idle' | 'countdown' | 'running' | 'done';

export type MomentTone = 'good' | 'bad' | 'hot';

/** A shout for the middle of the track: a surprise, or a change of leader. */
export interface RaceMoment {
  /** Bumped on every moment so the banner replays its keyframe. */
  id: number;
  text: string;
  tone: MomentTone;
}

export interface LaneNodes {
  root: HTMLElement;
  field: HTMLElement;
  token: HTMLElement;
  trail: HTMLElement;
  chip: HTMLElement;
  label: HTMLElement;
  fx: HTMLElement;
}

export interface RaceController {
  phase: RacePhase;
  countdown: string;
  status: string;
  commentary: string;
  seedHex: string;
  photoFinish: boolean;
  results: RaceResult[];
  /** Every surprise drawn for the race in progress, for the track markers. */
  events: RaceEvent[];
  moment: RaceMoment | null;
  registerLane: (index: number, nodes: LaneNodes | null) => void;
  trackRef: React.RefObject<HTMLDivElement | null>;
  flashRef: React.RefObject<HTMLDivElement | null>;
  start: (names: string[], durationMs: number, surprises?: boolean) => void;
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
  /** Which quarter-mark call has already been made. */
  sector: number;
  /** Lane currently in front, for spotting a change of leader. */
  leadLane: number;
  /** The run-home cue fires once, not on every frame past the threshold. */
  finalCalled: boolean;
  results: RaceResult[];
  highlights: RaceHighlight[];
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
export function useRace(
  onFinish: (race: DrawnRace, results: RaceResult[], highlights: RaceHighlight[]) => void,
): RaceController {
  const [phase, setPhase] = useState<RacePhase>('idle');
  const [countdown, setCountdown] = useState('');
  const [status, setStatus] = useState('Ready to race');
  const [commentary, setCommentary] = useState('');
  const [seedHex, setSeedHex] = useState('');
  const [photoFinish, setPhotoFinish] = useState(false);
  const [results, setResults] = useState<RaceResult[]>([]);
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [moment, setMoment] = useState<RaceMoment | null>(null);

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
  const momentIdRef = useRef(0);
  const momentTimerRef = useRef(0);

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
    window.clearTimeout(momentTimerRef.current);
    momentTimerRef.current = 0;
  }, []);

  /**
   * Shout something across the middle of the track.
   *
   * One banner at a time: a nap and a lead change landing together used to
   * stack two cards on top of each other, and the newer moment is always the
   * one the room is looking at.
   */
  const announce = useCallback((text: string, tone: MomentTone) => {
    momentIdRef.current += 1;
    setMoment({ id: momentIdRef.current, text, tone });
    window.clearTimeout(momentTimerRef.current);
    momentTimerRef.current = window.setTimeout(() => {
      momentTimerRef.current = 0;
      setMoment(null);
    }, MOMENT_MS);
  }, []);

  /** Pull a banner down early, e.g. because the leaders have reached the run home. */
  const hushMoment = useCallback(() => {
    if (!momentTimerRef.current) return;
    window.clearTimeout(momentTimerRef.current);
    momentTimerRef.current = 0;
    setMoment(null);
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
    setEvents([]);
    setMoment(null);
    setStatus('Ready to race');
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
    startTrack('winner');
    sfx.fanfare();
    finishRef.current(race, ordered, race.highlights);
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

      const { crossed, fired } = stepRace(race.snails, race.raceT, dt, race.placed);
      const leadP = race.snails.reduce((m, s) => (s.done ? 1 : Math.max(m, s.p)), 0);
      const quiet = leadP > MOMENT_UNTIL;
      if (quiet) hushMoment();

      /*
       * Surprises. Only the last one on a frame gets the banner, but every
       * one is kept for the result card so the room can relive the race that
       * just cost them their chips.
       */
      for (const { event, snail } of fired) {
        race.highlights.push({
          atMs: Math.round(race.raceT),
          lane: snail.lane,
          name: snail.name,
          kind: event.kind,
          label: event.label,
        });
        setCommentary(eventLine(event, snail.name));
        race.commentaryAt = race.raceT;
        if (!quiet) announce(`${snail.name}: ${event.label}`, event.tone);
        if (event.tone === 'good') sfx.boost();
        else sfx.stumble();
      }

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
      const lead = byPosition[0];
      const chaser = byPosition[1] ?? lead;

      /*
       * A change of leader is the single loudest thing that happens in a
       * race, and before this it went past unremarked. Guarded on the
       * leader still being on the track: the moment the first snail is home
       * every other lane "takes the lead" in turn as it finishes.
       */
      if (
        lead &&
        !lead.done &&
        race.placed === 0 &&
        lead.p > LEAD_CHANGE_FROM &&
        race.leadLane !== -1 &&
        lead.lane !== race.leadLane
      ) {
        const deposed = race.snails.find((s) => s.lane === race.leadLane);
        setCommentary(leadChangeLine(lead.name, deposed?.name ?? chaser.name));
        race.commentaryAt = race.raceT;
        if (!quiet) announce(`${lead.name} HITS THE FRONT`, 'hot');
        sfx.leadChange();
      }
      if (lead && !lead.done) race.leadLane = lead.lane;

      /* Quarter-mark calls keep a thirty-second race from sagging in the middle. */
      if (lead && !lead.done) {
        const sector = Math.floor(lead.p * 4);
        if (sector > race.sector && sector <= 3) {
          race.sector = sector;
          const line = sectorLine(sector, lead.name, chaser.name);
          if (line) {
            setCommentary(line);
            race.commentaryAt = race.raceT;
            if (sector === 2) sfx.bell();
          }
        }
      }

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

      if (byPosition[0].p > 0.8) {
        trackRef.current?.classList.add('final-straight');
        if (!race.finalCalled) {
          race.finalCalled = true;
          sfx.finalStraight();
        }
      }

      /* Drives the race-progress bar. A long race needs a sense of how far is left. */
      trackRef.current?.style.setProperty('--race-p', byPosition[0].p.toFixed(4));

      /*
       * The soundtrack follows the race rather than running beside it: the
       * arrangement thickens as the leader comes home, so the room hears how
       * far in it is without looking up.
       */
      setIntensity(leadP);

      /* Effort cue for anyone moving well above the field average. */
      let mean = 0;
      for (const s of race.snails) mean += s.rate;
      mean /= race.snails.length || 1;
      for (const s of race.snails) {
        const nodes = lanesRef.current.get(s.lane);
        if (!nodes) continue;
        nodes.root.classList.toggle('surging', !s.done && mean > 0 && s.rate > mean * 1.15);

        /* Dress the lane for whichever surprise is currently acting on it. */
        const up = s.effect === 'boost' || s.effect === 'surge';
        const down = s.effect !== null && !up;
        nodes.root.classList.toggle('fx-up', up);
        nodes.root.classList.toggle('fx-down', down);
        const tag = s.effect ? (s.events.find((e) => e.kind === s.effect)?.label ?? '') : '';
        if (nodes.fx.textContent !== tag) nodes.fx.textContent = tag;
      }

      ranked.forEach((s, i) => {
        const chip = lanesRef.current.get(s.lane)?.chip;
        const label = ordinal(i + 1);
        if (chip && chip.textContent !== label) chip.textContent = label;
      });

      paint(race.snails);

      if (race.raceT - race.commentaryAt > 1600) {
        race.commentaryAt = race.raceT;
        if (lead) setCommentary(callLine(lead.p, lead.name, chaser.name));
      }

      if (race.placed < race.snails.length && race.raceT < race.tMax) {
        rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
      } else {
        finish();
      }
    },
    [announce, finish, hushMoment, paint],
  );

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const start = useCallback(
    (names: string[], durationMs: number, surprises = true) => {
      if (phase === 'countdown' || phase === 'running') return;
      reset();
      measure();

      const drawn = drawRace(freshSeed(), names, durationMs, surprises);
      raceRef.current = {
        ...drawn,
        raceT: 0,
        last: 0,
        slow: 1,
        placed: 0,
        slowmoUsed: false,
        slowUntil: 0,
        commentaryAt: -2000,
        sector: 0,
        leadLane: -1,
        finalCalled: false,
        results: [],
        highlights: [],
      };
      setSeedHex(drawn.seedHex);
      setEvents(drawn.events);
      setPhase('countdown');
      setStatus('On your marks');

      const steps = ['3', '2', '1', 'GO!'];

      /* One roll under the whole countdown, tightening into the off. */
      sfx.drumroll((steps.length * 900) / 1000);

      steps.forEach((label, i) => {
        timersRef.current.push(
          window.setTimeout(() => {
            setCountdown(label);
            if (label === 'GO!') {
              sfx.go();
              sfx.gate();
              /* The race track starts at the off, already at gate intensity. */
              startTrack('race', { intensity: 0 });
            } else {
              sfx.beep();
            }
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
    events,
    moment,
    registerLane,
    trackRef,
    flashRef,
    start,
    reset,
  };
}
