'use client';

import { useMemo } from 'react';
import { laneColour } from '@/lib/palette';
import { standingsFrom } from '@/lib/standings';
import { ordinal } from '@/lib/race-engine';
import { money } from '@/lib/money';
import type { LanePool } from '@/lib/tote';
import type { RaceHistoryEntry } from '@/lib/types';

/**
 * The racecard: a proper pre-race form guide.
 *
 * Three kinds of information, kept honest and visibly separate:
 *   - FACT: championship points and tonight's finishes, derived from the
 *     recorded race history;
 *   - CROWD: backing and fun-chip odds, derived from the room;
 *   - FLAVOUR: one harmless line of colour, deterministic per name, labelled
 *     as fun. No invented sporting history, ever.
 *
 * Prints through the browser: the print stylesheet flattens it to a clean
 * black-on-white card.
 */

/** Original flavour lines. Cosmetic, harmless, never factual. */
const FLAVOUR = [
  'Trains on the good lettuce.',
  'Prefers the inside of the lane. Any lane.',
  'Has never once looked at the scoreboard.',
  'Peaks exactly once a night, timing unknown.',
  'Runs best with the crowd behind it, or in front of it.',
  'A big-race temperament, allegedly.',
  'Keeps the shell polished for the photos.',
  'Unbeatable over the first centimetre.',
  'Comes alive when the sprinklers do.',
  'Quietly confident. Always quietly.',
  'The barn favourite, according to the barn.',
  'Saves something for the run home. Sometimes too much.',
  'Watches the magpie. The magpie watches back.',
  'Slept well, reportedly.',
  'A professional about the lettuce breaks.',
  'New wax on the shell tonight.',
] as const;

const flavourOf = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FLAVOUR[h % FLAVOUR.length];
};

export function Racecard({
  names,
  history,
  lanes,
  raceNo,
  sponsor,
  compact = false,
}: {
  names: string[];
  history: RaceHistoryEntry[];
  lanes: LanePool[];
  raceNo: number;
  sponsor?: string;
  /** Projector mode trims the flavour column below twelve-lane fields. */
  compact?: boolean;
}) {
  const standings = useMemo(() => standingsFrom(history), [history]);

  /** Tonight's finishing places per runner name, oldest race first. */
  const formOf = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const h of history.slice().reverse()) {
      if (h.void) continue;
      for (const r of h.results) {
        const list = map.get(r.name) ?? [];
        list.push(r.place);
        map.set(r.name, list);
      }
    }
    return map;
  }, [history]);

  return (
    <div className="racecard">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">
          Race {raceNo} field
          {sponsor ? <span className="ml-2 text-sm font-medium text-(--gold)">sponsored by {sponsor}</span> : null}
        </h3>
        <span className="fun-chip-tag">odds settle fun chips - no monetary value</span>
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.14em] text-(--tx)/45">
            <th className="pb-2 pr-2">No.</th>
            <th className="pb-2 pr-2">Runner</th>
            <th className="pb-2 pr-2">Tonight</th>
            <th className="pb-2 pr-2 text-right">Points</th>
            <th className="pb-2 pr-2 text-right">Backed</th>
            <th className="pb-2 text-right">Chips odds</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name, i) => {
            const c = laneColour(i);
            const standing = standings.find((s) => s.name === name);
            const form = formOf.get(name) ?? [];
            const pool = lanes[i];
            return (
              <tr key={i} className="border-t border-(--tx)/8 align-top">
                <td className="py-2 pr-2">
                  <span className="lane-badge num text-xs" style={{ '--shell': c.shell, '--shell-dk': c.dark } as React.CSSProperties}>
                    {i + 1}
                  </span>
                </td>
                <td className="py-2 pr-2">
                  <p className="font-semibold leading-tight">{name}</p>
                  {!compact ? (
                    <p className="text-[11px] leading-snug text-(--tx)/45" aria-label="For fun">
                      {flavourOf(name)}
                    </p>
                  ) : null}
                </td>
                <td className="num py-2 pr-2 text-(--tx)/70">
                  {form.length ? form.map((p) => ordinal(p)).join(', ') : 'first start'}
                </td>
                <td className="num py-2 pr-2 text-right">{standing?.points ?? 0}</td>
                <td className="num py-2 pr-2 text-right">
                  {pool && pool.cents > 0 ? money(pool.cents) : '-'}
                </td>
                <td className="num py-2 text-right text-(--gold)">
                  {(pool?.odds ?? names.length).toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 text-[11px] leading-snug text-(--tx)/45">
        Tonight and Points are real results from this event. Backed shows donations, which never
        influence any race. The runner lines are for fun. Every snail wins with the same
        1-in-{names.length} chance.
      </p>
    </div>
  );
}
