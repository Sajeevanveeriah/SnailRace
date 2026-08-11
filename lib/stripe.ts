import Stripe from 'stripe';

/**
 * Stripe is the ledger.
 *
 * There is no application database. Every card donation lives in Stripe as a
 * Checkout Session carrying the race number, lane and snail name in its
 * metadata, and the stage reads them straight back out. That means the
 * on-screen total and the club's Stripe payouts can never drift apart, and
 * the whole night reconciles against the bank statement with no extra step.
 *
 * The trade-off is that donations are only visible once Stripe reports the
 * session as paid, and the stage polls rather than holding a socket open.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, {
      apiVersion: '2025-08-27.basil',
      appInfo: { name: 'NDCC Snail Race Fundraiser', version: '3.0.0' },
      maxNetworkRetries: 2,
    });
  }
  return cached;
}

export const stripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

/** Metadata keys, in one place, so the writer and the reader cannot drift. */
export const META = {
  app: 'ndcc_snailrace',
  eventId: 'event_id',
  raceNo: 'race_no',
  lane: 'lane',
  snailName: 'snail_name',
  backerName: 'backer_name',
} as const;

export const APP_TAG = 'ndcc_snailrace_v3';
