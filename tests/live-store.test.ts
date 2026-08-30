import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import './helpers/live-env';
import {
  cleanName,
  createSession,
  endSession,
  isError,
  joinAllowed,
  joinSession,
  lockRace,
  operatorSummary,
  placePick,
  playerState,
  react,
  rearmRace,
  runRace,
  settleRace,
  updateShow,
  voidRace,
  LIVE_CHIP_START,
  type LiveShow,
} from '../lib/live/store';

const show = (over: Partial<LiveShow> = {}): LiveShow => ({
  eventName: 'Test Night',
  clubName: 'NDCC',
  raceNo: 1,
  phase: 'market',
  marketOpen: true,
  names: ['Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher'],
  odds: [2.5, 3, 4, 5, 6, 7, 8, 9],
  result: null,
  rehearsal: false,
  ...over,
});

const PLAN_HASH_A = 'a'.repeat(64);

interface LifecycleAck {
  ok: true;
  revision: number;
  showRevision: number;
  raceStatus: string;
  raceAttempt: number;
  refundedPlayers?: number;
  refundedChips?: number;
}

function assertLifecycleAck(value: unknown, status: string): asserts value is LifecycleAck {
  const ack = value as Partial<LifecycleAck> | null;
  assert.ok(
    !isError(value) &&
      typeof value === 'object' &&
      value !== null &&
      'ok' in value &&
      value.ok === true,
    `expected ${status} acknowledgement`,
  );
  assert.equal(ack?.raceStatus, status);
  assert.equal(typeof ack?.revision, 'number');
  assert.equal(typeof ack?.showRevision, 'number');
  assert.equal(typeof ack?.raceAttempt, 'number');
  assert.ok(Number.isSafeInteger(ack.revision));
  assert.ok(Number.isSafeInteger(ack.showRevision));
  assert.ok(Number.isSafeInteger(ack.raceAttempt));
}

async function lockAndRun(
  code: string,
  operatorKey: string,
  showRevision: number,
  commandSuffix: string,
) {
  const locked = await lockRace(
    code,
    operatorKey,
    1,
    show({ marketOpen: false }),
    PLAN_HASH_A,
    `lock-${commandSuffix}`,
    showRevision,
  );
  assertLifecycleAck(locked, 'LOCKED');
  const running = await runRace(
    code,
    operatorKey,
    1,
    PLAN_HASH_A,
    `run-${commandSuffix}`,
    locked.showRevision,
  );
  assertLifecycleAck(running, 'RUNNING');
  return { locked, running };
}

test('phones join with the code and start on the fun-chip float', async () => {
  const { code, operatorKey } = await createSession(show());
  assert.match(code, /^[A-Z2-9]{6}$/);
  const joined = await joinSession(code, 'Dave');
  assert.ok(!isError(joined) && joined.ok);
  if (isError(joined) || !joined.ok) return;
  assert.equal(joined.chips, LIVE_CHIP_START);

  /* The operator key never appears in the player surface. */
  const state = await playerState(code, joined.playerId, joined.token);
  assert.ok(!JSON.stringify(state).includes(operatorKey));
});

test('a PIN-locked room refuses the wrong PIN', async () => {
  const { code } = await createSession(show(), '4321');
  const wrong = await joinSession(code, 'Mallory', '1111');
  assert.ok(isError(wrong) && wrong.status === 403);
  const right = await joinSession(code, 'Dave', '4321');
  assert.ok(!isError(right));
});

