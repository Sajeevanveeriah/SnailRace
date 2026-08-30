import { NextResponse } from 'next/server';
import { endSession } from '@/lib/live/store';
import { operatorKeyOf, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The stage closes the room. Operator key required; from then on every
 * phone's poll answers 410 and the phones say so honestly, rather than
 * polling a room the projector has abandoned.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  if (
    typeof body.code !== 'string' ||
    !/^[A-Za-z2-9]{6}$/.test(body.code) ||
    typeof body.commandId !== 'string' ||
    !/^[A-Za-z0-9:_-]{8,128}$/.test(body.commandId)
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed end request.' }, { status: 400 });
  }

  const result = await endSession(
    body.code.toUpperCase(),
    operatorKeyOf(request),
    body.commandId,
  );
  return respond(result);
}
