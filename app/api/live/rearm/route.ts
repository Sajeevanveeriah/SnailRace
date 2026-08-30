import { NextResponse } from 'next/server';
import { rearmRace } from '@/lib/live/store';
import { operatorKeyOf, parseLiveShow, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reopen a persisted VOID as a new attempt of the same race number. */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const show = parseLiveShow(body.show);
  if (
    typeof body.code !== 'string' ||
    !/^[A-Za-z2-9]{6}$/.test(body.code) ||
    !Number.isSafeInteger(body.raceNo) ||
    !show
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed rearm request.' }, { status: 400 });
  }
  const expected = body.expectedShowRevision;
  if (!Number.isSafeInteger(expected) || Number(expected) < 1) {
    return NextResponse.json({ ok: false, error: 'Malformed show revision.' }, { status: 400 });
  }

  const result = await rearmRace(
    body.code.toUpperCase(),
    operatorKeyOf(request),
    Number(body.raceNo),
    show,
    body.commandId,
    Number(expected),
  );
  return respond(result);
}
