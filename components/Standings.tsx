'use client';

import { useMemo } from 'react';
import { standingsFrom, POINTS } from '@/lib/standings';
import type { RaceHistoryEntry } from '@/lib/types';

/**
 * The night's championship table.
 *
 * Hidden until two races have run, because a table after one race is just the
 * result of that race with extra columns.
 */
export function Standings({ history }: { history: RaceHistoryEntry[] }) {
  const rows = useMemo(() => standingsFrom(history).slice(0, 8), [history]);
  /* Voided races are compensating entries and score nothing. */
  const counted = useMemo(() => history.filter((h) => !h.void).length, [history]);

  if (counted < 2 || rows.length === 0) return null;

  const top = rows[0].points || 1;

  return (
    <section className="glass p-4" aria-label="Championship standings">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Championship</h2>
        <span className="num text-[10px] text-(--tx)/40">
          {history.length} races, {POINTS.join('/')} points
        </span>
      </div>

      <ol className="flex flex-col gap-1">
        {rows.map((row, i) => (
          <li key={row.name} className="st-row">
            <span className="num st-pos">{i + 1}</span>
            <span className="st-name">{row.name}</span>
            {/* The bar is the ranking, read at a glance from the back of a hall. */}
            <span className="st-bar" aria-hidden="true">
              <i style={{ width: `${Math.max(4, (row.points / top) * 100)}%` }} />
            </span>
            <span className="num st-pts">{row.points}</span>
          </li>
        ))}
      </ol>

      <p className="sr-only">
        {rows
          .map(
            (r, i) =>
              `${i + 1}. ${r.name}, ${r.points} points from ${r.races} races, ${r.wins} wins.`,
          )
          .join(' ')}
      </p>
    </section>
  );
}
