'use client';

import { laneColour } from '@/lib/palette';
import type { FunChipLane } from '@/lib/tote';

/**
 * The room's free fun-chip board.
 *
 * It never receives money or donations. Prices are the same fair fixed price
 * for every equal-chance runner; the bars show only valueless audience chips.
 */
export function ToteBoard({
  lanes,
  totalChips,
  fieldSize,
  raceNo,
  showOdds,
}: {
  lanes: FunChipLane[];
  totalChips: number;
  fieldSize: number;
  raceNo: number;
  showOdds: boolean;
}) {
  const leader = Math.max(1, ...lanes.map((lane) => lane.chips));
  const ranked = lanes.slice().sort((a, b) => b.chips - a.chips || a.lane - b.lane);

  return (
    <aside className="glass glass-strong p-5 sm:p-6 flex flex-col gap-4" aria-label="Free fun-chip picks">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Race {raceNo} fun-chip picks</h2>
        <span className="num text-2xl font-bold text-(--gold)">
          {totalChips.toLocaleString('en-AU')} chips
        </span>
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
                <p className="num font-semibold leading-tight">{lane.chips} chips</p>
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
                <i style={{ '--w': (lane.chips / leader) * 100 } as React.CSSProperties} />
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-[11px] leading-snug text-(--tx)/45">
        Every snail has the same 1-in-{fieldSize} chance and the same fixed {fieldSize.toFixed(2)}
        -for-1 play price. These are <b className="text-(--tx)/70">free fun chips with no monetary
        value</b>. Donations are recorded separately and cannot alter a price or return.
      </p>
    </aside>
  );
}