test('the pick path: hold, idempotent nonce, replace with refund, bank limit', async () => {
  const { code } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;

  const first = await placePick(code, j.playerId, j.token, 1, 0, 60, 'nonce-aaaaaaaa');
  assert.ok(!isError(first) && first.ok);
  if (isError(first) || !first.ok) return;
  assert.equal(first.bank, 40);

  /* Same nonce again: the duplicate submit, no double spend. */
  const dup = await placePick(code, j.playerId, j.token, 1, 0, 60, 'nonce-aaaaaaaa');
  assert.ok(!isError(dup) && dup.ok && dup.duplicate === true && dup.bank === 40);

  /* A changed mind: the held chips come back before the new hold. */
  const changed = await placePick(code, j.playerId, j.token, 1, 2, 90, 'nonce-bbbbbbbb');
  assert.ok(!isError(changed) && changed.ok);
  if (isError(changed) || !changed.ok) return;
  assert.equal(changed.bank, 10);

  /* A-B-A replay returns A's exact receipt but must not undo the newer B pick. */
  const replayedFirst = await placePick(code, j.playerId, j.token, 1, 0, 60, 'nonce-aaaaaaaa');
  assert.ok(
    !isError(replayedFirst) &&
      replayedFirst.ok &&
      replayedFirst.duplicate === true &&
      replayedFirst.bank === 40,
  );
  const afterReplay = await playerState(code, j.playerId, j.token);
  assert.ok(!isError(afterReplay) && afterReplay.ok && !('unchanged' in afterReplay && afterReplay.unchanged));
  if (isError(afterReplay) || !afterReplay.ok || 'unchanged' in afterReplay) return;
  assert.equal(afterReplay.you?.chips, 10);
  assert.equal(afterReplay.you?.pick?.lane, 2);
  assert.equal(afterReplay.you?.pick?.chips, 90);

  /* More than the bank (with the refund counted) refuses. */
  const greedy = await placePick(code, j.playerId, j.token, 1, 1, 101, 'nonce-cccccccc');
  assert.ok(isError(greedy) && greedy.status === 409);
});

test('a closed market and a stale race number both refuse picks', async () => {
  const { code, operatorKey, showRevision } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;

  const stale = await placePick(code, j.playerId, j.token, 7, 0, 10, 'nonce-dddddddd');
  assert.ok(isError(stale) && stale.status === 409);

  const skippedLock = await updateShow(
    code,
    operatorKey,
    show({ marketOpen: false }),
    'show-skip-lock-0001',
    showRevision,
  );
  assert.ok(isError(skippedLock) && skippedLock.status === 409);

  const locked = await lockRace(
    code,
    operatorKey,
    1,
    show({ marketOpen: false }),
    PLAN_HASH_A,
    'lock-closed-picks-0001',
    showRevision,
  );
  assertLifecycleAck(locked, 'LOCKED');
  const closed = await placePick(code, j.playerId, j.token, 1, 0, 10, 'nonce-eeeeeeee');
  assert.ok(isError(closed) && closed.status === 409);
});

test('an acknowledged market lock rejects every later pick without changing the bank', async () => {
  const { code, operatorKey, showRevision } = await createSession(show());
  const joined = await joinSession(code, 'Dave');
  assert.ok(!isError(joined) && joined.ok);
  if (isError(joined) || !joined.ok) return;

  const accepted = await placePick(
    code,
    joined.playerId,
    joined.token,
    1,
    0,
    25,
    'nonce-lock-before',
  );
  assert.ok(!isError(accepted) && accepted.ok);

  const lock = await lockRace(
    code,
    operatorKey,
    1,
    show({ marketOpen: false }),
    PLAN_HASH_A,
    'lock-acknowledged-0001',
    showRevision,
  );
  assertLifecycleAck(lock, 'LOCKED');

  const prematureSettlement = await settleRace(
    code,
    operatorKey,
    1,
    0,
    'settle-while-locked-0001',
  );
  assert.ok(isError(prematureSettlement) && prematureSettlement.status === 409);

  const late = await Promise.all(
    [1, 2, 3].map((lane) =>
      placePick(
        code,
        joined.playerId,
        joined.token,
        1,
        lane,
        10,
        `nonce-after-lock-${lane}`,
      ),
    ),
  );
  assert.ok(late.every((result) => isError(result) && result.status === 409));

  const state = await playerState(code, joined.playerId, joined.token);
  assert.ok(!isError(state) && state.ok && !('unchanged' in state && state.unchanged));
  if (isError(state) || !state.ok || 'unchanged' in state) return;
  assert.equal(state.you?.chips, LIVE_CHIP_START - 25);
  assert.equal(state.you?.pick?.lane, 0);
  assert.equal(state.you?.pick?.chips, 25);
});

