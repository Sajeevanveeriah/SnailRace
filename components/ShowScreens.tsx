'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Racecard } from './Racecard';
import { ToteBoard } from './ToteBoard';
import { DonateQr } from './DonateQr';
import { GoalRing } from './GoalRing';
import { CountUp } from './CountUp';
import { showPhaseSpec } from '@/lib/show';
import { standingsFrom } from '@/lib/standings';
import { laneColour } from '@/lib/palette';
import { moneyShort } from '@/lib/money';
import type { RoomSummary } from '@/lib/use-phone-play';
import type { LanePool } from '@/lib/tote';
import type { EventState } from '@/lib/types';

const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/**
 * The projector's non-race screens: the run of show.
 *
 * Each phase is one full-bleed screen in the broadcast's visual language -
 * event identity top left, phase strip top right, one clear subject in the
 * middle, and nothing decorative that does not serve the room. The race
 * itself, and its results card, belong to the existing race surfaces; this
 * overlay renders only between them.
 */

export function ShowOverlay({
  event,
  lanes,
  potCents,
  nightCents,
  nextRaceNo,
  sponsor,
  donateUrl,
  playUrl,
  room,
  marketLockAt,
}: {
  event: EventState;
  lanes: LanePool[];
  potCents: number;
  nightCents: number;
  nextRaceNo: number;
  sponsor?: string;
  donateUrl: string;
  playUrl: string;
  room: RoomSummary | null;
  /** Wall-clock ms when the market locks, when the operator armed a timer. */
  marketLockAt: number | null;
}) {
  const phase = event.showPhase;
  if (phase === 'race' || phase === 'results') return null;

  return (
    <ShowDialog phase={phase}>
      <header className="show-top">
        <div className="min-w-0">
          <p className="show-club">{event.clubName}</p>
          <p className="show-event truncate">{event.eventName}</p>
        </div>
        {event.rehearsal ? <span className="show-rehearsal">REHEARSAL</span> : null}
        <span className="show-phase num">{showPhaseSpec(phase).screen}</span>
      </header>

      {phase === 'lobby' ? <Lobby event={event} donateUrl={donateUrl} playUrl={playUrl} /> : null}
      {phase === 'racecard' ? (
        <section className="show-body">
          <div className="show-panel show-panel-wide">
            <Racecard
              names={event.names.slice(0, event.fieldSize)}
              history={event.history}
              lanes={lanes}
              raceNo={nextRaceNo}
              sponsor={sponsor}
              compact={event.fieldSize > 12}
            />
          </div>
        </section>
      ) : null}
      {phase === 'market' ? (
        <Market
          lanes={lanes}
          potCents={potCents}
          nextRaceNo={nextRaceNo}
          fieldSize={event.fieldSize}
          names={event.names}
          playUrl={playUrl}
          room={room}
          marketLockAt={marketLockAt}
          open={event.bettingOpen}
        />
      ) : null}
      {phase === 'championship' ? <Championship event={event} /> : null}
      {phase === 'intermission' ? (
        <section className="show-body show-center">
          <div className="show-panel text-center">
            <h2 className="display text-5xl">Back shortly</h2>
            <p className="mt-4 text-lg text-(--tx)/60">
              Racing resumes with race {nextRaceNo}. The bar is open, and so is the donation tin.
            </p>
            <div className="mx-auto mt-6 flex items-center justify-center gap-8">
              <div className="text-center">
                <p className="eyebrow">Raised tonight</p>
                <CountUp value={nightCents} format={moneyShort} className="display money-ink text-5xl" />
              </div>
              {event.goalShow ? (
                <GoalRing raisedCents={nightCents} goalCents={event.goalCents} />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      {phase === 'finale' ? <Finale event={event} nightCents={nightCents} /> : null}

      <footer className="show-strap">
        <span className="fun-chip-banner">FUN CHIPS - NO MONETARY VALUE</span>
        <span className="text-sm text-(--tx)/55">
          Every snail has an equal chance. Donations never influence a result.
        </span>
      </footer>
    </ShowDialog>
  );
}

function ShowDialog({ phase, children }: { phase: EventState['showPhase']; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [phase]);
  return (
    <div
      ref={ref}
      className="show-screen"
      role="region"
      aria-label={`${showPhaseSpec(phase).screen} screen`}
      tabIndex={-1}
      style={{ '--show-art': `url(${ART_BASE}/snail-race-oval.webp)` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/* ── Screens ───────────────────────────────────────────────────────────── */

function Lobby({ event, donateUrl, playUrl }: { event: EventState; donateUrl: string; playUrl: string }) {
  const sponsors = event.sponsors.map((s) => s.trim()).filter(Boolean);
  return (
    <section className="show-body show-center">
      <div className="grid w-full max-w-[1200px] gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="show-panel">
          <h2 className="display text-balance text-6xl leading-[0.98]">{event.eventName}</h2>
          <p className="mt-4 text-xl text-(--tx)/65">
            {event.plannedRaces} races. Free fun chips. Real donations to {event.clubName}.
          </p>
          <ul className="mt-6 grid gap-2 text-[15px] text-(--tx)/70">
            <li>Chips are free and worth nothing - the leaderboard is the glory.</li>
            <li>Every snail wins with exactly the same chance, drawn before the off.</li>
            <li>Donations are gifts to the club and never touch a race.</li>
          </ul>
          {sponsors.length ? (
            <div className="mt-7 border-t border-(--tx)/10 pt-4">
              <p className="eyebrow mb-2">Tonight&apos;s race sponsors</p>
              <p className="flex flex-wrap gap-x-6 gap-y-1 text-lg font-semibold text-(--gold)">
                {sponsors.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          {playUrl ? (
            <div className="show-panel text-center">
              <p className="eyebrow mb-2">Play along on your phone</p>
              <DonateQr url={playUrl} caption="Scan to join with 100 free chips" />
            </div>
          ) : null}
          {donateUrl ? (
            <div className="show-panel text-center">
              <p className="eyebrow mb-2">Back the club</p>
              <DonateQr url={donateUrl} caption="Scan to donate - every dollar to the club" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Market({
  lanes,
  potCents,
  nextRaceNo,
  fieldSize,
  names,
  playUrl,
  room,
  marketLockAt,
  open,
}: {
  lanes: LanePool[];
  potCents: number;
  nextRaceNo: number;
  fieldSize: number;
  names: string[];
  playUrl: string;
  room: RoomSummary | null;
  marketLockAt: number | null;
  open: boolean;
}) {
  /* The countdown repaints once a second; nothing else re-renders with it. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!marketLockAt) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [marketLockAt]);
  const secondsLeft = marketLockAt ? Math.max(0, Math.ceil((marketLockAt - nowMs) / 1000)) : null;

  const roomTotal = room
    ? Object.values(room.perLane).reduce((s, l) => s + l.chips, 0)
    : 0;
  const hasAudiencePanel = Boolean(playUrl || (room && room.players > 0));

  return (
    <section className="show-body">
      <div
        className={`grid w-full gap-5 ${
          hasAudiencePanel ? 'max-w-[1240px] lg:grid-cols-[1.1fr_1fr]' : 'max-w-[1040px]'
        }`}
      >
        <div className="flex flex-col gap-4">
          <div className="show-panel">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="display text-4xl">
                {open ? `Market open - race ${nextRaceNo}` : 'MARKET CLOSED'}
              </h2>
              {secondsLeft !== null && open ? (
                <span
                  className={`num show-countdown ${secondsLeft <= 10 ? 'show-countdown-hot' : ''}`}
                  role="timer"
                  aria-label={`Market locks in ${secondsLeft} seconds`}
                >
                  {secondsLeft}s
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-(--tx)/60">
              {open
                ? 'Fun chips at the table or on your phone. The odds you take are the odds you keep.'
                : 'Selections are locked at snapshot odds. They are heading to the gate.'}
            </p>
          </div>
          <div className="show-panel">
            <ToteBoard lanes={lanes} potCents={potCents} fieldSize={fieldSize} raceNo={nextRaceNo} showOdds />
          </div>
        </div>

        {hasAudiencePanel ? <div className="flex flex-col gap-4">
          {room && room.players > 0 ? (
            <div className="show-panel">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="eyebrow">The room&apos;s picks</h3>
                <span className="num text-xs text-(--tx)/45">
                  {room.players} {room.players === 1 ? 'phone' : 'phones'} · {roomTotal} chips
                </span>
              </div>
              <ol className="flex flex-col gap-2">
                {names.slice(0, fieldSize).map((name, laneIdx) => {
                  const laneData = room.perLane[laneIdx];
                  const width = roomTotal > 0 && laneData ? (laneData.chips / roomTotal) * 100 : 0;
                  return (
                    <li key={laneIdx} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-sm">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: laneColour(laneIdx).shell }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{name}</span>
                      <span className="num text-(--tx)/55">{laneData?.chips ?? 0}</span>
                      <span className="tote-bar col-span-3 h-1.5 overflow-hidden rounded-full bg-(--tx)/8" aria-hidden="true">
                        <i style={{ '--w': width } as React.CSSProperties} />
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="fun-chip-tag mt-3">fun chips - no monetary value</p>
            </div>
          ) : null}
          {playUrl ? (
            <div className="show-panel text-center">
              <p className="eyebrow mb-2">Join in</p>
              <DonateQr url={playUrl} caption="Scan to play along - free fun chips" />
            </div>
          ) : null}
        </div> : null}
      </div>
    </section>
  );
}

function Championship({ event }: { event: EventState }) {
  const rows = standingsFrom(event.history).slice(0, 10);
  const top = rows[0]?.points || 1;
  return (
    <section className="show-body show-center">
      <div className="show-panel show-panel-wide">
        <h2 className="display mb-5 text-5xl">Championship</h2>
        {rows.length === 0 ? (
          <p className="text-lg text-(--tx)/60">The first result writes the first line of this table.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <li key={row.name} className="grid grid-cols-[2.4rem_1fr_3fr_4rem] items-center gap-3 text-lg">
                <span className="num font-bold text-(--tx)/50">{i + 1}</span>
                <span className="truncate font-semibold">{row.name}</span>
                <span className="st-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(4, (row.points / top) * 100)}%` }} />
                </span>
                <span className="num text-right font-bold">{row.points}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-sm text-(--tx)/50">
          5 for a win, 3 for second, 1 for third. A consistent second beats one lucky win.
        </p>
      </div>
    </section>
  );
}

function Finale({ event, nightCents }: { event: EventState; nightCents: number }) {
  const rows = standingsFrom(event.history);
  const champion = rows[0];
  const sponsors = [
    ...new Set([...event.sponsors, ...event.history.map((h) => h.sponsor ?? '')]),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <section className="show-body show-center">
      <div className="show-panel show-panel-wide text-center">
        <p className="eyebrow">Night champion</p>
        {champion ? (
          <h2 className="display mt-2 text-balance text-6xl">{champion.name}</h2>
        ) : (
          <h2 className="display mt-2 text-5xl">Thank you for racing</h2>
        )}
        {champion ? (
          <p className="mt-3 text-lg text-(--tx)/60">
            {champion.points} points from {champion.races} races, {champion.wins}{' '}
            {champion.wins === 1 ? 'win' : 'wins'}.
          </p>
        ) : null}
        <div className="mx-auto mt-7 w-fit text-center">
          <p className="eyebrow">Raised for {event.clubName}</p>
          <CountUp value={nightCents} format={moneyShort} className="display money-ink text-6xl" />
        </div>
        {sponsors.length ? (
          <p className="mt-7 text-sm text-(--tx)/55">
            With thanks to tonight&apos;s sponsors: <b className="text-(--gold)">{sponsors.join(' · ')}</b>
          </p>
        ) : null}
        <p className="mt-6 text-lg text-(--tx)/70">Safe travels home - and thank you.</p>
      </div>
    </section>
  );
}
