'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Snail } from './Snail';
import { money } from '@/lib/money';

interface SessionSummary {
  ok: boolean;
  paid: boolean;
  cents: number;
  snailName: string;
  raceNo: number;
  backerName: string;
}

/**
 * The screen someone is looking at while their snail is on the board.
 *
 * It reads the session back from Stripe rather than trusting the URL, so the
 * amount and the snail it names are the ones that were actually charged.
 */
export function ThanksCard() {
  const id = useSearchParams().get('session_id');
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [failed, setFailed] = useState(false);

  /* No session id at all is a render-time fact, not something to discover
     inside an effect. */
  const missing = !id;

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const body = (await res.json()) as SessionSummary;
        if (cancel) return;
        if (body.ok) setSummary(body);
        else setFailed(true);
      } catch {
        if (!cancel) setFailed(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  return (
    <main className="sheet grid min-h-dvh place-items-center p-6">
      <div className="card reveal w-full max-w-sm p-8 text-center">
        <div className="mx-auto w-28">
          <Snail />
        </div>

        <h1 className="display mt-5 text-4xl text-black">Thank you.</h1>

        {summary ? (
          <>
            <p className="mt-4 text-[15px] leading-relaxed text-black/65">
              {summary.paid ? 'Your donation of ' : 'Your payment of '}
              <span className="num font-semibold text-black">{money(summary.cents)}</span> is
              backing <span className="font-semibold text-black">{summary.snailName}</span> in race{' '}
              {summary.raceNo}.
            </p>
            <p className="mt-3 text-sm text-black/50">
              Watch the big screen. {summary.backerName || 'Your name'} goes up on the board if
              your snail gets home first.
            </p>
            {!summary.paid ? (
              <p className="mt-4 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
                Stripe has not confirmed this payment yet. It will appear on the board as soon as
                it clears.
              </p>
            ) : null}
          </>
        ) : failed || missing ? (
          <p className="mt-4 text-[15px] leading-relaxed text-black/65">
            Your donation went through. We could not load the receipt details on this screen, but
            Stripe has emailed you a copy.
          </p>
        ) : (
          <p className="mt-4 text-[15px] text-black/50">Confirming with Stripe...</p>
        )}

        <p className="mt-8 text-[11px] leading-relaxed text-black/40">
          A receipt has been emailed to you by Stripe. Every snail has the same chance and the
          finishing order was drawn before the race began.
        </p>
      </div>
    </main>
  );
}
