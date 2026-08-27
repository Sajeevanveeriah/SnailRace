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
import { commitmentOf, resultHashOf, shortHash, type RaceConfig } from '@/lib/audit';
import { useOrigin } from '@/lib/use-origin';
import { HAS_API } from '@/lib/deployment';
import { useCanSpeak } from '@/lib/use-can-speak';
import { newId, nowMs } from '@/lib/ids';
import { useDonations } from '@/lib/use-donations';
import { useRace } from '@/lib/use-race';
import { poolsFor, settleBets } from '@/lib/tote';
import { sponsorFor } from '@/lib/standings';
import { encodeLineup } from '@/lib/lineup';
import { money, moneyShort, CHIP_START } from '@/lib/money';
import { laneColour } from '@/lib/palette';
import {
  audioState,
  initVoice,
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

/** Bonus chips per race for a punter on a run, so a hot streak is worth chasing. */
const STREAK_BONUS = 25;

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

  const onFinish = useCallback(
    (drawn: DrawnRace, results: RaceResult[], reel: RaceHighlight[]) => {
      const raceNo = nextRaceNo;
      const winner = results[0];

      /*
       * Settle exactly once. The loop calls this once per race, but a race
       * that already has a standing (non-void) result must never settle
       * again - re-entry here would pay every winning bet a second time.
       */
      if (event.history.some((h) => h.raceNo === raceNo && !h.void)) return;

      const armed = armedRef.current;
      const finishedAt = nowMs();

      const entry: RaceHistoryEntry = {
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
        /* The audit block, captured when betting locked. */
        names: armed?.config.names ?? names,
        laps: armed?.config.laps,
        surprises: armed?.config.surprises,
        trackShape: event.trackShape,
        lockedAt: armed?.lockedAt,
        startedAt: armed?.startedAt,
        finishedAt,
        oddsAtLock: armed?.oddsAtLock,
        commitHash: armed?.commitHash,
        /* Taken before settlement, so Undo restores rather than re-derives. */
        chipBankBefore: { ...event.chipBank },
        streaksBefore: { ...event.streaks },
      };

      const settled = settleBets(event.bets, raceNo, winner?.lane ?? -1);
      const bank = { ...event.chipBank };
      for (const b of settled) {
        if (b.raceNo !== raceNo || !b.returned) continue;
        const k = b.punter.trim().toLowerCase();
        bank[k] = (bank[k] ?? CHIP_START) + b.returned;
      }

      /*
       * Streaks. Anyone who had a bet on this race either extended a run or
       * ended one, and a run pays a bonus on top of the odds - which is the
       * reason to come back for the next race rather than sit the rest out.
       * Punters who sat this one out keep the streak they had.
       */
      const streaks = { ...event.streaks };
      const played = new Map<string, boolean>();
      for (const b of settled) {
        if (b.raceNo !== raceNo) continue;
        const k = b.punter.trim().toLowerCase();
        played.set(k, (played.get(k) ?? false) || Boolean(b.won));
      }
      for (const [k, won] of played) {
        const run = won ? (streaks[k] ?? 0) + 1 : 0;
        streaks[k] = run;
        if (run >= 2) bank[k] = (bank[k] ?? CHIP_START) + STREAK_BONUS * run;
      }

      setState({
        raceNumber: raceNo,
        history: [entry, ...event.history],
        bets: settled,
        chipBank: bank,
        streaks,
        bettingOpen: true,
      });

      const settledCount = settled.filter((b) => b.raceNo === raceNo).length;
      const paid = settled
        .filter((b) => b.raceNo === raceNo)
        .reduce((s, b) => s + (b.returned ?? 0), 0);
      addAudit({
        kind: 'race_finished',
        raceNo,
        detail: `Race ${raceNo} finished. Winner ${winner?.name ?? 'none'} (lane ${
          (winner?.lane ?? -1) + 1
        }), seed ${drawn.seedHex}.`,
      });
      if (settledCount) {
        addAudit({
          kind: 'bets_settled',
          raceNo,
          detail: `Race ${raceNo}: ${settledCount} fun-chip ${
            settledCount === 1 ? 'bet' : 'bets'
          } settled once, ${paid} chips paid at locked odds. FUN CHIPS - no monetary value.`,
        });
      }

      /*
       * The result hash is async (SHA-256), so it lands on the entry a beat
       * after the entry itself. The functional patch finds the entry again
       * rather than assuming it is still at the head of the list.
       */
      void resultHashOf(drawn.seedHex, results).then((hash) => {
        setState((s) => ({
          history: s.history.map((h) =>
            h.raceNo === raceNo && !h.void && h.seedHex === drawn.seedHex
              ? { ...h, resultHash: hash }
              : h,
          ),
        }));
      });

      armedRef.current = null;
      setHighlights(reel);
      setOverlayOpen(true);
      setConfettiKey((k) => k + 1);
    },
    [event.bets, event.chipBank, event.history, event.raceDurationMs, event.raceType, event.trackShape, event.streaks, names, nextRaceNo, potCents, sponsor],
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
        if (race.phase === 'idle' || race.phase === 'done' || race.phase === 'void') startRace();
        return;
      }
      if (back) {
        e.preventDefault();
        if (overlayOpen) setOverlayOpen(false);
        else resetRace();
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
  }, [drawerOpen, overlayOpen, race.phase, startRace, resetRace, event.calm, event.sound, event.music, event.caller]);

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
      <a className="skip-link" href="#controls">
        Skip to moderator controls
      </a>
      <div className="aurora" aria-hidden="true" />

      <div className="stage-shell mx-auto flex min-h-dvh w-full max-w-[1700px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
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
              {event.raceType} {nextRaceNo}
            </span>
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
            {event.trackShape === 'circuit' ? (
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
                <p className="call-rail h-5 truncate text-sm text-(--tx)/55">{race.commentary}</p>
              </div>

              <div className="flex flex-wrap gap-2">
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
                {racing ? (
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
        results={race.results}
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
