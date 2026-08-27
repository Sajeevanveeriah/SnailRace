import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeLineup, encodeLineup } from '../lib/lineup';
import { MAX_FIELD } from '../lib/palette';

/* Defect class: the QR token failing to round-trip, or growing past what a
   phone camera reads across a hall. */
test('the lineup token round-trips', () => {
  const token = {
    v: 1 as const,
    e: 'ev123abc',
    r: 4,
    c: 'Newcomb & District Cricket Club',
    n: ['Speedy', 'Escar-go', 'Slime Shady'],
  };
  assert.deepEqual(decodeLineup(encodeLineup(token)), token);
});

test('a worst-case 20-lane token stays inside comfortable QR capacity', () => {
  const token = {
    v: 1 as const,
    e: 'e'.repeat(24),
    r: 99,
    c: 'C'.repeat(60),
    n: Array.from({ length: MAX_FIELD }, (_, i) => `Name-${i}-` + 'x'.repeat(16)),
  };
  const encoded = encodeLineup(token);
  /* Version-25 QR at level M carries about 1,853 bytes; a hall projector
     wants far less than that to stay scannable from a phone. */
  assert.ok(encoded.length < 1200, `token is ${encoded.length} chars`);
  const url = `https://example.github.io/SnailRace/donate?e=${encoded}`;
  assert.ok(url.length < 1300);
  assert.equal(decodeLineup(encoded)?.n.length, MAX_FIELD);
});

test('garbage tokens decode to null, never throw', () => {
  assert.equal(decodeLineup(null), null);
  assert.equal(decodeLineup(''), null);
  assert.equal(decodeLineup('%%%not-base64%%%'), null);
  assert.equal(decodeLineup(Buffer.from('{"v":2}').toString('base64url')), null);
});
