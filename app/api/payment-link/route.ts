import { NextResponse } from 'next/server';
import { getStripe, META, APP_TAG } from '@/lib/stripe';
import { MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '@/lib/money';
import { checkOrigin } from '@/lib/server-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A reusable Stripe Payment Link for "scan and pay" donations.
 *
 * The lineup QR sends a phone to the donate page, where the donor picks a
 * snail. This link is the shorter road: the QR on the stage points straight
 * at Stripe's own checkout, the donor types an amount and pays. No page of
 * ours in between, which is exactly what a queue at the bar wants.
 *
 * These donations belong to no lane and no race, so they are recorded with
 * lane -1 and race 0: the tote and the race pots never see them, but the
 * night's total and the ledger do. Metadata set on a Payment Link is copied
 * by Stripe onto every Checkout Session it creates, which is how the
 * donations feed recognises them with no extra plumbing.
 *
 * One link per event is plenty. The cache is per server instance; a cold
 * start simply mints another link with identical metadata, which reconciles
 * identically.
 */
const linkCache = new Map<string, { id: string; url: string }>();

export async function POST(request: Request) {
  /* Same boundary as /api/checkout: a foreign page cannot mint links whose
     completion redirect it controls. */
  const originCheck = checkOrigin(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not accepted.' }, { status: 403 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { ok: false, error: 'Stripe is not configured, so direct QR payments are off.' },
      { status: 503 },
    );
  }

  let eventId = '';
  try {
    const body = (await request.json()) as { eventId?: string };
    eventId = String(body.eventId ?? '')
      .replace(/[^\w-]/g, '')
      .slice(0, 40);
  } catch {
    /* fall through to the validation below */
  }
  if (!eventId) {
    return NextResponse.json({ ok: false, error: 'eventId is required.' }, { status: 400 });
  }

  const cached = linkCache.get(eventId);
  if (cached) {
    return NextResponse.json({ ok: true, url: cached.url, id: cached.id });
  }

  const origin = originCheck.origin;

  try {
    const price = await stripe.prices.create({
      currency: 'aud',
      custom_unit_amount: {
        enabled: true,
        minimum: MIN_DONATION_CENTS,
        maximum: MAX_DONATION_CENTS,
        preset: 1000,
      },
      product_data: {
        name: 'Snail Race Fundraiser - direct donation',
      },
    });

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      submit_type: 'donate',
      metadata: {
        app: APP_TAG,
        [META.eventId]: eventId,
        [META.raceNo]: '0',
        [META.lane]: '-1',
        [META.snailName]: 'Direct donation',
        [META.backerName]: '',
      },
      after_completion: {
        type: 'redirect',
        redirect: { url: `${origin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}` },
      },
    });

    linkCache.set(eventId, { id: link.id, url: link.url });
    return NextResponse.json({ ok: true, url: link.url, id: link.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stripe rejected the request.';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
