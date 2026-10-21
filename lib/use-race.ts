'use client';

import type { RecordedCue } from './audio/voice-cues';
import { recordedCueFor } from './audio/voice-cues';
import { voiceBusyMs, type SayOptions } from './audio/voice';
import { winnerSting } from './audio/music';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  callLine,
  countdownLine,
  drawRace,
  type IntensityId,
  CAPTION_MAX,
  eventLine,
  fitCaption,
  shortName,
  freshSeed,
  instantiateLockedRace,
  leadChangeLine,
  rankSnails,
  runInProgress,
  lapLine,
  LENGTHS_PER_LAP,
  mulberry32,
  overtakeLine,
  runHomeCue,
  runHomeLine,
  sectorCall,
  stepRace,
  togetherLine,
  TOGETHER_SECONDS,
  trackWording,
  TWIST_HOLD_MS,
  winnerLine,
  type DrawnRace,
  type EventTone,
  type EventSound,
  type RaceEvent,
  type SnailRun,
  type TrackWording,
  type Weather,
} from './race-engine';
import { say, setIntensity, sfx, silence, startTrack } from './sound';
import type { LockedRaceEvent, LockedRacePlan, RaceHighlight, RaceResult } from './types';

/** How much race-time the photo-finish slow-motion covers, at 0.3x speed. */
const SLOWMO_RACE_MS = 620;

/** How long a surprise banner stays up, in real milliseconds. */
const MOMENT_MS = 1800;

/**
 * Past this point the banner is muted, unless it is the twist at the post.
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

/** The last 15% of the race belongs to the leaders and the run home. */
export const RUN_HOME_FROM = 0.85;

/** Inside this much of the race, two snails under a length apart is a photo. */
const PHOTO_FROM = 0.9;

/** The run-home line stays on the strap at least this long. */
export const RUN_HOME_HOLD_MS = 3000;
/** No minor call starts inside the last this-many milliseconds: it would be cut by the winner. */
export const NO_MINOR_CALL_MS = 3000;
/**
 * A lap, sector or filler call is not started when the run home is due
 * within this long: its clip would still be playing when the run home
 * lands, so the run-home call would be late and cut by the winner.
 */
export const RUN_HOME_CLEARANCE_MS = 4000;
/** About how long a recorded finish call runs; used to decide whether it can finish before the line. */
export const FINISH_CLIP_MS = 2600;
/** How long an ordinary call owns the strap before the next may replace it. */
export const CALL_HOLD_MS = 2600;
/** A run-of-play line is offered after this long with nothing said. */
export const SILENCE_FILL_MS = 5000;

/**
 * How long a landed twist owns the course on the side-on painter (the slam,
 * the read, the park) and the breath before the next card. The caller's
 * on-air gate uses the same clock, so a finish call never talks over a card
 * that is still up.
 */
export const STORY_CARD_MS = TWIST_HOLD_MS;
export const STORY_GAP_MS = 400;
/** The least a landed card stays up before anything may replace it. */
export const STORY_READ_MS = 900;

/**
 * The finish moment: the line is held this long, with the winner called,
 * before the result is settled and the winner overlay goes up.
 */
export const FINISH_CONFIRM_MS = 2500;

/**
 * The order the caller ranks what it could say, most important first. A
 * twist's own hit line is tied to its card and always goes out on time; the
 * rest wait their turn for a free strap, best first.
 */
export const CALL_RANK = {
  lead: 0,
  runHome: 0,
  together: 0,
  top3: 1,
  finalLap: 1,
  twist: 2,
  lap: 3,
  sector: 4,
  fourth: 5,
  filler: 6,
} as const;

/**
 * The live lifecycle: READY, COUNTDOWN, RUNNING, FINISHED, VOID. `idle` is
 * READY and `done` is FINISHED; the stage banner translates. VOID is reached
 * only through the moderator's void action and always leaves an audit entry.
 */
export type RacePhase = 'idle' | 'countdown' | 'running' | 'confirming' | 'done' | 'void';

export type MomentTone = 'good' | 'bad' | 'hot';
export type SurprisePhase = 'warning' | 'reveal' | 'effect';

/**
 * A `wild` surprise gets the hot banner. Its magnitude is drawn either side
 * of zero, so at the moment it lands nobody knows whether it was a good thing
 * - and a banner that has already decided would be lying to the room.
 */
const momentTone = (tone: EventTone): MomentTone =>
  tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : 'hot';

/** A shout for the middle of the track: one twist's warning, reveal or hit. */
export interface RaceMoment {
  /** Bumped on every moment so the banner replays its keyframe. */
  id: number;
  text: string;
  tone: MomentTone;
  /**
   * A field event rather than one snail's bad luck. The stage gives these a
   * wider card and a jolt of the camera, because "the magpie is back" is a
   * different size of news from "Gary is having a nap".
   */
  big?: boolean;
  phase?: SurprisePhase;
  eventId?: string;
  label?: string;
  kind?: string;
  targetLanes?: number[];
  consequence?: 'advance' | 'delay' | 'retire';
  deltaMs?: number;
}

