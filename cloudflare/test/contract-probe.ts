import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { default: worker, RaceRoom, RateGate } = await import('../src/index');

const clone = <T>(value: T): T => structuredClone(value);

class MemoryStorage {
  private values = new Map<string, unknown>();
  private tail: Promise<unknown> = Promise.resolve();
  writes = 0;

  async get<T>(key: string): Promise<T | undefined>;
  async get<T>(keys: string[]): Promise<Map<string, T>>;
  async get<T>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      return new Map(
        keyOrKeys.flatMap((key) => {
          const value = this.values.get(key);
          return value === undefined ? [] : [[key, clone(value as T)] as [string, T]];
        }),
      );
    }
    const value = this.values.get(keyOrKeys);
    return value === undefined ? undefined : clone(value as T);
  }

  async put<T>(key: string, value: T): Promise<void>;
  async put(entries: Record<string, unknown>): Promise<void>;
  async put<T>(keyOrEntries: string | Record<string, unknown>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.values.set(keyOrEntries, clone(value));
      this.writes += 1;
      return;
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) {
      this.values.set(key, clone(entry));
      this.writes += 1;
    }
  }

  async delete(key: string): Promise<boolean> {
    const removed = this.values.delete(key);
    if (removed) this.writes += 1;
    return removed;
  }

  async deleteAll(): Promise<void> {
    if (this.values.size) this.writes += 1;
    this.values.clear();
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? '';
    return new Map(
      [...this.values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, clone(value as T)]),
    );
  }

  transaction<T>(callback: (transaction: MemoryStorage) => Promise<T>): Promise<T> {
    const run = this.tail.then(() => callback(this));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async setAlarm(_scheduledTime: number | Date): Promise<void> {
    // The probe keeps rooms for its own lifetime.
  }
}

class MemoryId {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
  toString(): string {
    return this.name;
  }
}

interface Fetchable {
  fetch(request: Request): Promise<Response>;
  alarm?(): Promise<void>;
}

class MemoryNamespace {
  private objects = new Map<string, { object: Fetchable; storage: MemoryStorage }>();
  private factory: (state: { storage: MemoryStorage }) => Fetchable;

  constructor(factory: (state: { storage: MemoryStorage }) => Fetchable) {
    this.factory = factory;
  }

  idFromName(name: string): MemoryId {
    return new MemoryId(name);
  }

  get(id: MemoryId) {
    let entry = this.objects.get(id.name);
    if (!entry) {
      const storage = new MemoryStorage();
      entry = { object: this.factory({ storage }), storage };
      this.objects.set(id.name, entry);
    }
    return {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        entry!.object.fetch(input instanceof Request ? input : new Request(input, init)),
    };
  }

  storage(name: string): MemoryStorage {
    const entry = this.objects.get(name);
    assert.ok(entry, `missing in-memory object ${name}`);
    return entry.storage;
  }

  object(name: string): Fetchable {
    const entry = this.objects.get(name);
    assert.ok(entry, `missing in-memory object ${name}`);
    return entry.object;
  }
}

const allowedOrigin = 'https://club.example';
let env: {
  RACE_ROOM: MemoryNamespace;
  RATE_GATE: MemoryNamespace;
  ALLOWED_ORIGINS: string;
};
const roomNamespace = new MemoryNamespace((state) => new RaceRoom(state, env));
const rateNamespace = new MemoryNamespace((state) => new RateGate(state, env));
env = {
  RACE_ROOM: roomNamespace,
  RATE_GATE: rateNamespace,
  ALLOWED_ORIGINS: allowedOrigin,
};

const names = ['Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher'];
const odds = Object.fromEntries(names.map((_, lane) => [lane, lane + 2]));
const planHash = 'a'.repeat(64);

const show = (over: Record<string, unknown> = {}) => ({
  eventName: 'Contract Night',
  clubName: 'Newcomb and District Cricket Club',
  raceNo: 1,
  phase: 'market',
  marketOpen: true,
  names,
  odds,
  result: null,
  rehearsal: true,
  ...over,
});

const health = await worker.fetch(
  new Request('https://worker.example/api/live/health', {
    headers: { Origin: allowedOrigin },
  }),
  env,
);
assert.equal(health.status, 200);
assert.equal(health.headers.get('access-control-allow-origin'), allowedOrigin);
assert.deepEqual(await health.json(), { ok: true, service: 'snailrace-live', schema: 1 });

