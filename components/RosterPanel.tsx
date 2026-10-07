'use client';

import { useState } from 'react';
import { addAudit, setState } from '@/lib/event-store';
import {
  RACES_ON_CARD,
  SNAILS_ON_CARD,
  isSold,
  parseRosterPaste,
  rosterCsv,
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
}: {
  card: CardState;
  /** The race shown first. */
  raceNo: number;
  /** Race whose names are locked, if one is armed or running. */
  lockedRaceNo: number | null;
  /** The desk shows one race; Admin shows the whole card. */
  compact?: boolean;
}) {
  const [showAll, setShowAll] = useState(!compact);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [notice, setNotice] = useState('');

  const update = (snailNo: number, field: 'names' | 'owners', value: string) => {
    setState((s) => {
      const list = s.card[field].slice();
      list[snailNo - 1] = value.slice(0, 24);
      return { card: { ...s.card, [field]: list } };
    });
  };

  const applyPaste = () => {
    const { rows, skipped } = parseRosterPaste(paste);
    if (!rows.length) {
      setNotice(`Nothing to import${skipped ? ` (${skipped} lines skipped)` : ''}. One snail per line: number, name, owner.`);
      return;
    }
    let blocked = 0;
    setState((s) => {
      const names = s.card.names.slice();
      const owners = s.card.owners.slice();
      for (const row of rows) {
        const race = Math.ceil(row.snailNo / 10);
        if (lockedRaceNo === race) {
          blocked += 1;
          continue;
        }
        names[row.snailNo - 1] = row.name;
        owners[row.snailNo - 1] = row.owner;
      }
      return { card: { ...s.card, names, owners } };
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

  const races = showAll ? Array.from({ length: RACES_ON_CARD }, (_, i) => i + 1) : [raceNo];
  const sold = soldCount(card);

  return (
    <div className="roster" data-roster-sold={sold}>
      <div className="roster-head">
        <p className="desk-label">
          {sold} of {SNAILS_ON_CARD} snails named
        </p>
        <div className="roster-tools">
          {compact ? (
            <button type="button" className="btn btn-ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Race ${raceNo} only` : 'All 100'}
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
                Race {race} <span className="num">snails {(race - 1) * 10 + 1} to {race * 10}</span>
                {locked ? <span className="roster-locked">locked</span> : null}
              </h3>
            ) : locked ? (
              <p className="roster-locked">Race {race} is armed: names are locked until it finishes.</p>
            ) : null}
            <ol className="roster-rows">
              {snailsForRace(race).map((snailNo, lane) => (
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
