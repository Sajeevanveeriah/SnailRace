'use client';

import { useMemo, useState } from 'react';
import { laneColour } from '@/lib/palette';
import { CHIP_START } from '@/lib/money';
import { sfx } from '@/lib/sound';
import type { LanePool } from '@/lib/tote';
import type { Bet } from '@/lib/types';

const STAKES = [10, 25, 50, 100];

/**
 * The fun board.
 *
 * This is play money and nothing else. Chips cost nothing, cannot be bought,
 * and never pay out anything but bragging rights - the real money in this app
 * is a donation to the club with no return attached, which is what keeps the
 * night a fundraiser rather than a wagering service.
 *
 * The odds a bet locks in are the tote price at the moment it was placed, so
 * a punter who backs an unfancied snail early keeps the long price even after
 * the room piles in behind it.
 */
export function BetSlip({
  lanes,
  raceNo,
  bets,
  chipBank,
  streaks,
  open,
  onPlace,
}: {
  lanes: LanePool[];
  raceNo: number;
  bets: Bet[];
  chipBank: Record<string, number>;
  streaks: Record<string, number>;
  open: boolean;
  onPlace: (bet: Omit<Bet, 'id' | 'settled'>) => void;
}) {
  const [punter, setPunter] = useState('');
  const [lane, setLane] = useState<number | null>(null);
  const [stake, setStake] = useState(25);
  const [error, setError] = useState('');

  const key = punter.trim().toLowerCase();
  const bank = key ? (chipBank[key] ?? CHIP_START) : CHIP_START;

  const myOpen = useMemo(
    () => bets.filter((b) => b.raceNo === raceNo && !b.settled),
    [bets, raceNo],
  );

  const streak = key ? (streaks[key] ?? 0) : 0;

  const leaderboard = useMemo(() => {
    const rows = Object.entries(chipBank).map(([k, chips]) => ({
      key: k,
      chips,
      streak: streaks[k] ?? 0,
    }));
    rows.sort((a, b) => b.chips - a.chips);
    return rows.slice(0, 5);
  }, [chipBank, streaks]);

  const place = () => {
    if (!open) {
      setError('Betting is closed for this race.');
      return;
    }
    if (!punter.trim()) {
      setError('Add a name so the chips land somewhere.');
      return;
    }
    if (lane === null) {
      setError('Pick a snail first.');
      return;
    }
    if (stake > bank) {
      setError(`That is more than your ${bank} chips.`);
      return;
    }

    const pool = lanes.find((l) => l.lane === lane);
    onPlace({
      raceNo,
      lane,
      snailName: pool?.name ?? `Lane ${lane + 1}`,
      punter: punter.trim(),
      chips: stake,
      odds: pool?.odds ?? lanes.length,
    });
    sfx.chip();
    setError('');
    setLane(null);
  };

  return (
    <section className="glass glass-strong p-5 sm:p-6 flex flex-col gap-4" aria-label="Fun bets">
      <p className="fun-chip-banner" role="note">
        FUN CHIPS - NO MONETARY VALUE
      </p>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Fun bets</h2>
        <span className="flex items-center gap-2">
          {streak >= 2 ? (
            <span className="rounded-full bg-(--bad)/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-(--bad)">
              {streak} in a row
            </span>
          ) : null}
          <span className="num rounded-full bg-(--gold)/15 px-3 py-1 text-xs font-bold text-(--gold)">
            {bank.toLocaleString('en-AU')} chips
          </span>
        </span>
      </div>

      <p className="text-[11px] leading-snug text-(--tx)/45">
        Play chips only. Free to enter, nothing to buy, no cash payout - the leaderboard is the
        prize. Win two races running and every extra win pays a streak bonus.
      </p>

      <label className="fld">
        <span>Your name</span>
        <input
          type="text"
          value={punter}
          maxLength={24}
          placeholder="e.g. Dave S."
          onChange={(e) => setPunter(e.target.value)}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        {lanes.map((l) => {
          const c = laneColour(l.lane);
          const picked = lane === l.lane;
          return (
            <button
              key={l.lane}
              type="button"
              aria-pressed={picked}
              onClick={() => setLane(picked ? null : l.lane)}
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-transform duration-300 hover:-translate-y-0.5"
              style={{
                borderColor: picked ? c.shell : 'var(--hairline-strong)',
                background: picked ? `${c.shell}22` : 'color-mix(in srgb, var(--tx) 4%, transparent)',
              }}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: c.shell }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{l.name}</span>
              <span className="num text-[11px] text-(--gold)">{l.odds.toFixed(2)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {STAKES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={stake === s}
            onClick={() => setStake(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold transition-transform duration-300 hover:-translate-y-0.5 ${
              stake === s ? 'bg-(--tx) text-(--bg)' : 'bg-(--tx)/10 text-(--tx)/80'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-primary w-full" onClick={place} disabled={!open}>
        {open ? `Back for ${stake} chips` : 'Betting closed'}
      </button>

      {error ? (
        <p role="alert" className="text-xs font-medium text-(--bad)">
          {error}
        </p>
      ) : null}

      {myOpen.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {myOpen.slice(-4).map((b) => (
            <li
              key={b.id}
              className="slide-in flex items-center gap-2 rounded-lg bg-(--tx)/5 px-3 py-1.5 text-xs"
            >
              <span className="truncate font-semibold">{b.punter}</span>
              <span className="truncate text-(--tx)/55">on {b.snailName}</span>
              <span className="num ml-auto text-(--gold)">
                {b.chips} @ {b.odds.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {leaderboard.length > 0 ? (
        <div className="border-t border-(--tx)/10 pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-(--tx)/45">
            Chip leaders <span className="fun-chip-tag">fun chips - no monetary value</span>
          </p>
          <ol className="flex flex-col gap-1">
            {leaderboard.map((row, i) => (
              <li key={row.key} className="flex items-center gap-2 text-xs">
                <span className="num w-4 text-(--tx)/40">{i + 1}</span>
                <span className="truncate capitalize">{row.key}</span>
                {row.streak >= 2 ? (
                  <span
                    className="num shrink-0 text-[10px] font-bold text-(--bad)"
                    title={`${row.streak} winning races in a row`}
                  >
                    x{row.streak}
                  </span>
                ) : null}
                <span className="num ml-auto font-semibold">
                  {row.chips.toLocaleString('en-AU')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
