import type { Donation } from './types';

/**
 * Several screens can be pointed at the same event - the stage, the tote on a
 * second monitor, the treasurer's laptop. Without this they would each hit
 * Stripe every few seconds for identical data. The window is deliberately
 * shorter than the poll interval on the stage, so a fresh donation is never
 * more than one beat late.
 *
 * Per-instance and in-memory on purpose: it is a latency optimisation, and
 * `/api/donations` is correct with the cache permanently empty.
 */
const store = new Map<string, { at: number; donations: Donation[] }>();

export const CACHE_MS = 2500;

export function readCache(eventId: string): { at: number; donations: Donation[] } | null {
  const hit = store.get(eventId);
  if (!hit) return null;
  if (Date.now() - hit.at >= CACHE_MS) return null;
  return hit;
}

export function writeCache(eventId: string, donations: Donation[]): number {
  const at = Date.now();
  store.set(eventId, { at, donations });
  return at;
}

export function bustCache(eventId?: string): void {
  if (eventId) store.delete(eventId);
  else store.clear();
}
