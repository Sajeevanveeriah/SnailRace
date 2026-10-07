'use client';

import { useState } from 'react';
import { addAudit, setState, useEvent } from '@/lib/event-store';
import { cardRaceNames } from '@/lib/card';
import {
  DEFAULT_CASH_TOTE,
  TICKET_PRICE_OPTIONS_CENTS,
  auctionOwners,
  isAuctionRace,
  projectTote,
  toteIsLive,
  toteProceeds,
} from '@/lib/cash-tote';
import { money, moneyShort, parseAmountToCents } from '@/lib/money';
import { laneColour } from '@/lib/palette';
import { newId, nowMs } from '@/lib/ids';

/**
 * The permit-gated cash tote, as the operator sees it.
 *
 * Off by default. Going live needs two things typed by a human: the permit
 * or authority reference, and a ticked attestation that the club holds it.
 * The app records that and nothing more; it does not decide the question.
 * Once live, the volunteer tallies paper tickets per runner before the off,
 * records auction bids on the last race, and prints the payout sheet.
 *
 * Everything here writes tallies and settings. Nothing here can reach the
 * draw, the free fun chips or the donation ledger.
 */

const ATTESTATION =
  'The club holds the permit or authority this activity needs (for example a VGCCC minor gaming permit), or has confirmed in writing that none is required. The club, not this app, is responsible for that position.';

