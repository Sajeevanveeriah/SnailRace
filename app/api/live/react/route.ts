import { NextResponse } from 'next/server';
import { react } from '@/lib/live/store';
import { readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Crowd reactions: atmosphere only, rate-limited per player server-side. */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  if (
    typeof body.code !== 'string' ||
    !/^[A-Za-z2-9]{6}$/.test(body.code) ||
    typeof body.playerId !== 'string' ||
    body.playerId.length > 64 ||
    typeof body.token !== 'string' ||
    body.token.length > 128 ||
    typeof body.kind !== 'string' ||
    body.kind.length > 16
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed reaction request.' }, { status: 400 });
  }

  const result = await react(
    body.code.toUpperCase(),
    body.playerId,
    body.token,
    body.kind,
  );
  return respond(result);
}
