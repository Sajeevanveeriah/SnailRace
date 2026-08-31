import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAudit, currentState, freshState, restore, setState } from '../lib/event-store';
import { commitmentOf, planHashOf } from '../lib/audit';
import { drawLockedRacePlan } from '../lib/race-engine';
import { settleBets } from '../lib/tote';
import type { HeldRaceStartState } from '../lib/types';

/* Defect class: a saved night from an older build missing the new keys. */
test('freshState carries the audit trail and every ledger', () => {
  const s = freshState();
  assert.deepEqual(s.audit, []);
  assert.deepEqual(s.bets, []);
  assert.deepEqual(s.history, []);
  assert.equal(s.bettingOpen, true);
  assert.equal(s.heldRaceStart, null);
});

/* Defect class: a lost LOCK/RUN response followed by a moderator-page reload
   drawing a different plan over the already locked Phone Play room. */
test('a held start restores the exact locked plan and rejects a partial hash', async () => {
  const state = freshState();
  const names = state.names.slice(0, 8);
  const plan = drawLockedRacePlan(0x51a11, names, 12_000, true, 'chaos', 3, 'circuit');
  const config: HeldRaceStartState['config'] = {
    raceNo: 1,
    raceType: 'Heat',
    fieldSize: 8,
    names,
    durationMs: 12_000,
    laps: 3,
    surprises: true,
    trackShape: 'circuit',
    courseId: 'boundary-oval',
    intensity: 'chaos',
  };
  const held: HeldRaceStartState = {
    raceNo: 1,
    lockedAt: 1_800_000_000_000,
    startedAt: 1_800_000_000_100,
    config,
    oddsAtLock: Object.fromEntries(names.map((_, lane) => [lane, 8])),
    commitHash: await commitmentOf(plan.seedHex, config),
    planHash: await planHashOf(plan),
    plan,
  };

  assert.equal(
    restore(JSON.stringify({ ...state, bettingOpen: false, heldRaceStart: held })),
    true,
  );
  assert.deepEqual(currentState().heldRaceStart, held);
  assert.equal(currentState().bettingOpen, false);

  assert.equal(
    restore(
      JSON.stringify({
        ...state,
        bettingOpen: false,
        heldRaceStart: { ...held, planHash: 'partial' },
      }),
    ),
    true,
  );
  assert.equal(currentState().heldRaceStart, null);
});

/* The projector, racecard and Phone Play market must all begin from the
   same eight-runner field. Keep this as a literal acceptance vector so a
   shared constant changing cannot make the requirement silently move. */
test('freshState opens with the approved eight-runner field', () => {
  const s = freshState();
  assert.equal(s.fieldSize, 8);
  assert.deepEqual(s.names.slice(0, s.fieldSize), [
    'Speedy',
    'Turbo',
    'Lightning',
    'Flash',
    'Rocket',
    'Bolt',
    'Comet',
    'Dasher',
  ]);
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
