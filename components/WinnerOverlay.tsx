'use client';

import { useEffect, useRef, useState } from 'react';
import { raceTitle, snailsForRace, type CardState } from '@/lib/card';
import { Confetti } from './Confetti';
import { SponsorReel } from './SponsorReel';
import { laneColour } from '@/lib/palette';
import { money } from '@/lib/money';
import { ordinal } from '@/lib/race-engine';
import { runnerArtForLane, runnerHueRotation } from '@/lib/presentation/runner-art';
import { snailOfLane } from '@/lib/run-sheet';
import type { AuctionSettlement, RaceHighlight, RaceHistoryEntry, RaceResult, ToteDividend } from '@/lib/types';

/** The winner moment's three steps, in order. */
type Step = 'winner' | 'result' | 'sponsors';
/** When each step starts, in ms from the reveal. */
const RESULT_AT = 7_000;
const SPONSORS_AT = 17_000;

/**
 * The winner moment, after the finish-line hold.
 *
 * Three full-screen steps that cross-fade into each other: the winner (its
 * own racecard art, name, owner, number, margin and time, with confetti),
 * then the top three large with the full order compact, then the sponsor
 * slate. The whole layer fades in opaque over the track, so no half-drawn
 * frame of the card ever shows over the race. Sized in projector units.
 */
export function WinnerOverlay(props: {
  open: boolean;
  audienceOnly?: boolean;
  raceNo: number;
  results: RaceResult[];
  /** Owner per lane of the race just run. */
  owners?: string[];
  highlights: RaceHighlight[];
  nextRaceNo: number;
  sponsor: string;
  /** The card is complete; there is no next race to point the room at. */
  lastRace?: boolean;
  /** Permit-gated cash tote settlement for this race, when the tote was live. */
  tote?: ToteDividend;
  auction?: AuctionSettlement;
  onClose: () => void;
  /** Tonight's card, which fixes the numbers in each race. */
  card: CardState;
  /** The standing record of the race just run, for its numbers, owners and times. */
  entry?: RaceHistoryEntry;
  calm?: boolean;
}) {
  if (!props.open || props.results.length === 0) return null;
  return <WinnerMoment key={props.raceNo} {...props} />;
}

