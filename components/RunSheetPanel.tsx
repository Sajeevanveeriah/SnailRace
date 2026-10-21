'use client';

import { useState } from 'react';
import { addAudit, setState } from '@/lib/event-store';
import {
  MAX_RACES,
  MAX_SNAILS_ON_CARD,
  MAX_SNAILS_PER_RACE,
  MIN_SNAILS_ON_CARD,
  MIN_SNAILS_PER_RACE,
  RACE_TYPES,
  addRace,
  cardFit,
  cardLayout,
  describeLayout,
  fitFixes,
  removeLastRace,
  resizeCard,
  runSheetLocks,
  setRaceCount,
  setRaceRunners,
  setRaceSettings,
  setSnailsPerRace,
  tiesOf,
  type CardState,
  type RaceLock,
  type RaceTypeName,
  type RunSheetRace,
} from '@/lib/card';
import { TRACK_DESIGNS, designIdName, designForRace, type TrackDesignId } from '@/lib/courses';
import { RACE_LENGTHS } from '@/lib/palette';
import { SURPRISE_LEVEL_NAMES, nightLength, nightRaceType, raceSettings, ranSummary, seconds } from '@/lib/run-sheet';
import type { CameraMode, EventState, SurpriseIntensity } from '@/lib/types';

const RUNNER_CHOICES = Array.from({ length: MAX_SNAILS_PER_RACE - MIN_SNAILS_PER_RACE + 1 }, (_, i) => MIN_SNAILS_PER_RACE + i);
const LAP_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const INTENSITY_IDS: SurpriseIntensity[] = ['calm', 'standard', 'big', 'chaos', 'mayhem'];

/** The locks for the card as it stands, from everything the night holds. */
export const locksFor = (event: EventState, armedRaceNo: number | null): RaceLock[] =>
  runSheetLocks(event.card, tiesOf(event, armedRaceNo));

/** Apply a card edit, or say why it could not be made. */
function commit(result: CardState | { error: string }, say: (m: string) => void, detail: string): boolean {
  if ('error' in result) {
    say(result.error);
    return false;
  }
  setState({ card: result });
  addAudit({ kind: 'note', raceNo: 0, detail });
  say(detail);
  return true;
}

/**
 * Snails on sale against places, said plainly, with the one-tap fixes. Used
 * by Admin and the desk so both say the same thing.
 */
