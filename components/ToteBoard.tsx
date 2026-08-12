'use client';

import { laneColour } from '@/lib/palette';
import { money, moneyShort } from '@/lib/money';
import type { LanePool } from '@/lib/tote';

/**
 * The tote board.
 *
 * The prices here are parimutuel - they come from what the room has backed,
 * exactly as a real tote works. They are not a prediction and never could be:
 * the draw is a uniform shuffle, so every snail is a 1-in-N chance whatever
 * the board says. The footnote states that in the room rather than burying it
 * in a README.
 */
export function ToteBoard({
  lanes,
  potCents,
  fieldSize,
  raceNo,
  showOdds,
}: {
  lanes: LanePool[];
  potCents: number;
  fieldSize: number;
  raceNo: number;
  showOdds: boolean;
}) {
  const leader = Math.max(1, ...lanes.map((l) => l.cents));
  const ranked = lanes.slice().sort((a, b) => b.cents - a.cents || a.lane - b.lane);

  return (
    <aside className="glass glass-strong p-5 sm:p-6 flex flex-col gap-4" aria-label="Tote board">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Race {raceNo} tote</h2>
        <span className="num money-ink text-2xl font-bold">{moneyShort(potCents)}</span>
      </div>

      <ol className="flex flex-col gap-2.5">
        {ranked.map((lane, i) => {
          const c = laneColour(lane.lane);
          return (
            <li
              key={lane.lane}
              className="pop-in grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1"
              style={
                {
                  '--shell': c.shell,
                  '--shell-dk': c.dark,
                  '--glow': c.glow,
                  '--d': `${i * 45}ms`,
                } as React.CSSProperties
              }
            >
              <span className="lane-badge num text-xs">{lane.lane + 1}</span>

              <div className="min-w-0">
                <p className="truncate font-semibold leading-tight">{lane.name}</p>
                <p className="text-[11px] text-(--tx)/50">
                  {lane.backers === 0
                    ? 'no backers yet'
                    : `${lane.backers} ${lane.backers === 1 ? 'backer' : 'backers'}`}
                </p>
              </div>

              <div className="text-right">
                <p className="num font-semibold leading-tight">{money(lane.cents)}</p>
                {showOdds ? (
                  <p key={lane.odds} className="odds-flip num text-[11px] text-(--gold)">
                    {lane.odds.toFixed(2)} for 1
                  </p>
                ) : null}
              </div>

              <span
                className="tote-bar col-span-3 h-1.5 rounded-full bg-(--tx)/8 overflow-hidden"
                aria-hidden="true"
              >
                <i style={{ '--w': (lane.cents / leader) * 100 } as React.CSSProperties} />
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-[11px] leading-snug text-(--tx)/45">
        Every snail has the same 1-in-{fieldSize} chance. Prices show what the room has backed, not
        form, and donations never influence the result.
      </p>
    </aside>
  );
}
