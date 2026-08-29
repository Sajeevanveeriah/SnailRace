'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RaceTrack } from './RaceTrack';
import { Telecast } from './Telecast';
import { PitBoard } from './PitBoard';
import { Standings } from './Standings';
import { ToteBoard } from './ToteBoard';
import { BetSlip } from './BetSlip';
import { DonateQr } from './DonateQr';
import { GoalRing } from './GoalRing';
import { CountUp } from './CountUp';
import { Confetti } from './Confetti';
import { WinnerOverlay } from './WinnerOverlay';
import { ControlDrawer } from './ControlDrawer';
import { ThemeToggle } from './ThemeToggle';
import { addAudit, hydrate, useEvent, setState } from '@/lib/event-store';
import { commitmentOf, shortHash, type RaceConfig } from '@/lib/audit';
import { recordRaceResult } from '@/lib/settlement';
import { hostLineFor, marketWarning, nextShowPhase, showPhaseSpec } from '@/lib/show';
import { usePhonePlay } from '@/lib/use-phone-play';
import { ShowOverlay } from './ShowScreens';
import { PackRunner } from './PackRunner';
import type { LiveShow } from '@/lib/live/store';
import type { PackRace, ShowPhase } from '@/lib/types';
import { useOrigin } from '@/lib/use-origin';
import { HAS_API } from '@/lib/deployment';
import { useCanSpeak } from '@/lib/use-can-speak';
import { newId, nowMs } from '@/lib/ids';
import { useDonations } from '@/lib/use-donations';
import { useRace } from '@/lib/use-race';
import { poolsFor } from '@/lib/tote';
import { sponsorFor } from '@/lib/standings';
import { encodeLineup } from '@/lib/lineup';
import { money, moneyShort, CHIP_START } from '@/lib/money';
import { laneColour } from '@/lib/palette';
import {
  audioState,
  initVoice,
  say,
  resumeAudio,
  setCallerOn,
  primeAudio,
  setLevels,
  setMusicOn,
  setSoundEnabled,
  sfx,
  startAmbience,
  startTrack,
  stopAmbience,
  stopTrack,
} from '@/lib/sound';
import type { Bet, Donation, RaceHighlight, RaceHistoryEntry, RaceResult } from '@/lib/types';
import type { DrawnRace } from '@/lib/race-engine';

