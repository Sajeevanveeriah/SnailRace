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
  const names = state.names.slice(0, 12);
  const plan = drawLockedRacePlan(0x51a11, names, 12_000, true, 'chaos', 3, 'circuit');
  const config: HeldRaceStartState['config'] = {
    raceNo: 1,
    raceType: 'Heat',
    fieldSize: 12,
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
    oddsAtLock: Object.fromEntries(names.map((_, lane) => [lane, 12])),
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

/* Ten a race: the card sells snails 1 to 100 into ten races of ten. */
test('freshState opens with the ten-snail card default', () => {
  const s = freshState();
  assert.equal(s.fieldSize, 10);
  assert.equal(s.plannedRaces, 10);
  assert.equal(s.card.names.length, 100);
  assert.equal(s.card.snailCents, 400);
  assert.equal(s.audioMode, 'music');
  assert.equal(s.cameraMode, 'telecast');
  assert.deepEqual(s.dealtCards, []);
  assert.deepEqual(s.names.slice(0, s.fieldSize), [
    'Speedy',
    'Turbo',
    'Lightning',
    'Flash',
    'Rocket',
    'Bolt',
    'Comet',
    'Dasher',
    'Escar-go',
    'Shellby',
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

/* Defect class: the 5.4 equal split moving a snail into a different race on a
   night that already ran races under the old split, so a reload re-runs
   numbers and breaks quaddie picks taken on the old boundaries. */
test('a saved night that already raced keeps the races its snails were sold into', async () => {
  const { cardLayout, describeLayout, raceForSnail, resizeCard } = await import('../lib/card');
  const state = freshState();
  const card = { ...state.card, snailCount: 64, names: new Array(64).fill(''), owners: new Array(64).fill('') };
  delete (card as { split?: string }).split;
  const ran = { raceNo: 1, void: false };
  assert.ok(restore(JSON.stringify({ ...state, card, history: [ran] })));
  assert.equal(currentState().card.split, 'legacy');
  assert.equal(describeLayout(cardLayout(64)), '7 races: 1 of 10, 6 of 9');
  assert.equal(raceForSnail(10, 64), 1);
  assert.equal(currentState().plannedRaces, 7);
  /* The marker survives a save and reload on its own. */
  assert.ok(restore(JSON.stringify({ ...currentState(), history: [] })));
  assert.equal(currentState().card.split, 'legacy');
  assert.equal(describeLayout(cardLayout(64)), '7 races: 1 of 10, 6 of 9');
  /* The same card with no race run takes tonight's equal split. */
  assert.ok(restore(JSON.stringify({ ...state, card, history: [] })));
  assert.equal(currentState().card.split, 'even');
  assert.equal(describeLayout(cardLayout(64)), '8 races of 8');
  assert.equal(raceForSnail(10, 64), 2);
  assert.equal(currentState().plannedRaces, 8);
  /* A voided race does not lock the old split in. */
  assert.ok(restore(JSON.stringify({ ...state, card, history: [{ ...ran, void: true }] })));
  assert.equal(currentState().card.split, 'even');
  /* Resizing (only possible before a race) always lands on the equal split. */
  assert.ok(restore(JSON.stringify({ ...state, card, history: [ran] })));
  const resized = resizeCard(currentState().card, 72);
  assert.ok(!('error' in resized) && resized.split === 'even');
  assert.equal(describeLayout(cardLayout(72)), '8 races of 9');
  assert.equal(describeLayout(cardLayout(64)), '8 races of 8');
});
