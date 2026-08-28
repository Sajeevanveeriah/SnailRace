import { NextResponse } from 'next/server';
import { createSession, type LiveShow } from '@/lib/live/store';
import { readBody, respond } from '../util';

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

  const show = body.show as LiveShow | undefined;
  if (
    !show ||
    typeof show.eventName !== 'string' ||
    !Array.isArray(show.names) ||
    show.names.length < 2 ||
    show.names.length > 20
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed show state.' }, { status: 400 });
  }
  const pin = typeof body.pin === 'string' && body.pin.trim() ? body.pin.trim().slice(0, 12) : undefined;
  const created = await createSession(show, pin);
  return respond({ ok: true, ...created });
}
