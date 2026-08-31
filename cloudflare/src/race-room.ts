import type { DurableObjectState, DurableObjectStorage, WorkerEnv } from './platform';
import {
  LIVE_CHIP_START,
  MAX_FIELD_SIZE,
  MAX_PLAYERS,
  MAX_PICK_COMMANDS_PER_PLAYER,
  MAX_PLAYER_RECEIPTS,
  MAX_REACTIONS,
  MAX_RECEIPTS,
  MAX_OPERATOR_RECEIPTS,
  REACTION_KINDS,
  REACT_MIN_MS,
  SESSION_TTL_MS,
  asObject,
  cleanText,
  constantTimeEqual,
  fail,
  initialRace,
  isApiResult,
  jsonResponse,
  ok,
  operatorKeyOf,
  parseLiveShow,
  pickKey,
  pickPrefix,
  playerKey,
  randomToken,
  receiptKey,
  requestHashOf,
  sameField,
  settledKey,
  sha256,
  validCode,
  validCommandId,
  validPlanHash,
  voidKey,
  type ApiResult,
  type CommandReceipt,
  type LivePick,
  type LivePlayer,
  type LiveShow,
  type RaceStatus,
  type RoomTombstone,
  type SessionMeta,
  type Settlement,
} from './protocol';

const META_KEY = 'meta';
const PLAYER_PREFIX = 'player:';
const STORAGE_BATCH_SIZE = 128;

const statusRank: Record<RaceStatus, number> = {
  PENDING: 0,
  OPEN: 1,
  LOCKED: 2,
  RUNNING: 3,
  DRAWN: 4,
  SETTLED: 5,
  VOID: 5,
};

function requestedStatus(show: LiveShow): RaceStatus {
  if (show.result?.raceNo === show.raceNo) return 'DRAWN';
  if (show.marketOpen) return 'OPEN';
  if (show.phase === 'race') return 'RUNNING';
  if (show.phase === 'market') return 'LOCKED';
  return 'PENDING';
}

const activeError = (meta: SessionMeta, allowEnded = false): ApiResult | null => {
  if (!allowEnded && meta.endedAt) return fail('That session has ended.', 410);
  if (Date.now() - meta.createdAt > SESSION_TTL_MS) return fail('That session has ended.', 410);
  return null;
};

const expectedRevision = (value: unknown): number | undefined | null => {
  if (value === undefined) return undefined;
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null;
};

interface CreateBody {
  code: string;
  show: LiveShow;
  pin?: string;
}

/**
 * One instance owns one six-character room. All consequential mutations and
 * their command receipts commit in a single Durable Object storage
 * transaction, so retries cannot repeat a pick, payout, refund or transition.
 */
