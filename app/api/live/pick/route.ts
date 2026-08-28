import { NextResponse } from 'next/server';
import { placePick } from '@/lib/live/store';
import { readBody, respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A fun-chip pick from a phone. FUN CHIPS - NO MONETARY VALUE: the server
 * validates the market is open, the race is current, the chips exist and the
 * nonce is unseen; nothing here can ever touch a race result or a dollar.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const result = await placePick(
    String(body.code ?? '').toUpperCase(),
    body.playerId,
    body.token,
    Number(body.raceNo),
    Number(body.lane),
    Number(body.chips),
    String(body.nonce ?? ''),
  );
  return respond(result);
}
