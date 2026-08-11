import { NextResponse } from 'next/server';
import { getStripe, META } from '@/lib/stripe';
import { bustCache } from '@/lib/donation-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The webhook is an accelerator, not the source of truth.
 *
 * `/api/donations` reads Stripe directly, so the board is correct even if
 * this endpoint is never configured. What the webhook buys is latency: when
 * a payment completes it drops the cached snapshot for that event so the very
 * next poll goes back to Stripe instead of serving a stale two seconds.
 *
 * On serverless the cache is per-instance, so this is best-effort by nature.
 * That is acceptable precisely because nothing depends on it.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !secret) {
    return NextResponse.json(
      { ok: false, error: 'Webhook is not configured.' },
      { status: 503 },
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ ok: false, error: 'Missing signature.' }, { status: 400 });
  }

  const raw = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signature check failed.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'charge.refunded': {
      const object = event.data.object as { metadata?: Record<string, string> };
      bustCache(object.metadata?.[META.eventId]);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ ok: true, received: event.type });
}
