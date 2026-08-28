import { NextResponse } from 'next/server';
import { joinAllowed, joinSession } from '@/lib/live/store';
import { addrOf, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  if (!joinAllowed(addrOf(request))) {
    return NextResponse.json(
      { ok: false, error: 'Too many join attempts from this connection. Wait a few minutes.' },
      { status: 429 },
    );
  }
  const result = await joinSession(
    String(body.code ?? '').toUpperCase(),
    String(body.name ?? ''),
    typeof body.pin === 'string' ? body.pin : undefined,
  );
  return respond(result);
}
