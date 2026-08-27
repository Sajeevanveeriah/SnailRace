import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commitmentInput,
  commitmentOf,
  resultHashOf,
  sha256Bytes,
  sha256Hex,
  type RaceConfig,
} from '../lib/audit';

/* Defect class: a wrong hash implementation. Checked against the FIPS 180-4
   published vectors, for both the WebCrypto path and the pure fallback that
   covers insecure contexts (a projector on plain http). */
const VECTORS: Array<[string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
];

test('sha256Hex matches the published vectors', async () => {
  for (const [input, expected] of VECTORS) {
    assert.equal(await sha256Hex(input), expected);
  }
});

test('the pure fallback agrees with the vectors and with WebCrypto', async () => {
  const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  for (const [input, expected] of VECTORS) {
    assert.equal(toHex(sha256Bytes(new TextEncoder().encode(input))), expected);
  }
  /* A long input crosses several blocks. */
  const long = 'a'.repeat(1_000_000);
  assert.equal(
    toHex(sha256Bytes(new TextEncoder().encode(long))),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  );
});

const config: RaceConfig = {
  raceNo: 3,
  raceType: 'Heat',
  fieldSize: 4,
  names: ['A', 'B', 'C', 'D'],
  durationMs: 12_000,
  laps: 3,
  surprises: true,
  trackShape: 'circuit',
};

/* Defect class: a commitment that fails to bind. Changing any part of the
   configuration must change the commitment. */
test('the commitment binds seed and configuration', async () => {
  const base = await commitmentOf('8F2A31C0', config);
  assert.equal(base, await commitmentOf('8f2a31c0', config)); // case-stable
  assert.notEqual(base, await commitmentOf('8F2A31C1', config));
  assert.notEqual(base, await commitmentOf('8F2A31C0', { ...config, laps: 4 }));
  assert.notEqual(base, await commitmentOf('8F2A31C0', { ...config, surprises: false }));
  assert.notEqual(
    base,
    await commitmentOf('8F2A31C0', { ...config, names: ['A', 'B', 'C', 'E'] }),
  );
  /* The canonical string is stated, so an outside audit can rebuild it. */
  assert.equal(
    commitmentInput('8F2A31C0', config),
    'ndcc-race-commit-v1|8F2A31C0|3|Heat|4|A\u001fB\u001fC\u001fD|12000|3|1|circuit',
  );
});

/* Defect class: a result hash that misses a change to the finishing order. */
test('the result hash fingerprints the finishing order', async () => {
  const results = [
    { lane: 2, name: 'C', place: 1, finishMs: 11800 },
    { lane: 0, name: 'A', place: 2, finishMs: 12100 },
  ];
  const base = await resultHashOf('8F2A31C0', results);
  /* Order of the array must not matter; place decides. */
  assert.equal(base, await resultHashOf('8F2A31C0', [...results].reverse()));
  assert.notEqual(
    base,
    await resultHashOf('8F2A31C0', [
      { ...results[0], name: 'X' },
      results[1],
    ]),
  );
});
