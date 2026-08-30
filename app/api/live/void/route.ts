import { NextResponse } from 'next/server';
import { voidRace } from '@/lib/live/store';
import { operatorKeyOf, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Persist a void and refund held fun chips exactly once. */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  if (
    typeof body.code !== 'string' ||
    !/^[A-Za-z2-9]{6}$/.test(body.code) ||
    !Number.isSafeInteger(body.raceNo) ||
    typeof body.planHash !== 'string' ||
    !/^[A-Fa-f0-9]{64}$/.test(body.planHash) ||
    typeof body.reason !== 'string' ||
    !body.reason.trim() ||
    body.reason.length > 120
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed void request.' }, { status: 400 });
  }
  const expected = body.expectedShowRevision;
  if (!Number.isSafeInteger(expected) || Number(expected) < 1) {
    return NextResponse.json({ ok: false, error: 'Malformed show revision.' }, { status: 400 });
  }

  const result = await voidRace(
    body.code.toUpperCase(),
    operatorKeyOf(request),
    Number(body.raceNo),
    body.planHash.toLowerCase(),
    body.reason,
    body.commandId,
    Number(expected),
  );
  return respond(result);
}
