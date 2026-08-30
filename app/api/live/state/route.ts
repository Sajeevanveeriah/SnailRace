import { NextResponse } from 'next/server';
import { playerState, updateShow } from '@/lib/live/store';
import { operatorKeyOf, parseLiveShow, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The phone's poll: revisioned, cheap when nothing changed. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  const since = url.searchParams.get('since');
  const playerId = url.searchParams.get('playerId') ?? undefined;
  const token = operatorKeyOf(request) ?? undefined;
  const parsedSince = since === null ? undefined : Number(since);
  if (parsedSince !== undefined && (!Number.isSafeInteger(parsedSince) || parsedSince < 0)) {
    return NextResponse.json({ ok: false, error: 'Malformed revision.' }, { status: 400 });
  }
  const result = await playerState(
    code,
    playerId,
    token,
    parsedSince,
  );
  return respond(result);
}

/** The stage pushes the authoritative show snapshot. Operator key required. */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const show = parseLiveShow(body.show);
  if (!show || typeof body.commandId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(body.commandId)) {
    return NextResponse.json({ ok: false, error: 'Malformed show state.' }, { status: 400 });
  }
  const expected = body.expectedShowRevision;
  if (!Number.isSafeInteger(expected) || Number(expected) < 1) {
    return NextResponse.json({ ok: false, error: 'Malformed show revision.' }, { status: 400 });
  }
  const result = await updateShow(
    String(body.code ?? '').toUpperCase(),
    operatorKeyOf(request),
    show,
    body.commandId,
    Number(expected),
  );
  return respond(result);
}
