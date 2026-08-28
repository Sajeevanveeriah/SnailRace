'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawRace, hexToSeed, rankSnails, stepRace, type DrawnRace } from './race-engine';
import type { BoardRow, RaceController, RaceMoment, RacePainter } from './use-race';
import type { RaceHistoryEntry } from './types';

/**
 * The recorded race, replayed from its seed.
 *
 * Position is a pure function of race-time, which is what makes a recorded
 * mode almost free: the archive re-draws the race from the seed and
 * configuration the audit block recorded, and the transport just moves the
 * clock. Seeking backwards re-draws and steps once to the target - cheap,
 * exact, and incapable of drifting from the result that was announced on the
 * night, because it is the same arithmetic.
 *
 * The controller implements the same `RaceController` seam the live loop
 * does, so the telecast and the straight track render a replay without
 * knowing they are not live. Sound stays off: a replay is a picture, and the
 * moderator may be talking over it.
 *
 * One entry per mount: the player is keyed on the race it plays, so `entry`
 * never changes underneath a live tape.
 */

export interface ReplayController extends RaceController {
  /** Transport. */
  playing: boolean;
  ended: boolean;
  /** Current race-time in ms, and the end of the tape. */
  t: number;
  tMax: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jump to a race-time, forwards or backwards. Frames update immediately. */
  seek: (ms: number) => void;
  restart: () => void;
}

/** How often the running-order board refreshes during a replay, in ms. */
const BOARD_EVERY = 140;

const noMoment: RaceMoment | null = null;