test('settlement pays locked odds exactly once', async () => {
  const { code, operatorKey, showRevision } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;
  await placePick(code, j.playerId, j.token, 1, 0, 40, 'nonce-ffffffff');

  const openSettlement = await settleRace(code, operatorKey, 1, 0, 'settle-while-open-0001');
  assert.ok(isError(openSettlement) && openSettlement.status === 409);

  const locked = await lockRace(
    code,
    operatorKey,
    1,
    show({ marketOpen: false }),
    PLAN_HASH_A,
    'lock-settlement-0001',
    showRevision,
  );
  assertLifecycleAck(locked, 'LOCKED');
  const lockedSettlement = await settleRace(
    code,
    operatorKey,
    1,
    0,
    'settle-before-run-0001',
  );
  assert.ok(isError(lockedSettlement) && lockedSettlement.status === 409);

  const running = await runRace(
    code,
    operatorKey,
    1,
    PLAN_HASH_A,
    'run-settlement-0001',
    locked.showRevision,
  );
  assertLifecycleAck(running, 'RUNNING');

  const settled = await settleRace(code, operatorKey, 1, 0, 'settle-race-one-0001');
  assert.ok(!isError(settled) && settled.ok);
  if (isError(settled) || !settled.ok || settled.already) return assert.fail('first settle marked already');
  assert.equal(settled.winners, 1);
  assert.equal(settled.paid, 100); // 40 chips at the locked 2.5

  const stableReplay = await settleRace(code, operatorKey, 1, 0, 'settle-race-one-0001');
  assert.deepEqual(stableReplay, settled);

  const reusedCommand = await settleRace(code, operatorKey, 1, 2, 'settle-race-one-0001');
  assert.ok(isError(reusedCommand) && reusedCommand.status === 409);
  const differentWinner = await settleRace(code, operatorKey, 1, 2, 'settle-wrong-winner-0001');
  assert.ok(isError(differentWinner) && differentWinner.status === 409);

  const sameWinner = await settleRace(code, operatorKey, 1, 0, 'settle-same-winner-0001');
  assert.ok(!isError(sameWinner) && sameWinner.ok && sameWinner.already === true);

  const s = await playerState(code, j.playerId, j.token);
  assert.ok(!isError(s) && s.ok && !('unchanged' in s && s.unchanged));
  if (isError(s) || !s.ok || 'unchanged' in s) return;
  assert.equal(s.you?.chips, 160); // 100 - 40 + 100, and never paid twice
});

test('concurrent settlement commands produce one settlement receipt and one payout', async () => {
  const { code, operatorKey, showRevision } = await createSession(show());
  const joined = await joinSession(code, 'Dave');
  assert.ok(!isError(joined) && joined.ok);
  if (isError(joined) || !joined.ok) return;

  const pick = await placePick(
    code,
    joined.playerId,
    joined.token,
    1,
    0,
    40,
    'nonce-concurrent-settle',
  );
  assert.ok(!isError(pick) && pick.ok);
  await lockAndRun(code, operatorKey, showRevision, 'concurrent-0001');

  const attempts = await Promise.all([
    settleRace(code, operatorKey, 1, 0, 'settle-concurrent-first'),
    settleRace(code, operatorKey, 1, 7, 'settle-concurrent-wrong-a'),
    settleRace(code, operatorKey, 1, 7, 'settle-concurrent-wrong-b'),
  ]);
  const successful = attempts.filter((result) => !isError(result));
  const rejected = attempts.filter(isError);
  assert.equal(successful.length, 1);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((result) => result.status === 409));

  const stableReplay = await settleRace(
    code,
    operatorKey,
    1,
    0,
    'settle-concurrent-first',
  );
  assert.deepEqual(stableReplay, attempts[0]);

  const state = await playerState(code, joined.playerId, joined.token);
  assert.ok(!isError(state) && state.ok && !('unchanged' in state && state.unchanged));
  if (isError(state) || !state.ok || 'unchanged' in state) return;
  assert.equal(state.you?.chips, 160);
});

