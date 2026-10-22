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
    restore(JSON.stringify({ ...state, showPhase: 'race', bettingOpen: false, heldRaceStart: held })),
    true,
  );
  assert.deepEqual(currentState().heldRaceStart, held);
  assert.equal(currentState().bettingOpen, false);

  /* An armed race belongs to the race screen: one saved with the show on
     the welcome (a cleared rehearsal, an old build) is dropped, or it would
     hold "Show the racecard" and every other show control with nothing on
     screen and no way out. */
  assert.equal(restore(JSON.stringify({ ...state, showPhase: 'lobby', heldRaceStart: held })), true);
  assert.equal(currentState().heldRaceStart, null);
  assert.equal(currentState().showPhase, 'lobby');

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
  /* A card as the 5.3 build saved it: a count and no split marker or run sheet. */
  const card = { ...state.card, snailCount: 64, names: new Array(64).fill(''), owners: new Array(64).fill('') } as Record<string, unknown>;
  delete card.split;
  delete card.races;
  delete card.snailsPerRace;
  const ran = { raceNo: 1, void: false };
  const layoutNow = () => describeLayout(cardLayout(currentState().card));
  assert.ok(restore(JSON.stringify({ ...state, card, history: [ran] })));
  assert.equal(currentState().card.split, 'legacy');
  assert.equal(layoutNow(), '7 races: 1 of 10, 6 of 9');
  assert.equal(raceForSnail(10, currentState().card), 1);
  assert.equal(currentState().plannedRaces, 7);
  /* The migrated run sheet survives a save and reload on its own. */
  assert.ok(restore(JSON.stringify({ ...currentState(), history: [] })));
  assert.equal(currentState().card.split, 'legacy');
  assert.equal(layoutNow(), '7 races: 1 of 10, 6 of 9');
  /* The same card with no race run takes the even split. */
  assert.ok(restore(JSON.stringify({ ...state, card, history: [] })));
  assert.equal(currentState().card.split, 'even');
  assert.equal(layoutNow(), '8 races of 8');
  assert.equal(raceForSnail(10, currentState().card), 2);
  assert.equal(currentState().plannedRaces, 8);
  /* A ticket, sale or bid sold before any race is tied to a lane too. */
  for (const key of ['quaddieEntries', 'toteSales', 'auctionBids', 'cashLedger'] as const) {
    assert.ok(restore(JSON.stringify({ ...state, card, history: [], [key]: [{ void: false }] })));
    assert.equal(currentState().card.split, 'legacy', key);
  }
  /* A voided race does not lock the old split in. */
  assert.ok(restore(JSON.stringify({ ...state, card, history: [{ ...ran, void: true }] })));
  assert.equal(currentState().card.split, 'even');
  /* Clearing a rehearsal keeps the run sheet: tickets and bids survive the clear. */
  assert.ok(restore(JSON.stringify({ ...state, card, history: [ran] })));
  setState({ history: [], raceNumber: 0 });
  assert.equal(currentState().card.split, 'legacy');
  assert.equal(currentState().plannedRaces, 7);
  assert.equal(layoutNow(), '7 races: 1 of 10, 6 of 9');
  /* Putting more snails on sale never moves a race: the run sheet stays put. */
  const resized = resizeCard(currentState().card, 72);
  assert.ok(!('error' in resized));
  if ('error' in resized) return;
  setState({ card: resized });
  assert.equal(layoutNow(), '7 races: 1 of 10, 6 of 9');
  assert.equal(currentState().plannedRaces, 7);
  /* A bare count still splits on its own the even way. */
  assert.equal(describeLayout(cardLayout(64)), '8 races of 8');
});

test('a fresh night is a league of ten races of ten, 30 s, Standard surprises', () => {
  const s = freshState();
  assert.equal(s.card.races.length, 10);
  assert.equal(s.raceType, 'League');
  assert.equal(s.raceDurationMs, 30_000);
  assert.equal(s.intensity, 'standard');
  assert.equal(s.championshipScreens, false);
  /* An old night's forced "Heat" default reads as a league race; a Heat chosen since is kept. */
  const old: Record<string, unknown> = { ...s, raceType: 'Heat' };
  delete old.championshipScreens;
  assert.ok(restore(JSON.stringify(old)));
  assert.equal(currentState().raceType, 'League');
  assert.ok(restore(JSON.stringify({ ...s, raceType: 'Heat' })));
  assert.equal(currentState().raceType, 'Heat');
  assert.ok(restore(JSON.stringify({ ...s, raceType: 'Final', championshipScreens: true })));
  assert.equal(currentState().raceType, 'Final');
  assert.equal(currentState().championshipScreens, true);
});

test('the race count follows the run sheet, and quaddie legs stay on the card', async () => {
  const { addRace, freshCard, setRaceCount, runSheetLocks } = await import('../lib/card');
  assert.ok(restore(JSON.stringify(freshState())));
  setState({ card: addRace(freshCard()) });
  assert.equal(currentState().plannedRaces, 11);
  const short = setRaceCount(freshCard(), 6, runSheetLocks(freshCard(), { history: [] }));
  assert.ok(!('error' in short));
  if ('error' in short) return;
  setState({ card: short });
  assert.equal(currentState().plannedRaces, 6);
  assert.ok(currentState().quaddie.legs.every((leg) => leg <= 6));
});