function WinnerMoment({
  audienceOnly = false,
  raceNo,
  results,
  owners = [],
  nextRaceNo,
  sponsor,
  lastRace = false,
  tote,
  auction,
  onClose,
  card,
  entry,
  calm = false,
}: Parameters<typeof WinnerOverlay>[0]) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [step, setStep] = useState<Step>('winner');

  useEffect(() => {
    const a = window.setTimeout(() => setStep('result'), RESULT_AT);
    const b = window.setTimeout(() => setStep('sponsors'), SPONSORS_AT);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);

  useEffect(() => {
    if (audienceOnly) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, audienceOnly]);

  const ordered = results.slice().sort((a, b) => a.place - b.place);
  const winner = ordered[0];
  const second = ordered[1];
  const ownerOf = (lane: number) => (entry?.owners?.[lane] ?? owners[lane] ?? '').trim();
  const numberOf = (lane: number) =>
    entry ? snailOfLane(entry, lane) : (snailsForRace(raceNo, card)[lane] ?? lane + 1);
  const snailNo = numberOf(winner.lane);
  const owner = ownerOf(winner.lane);
  const colour = laneColour(winner.lane);
  const title = raceTitle(entry?.raceType, raceNo);
  const art = runnerArtForLane(winner.lane);
  const nextSnails = snailsForRace(nextRaceNo, card);
  const nextRunOff = Boolean(card.races[nextRaceNo - 1]?.field?.length);

  const time = winner.finishMs !== null ? `${(winner.finishMs / 1000).toFixed(1)} s` : '';
  /* The runner-up's crossing time when it has one; otherwise how far it had left when the winner crossed, at race pace. */
  const gap = second && winner.finishMs !== null && second.finishMs !== null
    ? (second.finishMs - winner.finishMs) / 1000
    : second?.progressAtStop !== undefined && entry?.durationMs
      ? ((1 - second.progressAtStop) * entry.durationMs) / 1000
      : null;
  const estimated = second?.finishMs === null;
  const margin = entry?.photoFinish
    ? 'Photo finish'
    : gap === null
      ? 'Clear winner'
      : gap < 0.05
        ? 'By a whisker'
        : `Won by ${estimated ? 'about ' : ''}${gap.toFixed(1)} s`;


  return (
    <div
      className={`wm ${calm ? 'wm-calm' : ''}`}
      role={audienceOnly ? 'region' : 'dialog'}
      aria-modal={audienceOnly ? undefined : true}
      aria-labelledby="winner-name"
      data-step={step}
      style={{ '--shell': colour.shell, '--shell-dk': colour.dark, '--glow': colour.glow } as React.CSSProperties}
    >
      <Confetti fire={raceNo} highlight={colour.shell} calm={calm} />

      <div className="wm-body">
      {/* Step 1: the winner. */}
      <section className={`wm-step wm-winner ${step === 'winner' ? 'on' : ''}`} aria-hidden={step !== 'winner'}>
        <div className="wm-winner-art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.src} alt="" width={art.width} height={art.height} style={{ filter: `hue-rotate(${runnerHueRotation(winner.lane)}deg)` }} />
        </div>
        <div className="wm-winner-text">
          <p className="wm-kicker">{title} winner</p>
          <h2 id="winner-name" className="wm-name">{winner.name}</h2>
          <p className="wm-owner num">
            {winner.name === `Snail ${snailNo}` ? `No. ${snailNo}` : `Snail ${snailNo}`}
            {owner ? ` · owned by ${owner}` : ''}
          </p>
          <ul className="wm-facts">
            <li>{margin}</li>
            {time ? <li className="num">Time {time}</li> : null}
          </ul>
          {sponsor ? <p className="wm-sponsor">Race sponsored by <b>{sponsor}</b></p> : null}
          {tote ? (
            <div className="wm-tote" role="note" aria-label="Cash tote dividend">
              <p className="wm-tote-label">CLUB CASH TOTE</p>
              <p>
                {tote.unbacked ? (
                  <>No winning tickets: pool {money(tote.poolCents)} to the club</>
                ) : (
                  <>Pays <b className="num">{money(tote.dividendCents)}</b> per {money(tote.ticketCents)} ticket</>
                )}
              </p>
              <p className="wm-tote-detail num">
                {tote.winningTickets} winning {tote.winningTickets === 1 ? 'ticket' : 'tickets'} · pool {money(tote.poolCents)} · {tote.retainedPercent}% to the club
              </p>
              {auction ? (
                <p className="wm-tote-detail">
                  {auction.winningOwner
                    ? `Auction: ${auction.winningOwner.bidder} owned the winner and collects ${money(auction.prizeCents)}`
                    : `Auction: the winner was unowned; pool ${money(auction.poolCents)} to the club`}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Step 2: the top three large, then everyone. */}
      <section className={`wm-step wm-result ${step === 'result' ? 'on' : ''}`} aria-hidden={step !== 'result'} aria-label={`${title} result`}>
        <h2 className="wm-result-title">{title} result</h2>
        <ol className="wm-podium">
          {ordered.slice(0, 3).map((r) => {
            const a = runnerArtForLane(r.lane);
            return (
              <li key={r.lane} className={`wm-podium-${r.place}`} style={{ '--shell': laneColour(r.lane).shell } as React.CSSProperties}>
                <span className="wm-place num">{ordinal(r.place)}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.src} alt="" width={a.width} height={a.height} style={{ filter: `hue-rotate(${runnerHueRotation(r.lane)}deg)` }} />
                <span className="wm-podium-name">{r.name}</span>
                <span className="wm-podium-owner num">
                  {r.name === `Snail ${numberOf(r.lane)}` ? `No. ${numberOf(r.lane)}` : `Snail ${numberOf(r.lane)}`}
                  {ownerOf(r.lane) ? ` · ${ownerOf(r.lane)}` : ''}
                </span>
              </li>
            );
          })}
        </ol>
        {ordered.length > 3 ? (
          <ol className="wm-order" start={4}>
            {ordered.slice(3).map((r) => (
              <li key={r.lane}>
                <span className="num wm-order-place">{r.status === 'retired' ? 'Ret' : ordinal(r.place)}</span>
                <span className="wm-order-dot" style={{ background: laneColour(r.lane).shell }} aria-hidden="true" />
                <span className="wm-order-name">{r.name}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="wm-next">
          {lastRace
            ? 'That was the last race on the card.'
            : nextRunOff
              ? `Next: ${raceTitle(card.races[nextRaceNo - 1]?.raceType, nextRaceNo)}.`
              : `Race ${nextRaceNo} is next: snails ${nextSnails[0]} to ${nextSnails[nextSnails.length - 1]}.`}
        </p>
      </section>

      {/* Step 3: the sponsors. Mounted from the start so every logo has loaded before its turn. */}
      <section className={`wm-step wm-sponsors ${step === 'sponsors' ? 'on' : ''}`} aria-hidden={step !== 'sponsors'}>
        <SponsorReel raceNo={raceNo} running={step === 'sponsors'} />
      </section>
      </div>

      {!audienceOnly ? (
        <div className="wm-controls no-print">
          <button type="button" className="btn btn-ghost" onClick={() => setStep(step === 'winner' ? 'result' : step === 'result' ? 'sponsors' : 'winner')}>
            {step === 'winner' ? 'Show the result' : step === 'result' ? 'Show the sponsors' : 'Back to the winner'}
          </button>
          <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}
