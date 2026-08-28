'use client';

import { addAudit, setState } from './event-store';
import { settleBets } from './tote';
import { resultHashOf } from './audit';
import { CHIP_START } from './money';
import type { RaceHistoryEntry, RaceResult } from './types';

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
        { ...entry, chipBankBefore: { ...s.chipBank }, streaksBefore: { ...s.streaks } },
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

  void resultHashOf(entry.seedHex, entry.results).then((hash) => {
    setState((s) => ({
      history: s.history.map((h) =>
        h.raceNo === raceNo && !h.void && h.at === entry.at ? { ...h, resultHash: hash } : h,
      ),
    }));
  });

  return { recorded };
}
