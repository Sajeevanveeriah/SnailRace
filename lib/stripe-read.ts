import type Stripe from 'stripe';
import { META, APP_TAG } from './stripe';
import type { Donation } from './types';

/**
 * Turning Stripe's records into board entries, in one testable place.
 *
 * A refunded donation that stays on the board is a reconciliation failure:
 * the screen says one number and the bank statement says another, and the
 * treasurer has to find the difference by hand at midnight. So the charge
 * behind each session is read and the refund subtracted - fully refunded
 * entries are marked void and stay visible in the ledger, partial refunds
 * reduce the amount to what the club actually holds.
 */
export function netOf(session: Stripe.Checkout.Session): { cents: number; refunded: number } {
  const gross = session.amount_total ?? 0;
  const intent = session.payment_intent;
  if (!intent || typeof intent === 'string') return { cents: gross, refunded: 0 };

  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string') return { cents: gross, refunded: 0 };

  const refunded = charge.amount_refunded ?? 0;
  return { cents: Math.max(0, gross - refunded), refunded };
}

export function toDonation(session: Stripe.Checkout.Session): Donation | null {
  const meta = session.metadata ?? {};
  if (meta.app !== APP_TAG) return null;
  if (session.payment_status !== 'paid') return null;

  const gross = session.amount_total ?? 0;
  if (gross <= 0) return null;

  /* Lane -1 is a direct QR donation: it belongs to no snail and no race, so
     it counts in the night's total but never in a race pot. */
  const lane = Number(meta[META.lane]);
  if (!Number.isInteger(lane) || lane < -1) return null;

  const { cents, refunded } = netOf(session);

  return {
    id: session.id,
    sessionId: session.id,
    raceNo: lane < 0 ? 0 : Math.max(1, Number(meta[META.raceNo]) || 1),
    lane,
    snailName: meta[META.snailName] || (lane < 0 ? 'Direct donation' : `Lane ${lane + 1}`),
    backerName: meta[META.backerName] || '',
    cents,
    source: 'stripe',
    createdAt: (session.created ?? 0) * 1000,
    /* Fully refunded: kept in the ledger, out of the totals, so the night
       still reconciles against Stripe line by line. */
    ...(cents <= 0 ? { void: true } : {}),
    ...(refunded > 0 ? { refundedCents: refunded } : {}),
  };
}
