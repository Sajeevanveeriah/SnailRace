import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, META, stripeMode } from '@/lib/stripe';
import { toDonation } from '@/lib/stripe-read';
import { readCache, writeCache } from '@/lib/donation-cache';
import type { Donation, DonationsResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How far back the board looks. One club night, generously. */
const WINDOW_HOURS = 18;
/** Sessions fetched per page, and how many pages we are willing to walk. */
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = (url.searchParams.get('eventId') || '').slice(0, 40);

  const stripe = getStripe();
  if (!stripe) {
    const body: DonationsResponse = {
      ok: true,
      configured: false,
      donations: [],
      at: Date.now(),
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (!eventId) {
    return NextResponse.json(
      { ok: false, configured: true, donations: [], at: Date.now(), error: 'eventId is required.' },
      { status: 400 },
    );
  }

  const hit = readCache(eventId);
  if (hit) {
    const body: DonationsResponse = {
      ok: true,
      configured: true,
      mode: stripeMode() ?? undefined,
      donations: hit.donations,
      at: hit.at,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const since = Math.floor((Date.now() - WINDOW_HOURS * 3600_000) / 1000);
    const donations: Donation[] = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const list: Stripe.ApiList<Stripe.Checkout.Session> = await stripe.checkout.sessions.list({
        limit: PAGE_SIZE,
        created: { gte: since },
        /* The charge is where a refund lives, and a board that cannot see
           refunds cannot be reconciled against the bank. */
        expand: ['data.payment_intent.latest_charge'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const session of list.data) {
        const donation = toDonation(session);
        if (donation && session.metadata?.[META.eventId] === eventId) donations.push(donation);
      }

      if (!list.has_more || list.data.length === 0) break;
      startingAfter = list.data[list.data.length - 1].id;
    }

    donations.sort((a, b) => b.createdAt - a.createdAt);
    const at = writeCache(eventId, donations);

    const body: DonationsResponse = {
      ok: true,
      configured: true,
      mode: stripeMode() ?? undefined,
      donations,
      at,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reach Stripe.';
    /*
     * A failed poll must never blank a board that is already showing money.
     * The stage keeps its last good snapshot and shows the offline pill, so
     * `donations` here is empty by design rather than authoritative.
     */
    const body: DonationsResponse = {
      ok: false,
      configured: true,
      donations: [],
      at: Date.now(),
      error: message,
    };
    return NextResponse.json(body, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