export function useReplay(entry: RaceHistoryEntry | null): ReplayController {
  const names = useMemo(
    () =>
      entry?.names ??
      entry?.results
        .slice()
        .sort((a, b) => a.lane - b.lane)
        .map((r) => r.name) ??
      [],
    [entry],
  );

  /** Rebuild the race from the seed, exactly as the night drew it. */
  const rebuild = useCallback((): DrawnRace | null => {
    if (!entry || names.length === 0) return null;
    const seed = hexToSeed(entry.seedHex);
    if (seed === null) return null;
    /* Intensity is part of what the seed drew (v2 commitments bind it), so a
       replay of a Big Night race re-deals the same drama, not standard's. */
    return drawRace(seed, names, entry.durationMs, entry.surprises ?? true, entry.intensity ?? 'standard');
  }, [entry, names]);

  /*
   * The tape's fixed facts - length, weather, the dealt surprises - are the
   * same on every re-draw of the same seed, so one draw serves the render
   * while the mutable copy the transport steps lives in a ref.
   */
  const tape = useMemo(() => rebuild(), [rebuild]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);

  const painterRef = useRef<RacePainter | null>(null);
  const drawnRef = useRef<DrawnRace | null>(null);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const placedRef = useRef(0);
  const boardRef = useRef<Set<(rows: BoardRow[]) => void>>(new Set());
  const boardAtRef = useRef(-1);
  /* The loop reads the clock through a ref so seeks land mid-flight. */
  const tRef = useRef(0);

  const tMax = tape?.tMax ?? 0;

  /** Advance the drawn race to `ms` and paint the frame. */
  const renderAt = useCallback(
    (ms: number, fresh: boolean) => {
      let race = drawnRef.current;
      if (!race || fresh) {
        race = rebuild();
        drawnRef.current = race;
        placedRef.current = 0;
      }
      if (!race) return;

      const { crossed } = stepRace(race.snails, ms, 16, placedRef.current);
      if (crossed.length) placedRef.current = crossed[crossed.length - 1].place;

      const info = rankSnails(race.snails);
      const leadP = race.snails.reduce((m, s) => (s.done ? 1 : Math.max(m, s.p)), 0);
      painterRef.current?.paint(race.snails, {
        ...info,
        leadP,
        meanRate: 0,
        photoFinish: false,
        finalStraight: leadP > 0.8,
        justFinished: crossed,
      });

      if (Math.abs(ms - boardAtRef.current) > BOARD_EVERY && boardRef.current.size) {
        boardAtRef.current = ms;
        const perP = race.durationMs / 1000;
        const leader = info.ranked[0];
        const rows: BoardRow[] = info.ranked.map((s, i) => ({
          lane: s.lane,
          place: i + 1,
          gapText: s.done
            ? `${(s.finishMs / 1000).toFixed(1)}s`
            : i === 0
              ? 'leader'
              : `+${Math.min(99, ((leader?.p ?? 0) - s.p) * perP).toFixed(1)}s`,
        }));
        boardRef.current.forEach((cb) => cb(rows));
      }
    },
    [rebuild],
  );

  const stopLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const frameRef = useRef<(now: number) => void>(() => {});
  const frame = useCallback(
    (now: number) => {
      const race = drawnRef.current;
      if (!race) return;
      let dt = now - lastRef.current;
      lastRef.current = now;
      if (dt > 100) dt = 100;
      const next = tRef.current + dt;

      if (next >= race.tMax) {
        tRef.current = race.tMax;
        renderAt(race.tMax, false);
        setT(race.tMax);
        setPlaying(false);
        setEnded(true);
        stopLoop();
        return;
      }

      tRef.current = next;
      renderAt(next, false);
      setT(next);
      rafRef.current = requestAnimationFrame((n) => frameRef.current(n));
    },
    [renderAt, stopLoop],
  );
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const play = useCallback(() => {
    if (!tape) return;
    if (!drawnRef.current) renderAt(tRef.current, true);
    if (tRef.current >= tape.tMax) {
      /* Play at the end of the tape starts it again. */
      tRef.current = 0;
      renderAt(0, true);
      setT(0);
    }
    setEnded(false);
    setPlaying(true);
    lastRef.current = performance.now();
    stopLoop();
    rafRef.current = requestAnimationFrame((n) => frameRef.current(n));
  }, [tape, renderAt, stopLoop]);

  const pause = useCallback(() => {
    stopLoop();
    setPlaying(false);
  }, [stopLoop]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, pause, play]);

  const seek = useCallback(
    (ms: number) => {
      if (!tape) return;
      let target = Math.min(tape.tMax, Math.max(0, ms));
      /* The scrubber quantises to whole milliseconds; the last step of the
         tape must still count as the end, or the slider can never finish. */
      if (tape.tMax - target < 1) target = tape.tMax;
      const backwards = target < tRef.current;
      tRef.current = target;
      /* Backwards means a fresh draw; forwards just steps on. Both are the
         same pure function of race-time, so the frame is exact either way. */
      renderAt(target, backwards);
      setT(target);
      setEnded(target >= tape.tMax);
      if (playing) lastRef.current = performance.now();
    },
    [tape, renderAt, playing],
  );

  const restart = useCallback(() => {
    stopLoop();
    setPlaying(false);
    setEnded(false);
    tRef.current = 0;
    renderAt(0, true);
    setT(0);
    painterRef.current?.measure();
  }, [renderAt, stopLoop]);

  /* Paint frame zero once the painter has registered, and stop on unmount. */
  useEffect(() => {
    const id = window.setTimeout(() => renderAt(tRef.current, true), 0);
    return () => {
      window.clearTimeout(id);
      stopLoop();
    };
  }, [renderAt, stopLoop]);

  const onBoard = useCallback((cb: (rows: BoardRow[]) => void) => {
    boardRef.current.add(cb);
    return () => {
      boardRef.current.delete(cb);
    };
  }, []);

  const setPainter = useCallback(
    (painter: RacePainter | null) => {
      painterRef.current = painter;
      painter?.measure();
      if (painter) renderAt(tRef.current, true);
    },
    [renderAt],
  );

  const winner = entry?.results.find((r) => r.place === 1);

  return {
    /* RaceController surface, so the live renderers draw the replay. */
    phase: ended ? 'done' : 'running',
    countdown: '',
    status: ended
      ? winner
        ? `${winner.name} wins!`
        : 'End of replay'
      : playing
        ? 'Replay'
        : 'Replay paused',
    commentary: '',
    seedHex: entry?.seedHex ?? '',
    photoFinish: false,
    results: entry?.results ?? [],
    events: tape?.events ?? [],
    moment: noMoment,
    weather: tape?.weather ?? 'clear',
    onBoard,
    setPainter,
    start: play,
    reset: restart,
    voidRace: () => {},
    /* Transport. */
    playing,
    ended,
    t,
    tMax,
    play,
    pause,
    toggle,
    seek,
    restart,
  };
}
