import { NextResponse } from 'next/server';
import { settleRace } from '@/lib/live/store';
import { readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Settle the room's fun-chip picks for one race, exactly once. The server
 * holds the guard, so a stage that retries after a reload cannot pay twice.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const result = await settleRace(
    String(body.code ?? '').toUpperCase(),
    body.operatorKey,
    Number(body.raceNo),
    Number(body.winnerLane),
  );
  return respond(result);
}
