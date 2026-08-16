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
  lapLine,
  sectorLine,
  stepRace,
  type DrawnRace,
  WEATHER_CALL,
  type RaceEvent,
  type SnailRun,
  type Weather,
} from './race-engine';
import { say, setIntensity, sfx, silence, startTrack } from './sound';
import type { RaceHighlight, RaceResult } from './types';

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

/**
 * Everything a renderer needs on a given frame, gathered once by the loop.
 *
 * Two orderings, deliberately: `byPosition` for the drama cues and `ranked`
 * for what the crowd reads - see `rankSnails`.
 */
export interface PaintInfo {
  ranked: SnailRun[];
  byPosition: SnailRun[];
  /** The leader's progress, 0 to 1. */
  leadP: number;
  /** Mean closing rate, for the effort cue. */
  meanRate: number;
  photoFinish: boolean;
  finalStraight: boolean;
  /** Lanes that crossed the line on this frame, in finishing order. */
  justFinished: SnailRun[];
}

/**
 * How a race gets drawn.
 *
 * The loop owns the physics and the theatre; a painter owns the pixels. That
 * seam is what lets the same race be shown as straight lanes or as laps of a
 * circuit without either renderer knowing about the other, and without the
 * fairness argument being reopened - both are given the same `p` per snail
 * and only differ in where they put it.
 *
 * `paint` runs on every animation frame, so it should write to the DOM and
 * not read from it. `measure` is where a renderer does its layout reads.
 */
export interface RacePainter {
  measure: () => void;
  reset: () => void;
  /** The gates are open. Anything that only animates while racing starts here. */
  start: () => void;
  paint: (snails: SnailRun[], info: PaintInfo) => void;
}

/** One row of the running-order board. */
export interface BoardRow {
  lane: number;
  place: number;
  /** Gap to the leader, already formatted: "leader", "+1.4s", "finished". */
  gapText: string;
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
  /** Conditions for the race in progress. Scenery and commentary only. */
  weather: Weather;
  /**
   * Subscribe to the running order and gaps. Emitted a few times a second
   * rather than every frame: the numbers are read by a human, and sixty
   * updates a second to a twenty-row list is the most expensive thing on the
   * stage for no gain. Returns an unsubscribe.
   */
  onBoard: (cb: (rows: BoardRow[]) => void) => () => void;
  /** Register the renderer that turns each frame's positions into pixels. */
  setPainter: (painter: RacePainter | null) => void;
  start: (names: string[], durationMs: number, surprises?: boolean, laps?: number) => void;
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
  /** How many laps of the circuit the leader has already completed. */
  lapsDone: number;
  /** Lane currently in front, for spotting a change of leader. */
  leadLane: number;
  /** The run-home cue fires once, not on every frame past the threshold. */
  finalCalled: boolean;
  /** True while the photo-finish slow-motion is running. */
  inPhoto: boolean;
  results: RaceResult[];
  highlights: RaceHighlight[];
}

