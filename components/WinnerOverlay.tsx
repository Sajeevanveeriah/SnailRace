'use client';

import { useEffect, useRef } from 'react';
import { Snail } from './Snail';
import { laneColour } from '@/lib/palette';
import { money } from '@/lib/money';
import { ordinal } from '@/lib/race-engine';
import type { Bet, Donation, RaceResult } from '@/lib/types';

export function WinnerOverlay({
  open,
  raceNo,
  results,
  donations,
  bets,
  onClose,
}: {
  open: boolean;
  raceNo: number;
  results: RaceResult[];
  donations: Donation[];
  bets: Bet[];
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
          <p className="mt-4 text-sm text-(--tx)/70">
            {winningBets.length} winning play {winningBets.length === 1 ? 'bet' : 'bets'} on the
            fun board, paying{' '}
            <span className="num font-semibold text-(--gold)">
              {winningBets.reduce((s, b) => s + (b.returned ?? 0), 0).toLocaleString('en-AU')}
            </span>{' '}
            chips.
          </p>
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

        <button ref={closeRef} type="button" className="btn btn-ghost mt-7" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
