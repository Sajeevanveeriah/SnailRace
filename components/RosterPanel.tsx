'use client';

import { useState } from 'react';
import { addAudit, setState } from '@/lib/event-store';
import {
  MAX_NAME,
  MAX_OWNER,
  MAX_SNAILS_ON_CARD,
  MIN_SNAILS_ON_CARD,
  cardFit,
  cardLayout,
  describeLayout,
  isRunOff,
  isSold,
  parseRosterPaste,
  raceForSnail,
  resizeCard,
  rosterCsv,
  snailsForRace,
  soldCount,
} from '@/lib/card';
import { laneColour } from '@/lib/palette';
import { CardFitNotice } from './RunSheetPanel';
import type { EventState } from '@/lib/types';

/**
 * The roster: every snail on the card, by number, with its name and owner.
 *
 * Stripe fills these as people pay; the desk fixes typos, records cash sales
 * and pastes a list from a spreadsheet. Names for a race lock the moment that
 * race is armed, so the plan hash and the board can never disagree.
 */
export function RosterPanel({
  event,
  raceNo,
  lockedRaceNo,
  compact = false,
}: {
  event: EventState;
  /** The race shown first. */
  raceNo: number;
  /** Race whose names are locked, if one is armed or running. */
  lockedRaceNo: number | null;
  /** The desk shows one race with the snails on sale; Admin shows the whole card (the run sheet holds the count). */
  compact?: boolean;
}) {
  const card = event.card;
  /* Null while not being edited, so the box always shows the card as it stands. */
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(!compact);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [notice, setNotice] = useState('');

  /* A hand edit makes the slot the desk's: the Stripe claim is released so a
     later refund of that payment cannot erase what the desk typed. */
  const update = (snailNo: number, field: 'names' | 'owners', value: string) => {
    setState((s) => {
      const list = s.card[field].slice();
      list[snailNo - 1] = value.slice(0, field === 'names' ? MAX_NAME : MAX_OWNER);
      const claims = { ...s.card.claims };
      delete claims[snailNo];
      return { card: { ...s.card, [field]: list, claims } };
    });
  };

  const applyPaste = () => {
    const { rows, skipped } = parseRosterPaste(paste, card);
    if (!rows.length) {
      setNotice(`Nothing to import${skipped ? ` (${skipped} lines skipped)` : ''}. One snail per line: number, name, owner.`);
      return;
    }
    let blocked = 0;
    setState((s) => {
      const names = s.card.names.slice();
      const owners = s.card.owners.slice();
      const claims = { ...s.card.claims };
      for (const row of rows) {
        const race = raceForSnail(row.snailNo, s.card);
        if (race && lockedRaceNo === race) {
          blocked += 1;
          continue;
        }
        names[row.snailNo - 1] = row.name;
        owners[row.snailNo - 1] = row.owner;
        delete claims[row.snailNo];
      }
      return { card: { ...s.card, names, owners, claims } };
    });
    addAudit({ kind: 'note', raceNo: 0, detail: `Roster import: ${rows.length - blocked} snails set from a pasted list${blocked ? `, ${blocked} skipped because their race is locked` : ''}${skipped ? `, ${skipped} lines unreadable` : ''}.` });
    setNotice(`${rows.length - blocked} snails updated${blocked ? `, ${blocked} locked` : ''}${skipped ? `, ${skipped} lines skipped` : ''}.`);
    setPaste('');
    setPasteOpen(false);
  };

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(rosterCsv(card));
      setNotice('Roster copied as CSV.');
    } catch {
      setNotice('Could not reach the clipboard. Use the export in Admin instead.');
    }
  };

  const races = (showAll ? Array.from({ length: card.races.length }, (_, i) => i + 1) : [raceNo]).filter((race) => !isRunOff(card, race) || !showAll);
  const sold = soldCount(card);
  const fit = cardFit(card);
  /* Snails on sale with no race yet still need their names typed. */
  const spare = showAll && fit.diff > 0 ? Array.from({ length: fit.diff }, (_, k) => fit.places + 1 + k) : [];

  return (
    <div className="roster" data-roster-sold={sold}>
      <div className="roster-head">
        <p className="desk-label">
          {sold} of {card.snailCount} snails named
        </p>
        <div className="roster-tools">
          {compact ? (
            <button type="button" className="btn btn-ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Race ${raceNo} only` : `All ${card.snailCount}`}
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
            Paste list
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void copyCsv()}>
            Copy CSV
          </button>
        </div>
      </div>
      {compact ? (
        <div className="roster-count">
          <label>
            <span className="desk-label">Snails on sale</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_SNAILS_ON_CARD}
              max={MAX_SNAILS_ON_CARD}
              value={countDraft ?? String(card.snailCount)}
              onChange={(e) => setCountDraft(e.target.value)}
              onBlur={() => { if (countDraft === String(card.snailCount)) setCountDraft(null); }}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={countDraft === null || Number(countDraft) === card.snailCount}
            onClick={() => {
              const result = resizeCard(card, Number(countDraft));
              if ('error' in result) {
                setNotice(result.error);
                return;
              }
              setState({ card: result });
              setCountDraft(null);
              addAudit({ kind: 'note', raceNo: 0, detail: `${result.snailCount} snails on sale.` });
              setNotice(`${result.snailCount} snails on sale.`);
            }}
          >
            Set
          </button>
          <p className="desk-label">{describeLayout(cardLayout(card))}, {fit.places} places</p>
        </div>
      ) : null}
      {compact ? <CardFitNotice event={event} armedRaceNo={lockedRaceNo} compact /> : null}
      {pasteOpen ? (
        <div className="roster-paste">
          <label>
            <span className="desk-label">One snail per line: number, snail name, owner</span>
            <textarea
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'29, Escargot Faster, Priya\n30, Nan\'s Favourite, Lisa'}
            />
          </label>
          <div className="roster-tools">
            <button type="button" className="btn btn-go" onClick={applyPaste}>
              Import
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p className="desk-label" role="status">
          {notice}
        </p>
      ) : null}
      {[...races, ...(spare.length ? [0] : [])].map((race) => {
        const locked = race > 0 && lockedRaceNo === race;
        const numbers = race > 0 ? snailsForRace(race, card) : spare;
        return (
          <section key={race} className="roster-race" aria-label={race > 0 ? `Race ${race} snails` : 'Snails with no race'}>
            {showAll ? (
              <h3 className="roster-race-title">
                {race > 0 ? `Race ${race}` : 'No race yet'} <span className="num">{numbers.length === 1 ? `snail ${numbers[0]}` : `snails ${numbers[0]} to ${numbers.at(-1)}`}</span>
                {locked ? <span className="roster-locked">locked</span> : null}
              </h3>
            ) : locked ? (
              <p className="roster-locked">Race {race} is armed: names are locked until it finishes.</p>
            ) : null}
            <ol className="roster-rows">
              {numbers.map((snailNo, lane) => (

                <li key={snailNo} className={`roster-row ${isSold(card, snailNo) ? '' : 'roster-unsold'}`}>
                  <span className="desk-lane num" style={{ background: laneColour(lane).shell }}>
                    {snailNo}
                  </span>
                  <input
                    type="text"
                    aria-label={`Snail ${snailNo} name`}
                    placeholder="Unsold"
                    maxLength={MAX_NAME}
                    value={card.names[snailNo - 1] ?? ''}
                    disabled={locked}
                    onChange={(e) => update(snailNo, 'names', e.target.value)}
                  />
                  <input
                    type="text"
                    aria-label={`Snail ${snailNo} owner`}
                    placeholder="Owner"
                    maxLength={MAX_OWNER}
                    value={card.owners[snailNo - 1] ?? ''}
                    disabled={locked}
                    onChange={(e) => update(snailNo, 'owners', e.target.value)}
                  />
                  {card.claims[snailNo] ? (
                    <span className="roster-paid" title="Paid through Stripe">
                      paid
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
