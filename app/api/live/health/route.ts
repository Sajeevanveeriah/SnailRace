import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stable identity probe shared with the durable Phone Play service. */
export async function GET() {
  return NextResponse.json(
    { ok: true, service: 'snailrace-live', schema: 1 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
