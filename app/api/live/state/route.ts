import { NextResponse } from 'next/server';
import { playerState, updateShow, type LiveShow } from '@/lib/live/store';
import { readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The phone's poll: revisioned, cheap when nothing changed. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  const since = url.searchParams.get('since');
  const playerId = url.searchParams.get('playerId') ?? undefined;
  const token = url.searchParams.get('token') ?? undefined;
  const result = await playerState(
    code,
    playerId,
    token,
    since === null ? undefined : Number(since),
  );
  return respond(result);
}

/** The stage pushes the authoritative show snapshot. Operator key required. */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const show = body.show as LiveShow | undefined;
  if (!show || !Array.isArray(show.names) || typeof show.raceNo !== 'number') {
    return NextResponse.json({ ok: false, error: 'Malformed show state.' }, { status: 400 });
  }
  const result = await updateShow(String(body.code ?? '').toUpperCase(), body.operatorKey, show);
  return respond(result);
}