async function call(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    origin?: string;
    operatorKey?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const method = options.method ?? (options.body ? 'POST' : 'GET');
  const headers = new Headers(options.headers ?? {});
  headers.set('Origin', options.origin ?? allowedOrigin);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (options.operatorKey) headers.set('Authorization', `Bearer ${options.operatorKey}`);
  const response = await worker.fetch(
    new Request(`https://worker.example${path}`, {
      method,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }),
    env,
  );
  const body = response.status === 204 ? null : ((await response.json()) as Record<string, unknown>);
  return { response, body };
}

async function createRoom() {
  const created = await call('/api/live/session', { body: { show: show() } });
  assert.equal(created.response.status, 200);
  assert.equal(created.body?.ok, true);
  assert.match(String(created.body?.code), /^[A-Z2-9]{6}$/);
  assert.equal(typeof created.body?.operatorKey, 'string');
  return {
    code: String(created.body?.code),
    operatorKey: String(created.body?.operatorKey),
    showRevision: Number(created.body?.showRevision),
  };
}

async function joinRoom(code: string, name = 'Meg') {
  const joined = await call('/api/live/join', { body: { code, name } });
  assert.equal(joined.response.status, 200);
  assert.equal(joined.body?.chips, 100);
  return {
    playerId: String(joined.body?.playerId),
    token: String(joined.body?.token),
  };
}

const preflight = await worker.fetch(
  new Request('https://worker.example/api/live/session', {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, authorization, cache-control',
    },
  }),
  env,
);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);

const foreign = await call('/api/live/session', {
  body: { show: show() },
  origin: 'https://foreign.example',
});
assert.equal(foreign.response.status, 403);

const room = await createRoom();
const player = await joinRoom(room.code);

const blindState = await call('/api/live/state', {
  operatorKey: room.operatorKey,
  body: {
    code: room.code,
    show: show(),
    commandId: 'probe-blind-state',
  },
});
assert.equal(blindState.response.status, 400);

const picked = await call('/api/live/pick', {
  body: {
    code: room.code,
    ...player,
    raceNo: 1,
    lane: 0,
    chips: 25,
    nonce: 'probe-pick-0001',
  },
});
assert.equal(picked.response.status, 200);
assert.equal(picked.body?.bank, 75);

const locked = await call('/api/live/lock', {
  operatorKey: room.operatorKey,
  body: {
    code: room.code,
    raceNo: 1,
    show: show({ phase: 'race', marketOpen: false }),
    planHash,
    commandId: 'probe-lock-0001',
    expectedShowRevision: room.showRevision,
  },
});
assert.equal(locked.response.status, 200);
assert.equal(locked.body?.raceStatus, 'LOCKED');

const latePick = await call('/api/live/pick', {
  body: {
    code: room.code,
    ...player,
    raceNo: 1,
    lane: 7,
    chips: 10,
    nonce: 'probe-late-0001',
  },
});
assert.equal(latePick.response.status, 409);

const lockConflict = await call('/api/live/lock', {
  operatorKey: room.operatorKey,
  body: {
    code: room.code,
    raceNo: 1,
    show: show({ phase: 'race', marketOpen: false }),
    planHash: 'b'.repeat(64),
    commandId: 'probe-lock-0001',
    expectedShowRevision: room.showRevision,
  },
});
assert.equal(lockConflict.response.status, 409);

const running = await call('/api/live/run', {
  operatorKey: room.operatorKey,
  body: {
    code: room.code,
    raceNo: 1,
    planHash,
    commandId: 'probe-run-00001',
    expectedShowRevision: locked.body?.showRevision,
  },
});
assert.equal(running.response.status, 200);
assert.equal(running.body?.raceStatus, 'RUNNING');

const settlementRequest = {
  code: room.code,
  raceNo: 1,
  winnerLane: 0,
  commandId: 'probe-settle-0001',
};
const settled = await call('/api/live/settle', {
  operatorKey: room.operatorKey,
  body: settlementRequest,
});
assert.equal(settled.response.status, 200);
assert.equal(settled.body?.paid, 50);

const replayed = await call('/api/live/settle', {
  operatorKey: room.operatorKey,
  body: settlementRequest,
});
assert.deepEqual(replayed.body, settled.body);

const wrongWinner = await call('/api/live/settle', {
  operatorKey: room.operatorKey,
  body: { ...settlementRequest, winnerLane: 7, commandId: 'probe-settle-wrong' },
});
assert.equal(wrongWinner.response.status, 409);