export function CashTotePanel({
  nextRaceNo,
  locked,
}: {
  nextRaceNo: number;
  /** A race is armed or running: tallies for it are closed. */
  locked: boolean;
}) {
  const event = useEvent();
  const settings = event.cashTote;
  const live = toteIsLive(settings);
  const [attest, setAttest] = useState(false);
  const [reference, setReference] = useState(settings.permitReference);
  const [customPrice, setCustomPrice] = useState('');

  const enable = () => {
    const ref = reference.trim();
    if (!attest || !ref) return;
    const at = nowMs();
    setState({
      cashTote: { ...settings, enabled: true, permitAcknowledgedAt: at, permitReference: ref.slice(0, 80) },
    });
    addAudit({
      kind: 'tote_enabled',
      raceNo: 0,
      detail: `Cash tote enabled by the operator under the club's stated authority "${ref.slice(0, 80)}". Ticket ${money(settings.ticketCents)}, ${settings.retainedPercent}% retained. Attestation recorded; the app makes no legal claim.`,
    });
  };

  const disable = () => {
    setState({ cashTote: { ...settings, enabled: false } });
    addAudit({
      kind: 'tote_disabled',
      raceNo: 0,
      detail: 'Cash tote switched off by the operator. Settled races keep their printed dividends; no further races settle a tote.',
    });
  };

  const proceeds = toteProceeds(event.history);
  const settled = event.history.filter((h) => !h.void && (h.tote || h.auction));

  return (
    <section className="panel" aria-label="Cash tote">
      <h3 className="mb-1 font-semibold">Cash tote (club permit)</h3>
      <p className="mb-3 text-[11px] leading-snug text-(--tx)/55">
        Separate from free fun chips and from donations. Off unless the club has its own
        authority to run a tote. Paper tickets are sold and paid at the table; this records
        the tally, works out the dividend and prints the payout sheet.
      </p>

      {!live ? (
        <div className="grid gap-3">
          <label className="fld">
            <span>Permit or authority reference</span>
            <input
              type="text"
              value={reference}
              maxLength={80}
              placeholder="e.g. VGCCC minor gaming permit 12345"
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-snug text-(--tx)/80">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
            />
            <span>{ATTESTATION}</span>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!attest || !reference.trim()}
            onClick={enable}
          >
            Enable cash tote
          </button>
          {settings.permitAcknowledgedAt ? (
            <p className="text-[11px] text-(--tx)/45">
              Previously attested {new Date(settings.permitAcknowledgedAt).toLocaleString('en-AU')}; re-tick to
              enable again.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4">
          <p className="rounded-xl bg-(--ok)/10 px-3 py-2 text-xs text-(--ok)" role="status">
            LIVE under &ldquo;{settings.permitReference}&rdquo; since{' '}
            {new Date(settings.permitAcknowledgedAt ?? 0).toLocaleTimeString('en-AU')}.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="fld">
              <span>Ticket price</span>
              <select
                value={TICKET_PRICE_OPTIONS_CENTS.includes(settings.ticketCents as 100) ? settings.ticketCents : 'custom'}
                disabled={locked}
                onChange={(e) => {
                  if (e.target.value === 'custom') return;
                  setState({ cashTote: { ...settings, ticketCents: Number(e.target.value) } });
                }}
              >
                {TICKET_PRICE_OPTIONS_CENTS.map((c) => (
                  <option key={c} value={c}>
                    {moneyShort(c)}
                  </option>
                ))}
                <option value="custom">Custom ({money(settings.ticketCents)})</option>
              </select>
            </label>
            <label className="fld">
              <span>Custom price (AUD)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.5"
                step="0.5"
                value={customPrice}
                placeholder={(settings.ticketCents / 100).toFixed(2)}
                disabled={locked}
                onChange={(e) => setCustomPrice(e.target.value)}
                onBlur={() => {
                  const cents = parseAmountToCents(customPrice);
                  if (cents && cents >= 50 && cents <= 10_000) {
                    setState({ cashTote: { ...settings, ticketCents: cents } });
                  }
                  setCustomPrice('');
                }}
              />
            </label>
            <label className="fld">
              <span>Club retains (%)</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="5"
                value={settings.retainedPercent}
                disabled={locked}
                onChange={(e) =>
                  setState({
                    cashTote: {
                      ...settings,
                      retainedPercent: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))),
                    },
                  })
                }
              />
            </label>
            <label className="fld">
              <span>Auction retains (%)</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="5"
                value={settings.auctionRetainedPercent}
                disabled={locked}
                onChange={(e) =>
                  setState({
                    cashTote: {
                      ...settings,
                      auctionRetainedPercent: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))),
                    },
                  })
                }
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.auctionLastRace}
              disabled={locked}
              onChange={(e) => setState({ cashTote: { ...settings, auctionLastRace: e.target.checked } })}
            />
            Sell the runners in race {event.plannedRaces} by auction
          </label>

          <ToteTally raceNo={nextRaceNo} locked={locked} compact={false} />

          {isAuctionRace(settings, nextRaceNo, event.plannedRaces) ? (
            <AuctionDesk raceNo={nextRaceNo} locked={locked} />
          ) : null}

          {settled.length ? (
            <div>
              <p className="eyebrow mb-2">Settled tonight</p>
              <ul className="grid gap-1 text-xs">
                {settled
                  .slice()
                  .sort((a, b) => a.raceNo - b.raceNo)
                  .map((h) => (
                    <li key={`${h.raceNo}-${h.at}`} className="rounded-lg bg-(--tx)/5 px-3 py-1.5">
                      <b>Race {h.raceNo}</b>
                      {h.tote
                        ? h.tote.unbacked
                          ? ` - ${h.tote.tickets} tickets, pool ${money(h.tote.poolCents)}, no winning tickets (pool to club).`
                          : ` - pays ${money(h.tote.dividendCents)} per ${moneyShort(h.tote.ticketCents)} ticket on ${h.tote.winningTickets} winning ${h.tote.winningTickets === 1 ? 'ticket' : 'tickets'}; club keeps ${money(h.tote.retainedCents + h.tote.breakageCents)}.`
                        : ''}
                      {h.auction
                        ? h.auction.winningOwner
                          ? ` Auction: ${money(h.auction.prizeCents)} to ${h.auction.winningOwner.bidder}; club keeps ${money(h.auction.retainedCents)}.`
                          : ` Auction: winner unowned, club keeps ${money(h.auction.retainedCents)}.`
                        : ''}
                    </li>
                  ))}
              </ul>
              <p className="num mt-2 text-xs text-(--tx)/70">
                Tote to club {money(proceeds.toteCents)} · auction to club {money(proceeds.auctionCents)} · paid out{' '}
                {money(proceeds.paidOutCents)}
              </p>
            </div>
          ) : null}

          <button type="button" className="btn btn-ghost" onClick={disable} disabled={locked}>
            Switch the cash tote off
          </button>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-snug text-(--tx)/40">
        Defaults: {moneyShort(DEFAULT_CASH_TOTE.ticketCents)} tickets, {DEFAULT_CASH_TOTE.retainedPercent}% retained,
        dividends rounded down to 10c with breakage to the club. Nothing here is read by the race, the free
        chips or the donation totals.
      </p>
    </section>
  );
}

/**
 * Per-runner ticket counters for one race. Shared by the console and the
 * moderator desk so the volunteer can tally from whichever screen is closer.
 */
