import type Stripe from 'stripe';
import { META, APP_TAG, SNAIL_FIELDS } from './stripe';
import { laneForSnail, raceForSnail, validSnailNo } from './card';
import type { Donation } from './types';

/**
 * The snail a Payment Link checkout bought, read from its custom fields.
 *
 * A Payment Link cannot know the number in advance, so the buyer types it.
 * The session carries the answers in `custom_fields`; `kind: snail` in the
 * metadata says which link it came from. Anything unreadable is treated as
 * a plain donation rather than dropped, so the money still reconciles.
 */
export function snailPurchaseOf(
  session: Stripe.Checkout.Session,
): { snailNo: number; snailName: string; owner: string } | null {
  if ((session.metadata ?? {})[META.kind] !== 'snail') return null;
  const fields = session.custom_fields ?? [];
  const read = (key: string): string => {
    const field = fields.find((f) => f.key === key);
    if (!field) return '';
    if (field.type === 'numeric') return field.numeric?.value ?? '';
    if (field.type === 'text') return field.text?.value ?? '';
    if (field.type === 'dropdown') return field.dropdown?.value ?? '';
    return '';
  };
  const snailNo = Number(read(SNAIL_FIELDS.number).replace(/[^\d]/g, ''));
  if (!validSnailNo(snailNo)) return null;
  return {
    snailNo,
    snailName: read(SNAIL_FIELDS.name).trim().slice(0, 24),
    owner: read(SNAIL_FIELDS.owner).trim().slice(0, 24),
  };
}

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

  const { cents, refunded } = netOf(session);

  /* A numbered snail bought through the Payment Link. The number fixes the
     race and the lane, and the name and owner fill the roster. */
  const purchase = snailPurchaseOf(session);
  if (purchase) {
    return {
      id: session.id,
      sessionId: session.id,
      raceNo: raceForSnail(purchase.snailNo),
      lane: laneForSnail(purchase.snailNo),
      snailNo: purchase.snailNo,
      snailName: purchase.snailName || `Snail ${purchase.snailNo}`,
      backerName: purchase.owner,
      cents,
      source: 'stripe',
      createdAt: (session.created ?? 0) * 1000,
      ...(cents <= 0 ? { void: true } : {}),
      ...(refunded > 0 ? { refundedCents: refunded } : {}),
    };
  }

  /* Lane -1 is a direct QR donation: it belongs to no snail and no race, so
     it counts in the night's total but never in a race pot. */
  const lane = Number(meta[META.lane]);
  if (!Number.isInteger(lane) || lane < -1) return null;

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