test('void refunds one attempt and rearm opens the same race as a new attempt', async () => {
  const { code, operatorKey, showRevision } = await createSession(show());
  const joined = await joinSession(code, 'Dave');
  assert.ok(!isError(joined) && joined.ok);
  if (isError(joined) || !joined.ok) return;

  const pick = await placePick(
    code,
    joined.playerId,
    joined.token,
    1,
    0,
    30,
    'nonce-void-attempt-a',
  );
  assert.ok(!isError(pick) && pick.ok && pick.bank === 70);

  const { running } = await lockAndRun(code, operatorKey, showRevision, 'void-attempt-0001');
  const voided = await voidRace(
    code,
    operatorKey,
    1,
    PLAN_HASH_A,
    'Moderator safety stop',
    'void-attempt-0001',
    running.showRevision,
  );
  assertLifecycleAck(voided, 'VOID');
  assert.equal(voided.raceAttempt, 1);
  assert.equal(voided.refundedPlayers, 1);
  assert.equal(voided.refundedChips, 30);

  const stableVoidReplay = await voidRace(
    code,
    operatorKey,
    1,
    PLAN_HASH_A,
    'Moderator safety stop',
    'void-attempt-0001',
    running.showRevision,
  );
  assert.deepEqual(stableVoidReplay, voided);

  const afterVoid = await playerState(code, joined.playerId, joined.token);
  assert.ok(!isError(afterVoid) && afterVoid.ok && !('unchanged' in afterVoid && afterVoid.unchanged));
  if (isError(afterVoid) || !afterVoid.ok || 'unchanged' in afterVoid) return;
  assert.equal(afterVoid.raceStatus, 'VOID');
  assert.equal(afterVoid.raceAttempt, 1);
  assert.equal(afterVoid.you?.chips, LIVE_CHIP_START);
  assert.equal(afterVoid.you?.pick?.settled, true);
  assert.equal(afterVoid.you?.pick?.returned, 30);

  const settleVoid = await settleRace(code, operatorKey, 1, 0, 'settle-void-attempt-0001');
  assert.ok(isError(settleVoid) && settleVoid.status === 409);

  const rearmed = await rearmRace(
    code,
    operatorKey,
    1,
    show(),
    'rearm-attempt-0001',
    voided.showRevision,
  );
  assertLifecycleAck(rearmed, 'OPEN');
  assert.equal(rearmed.raceAttempt, 2);

  const stableRearmReplay = await rearmRace(
    code,
    operatorKey,
    1,
    show(),
    'rearm-attempt-0001',
    voided.showRevision,
  );
  assert.deepEqual(stableRearmReplay, rearmed);

  const afterRearm = await playerState(code, joined.playerId, joined.token);
  assert.ok(!isError(afterRearm) && afterRearm.ok && !('unchanged' in afterRearm && afterRearm.unchanged));
  if (isError(afterRearm) || !afterRearm.ok || 'unchanged' in afterRearm) return;
  assert.equal(afterRearm.raceStatus, 'OPEN');
  assert.equal(afterRearm.raceAttempt, 2);
  assert.equal(afterRearm.you?.chips, LIVE_CHIP_START);
  assert.equal(afterRearm.you?.pick, null);

  const duplicateRearm = await rearmRace(
    code,
    operatorKey,
    1,
    show(),
    'rearm-attempt-0002',
    rearmed.showRevision,
  );
  assert.ok(isError(duplicateRearm) && duplicateRearm.status === 409);
});

test('operator endpoints refuse a wrong or truncated key', async () => {
  const { code, operatorKey } = await createSession(show());
  for (const bad of ['wrong-key', operatorKey.slice(0, -1), '', 42 as unknown as string]) {
    const r = await updateShow(code, bad, show());
    assert.ok(isError(r) && r.status === 403, `key ${String(bad).slice(0, 8)} was accepted`);
  }
  const summary = await operatorSummary(code, operatorKey, 0);
  assert.ok(!isError(summary) && summary.ok);
});

