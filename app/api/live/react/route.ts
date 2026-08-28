import { NextResponse } from 'next/server';
import { react } from '@/lib/live/store';
import { readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Crowd reactions: atmosphere only, rate-limited per player server-side. */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const result = await react(
    String(body.code ?? '').toUpperCase(),
    body.playerId,
    body.token,
    String(body.kind ?? ''),
  );
  return respond(result);
}
