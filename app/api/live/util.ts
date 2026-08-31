import { NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/server-origin';
import { isStoreErrorValue, type LiveShow } from '@/lib/live/store';

/**
 * Shared plumbing for the Phone Play routes: the same origin boundary the
 * donation routes enforce, a request-size guard, and one place that turns a
 * store error into a response without leaking anything internal.
 */

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };
const SHOW_PHASES = new Set([
  'lobby',
  'racecard',
  'market',
  'race',
  'results',
  'championship',
  'intermission',
  'finale',
]);

const errorResponse = (error: string, status: number): NextResponse =>
  NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

export async function readBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  const origin = checkOrigin(request);
  if (!origin.ok) {
    return errorResponse('A valid same-origin browser request is required.', 403);
  }
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return errorResponse('Content-Type must be application/json.', 415);
  }
  const statedLength = request.headers.get('content-length');
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isSafeInteger(length) || length < 0) return errorResponse('Invalid request length.', 400);
    if (length > MAX_BODY_BYTES) return errorResponse('Request too large.', 413);
  }
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return errorResponse('Request too large.', 413);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return errorResponse('Malformed request.', 400);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return errorResponse('Malformed request.', 400);
  }
}

export function respond(result: unknown): NextResponse {
  if (isStoreErrorValue(result)) {
    const { status, ...payload } = result;
    return NextResponse.json({ ok: false, ...payload }, { status, headers: NO_STORE });
  }
  return NextResponse.json(result, { headers: NO_STORE });
}

/** Operator capability from a header, so it never enters an access-log URL. */
export function operatorKeyOf(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

/**
 * Canonicalise and validate the complete show snapshot at the HTTP boundary.
 * The local store still validates consequential transitions independently.
 */
export function parseLiveShow(value: unknown): LiveShow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const eventName = typeof raw.eventName === 'string' ? raw.eventName.trim() : '';
  const clubName = typeof raw.clubName === 'string' ? raw.clubName.trim() : '';
  const raceNo = raw.raceNo;
  const phase = raw.phase;
  if (!eventName || eventName.length > 100 || !clubName || clubName.length > 100) return null;
  if (!Number.isSafeInteger(raceNo) || Number(raceNo) < 1 || Number(raceNo) > 10_000) return null;
  if (typeof phase !== 'string' || !SHOW_PHASES.has(phase)) return null;
  if (typeof raw.marketOpen !== 'boolean' || typeof raw.rehearsal !== 'boolean') return null;
  if (!Array.isArray(raw.names) || raw.names.length < 8 || raw.names.length > 20) return null;

  const names: string[] = [];
  for (const value of raw.names) {
    if (typeof value !== 'string' || /[\u0000-\u001F\u007F]/.test(value)) return null;
    const name = value.trim();
    if (!name || name.length > 40) return null;
    names.push(name);
  }

  if (typeof raw.odds !== 'object' || raw.odds === null || Array.isArray(raw.odds) && raw.odds.length < names.length) {
    return null;
  }
  const odds: Record<number, number> = {};
  for (let lane = 0; lane < names.length; lane += 1) {
    const odd = Number((raw.odds as Record<number, unknown>)[lane]);
    if (!Number.isFinite(odd) || odd <= 0 || odd > 10_000) return null;
    odds[lane] = odd;
  }

  let result: LiveShow['result'] = null;
  if (raw.result !== null) {
    if (typeof raw.result !== 'object' || Array.isArray(raw.result)) return null;
    const supplied = raw.result as Record<string, unknown>;
    if (
      !Number.isSafeInteger(supplied.raceNo) ||
      Number(supplied.raceNo) < 1 ||
      Number(supplied.raceNo) > Number(raceNo) ||
      !Number.isSafeInteger(supplied.winnerLane) ||
      Number(supplied.winnerLane) < 0 ||
      Number(supplied.winnerLane) >= names.length ||
      !Array.isArray(supplied.order) ||
      supplied.order.length !== names.length
    ) {
      return null;
    }
    const order: NonNullable<LiveShow['result']>['order'] = [];
    const lanes = new Set<number>();
    const places = new Set<number>();
    for (const row of supplied.order) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
      const item = row as Record<string, unknown>;
      if (
        !Number.isSafeInteger(item.lane) ||
        Number(item.lane) < 0 ||
        Number(item.lane) >= names.length ||
        !Number.isSafeInteger(item.place) ||
        Number(item.place) < 1 ||
        Number(item.place) > names.length ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        item.name.length > 40
      ) {
        return null;
      }
      const lane = Number(item.lane);
      const place = Number(item.place);
      if (lanes.has(lane) || places.has(place)) return null;
      lanes.add(lane);
      places.add(place);
      order.push({ lane, place, name: item.name.trim() });
    }
    if (order.find((item) => item.place === 1)?.lane !== Number(supplied.winnerLane)) return null;
    result = {
      raceNo: Number(supplied.raceNo),
      winnerLane: Number(supplied.winnerLane),
      order,
    };
  }

  return {
    eventName,
    clubName,
    raceNo: Number(raceNo),
    phase,
    marketOpen: raw.marketOpen,
    names,
    odds,
    result,
    rehearsal: raw.rehearsal,
  };
}

/** Best-effort proxy address without trusting caller-controlled X-Forwarded-For. */
export const addrOf = (request: Request): string => {
  const candidate = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '';
  return /^[0-9A-Fa-f:.]{3,64}$/.test(candidate) ? candidate : 'local';
};
