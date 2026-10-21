'use client';

import { useEffect, useState } from 'react';
import { DonateQr } from './DonateQr';
import { ClubBrand } from './brand/ClubBrand';
import { showPhaseSpec } from '@/lib/show';
import { money, moneyShort } from '@/lib/money';
import { eventWhen } from '@/lib/event-when';
import { cardRaceNames, cardRaceOwners, isSold, raceTitle, sizesPhrase, snailsForRace, soldCount, validSnailNo } from '@/lib/card';
import { quaddieStatus } from '@/lib/quaddie';
import { laneColour } from '@/lib/palette';
import { toteProceeds } from '@/lib/cash-tote';
import { runnerArtForLane, runnerHueRotation } from '@/lib/presentation/runner-art';
import { SURPRISE_LEVEL_NAMES, lengthPhrase, raceSettings, snailOfLane } from '@/lib/run-sheet';
import { designNameOf } from '@/lib/courses';
import type { EventState, ShowPhase } from '@/lib/types';

const POSTER = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/brand/20261003-NDCC-Snail-Racing-Poster-Rev00.webp`;
const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/** What the projector shows outside a race: a phase screen, the holding card, or nothing. */
type View = ShowPhase | 'holding' | null;

/** How long a screen takes to cross-fade out, in ms. Matches the CSS. */
const LEAVE_MS = 520;

/**
 * The projector's non-race screens.
 *
 * Welcome, racecard, (the quaddie board when championship screens are on),
 * thank-you and the holding card. Each is one full-bleed screen sized in
 * projector units (var(--u)), so 720p, 1080p and 4K show the same
 * composition. Every change of screen cross-fades: the screen going off
 * fades out over the one coming on, and the race view underneath shows
 * through as the racecard fades to the gate.
 */
export function ShowOverlay({
  event,
  nightCents,
  nextRaceNo,
  sponsor,
  snailLinkUrl,
  controlsVisible = false,
  holding = false,
  beneathWinner = false,
}: {
  event: EventState;
  nightCents: number;
  nextRaceNo: number;
  sponsor?: string;
  /** The snail link the QR encodes. Empty when none is configured. */
  snailLinkUrl: string;
  /** The operator bar is showing at the bottom: keep the strap clear of it. */
  controlsVisible?: boolean;
  /** The holding card is up. */
  holding?: boolean;
  /** The winner moment is fading out on top: the next screen comes on at once beneath it. */
  beneathWinner?: boolean;
}) {
  const phase = event.showPhase;
  const view: View = phase === 'race' || phase === 'results' ? null : phase;
  const screen = usePresence(view, beneathWinner);
  const hold = usePresence<View>(holding ? 'holding' : null);

  const render = (v: View, state: 'enter' | 'under' | 'leave') => {
    if (!v) return null;
    return (
      <ShowScreen key={`${v}-${state === 'leave' ? 'leave' : 'on'}`} view={v} state={state} controlsVisible={controlsVisible}>
        {v === 'holding' ? (
          <Holding event={event} />
        ) : (
          <>
            <ShowHeader event={event} phase={v} />
            {v === 'lobby' || v === 'intermission' ? <Lobby event={event} snailLinkUrl={snailLinkUrl} /> : null}
            {v === 'racecard' || v === 'market' ? <RacecardScreen event={event} raceNo={nextRaceNo} sponsor={sponsor} snailLinkUrl={snailLinkUrl} /> : null}
            {v === 'championship' ? <QuaddieBoard event={event} /> : null}
            {v === 'finale' ? <Finale event={event} nightCents={nightCents} /> : null}
            <footer className="ss-strap">
              <span>{v === 'finale' ? `Thank you from ${event.clubName}. Safe travels home.` : 'Every snail has the same chance. The result is drawn and sealed before the gates open.'}</span>
            </footer>
          </>
        )}
      </ShowScreen>
    );
  };

  return (
    <>
      {render(screen.leaving, 'leave')}
      {render(screen.current, screen.under ? 'under' : 'enter')}
      {render(hold.leaving, 'leave')}
      {render(hold.current, hold.under ? 'under' : 'enter')}
    </>
  );
}

/**
 * The value on screen now, and the one going off while it fades. The
 * leaving value is derived during render and cleared by a timer.
 */
function usePresence<T>(value: T, beneath = false): { current: T; leaving: T | null; under: boolean } {
  const [current, setCurrent] = useState<T>(value);
  const [leaving, setLeaving] = useState<T | null>(null);
  /* True when the screen came on beneath another: it shows at once while the other fades. */
  const [under, setUnder] = useState(false);
  if (value !== current) {
    setLeaving(current);
    setUnder(current !== null || beneath);
    setCurrent(value);
  }
  useEffect(() => {
    if (leaving === null) return;
    const id = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);
  return { current, leaving: leaving !== current ? leaving : null, under };
}

function ShowScreen({ view, state, controlsVisible, children }: { view: Exclude<View, null>; state: 'enter' | 'under' | 'leave'; controlsVisible: boolean; children: React.ReactNode }) {
  const label = view === 'holding' ? 'Holding screen' : `${showPhaseSpec(view).screen} screen`;
  return (
    <div
      className={`${state !== 'leave' && view !== 'holding' ? 'show-screen ' : ''}ss-screen ss-${state} ${controlsVisible ? 'ss-has-controls' : ''} ${view === 'holding' ? 'ss-holding' : ''}`}
      role={view === 'holding' ? 'status' : 'region'}
      aria-label={label}
      aria-hidden={state === 'leave' ? true : undefined}
      tabIndex={state !== 'leave' ? 0 : -1}
      style={{ '--show-art': `url(${ART_BASE}/snail-race-oval.webp)` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function ShowHeader({ event, phase }: { event: EventState; phase: ShowPhase }) {
  return (
    <header className="ss-top">
      <ClubBrand className="ss-brand" imageClassName="ss-crest" nameClassName="ss-club" priority />
      {/* The welcome poster carries the title; every other screen names the night here. */}
      {phase !== 'lobby' && phase !== 'intermission' ? <p className="ss-event">{event.eventName}</p> : null}
      {event.rehearsal ? <span className="ss-tag ss-tag-rehearsal">REHEARSAL</span> : null}
      <span className="ss-tag num">{showPhaseSpec(phase).screen}</span>
    </header>
  );
}

/** Long names step down a size so they wrap onto two lines at most instead of being cut. */
const lengthClass = (name: string): string => (name.length > 26 ? 'ss-xlong' : name.length > 15 ? 'ss-long' : '');

function Art({ lane, className = '' }: { lane: number; className?: string }) {
  return (
    <span
      className={`ss-art ${className}`}
      aria-hidden="true"
      style={{ backgroundImage: `url(${runnerArtForLane(lane).src})`, filter: `hue-rotate(${runnerHueRotation(lane)}deg)` }}
    />
  );
}

/* ── Welcome ───────────────────────────────────────────────────────────── */

/** "Snails 1 to 8 race first, 9 to 16 next, and so on." from the run sheet. */
export function runOrderSentence(event: Pick<EventState, 'card'>): string {
  const numbered = event.card.races
    .map((row, i) => (row.field?.length ? [] : snailsForRace(i + 1, event.card)))
    .filter((x) => x.length > 0);
  const span = (s: number[]) => `${s[0]} to ${s[s.length - 1]}`;
  if (!numbered.length) return '';
  if (numbered.length === 1) return `Snails ${span(numbered[0])} race tonight.`;
  return `Snails ${span(numbered[0])} race first, ${span(numbered[1])} next${numbered.length > 2 ? ', and so on' : ''}.`;
}

function Lobby({ event, snailLinkUrl }: { event: EventState; snailLinkUrl: string }) {
  const sponsors = [...new Set(event.sponsors.map((s) => s.trim()).filter(Boolean))].slice(0, 8);
  const when = eventWhen(event);
  const sold = soldCount(event.card);
  const races = event.card.races.length;
  const price = moneyShort(event.card.snailCents);
  const sizes = event.card.races.filter((r) => !r.field?.length).map((r) => r.runners);
  const fields = sizes.length && sizes.every((n) => n === sizes[0]) ? `${sizes[0]} snails in each` : sizes.length ? `${sizesPhrase(sizes)} snails` : '';
  return (
    <section className="ss-body ss-welcome">
      {/* The poster, rebuilt live around its illustration: the title, price and date always match the night's settings. */}
      <div className="ss-poster">
        <div className="ss-poster-text">
          <p className="ss-poster-club">{event.clubName}</p>
          {event.eventTagline?.trim() ? <p className="ss-poster-tagline">{event.eventTagline.trim()}</p> : null}
          <h1 className="ss-poster-title">{event.eventName}</h1>
          <div className="ss-poster-price">
            <span className="ss-price num">{price} per snail</span>
            <span className="ss-poster-call">Back your snail.<br />Cheer it home.</span>
          </div>
        </div>
        <div className="ss-poster-art" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={POSTER} alt="" width={900} height={1125} />
        </div>
        {when ? <p className="ss-poster-when num">{when}</p> : null}
      </div>
      <div className="ss-welcome-info">
        <div className="ss-card">
          <p className="ss-kicker">Tonight</p>
          <p className="ss-big num">
            {races} {races === 1 ? 'race' : 'races'}
          </p>
          <p className="ss-line">{fields ? `${fields}. ` : ''}{runOrderSentence(event)}</p>
        </div>
        <div className="ss-card">
          <p className="ss-kicker">Owners so far</p>
          <p className="ss-big num">
            {sold} <span className="ss-big-note">of {event.card.snailCount}</span>
          </p>
          <p className="ss-line">{sponsors.length ? `Snails named so far. With thanks to ${sponsors.join(' · ')}.` : 'Snails named so far. Buy one, name it, cheer it home.'}</p>
        </div>
        <div className="ss-card ss-buy">
          {snailLinkUrl ? <div className="ss-qr"><DonateQr url={snailLinkUrl} size={240} caption="" /></div> : null}
          <div>
            <p className="ss-kicker">Buy a snail</p>
            <p className="ss-big num">{price}</p>
            <p className="ss-line">{snailLinkUrl ? 'Scan, pay by card, name your snail.' : 'See the table to buy and name your snail.'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Racecard ──────────────────────────────────────────────────────────── */

function RacecardScreen({ event, raceNo, sponsor, snailLinkUrl }: { event: EventState; raceNo: number; sponsor?: string; snailLinkUrl: string }) {
  const settings = raceSettings(event, raceNo);
  const names = cardRaceNames(event.card, raceNo);
  const owners = cardRaceOwners(event.card, raceNo);
  const numbers = settings.snails;
  /* Only numbers the payment link can sell: a place past the snails on sale has no ticket yet. */
  const forSale = numbers.filter((n) => validSnailNo(n, event.card) && !isSold(event.card, n));
  const quaddie = quaddieStatus(event.quaddie, event.quaddieEntries, event.history, event.card);
  const leg = quaddie.live ? event.quaddie.legs.indexOf(raceNo) : -1;
  const cols = numbers.length <= 8 ? 4 : numbers.length <= 10 ? 5 : 6;
  return (
    <section className="ss-body ss-racecard">
      <div className="ss-rc-head">
        <div className="ss-rc-title">
          <h2>
            {settings.title}
            {!settings.runOff ? <span className="ss-of num"> of {event.plannedRaces}</span> : null}
          </h2>
          <p className="ss-rc-snails num">
            {settings.runOff ? `${numbers.length} winners race again` : `Snails ${numbers[0]} to ${numbers[numbers.length - 1]}`}
          </p>
        </div>
        <ul className="ss-chips" aria-label="Race details">
          <li>{settings.designName}</li>
          <li className="num">{lengthPhrase(settings)}</li>
          <li>{SURPRISE_LEVEL_NAMES[settings.intensity]} surprises</li>
          {leg >= 0 ? <li className="ss-chip-gold num">Quaddie leg {leg + 1}</li> : null}
          {sponsor ? <li className="ss-chip-gold">Sponsored by {sponsor}</li> : null}
        </ul>
        {forSale.length && snailLinkUrl && !settings.runOff ? (
          <div className="ss-rc-buy">
            <div className="ss-qr ss-qr-small"><DonateQr url={snailLinkUrl} size={160} caption="" /></div>
            <p>
              For sale in this race: <b className="num">{forSale.join(', ')}</b>
            </p>
          </div>
        ) : null}
      </div>
      <ol className={`ss-field ss-cols-${cols}`} aria-label={`Race ${raceNo} field, ${numbers.length} runners`}>
        {numbers.map((snailNo, lane) => {
          const colour = laneColour(lane);
          const onSale = !settings.runOff && forSale.includes(snailNo);
          return (
            <li key={`${lane}-${snailNo}`} className="ss-runner" style={{ '--shell': colour.shell, '--shell-dk': colour.dark } as React.CSSProperties}>
              <span className="ss-runner-no num">{snailNo}</span>
              <Art lane={lane} className="ss-runner-art" />
              <span className={`ss-runner-name ${lengthClass(names[lane])}`}>{names[lane]}</span>
              {owners[lane] ? (
                <span className="ss-runner-owner">{owners[lane]}</span>
              ) : onSale ? (
                <span className="ss-runner-sale">For sale</span>
              ) : (
                <span className="ss-runner-owner">&nbsp;</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ── Quaddie board (championship screens) ─────────────────────────────── */

export function QuaddieBoard({ event }: { event: EventState }) {
  const status = quaddieStatus(event.quaddie, event.quaddieEntries, event.history, event.card);
  if (!status.live) {
    return (
      <section className="ss-body ss-center">
        <h2 className="ss-headline">Next race shortly</h2>
      </section>
    );
  }
  const nextLeg = status.legs.find((l) => l.alive === null);
  return (
    <section className="ss-body ss-center">
      <div className="ss-card ss-quaddie">
        <div className="ss-quaddie-head">
          <h2 className="ss-headline">Quaddie</h2>
          <p className="ss-line num">
            {status.entries} {status.entries === 1 ? 'ticket' : 'tickets'} · pool {money(status.poolCents)} · {money(status.returnedCents)} to the winners
          </p>
        </div>
        <ol className="ss-legs">
          {status.legs.map((leg) => (
            <li key={leg.raceNo} className={leg.alive === null ? 'ss-leg-pending' : ''}>
              <span className="num ss-leg-no">Leg {leg.index + 1}</span>
              <span>Race {leg.raceNo}</span>
              <span>
                {leg.winnerSnail !== null ? (
                  <>won by <b className="num">{leg.winnerSnail}</b> {leg.winnerName}</>
                ) : (
                  'to run'
                )}
              </span>
              <span className="num ss-leg-alive">{leg.alive === null ? '' : `${leg.alive} alive`}</span>
            </li>
          ))}
        </ol>
        <p className="ss-line">
          {status.complete
            ? status.unwon
              ? `No ticket picked all four. The pool of ${money(status.poolCents)} stays with ${event.clubName}.`
              : `${status.winners.length} winning ${status.winners.length === 1 ? 'ticket' : 'tickets'}: ${status.winners.map((w) => w.holder).join(', ')}. Each collects ${money(status.dividendCents)}.`
            : status.legsRun > 0
              ? status.alive.length === 0
                ? `Nobody is still alive. The pool stays with ${event.clubName}.`
                : `${status.alive.length} ${status.alive.length === 1 ? 'ticket is' : 'tickets are'} still alive: ${status.alive
                    .slice(0, 8)
                    .map((a) => `${a.holder} (needs ${a.picks[nextLeg?.index ?? 3]})`)
                    .join(', ')}${status.alive.length > 8 ? ' and more' : ''}.`
              : `Entries close when race ${event.quaddie.legs[0]} goes to the gate.`}
        </p>
      </div>
    </section>
  );
}

/* ── Thank you ─────────────────────────────────────────────────────────── */

/** Everything the night raised that the ledgers in state know about. */
export function nightTotal(event: EventState, nightCents: number): number {
  const proceeds = toteProceeds(event.history);
  const quaddie = quaddieStatus(event.quaddie, event.quaddieEntries, event.history, event.card);
  return nightCents + proceeds.toteCents + proceeds.auctionCents + (quaddie.entries ? quaddie.retainedCents + quaddie.breakageCents + (quaddie.unwon ? quaddie.returnedCents : 0) : 0);
}

function Finale({ event, nightCents }: { event: EventState; nightCents: number }) {
  const winners = event.history
    .filter((h) => !h.void && h.results.length)
    .slice()
    .sort((a, b) => a.raceNo - b.raceNo)
    .map((h) => {
      const w = h.results.find((r) => r.place === 1);
      if (!w) return null;
      const snailNo = snailOfLane(h, w.lane);
      return {
        raceNo: h.raceNo,
        title: raceTitle(h.raceType, h.raceNo),
        lane: w.lane,
        name: w.name,
        snailNo,
        owner: h.owners?.[w.lane] ?? event.card.owners[snailNo - 1] ?? '',
        track: h.trackShape ? designNameOf(h.trackShape, h.courseId) : '',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const total = nightTotal(event, nightCents);
  const quaddie = quaddieStatus(event.quaddie, event.quaddieEntries, event.history, event.card);
  const cols = winners.length <= 4 ? Math.max(1, winners.length) : winners.length <= 8 ? 4 : winners.length <= 10 ? 5 : 6;
  const sponsors = [...new Set(event.sponsors.map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  return (
    <section className="ss-body ss-finale">
      <div className="ss-finale-head">
        <h2 className="ss-headline">Thank you for racing</h2>
        {total > 0 ? (
          <p className="ss-raised">
            <span className="ss-kicker">Raised tonight</span>

            <span className="ss-raised-amount num">{moneyShort(total)}</span>
          </p>
        ) : null}
      </div>
      {winners.length ? (
        <ol className={`ss-winners ss-cols-${cols}`} aria-label="Tonight's winners">
          {winners.map((w) => (
            <li key={w.raceNo} className="ss-winner" style={{ '--shell': laneColour(w.lane).shell } as React.CSSProperties}>
              <span className="ss-winner-race">{w.title}</span>
              <Art lane={w.lane} className="ss-winner-art" />
              <span className={`ss-winner-name ${lengthClass(w.name)}`}>{w.name}</span>

              <span className="ss-winner-owner">
                {w.name === `Snail ${w.snailNo}` ? w.owner : `No. ${w.snailNo}${w.owner ? ` · ${w.owner}` : ''}`}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="ss-finale-foot">
        {quaddie.live && quaddie.complete ? (
          <p className="ss-line">
            Quaddie: {quaddie.unwon ? `no winner, ${money(quaddie.poolCents)} to the club` : `${quaddie.winners.map((w) => w.holder).join(', ')} collected ${money(quaddie.dividendCents)} each`}
          </p>
        ) : null}
        {sponsors.length ? <p className="ss-line ss-dim">With thanks to tonight&apos;s sponsors: {sponsors.join(' · ')}</p> : null}
      </div>
    </section>
  );
}

/* ── Holding ───────────────────────────────────────────────────────────── */

function Holding({ event }: { event: EventState }) {
  return (
    <div className="ss-hold">
      <ClubBrand className="ss-hold-brand" imageClassName="ss-hold-crest" showName={false} />
      <h2>Back shortly</h2>
      <p>{event.eventName}</p>
    </div>
  );
}
