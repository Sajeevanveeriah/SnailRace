import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAuditEntry, sha256Hex, verifyAuditChain } from '../lib/audit';
import { addAudit, auditChainSettled, currentState } from '../lib/event-store';
import type { AuditEntry } from '../lib/types';

/**
 * The tamper-evident audit chain:
 *
 *   entryHash = SHA-256(prevHash + canonicalAuditEntry(entry))
 *
 * These tests prove both directions - an honest trail verifies, and every
 * class of tamper (edit, removal, reorder, forged hash) breaks it.
 */

/** Build an honestly chained trail, returned newest-first as stored. */
async function chainOf(details: string[]): Promise<AuditEntry[]> {
  const chrono: AuditEntry[] = [];
  let prev = '';
  for (let i = 0; i < details.length; i++) {
    const e: AuditEntry = {
      id: `t${i}`,
      at: 1_700_000_000_000 + i * 1000,
      kind: 'note',
      raceNo: i,
      detail: details[i],
      prevHash: prev,
      entryHash: '',
    };
    e.entryHash = await sha256Hex(prev + canonicalAuditEntry(e));
    prev = e.entryHash;
    chrono.push(e);
  }
  return chrono.reverse();
}

test('an honest chain verifies', async () => {
  const trail = await chainOf(['lock', 'start', 'finish', 'settle']);
  const report = await verifyAuditChain(trail);
  assert.equal(report.ok, true);
  assert.equal(report.chained, 4);
  assert.equal(report.unchained, 0);
});

test('editing one entry detail breaks the chain at that entry', async () => {
  const trail = await chainOf(['lock', 'start', 'finish']);
  trail[1] = { ...trail[1], detail: 'start (doctored)' };
  const report = await verifyAuditChain(trail);
  assert.equal(report.ok, false);
  assert.equal(report.breakAt, trail[1].id);
});

test('removing a middle entry breaks the chain', async () => {
  const trail = await chainOf(['a', 'b', 'c', 'd']);
  const withoutOne = trail.filter((e) => e.id !== 't1');
  const report = await verifyAuditChain(withoutOne);
  assert.equal(report.ok, false);
});

test('reordering entries breaks the chain', async () => {
  const trail = await chainOf(['a', 'b', 'c', 'd']);
  const swapped = [trail[0], trail[2], trail[1], trail[3]];
  const report = await verifyAuditChain(swapped);
  assert.equal(report.ok, false);
});

test('a forged entryHash does not verify', async () => {
  const trail = await chainOf(['a', 'b']);
  trail[0] = { ...trail[0], entryHash: 'f'.repeat(64) };
  const report = await verifyAuditChain(trail);
  assert.equal(report.ok, false);
  assert.equal(report.breakAt, trail[0].id);
});

test('pre-chain v3 entries anchor the chain instead of failing it', async () => {
  const trail = await chainOf(['v4-first', 'v4-second']);
  const v3: AuditEntry = { id: 'old', at: 1, kind: 'note', raceNo: 0, detail: 'v3 entry, no hash' };
  const report = await verifyAuditChain([...trail, v3]);
  assert.equal(report.ok, true);
  assert.equal(report.chained, 2);
  assert.equal(report.unchained, 1);
});

test('the live store chains addAudit entries end to end', async () => {
  addAudit({ kind: 'note', raceNo: 1, detail: 'first live entry' });
  addAudit({ kind: 'note', raceNo: 2, detail: 'second live entry' });
  addAudit({ kind: 'note', raceNo: 3, detail: 'third live entry' });
  await auditChainSettled();
  const audit = currentState().audit;
  assert.ok(audit.length >= 3);
  assert.ok(audit.every((e) => e.entryHash));
  const report = await verifyAuditChain(audit);
  assert.equal(report.ok, true);

  /* And the same trail, tampered, no longer does. */
  const doctored = audit.map((e, i) => (i === audit.length - 1 ? { ...e, detail: 'edited' } : e));
  const bad = await verifyAuditChain(doctored);
  assert.equal(bad.ok, false);
});

test('the canonical form is stated and stable', () => {
  const line = canonicalAuditEntry({ id: 'x', at: 5, kind: 'race_finished', raceNo: 2, detail: 'd' });
  assert.equal(line, 'ndcc-audit-v1|x|5|race_finished|2|d');
});
