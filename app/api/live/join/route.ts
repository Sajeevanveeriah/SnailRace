import { NextResponse } from 'next/server';
import { joinAllowed, joinSession } from '@/lib/live/store';
import { addrOf, readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  if (
    typeof body.code !== 'string' ||
    !/^[A-Za-z2-9]{6}$/.test(body.code) ||
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.length > 80 ||
    (body.pin !== undefined && (typeof body.pin !== 'string' || !/^\d{4,12}$/.test(body.pin)))
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed join request.' }, { status: 400 });
  }

  if (!joinAllowed(addrOf(request))) {
    return NextResponse.json(
      { ok: false, error: 'Too many join attempts from this connection. Wait a few minutes.' },
      { status: 429 },
    );
  }
  const result = await joinSession(
    body.code.toUpperCase(),
    body.name,
    typeof body.pin === 'string' ? body.pin : undefined,
  );
  return respond(result);
}
