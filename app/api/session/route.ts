import { NextResponse } from 'next/server';
import { getStripe, META, APP_TAG } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read back one Checkout Session so the thank-you screen can name the snail
 * and the amount rather than guessing from the URL it was handed.
 *
 * Only sessions this app created are returned, and only the four fields the
 * page actually prints. A session id is not a secret, but it is also not a
 * licence to read a stranger's customer record.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id.startsWith('cs_')) {
    return NextResponse.json({ ok: false, error: 'Unknown session.' }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ ok: false, error: 'Stripe is not configured.' }, { status: 503 });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    if (session.metadata?.app !== APP_TAG) {
      return NextResponse.json({ ok: false, error: 'Unknown session.' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      paid: session.payment_status === 'paid',
      cents: session.amount_total ?? 0,
      snailName: session.metadata?.[META.snailName] ?? '',
      raceNo: Number(session.metadata?.[META.raceNo]) || 1,
      backerName: session.metadata?.[META.backerName] ?? '',
      /* Direct QR donations back the club, not a snail in a race. */
      direct: session.metadata?.[META.lane] === '-1',
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unknown session.' }, { status: 404 });
  }
}
