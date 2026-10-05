'use client';

import { addAudit, setState } from './event-store';
import { settleBets } from './tote';
import { resultHashOf } from './audit';
import { CHIP_START, money } from './money';
import { isAuctionRace, settleAuction, settleTote, toteIsLive } from './cash-tote';
import type { EventState, RaceHistoryEntry, RaceResult } from './types';

/**
 * Attach the permit-gated cash tote settlement to a finished race.
 *
 * Pure and one-directional: it reads the winner from an entry that already
 * exists and the tallies the operator typed, and returns a new entry. It
 * writes nothing into the chip bank, the bet book or the donation ledger,
 * and it is skipped entirely unless the tote is live under its attestation.
 */
export function withCashTote(
  state: Pick<EventState, 'cashTote' | 'toteSales' | 'auctionBids' | 'plannedRaces'>,
  entry: RaceHistoryEntry,
): RaceHistoryEntry {
  if (!toteIsLive(state.cashTote)) return entry;
  const winner = entry.results.find((r) => r.place === 1);
  if (!winner) return entry;
  const fieldSize = entry.fieldSize;
  const auction = isAuctionRace(state.cashTote, entry.raceNo, state.plannedRaces);
  return {
    ...entry,
    ...(auction
      ? {
          auction: settleAuction({
            bids: state.auctionBids,
            raceNo: entry.raceNo,
            retainedPercent: state.cashTote.auctionRetainedPercent,
            winnerLane: winner.lane,
            fieldSize,
          }),
        }
      : {}),
    tote: settleTote({
      sales: state.toteSales,
      raceNo: entry.raceNo,
      settings: state.cashTote,
      winnerLane: winner.lane,
      fieldSize,
    }),
  };
}

/** Bonus chips per race for a punter on a run, so a hot streak is worth chasing. */
export const STREAK_BONUS = 25;

/**
 * Record one finished race and settle its fun chips - the one path every
 * race source shares. The animated engine and the recorded Race Pack both
 * come through here, so exactly-once settlement, streaks, the audit entries
 * and the async result hash have a single implementation to reason about.
 *
 * The exactly-once guard is structural: a standing (non-void) entry for the
 * race number refuses re-entry, whatever called it and however many times.
 */
export function recordRaceResult(entry: RaceHistoryEntry): { recorded: boolean } {
  const raceNo = entry.raceNo;
  const winner = entry.results.find((r) => r.place === 1);
  let recorded = false;

  setState((s) => {
    if (s.history.some((h) => h.raceNo === raceNo && !h.void)) return {};
    recorded = true;

    const settled = settleBets(s.bets, raceNo, winner?.lane ?? -1);
    const bank = { ...s.chipBank };
    for (const b of settled) {
      if (b.raceNo !== raceNo || !b.returned) continue;
      const k = b.punter.trim().toLowerCase();
      bank[k] = (bank[k] ?? CHIP_START) + b.returned;
    }

    const streaks = { ...s.streaks };
    const played = new Map<string, boolean>();
    for (const b of settled) {
      if (b.raceNo !== raceNo) continue;
      const k = b.punter.trim().toLowerCase();
      played.set(k, (played.get(k) ?? false) || Boolean(b.won));
    }
    for (const [k, won] of played) {
      const run = won ? (streaks[k] ?? 0) + 1 : 0;
      streaks[k] = run;
      if (run >= 2) bank[k] = (bank[k] ?? CHIP_START) + STREAK_BONUS * run;
    }

    return {
      raceNumber: raceNo,
      history: [
        { ...withCashTote(s, entry), chipBankBefore: { ...s.chipBank }, streaksBefore: { ...s.streaks } },
        ...s.history,
      ],
      bets: settled,
      chipBank: bank,
      streaks,
      bettingOpen: true,
      showPhase: 'results',
    };
  });

  if (!recorded) return { recorded };

  addAudit({
    kind: 'race_finished',
    raceNo,
    detail: `Race ${raceNo} finished (${entry.source === 'pack' ? `recorded pack race ${entry.packRaceId}` : `seed ${entry.seedHex}`}). Winner ${winner?.name ?? 'none'} (lane ${(winner?.lane ?? -1) + 1}).`,
  });

  /* Settlement summary for the trail, from the freshest book. */
  setState((s) => {
    const raceBets = s.bets.filter((b) => b.raceNo === raceNo && b.settled);
    if (raceBets.length) {
      const paid = raceBets.reduce((sum, b) => sum + (b.returned ?? 0), 0);
      addAudit({
        kind: 'bets_settled',
        raceNo,
        detail: `Race ${raceNo}: ${raceBets.length} fun-chip ${raceBets.length === 1 ? 'bet' : 'bets'} settled once, ${paid} chips paid at locked odds. FUN CHIPS - no monetary value.`,
      });
    }
    return {};
  });

  /* The tote settles from the stored entry, so the trail quotes what the
     printed payout sheet will show. Nothing here touches chips. */
  setState((s) => {
    const standing = s.history.find((h) => h.raceNo === raceNo && !h.void && h.at === entry.at);
    if (standing?.tote) {
      const t = standing.tote;
      addAudit({
        kind: 'tote_settled',
        raceNo,
        detail: t.unbacked
          ? `Race ${raceNo} cash tote: ${t.tickets} tickets, pool ${money(t.poolCents)}, no tickets on the winner; ${money(t.returnedCents)} stays with the club with the ${t.retainedPercent}% retained share.`
          : `Race ${raceNo} cash tote: ${t.tickets} tickets, pool ${money(t.poolCents)}, ${t.retainedPercent}% retained (${money(t.retainedCents)}), dividend ${money(t.dividendCents)} per ${money(t.ticketCents)} ticket on ${t.winningTickets} winning ${t.winningTickets === 1 ? 'ticket' : 'tickets'}, breakage ${money(t.breakageCents)}.`,
      });
    }
    if (standing?.auction) {
      const a = standing.auction;
      addAudit({
        kind: 'auction_settled',
        raceNo,
        detail: a.winningOwner
          ? `Race ${raceNo} runner auction: pool ${money(a.poolCents)}, ${a.retainedPercent}% retained (${money(a.retainedCents)}), prize ${money(a.prizeCents)} to ${a.winningOwner.bidder} (bid ${money(a.winningOwner.cents)}).`
          : `Race ${raceNo} runner auction: pool ${money(a.poolCents)}, the winner was not bid for; the pool stays with the club.`,
      });
    }
    return {};
  });

  void resultHashOf(entry.seedHex, entry.results).then((hash) => {
    setState((s) => ({
      history: s.history.map((h) =>
        h.raceNo === raceNo && !h.void && h.at === entry.at ? { ...h, resultHash: hash } : h,
      ),
    }));
  });

  return { recorded };
}
