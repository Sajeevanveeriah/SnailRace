import { NextResponse } from 'next/server';
import { getStripe, META, APP_TAG } from '@/lib/stripe';
import { MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '@/lib/money';
import { MAX_FIELD } from '@/lib/palette';
import { checkOrigin } from '@/lib/server-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutBody {
  commandId?: string;
  eventId?: string;
  raceNo?: number;
  lane?: number;
  snailName?: string;
  backerName?: string;
  cents?: number;
}

const MAX_CHECKOUT_BODY_BYTES = 4096;

const checkoutError = (error: string, status: number): NextResponse =>
  NextResponse.json(
    { ok: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

async function readCheckoutBody(request: Request): Promise<CheckoutBody | NextResponse> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return checkoutError('Content-Type must be application/json.', 415);
  }
  const statedLength = request.headers.get('content-length');
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isSafeInteger(length) || length < 0) return checkoutError('Invalid request length.', 400);
    if (length > MAX_CHECKOUT_BODY_BYTES) return checkoutError('Request too large.', 413);
  }
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_CHECKOUT_BODY_BYTES) return checkoutError('Request too large.', 413);
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return checkoutError('Malformed request.', 400);
    }
    return parsed as CheckoutBody;
  } catch {
    return checkoutError('Malformed request.', 400);
  }
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
  /*
   * Cross-origin POSTs are refused before anything is created: the return
   * URLs on a Checkout Session must never be steered by a foreign page.
   */
  const originCheck = checkOrigin(request);
  if (!originCheck.ok) {
    return checkoutError('A valid same-origin browser request is required.', 403);
  }

  const stripe = getStripe();
  if (!stripe) {
    return checkoutError(
      'Card donations are not switched on yet. Set STRIPE_SECRET_KEY in the deployment environment.',
      503,
    );
  }

  const body = await readCheckoutBody(request);
  if (body instanceof NextResponse) return body;

  const cents = body.cents;
  if (
    typeof cents !== 'number' ||
    !Number.isSafeInteger(cents) ||
    cents < MIN_DONATION_CENTS ||
    cents > MAX_DONATION_CENTS
  ) {
    return checkoutError(
      `Enter an amount between $${MIN_DONATION_CENTS / 100} and $${(
        MAX_DONATION_CENTS / 100
      ).toLocaleString('en-AU')}.`,
      400,
    );
  }

  const lane = body.lane;
  if (typeof lane !== 'number' || !Number.isSafeInteger(lane) || lane < 0 || lane >= MAX_FIELD) {
    return checkoutError('Pick a snail to back.', 400);
  }

  if (typeof body.commandId !== 'string' || !/^[A-Za-z0-9:_-]{16,128}$/.test(body.commandId)) {
    return checkoutError('A stable checkout command ID is required.', 400);
  }
  if (typeof body.eventId !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(body.eventId)) {
    return checkoutError('Malformed event ID.', 400);
  }
  if (
    typeof body.raceNo !== 'number' ||
    !Number.isSafeInteger(body.raceNo) ||
    body.raceNo < 1 ||
    body.raceNo > 10_000
  ) {
    return checkoutError('Malformed race number.', 400);
  }
  if (typeof body.snailName !== 'string' || !clean(body.snailName, 40)) {
    return checkoutError('Malformed snail name.', 400);
  }
  if (body.backerName !== undefined && typeof body.backerName !== 'string') {
    return checkoutError('Malformed backer name.', 400);
  }

  const eventId = body.eventId;
  const raceNo = body.raceNo;
  const snailName = clean(body.snailName, 40);
  const backerName = clean(body.backerName, 40);

  const origin = originCheck.origin;

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
    }, {
      idempotencyKey: `snailrace-checkout:${eventId}:${body.commandId}`,
    });

    return NextResponse.json(
      { ok: true, url: session.url, id: session.id },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return checkoutError('The payment service could not start checkout. Try again safely.', 502);
  }
}
