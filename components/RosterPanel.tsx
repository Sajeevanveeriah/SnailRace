'use client';

import { useState } from 'react';
import { addAudit, setState } from '@/lib/event-store';
import {
  MAX_SNAILS_ON_CARD,
  MIN_SNAILS_ON_CARD,
  cardLayout,
  describeLayout,
  isSold,
  parseRosterPaste,
  raceForSnail,
  resizeCard,
  rosterCsv,
  snailCountFits,
  snailsForRace,
  soldCount,
} from '@/lib/card';
import { laneColour } from '@/lib/palette';
import type { CardState } from '@/lib/card';

/**
 * The roster: every snail on the card, by number, with its name and owner.
 *
 * Stripe fills these as people pay; the desk fixes typos, records cash sales
 * and pastes a list from a spreadsheet. Names for a race lock the moment that
 * race is armed, so the plan hash and the board can never disagree.
 */
export function RosterPanel({
  card,
  raceNo,
  lockedRaceNo,
  compact = false,
  resizeLockedReason = '',
}: {
  card: CardState;
  /** The race shown first. */
  raceNo: number;
  /** Race whose names are locked, if one is armed or running. */
  lockedRaceNo: number | null;
  /** The desk shows one race; Admin shows the whole card. */
  compact?: boolean;
  /** Why the number of snails cannot change right now; empty when it can. */
  resizeLockedReason?: string;
}) {
  const [countDraft, setCountDraft] = useState(String(card.snailCount));
  const [showAll, setShowAll] = useState(!compact);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [notice, setNotice] = useState('');

  /* A hand edit makes the slot the desk's: the Stripe claim is released so a
     later refund of that payment cannot erase what the desk typed. */
  const update = (snailNo: number, field: 'names' | 'owners', value: string) => {
    setState((s) => {
      const list = s.card[field].slice();
      list[snailNo - 1] = value.slice(0, 24);
      const claims = { ...s.card.claims };
      delete claims[snailNo];
      return { card: { ...s.card, [field]: list, claims } };
    });
  };

  const applyPaste = () => {
    const { rows, skipped } = parseRosterPaste(paste, card.snailCount);
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
        const race = raceForSnail(row.snailNo, s.card.snailCount);
        if (lockedRaceNo === race) {
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

  const races = showAll ? Array.from({ length: cardLayout(card.snailCount).races }, (_, i) => i + 1) : [raceNo];
  const sold = soldCount(card);

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
      <div className="roster-count">
        <label>
          <span className="desk-label">Snails on sale</span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_SNAILS_ON_CARD}
            max={MAX_SNAILS_ON_CARD}
            value={countDraft}
            disabled={Boolean(resizeLockedReason)}
            onChange={(e) => setCountDraft(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={Boolean(resizeLockedReason) || Number(countDraft) === card.snailCount}
          onClick={() => {
            const result = resizeCard(card, Number(countDraft));
            if ('error' in result) {
              setNotice(result.error);
              return;
            }
            setState({ card: result });
            setCountDraft(String(result.snailCount));
            addAudit({ kind: 'note', raceNo: 0, detail: `Card set to ${result.snailCount} snails: ${describeLayout(cardLayout(result.snailCount))}.` });
            setNotice(`${result.snailCount} snails on sale: ${describeLayout(cardLayout(result.snailCount))}.`);
          }}
        >
          Set
        </button>
        <p className="desk-label">
          {resizeLockedReason ||
            (snailCountFits(Number(countDraft))
              ? describeLayout(cardLayout(Number(countDraft)))
              : `Pick ${MIN_SNAILS_ON_CARD} to ${MAX_SNAILS_ON_CARD} snails that split into races of eight to ten.`)}
        </p>
      </div>
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
      {races.map((race) => {
        const locked = lockedRaceNo === race;
        return (
          <section key={race} className="roster-race" aria-label={`Race ${race} snails`}>
            {showAll ? (
              <h3 className="roster-race-title">
                Race {race} <span className="num">snails {snailsForRace(race, card.snailCount)[0]} to {snailsForRace(race, card.snailCount).at(-1)}</span>
                {locked ? <span className="roster-locked">locked</span> : null}
              </h3>
            ) : locked ? (
              <p className="roster-locked">Race {race} is armed: names are locked until it finishes.</p>
            ) : null}
            <ol className="roster-rows">
              {snailsForRace(race, card.snailCount).map((snailNo, lane) => (
                <li key={snailNo} className={`roster-row ${isSold(card, snailNo) ? '' : 'roster-unsold'}`}>
                  <span className="desk-lane num" style={{ background: laneColour(lane).shell }}>
                    {snailNo}
                  </span>
                  <input
                    type="text"
                    aria-label={`Snail ${snailNo} name`}
                    placeholder="Unsold"
                    maxLength={24}
                    value={card.names[snailNo - 1] ?? ''}
                    disabled={locked}
                    onChange={(e) => update(snailNo, 'names', e.target.value)}
                  />
                  <input
                    type="text"
                    aria-label={`Snail ${snailNo} owner`}
                    placeholder="Owner"
                    maxLength={24}
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
