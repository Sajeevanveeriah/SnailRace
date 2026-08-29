import { operatorSummary } from '@/lib/live/store';
import { respond } from '../util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The stage's view of the room: pick totals, reactions, leaderboard. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await operatorSummary(
    (url.searchParams.get('code') ?? '').toUpperCase(),
    url.searchParams.get('operatorKey'),
    Number(url.searchParams.get('since') ?? 0),
  );
  return respond(result);
}
