import { NextResponse } from 'next/server';
import { getStripe, META, APP_TAG } from '@/lib/stripe';
import { MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '@/lib/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutBody {
  eventId?: string;
  raceNo?: number;
  lane?: number;
  snailName?: string;
  backerName?: string;
  cents?: number;
}

/**
 * Strip control characters, which are the only thing here that can corrupt a
 * receipt line or a CSV cell. Spaces, punctuation and accents are left alone
 * because they are ordinary parts of a person's name.
 */
const clean = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);

export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Card donations are not switched on yet. Set STRIPE_SECRET_KEY in the deployment environment.',
      },
      { status: 503 },
    );
  }

  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 });
  }

  const cents = Math.round(Number(body.cents));
  if (!Number.isFinite(cents) || cents < MIN_DONATION_CENTS || cents > MAX_DONATION_CENTS) {
    return NextResponse.json(
      {
        ok: false,
        error: `Enter an amount between $${MIN_DONATION_CENTS / 100} and $${(
          MAX_DONATION_CENTS / 100
        ).toLocaleString('en-AU')}.`,
      },
      { status: 400 },
    );
  }

  const lane = Math.round(Number(body.lane));
  if (!Number.isInteger(lane) || lane < 0 || lane > 11) {
    return NextResponse.json({ ok: false, error: 'Pick a snail to back.' }, { status: 400 });
  }

  const eventId = clean(body.eventId, 40) || 'unknown';
  const raceNo = Math.max(1, Math.round(Number(body.raceNo) || 1));
  const snailName = clean(body.snailName, 40) || `Lane ${lane + 1}`;
  const backerName = clean(body.backerName, 40);

  const origin =
    request.headers.get('origin') ??
    (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      /*
       * Stripe emails the receipt only when it has somewhere to send it, and
       * a club needs the address for its own thank-you list, so the field is
       * required rather than optional.
       */
      customer_creation: 'always',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            unit_amount: cents,
            product_data: {
              name: `Backing ${snailName} - Race ${raceNo}`,
              description:
                'Donation to the Newcomb & District Cricket Club. Every snail has an equal chance; donations never influence the result and are not a wager.',
            },
          },
        },
      ],
      metadata: {
        app: APP_TAG,
        [META.eventId]: eventId,
        [META.raceNo]: String(raceNo),
        [META.lane]: String(lane),
        [META.snailName]: snailName,
        [META.backerName]: backerName,
      },
      payment_intent_data: {
        description: `Snail Race Fundraiser - Race ${raceNo} - ${snailName}`,
        metadata: {
          app: APP_TAG,
          [META.eventId]: eventId,
          [META.raceNo]: String(raceNo),
          [META.lane]: String(lane),
          [META.snailName]: snailName,
          [META.backerName]: backerName,
        },
      },
      success_url: `${origin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/donate?cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    return NextResponse.json({ ok: true, url: session.url, id: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stripe rejected the request.';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
