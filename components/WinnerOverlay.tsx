'use client';

import { useEffect, useRef } from 'react';
import { Snail } from './Snail';
import { laneColour } from '@/lib/palette';
import { money } from '@/lib/money';
import { ordinal } from '@/lib/race-engine';
import type { Bet, Donation, RaceHighlight, RaceResult } from '@/lib/types';

export function WinnerOverlay({
  open,
  raceNo,
  results,
  donations,
  bets,
  highlights,
  nextRaceNo,
  sponsor,
  onClose,
}: {
  open: boolean;
  raceNo: number;
  results: RaceResult[];
  donations: Donation[];
  bets: Bet[];
  highlights: RaceHighlight[];
  nextRaceNo: number;
  sponsor: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || results.length === 0) return null;

  const winner = results[0];
  const c = laneColour(winner.lane);
  const backers = donations.filter(
    (d) => !d.void && d.raceNo === raceNo && d.lane === winner.lane,
  );
  const raised = backers.reduce((sum, d) => sum + d.cents, 0);
  const winningBets = bets.filter((b) => b.raceNo === raceNo && b.lane === winner.lane);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <button
        type="button"
        className="overlay-scrim"
        aria-label="Close winner announcement"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
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

        <p
          className={`num mt-3 text-lg font-semibold ${
            raised > 0 ? 'text-(--money-b)' : 'text-(--tx)/45'
          }`}
        >
          {raised > 0
            ? `${money(raised)} backed this snail`
            : 'Nobody backed this one tonight'}
        </p>

        {backers.length > 0 ? (
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {backers.slice(0, 12).map((b) => (
              <li
                key={b.id}
                className="rounded-full bg-(--tx)/10 px-3 py-1 text-xs font-medium text-(--tx)/85"
              >
                {b.backerName || 'Anonymous'} {money(b.cents)}
              </li>
            ))}
          </ul>
        ) : null}

        {winningBets.length > 0 ? (
          <div className="mt-4">
            <p className="fun-chip-banner mx-auto w-fit" role="note">
              FUN CHIPS - NO MONETARY VALUE
            </p>
            <p className="mt-2 text-sm text-(--tx)/70">
              {winningBets.length} winning play {winningBets.length === 1 ? 'bet' : 'bets'} on the
              fun board, paying{' '}
              <span className="num font-semibold text-(--gold)">
                {winningBets.reduce((s, b) => s + (b.returned ?? 0), 0).toLocaleString('en-AU')}
              </span>{' '}
              chips at the odds locked before the start.
            </p>
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
                {(r.finishMs / 1000).toFixed(2)}s
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
          Betting is open for race {nextRaceNo}. Scan the code and back one.
        </p>

        <button ref={closeRef} type="button" className="btn btn-ghost mt-4" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
