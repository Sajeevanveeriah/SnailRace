'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RaceTrack } from './RaceTrack';
import { ToteBoard } from './ToteBoard';
import { BetSlip } from './BetSlip';
import { DonateQr } from './DonateQr';
import { GoalRing } from './GoalRing';
import { CountUp } from './CountUp';
import { Confetti } from './Confetti';
import { WinnerOverlay } from './WinnerOverlay';
import { ControlDrawer } from './ControlDrawer';
import { hydrate, useEvent, setState } from '@/lib/event-store';
import { useOrigin } from '@/lib/use-origin';
import { newId, nowMs } from '@/lib/ids';
import { useDonations } from '@/lib/use-donations';
import { useRace } from '@/lib/use-race';
import { poolsFor, settleBets } from '@/lib/tote';
import { encodeLineup } from '@/lib/lineup';
import { money, moneyShort, CHIP_START } from '@/lib/money';
import { laneColour } from '@/lib/palette';
import { primeAudio, setSoundEnabled, sfx } from '@/lib/sound';
import type { Bet, Donation, RaceHistoryEntry } from '@/lib/types';
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

  const feed = useDonations(event.eventId);
  const names = useMemo(
    () => event.names.slice(0, event.fieldSize),
    [event.names, event.fieldSize],
  );
  const nextRaceNo = event.raceNumber + 1;

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

  const onFinish = useCallback(
    (drawn: DrawnRace, results: { lane: number; name: string; place: number; finishMs: number }[]) => {
      const raceNo = nextRaceNo;
      const winner = results[0];

      const entry: RaceHistoryEntry = {
        raceNo,
        raceType: event.raceType,
        seedHex: drawn.seedHex,
        fieldSize: names.length,
        durationMs: event.raceDurationMs,
        at: nowMs(),
        results,
        potCents,
        photoFinish: drawn.photoFinish,
      };

      const settled = settleBets(event.bets, raceNo, winner?.lane ?? -1);
      const bank = { ...event.chipBank };
      for (const b of settled) {
        if (b.raceNo !== raceNo || !b.returned) continue;
        const k = b.punter.trim().toLowerCase();
        bank[k] = (bank[k] ?? CHIP_START) + b.returned;
      }

      setState({
        raceNumber: raceNo,
        history: [entry, ...event.history],
        bets: settled,
        chipBank: bank,
        bettingOpen: true,
      });

      setOverlayOpen(true);
      setConfettiKey((k) => k + 1);
    },
    [event.bets, event.chipBank, event.history, event.raceDurationMs, event.raceType, names.length, nextRaceNo, potCents],
  );

  const race = useRace(onFinish);

  const startRace = useCallback(() => {
    primeAudio();
    setOverlayOpen(false);
    setState({ bettingOpen: false });
    race.start(names, event.raceDurationMs);
  }, [names, event.raceDurationMs, race]);

  const resetRace = useCallback(() => {
    race.reset();
    setOverlayOpen(false);
    setState({ bettingOpen: true });
  }, [race]);

  /* ── Fun bets ────────────────────────────────────────────────────────── */

  const placeBet = useCallback(
    (bet: Omit<Bet, 'id' | 'settled'>) => {
      const k = bet.punter.trim().toLowerCase();
      const bank = event.chipBank[k] ?? CHIP_START;
      setState({
        bets: [...event.bets, { ...bet, id: newId('bet'), settled: false }],
        chipBank: { ...event.chipBank, [k]: bank - bet.chips },
      });
    },
    [event.bets, event.chipBank],
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

      if (e.code === 'Space') {
        e.preventDefault();
        if (race.phase === 'idle' || race.phase === 'done') startRace();
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
      if (k === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, overlayOpen, race.phase, startRace, resetRace, event.calm, event.sound]);

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
  const winnerColour = race.results[0] ? laneColour(race.results[0].lane).shell : '#ffb020';

  return (
    <div className={event.calm ? 'calm' : undefined}>
      <a className="skip-link" href="#controls">
        Skip to moderator controls
      </a>
      <div className="aurora" aria-hidden="true" />

      <div className="stage-shell mx-auto flex min-h-dvh max-w-[1700px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
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
          </div>
        </header>

        {/* ── Stage body ─────────────────────────────────────────────── */}
        <main className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <RaceTrack names={names} race={race} surface={event.stageTheme} />

            <div className="glass flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-3">
                  <p className="text-lg font-semibold">{race.status}</p>
                  {race.seedHex ? (
                    <span
                      className="num text-[11px] text-white/35"
                      title="The seed the finishing order was drawn from, printed before the snails moved."
                    >
                      seed {race.seedHex}
                    </span>
                  ) : null}
                </div>
                <p className="h-5 truncate text-sm text-white/55">{race.commentary}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`btn btn-go ${!racing ? 'btn-pulse' : ''}`}
                  onClick={startRace}
                  disabled={racing}
                >
                  {race.phase === 'done' ? 'Next race' : 'Start race'} <kbd>Space</kbd>
                </button>
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

            <RecentDonations donations={liveDonations} />
          </div>

          <div className="flex flex-col gap-4">
            <ToteBoard
              lanes={lanes}
              potCents={potCents}
              fieldSize={names.length}
              raceNo={nextRaceNo}
              showOdds
            />

            {donateUrl && feed.status !== 'unconfigured' ? (
              <section className="glass glass-strong flex flex-col items-center gap-3 p-6">
                <h2 className="eyebrow">Back a snail</h2>
                <DonateQr url={donateUrl} />
                <p className="text-center text-xs text-white/50">
                  Card donations by Stripe. Every dollar goes to the club.
                </p>
              </section>
            ) : null}

            <BetSlip
              lanes={lanes}
              raceNo={nextRaceNo}
              bets={event.bets}
              chipBank={event.chipBank}
              open={event.bettingOpen && !racing}
              onPlace={placeBet}
            />
          </div>
        </main>
      </div>

      {toast ? (
        <div className="toast glass glass-strong fixed right-5 top-5 z-[95] max-w-xs px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Donation in</p>
          <p className="mt-1 font-semibold">
            {toast.backerName || 'Anonymous'} backed {toast.snailName}
          </p>
          <p className="num text-2xl font-bold text-(--color-lime)">{money(toast.cents)}</p>
        </div>
      ) : null}

      <WinnerOverlay
        open={overlayOpen}
        raceNo={event.raceNumber}
        results={race.results}
        donations={allDonations}
        bets={event.bets}
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
      />
    </div>
  );
}

/* ── Small presentational pieces ──────────────────────────────────────── */

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
      ? '!text-[#6ee7a0]'
      : status === 'offline'
        ? '!text-[#ff9d94]'
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
      <div className="glass px-5 py-4 text-sm text-white/45">
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
        <span className="text-white/45">on {d.snailName}</span>
        <span className="num font-semibold text-(--color-lime)">{money(d.cents)}</span>
        {d.source === 'cash' ? (
          <span className="rounded-full bg-white/10 px-2 text-[10px]">cash</span>
        ) : null}
      </span>
    ));

  return (
    <div className="glass overflow-hidden px-5 py-3.5">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
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
