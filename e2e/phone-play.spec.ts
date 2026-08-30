import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

const NAMES = ['Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher'];
const ODDS = Object.fromEntries(NAMES.map((_, lane) => [lane, lane + 2]));
const PLAN_HASH = 'a'.repeat(64);
const openRooms = new Map<string, string>();

const show = (over: Record<string, unknown> = {}) => ({
  eventName: 'Acceptance Night',
  clubName: 'Newcomb & District Cricket Club',
  raceNo: 1,
  phase: 'market',
  marketOpen: true,
  names: NAMES,
  odds: ODDS,
  result: null,
  rehearsal: true,
  ...over,
});

const sameOriginHeaders = { Origin: 'http://127.0.0.1:3000' };
const joinAddressSalt = Date.now() % 200;
let joinAddressSequence = 0;
const operatorHeaders = (operatorKey: string) => ({
  ...sameOriginHeaders,
  Authorization: `Bearer ${operatorKey}`,
});

async function bodyOf(response: APIResponse): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function createRoom(request: APIRequestContext) {
  const response = await request.post('/api/live/session', {
    headers: sameOriginHeaders,
    data: { show: show() },
  });
  expect(response.ok()).toBe(true);
  const body = await bodyOf(response);
  expect(body).toMatchObject({ ok: true });
  expect(body.code).toMatch(/^[A-Z2-9]{6}$/);
  expect(body.operatorKey).toEqual(expect.any(String));
  expect(body.showRevision).toEqual(expect.any(Number));
  openRooms.set(body.code as string, body.operatorKey as string);
  return {
    code: body.code as string,
    operatorKey: body.operatorKey as string,
    showRevision: body.showRevision as number,
  };
}

async function join(request: APIRequestContext, code: string, name: string) {
  joinAddressSequence += 1;
  const response = await request.post('/api/live/join', {
    headers: {
      ...sameOriginHeaders,
      'x-real-ip': `198.51.${joinAddressSalt}.${joinAddressSequence}`,
    },
    data: { code, name },
  });
  expect(response.ok()).toBe(true);
  const body = await bodyOf(response);
  expect(body).toMatchObject({ ok: true, chips: 100, name });
  return { playerId: body.playerId as string, token: body.token as string };
}

async function lockRoom(
  request: APIRequestContext,
  room: { code: string; operatorKey: string; showRevision: number },
  commandId: string,
) {
  const response = await request.post('/api/live/lock', {
    headers: operatorHeaders(room.operatorKey),
    data: {
      code: room.code,
      raceNo: 1,
      show: show({ marketOpen: false }),
      planHash: PLAN_HASH,
      commandId,
      expectedShowRevision: room.showRevision,
    },
  });
  expect(response.ok()).toBe(true);
  const body = await bodyOf(response);
  expect(body).toMatchObject({ ok: true, raceStatus: 'LOCKED', planHash: PLAN_HASH });
  expect(typeof body.showRevision).toBe('number');
  expect(Number.isSafeInteger(body.showRevision as number)).toBe(true);
  return body as Record<string, unknown> & { showRevision: number };
}

async function runRoom(
  request: APIRequestContext,
  room: { code: string; operatorKey: string },
  showRevision: number,
  commandId: string,
) {
  const response = await request.post('/api/live/run', {
    headers: operatorHeaders(room.operatorKey),
    data: {
      code: room.code,
      raceNo: 1,
      planHash: PLAN_HASH,
      commandId,
      expectedShowRevision: showRevision,
    },
  });
  expect(response.ok()).toBe(true);
  const body = await bodyOf(response);
  expect(body).toMatchObject({ ok: true, raceStatus: 'RUNNING', planHash: PLAN_HASH });
  expect(typeof body.showRevision).toBe('number');
  expect(Number.isSafeInteger(body.showRevision as number)).toBe(true);
  return body;
}

async function endRoom(
  request: APIRequestContext,
  room: { code: string; operatorKey: string },
  commandId: string,
) {
  const response = await request.post('/api/live/end', {
    headers: operatorHeaders(room.operatorKey),
    data: { code: room.code, commandId },
  });
  expect(response.ok()).toBe(true);
  if (response.ok()) openRooms.delete(room.code);
}

test.afterEach(async ({ request }) => {
  const rooms = [...openRooms];
  openRooms.clear();
  await Promise.all(
    rooms.map(async ([code, operatorKey]) => {
      try {
        await request.post('/api/live/end', {
          headers: operatorHeaders(operatorKey),
          data: { code, commandId: `cleanup-${code}` },
        });
      } catch {
        /* Best-effort cleanup must not hide the test's original failure. */
      }
    }),
  );
});

