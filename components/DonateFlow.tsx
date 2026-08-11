'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Snail } from './Snail';
import { decodeLineup } from '@/lib/lineup';
import { laneColour } from '@/lib/palette';
import { money, parseAmountToCents, MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '@/lib/money';
import { poolsFor } from '@/lib/tote';
import type { Donation, DonationsResponse } from '@/lib/types';

const PRESETS = [500, 1000, 2000, 5000];

/**
 * The donor's phone.
 *
 * Everything this page knows about the race comes out of the QR code it was
 * opened from, so it works with no database call and no shared session. It
 * still reads the tote so a punter can see where the room's money is going
 * before choosing, but that read is decorative: the page is fully usable if
 * the fetch fails.
 */
export function DonateFlow() {
  const params = useSearchParams();
  const lineup = useMemo(() => decodeLineup(params.get('e')), [params]);
  const cancelled = params.get('cancelled') === '1';

  const [lane, setLane] = useState<number | null>(null);
  const [preset, setPreset] = useState<number | null>(1000);
  const [custom, setCustom] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [donations, setDonations] = useState<Donation[]>([]);

  const names = useMemo(() => lineup?.n ?? [], [lineup]);
  const raceNo = lineup?.r ?? 1;

  useEffect(() => {
    if (!lineup?.e) return;
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch(`/api/donations?eventId=${encodeURIComponent(lineup.e)}`, {
          cache: 'no-store',
        });
        const body = (await res.json()) as DonationsResponse;
        if (!cancel && body.ok) setDonations(body.donations);
      } catch {
        /* The tote is a nicety. Donating does not depend on it. */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [lineup?.e]);

  const { lanes } = useMemo(
    () => poolsFor(donations, names, raceNo),
    [donations, names, raceNo],
  );

  const cents = custom.trim() ? parseAmountToCents(custom) : preset;

  const submit = async () => {
    setError('');
    if (lane === null) {
      setError('Pick a snail to back.');
      return;
    }
    if (cents === null || cents < MIN_DONATION_CENTS || cents > MAX_DONATION_CENTS) {
      setError(
        `Enter an amount between ${money(MIN_DONATION_CENTS)} and ${money(MAX_DONATION_CENTS)}.`,
      );
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: lineup?.e,
          raceNo,
          lane,
          snailName: names[lane],
          backerName: name.trim(),
          cents,
        }),
      });
      const body = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!body.ok || !body.url) {
        setError(body.error ?? 'Could not start the payment. Please try again.');
        setBusy(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not reach the payment page. Check your connection and try again.');
      setBusy(false);
    }
  };

  if (!lineup) {
    return (
      <main className="sheet grid min-h-dvh place-items-center p-6">
        <div className="card reveal max-w-sm p-8 text-center">
          <div className="mx-auto w-24">
            <Snail />
          </div>
          <h1 className="display mt-4 text-3xl">Scan the code</h1>
          <p className="mt-3 text-sm text-black/60">
            This page needs the QR code on the big screen, which tells it which snails are in the
            next race. Point your camera at the screen and try again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="sheet min-h-dvh pb-40">
      <div className="mx-auto max-w-md px-5 pt-10">
        <header className="reveal">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-black/45">
            {lineup.c}
          </p>
          <h1 className="display mt-2 text-[2.6rem] text-black">Back a snail.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-black/60">
            Race {raceNo}. Every dollar goes to the club. Your snail has exactly the same
            1-in-{names.length} chance as every other, and the finishing order is drawn before the
            race starts.
          </p>
        </header>

        {cancelled ? (
          <p className="reveal mt-5 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
            That payment was cancelled. Nothing was charged.
          </p>
        ) : null}

        <section className="reveal mt-8" style={{ '--d': '90ms' } as React.CSSProperties}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-black/45">
            1. Choose your snail
          </h2>
          <div className="flex flex-col gap-2.5">
            {names.map((n, i) => {
              const c = laneColour(i);
              const pool = lanes[i];
              const picked = lane === i;
              return (
                <button
                  key={i}
                  type="button"
                  className="pick"
                  aria-pressed={picked}
                  onClick={() => setLane(picked ? null : i)}
                  style={
                    {
                      '--shell': c.shell,
                      '--shell-dk': c.dark,
                      '--body': c.body,
                      '--glow': c.glow,
                    } as React.CSSProperties
                  }
                >
                  <span className="w-14 shrink-0">
                    <Snail />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-black">{n}</span>
                    <span className="block text-xs text-black/50">
                      Lane {i + 1}
                      {pool && pool.cents > 0
                        ? ` - ${money(pool.cents)} backed by ${pool.backers}`
                        : ' - no backers yet'}
                    </span>
                  </span>
                  <span
                    className="tickmark grid h-7 w-7 shrink-0 place-items-center rounded-full text-white"
                    style={{ background: c.shell }}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12.5 9.5 18 20 6.5" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="reveal mt-8" style={{ '--d': '160ms' } as React.CSSProperties}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-black/45">
            2. Choose an amount
          </h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="chip-amount"
                aria-pressed={!custom.trim() && preset === p}
                onClick={() => {
                  setPreset(p);
                  setCustom('');
                }}
              >
                {money(p)}
              </button>
            ))}
          </div>
          <label className="fld mt-3">
            <span>Or another amount (AUD)</span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              step="0.5"
              placeholder="25.00"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
        </section>

        <section className="reveal mt-8" style={{ '--d': '230ms' } as React.CSSProperties}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-black/45">
            3. Your name (optional)
          </h2>
          <label className="fld">
            <span>Shown on the big screen if your snail wins</span>
            <input
              type="text"
              maxLength={40}
              placeholder="e.g. Dave S."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </section>

        <p className="mt-8 text-[11px] leading-relaxed text-black/45">
          This is a donation to {lineup.c}, not a wager. There is no cash prize and no return -
          backing a snail simply puts your name on the board. Payments are handled by Stripe; card
          details never touch this page.
        </p>
      </div>

      {/* Thumb-reachable action bar, the one control that never scrolls away. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white/85 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl">
        <div className="mx-auto max-w-md">
          {error ? (
            <p role="alert" className="mb-2 text-sm font-medium text-red-600">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-sheet w-full text-base"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy
              ? 'Opening secure checkout...'
              : lane === null
                ? 'Pick a snail to continue'
                : `Donate ${cents ? money(cents) : ''} to ${names[lane]}`}
          </button>
          <p className="mt-2 text-center text-[11px] text-black/40">
            Secure payment by Stripe - Apple Pay and Google Pay supported
          </p>
        </div>
      </div>
    </main>
  );
}
