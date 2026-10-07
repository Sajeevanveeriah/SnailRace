'use client';

import Image from 'next/image';
import { DonateQr } from './DonateQr';
import { ClubBrand } from './brand/ClubBrand';
import { RunnerLineup } from './race-broadcast/RunnerLineup';
import { showPhaseSpec } from '@/lib/show';
import { money, moneyShort } from '@/lib/money';
import { eventWhen } from '@/lib/event-when';
import { cardRaceNames, cardRaceOwners, snailsForRace, soldCount, SNAILS_ON_CARD } from '@/lib/card';
import { quaddieStatus } from '@/lib/quaddie';
import { laneColour } from '@/lib/palette';
import { toteProceeds } from '@/lib/cash-tote';
import type { EventState } from '@/lib/types';

const POSTER = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/brand/20261003-NDCC-Snail-Racing-Poster-Rev00.webp`;
const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/**
 * The projector's non-race screens.
 *
 * Five screens make the night: welcome, racecard, race, result and, when the
 * club is running one, the quaddie board; then the thank-you. Each is one
 * full-bleed screen with the crest top left, the phase top right and one
 * subject in the middle. Nothing scrolls, nothing cycles.
 */
export function ShowOverlay({
  event,
  nightCents,
  nextRaceNo,
  sponsor,
  snailLinkUrl,
}: {
  event: EventState;
  nightCents: number;
  nextRaceNo: number;
  sponsor?: string;
  /** The $4 snail link the QR encodes. Empty when none is configured. */
  snailLinkUrl: string;
}) {
  const phase = event.showPhase;
  if (phase === 'race' || phase === 'results') return null;

  return (
    <ShowDialog phase={phase}>
      <header className="show-top">
        <ClubBrand
          className="club-brand show-club-brand"
          imageClassName="club-brand-logo show-club-logo"
          nameClassName="show-club"
          priority
        />
        <div className="min-w-0 show-event-block">
          <p className="show-event truncate">{event.eventName}</p>
        </div>
        {event.rehearsal ? <span className="show-rehearsal">REHEARSAL</span> : null}
        <span className="show-phase num">{showPhaseSpec(phase).screen}</span>
      </header>

      {phase === 'lobby' || phase === 'intermission' ? <Lobby event={event} snailLinkUrl={snailLinkUrl} /> : null}
      {phase === 'racecard' || phase === 'market' ? (
        <RacecardScreen event={event} raceNo={nextRaceNo} sponsor={sponsor} snailLinkUrl={snailLinkUrl} />
      ) : null}
      {phase === 'championship' ? <QuaddieBoard event={event} /> : null}
      {phase === 'finale' ? <Finale event={event} nightCents={nightCents} /> : null}

      <footer className="show-strap">
        <span className="text-sm text-(--tx)/55">
          Every snail has the same chance. The result is drawn and sealed before the gates open.
        </span>
      </footer>
    </ShowDialog>
  );
}

function ShowDialog({ phase, children }: { phase: EventState['showPhase']; children: React.ReactNode }) {
  return (
    <div
      className="show-screen"
      role="region"
      aria-label={`${showPhaseSpec(phase).screen} screen`}
      tabIndex={0}
      style={{ '--show-art': `url(${ART_BASE}/snail-race-oval.webp)` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/* ── Screens ───────────────────────────────────────────────────────────── */

function SnailQr({ url, cents, compact = false }: { url: string; cents: number; compact?: boolean }) {
  if (!url) {
    return (
      <div className="show-panel text-center">
        <p className="eyebrow mb-1">Buy a snail</p>
        <p className="show-backing-price num">{moneyShort(cents)}</p>
        <p className="mt-2 text-sm text-(--tx)/60">See the table to buy and name your snail.</p>
      </div>
    );
  }
  return (
    <div className="show-panel text-center">
      <p className="eyebrow mb-2">Buy a snail, {moneyShort(cents)}</p>
      <DonateQr url={url} caption={compact ? 'Scan to buy and name a snail' : 'Scan, pay by card, name your snail'} />
    </div>
  );
}

function Lobby({ event, snailLinkUrl }: { event: EventState; snailLinkUrl: string }) {
  const sponsors = event.sponsors.map((s) => s.trim()).filter(Boolean);
  const when = eventWhen(event);
  const sold = soldCount(event.card);
  return (
    <section className="show-body show-center">
      <div className="grid w-full max-w-[1200px] gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="show-panel">
          {event.eventTagline?.trim() ? <p className="eyebrow mb-2 show-tagline">{event.eventTagline.trim()}</p> : null}
          <h2 className="display text-balance text-6xl leading-[0.98]">{event.eventName}</h2>
          {when ? <p className="show-when num mt-3">{when}</p> : null}
          <p className="mt-4 text-xl text-(--tx)/65">
            {event.plannedRaces} races. Ten snails a race. {SNAILS_ON_CARD} snails on the card.
          </p>
          <p className="show-backing mt-4">
            <span className="show-backing-price num">{moneyShort(event.card.snailCents)} a snail</span>
            <span>Buy one, name it, cheer it home.</span>
          </p>
          <ul className="mt-6 grid gap-2 text-[15px] text-(--tx)/70">
            <li>Your snail number decides its race: 1 to 10 run first, 11 to 20 next, and so on.</li>
            <li>Every snail wins with exactly the same chance, drawn before the off.</li>
            <li>{sold} of {SNAILS_ON_CARD} snails have an owner so far.</li>
          </ul>
          <p className="show-slogan mt-6">Slow race. Big cheers.</p>
          {sponsors.length ? (
            <div className="mt-7 border-t border-(--tx)/10 pt-4">
              <p className="eyebrow mb-2">Tonight&apos;s sponsors</p>
              <p className="flex flex-wrap gap-x-6 gap-y-1 text-lg font-semibold text-(--gold)">
                {sponsors.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <div className="show-poster" aria-hidden="true">
            <Image unoptimized src={POSTER} alt="" width={900} height={1125} sizes="(max-width: 1024px) 100vw, 400px" />
          </div>
          <SnailQr url={snailLinkUrl} cents={event.card.snailCents} />
        </div>
      </div>
    </section>
  );
}

function RacecardScreen({
  event,
  raceNo,
  sponsor,
  snailLinkUrl,
}: {
  event: EventState;
  raceNo: number;
  sponsor?: string;
  snailLinkUrl: string;
}) {
  const names = cardRaceNames(event.card, raceNo);
  const owners = cardRaceOwners(event.card, raceNo);
  const numbers = snailsForRace(raceNo);
  const unsold = numbers.filter((n) => !event.card.names[n - 1]?.trim() && !event.card.owners[n - 1]?.trim());
  const quaddie = quaddieStatus(event.quaddie, event.quaddieEntries, event.history);
  const leg = quaddie.live ? event.quaddie.legs.indexOf(raceNo) : -1;
  return (
    <section className="show-body">
      <div className="show-panel show-panel-wide show-racecard-panel">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-4xl">
            Race {raceNo} of {event.plannedRaces}
            <span className="num ml-3 text-lg text-(--tx)/55">snails {numbers[0]} to {numbers[numbers.length - 1]}</span>
          </h2>
          <div className="flex items-center gap-3 text-sm">
            {leg >= 0 ? <span className="show-leg num">QUADDIE LEG {leg + 1}</span> : null}
            {sponsor ? <span className="text-(--gold)">Sponsored by {sponsor}</span> : null}
          </div>
        </div>
        <RunnerLineup names={names} numberOffset={(raceNo - 1) * 10} dense />
        <ol className="show-owner-grid" aria-label={`Owners for race ${raceNo}`}>
          {numbers.map((snailNo, lane) => (
            <li key={snailNo} className={owners[lane] || names[lane] !== `Snail ${snailNo}` ? '' : 'show-owner-unsold'}>
              <span className="show-owner-no num" style={{ background: laneColour(lane).shell }}>
                {snailNo}
              </span>
              <span className="show-owner-name">{names[lane]}</span>
              <span className="show-owner-owner">{owners[lane] || (names[lane] === `Snail ${snailNo}` ? 'Unsold' : '')}</span>
            </li>
          ))}
        </ol>
        {unsold.length && snailLinkUrl ? (
          <div className="show-racecard-qr">
            <SnailQr url={snailLinkUrl} cents={event.card.snailCents} compact />
            <p className="text-sm text-(--tx)/60">
              Still unsold in this race: <b className="num">{unsold.join(', ')}</b>. Buy before the gate.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function QuaddieBoard({ event }: { event: EventState }) {
  const status = quaddieStatus(event.quaddie, event.quaddieEntries, event.history);
  if (!status.live) {
    return (
      <section className="show-body show-center">
        <div className="show-panel text-center">
          <h2 className="display text-5xl">Next race shortly</h2>
        </div>
      </section>
    );
  }
  const nextLeg = status.legs.find((l) => l.alive === null);
  return (
    <section className="show-body show-center">
      <div className="show-panel show-panel-wide">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-5xl">Quaddie</h2>
          <p className="num text-lg text-(--tx)/70">
            {status.entries} {status.entries === 1 ? 'ticket' : 'tickets'} · pool {money(status.poolCents)} ·{' '}
            {money(status.returnedCents)} to the winners
          </p>
        </div>
        <ol className="quaddie-legs">
          {status.legs.map((leg) => (
            <li key={leg.raceNo} className={leg.alive === null ? 'quaddie-leg-pending' : 'quaddie-leg-run'}>
              <span className="num quaddie-leg-no">Leg {leg.index + 1}</span>
              <span className="quaddie-leg-race">Race {leg.raceNo}</span>
              <span className="quaddie-leg-result">
                {leg.winnerSnail !== null ? (
                  <>
                    won by <b className="num">{leg.winnerSnail}</b> {leg.winnerName}
                  </>
                ) : (
                  'to run'
                )}
              </span>
              <span className="num quaddie-leg-alive">
                {leg.alive === null ? '' : `${leg.alive} alive`}
              </span>
            </li>
          ))}
        </ol>
        {status.complete ? (
          <p className="mt-5 text-xl">
            {status.unwon
              ? `No ticket picked all four. The pool of ${money(status.poolCents)} stays with ${event.clubName}.`
              : `${status.winners.length} winning ${status.winners.length === 1 ? 'ticket' : 'tickets'}: ${status.winners
                  .map((w) => w.holder)
                  .join(', ')}. Each collects ${money(status.dividendCents)}.`}
          </p>
        ) : status.legsRun > 0 ? (
          <p className="mt-5 text-xl">
            {status.alive.length === 0
              ? `Nobody is still alive. The pool stays with ${event.clubName}.`
              : `${status.alive.length} ${status.alive.length === 1 ? 'ticket is' : 'tickets are'} still alive: ${status.alive
                  .slice(0, 8)
                  .map((a) => `${a.holder} (needs ${a.picks[nextLeg?.index ?? 3]})`)
                  .join(', ')}${status.alive.length > 8 ? ' and more' : ''}.`}
          </p>
        ) : (
          <p className="mt-5 text-lg text-(--tx)/60">
            Entries close when race {event.quaddie.legs[0]} goes to the gate.
          </p>
        )}
        <p className="mt-4 text-sm text-(--tx)/50">
          {event.quaddie.retainedPercent}% of the pool to {event.clubName}; dividends rounded down to 10c. Club product under its
          own authority.
        </p>
      </div>
    </section>
  );
}

function Finale({ event, nightCents }: { event: EventState; nightCents: number }) {
  const winners = event.history
    .filter((h) => !h.void)
    .slice()
    .sort((a, b) => a.raceNo - b.raceNo)
    .map((h) => {
      const w = h.results.find((r) => r.place === 1);
      return w ? { raceNo: h.raceNo, name: w.name, snailNo: (h.raceNo - 1) * 10 + w.lane + 1, owner: event.card.owners[(h.raceNo - 1) * 10 + w.lane] ?? '' } : null;
    })
    .filter((x): x is { raceNo: number; name: string; snailNo: number; owner: string } => x !== null);
  const sponsors = [...new Set([...event.sponsors, ...event.history.map((h) => h.sponsor ?? '')])]
    .map((s) => s.trim())
    .filter(Boolean);
  const quaddie = quaddieStatus(event.quaddie, event.quaddieEntries, event.history);
  const proceeds = toteProceeds(event.history);
  return (
    <section className="show-body show-center">
      <div className="show-panel show-panel-wide text-center">
        <h2 className="display mt-2 text-5xl">Thank you for racing</h2>
        {winners.length ? (
          <ol className="finale-winners">
            {winners.map((w) => (
              <li key={w.raceNo}>
                <span className="num">Race {w.raceNo}</span>
                <b>{w.name}</b>
                <span className="num">#{w.snailNo}</span>
                <span className="text-(--tx)/60">{w.owner}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {nightCents > 0 ? (
          <div className="mx-auto mt-7 w-fit text-center">
            <p className="eyebrow">Raised for {event.clubName}</p>
            <p className="display money-ink text-6xl num">{moneyShort(nightCents)}</p>
          </div>
        ) : null}
        {quaddie.live && quaddie.complete ? (
          <p className="mt-4 text-base text-(--tx)/70">
            Quaddie:{' '}
            {quaddie.unwon
              ? `no winner, ${money(quaddie.poolCents)} to the club`
              : `${quaddie.winners.map((w) => w.holder).join(', ')} collected ${money(quaddie.dividendCents)} each`}
          </p>
        ) : null}
        {proceeds.races || proceeds.auctionCents ? (
          <p className="mt-2 text-base text-(--tx)/70">
            Cash tote to the club <b className="num text-(--gold)">{money(proceeds.toteCents)}</b> · paid out{' '}
            <b className="num">{money(proceeds.paidOutCents)}</b>
          </p>
        ) : null}
        {sponsors.length ? (
          <p className="mt-7 text-sm text-(--tx)/55">
            With thanks to tonight&apos;s sponsors: <b className="text-(--gold)">{sponsors.join(' · ')}</b>
          </p>
        ) : null}
        <p className="mt-6 text-lg text-(--tx)/70">Safe travels home.</p>
      </div>
    </section>
  );
}
