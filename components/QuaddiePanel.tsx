'use client';

import { useState } from 'react';
import { addAudit, setState } from '@/lib/event-store';
import { money } from '@/lib/money';
import { newId, nowMs } from '@/lib/ids';
import { cardRaceNames, raceForSnail, snailsForRace, validSnailNo } from '@/lib/card';
import {
  QUADDIE_LEGS,
  picksMatchLegs,
  quaddieIsLive,
  quaddieOpen,
  quaddieStatus,
  type QuaddieEntry,
  type QuaddieSettings,
} from '@/lib/quaddie';
import type { EventState } from '@/lib/types';

/* ── Admin: the permit gate and the legs ───────────────────────────────── */

/**
 * The quaddie is off until the club records the authority it holds to run
 * it. The app writes the attestation to the audit trail; it does not decide
 * the question and makes no claim about it.
 */
export function QuaddieSettingsPanel({ event, locked }: { event: EventState; locked: boolean }) {
  const q = event.quaddie;
  const [reference, setReference] = useState(q.permitReference);
  const [attest, setAttest] = useState(false);
  const live = quaddieIsLive(q);
  /* Money terms freeze with the first ticket: a payout is never recomputed
     under terms nobody bought under. Switching the quaddie off does not
     unfreeze them. */
  const termsFrozen = live || event.quaddieEntries.some((e) => !e.void);

  const save = (patch: Partial<QuaddieSettings>) =>
    setState((s) => ({ quaddie: { ...s.quaddie, ...patch } }));

  const enable = () => {
    const ref = reference.trim();
    if (!ref || !attest) return;
    const at = nowMs();
    save({ enabled: true, permitReference: ref, permitAcknowledgedAt: at });
    addAudit({
      kind: 'quaddie_enabled',
      raceNo: 0,
      detail: `Quaddie enabled on races ${q.legs.join(', ')} under the club's stated authority "${ref}", attested by the operator at ${new Date(at).toLocaleString('en-AU')}.`,
    });
  };

  const disable = () => {
    save({ enabled: false });
    addAudit({ kind: 'quaddie_disabled', raceNo: 0, detail: 'Quaddie switched off by the operator.' });
  };

  const setLeg = (index: number, raceNo: number) => {
    const legs = q.legs.slice();
    /* A race already used by another leg swaps places with it, so there are
       always four distinct legs and never a vanished selector. */
    const other = legs.indexOf(raceNo);
    if (other >= 0 && other !== index) legs[other] = legs[index];
    legs[index] = raceNo;
    save({ legs: legs.sort((a, b) => a - b) });
  };

  return (
    <section className="panel" aria-label="Quaddie">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Quaddie</h3>
        <span className={`fun-chip-tag ${live ? '!text-(--ok)' : ''}`}>{live ? 'LIVE under club authority' : 'off'}</span>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-(--tx)/50">
        Four nominated races. One entry picks the winner of each; every entry with all four right shares the pool
        after the club&apos;s share. This is a club product under the club&apos;s own authority, kept apart from the race
        engine. Record the permit or authority reference and attest to it to switch it on.
      </p>
      {!live ? (
        <div className="grid gap-2">
          <label className="fld">
            <span>Permit or authority reference</span>
            <input type="text" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span>I confirm the club holds the authority referenced above to run this quaddie tonight.</span>
          </label>
          <button type="button" className="btn btn-go" disabled={!reference.trim() || !attest} onClick={enable}>
            Enable quaddie
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={disable} disabled={locked}>
          Switch the quaddie off
        </button>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {q.legs.map((leg, index) => (
          <label key={index} className="fld">
            <span>Leg {index + 1}</span>
            <select value={leg} disabled={termsFrozen} onChange={(e) => setLeg(index, Number(e.target.value))}>
              {Array.from({ length: event.plannedRaces }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Race {n}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="fld">
          <span>Entry (AUD)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={q.entryCents / 100}
            disabled={termsFrozen}
            onChange={(e) => save({ entryCents: Math.max(100, Math.round(Number(e.target.value) * 100)) })}
          />
        </label>
        <label className="fld">
          <span>Club share of the pool (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={q.retainedPercent}
            disabled={termsFrozen}
            onChange={(e) => save({ retainedPercent: Math.min(100, Math.max(0, Math.round(Number(e.target.value)))) })}
          />
        </label>
      </div>
      {q.legs.length !== QUADDIE_LEGS ? (
        <p className="mt-2 text-[11px] text-(--bad)">Choose four different races.</p>
      ) : null}
    </section>
  );
}

/* ── Desk: record an entry, see who is alive ───────────────────────────── */

export function QuaddieDesk({ event, racing, nextRaceNo }: { event: EventState; racing: boolean; nextRaceNo: number }) {
  const settings = event.quaddie;
  const status = quaddieStatus(settings, event.quaddieEntries, event.history);
  const open = quaddieOpen(settings, event.history, racing, nextRaceNo);
  const [holder, setHolder] = useState('');
  const [picks, setPicks] = useState<number[]>(() => settings.legs.map((leg) => snailsForRace(leg)[0]));
  const [error, setError] = useState('');

  if (!status.live) return null;

  const record = () => {
    const name = holder.trim();
    if (!name) {
      setError('Who holds the ticket?');
      return;
    }
    if (!picksMatchLegs(picks, settings.legs) || !picks.every(validSnailNo)) {
      setError('Pick one snail in each leg.');
      return;
    }
    const entry: QuaddieEntry = { id: newId('qd'), holder: name, picks: picks.slice(), createdAt: nowMs() };
    setState((s) => ({ quaddieEntries: [...s.quaddieEntries, entry] }));
    addAudit({
      kind: 'quaddie_entry',
      raceNo: settings.legs[0],
      detail: `Quaddie entry ${entry.id} for ${name}: snails ${picks.join(', ')} at ${money(settings.entryCents)}.`,
    });
    setHolder('');
    setError('');
  };

  const voidEntry = (id: string) => {
    setState((s) => ({ quaddieEntries: s.quaddieEntries.map((e) => (e.id === id ? { ...e, void: true } : e)) }));
    addAudit({ kind: 'note', raceNo: settings.legs[0], detail: `Quaddie entry ${id} voided by the operator.` });
  };

  return (
    <section className="desk-panel desk-quaddie" aria-label="Quaddie entries">
      <h2>
        Quaddie <span className="num desk-label">races {settings.legs.join(', ')} · {money(settings.entryCents)} a ticket</span>
      </h2>
      <p className="desk-label" role="status">
        {status.entries} {status.entries === 1 ? 'entry' : 'entries'} · pool {money(status.poolCents)} · {status.legsRun} of {QUADDIE_LEGS} legs run
        {status.legsRun > 0 ? ` · ${status.alive.length} alive` : ''}
        {status.complete ? (status.unwon ? ' · no winner, pool to the club' : ` · pays ${money(status.dividendCents)} each`) : ''}
      </p>
      {open ? (
        <form
          className="quaddie-entry"
          onSubmit={(e) => {
            e.preventDefault();
            record();
          }}
        >
          <label>
            <span className="desk-label">Ticket holder</span>
            <input type="text" value={holder} maxLength={24} onChange={(e) => setHolder(e.target.value)} />
          </label>
          {settings.legs.map((leg, index) => (
            <label key={leg}>
              <span className="desk-label">Race {leg}</span>
              <select
                value={picks[index]}
                onChange={(e) => {
                  const next = picks.slice();
                  next[index] = Number(e.target.value);
                  setPicks(next);
                }}
              >
                {snailsForRace(leg).map((snailNo, lane) => (
                  <option key={snailNo} value={snailNo}>
                    {snailNo} {cardRaceNames(event.card, leg)[lane]}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button type="submit" className="btn btn-go">
            Record entry
          </button>
          {error ? (
            <p className="desk-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="desk-label">Entries closed: the first leg has {racing && nextRaceNo === settings.legs[0] ? 'gone to the gate' : 'run'}.</p>
      )}
      {event.quaddieEntries.length ? (
        <ol className="quaddie-list">
          {event.quaddieEntries
            .slice()
            .reverse()
            .slice(0, 12)
            .map((entry) => {
              const alive = !entry.void && status.alive.some((a) => a.id === entry.id);
              return (
                <li key={entry.id} className={entry.void ? 'quaddie-void' : alive ? 'quaddie-alive' : ''}>
                  <span>{entry.holder}</span>
                  <span className="num">{entry.picks.join(' · ')}</span>
                  <span className="desk-label">{entry.void ? 'void' : status.legsRun === 0 ? 'in' : alive ? 'alive' : 'out'}</span>
                  {!entry.void && open ? (
                    <button type="button" className="btn btn-ghost" onClick={() => voidEntry(entry.id)}>
                      Void
                    </button>
                  ) : null}
                </li>
              );
            })}
        </ol>
      ) : null}
    </section>
  );
}

/** For the Admin ledger: which snail number a pick names, by race. */
export const pickRace = (snailNo: number): number => raceForSnail(snailNo);
