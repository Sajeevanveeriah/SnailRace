import { NextResponse } from 'next/server';
import { getStripe, META } from '@/lib/stripe';
import { bustCache } from '@/lib/donation-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_WEBHOOK_BODY_BYTES = 128 * 1024;

const webhookError = (error: string, status: number): NextResponse =>
  NextResponse.json(
    { ok: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

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
    return webhookError('Webhook is not configured.', 503);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return webhookError('Missing signature.', 400);
  }

  const statedLength = request.headers.get('content-length');
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isSafeInteger(length) || length < 0) return webhookError('Invalid request length.', 400);
    if (length > MAX_WEBHOOK_BODY_BYTES) return webhookError('Request too large.', 413);
  }

  let raw: Buffer;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_WEBHOOK_BODY_BYTES) return webhookError('Request too large.', 413);
    raw = Buffer.from(bytes);
  } catch {
    return webhookError('Malformed request.', 400);
  }

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch {
    return webhookError('Signature check failed.', 400);
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'charge.refunded': {
      const object = event.data.object as { metadata?: Record<string, string> };
      bustCache(object.metadata?.[META.eventId]);
      break;
    }
    default:
      break;
  }

  return NextResponse.json(
    { ok: true, received: event.type },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