export function ToteTally({
  raceNo,
  locked,
  compact,
}: {
  raceNo: number;
  locked: boolean;
  compact: boolean;
}) {
  const event = useEvent();
  const names = cardRaceNames(event.card, raceNo);
  const board = projectTote(event.toteSales, raceNo, event.cashTote, names.length);
  const add = (lane: number, tickets: number) => {
    if (locked || !tickets) return;
    const current = board.perLane[lane]?.tickets ?? 0;
    const applied = Math.max(-current, tickets);
    if (!applied) return;
    const sale = { id: newId('ts'), raceNo, lane, tickets: applied, createdAt: nowMs() };
    setState((s) => ({ toteSales: [...s.toteSales, sale] }));
    addAudit({
      kind: 'tote_sale',
      raceNo,
      detail: `Race ${raceNo} tote: ${applied > 0 ? '+' : ''}${applied} ${Math.abs(applied) === 1 ? 'ticket' : 'tickets'} on ${names[lane]} (lane ${lane + 1}); now ${current + applied}.`,
    });
  };

  return (
    <div className={compact ? 'tote-tally tote-tally-compact' : 'tote-tally'} aria-label={`Race ${raceNo} tote tickets`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="eyebrow">Race {raceNo} tickets at {moneyShort(event.cashTote.ticketCents)}</p>
        <p className="num text-xs text-(--tx)/70">
          {board.tickets} sold · pool {money(board.poolCents)} · {money(board.returnedCents)} to winners
        </p>
      </div>
      {locked ? <p className="mb-2 text-[11px] text-(--bad)">Tallies are closed while the race is armed.</p> : null}
      <ol className="grid gap-1">
        {board.perLane.map((row) => (
          <li key={row.lane} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-sm">
            <span
              className="lane-badge num text-xs"
              style={{ '--shell': laneColour(row.lane).shell, '--shell-dk': laneColour(row.lane).dark } as React.CSSProperties}
            >
              {row.lane + 1}
            </span>
            <span className="min-w-0 truncate">
              {names[row.lane]}
              <span className="num ml-2 text-[11px] text-(--tx)/50">
                {row.wouldPayCents !== null ? `pays ${money(row.wouldPayCents)}` : 'no tickets'}
              </span>
            </span>
            <span className="num w-10 text-right font-semibold" aria-label={`${row.tickets} tickets`}>
              {row.tickets}
            </span>
            <span className="flex gap-1">
              <button type="button" className="btn btn-ghost px-2 py-1 text-xs" disabled={locked || row.tickets === 0} onClick={() => add(row.lane, -1)} aria-label={`Remove one ticket from ${names[row.lane]}`}>
                -1
              </button>
              <button type="button" className="btn btn-ghost px-2 py-1 text-xs" disabled={locked} onClick={() => add(row.lane, 1)} aria-label={`Add one ticket to ${names[row.lane]}`}>
                +1
              </button>
              {!compact ? (
                <button type="button" className="btn btn-ghost px-2 py-1 text-xs" disabled={locked} onClick={() => add(row.lane, 5)} aria-label={`Add five tickets to ${names[row.lane]}`}>
                  +5
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Record bids for the auctioned last race. Highest standing bid owns the runner. */
export function AuctionDesk({ raceNo, locked }: { raceNo: number; locked: boolean }) {
  const event = useEvent();
  const names = cardRaceNames(event.card, raceNo);
  const owners = auctionOwners(event.auctionBids, raceNo, names.length);
  const [lane, setLane] = useState(0);
  const [bidder, setBidder] = useState('');
  const [amount, setAmount] = useState('');
  const pool = owners.reduce((s, o) => s + o.cents, 0);

  const record = () => {
    const cents = parseAmountToCents(amount);
    if (locked || !cents) return;
    const bid = { id: newId('ab'), raceNo, lane, bidder: bidder.trim().slice(0, 40) || 'Anonymous', cents, createdAt: nowMs() };
    setState((s) => ({ auctionBids: [...s.auctionBids, bid] }));
    addAudit({
      kind: 'auction_bid',
      raceNo,
      detail: `Race ${raceNo} auction: ${bid.bidder} bid ${money(cents)} for ${names[lane]} (lane ${lane + 1}).`,
    });
    setAmount('');
  };

  return (
    <div className="tote-auction" aria-label={`Race ${raceNo} runner auction`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="eyebrow">Race {raceNo} runner auction</p>
        <p className="num text-xs text-(--tx)/70">pool {money(pool)}</p>
      </div>
      <ol className="mb-3 grid gap-1 text-sm">
        {names.map((name, i) => {
          const owner = owners.find((o) => o.lane === i);
          return (
            <li key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <span className="lane-badge num text-xs" style={{ '--shell': laneColour(i).shell, '--shell-dk': laneColour(i).dark } as React.CSSProperties}>
                {i + 1}
              </span>
              <span className="truncate">{name}</span>
              <span className="num text-xs text-(--tx)/70">
                {owner ? `${owner.bidder} · ${money(owner.cents)}` : 'no bid yet'}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <label className="fld">
          <span>Runner</span>
          <select value={lane} disabled={locked} onChange={(e) => setLane(Number(e.target.value))}>
            {names.map((n, i) => (
              <option key={i} value={i}>
                {i + 1}. {n}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>Bidder</span>
          <input type="text" value={bidder} maxLength={40} disabled={locked} placeholder="e.g. Table 4" onChange={(e) => setBidder(e.target.value)} />
        </label>
        <label className="fld">
          <span>Bid (AUD)</span>
          <input type="number" inputMode="decimal" min="1" step="1" value={amount} disabled={locked} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary self-end" disabled={locked || !parseAmountToCents(amount)} onClick={record}>
          Record bid
        </button>
      </div>
    </div>
  );
}
