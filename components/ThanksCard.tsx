'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Snail } from './Snail';
import { ThemeToggle } from './ThemeToggle';
import { money } from '@/lib/money';
import { HAS_API } from '@/lib/deployment';

interface SessionSummary {
  ok: boolean;
  paid: boolean;
  cents: number;
  snailName: string;
  raceNo: number;
  backerName: string;
  /** True for scan-and-pay donations that back the club rather than a snail. */
  direct?: boolean;
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
    if (!HAS_API || !id) return;
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
      <div className="fixed right-4 top-4 z-30">
        <ThemeToggle />
      </div>
      <div className="card reveal w-full max-w-sm p-8 text-center">
        <div className="mx-auto w-28">
          <Snail />
        </div>

        <h1 className="display mt-5 text-4xl text-(--tx)">Thank you.</h1>

        {!HAS_API ? (
          <p className="mt-4 text-[15px] leading-relaxed text-(--tx)/65">
            This demonstration site does not process card donations, so there is no payment to
            confirm here. Please use the official live-event link supplied by the organiser.
          </p>
        ) : summary ? (
          <>
            {summary.direct ? (
              <p className="mt-4 text-[15px] leading-relaxed text-(--tx)/65">
                {summary.paid ? 'Your donation of ' : 'Your payment of '}
                <span className="num font-semibold text-(--tx)">{money(summary.cents)}</span> goes
                straight to the club. It is already counted in tonight&apos;s total on the big
                screen.
              </p>
            ) : (
              <>
                <p className="mt-4 text-[15px] leading-relaxed text-(--tx)/65">
                  {summary.paid ? 'Your donation of ' : 'Your payment of '}
                  <span className="num font-semibold text-(--tx)">{money(summary.cents)}</span> is
                  backing <span className="font-semibold text-(--tx)">{summary.snailName}</span> in
                  race {summary.raceNo}.
                </p>
                <p className="mt-3 text-sm text-(--tx)/50">
                  Watch the big screen. {summary.backerName || 'Your name'} goes up on the board
                  if your snail gets home first.
                </p>
              </>
            )}
            {!summary.paid ? (
              <p className="mt-4 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
                Stripe has not confirmed this payment yet. It will appear on the board as soon as
                it clears.
              </p>
            ) : null}
          </>
        ) : failed || missing ? (
          <p className="mt-4 text-[15px] leading-relaxed text-(--tx)/65">
            Your donation went through. We could not load the receipt details on this screen, but
            Stripe has emailed you a copy.
          </p>
        ) : (
          <p className="mt-4 text-[15px] text-(--tx)/50">Confirming with Stripe...</p>
        )}

        {HAS_API ? (
          <p className="mt-8 text-[11px] leading-relaxed text-(--tx)/40">
            A receipt has been emailed to you by Stripe.
            {summary?.direct
              ? ' The donation goes to the club.'
              : ' Fun-chip picks and donations are separate; donations never influence the race.'}
          </p>
        ) : null}
      </div>
    </main>
  );
}