/**
 * Everything a renderer needs on a given frame, gathered once by the loop.
 *
 * Two orderings, deliberately: `byPosition` for the drama cues and `ranked`
 * for what the crowd reads - see `rankSnails`.
 */
export interface PaintInfo {
  /** Authoritative simulation time, shared by live coverage and replay. */
  raceTimeMs: number;
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
  /** The lap the leader is on, from 1, and how many there are. Absent on a replay. */
  lap?: number;
  laps?: number;
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

/** A timing split, published when the leader passes a sector or lap mark. */
export interface RaceSplit {
  id: number;
  /** "LAP 2 OF 4", "FINAL LAP", "HALFWAY" and so on. */
  label: string;
  leader: string;
  chaser: string;
  gapSeconds: number;
  atMs: number;
}

/**
 * The leader has crossed the line to start a new lap. Published the frame it
 * happens, for the lap wipe; the caller's "Lap 2 of 4" follows on the strap.
 */
export interface LapEvent {
  id: number;
  /** The lap being started, from 2. */
  lap: number;
  laps: number;
  /** The last lap of a race of two or more. */
  final: boolean;
  leaderLane: number;
  leader: string;
  atMs: number;
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
  /**
   * Subscribe to timing splits. Published like the board, through a
   * subscription rather than React state, so a split re-renders only the
   * chip that shows it and never the whole stage mid-race.
   */
  onSplit: (cb: (split: RaceSplit) => void) => () => void;
  /** Subscribe to lap changes on a circuit, for the lap wipe. Live races only. */
  onLap?: (cb: (lap: LapEvent) => void) => () => void;
  /** Laps in the race in progress; 1 on the straight. */
  laps?: number;
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
  /**
   * Unregister a renderer, but only if it is still the registered one. When
   * the stage swaps track designs the incoming renderer can register before
   * the outgoing one cleans up; clearing by identity keeps the newcomer.
   */
  releasePainter: (painter: RacePainter) => void;
  start: (
    names: string[],
    durationMs: number,
    surprises?: boolean,
    laps?: number,
    intensity?: IntensityId,
  ) => void;
  /** Start a race that was completely drawn and hashed before countdown. */
  startLocked: (plan: LockedRacePlan) => void;
  reset: () => void;
  /**
   * Abandon the race in progress: no result, no settlement. The countdown or
   * the field freezes and the stage shows VOID until the next reset or start.
   */
  voidRace: () => void;
}

/** A line the caller could say, waiting for a free strap. */
interface PendingCall {
  key: string;
  text: string;
  rank: number;
  priority: 'big' | 'call';
  cue?: RecordedCue;
  /** Fall back to this cue when the first is resting. */
  altCue?: RecordedCue;
  opts?: SayOptions;
  /** How long it owns the strap once said. */
  hold: number;
  /** Race time after which it is stale. */
  expires: number;
  /** Still true of the race? Checked again just before it is said. */
  valid?: () => boolean;
  /** Played as it is said. */
  sound?: () => void;
  onSaid?: () => void;
}

interface LiveRace extends DrawnRace {
  raceT: number;
  last: number;
  slow: number;
  placed: number;
  slowmoUsed: boolean;
  /** Race-time at which slow-motion hands back to normal speed. */
  slowUntil: number;
  /** A separate seeded stream for wording. Replays now tell the same story. */
  commentaryRnd: () => number;
  /** Field events already shouted, so a swarm is announced once. */
  swarms: Set<string>;
  /** Place each lane held last time the order was checked, for overtakes. */
  places: Map<number, number>;
  /** Which quarter-mark call has already been made. */
  sector: number;
  /** How many laps of the circuit the leader has already completed. */
  lapsDone: number;
  /** Lane currently in front, for spotting a change of leader. */
  leadLane: number;
  /** The run-home cue fires once, not on every frame past the threshold. */
  finalCalled: boolean;
  /** The run home has been queued. */
  runHomeQueued: boolean;
  /** The close-finish call is made once. */
  photoCalled: boolean;
  /** The closing call a few seconds out, said at most once. */
  lineCalled: boolean;
  /** True while the photo-finish slow-motion is running. */
  inPhoto: boolean;
  results: RaceResult[];
  highlights: RaceHighlight[];
  /** Next immutable event cue to deliver in a locked race. */
  cueIndex: number;
  /** Guards the first-finisher path against duplicate frames. */
  confirming: boolean;
  /** The field is running in behind the winner during the finish hold. */
  runningIn: boolean;
  /** Which words fit this course. */
  wording: TrackWording;
  /** Race time the race will be won, as near as the loop knows. */
  stopAt: number;
  /** Twist hit lines still to come, in race time. */
  twistLines: number[];
  /** The "at the post" hit, if the plan has one. */
  postHitAt: number | null;
  /** What is on the strap now. */
  air: { key: string; rank: number; until: number };
  pending: PendingCall[];
  lastCallAt: number;
}

/** The last countdown line of the night, so the next race opens differently. */
let lastCountdown: string | undefined;

/** The clip for a twist's hit line: its own gag if it has one, else which way it went. */
function twistCue(event: LockedRaceEvent): RecordedCue {
  if (event.consequence === 'retire') return 'retire';
  const own = recordedCueFor(event.label);
  if (own && own !== 'winner' && own !== 'start') return own;
  const deltas = event.targetLanes.map((lane) => event.clockDeltaMsByLane[lane] ?? 0);
  const mixed = deltas.some((d) => d > 0) && deltas.some((d) => d < 0);
  if (mixed) return 'chaos';
  return deltas.every((d) => d >= 0) ? 'boost' : 'delay';
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
  const [laps, setLaps] = useState(1);
  const lastEffectAtRef = useRef(-Infinity);
  const [weather, setWeather] = useState<Weather>('clear');
  const splitIdRef = useRef(0);
  const splitRef = useRef<Set<(split: RaceSplit) => void>>(new Set());
  const onSplit = useCallback((cb: (split: RaceSplit) => void) => {
    splitRef.current.add(cb);
    return () => {
      splitRef.current.delete(cb);
    };
  }, []);
  const lapIdRef = useRef(0);
  const lapRef = useRef<Set<(lap: LapEvent) => void>>(new Set());
  const onLap = useCallback((cb: (lap: LapEvent) => void) => {
    lapRef.current.add(cb);
    return () => {
      lapRef.current.delete(cb);
    };
  }, []);

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
  /** Laps of the circuit, so the loop can call every lap. 1 on lanes. */
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
  const releasePainter = useCallback((painter: RacePainter) => {
    if (painterRef.current === painter) painterRef.current = null;
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
   * Shout something across the middle of the track: one twist's card.
   *
   * One banner at a time: the newer moment is always the one the room is
   * looking at. The plan keeps every twist a story apart, so a warning never
   * has to wait for the hit before it.
   */
  const announce = useCallback((
    text: string,
    tone: MomentTone,
    big = false,
    detail: Omit<Partial<RaceMoment>, 'id' | 'text' | 'tone' | 'big'> = {},
  ) => {
    const now = Date.now();
    if ((detail.phase === 'warning' || detail.phase === 'reveal') && now - lastEffectAtRef.current < STORY_READ_MS) return;
    if (detail.phase === 'effect' || detail.phase === undefined) lastEffectAtRef.current = now;
    momentIdRef.current += 1;
    setMoment({ id: momentIdRef.current, text, tone, big, ...detail });
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
  const call = useCallback((
    text: string,
    priority: 'big' | 'call' | 'finish' = 'call',
    cue?: RecordedCue,
    opts?: SayOptions,
    altCue?: RecordedCue,
  ) => {
    setCommentary(text);
    if (!say(text, priority, cue, opts) && altCue) say(text, priority, altCue, opts);
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
    boardAtRef.current = -Infinity;
    boardRef.current.forEach((cb) => cb([]));
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
    if (!race || race.confirming) return;

    if (race.lockedPlan) {
      race.confirming = true;
      const ordered = race.lockedPlan.results
        .slice()
        .sort((a, b) => a.place - b.place);
      const winner = ordered[0];
      setResults(ordered);
      setPhase('confirming');
      setStatus(winner ? `${winner.name} wins!` : 'Race over');
      if (winner) {
        const second = race.snails.find((s) => s.lane === ordered[1]?.lane);
        const onTheLine = second ? (1 - second.p) * (race.durationMs / 1000) < TOGETHER_SECONDS : false;
        call(winnerLine(winner.name, onTheLine), 'finish', 'winner');
      }
      startTrack('winner');
      winnerSting();

      /* The line is held for the finish moment before the result card, and
         the rest of the field runs in behind the winner in its official
         order. The result is settled once, below, and never again. */
      const plan = race.lockedPlan;
      const runIn = (now: number) => {
        if (raceRef.current !== race || !race.runningIn) return;
        const elapsed = race.last ? Math.max(0, Math.min(100, now - race.last)) : 16;
        race.last = now;
        race.raceT += elapsed;
        const positions = runInProgress(plan, race.raceT);
        for (const s of race.snails) {
          const p = positions.get(s.lane);
          if (p === undefined || s.retired) continue;
          s.rate = (Math.max(s.p, p) - s.p) / (elapsed || 16);
          s.p = Math.max(s.p, p);
          s.prevP = s.p;
        }
        const settled = rankSnails(race.snails);
        painterRef.current?.paint(race.snails, {
          ...settled,
          raceTimeMs: race.raceT,
          leadP: 1,
          meanRate: 0,
          photoFinish: false,
          finalStraight: true,
          justFinished: [],
          lap: lapsRef.current,
          laps: lapsRef.current,
        });
        rafRef.current = requestAnimationFrame(runIn);
      };
      race.last = 0;
      race.runningIn = true;
      rafRef.current = requestAnimationFrame(runIn);

      timersRef.current.push(
        window.setTimeout(() => {
          if (raceRef.current !== race) return;
          race.runningIn = false;
          stop();
          setPhase('done');
          finishRef.current(race, ordered, race.highlights);
        }, FINISH_CONFIRM_MS),
      );
      return;
    }

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
        raceTimeMs: race.raceT,
        leadP: 1,
        meanRate: 0,
        photoFinish: false,
        finalStraight: true,
        justFinished: unplaced,
        lap: lapsRef.current,
        laps: lapsRef.current,
      });
    }

    const ordered = race.results.slice().sort((a, b) => a.place - b.place);
    setResults(ordered);
    setPhase('done');
    setStatus(ordered[0] ? `${ordered[0].name} wins!` : 'Race over');
    if (ordered[0]) {
      const first = ordered[0];
      const second = ordered[1];
      const margin =
        second && typeof second.finishMs === 'number' && typeof first.finishMs === 'number'
          ? second.finishMs - first.finishMs
          : 0;
      call(winnerLine(first.name, Boolean(margin && margin < 300)), 'finish', 'winner');
    }
    startTrack('winner');
    winnerSting();
    finishRef.current(race, ordered, race.highlights);
  }, [call, stop]);

  const frame = useCallback(
    (now: number) => {
      const race = raceRef.current;
      if (!race) return;

      if (!race.last) race.last = now;
      const elapsed = Math.max(0, now - race.last);
      race.last = now;
      // Progress is a pure function of race time. Catch up after a slow frame
      // or background tab; only the instantaneous effort estimate is bounded.
      const dt = Math.min(100, elapsed);
      race.raceT += elapsed * race.slow;
      if (race.lockedPlan) race.raceT = Math.min(race.raceT, race.lockedPlan.stopAtMs);

      const { crossed, fired } = stepRace(race.snails, race.raceT, dt, race.placed);
      const leadP = race.snails.reduce(
        (m, s) => (s.done && !s.retired ? 1 : Math.max(m, s.p)),
        0,
      );
      /* Late in a legacy race the banners stand down for the run home. A
         locked plan never has an ordinary twist there, and its card at the
         post is the one card that must be seen. */
      const quiet = !race.lockedPlan && leadP > MOMENT_UNTIL;
      if (quiet) hushMoment();

      /** Say a line now and give it the strap. */
      const deliver = (item: PendingCall) => {
        /* A finish call whose clip could not end before the line goes on the
           strap only: started late, the winner call would cut it mid-word. */
        const toLine = race.stopAt - race.raceT;
        const lateFinishCall = (item.key === 'runhome' || item.key === 'together' || item.key === 'toline') && voiceBusyMs() + FINISH_CLIP_MS > toLine;
        if (lateFinishCall) setCommentary(item.text);
        else call(item.text, item.priority, item.cue, item.opts, item.altCue);
        item.sound?.();
        item.onSaid?.();
        race.air = { key: item.key, rank: item.rank, until: race.raceT + item.hold };
        race.lastCallAt = race.raceT;
      };
      /** Offer a line; a newer offer with the same key replaces the old one. */
      const offer = (item: PendingCall) => {
        race.pending = race.pending.filter((p) => p.key !== item.key);
        race.pending.push(item);
      };

      /*
       * The plan's twists. Each one's warning, reveal and hit are cards; its
       * hit line goes on the strap at once, tied to its card, and owns the
       * strap until the card parks.
       */
      if (race.lockedPlan) {
        const cues = race.lockedPlan.cues;
        while (race.cueIndex < cues.length && cues[race.cueIndex].atMs <= race.raceT) {
          const cue = cues[race.cueIndex++];
          const event = race.lockedPlan.events.find((candidate) => candidate.id === cue.eventId);
          /* Every twist in a locked plan gets its warning, its reveal and its hit card. */
          const detail: Omit<Partial<RaceMoment>, 'id' | 'text' | 'tone' | 'big'> = event ? {
            eventId: event.id,
            phase: cue.phase === 'commentary' ? undefined : cue.phase as SurprisePhase,
            label: event.label,
            kind: event.kind,
            targetLanes: event.targetLanes,
            consequence: event.consequence,
            deltaMs: event.clockDeltaMsByLane[event.targetLanes[0]] ?? 0,
          } : {};
          if (cue.phase === 'warning') {
            announce(cue.text, 'hot', cue.big, detail);
            /* The warning is the INCOMING card. It is not called: the strap
               and the voice would run ahead of the card. The hit is called
               when it lands. */
            sfx.event((cue.sound ?? 'siren') as EventSound);
          } else if (cue.phase === 'reveal') {
            announce(cue.text, momentTone(cue.tone ?? 'wild'), cue.big, detail);
          } else if (cue.phase === 'effect') {
            announce(cue.text, momentTone(cue.tone ?? 'wild'), cue.big, detail);
            sfx.event((cue.sound ?? event?.sound ?? 'weird') as EventSound);
            if (event) {
              for (const lane of event.targetLanes) {
                race.highlights.push({
                  atMs: event.effectAtMs,
                  lane,
                  name: race.snails[lane]?.name ?? `Lane ${lane + 1}`,
                  kind: event.kind,
                  label: event.label,
                });
              }
            }
          } else {
            race.twistLines = race.twistLines.filter((at) => at > cue.atMs);
            deliver({
              key: `twist-${cue.eventId}`,
              text: cue.text,
              rank: CALL_RANK.twist,
              priority: 'big',
              cue: event ? twistCue(event) : undefined,
              opts: { preempt: true, twist: true },
              hold: Math.max(CALL_HOLD_MS, (event ? event.effectAtMs + TWIST_HOLD_MS : race.raceT + CALL_HOLD_MS) - race.raceT),
              expires: Infinity,
            });
          }
        }
      }

      /* The legacy all-finisher path: surprises fire as their envelopes open. */
      const shouted = new Set<string>();
      for (const { event, snail } of fired) {
        race.highlights.push({
          atMs: Math.round(race.raceT),
          lane: snail.lane,
          name: snail.name,
          kind: event.kind,
          label: event.label,
        });

        if (event.group) {
          if (race.swarms.has(event.group)) continue;
          if (shouted.has(event.group)) continue;
          shouted.add(event.group);
          race.swarms.add(event.group);
          deliver({
            key: `twist-${event.group}`, text: event.groupCall ?? event.label, rank: CALL_RANK.twist, priority: 'big',
            cue: recordedCueFor(event.label), opts: { preempt: true, twist: true }, hold: CALL_HOLD_MS, expires: Infinity,
          });
          if (!quiet) announce(event.groupLabel ?? event.label, momentTone(event.tone), true, {
            phase: 'effect', label: event.groupLabel ?? event.label, kind: event.kind,
            targetLanes: race.snails.filter((candidate) => candidate.events.some((item) => item.group === event.group)).map((candidate) => candidate.lane),
          });
          sfx.event(event.sound);
          continue;
        }

        /* The caption names the snail; the clip only says which way it went. */
        deliver({
          key: `twist-${event.id}`, text: eventLine(event, snail.name), rank: CALL_RANK.twist, priority: 'big',
          cue: recordedCueFor(event.label) ?? (event.tone === 'good' ? 'boost' : event.tone === 'bad' ? 'delay' : 'chaos'),
          opts: { preempt: true, twist: true }, hold: CALL_HOLD_MS, expires: Infinity,
        });
        if (!quiet) announce(`${snail.name}: ${event.label}`, momentTone(event.tone), false, {
          phase: 'effect', label: event.label, kind: event.kind, targetLanes: [snail.lane],
        });
        sfx.event(event.sound);
      }

      for (const s of crossed) {
        race.placed = s.place;
        race.results.push({ lane: s.lane, name: s.name, place: s.place, finishMs: s.finishMs });
      }

      const { byPosition, ranked } = rankSnails(race.snails);
      const lead = byPosition[0];
      const chaser = byPosition[1] ?? lead;
      const third = byPosition[2] ?? chaser;
      const laps = lapsRef.current;
      /* Progress is 0..1 over the whole race, so a lane unit is worth a lap's
         worth of lengths times the number of laps. */
      const toLengths = (dp: number) => Math.max(0, dp) * laps * LENGTHS_PER_LAP;
      const toSeconds = (dp: number) => Math.max(0, dp) * (race.durationMs / 1000);
      const gapP = lead && chaser && chaser.lane !== lead.lane ? lead.p - chaser.p : 1;
      const gapLengths = toLengths(gapP);
      const gapSeconds = toSeconds(gapP);
      const racing = Boolean(lead) && !lead.done && race.placed === 0;
      const leaderLane = () => rankSnails(race.snails).byPosition[0]?.lane;
      const placeOf = (lane: number) => rankSnails(race.snails).byPosition.findIndex((s) => s.lane === lane) + 1;

      /*
       * A change of leader is the single loudest thing that happens in a
       * race. Guarded on the leader still being on the track: the moment the
       * first snail is home every other lane "takes the lead" in turn as it
       * finishes. If a twist owns the strap, it waits its turn and is only
       * said if it is still true.
       */
      if (racing && lead.p > LEAD_CHANGE_FROM && race.leadLane !== -1 && lead.lane !== race.leadLane) {
        const deposed = race.snails.find((s) => s.lane === race.leadLane);
        const newLeader = lead.lane;
        offer({
          key: 'lead', text: leadChangeLine(lead.name, deposed?.name ?? chaser.name, race.commentaryRnd),
          rank: CALL_RANK.lead, priority: 'big', cue: 'lead', opts: { preempt: true }, hold: CALL_HOLD_MS,
          expires: race.raceT + 2500, valid: () => leaderLane() === newLeader,
          sound: () => sfx.leadChange(),
        });
      }
      if (lead && !lead.done) race.leadLane = lead.lane;

      /*
       * Moves into the top three, by name and place. The fourth is called
       * only when nothing else wants the strap; nobody calls fifth or lower.
       */
      if (racing) {
        for (let i = 1; i <= 3 && i < byPosition.length; i++) {
          const s = byPosition[i];
          const was = race.places.get(s.lane);
          if (was === undefined || was <= i + 1) continue;
          if (s.done || s.p < 0.12) continue;
          const passed = byPosition[i + 1];
          if (!passed) continue;
          const place = i + 1;
          const lane = s.lane;
          offer({
            key: `place-${place}`, text: overtakeLine(s.name, passed.name, place, race.commentaryRnd),
            rank: place <= 3 ? CALL_RANK.top3 : CALL_RANK.fourth, priority: place <= 3 ? 'big' : 'call',
            cue: 'overtake', hold: CALL_HOLD_MS, expires: race.raceT + 2000,
            valid: () => placeOf(lane) === place,
            sound: () => sfx.crowd.cheer(0.45),
          });
        }
      }
      byPosition.forEach((s, i) => race.places.set(s.lane, i + 1));

      /* The timing graphic. Quoted against race pace like the board. */
      const publishSplit = (label: string) => {
        if (!lead) return;
        const second = byPosition[1];
        splitIdRef.current += 1;
        const split: RaceSplit = {
          id: splitIdRef.current,
          label,
          leader: lead.name,
          chaser: second && second.lane !== lead.lane ? second.name : '',
          gapSeconds: second ? toSeconds(lead.p - second.p) : 0,
          atMs: race.raceT,
        };
        splitRef.current.forEach((cb) => cb(split));
      };

      /*
       * Rhythm for a long race. On a circuit that is the leader crossing the
       * line, every lap, and a clear final-lap call. On straight lanes there
       * is nothing to cross, so the quarter marks stand in for it.
       */
      const currentLap = lead ? Math.min(laps, Math.floor(Math.min(0.999999, leadP) * laps) + 1) : 1;
      if (lead && !lead.done && laps > 1) {
        const done = Math.floor(lead.p * laps);
        if (done > race.lapsDone && done < laps) {
          race.lapsDone = done;
          const starting = done + 1;
          const final = starting === laps;
          publishSplit(final ? 'FINAL LAP' : `LAP ${starting} OF ${laps}`);
          lapIdRef.current += 1;
          const lapEvent: LapEvent = {
            id: lapIdRef.current, lap: starting, laps, final, leaderLane: lead.lane, leader: lead.name, atMs: race.raceT,
          };
          lapRef.current.forEach((cb) => cb(lapEvent));
          sfx.bell();
          if (final) sfx.crowd.roar(0.8);
          const lapMs = race.durationMs / laps;
          offer({
            key: `lap-${starting}`, text: lapLine(starting, laps, lead.name, chaser.name, race.commentaryRnd),
            rank: final ? CALL_RANK.finalLap : CALL_RANK.lap, priority: 'big', cue: final ? 'bell' : 'lap',
            hold: CALL_HOLD_MS, expires: race.raceT + Math.max(2500, Math.min(6000, lapMs * 0.45)),
            valid: () => race.lapsDone === done,
          });
        }
      } else if (lead && !lead.done) {
        const sector = Math.floor(lead.p * 4);
        if (sector > race.sector && sector <= 3) {
          race.sector = sector;
          publishSplit(sector === 2 ? 'HALFWAY' : sector === 1 ? 'QUARTER' : 'THREE-QUARTER');
          const said = sectorCall(sector, lead.name, chaser.name, gapLengths, gapSeconds, race.wording);
          if (said) {
            offer({
              key: `sector-${sector}`, text: said.text, rank: CALL_RANK.sector, priority: 'big',
              cue: said.cue, opts: said.takes ? { takes: said.takes } : undefined, hold: CALL_HOLD_MS,
              expires: race.raceT + Math.max(4000, race.durationMs * 0.09),
              sound: sector === 2 ? () => sfx.bell() : undefined,
            });
          }
        }
      }

      /*
       * The run home: said once, on the leaders, and left on the strap. When
       * the race ends with a twist at the post, it is said early enough to
       * own the strap for its full hold before that twist's line.
       */
      const postSoon = race.postHitAt !== null && race.raceT >= race.postHitAt - RUN_HOME_HOLD_MS - 400 && leadP > 0.7;
      if (racing && !race.runHomeQueued && (lead.p > RUN_HOME_FROM || postSoon)) {
        race.runHomeQueued = true;
        offer({
          key: 'runhome', text: runHomeLine(race.wording, lead.name, chaser.name, race.commentaryRnd),
          rank: CALL_RANK.runHome, priority: 'big', cue: runHomeCue(race.wording), opts: { preempt: true },
          hold: RUN_HOME_HOLD_MS, expires: Infinity,
        });
      }
      if (
        racing && !race.photoCalled && lead.p > PHOTO_FROM && chaser.lane !== lead.lane &&
        gapSeconds < TOGETHER_SECONDS && toLengths(lead.p - chaser.p) < 1
      ) {
        race.photoCalled = true;
        const pair = [lead.lane, chaser.lane];
        offer({
          key: 'together', text: togetherLine(lead.name, chaser.name, race.commentaryRnd),
          rank: CALL_RANK.together, priority: 'big', cue: 'photo', opts: { preempt: true }, hold: CALL_HOLD_MS,
          expires: race.stopAt,
          valid: () => {
            const order = rankSnails(race.snails).byPosition;
            const gap = order[0] && order[1] ? toSeconds(order[0].p - order[1].p) : 1;
            return gap < TOGETHER_SECONDS && pair.includes(order[0].lane) && pair.includes(order[1].lane);
          },
        });
      }

      /*
       * The closing call: a few seconds out, if the caller has gone quiet
       * since the run home, one last line to carry the room to the line.
       */
      const toLineMs = race.stopAt - race.raceT;
      if (
        racing && race.runHomeQueued && !race.lineCalled && !race.photoCalled &&
        toLineMs < 5500 && toLineMs > 3000 && race.raceT - race.lastCallAt > 3500 && chaser.lane !== lead.lane
      ) {
        race.lineCalled = true;
        const clear = gapLengths >= 2;
        const lines = clear
          ? [`${lead.name} has daylight! ${chaser.name} cannot get there!`, `${shortName(lead.name)} has daylight! ${shortName(chaser.name)} cannot get there!`, `${shortName(lead.name, 12)} has daylight to the line!`]
          : [`To the line! ${lead.name} from ${chaser.name}!`, `To the line! ${shortName(lead.name)} from ${shortName(chaser.name)}!`, `To the line! ${shortName(lead.name, 12)} from ${shortName(chaser.name, 12)}!`];
        offer({
          key: 'toline', text: fitCaption(lines), rank: CALL_RANK.runHome, priority: 'big',
          cue: clear ? 'clear' : 'finalCircuit', opts: { takes: [3], preempt: true }, hold: CALL_HOLD_MS,
          expires: race.stopAt - 2500,
        });
      }

      /*
       * Nothing said for a while and nothing coming: quote the race. The
       * caller talks about the leaders, never the back of the field.
       */
      const nextTwistLine = race.twistLines.find((at) => at >= race.raceT) ?? Infinity;
      if (
        racing && !race.pending.length && race.raceT >= race.air.until &&
        race.raceT - race.lastCallAt >= SILENCE_FILL_MS && leadP > 0.1 && leadP < RUN_HOME_FROM - 0.05 &&
        nextTwistLine - race.raceT > NO_MINOR_CALL_MS
      ) {
        const text = callLine({
          leadP, lead: lead.name, chase: chaser.name, third: third.name, tail: '',
          gapLengths, toGoLengths: toLengths(1 - lead.p), gapSeconds,
        }, race.commentaryRnd);
        const cue: RecordedCue = gapSeconds < TOGETHER_SECONDS ? 'close' : gapLengths > 4 && leadP > 0.3 ? 'clear' : leadP < 0.3 ? 'early' : 'mid';
        offer({
          key: 'filler', text, rank: CALL_RANK.filler, priority: 'big', cue, altCue: cue === 'mid' ? 'early' : 'mid',
          hold: CALL_HOLD_MS, expires: race.raceT + 800,
        });
      }

      /*
       * Choose what goes on the strap. A twist's line is already on it. In
       * the last 15% only the leaders are called; in the last three seconds
       * only a lead change or a close finish; just before a twist's line,
       * nothing minor is started that the twist would have to cut.
       */
      race.pending = race.pending.filter((p) => p.expires > race.raceT && (!p.valid || p.valid()));
      if (racing && race.pending.length) {
        const toFinish = race.stopAt - race.raceT;
        const runHome = leadP > RUN_HOME_FROM || race.air.key === 'runhome';
        const allowed = (p: PendingCall) => {
          if (toFinish < NO_MINOR_CALL_MS && p.rank > CALL_RANK.lead) return false;
          if (runHome && p.rank > CALL_RANK.top3) return false;
          if (!runHome && p.rank >= CALL_RANK.lap && (RUN_HOME_FROM - leadP) * race.durationMs < RUN_HOME_CLEARANCE_MS) return false;
          if (nextTwistLine - race.raceT < NO_MINOR_CALL_MS && p.rank > CALL_RANK.top3) return false;
          /* A twist's line is about to take the strap: nothing but a lead change starts now, or it would flash for a moment and vanish. */
          if (nextTwistLine - race.raceT < CALL_HOLD_MS && p.rank > CALL_RANK.lead) return false;
          if (p.rank === CALL_RANK.fourth && race.pending.some((other) => other !== p && other.rank < p.rank)) return false;
          return true;
        };
        const best = race.pending
          .filter(allowed)
          .sort((a, b) => a.rank - b.rank)[0];
        const free = race.raceT >= race.air.until;
        /* A lead change may cut a minor line short, never a twist or the run home. */
        const cut = best && !free && best.rank === CALL_RANK.lead && race.air.rank >= CALL_RANK.lap;
        const voiceFree = voiceBusyMs() < 350 || (best?.opts?.preempt ?? false);
        if (best && (free || cut) && voiceFree) {
          race.pending = race.pending.filter((p) => p !== best);
          /* A lead or top-3 call that lands on a lap change carries the lap
             with it, so short laps are still all named on the strap. */
          const lapCall = best.rank <= CALL_RANK.top3 && !best.key.startsWith('lap-')
            ? race.pending.find((p) => p.key.startsWith('lap-') && p.rank === CALL_RANK.lap)
            : undefined;
          const lapPrefix = lapCall ? `Lap ${lapCall.key.slice(4)} of ${laps}: ` : '';
          if (lapCall && lapPrefix.length + best.text.length <= CAPTION_MAX) {
            race.pending = race.pending.filter((p) => p !== lapCall);
            deliver({ ...best, text: lapPrefix + best.text });
          } else {
            deliver(best);
          }
        }
      }

      /*
       * The photo finish.
       *
       * Gated on the margin the SEED drew - one race in four is a genuine
       * squeaker - and on the two of them actually being locked together at
       * the time.
       */
      if (
        !race.slowmoUsed &&
        race.photoFinish &&
        byPosition.length > 1 &&
        !byPosition[0].done &&
        byPosition[0].p > 0.9 &&
        byPosition[0].p - byPosition[1].p < 0.018
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
        raceTimeMs: race.raceT,
        leadP,
        meanRate: mean,
        photoFinish: race.inPhoto,
        finalStraight,
        justFinished: crossed,
        lap: currentLap,
        laps,
      });

      /*
       * Feed the timing tower. Gaps are quoted in seconds behind the leader,
       * against the race's own pace rather than the leader's rate on this
       * frame, which goes through zero in the trough of the wobble.
       */
      if (race.raceT - boardAtRef.current > 140 && boardRef.current.size) {
        boardAtRef.current = race.raceT;
        const leader = ranked[0];
        const perP = race.durationMs / 1000;
        const rows: BoardRow[] = ranked.map((s, i) => ({
          lane: s.lane,
          place: i + 1,
          gapText: s.retired
            ? 'RET'
            : s.done
            ? `${(s.finishMs / 1000).toFixed(1)}s`
            : i === 0
              ? 'leader'
              : `+${Math.min(99, (leader.p - s.p) * perP).toFixed(1)}s`,
        }));
        boardRef.current.forEach((cb) => cb(rows));
      }

      /* A locked race is over on the first active crossing. Paint that exact
         frame, publish its already locked classification, and never request
         another animation frame for the trailing or retired runners. */
      if (
        race.lockedPlan &&
        (crossed.some((snail) => snail.lane === race.lockedPlan!.winnerLane) ||
          race.raceT >= race.lockedPlan.stopAtMs)
      ) {
        finish();
        return;
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

  const startDrawn = useCallback(
    (drawn: DrawnRace, lapCount = 1) => {
      if (phase === 'countdown' || phase === 'running' || phase === 'confirming') return;
      reset();
      painterRef.current?.measure();

      lapsRef.current = Math.max(1, lapCount);
      setLaps(lapsRef.current);
      const plan = drawn.lockedPlan;
      const wording = trackWording(plan?.trackShape ?? (lapsRef.current > 1 ? 'circuit' : 'lanes'), plan?.courseId);
      const postHit = plan?.events.find((event) => /AT THE (POST|LINE)/.test(event.label));
      const stopAt = plan?.stopAtMs ?? Math.min(...drawn.snails.map((s) => s.T));
      raceRef.current = {
        ...drawn,
        raceT: 0,
        last: 0,
        slow: 1,
        placed: 0,
        slowmoUsed: false,
        slowUntil: 0,
        commentaryRnd: mulberry32(drawn.seed ^ 0x4e444343),
        swarms: new Set<string>(),
        places: new Map<number, number>(),
        sector: 0,
        lapsDone: 0,
        leadLane: -1,
        finalCalled: false,
        runHomeQueued: false,
        photoCalled: false,
        lineCalled: false,
        inPhoto: false,
        results: [],
        highlights: [],
        cueIndex: 0,
        confirming: false,
        runningIn: false,
        wording,
        stopAt,
        twistLines: (plan?.cues ?? []).filter((cue) => cue.phase === 'commentary').map((cue) => cue.atMs),
        postHitAt: postHit ? postHit.effectAtMs : null,
        air: { key: '', rank: Infinity, until: -Infinity },
        pending: [],
        lastCallAt: 0,
      };
      setSeedHex(drawn.seedHex);
      setEvents(drawn.events);
      setWeather(drawn.weather);
      silence();
      const line = countdownLine(drawn.weather, mulberry32(drawn.seed ^ 0x53544152), lastCountdown);
      lastCountdown = line;
      call(line, 'big', 'ready');
      setPhase('countdown');
      setStatus("Under starter's orders");

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
          /* The off waits for the countdown line's last word rather than cutting it. */
          call('And they are away!', 'big', 'start', { preempt: true });
          painterRef.current?.start();
          rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
        }, steps.length * 900),
      );
    },
    [call, phase, reset],
  );

  const start = useCallback(
    (names: string[], durationMs: number, surprises = true, lapCount = 1, intensity: IntensityId = 'standard') => {
      startDrawn(drawRace(freshSeed(), names, durationMs, surprises, intensity), lapCount);
    },
    [startDrawn],
  );

  const startLocked = useCallback(
    (plan: LockedRacePlan) => {
      startDrawn(instantiateLockedRace(plan), plan.laps);
    },
    [startDrawn],
  );

  const voidRace = useCallback(() => {
    if (phase !== 'countdown' && phase !== 'running') return;
    stop();
    clearTimers();
    raceRef.current = null;
    setCountdown('');
    setMoment(null);
    setPhotoFinish(false);
    setPhase('void');
    setStatus('RACE VOID');
    call('This race has been declared void. All bets are off and will be re-run.', 'finish', 'void');
  }, [phase, stop, clearTimers, call]);

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
    onSplit,
    onLap,
    laps,
    weather,
    onBoard,
    setPainter,
    releasePainter,
    start,
    startLocked,
    reset,
    voidRace,
  };
}
