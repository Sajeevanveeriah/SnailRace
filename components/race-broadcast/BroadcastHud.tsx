'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { laneColour } from '@/lib/palette';
import { runnerArtForLane, runnerHueRotation } from '@/lib/presentation/runner-art';
import type { BoardRow, RaceController } from '@/lib/use-race';
import { finalGapText, lapsDownText, snailNumber } from './standings-format';

interface BroadcastHudProps {
  brand: ReactNode;
  race: RaceController;
  names: string[];
  numberOffset?: number;
  /** Snail number per lane, when the field is not a run of numbers. */
  numbers?: readonly number[];
  raceNo: number;
  courseName: string;
  replay: boolean;
  laps: number;
  /** Laps down per lane, for runners the leader has lapped. */
  lapped: ReadonlyMap<number, number>;
  clockRef: RefObject<HTMLSpanElement | null>;
  lapRef: RefObject<HTMLSpanElement | null>;
  lapLabelRef: RefObject<HTMLSpanElement | null>;
  lapBoxRef: RefObject<HTMLSpanElement | null>;
  shotRef: RefObject<HTMLSpanElement | null>;
  lapWipeRef: RefObject<HTMLDivElement | null>;
}

/** No badge before the off: the room is told it is live when it is. */
const phaseLabel = (phase: string, replay: boolean): string | null => {
  if (replay) return 'REPLAY';
  if (phase === 'confirming') return 'FINISH';
  if (phase === 'done') return 'OFFICIAL';
  if (phase === 'void') return 'VOID';
  if (phase === 'running') return 'LIVE';
  return null;
};

/**
 * Shrink a line until it fits on one row. Steps down to `min` of its size,
 * then lets it wrap rather than cut it off.
 */
function useFitLine(ref: RefObject<HTMLElement | null>, text: string, min = 0.62) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let scale = 1;
      el.style.setProperty('--fit', '1');
      el.dataset.wrap = 'false';
      while (el.scrollWidth > el.clientWidth + 1 && scale > min) {
        scale = Math.max(min, scale - 0.06);
        el.style.setProperty('--fit', scale.toFixed(2));
      }
      if (el.scrollWidth > el.clientWidth + 1) el.dataset.wrap = 'true';
    };
    fit();
    /* The room it has changes when badges come and go beside it: refit on width only. */
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text, min]);
}

export function BroadcastHud({
  brand,
  race,
  names,
  numberOffset = 0,
  numbers,
  raceNo,
  courseName,
  replay,
  laps,
  lapped,
  clockRef,
  lapRef,
  lapLabelRef,
  lapBoxRef,
  shotRef,
  lapWipeRef,
}: BroadcastHudProps) {
  const phase = race.phase as string;
  const confirming = phase === 'confirming';
  const label = phaseLabel(phase, replay);
  const announcement =
    confirming || phase === 'done' || phase === 'void' ? race.status : race.commentary || race.status;
  const strapRef = useRef<HTMLParagraphElement>(null);
  useFitLine(strapRef, announcement);
  const titleRef = useRef<HTMLSpanElement>(null);
  useFitLine(titleRef, courseName, 0.6);

  return (
    <section className="race-hud" aria-label={`Race ${raceNo} status`}>
      <div className="tv-top">
        {brand}
        {label ? (
          <span className={`tv-live ${phase === 'void' ? 'tv-void' : ''} ${replay ? 'tv-replay' : ''} ${confirming ? 'tv-confirming-badge' : ''}`}>
            <i aria-hidden="true" /> {label}
          </span>
        ) : null}
        <span className="tv-race-chip num">RACE {raceNo}</span>
        <span ref={titleRef} className="tv-title">
          {courseName.toUpperCase()}
        </span>
        <span ref={lapBoxRef} className="tv-lap num" data-laps={laps} hidden={laps < 2}>
          <span ref={lapLabelRef} className="tv-lap-label">
            LAP
          </span>
          <span ref={lapRef} className="tv-lap-value">
            1/{laps}
          </span>
        </span>
        {replay ? null : (
          <span ref={clockRef} className="tv-clock num" role="timer" aria-label="Elapsed race time">
            0:00.0
          </span>
        )}
        {race.photoFinish && phase !== 'done' ? (
          <span className="tv-photo num" role="status">
            PHOTO FINISH
          </span>
        ) : null}
        <span ref={shotRef} className="tv-shot num" aria-hidden="true" />
        <div ref={lapWipeRef} className="circuit-lap-wipe" aria-hidden="true">
          <b />
        </div>
      </div>

      <div className="tv-strap">
        <span className="tv-strap-badge" aria-hidden="true">
          {confirming || phase === 'done' ? 'RESULT' : 'COMMENTARY'}
        </span>
        <p ref={strapRef} className="tv-strap-line" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>

      <RunnerTower race={race} names={names} numberOffset={numberOffset} numbers={numbers} laps={laps} lapped={lapped} raceNo={raceNo} />
    </section>
  );
}

