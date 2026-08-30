import { NextResponse } from 'next/server';
import { settleRace } from '@/lib/live/store';
import { operatorKeyOf, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Settle the room's fun-chip picks for one race, exactly once. The server
 * holds the guard, so a stage that retries after a reload cannot pay twice.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  if (
    typeof body.code !== 'string' ||
    !/^[A-Za-z2-9]{6}$/.test(body.code) ||
    !Number.isSafeInteger(body.raceNo) ||
    !Number.isSafeInteger(body.winnerLane) ||
    typeof body.commandId !== 'string' ||
    !/^[A-Za-z0-9:_-]{8,128}$/.test(body.commandId)
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed settlement request.' }, { status: 400 });
  }

  const result = await settleRace(
    body.code.toUpperCase(),
    operatorKeyOf(request),
    Number(body.raceNo),
    Number(body.winnerLane),
    body.commandId,
  );
  return respond(result);
}
