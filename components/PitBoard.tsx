'use client';

import { useEffect, useRef } from 'react';
import { laneColour } from '@/lib/palette';
import { ordinal } from '@/lib/race-engine';
import type { RaceController } from '@/lib/use-race';

/**
 * The running order, with gaps.
 *
 * A five-minute race needs something to read between the big moments, and
 * "second, but only half a length down" is the thing a punter with money on
 * second actually wants to know. This is the broadcast timing tower.
 *
 * It is driven straight from the paint loop rather than through React, for
 * the same reason the track is: twenty rows re-rendered sixty times a second
 * would be the most expensive thing on the stage, for numbers that change by
 * a hundredth each frame.
 */
export function PitBoard({
  names,
  race,
  laps,
}: {
  names: string[];
  race: RaceController;
  laps: number;
}) {
  const rootRef = useRef<HTMLOListElement | null>(null);
  const rowsRef = useRef<Map<number, { li: HTMLLIElement; pos: HTMLElement; gap: HTMLElement }>>(
    new Map(),
  );

  /*
   * The board reorders itself, and moving DOM nodes every frame would fight
   * the browser's own layout. Instead every row keeps its place in the list
   * and is moved with a transform, which stays on the compositor.
   */
  useEffect(() => {
    const unsubscribe = race.onBoard((rows) => {
      const rowHeight = 26;
      rows.forEach((r, i) => {
        const row = rowsRef.current.get(r.lane);
        if (!row) return;
        row.li.style.transform = `translateY(${(i - r.lane) * rowHeight}px)`;
        row.li.style.zIndex = String(100 - i);
        const pos = ordinal(i + 1);
        if (row.pos.textContent !== pos) row.pos.textContent = pos;
        const gap = r.gapText;
        if (row.gap.textContent !== gap) row.gap.textContent = gap;
      });
    });
    return unsubscribe;
  }, [race]);

  const rowRef = (lane: number) => (li: HTMLLIElement | null) => {
    if (!li) {
      rowsRef.current.delete(lane);
      return;
    }
    const pos = li.querySelector('.pb-pos') as HTMLElement;
    const gap = li.querySelector('.pb-gap') as HTMLElement;
    if (pos && gap) rowsRef.current.set(lane, { li, pos, gap });
  };

  return (
    <section className="glass pit-board p-4" aria-label="Running order">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="eyebrow">Running order</h2>
        {laps > 1 ? <span className="text-[10px] text-(--tx)/40">{laps} laps</span> : null}
      </div>
      <ol ref={rootRef} className="pb-list">
        {names.map((name, lane) => {
          const c = laneColour(lane);
          return (
            <li key={`${lane}-${name}`} ref={rowRef(lane)} className="pb-row">
              <span className="pb-pos num" />
              <span className="pb-dot" style={{ background: c.shell }} aria-hidden="true" />
              <span className="pb-name">{name}</span>
              <span className="pb-gap num" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