export class RaceRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: WorkerEnv) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/__create' && request.method === 'POST') {
        return jsonResponse(await this.create(request));
      }

      const stored = await this.state.storage.get<SessionMeta | RoomTombstone>(META_KEY);
      if (!stored) return jsonResponse(fail('That session code is not running.', 404));
      if ('tombstone' in stored) return jsonResponse(fail('That session has ended.', 410));
      const meta = stored;
      const availability = activeError(meta, url.pathname === '/api/live/end');
      if (availability) return jsonResponse(availability);

      let result: ApiResult;
      if (request.method === 'GET' && url.pathname === '/api/live/state') {
        result = await this.playerState(request, url);
      } else if (request.method === 'GET' && url.pathname === '/api/live/summary') {
        result = await this.operatorSummary(request, url);
      } else if (request.method === 'POST') {
        const body = await this.readInnerBody(request);
        if (isApiResult(body)) return jsonResponse(body);
        switch (url.pathname) {
          case '/api/live/join':
            result = await this.join(body);
            break;
          case '/api/live/pick':
            result = await this.pick(body);
            break;
          case '/api/live/react':
            result = await this.react(body);
            break;
          case '/api/live/state':
            result = await this.updateShow(request, body);
            break;
          case '/api/live/lock':
            result = await this.lock(request, body);
            break;
          case '/api/live/run':
            result = await this.run(request, body);
            break;
          case '/api/live/void':
            result = await this.voidRace(request, body);
            break;
          case '/api/live/rearm':
            result = await this.rearm(request, body);
            break;
          case '/api/live/settle':
            result = await this.settle(request, body);
            break;
          case '/api/live/end':
            result = await this.end(request, body);
            break;
          default:
            result = fail('Not found.', 404);
        }
      } else {
        result = fail('Not found.', 404);
      }
      return jsonResponse(result);
    } catch {
      return jsonResponse(fail('The live event service could not complete the request.', 500));
    }
  }

  async alarm(): Promise<void> {
    await this.state.storage.transaction(async (transaction) => {
      const stored = await transaction.get<SessionMeta | RoomTombstone>(META_KEY);
      if (!stored || 'tombstone' in stored) return;
      const tombstone: RoomTombstone = {
        schema: 1,
        tombstone: true,
        code: stored.code,
        expiredAt: Date.now(),
      };
      await transaction.deleteAll();
      await transaction.put(META_KEY, tombstone);
    });
  }

  private async readInnerBody(request: Request): Promise<Record<string, unknown> | ApiResult> {
    try {
      const parsed = JSON.parse(await request.text()) as unknown;
      return asObject(parsed) ?? fail('Malformed request.', 400);
    } catch {
      return fail('Malformed request.', 400);
    }
  }

  private async create(request: Request): Promise<ApiResult> {
    const raw = await this.readInnerBody(request);
    if (isApiResult(raw)) return raw;
    const code = typeof raw.code === 'string' ? raw.code.toUpperCase() : '';
    const show = parseLiveShow(raw.show);
    const pin = raw.pin === undefined ? undefined : String(raw.pin);
    if (!validCode(code) || !show || (pin !== undefined && !/^\d{4,12}$/.test(pin))) {
      return fail('Malformed session request.', 400);
    }
    if (show.phase === 'race' && !show.marketOpen && show.result?.raceNo !== show.raceNo) {
      return fail('Open Phone Play before starting the race.', 409);
    }
    const createBody: CreateBody = { code, show, ...(pin ? { pin } : {}) };
    const pinHash = createBody.pin ? await sha256(`${code}:${createBody.pin}`) : undefined;
    const result = await this.state.storage.transaction(async (transaction) => {
      const existing = await transaction.get<SessionMeta | RoomTombstone>(META_KEY);
      if (existing) return fail('That room code is already allocated.', 409);
      const meta: SessionMeta = {
        schema: 1,
        code,
        operatorKey: randomToken(24),
        ...(pinHash ? { pinHash } : {}),
        createdAt: Date.now(),
        revision: 1,
        showRevision: 1,
        show,
        race: initialRace(show),
        playerCount: 0,
        receiptCount: 0,
        playerReceiptCount: 0,
        operatorReceiptCount: 0,
        reactions: [],
      };
      await transaction.put(META_KEY, meta);
      return ok({
        code,
        operatorKey: meta.operatorKey,
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceAttempt: meta.race.attempt,
      });
    });
    if (result.status < 400) {
      await this.state.storage.setAlarm(Date.now() + SESSION_TTL_MS);
    }
    return result;
  }

  private async replay(
    storage: DurableObjectStorage,
    scope: string,
    commandId: string,
    kind: string,
    requestHash: string,
  ): Promise<ApiResult | null> {
    const receipt = await storage.get<CommandReceipt>(receiptKey(scope, commandId));
    if (!receipt) return null;
    if (receipt.kind !== kind || receipt.requestHash !== requestHash) {
      return fail('That command ID was already used for different data.', 409);
    }
    return { status: receipt.status, body: receipt.response };
  }

  private receiptCapacity(meta: SessionMeta, scope: 'operator' | 'player'): ApiResult | null {
    if (meta.receiptCount >= MAX_RECEIPTS) return fail('This room has reached its command limit.', 429);
    if (scope === 'operator' && (meta.operatorReceiptCount ?? 0) >= MAX_OPERATOR_RECEIPTS) {
      return fail('This room has reached its operator command limit.', 429);
    }
    if (scope === 'player' && (meta.playerReceiptCount ?? 0) >= MAX_PLAYER_RECEIPTS) {
      return fail('This room has reached its player command limit.', 429);
    }
    return null;
  }

  private async record(
    storage: DurableObjectStorage,
    meta: SessionMeta,
    scope: string,
    commandId: string,
    kind: string,
    requestHash: string,
    result: ApiResult,
  ): Promise<void> {
    const receipt: CommandReceipt = {
      kind,
      requestHash,
      status: result.status,
      response: result.body,
      at: Date.now(),
    };
    await storage.put(receiptKey(scope, commandId), receipt);
    meta.receiptCount += 1;
    if (scope === 'operator') meta.operatorReceiptCount = (meta.operatorReceiptCount ?? 0) + 1;
    else meta.playerReceiptCount = (meta.playerReceiptCount ?? 0) + 1;
  }

  private operatorAuthorised(meta: SessionMeta, request: Request): boolean {
    return constantTimeEqual(operatorKeyOf(request), meta.operatorKey);
  }

  private async sessionMeta(
    storage: DurableObjectStorage,
  ): Promise<SessionMeta | ApiResult> {
    const stored = await storage.get<SessionMeta | RoomTombstone>(META_KEY);
    if (!stored) return fail('That session code is not running.', 404);
    if ('tombstone' in stored) return fail('That session has ended.', 410);
    return stored;
  }

  private stale(meta: SessionMeta, expected: number | undefined): ApiResult | null {
    return expected !== undefined && expected !== meta.showRevision
      ? fail('The operator show state is stale. Refresh before sending another transition.', 409, {
          currentRevision: meta.revision,
          currentShowRevision: meta.showRevision,
        })
      : null;
  }

  private async join(body: Record<string, unknown>): Promise<ApiResult> {
    const suppliedName = typeof body.name === 'string' ? body.name : '';
    const name = cleanText(suppliedName, 24);
    const pin = body.pin === undefined ? undefined : String(body.pin);
    if (
      !name ||
      suppliedName.length > 80 ||
      (pin !== undefined && !/^\d{4,12}$/.test(pin))
    ) {
      return fail('Malformed join request.', 400);
    }
    const player: LivePlayer = {
      id: `pl${randomToken(12)}`,
      token: randomToken(24),
      name,
      chips: LIVE_CHIP_START,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      lastReactAt: 0,
      pickCommandCount: 0,
    };
    const before = await this.sessionMeta(this.state.storage);
    if (isApiResult(before)) return before;
    const suppliedPinHash = before?.pinHash
      ? await sha256(`${before.code}:${pin ?? ''}`)
      : undefined;
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (meta.pinHash) {
        if (!constantTimeEqual(suppliedPinHash, meta.pinHash)) return fail('Wrong PIN for this event.', 403);
      }
      if (meta.playerCount >= MAX_PLAYERS) return fail('The room is full.', 409);
      if (await transaction.get(playerKey(player.id))) return fail('Please retry joining.', 409);
      await transaction.put(playerKey(player.id), player);
      meta.playerCount += 1;
      meta.revision += 1;
      await transaction.put(META_KEY, meta);
      return ok({ playerId: player.id, token: player.token, chips: player.chips, name });
    });
  }

  private async authenticatedPlayer(
    storage: DurableObjectStorage,
    playerId: unknown,
    token: unknown,
  ): Promise<LivePlayer | null> {
    if (
      typeof playerId !== 'string' ||
      playerId.length > 64 ||
      typeof token !== 'string' ||
      token.length > 128
    ) {
      return null;
    }
    const player = await storage.get<LivePlayer>(playerKey(playerId));
    return player && constantTimeEqual(token, player.token) ? player : null;
  }

  private async getMany<T>(storage: DurableObjectStorage, keys: string[]): Promise<Map<string, T>> {
    const values = new Map<string, T>();
    for (let offset = 0; offset < keys.length; offset += STORAGE_BATCH_SIZE) {
      const batch = await storage.get<T>(keys.slice(offset, offset + STORAGE_BATCH_SIZE));
      for (const [key, value] of batch) values.set(key, value);
    }
    return values;
  }

  private async putMany(
    storage: DurableObjectStorage,
    entries: Map<string, unknown>,
  ): Promise<void> {
    const values = [...entries.entries()];
    for (let offset = 0; offset < values.length; offset += STORAGE_BATCH_SIZE) {
      await storage.put(Object.fromEntries(values.slice(offset, offset + STORAGE_BATCH_SIZE)));
    }
  }

  private async pick(body: Record<string, unknown>): Promise<ApiResult> {
    const raceNo = body.raceNo;
    const lane = body.lane;
    const chips = body.chips;
    const nonce = body.nonce;
    if (
      !Number.isSafeInteger(raceNo) ||
      !Number.isSafeInteger(lane) ||
      !Number.isSafeInteger(chips) ||
      typeof nonce !== 'string' ||
      !/^[A-Za-z0-9:_-]{8,64}$/.test(nonce)
    ) {
      return fail('Malformed pick request.', 400);
    }
    const requestHash = await requestHashOf({ raceNo, lane, chips });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      const player = await this.authenticatedPlayer(transaction, body.playerId, body.token);
      if (!player) return fail('Your session on this phone expired. Rejoin with the code.', 401);
      const scope = `player:${player.id}`;
      const replay = await this.replay(transaction, scope, nonce, 'pick', requestHash);
      if (replay) {
        return replay.status < 400
          ? { ...replay, body: { ...replay.body, duplicate: true } }
          : replay;
      }
      const capacity = this.receiptCapacity(meta, 'player');
      if (capacity) return capacity;
      if ((player.pickCommandCount ?? 0) >= MAX_PICK_COMMANDS_PER_PLAYER) {
        return fail('This player has reached the pick-change limit for the room.', 429);
      }
      if (Number(raceNo) !== meta.show.raceNo) {
        return fail('That race has moved on. Refresh and pick again.', 409);
      }
      if (meta.race.status !== 'OPEN' || !meta.show.marketOpen) {
        return fail('The market is locked for this race.', 409);
      }
      if (Number(lane) < 0 || Number(lane) >= meta.show.names.length) {
        return fail('Pick a snail that is in the field.', 400);
      }
      if (Number(chips) <= 0 || Number(chips) > LIVE_CHIP_START) {
        return fail(`A pick must use between 1 and ${LIVE_CHIP_START} whole fun chips.`, 400);
      }

      const key = pickKey(meta.race.raceNo, meta.race.attempt, player.id);
      const existing = await transaction.get<LivePick>(key);
      const bankWithRefund = player.chips + (existing && !existing.settled ? existing.chips : 0);
      if (Number(chips) > bankWithRefund) {
        return fail(`That is more than your ${bankWithRefund} chips.`, 409);
      }
      player.chips = bankWithRefund - Number(chips);
      player.lastSeen = Date.now();
      player.pickCommandCount = (player.pickCommandCount ?? 0) + 1;
      const pick: LivePick = {
        lane: Number(lane),
        chips: Number(chips),
        odds: meta.show.odds[Number(lane)],
        at: Date.now(),
        nonce,
      };
      await transaction.put(key, pick);
      await transaction.put(playerKey(player.id), player);
      meta.revision += 1;
      const result = ok({ bank: player.chips, pick, revision: meta.revision });
      await this.record(transaction, meta, scope, nonce, 'pick', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async react(body: Record<string, unknown>): Promise<ApiResult> {
    const kind = typeof body.kind === 'string' && REACTION_KINDS.has(body.kind) ? body.kind : null;
    if (!kind) {
      return fail('Unknown reaction.', 400);
    }
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      const player = await this.authenticatedPlayer(transaction, body.playerId, body.token);
      if (!player) return fail('Your session on this phone expired. Rejoin with the code.', 401);
      const now = Date.now();
      player.lastSeen = now;
      if (now - player.lastReactAt < REACT_MIN_MS) {
        await transaction.put(playerKey(player.id), player);
        return ok({ throttled: true });
      }
      player.lastReactAt = now;
      meta.reactions.push({ kind, at: now });
      if (meta.reactions.length > MAX_REACTIONS) {
        meta.reactions.splice(0, meta.reactions.length - MAX_REACTIONS);
      }
      await transaction.put(playerKey(player.id), player);
      await transaction.put(META_KEY, meta);
      return ok({});
    });
  }

  private async updateShow(request: Request, body: Record<string, unknown>): Promise<ApiResult> {
    const show = parseLiveShow(body.show);
    const commandId = body.commandId;
    const expected = expectedRevision(body.expectedShowRevision);
    if (!show || !validCommandId(commandId) || expected === null || expected === undefined) {
      return fail('Malformed show state.', 400);
    }
    const requestHash = await requestHashOf({ show, expectedShowRevision: expected });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);
      const replay = await this.replay(transaction, 'operator', commandId, 'show', requestHash);
      if (replay) return replay;
      const capacity = this.receiptCapacity(meta, 'operator');
      if (capacity) return capacity;
      const stale = this.stale(meta, expected);
      if (stale) return stale;
      if (show.raceNo < meta.race.raceNo || show.raceNo > meta.race.raceNo + 1) {
        return fail('That race transition is stale or skips a race.', 409);
      }

      let status = requestedStatus(show);
      if (show.raceNo > meta.race.raceNo) {
        if (meta.race.status !== 'SETTLED' && meta.race.status !== 'VOID') {
          return fail('Settle or void the current race before advancing.', 409);
        }
        if (status !== 'PENDING' && status !== 'OPEN') {
          return fail('A new race must begin pending or open.', 409);
        }
      } else {
        if (statusRank[meta.race.status] >= statusRank.LOCKED && !sameField(meta.show, show)) {
          return fail('The locked field and fun-chip odds cannot change.', 409);
        }
        switch (meta.race.status) {
          case 'PENDING':
            if (status !== 'PENDING' && status !== 'OPEN') {
              return fail('Open the race before locking it.', 409);
            }
            break;
          case 'OPEN':
            if (status !== 'OPEN') return fail('Use the acknowledged lock command before closing the market.', 409);
            break;
          case 'LOCKED':
            if (status !== 'LOCKED') return fail('Use the acknowledged run command before starting the race.', 409);
            break;
          case 'RUNNING':
            if (status !== 'RUNNING' && status !== 'DRAWN') {
              return fail(`The race cannot move from RUNNING back to ${status}.`, 409);
            }
            break;
          case 'DRAWN':
            if (status !== 'DRAWN') return fail('A drawn race cannot move backwards.', 409);
            break;
          case 'SETTLED':
          case 'VOID':
            if (show.marketOpen) {
              return fail('Use the next-race or rearm transition before opening selections.', 409);
            }
            status = meta.race.status;
            break;
          default:
            return fail('Unsupported race state.', 409);
        }
      }

      const nextRace = show.raceNo !== meta.race.raceNo;
      meta.show = show;
      meta.race = {
        raceNo: show.raceNo,
        status,
        attempt: nextRace ? 1 : meta.race.attempt,
        ...(!nextRace && meta.race.planHash ? { planHash: meta.race.planHash } : {}),
      };
      meta.revision += 1;
      meta.showRevision += 1;
      const result = ok({
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceStatus: meta.race.status,
        raceAttempt: meta.race.attempt,
      });
      await this.record(transaction, meta, 'operator', commandId, 'show', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async lock(request: Request, body: Record<string, unknown>): Promise<ApiResult> {
    const show = parseLiveShow(body.show);
    const commandId = body.commandId;
    const expected = expectedRevision(body.expectedShowRevision);
    const raceNo = body.raceNo;
    const planHash = typeof body.planHash === 'string' ? body.planHash.toLowerCase() : '';
    if (
      !show ||
      !validCommandId(commandId) ||
      expected === null ||
      expected === undefined ||
      !Number.isSafeInteger(raceNo) ||
      Number(raceNo) !== show.raceNo ||
      !validPlanHash(planHash) ||
      show.marketOpen ||
      show.result?.raceNo === show.raceNo
    ) {
      return fail('Malformed lock request.', 400);
    }
    const requestHash = await requestHashOf({ raceNo, show, planHash, expectedShowRevision: expected });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);
      const replay = await this.replay(transaction, 'operator', commandId, 'lock', requestHash);
      if (replay) return replay;
      const capacity = this.receiptCapacity(meta, 'operator');
      if (capacity) return capacity;
      const stale = this.stale(meta, expected);
      if (stale) return stale;
      if (meta.race.raceNo !== Number(raceNo)) return fail('That race is not current.', 409);
      if (!sameField(meta.show, show)) return fail('The locked field and fun-chip odds do not match the open market.', 409);

      if (meta.race.status === 'LOCKED' && meta.race.planHash === planHash) {
        const result = ok({
          raceNo,
          revision: meta.revision,
          showRevision: meta.showRevision,
          raceStatus: 'LOCKED',
          raceAttempt: meta.race.attempt,
          planHash,
        });
        await this.record(transaction, meta, 'operator', commandId, 'lock', requestHash, result);
        await transaction.put(META_KEY, meta);
        return result;
      }
      if (meta.race.status !== 'OPEN') {
        return fail(`Race ${raceNo} cannot lock from ${meta.race.status}.`, 409);
      }

      meta.show = show;
      meta.race = { raceNo: Number(raceNo), status: 'LOCKED', attempt: meta.race.attempt, planHash };
      meta.revision += 1;
      meta.showRevision += 1;
      const result = ok({
        raceNo,
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceStatus: 'LOCKED',
        raceAttempt: meta.race.attempt,
        planHash,
      });
      await this.record(transaction, meta, 'operator', commandId, 'lock', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async run(request: Request, body: Record<string, unknown>): Promise<ApiResult> {
    const raceNo = body.raceNo;
    const commandId = body.commandId;
    const expected = expectedRevision(body.expectedShowRevision);
    const planHash = typeof body.planHash === 'string' ? body.planHash.toLowerCase() : '';
    if (
      !Number.isSafeInteger(raceNo) ||
      !validCommandId(commandId) ||
      expected === null ||
      expected === undefined ||
      !validPlanHash(planHash)
    ) {
      return fail('Malformed run request.', 400);
    }
    const requestHash = await requestHashOf({ raceNo, planHash, expectedShowRevision: expected });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);
      const replay = await this.replay(transaction, 'operator', commandId, 'run', requestHash);
      if (replay) return replay;
      const capacity = this.receiptCapacity(meta, 'operator');
      if (capacity) return capacity;
      const stale = this.stale(meta, expected);
      if (stale) return stale;
      if (
        meta.race.raceNo !== Number(raceNo) ||
        meta.race.status !== 'LOCKED' ||
        meta.race.planHash !== planHash
      ) {
        return fail('The race is not locked to that plan.', 409);
      }
      meta.show = { ...meta.show, phase: 'race', marketOpen: false };
      meta.race = { ...meta.race, status: 'RUNNING' };
      meta.revision += 1;
      meta.showRevision += 1;
      const result = ok({
        raceNo,
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceStatus: 'RUNNING',
        raceAttempt: meta.race.attempt,
        planHash,
      });
      await this.record(transaction, meta, 'operator', commandId, 'run', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async voidRace(request: Request, body: Record<string, unknown>): Promise<ApiResult> {
    const raceNo = body.raceNo;
    const commandId = body.commandId;
    const expected = expectedRevision(body.expectedShowRevision);
    const planHash = typeof body.planHash === 'string' ? body.planHash.toLowerCase() : '';
    const reason = typeof body.reason === 'string' ? cleanText(body.reason, 120) : '';
    if (
      !Number.isSafeInteger(raceNo) ||
      !validCommandId(commandId) ||
      expected === null ||
      expected === undefined ||
      !validPlanHash(planHash) ||
      !reason ||
      typeof body.reason !== 'string' ||
      body.reason.length > 120
    ) {
      return fail('Malformed void request.', 400);
    }
    const requestHash = await requestHashOf({ raceNo, planHash, reason, expectedShowRevision: expected });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);
      const replay = await this.replay(transaction, 'operator', commandId, 'void', requestHash);
      if (replay) return replay;
      const capacity = this.receiptCapacity(meta, 'operator');
      if (capacity) return capacity;
      const stale = this.stale(meta, expected);
      if (stale) return stale;
      if (
        meta.race.raceNo !== Number(raceNo) ||
        !['LOCKED', 'RUNNING', 'DRAWN'].includes(meta.race.status) ||
        meta.race.planHash !== planHash
      ) {
        return fail('That race attempt cannot be voided.', 409);
      }

      const currentPickPrefix = pickPrefix(meta.race.raceNo, meta.race.attempt);
      const picks = await transaction.list<LivePick>({ prefix: currentPickPrefix });
      const players = await this.getMany<LivePlayer>(
        transaction,
        [...picks.keys()].map((key) => playerKey(key.slice(currentPickPrefix.length))),
      );
      const updates = new Map<string, unknown>();
      let refundedPlayers = 0;
      let refundedChips = 0;
      for (const [key, pick] of picks) {
        if (pick.settled) continue;
        const id = key.slice(currentPickPrefix.length);
        const player = players.get(playerKey(id));
        if (!player) continue;
        player.chips += pick.chips;
        pick.settled = true;
        pick.returned = pick.chips;
        refundedPlayers += 1;
        refundedChips += pick.chips;
        updates.set(playerKey(id), player);
        updates.set(key, pick);
      }
      await this.putMany(transaction, updates);
      await transaction.put(voidKey(meta.race.raceNo, meta.race.attempt), {
        raceNo: meta.race.raceNo,
        attempt: meta.race.attempt,
        planHash,
        at: Date.now(),
        reason,
      });
      meta.show = { ...meta.show, marketOpen: false, result: null };
      meta.race = { ...meta.race, status: 'VOID' };
      meta.revision += 1;
      meta.showRevision += 1;
      const result = ok({
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceStatus: 'VOID',
        raceAttempt: meta.race.attempt,
        refundedPlayers,
        refundedChips,
      });
      await this.record(transaction, meta, 'operator', commandId, 'void', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async rearm(request: Request, body: Record<string, unknown>): Promise<ApiResult> {
    const show = parseLiveShow(body.show);
    const raceNo = body.raceNo;
    const commandId = body.commandId;
    const expected = expectedRevision(body.expectedShowRevision);
    if (
      !show ||
      !Number.isSafeInteger(raceNo) ||
      Number(raceNo) !== show.raceNo ||
      !validCommandId(commandId) ||
      expected === null ||
      expected === undefined ||
      !show.marketOpen ||
      show.result?.raceNo === show.raceNo
    ) {
      return fail('Malformed rearm request.', 400);
    }
    const requestHash = await requestHashOf({ raceNo, show, expectedShowRevision: expected });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);
      const replay = await this.replay(transaction, 'operator', commandId, 'rearm', requestHash);
      if (replay) return replay;
      const capacity = this.receiptCapacity(meta, 'operator');
      if (capacity) return capacity;
      const stale = this.stale(meta, expected);
      if (stale) return stale;
      if (meta.race.raceNo !== Number(raceNo) || meta.race.status !== 'VOID') {
        return fail('Only a void race can be rearmed.', 409);
      }
      if (!sameField(meta.show, show)) return fail('The rearmed field and fun-chip odds must remain fixed.', 409);

      meta.show = show;
      meta.race = { raceNo: Number(raceNo), status: 'OPEN', attempt: meta.race.attempt + 1 };
      meta.revision += 1;
      meta.showRevision += 1;
      const result = ok({
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceStatus: 'OPEN',
        raceAttempt: meta.race.attempt,
      });
      await this.record(transaction, meta, 'operator', commandId, 'rearm', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async settle(request: Request, body: Record<string, unknown>): Promise<ApiResult> {
    const raceNo = body.raceNo;
    const winnerLane = body.winnerLane;
    const commandId = body.commandId;
    if (
      !Number.isSafeInteger(raceNo) ||
      !Number.isSafeInteger(winnerLane) ||
      Number(winnerLane) < 0 ||
      Number(winnerLane) >= MAX_FIELD_SIZE ||
      !validCommandId(commandId)
    ) {
      return fail('Malformed settlement request.', 400);
    }
    const requestHash = await requestHashOf({ raceNo, winnerLane });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);
      if (Number(winnerLane) >= meta.show.names.length) {
        return fail('The winner is not in the current field.', 400);
      }
      const replay = await this.replay(transaction, 'operator', commandId, 'settle', requestHash);
      if (replay) return replay;
      const capacity = this.receiptCapacity(meta, 'operator');
      if (capacity) return capacity;
      if (meta.race.raceNo !== Number(raceNo) || meta.show.raceNo !== Number(raceNo)) {
        return fail('That race is not the current race.', 409);
      }
      const settlementKey = settledKey(meta.race.raceNo, meta.race.attempt);
      const previous = await transaction.get<Settlement>(settlementKey);
      if (previous) {
        if (previous.winnerLane !== Number(winnerLane)) {
          return fail('That race is already settled with a different winner.', 409);
        }
        const result = ok({ already: true, settled: previous });
        await this.record(transaction, meta, 'operator', commandId, 'settle', requestHash, result);
        await transaction.put(META_KEY, meta);
        return result;
      }
      if (meta.race.status !== 'RUNNING' && meta.race.status !== 'DRAWN') {
        return fail('Only a running or drawn race can be settled.', 409);
      }
      if (
        meta.show.result?.raceNo === Number(raceNo) &&
        meta.show.result.winnerLane !== Number(winnerLane)
      ) {
        return fail('The winner does not match the declared result.', 409);
      }

      const currentPickPrefix = pickPrefix(meta.race.raceNo, meta.race.attempt);
      const picks = await transaction.list<LivePick>({ prefix: currentPickPrefix });
      const winnerPlayerKeys = [...picks.entries()]
        .filter(([, pick]) => !pick.settled && pick.lane === Number(winnerLane))
        .map(([key]) => playerKey(key.slice(currentPickPrefix.length)));
      const players = await this.getMany<LivePlayer>(transaction, winnerPlayerKeys);
      const updates = new Map<string, unknown>();
      let winners = 0;
      let paid = 0;
      for (const [key, pick] of picks) {
        if (pick.settled) continue;
        pick.settled = true;
        const id = key.slice(currentPickPrefix.length);
        const player = players.get(playerKey(id));
        if (player && pick.lane === Number(winnerLane)) {
          pick.returned = Math.round(pick.chips * pick.odds);
          player.chips += pick.returned;
          winners += 1;
          paid += pick.returned;
          updates.set(playerKey(id), player);
        } else {
          pick.returned = 0;
        }
        updates.set(key, pick);
      }
      await this.putMany(transaction, updates);
      const settled: Settlement = { winnerLane: Number(winnerLane), at: Date.now() };
      await transaction.put(settlementKey, settled);
      meta.race = { ...meta.race, status: 'SETTLED' };
      meta.revision += 1;
      const result = ok({
        winners,
        paid,
        revision: meta.revision,
        raceStatus: 'SETTLED',
        raceAttempt: meta.race.attempt,
      });
      await this.record(transaction, meta, 'operator', commandId, 'settle', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async end(request: Request, body: Record<string, unknown>): Promise<ApiResult> {
    const commandId = body.commandId;
    if (!validCommandId(commandId)) return fail('Malformed end request.', 400);
    const requestHash = await requestHashOf({ code: body.code });
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);
      const replay = await this.replay(transaction, 'operator', commandId, 'end', requestHash);
      if (replay) return replay;
      const capacity = this.receiptCapacity(meta, 'operator');
      if (capacity) return capacity;
      if (meta.endedAt) {
        const result = ok({ already: true, endedAt: meta.endedAt, revision: meta.revision });
        await this.record(transaction, meta, 'operator', commandId, 'end', requestHash, result);
        await transaction.put(META_KEY, meta);
        return result;
      }
      meta.endedAt = Date.now();
      meta.revision += 1;
      const result = ok({ endedAt: meta.endedAt, revision: meta.revision });
      await this.record(transaction, meta, 'operator', commandId, 'end', requestHash, result);
      await transaction.put(META_KEY, meta);
      return result;
    });
  }

  private async playerState(request: Request, url: URL): Promise<ApiResult> {
    const sinceText = url.searchParams.get('since');
    const since = sinceText === null ? undefined : Number(sinceText);
    if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) {
      return fail('Malformed revision.', 400);
    }
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (since === meta.revision) return ok({ unchanged: true, revision: meta.revision });

      const player = await this.authenticatedPlayer(
        transaction,
        url.searchParams.get('playerId'),
        operatorKeyOf(request),
      );
      const players = await transaction.list<LivePlayer>({ prefix: PLAYER_PREFIX });
      const leaderboard = [...players.values()]
        .map((entry) => ({ name: entry.name, chips: entry.chips }))
        .sort((left, right) => right.chips - left.chips)
        .slice(0, 10);
      const pick = player
        ? await transaction.get<LivePick>(pickKey(meta.race.raceNo, meta.race.attempt, player.id))
        : undefined;
      return ok({
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceStatus: meta.race.status,
        raceAttempt: meta.race.attempt,
        show: meta.show,
        players: meta.playerCount,
        leaderboard,
        you: player ? { name: player.name, chips: player.chips, pick: pick ?? null } : null,
      });
    });
  }

  private async operatorSummary(request: Request, url: URL): Promise<ApiResult> {
    const since = Number(url.searchParams.get('since') ?? 0);
    if (!Number.isSafeInteger(since) || since < 0) return fail('Malformed reaction cursor.', 400);
    return this.state.storage.transaction(async (transaction) => {
      const meta = await this.sessionMeta(transaction);
      if (isApiResult(meta)) return meta;
      const availability = activeError(meta);
      if (availability) return availability;
      if (!this.operatorAuthorised(meta, request)) return fail('Not the operator.', 403);

      const [players, picks, settled] = await Promise.all([
        transaction.list<LivePlayer>({ prefix: PLAYER_PREFIX }),
        transaction.list<LivePick>({ prefix: pickPrefix(meta.race.raceNo, meta.race.attempt) }),
        transaction.get<Settlement>(settledKey(meta.race.raceNo, meta.race.attempt)),
      ]);
      const perLane: Record<number, { chips: number; players: number }> = {};
      for (const pick of picks.values()) {
        const lane = (perLane[pick.lane] ??= { chips: 0, players: 0 });
        lane.chips += pick.chips;
        lane.players += 1;
      }
      const reactions: Record<string, number> = {};
      for (const reaction of meta.reactions) {
        if (reaction.at > since) reactions[reaction.kind] = (reactions[reaction.kind] ?? 0) + 1;
      }
      const leaderboard = [...players.values()]
        .map((entry) => ({ name: entry.name, chips: entry.chips }))
        .sort((left, right) => right.chips - left.chips)
        .slice(0, 10);
      return ok({
        revision: meta.revision,
        showRevision: meta.showRevision,
        raceStatus: meta.race.status,
        raceAttempt: meta.race.attempt,
        raceNo: meta.race.raceNo,
        planHash: meta.race.planHash ?? null,
        settledWinnerLane: settled?.winnerLane ?? null,
        players: meta.playerCount,
        perLane,
        reactions,
        leaderboard,
        at: Date.now(),
      });
    });
  }
}
