import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/live-env';
import {
  cleanName,
  createSession,
  endSession,
  isError,
  joinAllowed,
  joinSession,
  operatorSummary,
  placePick,
  playerState,
  react,
  settleRace,
  updateShow,
  LIVE_CHIP_START,
  type LiveShow,
} from '../lib/live/store';

const show = (over: Partial<LiveShow> = {}): LiveShow => ({
  eventName: 'Test Night',
  clubName: 'NDCC',
  raceNo: 1,
  phase: 'market',
  marketOpen: true,
  names: ['Turbo', 'Shelly', 'Gary'],
  odds: [2.5, 3, 4],
  result: null,
  rehearsal: false,
  ...over,
});

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

  /* More than the bank (with the refund counted) refuses. */
  const greedy = await placePick(code, j.playerId, j.token, 1, 1, 101, 'nonce-cccccccc');
  assert.ok(isError(greedy) && greedy.status === 409);
});

test('a closed market and a stale race number both refuse picks', async () => {
  const { code, operatorKey } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;

  const stale = await placePick(code, j.playerId, j.token, 7, 0, 10, 'nonce-dddddddd');
  assert.ok(isError(stale) && stale.status === 409);

  await updateShow(code, operatorKey, show({ marketOpen: false }));
  const closed = await placePick(code, j.playerId, j.token, 1, 0, 10, 'nonce-eeeeeeee');
  assert.ok(isError(closed) && closed.status === 409);
});

test('settlement pays locked odds exactly once', async () => {
  const { code, operatorKey } = await createSession(show());
  const j = await joinSession(code, 'Dave');
  assert.ok(!isError(j) && j.ok);
  if (isError(j) || !j.ok) return;
  await placePick(code, j.playerId, j.token, 1, 0, 40, 'nonce-ffffffff');

  const settled = await settleRace(code, operatorKey, 1, 0);
  assert.ok(!isError(settled) && settled.ok);
  if (isError(settled) || !settled.ok || settled.already) return assert.fail('first settle marked already');
  assert.equal(settled.winners, 1);
  assert.equal(settled.paid, 100); // 40 chips at the locked 2.5

  const again = await settleRace(code, operatorKey, 1, 2);
  assert.ok(!isError(again) && again.ok && again.already === true);

  const s = await playerState(code, j.playerId, j.token);
  assert.ok(!isError(s) && s.ok && !('unchanged' in s && s.unchanged));
  if (isError(s) || !s.ok || 'unchanged' in s) return;
  assert.equal(s.you?.chips, 160); // 100 - 40 + 100, and never paid twice
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

test('join flood control: 20 in the window, then refused', () => {
  const addr = '203.0.113.9';
  let allowed = 0;
  for (let i = 0; i < 25; i++) if (joinAllowed(addr)) allowed += 1;
  assert.equal(allowed, 20);
  assert.equal(joinAllowed('203.0.113.10'), true); // other addresses unaffected
});

test('display names lose control characters, keep spaces', () => {
  assert.equal(cleanName('Dave\u0000 S\u001b'), 'Dave S');
  assert.equal(cleanName('  Aunty Meg  '), 'Aunty Meg');
  assert.equal(cleanName('\u0007\u0008'), '');
  assert.equal(cleanName('x'.repeat(60)).length, 24);
});