const stateBefore = roomNamespace.storage(room.code).writes;
const state = await call(
  `/api/live/state?${new URLSearchParams({ code: room.code, playerId: player.playerId })}`,
  { operatorKey: player.token },
);
assert.equal(state.response.status, 200);
assert.equal(typeof state.body?.showRevision, 'number');
assert.equal((state.body?.you as { chips: number }).chips, 125);
assert.equal(roomNamespace.storage(room.code).writes, stateBefore);

const voidRoom = await createRoom();
const voidPlayer = await joinRoom(voidRoom.code, 'Dave');
await call('/api/live/pick', {
  body: {
    code: voidRoom.code,
    ...voidPlayer,
    raceNo: 1,
    lane: 2,
    chips: 40,
    nonce: 'probe-void-pick',
  },
});
const voidLock = await call('/api/live/lock', {
  operatorKey: voidRoom.operatorKey,
  body: {
    code: voidRoom.code,
    raceNo: 1,
    show: show({ phase: 'race', marketOpen: false }),
    planHash,
    commandId: 'probe-void-lock',
    expectedShowRevision: voidRoom.showRevision,
  },
});
const voidRun = await call('/api/live/run', {
  operatorKey: voidRoom.operatorKey,
  body: {
    code: voidRoom.code,
    raceNo: 1,
    planHash,
    commandId: 'probe-void-run1',
    expectedShowRevision: voidLock.body?.showRevision,
  },
});
const voided = await call('/api/live/void', {
  operatorKey: voidRoom.operatorKey,
  body: {
    code: voidRoom.code,
    raceNo: 1,
    planHash,
    reason: 'Probe void before a finisher.',
    commandId: 'probe-void-00001',
    expectedShowRevision: voidRun.body?.showRevision,
  },
});
assert.equal(voided.response.status, 200);
assert.equal(voided.body?.refundedChips, 40);

const rearmed = await call('/api/live/rearm', {
  operatorKey: voidRoom.operatorKey,
  body: {
    code: voidRoom.code,
    raceNo: 1,
    show: show({ phase: 'race', marketOpen: true }),
    commandId: 'probe-rearm-0001',
    expectedShowRevision: voided.body?.showRevision,
  },
});
assert.equal(rearmed.response.status, 200);
assert.equal(rearmed.body?.raceAttempt, 2);

const refundedState = await call(
  `/api/live/state?${new URLSearchParams({ code: voidRoom.code, playerId: voidPlayer.playerId })}`,
  { operatorKey: voidPlayer.token },
);
assert.equal((refundedState.body?.you as { chips: number }).chips, 100);
assert.equal((refundedState.body?.you as { pick: unknown }).pick, null);

/* A hall's phones usually share one NAT address. The 21st and later attendee
   must remain admissible, but an invalid-code flood still has a durable end. */
const crowdRoom = await createRoom();
const crowdPlayers: { playerId: string; token: string }[] = [];
for (let attendee = 1; attendee <= 129; attendee += 1) {
  const joined = await call('/api/live/join', {
    body: { code: crowdRoom.code, name: `Guest ${attendee}` },
  });
  assert.equal(joined.response.status, 200);
  crowdPlayers.push({
    playerId: String(joined.body?.playerId),
    token: String(joined.body?.token),
  });
}

const crowdPicks = await Promise.all(
  crowdPlayers.map((identity, index) =>
    call('/api/live/pick', {
      body: {
        code: crowdRoom.code,
        ...identity,
        raceNo: 1,
        lane: 0,
        chips: 25,
        nonce: `crowd-pick-${String(index).padStart(4, '0')}`,
      },
    }),
  ),
);
assert.ok(crowdPicks.every(({ response }) => response.status === 200));
const crowdLock = await call('/api/live/lock', {
  operatorKey: crowdRoom.operatorKey,
  body: {
    code: crowdRoom.code,
    raceNo: 1,
    show: show({ phase: 'race', marketOpen: false }),
    planHash,
    commandId: 'crowd-lock-0001',
    expectedShowRevision: crowdRoom.showRevision,
  },
});
const crowdRun = await call('/api/live/run', {
  operatorKey: crowdRoom.operatorKey,
  body: {
    code: crowdRoom.code,
    raceNo: 1,
    planHash,
    commandId: 'crowd-run-00001',
    expectedShowRevision: crowdLock.body?.showRevision,
  },
});
const crowdSettlement = await call('/api/live/settle', {
  operatorKey: crowdRoom.operatorKey,
  body: {
    code: crowdRoom.code,
    raceNo: 1,
    winnerLane: 0,
    commandId: 'crowd-settle-01',
  },
});
assert.equal(crowdRun.response.status, 200);
assert.equal(crowdSettlement.response.status, 200);
assert.equal(crowdSettlement.body?.winners, 129);
assert.equal(crowdSettlement.body?.paid, 6_450);