test('acknowledged Phone Play lock rejects late picks and preserves the accepted pick', async (
  { request },
  testInfo,
) => {
  test.skip(testInfo.project.name !== 'projector', 'API contract runs once per server build');
  const room = await createRoom(request);
  const player = await join(request, room.code, 'Dave');

  const accepted = await request.post('/api/live/pick', {
    headers: sameOriginHeaders,
    data: {
      code: room.code,
      ...player,
      raceNo: 1,
      lane: 0,
      chips: 25,
      nonce: 'e2e-before-lock-0001',
    },
  });
  expect(accepted.ok()).toBe(true);

  await lockRoom(request, room, 'lock-route-acceptance-0001');

  const late = await request.post('/api/live/pick', {
    headers: sameOriginHeaders,
    data: {
      code: room.code,
      ...player,
      raceNo: 1,
      lane: 7,
      chips: 10,
      nonce: 'e2e-after-lock-0001',
    },
  });
  expect(late.status()).toBe(409);
  expect(await bodyOf(late)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/locked/i),
  });

  const stateResponse = await request.get('/api/live/state', {
    params: { code: room.code, playerId: player.playerId },
    headers: { Authorization: `Bearer ${player.token}` },
  });
  expect(stateResponse.ok()).toBe(true);
  const state = await bodyOf(stateResponse);
  expect(state.raceStatus).toBe('LOCKED');
  expect((state.show as { marketOpen: boolean }).marketOpen).toBe(false);
  expect(state.you).toMatchObject({ chips: 75, pick: { lane: 0, chips: 25, odds: 2 } });

  await endRoom(request, room, 'end-route-lock-test-0001');
});

test('concurrent Phone Play settlement requests create one receipt and one payout', async (
  { request },
  testInfo,
) => {
  test.skip(testInfo.project.name !== 'projector', 'API contract runs once per server build');
  const room = await createRoom(request);
  const winner = await join(request, room.code, 'Meg');
  const other = await join(request, room.code, 'Sam');

  for (const [player, lane, nonce] of [
    [winner, 0, 'e2e-winner-pick-0001'],
    [other, 7, 'e2e-other-pick-00001'],
  ] as const) {
    const response = await request.post('/api/live/pick', {
      headers: sameOriginHeaders,
      data: { code: room.code, ...player, raceNo: 1, lane, chips: 25, nonce },
    });
    expect(response.ok()).toBe(true);
  }

  const locked = await lockRoom(request, room, 'lock-route-settlement-0001');
  await runRoom(request, room, locked.showRevision, 'run-route-settlement-0001');

  const commandIds = ['settle-route-concurrent-a', 'settle-route-concurrent-b'];
  const responses = await Promise.all([
    request.post('/api/live/settle', {
      headers: operatorHeaders(room.operatorKey),
      data: { code: room.code, raceNo: 1, winnerLane: 0, commandId: commandIds[0] },
    }),
    request.post('/api/live/settle', {
      headers: operatorHeaders(room.operatorKey),
      data: { code: room.code, raceNo: 1, winnerLane: 0, commandId: commandIds[1] },
    }),
  ]);
  expect(responses.every((response) => response.ok())).toBe(true);
  const receipts = await Promise.all(responses.map(bodyOf));
  expect(receipts.filter((receipt) => receipt.already !== true)).toHaveLength(1);
  expect(receipts.filter((receipt) => receipt.already === true)).toHaveLength(1);
  const firstIndex = receipts.findIndex((receipt) => receipt.already !== true);
  const first = receipts.find((receipt) => receipt.already !== true);
  expect(first).toMatchObject({
    ok: true,
    winners: 1,
    paid: 50,
  });

  const winnerState = await bodyOf(
    await request.get('/api/live/state', {
      params: { code: room.code, playerId: winner.playerId },
      headers: { Authorization: `Bearer ${winner.token}` },
    }),
  );
  const otherState = await bodyOf(
    await request.get('/api/live/state', {
      params: { code: room.code, playerId: other.playerId },
      headers: { Authorization: `Bearer ${other.token}` },
    }),
  );
  expect((winnerState.you as { chips: number }).chips).toBe(125);
  expect((otherState.you as { chips: number }).chips).toBe(75);

  const replayResponse = await request.post('/api/live/settle', {
    headers: operatorHeaders(room.operatorKey),
    data: {
      code: room.code,
      raceNo: 1,
      winnerLane: 0,
      commandId: commandIds[firstIndex],
    },
  });
  expect(replayResponse.ok()).toBe(true);
  expect(await bodyOf(replayResponse)).toEqual(receipts[firstIndex]);

  const conflict = await request.post('/api/live/settle', {
    headers: operatorHeaders(room.operatorKey),
    data: {
      code: room.code,
      raceNo: 1,
      winnerLane: 7,
      commandId: 'settle-route-wrong-winner',
    },
  });
  expect(conflict.status()).toBe(409);
  expect(await bodyOf(conflict)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/different winner/i),
  });

  await endRoom(request, room, 'end-route-settlement-0001');
});
