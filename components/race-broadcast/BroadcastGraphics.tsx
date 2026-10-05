'use client';

import { useEffect, useState } from 'react';
import { laneColour } from '@/lib/palette';
import { money } from '@/lib/money';
import { onAirClock, splitText } from '@/lib/broadcast-ticker';
import { runnerArtForLane, runnerHueRotation } from '@/lib/presentation/runner-art';
import { ordinal } from '@/lib/race-engine';
import type { RaceResult, ToteDividend } from '@/lib/types';
import type { RaceSplit } from '@/lib/use-race';
import type { Weather } from '@/lib/race-engine';

/**
 * The broadcast furniture around the race: a start-list slate before the
 * off, a timing split when the leader passes a mark, the official result
 * lower third at the line, a ticker, and the on-air bug with the clock.
 *
 * Every figure here is read from state the night already holds. The slate
 * quotes form from recorded results; the splits are measured off the track;
 * the ticker is built from recorded money, standings and sponsors. Nothing
 * suggests a runner's chances.
 */

const ordinalShort = (place: number) => ordinal(place);

export function StartListSlate({
  names,
  runnerSponsors = [],
  formByName,
  raceNo,
  plannedRaces,
  courseName,
  laps,
  sponsor,
}: {
  names: string[];
  runnerSponsors?: string[];
  formByName: Map<string, number[]>;
  raceNo: number;
  plannedRaces: number;
  courseName: string;
  laps: number;
  sponsor?: string;
}) {
  return (
    <section className={`tv-slate ${names.length > 12 ? 'tv-slate-dense' : ''}`} aria-label={`Race ${raceNo} start list`}>
      <header className="tv-slate-head">
        <span className="tv-slate-kicker">START LIST</span>
        <h3>
          Race {raceNo} <span>of {plannedRaces}</span>
        </h3>
        <span className="tv-slate-course">
          {courseName.toUpperCase()} · {laps} {laps === 1 ? 'LAP' : 'LAPS'} · {names.length} RUNNERS
        </span>
        {sponsor ? <span className="tv-slate-sponsor">Presented by {sponsor}</span> : null}
      </header>
      <ol className="tv-slate-grid">
        {names.map((name, lane) => {
          const colour = laneColour(lane);
          const form = formByName.get(name) ?? [];
          return (
            <li key={`${lane}-${name}`} className="tv-slate-card" style={{ '--shell': colour.shell, '--shell-dk': colour.dark } as React.CSSProperties}>
              <span className="tv-slate-number num">{lane + 1}</span>
              <span
                className="tv-slate-art"
                style={{ backgroundImage: `url(${runnerArtForLane(lane).src})`, filter: `hue-rotate(${runnerHueRotation(lane)}deg)` }}
                aria-hidden="true"
              />
              <span className="tv-slate-name">{name}</span>
              <span className="tv-slate-meta">
                {form.length ? `Tonight ${form.map(ordinalShort).join(' · ')}` : 'First start tonight'}
              </span>
              {runnerSponsors[lane]?.trim() ? <span className="tv-slate-runner-sponsor">with {runnerSponsors[lane].trim()}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The latest split, on air for a few seconds after it is measured. */
export function SplitChip({ onSplit }: { onSplit: (cb: (split: RaceSplit) => void) => () => void }) {
  const [latest, setLatest] = useState<RaceSplit | null>(null);
  useEffect(() => onSplit(setLatest), [onSplit]);
  useEffect(() => {
    if (!latest) return;
    const t = window.setTimeout(() => setLatest((current) => (current?.id === latest.id ? null : current)), 6000);
    return () => window.clearTimeout(t);
  }, [latest]);
  if (!latest) return null;
  return (
    <span className="tv-split num" role="status" aria-live="polite">
      <b>{latest.label}</b> {splitText(latest.leader, latest.chaser, latest.gapSeconds)}
    </span>
  );
}

export function OfficialResult({
  results,
  raceNo,
  sponsor,
  tote,
  replay,
  runnerSponsors = [],
}: {
  results: RaceResult[];
  raceNo: number;
  sponsor?: string;
  tote?: ToteDividend | null;
  replay: boolean;
  runnerSponsors?: string[];
}) {
  const podium = results.slice(0, 3);
  if (!podium.length) return null;
  return (
    <section className="tv-result" aria-label={`Race ${raceNo} official result`}>
      <div className="tv-result-head">
        <span className="tv-result-kicker">{replay ? 'RESULT' : 'OFFICIAL RESULT'}</span>
        <span className="tv-result-race num">RACE {raceNo}</span>
        {sponsor ? <span className="tv-result-sponsor">Presented by {sponsor}</span> : null}
      </div>
      <ol className="tv-result-podium">
        {podium.map((r) => (
          <li key={r.lane} className={`tv-result-row tv-result-${r.place}`} style={{ '--shell': laneColour(r.lane).shell } as React.CSSProperties}>
            <span className="tv-result-place num">{ordinal(r.place)}</span>
            <span className="tv-result-dot num" style={{ background: laneColour(r.lane).dark }}>
              {r.lane + 1}
            </span>
            <span className="tv-result-name">
              {r.name}
              {runnerSponsors[r.lane]?.trim() ? <small> with {runnerSponsors[r.lane].trim()}</small> : null}
            </span>
            <span className="tv-result-time num">
              {r.finishMs !== null
                ? `${(r.finishMs / 1000).toFixed(2)}s`
                : r.status === 'retired'
                  ? 'RET'
                  : `${Math.round((r.progressAtStop ?? 0) * 100)}%`}
            </span>
          </li>
        ))}
      </ol>
      {tote ? (
        <p className="tv-result-tote num">
          CLUB CASH TOTE{' '}
          {tote.unbacked ? `· no winning tickets, pool ${money(tote.poolCents)} to the club` : `· pays ${money(tote.dividendCents)} per ${money(tote.ticketCents)} ticket`}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The ticker. Scrolls as a continuous strip; under reduced motion it shows
 * one item at a time and changes it every few seconds instead.
 */
export function BroadcastTicker({ items, reduceMotion }: { items: string[]; reduceMotion: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!reduceMotion || items.length < 2) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % items.length), 4500);
    return () => window.clearInterval(t);
  }, [reduceMotion, items.length]);
  if (!items.length) return null;
  if (reduceMotion) {
    return (
      <div className="tv-ticker tv-ticker-static" data-ticker-mode="static" aria-label="Broadcast ticker">
        <span className="tv-ticker-item">{items[index % items.length]}</span>
      </div>
    );
  }
  const strip = items.join('   ◆   ');
  /* Speed is a function of length so a long strip reads at the same pace. */
  const seconds = Math.max(28, Math.round(strip.length / 7));
  return (
    <div className="tv-ticker" data-ticker-mode="scroll" aria-label="Broadcast ticker">
      <div className="tv-ticker-track" style={{ '--ticker-seconds': `${seconds}s` } as React.CSSProperties}>
        <span className="tv-ticker-item">{strip}</span>
        <span className="tv-ticker-item" aria-hidden="true">
          {strip}
        </span>
      </div>
    </div>
  );
}

/** Network-style bug: the on-air clock and the conditions. Client-only clock. */
export function OnAirBug({ weather, label }: { weather: Weather; label: string }) {
  const [clock, setClock] = useState('');
  useEffect(() => {
    const tick = () => setClock(onAirClock(new Date()));
    tick();
    const t = window.setInterval(tick, 15_000);
    return () => window.clearInterval(t);
  }, []);
  const conditions = weather === 'clear' ? 'CLEAR' : weather === 'drizzle' ? 'DRIZZLE' : 'DOWNPOUR';
  return (
    <span className="tv-bug" aria-label={`On air, ${conditions.toLowerCase()} conditions`}>
      <span className="tv-bug-label">{label}</span>
      <span className="tv-bug-weather" data-weather={weather}>
        {conditions}
      </span>
      {clock ? (
        <span className="tv-bug-clock num" suppressHydrationWarning>
          {clock}
        </span>
      ) : null}
    </span>
  );
}