test('reactions are throttled per phone, silently', async () => {
  const { code } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;
  const first = await react(code, j.playerId, j.token, 'cheer');
  assert.ok(!isError(first) && first.ok && !('throttled' in first && first.throttled));
  const second = await react(code, j.playerId, j.token, 'cheer');
  assert.ok(!isError(second) && second.ok && 'throttled' in second && second.throttled === true);
  const unknown = await react(code, j.playerId, j.token, 'riot');
  assert.ok(isError(unknown) && unknown.status === 400);
});

test('the poll short-circuits when nothing changed', async () => {
  const { code } = await createSession(show());
  const a = await playerState(code);
  assert.ok(!isError(a) && a.ok && !('unchanged' in a && a.unchanged));
  if (isError(a) || !a.ok) return;
  const b = await playerState(code, undefined, undefined, a.revision);
  assert.ok(!isError(b) && b.ok && 'unchanged' in b && b.unchanged === true);
});

test('player and operator reads do not rewrite the durable session file', async () => {
  const { code, operatorKey } = await createSession(show());
  const joined = await joinSession(code, 'Dave');
  assert.ok(!isError(joined) && joined.ok);
  if (isError(joined) || !joined.ok) return;

  const dataDir = process.env.SNAILRACE_DATA_DIR;
  assert.ok(dataDir, 'isolated live-store directory was not configured');
  const sessionFile = path.join(dataDir, `${code}.json`);
  const beforeStat = await fs.stat(sessionFile);
  const beforeContents = await fs.readFile(sessionFile, 'utf8');

  const state = await playerState(code, joined.playerId, joined.token);
  assert.ok(!isError(state) && state.ok);
  const summary = await operatorSummary(code, operatorKey, 0);
  assert.ok(!isError(summary) && summary.ok);

  const afterStat = await fs.stat(sessionFile);
  const afterContents = await fs.readFile(sessionFile, 'utf8');
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  assert.equal(afterContents, beforeContents);
});

test('a stolen player id without its token sees nothing personal', async () => {
  const { code } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;
  const spoofed = await playerState(code, j.playerId, 'not-the-token');
  assert.ok(!isError(spoofed) && spoofed.ok);
  if (isError(spoofed) || !spoofed.ok || 'unchanged' in spoofed) return;
  assert.equal(spoofed.you, null);
  const pick = await placePick(code, j.playerId, 'not-the-token', 1, 0, 10, 'nonce-gggggggg');
  assert.ok(isError(pick) && pick.status === 401);
});

test('unknown codes and malformed codes are refused', async () => {
  const missing = await playerState('ZZZZZZ');
  assert.ok(isError(missing) && missing.status === 404);
  const malformed = await playerState('abc');
  assert.ok(isError(malformed) && malformed.status === 400);
});

test('ending the room needs the operator key and tells every later call 410', async () => {
  const { code, operatorKey } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;

  const spoofed = await endSession(code, 'not-the-key');
  assert.ok(isError(spoofed) && spoofed.status === 403);

  const ended = await endSession(code, operatorKey);
  assert.ok(!isError(ended) && ended.ok);

  const poll = await playerState(code, j.playerId, j.token);
  assert.ok(isError(poll) && poll.status === 410);
  const late = await joinSession(code, 'Latecomer');
  assert.ok(isError(late) && late.status === 410);
});

test('join admission supports a shared venue address and retains an abuse ceiling', () => {
  const addr = '203.0.113.9';
  for (let i = 0; i < 25; i++) assert.equal(joinAllowed(addr), true);
  let allowed = 0;
  for (let i = 25; i < 380; i++) if (joinAllowed(addr)) allowed += 1;
  assert.equal(allowed, 335);
  assert.equal(joinAllowed(addr), false);
  assert.equal(joinAllowed('203.0.113.10'), true); // other addresses unaffected
});

test('display names lose control characters, keep spaces', () => {
  assert.equal(cleanName('Dave\u0000 S\u001b'), 'Dave S');
  assert.equal(cleanName('  Aunty Meg  '), 'Aunty Meg');
  assert.equal(cleanName('\u0007\u0008'), '');
  assert.equal(cleanName('x'.repeat(60)).length, 24);
});
