import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netOf, toDonation } from '../lib/stripe-read';
import { APP_TAG, META } from '../lib/stripe';
import type Stripe from 'stripe';

/* Minimal session factory. Only the fields the reader touches. */
const session = (over: Record<string, unknown> = {}): Stripe.Checkout.Session =>
  ({
    id: 'cs_test_1',
    payment_status: 'paid',
    amount_total: 2000,
    created: 1_700_000_000,
    metadata: {
      app: APP_TAG,
      [META.eventId]: 'ev1',
      [META.raceNo]: '2',
      [META.lane]: '1',
      [META.snailName]: 'Turbo',
      [META.backerName]: 'Dave',
    },
    payment_intent: null,
    ...over,
  }) as unknown as Stripe.Checkout.Session;

const charge = (amount_refunded: number) => ({
  payment_intent: { latest_charge: { amount_refunded } },
});

/* Defect class: refunds invisible to the board (threat model T6). */
test('netOf subtracts refunds from the charge behind the session', () => {
  assert.deepEqual(netOf(session()), { cents: 2000, refunded: 0 });
  assert.deepEqual(netOf(session(charge(0))), { cents: 2000, refunded: 0 });
  assert.deepEqual(netOf(session(charge(500))), { cents: 1500, refunded: 500 });
  assert.deepEqual(netOf(session(charge(2000))), { cents: 0, refunded: 2000 });
  /* Unexpanded string references degrade to gross, never crash. */
  assert.deepEqual(netOf(session({ payment_intent: 'pi_x' })), { cents: 2000, refunded: 0 });
});

test('a fully refunded donation stays in the ledger marked void', () => {
  const d = toDonation(session(charge(2000)));
  assert.ok(d);
  assert.equal(d.void, true);
  assert.equal(d.cents, 0);
  assert.equal(d.refundedCents, 2000);
});

test('a partial refund reduces the entry to what the club holds', () => {
  const d = toDonation(session(charge(700)));
  assert.ok(d && !d.void);
  assert.equal(d.cents, 1300);
  assert.equal(d.refundedCents, 700);
});

/* Defect class: foreign or unpaid sessions leaking onto the board. */
test('only this app’s paid sessions become donations', () => {
  assert.equal(toDonation(session({ metadata: { app: 'someone_else' } })), null);
  assert.equal(toDonation(session({ payment_status: 'unpaid' })), null);
  assert.equal(toDonation(session({ amount_total: 0 })), null);
  const meta = { ...session().metadata, [META.lane]: '-9' };
  assert.equal(toDonation(session({ metadata: meta })), null);
});

test('direct QR donations belong to no race and no lane', () => {
  const meta = { ...session().metadata, [META.lane]: '-1' };
  const d = toDonation(session({ metadata: meta }));
  assert.ok(d);
  assert.equal(d.raceNo, 0);
  assert.equal(d.lane, -1);
});
