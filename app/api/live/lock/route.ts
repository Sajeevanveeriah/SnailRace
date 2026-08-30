import { NextResponse } from 'next/server';
import { lockRace } from '@/lib/live/store';
import { operatorKeyOf, parseLiveShow, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Acknowledged market lock. The race plan hash is bound to the room before
 * the stage is allowed to start countdown.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const show = parseLiveShow(body.show);
  if (
    typeof body.code !== 'string' ||
    !/^[A-Za-z2-9]{6}$/.test(body.code) ||
    !Number.isSafeInteger(body.raceNo) ||
    !show ||
    typeof body.planHash !== 'string' ||
    !/^[A-Fa-f0-9]{64}$/.test(body.planHash)
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed lock request.' }, { status: 400 });
  }

  const expected = body.expectedShowRevision;
  if (!Number.isSafeInteger(expected) || Number(expected) < 1) {
    return NextResponse.json({ ok: false, error: 'Malformed show revision.' }, { status: 400 });
  }

  const result = await lockRace(
    body.code.toUpperCase(),
    operatorKeyOf(request),
    Number(body.raceNo),
    show,
    body.planHash.toLowerCase(),
    body.commandId,
    Number(expected),
  );
  return respond(result);
}