/**
 * Owns the animation loop.
 *
 * Positions go to the registered painter, which writes them straight to the
 * DOM rather than through React state. At six to eight lanes and sixty frames
 * a second, routing geometry through the reconciler would mean roughly five
 * hundred renders per race for numbers no component needs to read. React
 * still drives everything a human reads: phase, status, commentary and the
 * finishing order.
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
  const [weather, setWeather] = useState<Weather>('clear');

  const painterRef = useRef<RacePainter | null>(null);
  const raceRef = useRef<LiveRace | null>(null);
  const rafRef = useRef(0);
  /* The loop schedules itself, so it reaches the next tick through a ref
     rather than by naming a callback that has not been declared yet. */
  const frameRef = useRef<(now: number) => void>(() => {});
  const timersRef = useRef<number[]>([]);
  const finishRef = useRef(onFinish);
  const momentIdRef = useRef(0);
  const momentTimerRef = useRef(0);
  /** Laps of the circuit, so the loop can call the bell lap. 1 on lanes. */
  const lapsRef = useRef(1);
  const boardRef = useRef<Set<(rows: BoardRow[]) => void>>(new Set());
  const boardAtRef = useRef(0);

  const onBoard = useCallback((cb: (rows: BoardRow[]) => void) => {
    boardRef.current.add(cb);
    return () => {
      boardRef.current.delete(cb);
    };
  }, []);

  /*
   * The caller re-creates `onFinish` whenever the ledger changes, which is
   * constantly. Holding it in a ref that an effect keeps current means the
   * animation loop never has to be torn down and rebuilt mid-race just
   * because a donation landed.
   */
  useEffect(() => {
    finishRef.current = onFinish;
  }, [onFinish]);

  /*
   * A renderer registers itself here. Swapping between straight lanes and the
   * circuit is therefore a matter of which component is mounted, and the loop
   * below never learns which one it is driving.
   */
  const setPainter = useCallback((painter: RacePainter | null) => {
    painterRef.current = painter;
    painter?.measure();
  }, []);

  useEffect(() => {
    const onResize = () => painterRef.current?.measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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

  /**
   * Put a line on the rail and, if the caller is on, say it out loud.
   *
   * One function so the two can never drift apart: everything the room reads
   * is everything the room hears. Priority decides whether a line is worth
   * talking over the last one - see `audio/voice.ts`.
   */
  const call = useCallback((text: string, priority: 'big' | 'call' = 'call') => {
    setCommentary(text);
    say(text, priority);
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
    silence();
    painterRef.current?.reset();
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
      const settled = rankSnails(race.snails);
      painterRef.current?.paint(race.snails, {
        ...settled,
        leadP: 1,
        meanRate: 0,
        photoFinish: false,
        finalStraight: true,
        justFinished: unplaced,
      });
    }

    const ordered = race.results.slice().sort((a, b) => a.place - b.place);
    setResults(ordered);
    setPhase('done');
    setStatus(ordered[0] ? `${ordered[0].name} wins!` : 'Race over');
    if (ordered[0]) {
      const margin = ordered[1] ? ordered[1].finishMs - ordered[0].finishMs : 0;
      call(
        margin && margin < 200
          ? `${ordered[0].name} wins it on the line!`
          : `${ordered[0].name} wins!`,
        'big',
      );
    }
    startTrack('winner');
    sfx.fanfare();
    finishRef.current(race, ordered, race.highlights);
  }, [call, stop]);

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
        call(eventLine(event, snail.name));
        race.commentaryAt = race.raceT;
        if (!quiet) announce(`${snail.name}: ${event.label}`, event.tone);
        if (event.tone === 'good') sfx.boost();
        else sfx.stumble();
      }

      for (const s of crossed) {
        race.placed = s.place;
        race.results.push({ lane: s.lane, name: s.name, place: s.place, finishMs: s.finishMs });
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
        call(leadChangeLine(lead.name, deposed?.name ?? chaser.name), 'big');
        race.commentaryAt = race.raceT;
        if (!quiet) announce(`${lead.name} HITS THE FRONT`, 'hot');
        sfx.leadChange();
      }
      if (lead && !lead.done) race.leadLane = lead.lane;

      /*
       * Rhythm for a long race. On a circuit that is the leader crossing the
       * line - a real event the room can see - and the last one gets the
       * bell. On straight lanes there is nothing to cross, so the quarter
       * marks stand in for it.
       */
      const laps = lapsRef.current;
      if (lead && !lead.done && laps > 1) {
        const done = Math.floor(lead.p * laps);
        if (done > race.lapsDone && done < laps) {
          race.lapsDone = done;
          const starting = done + 1;
          call(lapLine(starting, laps, lead.name, chaser.name), 'big');
          race.commentaryAt = race.raceT;
          if (starting === laps) {
            announce('BELL LAP', 'hot');
            sfx.bell();
            sfx.crowd.roar(0.8);
          } else {
            sfx.bell();
          }
        }
      } else if (lead && !lead.done) {
        const sector = Math.floor(lead.p * 4);
        if (sector > race.sector && sector <= 3) {
          race.sector = sector;
          const line = sectorLine(sector, lead.name, chaser.name);
          if (line) {
            call(line, 'big');
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
        race.inPhoto = true;
        sfx.photo();
      }

      /*
       * Hand speed back after the moment has landed. Left running, a 0.3x
       * clock turns the last tenth of the track into seven real seconds and
       * the room stops watching.
       */
      if (race.slow < 1 && race.raceT >= race.slowUntil) {
        race.slow = 1;
        race.inPhoto = false;
      }

      const finalStraight = byPosition[0].p > 0.8;
      if (finalStraight && !race.finalCalled) {
        race.finalCalled = true;
        sfx.finalStraight();
      }

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

      painterRef.current?.paint(race.snails, {
        ranked,
        byPosition,
        leadP,
        meanRate: mean,
        photoFinish: race.inPhoto,
        finalStraight,
        justFinished: crossed,
      });

      /*
       * Feed the timing tower. Gaps are quoted in seconds behind the leader,
       * estimated from the leader's current closing rate, which is how a race
       * broadcast quotes them and is far more readable than a fraction of the
       * course.
       */
      if (race.raceT - boardAtRef.current > 140 && boardRef.current.size) {
        boardAtRef.current = race.raceT;
        const leader = ranked[0];
        /*
         * Quoted against the race's own pace rather than the leader's rate on
         * this frame. The instantaneous rate goes through zero whenever a
         * snail is in the trough of its noise, and dividing by it pinned every
         * gap on the board to the 99-second clamp - which is how the timing
         * tower ended up reading "+99.0s" for the whole field.
         */
        const perP = race.durationMs / 1000;
        const rows: BoardRow[] = ranked.map((s, i) => ({
          lane: s.lane,
          place: i + 1,
          gapText: s.done
            ? `${(s.finishMs / 1000).toFixed(1)}s`
            : i === 0
              ? 'leader'
              : `+${Math.min(99, (leader.p - s.p) * perP).toFixed(1)}s`,
        }));
        boardRef.current.forEach((cb) => cb(rows));
      }

      if (race.raceT - race.commentaryAt > 1600) {
        race.commentaryAt = race.raceT;
        if (lead) call(callLine(lead.p, lead.name, chaser.name));
      }

      if (race.placed < race.snails.length && race.raceT < race.tMax) {
        rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
      } else {
        finish();
      }
    },
    [announce, call, finish, hushMoment],
  );

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const start = useCallback(
    (names: string[], durationMs: number, surprises = true, laps = 1) => {
      if (phase === 'countdown' || phase === 'running') return;
      reset();
      painterRef.current?.measure();

      const drawn = drawRace(freshSeed(), names, durationMs, surprises);
      lapsRef.current = Math.max(1, laps);
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
        lapsDone: 0,
        leadLane: -1,
        finalCalled: false,
        inPhoto: false,
        results: [],
        highlights: [],
      };
      setSeedHex(drawn.seedHex);
      setEvents(drawn.events);
      setWeather(drawn.weather);
      silence();
      call(WEATHER_CALL[drawn.weather], 'big');
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
          call('And they are away!', 'big');
          painterRef.current?.start();
          rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
        }, steps.length * 900),
      );
    },
    [call, phase, reset],
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
    weather,
    onBoard,
    setPainter,
    start,
    reset,
  };
}