export function CardFitNotice({ event, armedRaceNo, compact = false }: { event: EventState; armedRaceNo: number | null; compact?: boolean }) {
  const [notice, setNotice] = useState('');
  const fit = cardFit(event.card);
  if (!fit.diff) return notice ? <p className="desk-label" role="status">{notice}</p> : null;
  const fixes = fitFixes(event.card, locksFor(event, armedRaceNo));
  return (
    <div className={`card-fit ${compact ? 'card-fit-compact' : ''}`} role="alert" data-card-fit={fit.diff}>
      <p className="card-fit-message">{fit.message}</p>
      {fixes.length ? (
        <div className="card-fit-fixes">
          {fixes.map((fix) => (
            <button
              key={fix.id}
              type="button"
              className="btn btn-ghost"
              onClick={() => commit(fix.card, setNotice, `Run sheet fixed: ${fix.label}. Now ${describeLayout(cardLayout(fix.card))}, ${fix.card.snailCount} on sale.`)}
            >
              {fix.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="desk-label">Every race still to come is tied to a ticket, sale or bid, so the run sheet cannot absorb them. Add a race at the end.</p>
      )}
      {notice ? <p className="desk-label" role="status">{notice}</p> : null}
    </div>
  );
}

/**
 * The run sheet: how many races tonight, how many snails in each, and any
 * race that runs differently from the night's settings. Races already run
 * are shown as run and cannot change; a race a ticket, sale or bid is tied
 * to keeps its size, and the reason is printed under the table.
 */
export function RunSheetPanel({ event, armedRaceNo }: { event: EventState; armedRaceNo: number | null }) {
  const card = event.card;
  const locks = locksFor(event, armedRaceNo);
  const [notice, setNotice] = useState('');
  const [saleDraft, setSaleDraft] = useState<string | null>(null);
  const [racesDraft, setRacesDraft] = useState<string | null>(null);
  const say = (m: string) => setNotice(m);
  const night = nightLength(event);
  const lengthChoices = RACE_LENGTHS.map((l) => l.ms as number);

  const setRow = (raceNo: number, patch: Partial<Omit<RunSheetRace, 'runners' | 'field' | 'custom'>>, what: string) =>
    commit(setRaceSettings(card, raceNo, patch, locks), say, `Race ${raceNo}: ${what}.`);

  const lastLock = locks[card.races.length - 1];
  const removeReason = !lastLock
    ? ''
    : card.races.length <= 1
      ? 'A night needs at least one race.'
      : lastLock.run || lastLock.armed || lastLock.tie
        ? (() => {
            const r = removeLastRace(card, locks);
            return 'error' in r ? r.error : '';
          })()
        : '';
  const reasons = [...new Set(locks.map((l) => (l.run || l.armed ? '' : l.countLock)).filter(Boolean))];

  return (
    <section className="panel run-sheet lg:col-span-2 xl:col-span-3" aria-label="Run sheet">
      <h3 className="mb-1 font-semibold">Run sheet</h3>
      <p className="mb-3 text-[11px] leading-snug text-(--tx)/50">
        The races take the snail numbers in order, each as many as its runners. Every race still to come can change;
        a race that has run is locked. {describeLayout(cardLayout(card))}.
      </p>
      <div className="run-sheet-head">
        <div className="fld">
          <label htmlFor="run-sheet-sale">Snails on sale</label>
          <div className="run-sheet-inline">
            <input
              id="run-sheet-sale"
              type="number"
              inputMode="numeric"
              min={MIN_SNAILS_ON_CARD}
              max={MAX_SNAILS_ON_CARD}
              value={saleDraft ?? String(card.snailCount)}
              onChange={(e) => setSaleDraft(e.target.value)}
              onBlur={() => { if (saleDraft === String(card.snailCount)) setSaleDraft(null); }}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saleDraft === null || Number(saleDraft) === card.snailCount}
              onClick={() => {
                if (commit(resizeCard(card, Number(saleDraft)), say, `${Number(saleDraft)} snails on sale.`)) setSaleDraft(null);
              }}
            >
              Set
            </button>
          </div>
        </div>
        <div className="fld">
          <label htmlFor="run-sheet-races">Races tonight</label>
          <div className="run-sheet-inline">
            <input
              id="run-sheet-races"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_RACES}
              value={racesDraft ?? String(card.races.length)}
              onChange={(e) => setRacesDraft(e.target.value)}
              onBlur={() => { if (racesDraft === String(card.races.length)) setRacesDraft(null); }}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={racesDraft === null || Number(racesDraft) === card.races.length}
              onClick={() => {
                if (commit(setRaceCount(card, Number(racesDraft), locks), say, `${Number(racesDraft)} races tonight.`)) setRacesDraft(null);
              }}
            >
              Set
            </button>
          </div>
        </div>
        <label className="fld">
          <span>Snails per race</span>
          <select
            value={card.snailsPerRace}
            onChange={(e) => commit(setSnailsPerRace(card, Number(e.target.value), locks), say, `Snails per race set to ${e.target.value} for every race still free to change.`)}
          >
            {RUNNER_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <CardFitNotice event={event} armedRaceNo={armedRaceNo} />

      <div className="run-sheet-table" role="group" aria-label="Race by race">
        <div className="run-sheet-row run-sheet-labels" aria-hidden="true">
          <span>Race</span>
          <span>Runners</span>
          <span>Track</span>
          <span>Length</span>
          <span>Laps</span>
          <span>Surprises</span>
          <span>Camera</span>
          <span>Race type</span>
        </div>
        {card.races.map((row, i) => {
          const raceNo = i + 1;
          const lock = locks[i];
          const s = raceSettings(event, raceNo);
          const ran = event.history.find((h) => !h.void && h.raceNo === raceNo);
          const snails = s.runOff ? `${s.snails.length} winners` : `snails ${s.snails[0]} to ${s.snails[s.snails.length - 1]}`;
          if (lock?.run || lock?.armed) {
            return (
              <div key={raceNo} className="run-sheet-row run-sheet-done" role="group" aria-label={`Race ${raceNo}`}>
                <span><b>{s.title}</b> <small>{snails}</small></span>
                <span className="run-sheet-ran">
                  {lock.run ? <span className="run-sheet-badge">Run</span> : <span className="run-sheet-badge run-sheet-badge-live">At the gate</span>}
                  {ran ? ranSummary(ran) : `${s.designName}, ${s.trackShape === 'circuit' ? `${s.laps} x ${seconds(s.lapMs)}` : seconds(s.durationMs)}`}
                </span>
              </div>
            );
          }
          const rotation = designForRace(event.trackDesigns, event.trackShape, raceNo);
          const rotationName = rotation.trackShape === 'lanes' ? 'Side-on straight' : designIdName(rotation.courseId);
          const nightDefault = s.trackShape === 'circuit' ? night.lapMs : event.raceDurationMs;
          const lengthNow = row.lengthMs ?? nightDefault;
          const lengths = lengthChoices.includes(lengthNow) ? lengthChoices : [...lengthChoices, lengthNow].sort((a, b) => b - a);
          return (
            <div key={raceNo} className="run-sheet-row" role="group" aria-label={`Race ${raceNo}`}>
              <span><b>{s.title}</b> <small>{snails}</small></span>
              <label>
                <span className="sr-only">Race {raceNo} runners</span>
                <select
                  value={row.runners}
                  disabled={Boolean(lock?.countLock)}
                  title={lock?.countLock || undefined}
                  onChange={(e) => commit(setRaceRunners(card, raceNo, Number(e.target.value), locks), say, `Race ${raceNo}: ${e.target.value} runners.`)}
                >
                  {RUNNER_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Race {raceNo} track</span>
                <select
                  value={row.design ?? ''}
                  onChange={(e) => setRow(raceNo, { design: (e.target.value || undefined) as TrackDesignId | undefined }, `runs on ${e.target.value ? designIdName(e.target.value as TrackDesignId) : `the night rotation (${rotationName})`}`)}
                >
                  <option value="">Night: {rotationName}</option>
                  {TRACK_DESIGNS.map((d) => <option key={d.id} value={d.id}>{designIdName(d.id)}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Race {raceNo} length</span>
                <select
                  value={row.lengthMs ?? ''}
                  onChange={(e) => setRow(raceNo, { lengthMs: e.target.value ? Number(e.target.value) : undefined }, e.target.value ? `${s.trackShape === 'circuit' ? 'laps of' : 'runs'} ${seconds(Number(e.target.value))}` : 'night length')}
                >
                  <option value="">Night: {seconds(nightDefault)}</option>
                  {lengths.map((ms) => <option key={ms} value={ms}>{s.trackShape === 'circuit' ? `${seconds(ms)} a lap` : seconds(ms)}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Race {raceNo} lap count</span>
                <select
                  value={row.laps ?? ''}
                  disabled={s.trackShape !== 'circuit'}
                  title={s.trackShape !== 'circuit' ? 'The straight runs once.' : undefined}
                  onChange={(e) => setRow(raceNo, { laps: e.target.value ? Number(e.target.value) : undefined }, e.target.value ? `${e.target.value} laps` : 'night laps')}
                >
                  <option value="">{s.trackShape === 'circuit' ? `Night: ${night.laps}` : 'One run'}</option>
                  {LAP_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Race {raceNo} surprise level</span>
                <select
                  value={row.intensity ?? ''}
                  onChange={(e) => setRow(raceNo, { intensity: (e.target.value || undefined) as SurpriseIntensity | undefined }, e.target.value ? `${SURPRISE_LEVEL_NAMES[e.target.value as SurpriseIntensity]} surprises` : 'night surprise level')}
                >
                  <option value="">Night: {SURPRISE_LEVEL_NAMES[event.intensity]}</option>
                  {INTENSITY_IDS.map((id) => <option key={id} value={id}>{SURPRISE_LEVEL_NAMES[id]}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Race {raceNo} camera</span>
                <select
                  value={row.camera ?? ''}
                  onChange={(e) => setRow(raceNo, { camera: (e.target.value || undefined) as CameraMode | undefined }, e.target.value ? `starts on ${e.target.value === 'full' ? 'Full field' : 'Telecast'}` : 'keeps the desk camera')}
                >
                  <option value="">As the desk has it</option>
                  <option value="telecast">Telecast</option>
                  <option value="full">Full field</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Race {raceNo} race type</span>
                <select
                  value={row.raceType ?? ''}
                  onChange={(e) => setRow(raceNo, { raceType: (e.target.value || undefined) as RaceTypeName | undefined }, e.target.value ? `${e.target.value} race` : 'night race type')}
                >
                  <option value="">Night: {nightRaceType(event)}</option>
                  {RACE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
          );
        })}
      </div>
      {reasons.length ? (
        <ul className="run-sheet-reasons">
          {reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      ) : null}
      <div className="run-sheet-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={card.races.length >= MAX_RACES}
          onClick={() => commit(addRace(card), say, `Race ${card.races.length + 1} added: ${card.snailsPerRace} runners.`)}
        >
          Add race
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={Boolean(removeReason)}
          title={removeReason || undefined}
          onClick={() => commit(removeLastRace(card, locks), say, `Race ${card.races.length} removed.`)}
        >
          Remove last race
        </button>
        {removeReason ? <span className="desk-label">{removeReason}</span> : null}
      </div>
      {notice ? <p className="mt-2 text-[12px]" role="status">{notice}</p> : null}
    </section>
  );
}