interface TowerRow {
  lane: number;
  place: number;
  gap: string;
}

/**
 * One panel on the right of the course. At the gate it is the field board:
 * every runner's number, colour and name, big enough to find your snail from
 * the back of the room. At the off it narrows into the timing tower: the top
 * five large, the rest compact, lapped runners dimmed. After the line it
 * holds the final classification, 1 to N with gaps.
 */
function RunnerTower({
  race,
  names,
  numberOffset,
  numbers,
  laps,
  lapped,
  raceNo,
}: {
  race: RaceController;
  names: string[];
  numberOffset: number;
  numbers?: readonly number[];
  laps: number;
  lapped: ReadonlyMap<number, number>;
  raceNo: number;
}) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const { onBoard } = race;
  useEffect(() => onBoard(setRows), [onBoard]);
  const listRef = useRef<HTMLOListElement>(null);

  const phase = race.phase as string;
  const gate = phase === 'idle' || phase === 'countdown';
  const final = phase === 'done' || phase === 'confirming';
  let shown: TowerRow[];
  if (gate) shown = names.map((_, lane) => ({ lane, place: lane + 1, gap: '' }));
  else if (final && race.results.length) {
    const winner = race.results[0];
    shown = race.results.map((result) => ({ lane: result.lane, place: result.place, gap: finalGapText(result, winner, laps) }));
  } else if (rows.length) {
    shown = rows.map((row) => {
      const down = lapped.get(row.lane) ?? 0;
      return { lane: row.lane, place: row.place, gap: down > 0 && row.gapText !== 'RET' ? lapsDownText(down) : row.gapText === 'leader' ? '' : row.gapText };
    });
  } else shown = names.map((_, lane) => ({ lane, place: lane + 1, gap: '' }));

  const signature = shown.map((r) => `${r.lane}:${r.gap.length}`).join(',');
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let fit = 1;
    el.style.setProperty('--fit', '1');
    while (el.scrollHeight > el.clientHeight + 1 && fit > 0.7) {
      fit -= 0.05;
      el.style.setProperty('--fit', fit.toFixed(2));
    }
  }, [signature, gate]);

  return (
    <aside
      className={`race-standings circuit-tower ${gate ? 'is-gate' : 'is-racing'} ${final ? 'is-final' : ''}`}
      aria-label={gate ? `Race ${raceNo} field, ${names.length} runners` : `Running order for ${shown.length} runners`}
      data-count={names.length}
    >
      <h3>
        {gate ? (
          <>
            THE FIELD <span>RACE {raceNo} · {names.length} RUNNERS</span>
          </>
        ) : final ? (
          <>
            RESULT <span>{shown.length} RUNNERS</span>
          </>
        ) : (
          <>
            STANDINGS <span>{shown.length} RUNNERS</span>
          </>
        )}
      </h3>
      <ol ref={listRef} className="tv-order" aria-live="off" aria-label={gate ? 'Runners' : 'Runner positions'}>
        {shown.map((row) => {
          const colour = laneColour(row.lane);
          const no = snailNumber(row.lane, numberOffset, numbers);
          const name = names[row.lane] ?? `Snail ${no}`;
          const top = gate || row.place <= 5;
          const down = !gate && !final ? (lapped.get(row.lane) ?? 0) : 0;
          return (
            <li
              key={row.lane}
              className={`tv-order-row ${top ? 'is-top' : 'is-compact'} ${down > 0 ? 'is-lapped' : ''}`}
              data-place={row.place}
              style={{ '--shell': colour.shell, '--shell-dk': colour.dark, '--len': name.length } as CSSProperties}
            >
              {gate ? null : <span className="tv-order-pos num">{row.place}</span>}
              <span className="tv-order-dot num" style={{ background: colour.dark }} aria-label={`Snail ${no}`}>
                {no}
              </span>
              {gate ? (
                <span
                  className="tv-order-art"
                  style={{ backgroundImage: `url(${runnerArtForLane(row.lane).src})`, filter: `hue-rotate(${runnerHueRotation(row.lane)}deg)` }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="tv-order-name">{name}</span>
              {gate ? null : <span className="tv-order-gap num">{row.gap}</span>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
