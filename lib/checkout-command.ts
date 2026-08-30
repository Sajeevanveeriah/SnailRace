/** Stable identity for one logical attempt to create a Stripe Checkout session. */
export interface PendingCheckoutCommand {
  fingerprint: string;
  commandId: string;
}

/**
 * Reuse an ID for a retry of unchanged donation details; rotate it only when
 * the logical intent changes. The server forwards this as Stripe's
 * idempotency key, preventing a lost response from creating two sessions.
 */
export function checkoutCommandFor(
  pending: PendingCheckoutCommand | null,
  fingerprint: string,
  createId: () => string = () => newId('checkout'),
): PendingCheckoutCommand {
  return pending?.fingerprint === fingerprint
    ? pending
    : { fingerprint, commandId: createId() };
}
import { newId } from './ids';
