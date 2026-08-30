import { NextResponse } from 'next/server';
import { operatorSummary } from '@/lib/live/store';
import { operatorKeyOf, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The stage's view of the room: pick totals, reactions, leaderboard. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = Number(url.searchParams.get('since') ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) {
    return NextResponse.json({ ok: false, error: 'Malformed reaction cursor.' }, { status: 400 });
  }
  const result = await operatorSummary(
    (url.searchParams.get('code') ?? '').toUpperCase(),
    operatorKeyOf(request),
    since,
  );
  return respond(result);
}