export function Stage() {
  const event = useEvent();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const [dismissedToast, setDismissedToast] = useState<string | null>(null);
  const milestoneRef = useRef(0);
  const origin = useOrigin();

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    setSoundEnabled(event.sound);
  }, [event.sound]);

  useEffect(() => {
    setMusicOn(event.music);
  }, [event.music]);

  useEffect(() => {
    setCallerOn(event.sound && event.caller);
  }, [event.sound, event.caller]);

  useEffect(() => {
    setLevels({ master: event.volume, music: event.musicVolume });
  }, [event.volume, event.musicVolume]);

  useEffect(() => () => {
    stopTrack(0.2);
    stopAmbience();
  }, []);

  const feed = useDonations(event.eventId);
  const names = useMemo(
    () => event.names.slice(0, event.fieldSize),
    [event.names, event.fieldSize],
  );
  const nextRaceNo = event.raceNumber + 1;
  const sponsor = useMemo(
    () => sponsorFor(event.sponsors, nextRaceNo),
    [event.sponsors, nextRaceNo],
  );

  /** Stripe is authoritative for cards; the cash tin lives on this device. */
  const allDonations: Donation[] = useMemo(
    () => [...feed.donations, ...event.cashLedger],
    [feed.donations, event.cashLedger],
  );

  const liveDonations = useMemo(() => allDonations.filter((d) => !d.void), [allDonations]);
  const nightCents = useMemo(
    () => liveDonations.reduce((sum, d) => sum + d.cents, 0),
    [liveDonations],
  );

  const { lanes, potCents } = useMemo(
    () => poolsFor(allDonations, names, nextRaceNo),
    [allDonations, names, nextRaceNo],
  );

  /* ── Race lifecycle ──────────────────────────────────────────────────── */

  const [highlights, setHighlights] = useState<RaceHighlight[]>([]);

  /*
   * The armed race: everything the audit block needs, captured at lock so a
   * mid-race rename or setting change cannot rewrite what was committed to.
   */
  const armedRef = useRef<{
    raceNo: number;
    lockedAt: number;
    startedAt: number;
    config: RaceConfig;
    oddsAtLock: Record<number, number>;
    commitHash: string;
  } | null>(null);

  /** Set once Phone Play mounts; onFinish settles the room through it. */
  const phonePlayRef = useRef<((raceNo: number, results: RaceResult[]) => Promise<void>) | null>(
    null,
  );

  const onFinish = useCallback(
    (drawn: DrawnRace, results: RaceResult[], reel: RaceHighlight[]) => {
      const raceNo = nextRaceNo;
      const armed = armedRef.current;
      const finishedAt = nowMs();

      /*
       * One settlement path for every race source. `recordRaceResult` holds
       * the exactly-once guard, snapshots, streaks, audit entries and the
       * async result hash; this callback only supplies the engine's entry
       * and drives the stage furniture.
       */
      const { recorded } = recordRaceResult({
        raceNo,
        raceType: event.raceType,
        seedHex: drawn.seedHex,
        fieldSize: names.length,
        durationMs: event.raceDurationMs,
        at: finishedAt,
        results,
        potCents,
        photoFinish: drawn.photoFinish,
        highlights: reel,
        sponsor,
        source: 'engine',
        names: armed?.config.names ?? names,
        laps: armed?.config.laps,
        surprises: armed?.config.surprises,
        trackShape: event.trackShape,
        intensity: event.intensity,
        lockedAt: armed?.lockedAt,
        startedAt: armed?.startedAt,
        finishedAt,
        oddsAtLock: armed?.oddsAtLock,
        commitHash: armed?.commitHash,
      });
      if (!recorded) return;

      void phonePlayRef.current?.(raceNo, results);
      armedRef.current = null;
      setHighlights(reel);
      setOverlayOpen(true);
      setConfettiKey((k) => k + 1);
    },
    [event.raceDurationMs, event.raceType, event.trackShape, event.intensity, names, nextRaceNo, potCents, sponsor],
  );

  const race = useRace(onFinish);

  /*
   * Audio waits for the room to touch something.
   *
   * A browser will not start an AudioContext without a user gesture, and
   * building one anyway just to have it sit suspended earns a console warning
   * on every load. So the first pointer or key press arms the soundtrack, and
   * nothing before it creates a context at all.
   */
  const [primed, setPrimed] = useState(false);
  const [audio, setAudio] = useState<'idle' | 'blocked' | 'running' | 'off'>('idle');
  const canSpeak = useCanSpeak();
  useEffect(() => {
    initVoice();
  }, []);

  useEffect(() => {
    /*
     * Every gesture, not just the first. A browser can suspend a running
     * context long after it was created - the machine changes output device,
     * the tab is backgrounded - and it does so silently, which on the night
     * looks like an app with no sound rather than a browser wanting a click.
     */
    const arm = () => {
      primeAudio();
      resumeAudio();
      initVoice();
      setPrimed(true);
      setAudio(audioState());
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    const poll = window.setInterval(() => setAudio(audioState()), 1500);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      window.clearInterval(poll);
    };
  }, []);

  /*
   * The soundtrack is idle-driven: whenever no race is running, the lobby
   * groove and the crowd bed come back up. The race lifecycle in `use-race`
   * owns everything from the countdown to the winner fanfare, so this only
   * has to cover the gaps between races.
   */
  useEffect(() => {
    if (!primed) return;
    if (!event.sound) {
      stopAmbience();
      return;
    }
    /* The crowd is the venue, not the soundtrack: it stays up whenever sound
       is on, even with the music switched off. */
    startAmbience();
    if (event.music && race.phase === 'idle') startTrack('lobby');
  }, [primed, event.sound, event.music, race.phase]);

  const startRace = useCallback(() => {
    primeAudio();
    setOverlayOpen(false);

    const laps = event.trackShape === 'circuit' ? event.laps : 1;
    const lockedAt = nowMs();
    const oddsAtLock: Record<number, number> = {};
    for (const l of lanes) oddsAtLock[l.lane] = l.odds;

    armedRef.current = {
      raceNo: nextRaceNo,
      lockedAt,
      startedAt: lockedAt,
      config: {
        raceNo: nextRaceNo,
        raceType: event.raceType,
        fieldSize: names.length,
        names: names.slice(),
        durationMs: event.raceDurationMs,
        laps,
        surprises: event.surprises,
        trackShape: event.trackShape,
      },
      oddsAtLock,
      commitHash: '',
    };

    setState({ bettingOpen: false });
    addAudit({
      kind: 'race_locked',
      raceNo: nextRaceNo,
      detail: `Race ${nextRaceNo} locked: selections closed, odds snapshotted for ${names.length} lanes. Set-up is frozen until the race finishes or is voided.`,
    });
    race.start(names, event.raceDurationMs, event.surprises, laps);
  }, [names, lanes, nextRaceNo, event.raceDurationMs, event.raceType, event.surprises, event.trackShape, event.laps, race]);

  /*
   * The seed exists only once the draw is taken inside `race.start`, so the
   * commitment - SHA-256 over seed plus the locked configuration - is
   * published the moment the seed lands rather than in the click handler.
   */
  useEffect(() => {
    const armed = armedRef.current;
    if (!race.seedHex || !armed || armed.commitHash) return;
    if (race.phase !== 'countdown' && race.phase !== 'running') return;
    armed.startedAt = nowMs();
    void commitmentOf(race.seedHex, armed.config).then((hash) => {
      if (armedRef.current !== armed) return;
      armed.commitHash = hash;
      addAudit({
        kind: 'race_started',
        raceNo: armed.raceNo,
        detail: `Race ${armed.raceNo} started. Seed ${race.seedHex}, commitment ${shortHash(hash)}… binds seed to field of ${armed.config.fieldSize}, ${armed.config.laps} lap(s), ${Math.round(armed.config.durationMs / 1000)}s, surprises ${armed.config.surprises ? 'on' : 'off'}.`,
      });
    });
  }, [race.seedHex, race.phase]);

  const resetRace = useCallback(() => {
    race.reset();
    setOverlayOpen(false);
    armedRef.current = null;
    setState({ bettingOpen: true });
  }, [race]);

  /* A brand-new event replaces the night in the store, but the engine's last
     running order lives in this component - clear it so the fresh night does
     not open showing the old one's arrivals. Only the engine's visuals reset:
     this also fires when hydration swaps in the stored night on load, and a
     reload mid-race must NOT reopen its locked betting. */
  const eventIdRef = useRef(event.eventId);
  useEffect(() => {
    if (eventIdRef.current === event.eventId) return;
    eventIdRef.current = event.eventId;
    const id = window.setTimeout(() => {
      race.reset();
      setOverlayOpen(false);
      armedRef.current = null;
    }, 0);
    return () => window.clearTimeout(id);
  }, [event.eventId, race]);

  /** Declare the race in progress void: no result, no settlement, re-run. */
  const voidCurrentRace = useCallback(() => {
    if (race.phase !== 'countdown' && race.phase !== 'running') return;
    const armed = armedRef.current;
    const raceNo = armed?.raceNo ?? nextRaceNo;
    race.voidRace();
    setState((s) => ({
      bettingOpen: true,
      history: [
        {
          raceNo,
          raceType: event.raceType,
          seedHex: race.seedHex || '--------',
          fieldSize: names.length,
          durationMs: event.raceDurationMs,
          at: nowMs(),
          results: [],
          potCents,
          photoFinish: false,
          sponsor,
          names: armed?.config.names ?? names,
          lockedAt: armed?.lockedAt,
          startedAt: armed?.startedAt,
          commitHash: armed?.commitHash || undefined,
          oddsAtLock: armed?.oddsAtLock,
          void: true,
          voidReason: 'Declared void by the moderator before the finish. Bets reopened for the re-run.',
        } satisfies RaceHistoryEntry,
        ...s.history,
      ],
    }));
    addAudit({
      kind: 'race_void',
      raceNo,
      detail: `Race ${raceNo} declared VOID before the finish (seed ${race.seedHex || 'not yet drawn'}). No settlement occurred; bets reopened for the re-run.`,
    });
    armedRef.current = null;
  }, [race, nextRaceNo, event.raceType, event.raceDurationMs, names, potCents, sponsor]);

  /* ── The run of show ─────────────────────────────────────────────────── */

  const racesRun = useMemo(
    () => event.history.filter((h) => !h.void).length,
    [event.history],
  );

  const [marketLockAt, setMarketLockAt] = useState<number | null>(null);
  const warnedRef = useRef<Set<number>>(new Set());

  /** The host speaks between races; the race keeps its own richer caller. */
  const sayHost = useCallback((text: string) => {
    say(text, 'big');
  }, []);

  const goToPhase = useCallback(
    (phase: ShowPhase) => {
      setState({ showPhase: phase });
      addAudit({
        kind: 'phase_change',
        raceNo: nextRaceNo,
        detail: `Show advanced to ${showPhaseSpec(phase).screen}.`,
      });
      sayHost(
        hostLineFor(phase, {
          clubName: event.clubName,
          eventName: event.eventName,
          raceNo: nextRaceNo,
          plannedRaces: event.plannedRaces,
          sponsor,
          leaderName: undefined,
          intensity: event.intensity,
        }),
      );
    },
    [sayHost, event.clubName, event.eventName, event.plannedRaces, event.intensity, nextRaceNo, sponsor],
  );

  const advanceShow = useCallback(() => {
    const next = nextShowPhase(event.showPhase, { racesRun, plannedRaces: event.plannedRaces });
    if (next === event.showPhase) return;
    if (event.showPhase === 'results') {
      setOverlayOpen(false);
      race.reset();
    }
    setMarketLockAt(null);
    warnedRef.current.clear();
    goToPhase(next);
  }, [event.showPhase, event.plannedRaces, racesRun, goToPhase, race]);

  const backShow = useCallback(() => {
    const back: Partial<Record<ShowPhase, ShowPhase>> = {
      racecard: 'lobby',
      market: 'racecard',
      race: 'market',
      intermission: 'championship',
      finale: 'championship',
    };
    const prev = back[event.showPhase];
    if (prev) {
      setMarketLockAt(null);
      warnedRef.current.clear();
      goToPhase(prev);
    }
  }, [event.showPhase, goToPhase]);

  /* The market lock countdown: 30/10/5 warnings, then lock and race. */
  useEffect(() => {
    if (!marketLockAt) return;
    const timer = window.setInterval(() => {
      const left = Math.ceil((marketLockAt - Date.now()) / 1000);
      for (const mark of [30, 10, 5] as const) {
        if (left <= mark && !warnedRef.current.has(mark)) {
          warnedRef.current.add(mark);
          sayHost(marketWarning(mark));
        }
      }
      if (left <= 0) {
        setMarketLockAt(null);
        warnedRef.current.clear();
        setState({ bettingOpen: false, showPhase: 'race' });
        sayHost('The market is closed. They are heading to the gate.');
        addAudit({
          kind: 'phase_change',
          raceNo: nextRaceNo,
          detail: `Market countdown reached zero: selections closed for race ${nextRaceNo}.`,
        });
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [marketLockAt, sayHost, nextRaceNo]);

  /* A race taking the gate always lands the show in the race phase and
     cancels any armed market countdown. */
  useEffect(() => {
    if (race.phase !== 'countdown') return;
    const id = window.setTimeout(() => {
      setMarketLockAt(null);
      warnedRef.current.clear();
      if (event.showPhase !== 'race') setState({ showPhase: 'race' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [race.phase, event.showPhase]);

  /* ── Phone Play: the room on its own devices ─────────────────────────── */

  const liveShow = useMemo<LiveShow>(() => {
    const standing = event.history.find((h) => !h.void);
    const isRacing = race.phase === 'countdown' || race.phase === 'running';
    /* While the show sits on the results, the phones stay on the race that
       just ran - jumping the room to race N+1 the instant N settles would
       hide every result and outcome from the very people who picked. */
    const onResults = event.showPhase === 'results' && Boolean(standing);
    return {
      eventName: event.eventName,
      clubName: event.clubName,
      raceNo: onResults && standing ? standing.raceNo : nextRaceNo,
      phase: event.showPhase,
      marketOpen: event.bettingOpen && !isRacing && !onResults,
      names,
      odds: Object.fromEntries(lanes.map((l) => [l.lane, l.odds])),
      result:
        standing && standing.results.length
          ? {
              raceNo: standing.raceNo,
              winnerLane: standing.results.find((r) => r.place === 1)?.lane ?? -1,
              order: standing.results
                .slice()
                .sort((a, b) => a.place - b.place)
                .map((r) => ({ lane: r.lane, name: r.name, place: r.place })),
            }
          : null,
      rehearsal: event.rehearsal,
    };
  }, [event.history, event.eventName, event.clubName, event.showPhase, event.bettingOpen, event.rehearsal, race.phase, nextRaceNo, names, lanes]);

  const phonePlay = usePhonePlay(HAS_API ? liveShow : null);
  useEffect(() => {
    phonePlayRef.current = phonePlay.settle;
  }, [phonePlay.settle]);

  const playUrl = useMemo(
    () => (origin && phonePlay.session ? `${origin}/play?c=${phonePlay.session.code}` : ''),
    [origin, phonePlay.session],
  );

  /* Reaction bursts float up the projector and nudge the crowd bed. */
  const [floats, setFloats] = useState<{ id: number; glyph: string; left: number }[]>([]);
  const floatIdRef = useRef(0);
  useEffect(() => {
    const glyphs: Record<string, string> = {
      cheer: '📣', clap: '👏', laugh: '😂', shock: '😱', snail: '🐌',
    };
    const burst = Object.entries(phonePlay.reactionBurst).flatMap(([kind, count]) =>
      Array.from({ length: Math.min(4, count) }, () => glyphs[kind] ?? '🐌'),
    );
    if (!burst.length || event.calm) return;
    sfx.crowd.cheer(Math.min(0.5, 0.15 + burst.length * 0.05));
    const added = burst.slice(0, 8).map((glyph) => ({
      id: (floatIdRef.current += 1),
      glyph,
      left: 8 + Math.random() * 84,
    }));
    setFloats((f) => [...f.slice(-12), ...added]);
    const timer = window.setTimeout(
      () => setFloats((f) => f.filter((x) => !added.some((a) => a.id === x.id))),
      2800,
    );
    return () => window.clearTimeout(timer);
  }, [phonePlay.reactionBurst, event.calm]);

  /* ── Recorded Race Pack results, through the same settlement path ────── */

  const onPackResult = useCallback(
    (packRace: PackRace, results: RaceResult[]) => {
      const raceNo = nextRaceNo;
      const finishedAt = nowMs();
      const { recorded } = recordRaceResult({
        raceNo,
        raceType: event.raceType,
        seedHex: packRace.mediaSha256.slice(0, 8).toUpperCase(),
        fieldSize: packRace.runners.length,
        durationMs: packRace.durationMs,
        at: finishedAt,
        results,
        potCents,
        photoFinish: false,
        sponsor: packRace.sponsor ?? sponsor,
        source: 'pack',
        packId: event.racePack?.packId,
        packRaceId: packRace.raceId,
        commitHash: event.packCommit,
        names: packRace.runners,
        finishedAt,
        oddsAtLock: Object.fromEntries(lanes.map((l) => [l.lane, l.odds])),
      });
      if (!recorded) return;
      void phonePlayRef.current?.(raceNo, results);
      setHighlights([]);
      setOverlayOpen(true);
      setConfettiKey((k) => k + 1);
    },
    [nextRaceNo, event.raceType, event.racePack?.packId, event.packCommit, potCents, sponsor, lanes],
  );

  const onPackVoid = useCallback(
    (packRace: PackRace, reason: string) => {
      const raceNo = nextRaceNo;
      setState((s) => ({
        bettingOpen: true,
        history: [
          {
            raceNo,
            raceType: event.raceType,
            seedHex: packRace.mediaSha256.slice(0, 8).toUpperCase(),
            fieldSize: packRace.runners.length,
            durationMs: packRace.durationMs,
            at: nowMs(),
            results: [],
            potCents,
            photoFinish: false,
            sponsor: packRace.sponsor ?? sponsor,
            source: 'pack',
            packId: event.racePack?.packId,
            packRaceId: packRace.raceId,
            names: packRace.runners,
            void: true,
            voidReason: reason,
          } satisfies RaceHistoryEntry,
          ...s.history,
        ],
      }));
      addAudit({
        kind: 'race_void',
        raceNo,
        detail: `Recorded race ${packRace.raceId} ("${packRace.title}") declared VOID: ${reason}`,
      });
    },
    [nextRaceNo, event.raceType, event.racePack?.packId, potCents, sponsor],
  );

  /* ── Fun bets ────────────────────────────────────────────────────────── */

  const placeBet = useCallback(
    (bet: Omit<Bet, 'id' | 'settled'>) => {
      const k = bet.punter.trim().toLowerCase();
      /*
       * Functional, and re-checked at write time: the lock and the bank are
       * verified against the freshest state, so a stale tab cannot slip a
       * bet under a closed book or spend chips it no longer has.
       */
      setState((s) => {
        if (!s.bettingOpen) return {};
        const bank = s.chipBank[k] ?? CHIP_START;
        if (bet.chips > bank || bet.chips <= 0) return {};
        return {
          bets: [...s.bets, { ...bet, id: newId('bet'), settled: false }],
          chipBank: { ...s.chipBank, [k]: bank - bet.chips },
        };
      });
    },
    [],
  );

  /* ── Donation arrivals ───────────────────────────────────────────────── */

  /*
   * The toast is derived from the newest arrival rather than copied into
   * state, so the only thing the effect does is ring the coin and start the
   * dismissal timer.
   */
  const toast =
    feed.arrival && feed.arrival.id !== dismissedToast ? feed.arrival : null;

  useEffect(() => {
    if (!toast) return;
    sfx.coin();
    const id = window.setTimeout(() => setDismissedToast(toast.id), 5200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!event.goalShow || event.goalCents <= 0) return;
    const quarter = Math.floor((nightCents / event.goalCents) * 4);
    if (quarter > milestoneRef.current && quarter > 0) {
      milestoneRef.current = quarter;
      sfx.milestone();
    }
  }, [nightCents, event.goalCents, event.goalShow]);

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const k = e.key.toLowerCase();

      /*
       * A presentation clicker sends PageDown and PageUp, which is what a
       * volunteer at the front of a hall is actually holding. Arrow keys are
       * mapped with them so a wireless keyboard works from the back.
       */
      const forward = e.code === 'Space' || e.code === 'PageDown' || e.code === 'ArrowRight';
      const back = e.code === 'PageUp' || e.code === 'ArrowLeft';

      if (forward) {
        e.preventDefault();
        if (event.showPhase !== 'race') {
          advanceShow();
          return;
        }
        /* Recorded mode: the pack runner's own draw and play buttons drive
           playback, so a stray clicker press cannot start an engine race. */
        if (event.eventMode === 'recorded') return;
        if (race.phase === 'idle' || race.phase === 'done' || race.phase === 'void') startRace();
        return;
      }
      if (back) {
        e.preventDefault();
        if (overlayOpen) {
          setOverlayOpen(false);
          return;
        }
        if (event.showPhase !== 'race') {
          backShow();
          return;
        }
        resetRace();
        return;
      }
      if (k === 'escape') {
        if (overlayOpen) setOverlayOpen(false);
        else if (drawerOpen) setDrawerOpen(false);
        else resetRace();
        return;
      }
      if (k === 'm') setDrawerOpen((o) => !o);
      if (k === 'c') setState({ calm: !event.calm });
      if (k === 's') setState({ sound: !event.sound });
      if (k === 'b') {
        primeAudio();
        setState({ music: !event.music });
      }
      if (k === 'v') {
        primeAudio();
        initVoice();
        setState({ caller: !event.caller });
      }
      if (k === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, overlayOpen, race.phase, startRace, resetRace, advanceShow, backShow, event.showPhase, event.eventMode, event.calm, event.sound, event.music, event.caller]);

  /* ── Direct-pay link ─────────────────────────────────────────────────── */

  /*
   * A reusable Stripe Payment Link for the event: scanning its QR lands the
   * phone straight in Stripe checkout with a choose-your-amount field. It is
   * fetched once per event; if Stripe is not configured the request fails
   * quietly and the panel simply never offers the second QR.
   */
  const [directUrl, setDirectUrl] = useState('');
  const [qrMode, setQrMode] = useState<'lineup' | 'direct'>('lineup');

  useEffect(() => {
    if (!event.eventId || !HAS_API) return;
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch('/api/payment-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: event.eventId }),
        });
        const body = (await res.json()) as { ok: boolean; url?: string };
        if (!cancel) setDirectUrl(body.ok && body.url ? body.url : '');
      } catch {
        /* Direct pay is an extra. The lineup QR still works without it. */
        if (!cancel) setDirectUrl('');
      }
    })();
    return () => {
      cancel = true;
    };
  }, [event.eventId]);

  /* ── Donor link ──────────────────────────────────────────────────────── */

  const donateUrl = useMemo(() => {
    if (!origin) return '';
    const token = encodeLineup({
      v: 1,
      e: event.eventId,
      r: nextRaceNo,
      c: event.clubName,
      n: names,
    });
    return `${origin}/donate?e=${token}`;
  }, [origin, event.eventId, event.clubName, nextRaceNo, names]);

  const racing = race.phase === 'running' || race.phase === 'countdown';
  /*
   * Cinema mode. A projector at the back of a hall wants the race, not the
   * furniture: while one is on, the course goes full bleed and everything a
   * moderator reads between races gets out of the way. Measured on a 1080p
   * screen the course went from under half of it to nearly all of it.
   */
  const cinema = racing || race.phase === 'done';
  const winnerColour = race.results[0] ? laneColour(race.results[0].lane).shell : '#ffb020';

  return (
    <div className={`${event.calm ? 'calm ' : ''}${cinema ? 'cinema' : ''}`}>
      {event.showPhase === 'race' || event.showPhase === 'results' ? (
        <a className="skip-link" href="#controls">
          Skip to moderator controls
        </a>
      ) : null}
      <div className="aurora" aria-hidden="true" />

      <div
        className="stage-shell mx-auto flex min-h-dvh w-full max-w-[1700px] flex-col gap-5 p-4 sm:p-6 lg:p-8"
        inert={event.showPhase !== 'race' && event.showPhase !== 'results'}
        aria-hidden={event.showPhase !== 'race' && event.showPhase !== 'results'}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="reveal flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <p className="eyebrow">{event.clubName}</p>
            <h1 className="display mt-1.5 text-4xl sm:text-5xl lg:text-[3.4rem]">
              {event.eventName}
            </h1>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="eyebrow">Raised tonight</p>
              <CountUp
                value={nightCents}
                format={moneyShort}
                className="display money-ink mt-1 text-4xl sm:text-[3.2rem]"
              />
            </div>
            {event.goalShow ? (
              <GoalRing raisedCents={nightCents} goalCents={event.goalCents} />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="chip-toggle pointer-events-none">
              {event.raceType} {nextRaceNo} of {event.plannedRaces}
            </span>
            {event.rehearsal ? (
              <span className="chip-toggle pointer-events-none !text-(--bad)">REHEARSAL</span>
            ) : null}
            {event.eventMode === 'recorded' ? (
              <span className="chip-toggle pointer-events-none">Recorded card</span>
            ) : null}
            {sponsor ? (
              <span className="sponsor-line" title="Race sponsor">
                Sponsored by <b>{sponsor}</b>
              </span>
            ) : null}
            <FeedPill status={feed.status} lastOk={feed.lastOk} />
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={event.calm}
              onClick={() => setState({ calm: !event.calm })}
              title="Calm mode stops decorative motion (C)"
            >
              Calm
            </button>
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={event.sound}
              onClick={() => {
                primeAudio();
                setState({ sound: !event.sound });
              }}
              title="Sound (S)"
            >
              {event.sound ? 'Sound on' : 'Muted'}
            </button>
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={event.caller}
              disabled={!event.sound || !canSpeak}
              onClick={() => {
                primeAudio();
                initVoice();
                setState({ caller: !event.caller });
              }}
              title="Spoken race caller (V)"
            >
              {event.caller ? 'Caller on' : 'Caller off'}
            </button>
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={event.music}
              disabled={!event.sound}
              onClick={() => {
                primeAudio();
                setState({ music: !event.music });
              }}
              title="Music and crowd (B)"
            >
              {event.music ? 'Music on' : 'Music off'}
            </button>
            <ThemeToggle />
          </div>
        </header>

        {/* ── Stage body ─────────────────────────────────────────────── */}
        <main className="stage-main grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="stage-track flex min-w-0 flex-col gap-4">
            {event.eventMode === 'recorded' ? (
              <PackRunner onResult={onPackResult} onVoid={onPackVoid} />
            ) : event.trackShape === 'circuit' ? (
              <Telecast
                names={names}
                race={race}
                surface={event.stageTheme}
                laps={event.laps}
                chase={event.chaseCam}
                calm={event.calm}
                clubName={event.clubName}
                raceNo={nextRaceNo}
              />
            ) : (
              <RaceTrack names={names} race={race} surface={event.stageTheme} />
            )}

            <div className="stage-bar glass flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-3">
                  <StateBanner phase={race.phase} />
                  <p className="text-lg font-semibold">{race.status}</p>
                  {race.seedHex ? (
                    <span
                      className="num text-[11px] text-(--tx)/35"
                      title="The seed the finishing order was drawn from, printed before the snails moved."
                    >
                      seed {race.seedHex}
                    </span>
                  ) : null}
                </div>
                {event.trackShape === 'circuit' ? null : (
                  <p className="call-rail h-5 truncate text-sm text-(--tx)/55">{race.commentary}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {event.eventMode === 'live' ? (
                <button
                  type="button"
                  className={`btn btn-go ${!racing ? 'btn-pulse' : ''}`}
                  onClick={startRace}
                  disabled={racing}
                >
                  {race.phase === 'done'
                    ? 'Next race'
                    : race.phase === 'void'
                      ? 'Re-run race'
                      : 'Start race'}{' '}
                  <kbd>Space</kbd>
                </button>
                ) : null}
                {racing && event.eventMode === 'live' ? (
                  <button
                    type="button"
                    className="btn btn-ghost !text-(--bad)"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Void race ${nextRaceNo}? No result, no settlement; bets reopen for the re-run and an audit entry is written.`,
                        )
                      ) {
                        voidCurrentRace();
                      }
                    }}
                  >
                    Void race
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={resetRace}>
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDrawerOpen((o) => !o)}
                  aria-expanded={drawerOpen}
                  aria-controls="controls"
                >
                  Controls <kbd>M</kbd>
                </button>
              </div>
            </div>

            {event.trackShape === 'circuit' ? (
              <PitBoard names={names} race={race} laps={event.laps} />
            ) : null}

            <Standings history={event.history} />

            <RecentDonations donations={liveDonations} />
          </div>

          <div className="stage-side flex flex-col gap-4">
            <ToteBoard
              lanes={lanes}
              potCents={potCents}
              fieldSize={names.length}
              raceNo={nextRaceNo}
              showOdds
            />

            {donateUrl && feed.status !== 'unconfigured' ? (
              <section className="glass glass-strong flex flex-col items-center gap-3 p-6">
                <h2 className="eyebrow">
                  {qrMode === 'direct' ? 'Give in one scan' : 'Back a snail'}
                </h2>

                {directUrl ? (
                  <span className="seg" style={{ '--seg-n': 2 } as React.CSSProperties} role="group" aria-label="Donation QR mode">
                    <span
                      className="seg-thumb"
                      style={{ '--seg-i': qrMode === 'lineup' ? 0 : 1 } as React.CSSProperties}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      aria-pressed={qrMode === 'lineup'}
                      onClick={() => setQrMode('lineup')}
                    >
                      Back a snail
                    </button>
                    <button
                      type="button"
                      aria-pressed={qrMode === 'direct'}
                      onClick={() => setQrMode('direct')}
                    >
                      Scan &amp; pay
                    </button>
                  </span>
                ) : null}

                <DonateQr
                  url={qrMode === 'direct' && directUrl ? directUrl : donateUrl}
                  caption={
                    qrMode === 'direct' ? 'Scan to pay by card now' : 'Scan to back a snail'
                  }
                />
                <p className="text-center text-xs text-(--tx)/50">
                  {qrMode === 'direct'
                    ? 'Straight into Stripe checkout: pick an amount, pay by card, Apple Pay or Google Pay.'
                    : 'Card donations by Stripe. Every dollar goes to the club.'}
                </p>
              </section>
            ) : null}

            <BetSlip
              lanes={lanes}
              raceNo={nextRaceNo}
              bets={event.bets}
              chipBank={event.chipBank}
              streaks={event.streaks}
              open={event.bettingOpen && !racing}
              onPlace={placeBet}
            />
          </div>
        </main>
      </div>

      <ShowOverlay
        event={event}
        lanes={lanes}
        potCents={potCents}
        nightCents={nightCents}
        nextRaceNo={nextRaceNo}
        sponsor={sponsor}
        donateUrl={feed.status !== 'unconfigured' ? donateUrl : ''}
        playUrl={playUrl}
        room={phonePlay.session ? phonePlay.summary : null}
        marketLockAt={marketLockAt}
      />

      {event.showPhase !== 'race' ? (
        <div className="show-controls no-print" role="toolbar" aria-label="Show controls">
          <button type="button" className="btn btn-ghost" onClick={backShow}>
            Back <kbd>PgUp</kbd>
          </button>
          {event.showPhase === 'market' && event.bettingOpen ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  warnedRef.current.clear();
                  setMarketLockAt(Date.now() + 60_000);
                }}
              >
                Lock in 60s
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setMarketLockAt(null);
                  setState({ bettingOpen: false, showPhase: 'race' });
                }}
              >
                Lock now
              </button>
            </>
          ) : null}
          {event.showPhase === 'championship' ? (
            <button type="button" className="btn btn-ghost" onClick={() => goToPhase('intermission')}>
              Intermission
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            aria-controls="controls"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            Controls <kbd>M</kbd>
          </button>
          <button type="button" className={`btn btn-go`} onClick={advanceShow}>
            {showPhaseSpec(event.showPhase).advance} <kbd>Space</kbd>
          </button>
        </div>
      ) : null}

      {floats.map((f) => (
        <span key={f.id} className="reaction-float" style={{ left: `${f.left}%` }} aria-hidden="true">
          {f.glyph}
        </span>
      ))}

      {audio === 'blocked' || (audio === 'idle' && primed) ? (
        <button
          type="button"
          className="audio-blocked"
          onClick={() => {
            primeAudio();
            resumeAudio();
            setAudio(audioState());
            sfx.bell();
          }}
        >
          <span className="audio-blocked-dot" aria-hidden="true" />
          Sound is blocked by the browser - click here to turn it on
        </button>
      ) : null}

      {toast ? (
        <div className="toast glass glass-strong fixed right-5 top-5 z-[95] max-w-xs px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-(--tx)/50">Donation in</p>
          <p className="mt-1 font-semibold">
            {toast.backerName || 'Anonymous'}{' '}
            {toast.lane < 0 ? 'gave straight to the club' : `backed ${toast.snailName}`}
          </p>
          <p className="num text-2xl font-bold text-(--money-b)">{money(toast.cents)}</p>
        </div>
      ) : null}

      <WinnerOverlay
        open={overlayOpen}
        raceNo={event.raceNumber}
        results={
          /* Recorded races settle without the engine, so the card falls back
             to the standing ledger entry for the race just recorded. */
          race.results.length
            ? race.results
            : (event.history.find((h) => !h.void && h.raceNo === event.raceNumber)?.results ?? [])
                .slice()
                .sort((a, b) => a.place - b.place)
        }
        donations={allDonations}
        bets={event.bets}
        highlights={highlights}
        nextRaceNo={event.raceNumber + 1}
        sponsor={event.history[0]?.sponsor ?? ''}
        onClose={() => setOverlayOpen(false)}
      />

      <Confetti fire={confettiKey} highlight={winnerColour} calm={event.calm} />

      <ControlDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        donations={allDonations}
        stripeDonations={feed.donations}
        nextRaceNo={nextRaceNo}
        nightCents={nightCents}
        locked={racing}
        phonePlay={phonePlay}
        playUrl={playUrl}
      />
    </div>
  );
}

/* ── Small presentational pieces ──────────────────────────────────────── */

/**
 * The live lifecycle, said out loud: READY, COUNTDOWN, RUNNING, FINISHED,
 * VOID. One glance from the back of a hall answers "can I still bet?".
 */
function StateBanner({ phase }: { phase: string }) {
  const label =
    phase === 'idle'
      ? 'READY'
      : phase === 'countdown'
        ? 'COUNTDOWN'
        : phase === 'running'
          ? 'RUNNING'
          : phase === 'done'
            ? 'FINISHED'
            : 'VOID';
  return <span className={`state-banner state-${phase}`}>{label}</span>;
}

function FeedPill({ status, lastOk }: { status: string; lastOk: number }) {
  const label =
    status === 'live'
      ? 'Stripe live'
      : status === 'offline'
        ? 'Stripe offline'
        : status === 'unconfigured'
          ? 'Cash only'
          : 'Connecting';

  const tone =
    status === 'live'
      ? '!text-(--ok)'
      : status === 'offline'
        ? '!text-(--bad)'
        : '';

  return (
    <span
      className={`chip-toggle pointer-events-auto cursor-default ${tone}`}
      title={
        status === 'live'
          ? `Last successful read ${new Date(lastOk).toLocaleTimeString('en-AU')}`
          : status === 'unconfigured'
            ? 'STRIPE_SECRET_KEY is not set, so only cash entries are counted.'
            : 'The last read of Stripe failed. The board is showing the previous snapshot.'
      }
    >
      {status === 'live' ? <span className="live-dot" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

function RecentDonations({ donations }: { donations: Donation[] }) {
  const recent = donations.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 14);

  if (recent.length === 0) {
    return (
      <div className="ticker-wrap glass px-5 py-4 text-sm text-(--tx)/45">
        No donations yet tonight. Scan the code to be the first.
      </div>
    );
  }

  /*
   * A marquee only reads as one when it has enough in it to fill the rail.
   * With two entries the duplicated copy needed for a seamless loop just
   * looks like the same donation recorded twice, so short lists sit still.
   */
  const scroll = recent.length >= 5;

  const entries = (copy: number) =>
    recent.map((d) => (
      <span key={`${copy}-${d.id}`} className="flex items-center gap-2 text-sm whitespace-nowrap">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: laneColour(d.lane).shell }}
        />
        <span className="font-medium">{d.backerName || 'Anonymous'}</span>
        <span className="text-(--tx)/45">
          {d.lane < 0 ? 'straight to the club' : `on ${d.snailName}`}
        </span>
        <span className="num font-semibold text-(--money-b)">{money(d.cents)}</span>
        {d.source === 'cash' ? (
          <span className="rounded-full bg-(--tx)/10 px-2 text-[10px]">cash</span>
        ) : null}
      </span>
    ));

  return (
    <div className="ticker-wrap glass overflow-hidden px-5 py-3.5">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-(--tx)/40">
          Latest
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          {scroll ? (
            <div className="ticker-track">
              <div className="flex shrink-0 gap-12">{entries(0)}</div>
              <div className="flex shrink-0 gap-12" aria-hidden="true">
                {entries(1)}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-8 gap-y-1.5">{entries(0)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
