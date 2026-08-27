import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAudit, freshState, setState } from '../lib/event-store';
import { settleBets } from '../lib/tote';

/* Defect class: a saved night from an older build missing the new keys. */
test('freshState carries the audit trail and every ledger', () => {
  const s = freshState();
  assert.deepEqual(s.audit, []);
  assert.deepEqual(s.bets, []);
  assert.deepEqual(s.history, []);
  assert.equal(s.bettingOpen, true);
});

/* Defect class: the settle-then-undo-then-settle cycle paying twice. This is
   the state-machine version of the tote unit test: reopened bets settle
   again exactly once, to the same odds. */
test('undo and re-settle pays exactly once each time', () => {
  const bets = [
    { id: 'b1', raceNo: 1, lane: 0, snailName: 'A', punter: 'dave', chips: 50, odds: 3, settled: false },
  ];
  const settled = settleBets(bets, 1, 0);
  assert.equal(settled[0].returned, 150);

  /* Undo: the compensating action reopens the bet. */
  const reopened = settled.map((b) => ({ ...b, settled: false, won: undefined, returned: undefined }));
  const resettled = settleBets(reopened, 1, 1);
  assert.equal(resettled[0].won, false);
  assert.equal(resettled[0].returned, 0);
});

/* Defect class: audit entries being editable or unbounded. */
test('addAudit prepends, never edits, and stays capped', () => {
  for (let i = 0; i < 520; i++) {
    addAudit({ kind: 'note', raceNo: 0, detail: `entry ${i}` });
  }
  let seen: string[] = [];
  setState((s) => {
    seen = s.audit.map((a) => a.detail);
    return {};
  });
  assert.equal(seen.length, 500);
  assert.equal(seen[0], 'entry 519'); // newest first
});
