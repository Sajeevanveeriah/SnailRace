import { NextResponse } from 'next/server';
import { endSession } from '@/lib/live/store';
import { readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The stage closes the room. Operator key required; from then on every
 * phone's poll answers 410 and the phones say so honestly, rather than
 * polling a room the projector has abandoned.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const result = await endSession(String(body.code ?? '').toUpperCase(), body.operatorKey);
  return respond(result);
}
