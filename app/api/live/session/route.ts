import { NextResponse } from 'next/server';
import { createSession } from '@/lib/live/store';
import { parseLiveShow, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The stage device opens a Phone Play session. The operator key returned
 * here is the only credential that can push show state or settle - it stays
 * on the stage device and never appears in a QR code or a player payload.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const show = parseLiveShow(body.show);
  if (!show) {
    return NextResponse.json({ ok: false, error: 'Malformed show state.' }, { status: 400 });
  }
  const pin = typeof body.pin === 'string' && body.pin.trim() ? body.pin.trim() : undefined;
  if (pin && !/^\d{4,12}$/.test(pin)) {
    return NextResponse.json({ ok: false, error: 'The optional PIN must be 4 to 12 digits.' }, { status: 400 });
  }
  const created = await createSession(show, pin);
  return respond({ ok: true, ...created });
}
