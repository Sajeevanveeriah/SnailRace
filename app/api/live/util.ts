import { NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/server-origin';
import { isError } from '@/lib/live/store';

/**
 * Shared plumbing for the Phone Play routes: the same origin boundary the
 * donation routes enforce, a request-size guard, and one place that turns a
 * store error into a response without leaking anything internal.
 */

const MAX_BODY_BYTES = 4096;

export async function readBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not accepted.' }, { status: 403 });
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'Request too large.' }, { status: 413 });
  }
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'Request too large.' }, { status: 413 });
    }
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 });
    }
    return parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 });
  }
}

export function respond(result: unknown): NextResponse {
  if (isError(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

/** Best-effort source address for the join flood bucket. */
export const addrOf = (request: Request): string =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
