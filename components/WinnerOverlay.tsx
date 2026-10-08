'use client';

import { useEffect, useRef } from 'react';
import { Snail } from './Snail';
import { laneColour } from '@/lib/palette';
import { money } from '@/lib/money';
import { ordinal } from '@/lib/race-engine';
import type { AuctionSettlement, RaceHighlight, RaceResult, ToteDividend } from '@/lib/types';

export function WinnerOverlay({
  open,
  audienceOnly = false,
  raceNo,
  results,
  owners = [],
  highlights,
  nextRaceNo,
  sponsor,
  lastRace = false,
  tote,
  auction,
  onClose,
}: {
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
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || audienceOnly) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, audienceOnly]);

  if (!open || results.length === 0) return null;

  const winner = results[0];
  const c = laneColour(winner.lane);
  const owner = owners[winner.lane]?.trim() ?? '';
  const snailNo = (raceNo - 1) * 10 + winner.lane + 1;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      {!audienceOnly ? <button
        type="button"
        className="overlay-scrim"
        aria-label="Close winner announcement"
        onClick={onClose}
      /> : <div className="overlay-scrim" />}
      <div
        role={audienceOnly ? "region" : "dialog"}
        aria-modal={audienceOnly ? undefined : true}
        aria-labelledby="winner-name"
        className="winner-card glass glass-strong relative w-full max-w-lg p-9 text-center"
        style={
          {
            '--shell': c.shell,
            '--shell-dk': c.dark,
            '--body': c.body,
            '--glow': c.glow,
          } as React.CSSProperties
        }
      >
        <div className="winner-glow" aria-hidden="true" />

        <p className="eyebrow">Race {raceNo} winner</p>
        {sponsor ? (
          <p className="sponsor-line mt-1">
            Sponsored by <b>{sponsor}</b>
          </p>
        ) : null}

        <div className="mx-auto my-4 w-40">
          <Snail />
        </div>

        <h2 id="winner-name" className="display text-5xl sm:text-6xl">
          {winner.name}
        </h2>

        <p className="num mt-3 text-lg font-semibold text-(--gold)">
          Snail {snailNo}{owner ? ` · owned by ${owner}` : ''}
        </p>

        {tote ? (
          <div className="tote-result mt-4" role="note" aria-label="Cash tote dividend">
            <p className="tote-result-label">CLUB CASH TOTE</p>
            {tote.unbacked ? (
              <p className="tote-result-pay">No winning tickets - pool {money(tote.poolCents)} to the club</p>
            ) : (
              <p className="tote-result-pay">
                Pays <b className="num">{money(tote.dividendCents)}</b> per {money(tote.ticketCents)} ticket
              </p>
            )}
            <p className="tote-result-detail num">
              {tote.winningTickets} winning {tote.winningTickets === 1 ? 'ticket' : 'tickets'} · pool {money(tote.poolCents)} ·{' '}
              {tote.retainedPercent}% to the club
            </p>
            {auction ? (
              <p className="tote-result-detail">
                {auction.winningOwner
                  ? `Auction: ${auction.winningOwner.bidder} owned the winner and collects ${money(auction.prizeCents)}`
                  : `Auction: the winner was unowned; pool ${money(auction.poolCents)} to the club`}
              </p>
            ) : null}
          </div>
        ) : null}

        <ol className="mt-6 grid gap-1.5 text-left">
          {results.slice(0, 4).map((r) => (
            <li
              key={r.lane}
              className="flex items-center gap-3 rounded-xl bg-(--tx)/5 px-3 py-2 text-sm"
            >
              <span className="num w-8 shrink-0 font-bold text-(--tx)/60">{ordinal(r.place)}</span>
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: laneColour(r.lane).shell }}
                aria-hidden="true"
              />
              <span className="truncate font-medium">{r.name}</span>
              <span className="num ml-auto text-(--tx)/45">
                {r.finishMs !== null
                  ? `${(r.finishMs / 1000).toFixed(2)}s`
                  : r.status === 'retired'
                    ? 'RET'
                    : `${Math.round((r.progressAtStop ?? 0) * 100)}% at line`}
              </span>
            </li>
          ))}
        </ol>

        {highlights.length > 0 ? (
          <div className="mt-6 text-left">
            <p className="eyebrow mb-2">What happened out there</p>
            {/* A marathon deals a dozen surprises; the card scrolls rather than grows. */}
            <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
              {highlights.map((h, i) => (
                <li
                  key={`${h.atMs}-${h.lane}-${i}`}
                  className="flex items-center gap-2.5 rounded-lg bg-(--tx)/5 px-3 py-1.5 text-xs"
                >
                  <span className="num w-11 shrink-0 text-(--tx)/40">
                    {(h.atMs / 1000).toFixed(1)}s
                  </span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: laneColour(h.lane).shell }}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium">{h.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-bold tracking-[0.16em] text-(--tx)/55">
                    {h.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-6 text-sm font-medium text-(--tx)/70">
          {lastRace
            ? 'That was the last race on the card. Thank you for racing with us.'
            : `Race ${nextRaceNo} is next: snails ${(nextRaceNo - 1) * 10 + 1} to ${nextRaceNo * 10}.`}
        </p>

        {!audienceOnly ? <button ref={closeRef} type="button" className="btn btn-ghost mt-4" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button> : null}
      </div>
    </div>
  );
}
