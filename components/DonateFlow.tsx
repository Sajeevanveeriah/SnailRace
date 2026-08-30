'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Snail } from './Snail';
import { ThemeToggle } from './ThemeToggle';
import { decodeLineup } from '@/lib/lineup';
import { laneColour } from '@/lib/palette';
import { money, parseAmountToCents, MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '@/lib/money';
import { HAS_API } from '@/lib/deployment';
import { checkoutCommandFor, type PendingCheckoutCommand } from '@/lib/checkout-command';

const PRESETS = [500, 1000, 2000, 5000];

/**
 * The donor's phone.
 *
 * Everything this page knows about the race comes out of the QR code it was
 * opened from. Donations are deliberately not read back as a pool or price:
 * choosing a snail is a dedication attached to a gift, never a wager.
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
  const pendingCheckoutRef = useRef<PendingCheckoutCommand | null>(null);

  const names = useMemo(() => lineup?.n ?? [], [lineup]);
  const raceNo = lineup?.r ?? 1;

  const cents = custom.trim() ? parseAmountToCents(custom) : preset;

  const checkoutFingerprint = JSON.stringify({
    eventId: lineup?.e ?? '',
    raceNo,
    lane,
    snailName: lane === null ? '' : (names[lane] ?? ''),
    backerName: name.trim(),
    cents,
  });

  /* A retry of the same logical donation reuses its command ID. Any material
     input change begins a new logical checkout and therefore clears it. */
  useEffect(() => {
    if (
      pendingCheckoutRef.current &&
      pendingCheckoutRef.current.fingerprint !== checkoutFingerprint
    ) {
      pendingCheckoutRef.current = null;
    }
  }, [checkoutFingerprint]);

  const submit = async () => {
    setError('');
    if (!HAS_API) {
      setError('Card donations are unavailable on this demonstration site. Please donate at the event desk.');
      return;
    }
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
      const pending = checkoutCommandFor(pendingCheckoutRef.current, checkoutFingerprint);
      pendingCheckoutRef.current = pending;
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
          commandId: pending.commandId,
        }),
      });
      const body = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!body.ok || !body.url) {
        setError(body.error ?? 'Could not start the payment. Please try again.');
        setBusy(false);
        return;
      }
      pendingCheckoutRef.current = null;
      window.location.href = body.url;
    } catch {
      setError('Could not reach the payment page. Check your connection and try again.');
      setBusy(false);
    }
  };

  if (!lineup) {
    return (
      <main className="sheet grid min-h-dvh place-items-center p-6">
        <div className="fixed right-4 top-4 z-30">
          <ThemeToggle />
        </div>
        <div className="card reveal max-w-sm p-8 text-center">
          <div className="mx-auto w-24">
            <Snail />
          </div>
          <h1 className="display mt-4 text-3xl">Scan the code</h1>
          <p className="mt-3 text-sm text-(--tx)/60">
            This page needs the QR code on the big screen, which tells it which snails are in the
            next race. Point your camera at the screen and try again.
          </p>
        </div>
      </main>
    );
  }

  if (!HAS_API) {
    return (
      <main className="sheet grid min-h-dvh place-items-center p-6">
        <div className="fixed right-4 top-4 z-30">
          <ThemeToggle />
        </div>
        <section className="card reveal max-w-md p-8 text-center" aria-labelledby="static-donation-title">
          <div className="mx-auto w-24">
            <Snail />
          </div>
          <h1 id="static-donation-title" className="display mt-4 text-3xl">
            Donate at the event desk
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-(--tx)/60">
            Card donations are not available on this demonstration site. No payment request has
            been sent. Please use the club&apos;s event desk or the official live-event link provided by
            the organiser.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="sheet min-h-dvh pb-40">
      <div className="mx-auto max-w-md px-5 pt-10">
        <header className="reveal">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-(--tx)/45">
              {lineup.c}
            </p>
            <ThemeToggle />
          </div>
          <h1 className="display mt-2 text-[2.6rem] text-(--tx)">Back a snail.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-(--tx)/60">
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
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-(--tx)/45">
            1. Choose your snail
          </h2>
          <div className="flex flex-col gap-2.5">
            {names.map((n, i) => {
              const c = laneColour(i);
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
                    <span className="block truncate font-semibold text-(--tx)">{n}</span>
                    <span className="block text-xs text-(--tx)/50">
                      Lane {i + 1} - donation dedication only
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
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-(--tx)/45">
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
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-(--tx)/45">
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

        <p className="mt-8 text-[11px] leading-relaxed text-(--tx)/45">
          This is a donation to {lineup.c}, not a wager. There is no cash prize and no return -
          backing a snail simply puts your name on the board. Payments are handled by Stripe; card
          details never touch this page.
        </p>
      </div>

      {/* Thumb-reachable action bar, the one control that never scrolls away. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-(--tx)/10 bg-(--card)/85 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl">
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
          <p className="mt-2 text-center text-[11px] text-(--tx)/40">
            Secure payment by Stripe - Apple Pay and Google Pay supported
          </p>
        </div>
      </div>
    </main>
  );
}