let invalidRoomAttempts = 0;
let abuseStatus = 0;
while (invalidRoomAttempts < 400 && abuseStatus !== 429) {
  const attempt = await call('/api/live/join', {
    body: { code: 'AAAAAA', name: 'Flood probe' },
  });
  abuseStatus = attempt.response.status;
  if (abuseStatus !== 429) assert.equal(abuseStatus, 404);
  invalidRoomAttempts += 1;
}
assert.ok(invalidRoomAttempts >= 200, 'shared-source headroom was unexpectedly small');
assert.equal(abuseStatus, 429);

const expiryRoom = await createRoom();
const [stateDuringExpiry] = await Promise.all([
  call(`/api/live/state?code=${expiryRoom.code}`),
  roomNamespace.object(expiryRoom.code).alarm?.(),
]);
assert.ok(
  stateDuringExpiry.response.status === 200 || stateDuringExpiry.response.status === 410,
  `state raced with expiry returned ${stateDuringExpiry.response.status}`,
);
const expired = await call(`/api/live/state?code=${expiryRoom.code}`);
assert.equal(expired.response.status, 410);
const tombstoneKeys = await roomNamespace.storage(expiryRoom.code).list();
assert.deepEqual([...tombstoneKeys.keys()], ['meta']);

const joinExpiryRoom = await createRoom();
const [joinDuringExpiry] = await Promise.all([
  call('/api/live/join', {
    body: { code: joinExpiryRoom.code, name: 'Expiry Guest' },
    headers: { 'CF-Connecting-IP': '198.51.100.22' },
  }),
  roomNamespace.object(joinExpiryRoom.code).alarm?.(),
]);
assert.ok(
  joinDuringExpiry.response.status === 200 || joinDuringExpiry.response.status === 410,
  `join raced with expiry returned ${joinDuringExpiry.response.status}`,
);
const joinExpiryFinal = await call(`/api/live/state?code=${joinExpiryRoom.code}`);
assert.equal(joinExpiryFinal.response.status, 410);
assert.deepEqual(
  [...(await roomNamespace.storage(joinExpiryRoom.code).list()).keys()],
  ['meta'],
);

const settleExpiryRoom = await createRoom();
const settleExpiryLock = await call('/api/live/lock', {
  operatorKey: settleExpiryRoom.operatorKey,
  body: {
    code: settleExpiryRoom.code,
    raceNo: 1,
    show: show({ phase: 'race', marketOpen: false }),
    planHash,
    commandId: 'expiry-lock-0001',
    expectedShowRevision: settleExpiryRoom.showRevision,
  },
});
const settleExpiryRun = await call('/api/live/run', {
  operatorKey: settleExpiryRoom.operatorKey,
  body: {
    code: settleExpiryRoom.code,
    raceNo: 1,
    planHash,
    commandId: 'expiry-run-00001',
    expectedShowRevision: settleExpiryLock.body?.showRevision,
  },
});
assert.equal(settleExpiryRun.response.status, 200);
const [settleDuringExpiry] = await Promise.all([
  call('/api/live/settle', {
    operatorKey: settleExpiryRoom.operatorKey,
    body: {
      code: settleExpiryRoom.code,
      raceNo: 1,
      winnerLane: 0,
      commandId: 'expiry-settle-01',
    },
  }),
  roomNamespace.object(settleExpiryRoom.code).alarm?.(),
]);
assert.ok(
  settleDuringExpiry.response.status === 200 || settleDuringExpiry.response.status === 410,
  `settlement raced with expiry returned ${settleDuringExpiry.response.status}`,
);
const settleExpiryFinal = await call(`/api/live/state?code=${settleExpiryRoom.code}`);
assert.equal(settleExpiryFinal.response.status, 410);
assert.deepEqual(
  [...(await roomNamespace.storage(settleExpiryRoom.code).list()).keys()],
  ['meta'],
);

console.log(
  'Cloudflare contract probe passed, including expiry races, shared-NAT and abuse ceilings.',
);
