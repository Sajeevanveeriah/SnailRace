import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CARD,
  SNAILS_ON_CARD,
  applyPurchases,
  cardRaceNames,
  laneForSnail,
  nextFreeSnail,
  normaliseCard,
  parseRosterPaste,
  raceForSnail,
  releaseRefunded,
  rosterCsv,
  snailsForRace,
  soldCount,
} from '../lib/card';

const fresh = () => normaliseCard(DEFAULT_CARD);

test('snail numbers map to races and lanes the way the poster says', () => {
  assert.equal(raceForSnail(1), 1);
  assert.equal(raceForSnail(10), 1);
  assert.equal(raceForSnail(11), 2);
  assert.equal(raceForSnail(100), 10);
  assert.equal(laneForSnail(1), 0);
  assert.equal(laneForSnail(10), 9);
  assert.equal(laneForSnail(23), 2);
  assert.deepEqual(snailsForRace(3), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  assert.equal(SNAILS_ON_CARD, 100);
});

test('an unsold snail still races, under its number', () => {
  const card = fresh();
  card.names[20] = 'Shelly Winters';
  const names = cardRaceNames(card, 3);
  assert.equal(names.length, 10);
  assert.equal(names[0], 'Shelly Winters');
  assert.equal(names[1], 'Snail 22');
  assert.equal(names[9], 'Snail 30');
});

test('paid purchases fill empty slots and never overwrite a hand-typed one', () => {
  const card = fresh();
  card.names[28] = 'Typed At The Table';
  const first = applyPurchases(card, [
    { snailNo: 29, snailName: 'Escargot Faster', owner: 'Priya', id: 'cs_1' },
    { snailNo: 30, snailName: "Nan's Favourite", owner: 'Lisa', id: 'cs_2' },
  ]);
  assert.equal(first.changed, true);
  assert.equal(first.card.names[29], "Nan's Favourite");
  assert.equal(first.card.owners[29], 'Lisa');
  assert.equal(first.card.claims[30], 'cs_2');
  /* 29 was typed by the desk: the payment is reported, not applied. */
  assert.equal(first.card.names[28], 'Typed At The Table');
  assert.deepEqual(first.conflicts.map((c) => c.snailNo), [29]);

  /* The same session again changes nothing; a corrected name flows through. */
  const again = applyPurchases(first.card, [{ snailNo: 30, snailName: "Nan's Favourite", owner: 'Lisa', id: 'cs_2' }]);
  assert.equal(again.changed, false);
  const fixed = applyPurchases(first.card, [{ snailNo: 30, snailName: 'Nans Favourite', owner: 'Lisa', id: 'cs_2' }]);
  assert.equal(fixed.card.names[29], 'Nans Favourite');
  /* A different payment cannot take a claimed number. */
  const clash = applyPurchases(first.card, [{ snailNo: 30, snailName: 'Someone Else', owner: 'Bob', id: 'cs_9' }]);
  assert.equal(clash.changed, false);
  assert.equal(clash.conflicts.length, 1);
});

test('the roster paste accepts commas, semicolons and tabs and skips junk', () => {
  const { rows, skipped } = parseRosterPaste(
    '29, Escargot Faster, Priya\n30; Nan\'s Favourite; Lisa\n#31\tThe Undertaker\tBen\nhello world\n\n101, Too Far, X',
  );
  assert.deepEqual(rows, [
    { snailNo: 29, name: 'Escargot Faster', owner: 'Priya' },
    { snailNo: 30, name: "Nan's Favourite", owner: 'Lisa' },
    { snailNo: 31, name: 'The Undertaker', owner: 'Ben' },
  ]);
  assert.equal(skipped, 2);
});

test('sold count, next free number and the CSV export', () => {
  const card = fresh();
  assert.equal(soldCount(card), 0);
  assert.equal(nextFreeSnail(card), 1);
  card.names[0] = 'One';
  card.owners[1] = 'Owner Two';
  assert.equal(soldCount(card), 2);
  assert.equal(nextFreeSnail(card), 3);
  const csv = rosterCsv(card).split('\n');
  assert.equal(csv[0], 'snail,race,lane,name,owner');
  assert.equal(csv[1], '1,1,1,"One",""');
  assert.equal(csv.length, 101);
});

test('a stored card from any backup normalises to exactly one hundred slots', () => {
  const card = normaliseCard({ names: ['A', 'B'], owners: null, claims: { 1: 'cs_a', 999: 'cs_b', x: 1 }, snailCents: 5, paymentLinkUrl: 'javascript:alert(1)' });
  assert.equal(card.names.length, 100);
  assert.equal(card.owners.length, 100);
  assert.deepEqual(card.claims, { 1: 'cs_a' });
  assert.equal(card.snailCents, 400);
  assert.equal(card.paymentLinkUrl, '');
  assert.equal(normaliseCard({ paymentLinkUrl: 'https://buy.stripe.com/test_abc' }).paymentLinkUrl, 'https://buy.stripe.com/test_abc');
});

test('a full refund releases the slot it bought, and only that slot', () => {
  const card = fresh();
  const bought = applyPurchases(card, [
    { snailNo: 29, snailName: 'Escargot Faster', owner: 'Priya', id: 'cs_1' },
    { snailNo: 30, snailName: 'Nans Favourite', owner: 'Lisa', id: 'cs_2' },
  ]).card;
  const { card: after, released } = releaseRefunded(bought, ['cs_1', 'cs_unknown']);
  assert.deepEqual(released, [29]);
  assert.equal(after.names[28], '');
  assert.equal(after.owners[28], '');
  assert.equal(after.claims[29], undefined);
  assert.equal(after.names[29], 'Nans Favourite');
  /* The desk reassigned the number by hand since: the refund does not touch it. */
  const retyped = { ...after, names: after.names.slice(), claims: { ...after.claims } };
  retyped.names[29] = 'Typed Later';
  delete retyped.claims[30];
  assert.equal(releaseRefunded(retyped, ['cs_2']).released.length, 0);
  /* A refunded number can be bought again. */
  assert.equal(applyPurchases(after, [{ snailNo: 29, snailName: 'Second Go', owner: 'Sam', id: 'cs_3' }]).card.names[28], 'Second Go');
  /* The minted flag only survives alongside a valid link. */
  assert.equal(normaliseCard({ paymentLinkUrl: 'https://buy.stripe.com/x', paymentLinkMinted: true }).paymentLinkMinted, true);
  assert.equal(normaliseCard({ paymentLinkMinted: true }).paymentLinkMinted, false);
});
