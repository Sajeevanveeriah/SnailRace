'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { laneColour } from '@/lib/palette';
import type { BoardRow, RaceController } from '@/lib/use-race';

interface BroadcastHudProps {
  brand: ReactNode;
  race: RaceController;
  names: string[];
  raceNo: number;
  courseName: string;
  replay: boolean;
  confirming: boolean;
  running: boolean;
  clockRef: RefObject<HTMLSpanElement | null>;
  lapRef: RefObject<HTMLSpanElement | null>;
  shotRef: RefObject<HTMLSpanElement | null>;
}

const phaseLabel = (phase: string, replay: boolean): string => {
  if (replay) return 'REPLAY';
  if (phase === 'confirming') return 'FINISH';
  if (phase === 'done') return 'OFFICIAL';
  if (phase === 'void') return 'VOID';
  if (phase === 'idle') return 'READY';
  return 'LIVE';
};

export function BroadcastHud({
  brand,
  race,
  names,
  raceNo,
  courseName,
  replay,
  confirming,
  running,
  clockRef,
  lapRef,
  shotRef,
}: BroadcastHudProps) {
  const phase = race.phase as string;
  const label = phaseLabel(phase, replay);
  const announcement = confirming || phase === 'done' || phase === 'void'
    ? race.status
    : race.commentary || race.status;

  return (
    <section className="race-hud" aria-label={`Race ${raceNo} status`}>
      <div className="tv-top">
        {brand}
        <span
          className={`tv-live ${phase === 'void' ? 'tv-void' : ''} ${replay ? 'tv-replay' : ''} ${confirming ? 'tv-confirming-badge' : ''}`}
        >
          <i aria-hidden="true" /> {label}
        </span>
        <span className="tv-race-chip num">RACE {raceNo}</span>
        <span className="tv-title">{courseName.toUpperCase()}</span>
        <span ref={lapRef} className="tv-lap num" />
        {replay ? null : (
          <span ref={clockRef} className="tv-clock num" role="timer" aria-label="Elapsed race time">
            0:00.0
          </span>
        )}
        <span ref={shotRef} className="tv-shot num" aria-hidden="true" />
      </div>

      <RunningOrder race={race} names={names} open={running || phase === 'done'} />

      <div className="tv-strap">
        <span className="tv-strap-badge" aria-hidden="true">
          {confirming || phase === 'done' ? 'RESULT' : 'COMMENTARY'}
        </span>
        <p className="tv-strap-line" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>

      {confirming ? (
        <div className="race-finish-confirmation" aria-hidden="true">
          <span>FINISH</span>
          <b>{race.status}</b>
        </div>
      ) : null}
    </section>
  );
}

function RunningOrder({
  race,
  names,
  open,
}: {
  race: RaceController;
  names: string[];
  open: boolean;
}) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const { onBoard } = race;

  useEffect(() => onBoard(setRows), [onBoard]);

  const shown = (race.phase as string) === 'idle' ? [] : rows;
  if (!open || !shown.length) return null;

  return (
    <aside className={`race-standings ${shown.length > 8 ? 'race-standings-dense' : ''}`} aria-label={`Running order for ${shown.length} runners`}>
      <h3>STANDINGS <span>{shown.length} RUNNERS</span></h3>
      <ol className="tv-order" aria-live="off">
        {shown.map((row) => (
          <li key={row.lane} className="tv-order-row">
            <span className="tv-order-pos num">{row.place}</span>
            <i className="tv-order-dot" style={{ background: laneColour(row.lane).shell }} aria-hidden="true" />
            <span className="tv-order-name">{names[row.lane] ?? `Lane ${row.lane + 1}`}</span>
            <span className="tv-order-gap num">{row.gapText}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
