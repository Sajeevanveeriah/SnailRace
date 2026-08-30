import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * The live event store: Phone Play's single source of truth.
 *
 * Player phones are never authoritative for anything. The stage device
 * creates a session and pushes the show state; phones join with a code,
 * poll a revisioned snapshot, and submit picks and reactions that are
 * validated HERE - market open, chips available, race current, command
 * unseen. Settlement runs here exactly once per race.
 *
 * Durability is a JSON file per session under a local data directory. This is
 * deliberately a SINGLE NODE PROCESS fallback, not a cloud or multi-instance
 * database. In-process consistency comes from serialising each session's
 * mutations through one promise queue. Shared deployments must replace this
 * adapter with a transactional coordinator such as a Durable Object.
 */

export interface LiveShow {
  eventName: string;
  clubName: string;
  raceNo: number;
  phase: string;
  marketOpen: boolean;
  names: string[];
  /** Odds per lane at the moment the stage last pushed. Display only. */
  odds: Record<number, number>;
  /** The latest declared result, if any. */
  result: { raceNo: number; winnerLane: number; order: { lane: number; name: string; place: number }[] } | null;
  rehearsal: boolean;
}

export interface LivePlayer {
  id: string;
  token: string;
  name: string;
  chips: number;
  joinedAt: number;
  lastSeen: number;
  /** Reaction rate limiting. */
  lastReactAt: number;
}

export interface LivePick {
  lane: number;
  chips: number;
  odds: number;
  at: number;
  nonce: string;
  settled?: boolean;
  returned?: number;
}

export type LiveRaceStatus = 'PENDING' | 'OPEN' | 'LOCKED' | 'RUNNING' | 'DRAWN' | 'SETTLED' | 'VOID';

interface CommandReceipt {
  kind: 'show' | 'lock' | 'run' | 'void' | 'rearm' | 'pick' | 'settle' | 'end';
  requestHash: string;
  response: unknown;
  at: number;
}

export interface LiveSession {
  code: string;
  operatorKey: string;
  pinHash?: string;
  createdAt: number;
  revision: number;
  /** Operator show revision, independent of player joins and picks. */
  showRevision?: number;
  show: LiveShow;
  /** Monotonic lifecycle for the race currently represented by `show`. */
  race?: { raceNo: number; status: LiveRaceStatus; attempt?: number; planHash?: string };
  players: Record<string, LivePlayer>;
  /** raceNo -> playerId -> pick. One pick per player per race, replaceable while open. */
  picks: Record<number, Record<string, LivePick>>;
  /** raceNo -> settlement record. The exactly-once guard. */
  settled: Record<number, { winnerLane: number; at: number }>;
  /** Immutable records of refunded race attempts. */
  voids?: { raceNo: number; attempt: number; planHash?: string; at: number; reason: string }[];
  /** Recent reactions, oldest first, capped. */
  reactions: { kind: string; at: number }[];
  /** Bounded exactly-once receipts for mutating client commands. */
  commandReceipts?: Record<string, CommandReceipt>;
  /** Set when the operator closes the room; every later call answers 410. */
  endedAt?: number;
}

type LiveRace = NonNullable<LiveSession['race']>;

export const LIVE_CHIP_START = 100;
const MAX_PLAYERS = 300;
const MAX_NAME = 24;
const REACTION_KINDS = ['cheer', 'laugh', 'shock', 'snail', 'clap'] as const;
const REACT_MIN_MS = 1500;
const REACTIONS_CAP = 400;
const COMMAND_RECEIPTS_CAP = 1200;
const SESSION_TTL_MS = 24 * 3600_000;
const JOIN_ATTEMPTS_PER_SHARED_SOURCE = 360;
const JOIN_SOURCE_WINDOW_MS = 15 * 60_000;

const DATA_DIR =
  process.env.SNAILRACE_DATA_DIR || path.join(process.cwd(), '.data', 'live');

/* Unambiguous session codes: no 0/O, 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const sessions = new Map<string, LiveSession>();
const queues = new Map<string, Promise<unknown>>();

const fileOf = (code: string) => path.join(DATA_DIR, `${code}.json`);

function randomCode(): string {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

const randomKey = (): string => crypto.randomBytes(24).toString('base64url');

const pinHashOf = (pin: string, code: string): string =>
  crypto.createHash('sha256').update(`${code}:${pin}`).digest('hex');

/** Strip control characters and clamp; React also escapes the rendered text. */
const cleanText = (value: unknown, maxLength: number): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);

export const cleanName = (value: unknown): string => cleanText(value, MAX_NAME);

const validCode = (code: unknown): code is string =>
  typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code);

const validCommandId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(value);

const stableJson = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
};

const requestHashOf = (value: unknown): string =>
  crypto.createHash('sha256').update(stableJson(value)).digest('hex');

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function initialRace(show: LiveShow, settled: LiveSession['settled']): LiveRace {
  if (settled[show.raceNo]) return { raceNo: show.raceNo, status: 'SETTLED', attempt: 1 };
  if (show.result?.raceNo === show.raceNo) return { raceNo: show.raceNo, status: 'DRAWN', attempt: 1 };
  if (show.marketOpen) return { raceNo: show.raceNo, status: 'OPEN', attempt: 1 };
  if (show.phase === 'race') return { raceNo: show.raceNo, status: 'RUNNING', attempt: 1 };
  if (show.phase === 'market') return { raceNo: show.raceNo, status: 'LOCKED', attempt: 1 };
  return { raceNo: show.raceNo, status: 'PENDING', attempt: 1 };
}

function ensureSessionMetadata(session: LiveSession): void {
  session.showRevision ??= session.revision;
  session.race ??= initialRace(session.show, session.settled);
  session.race.attempt ??= 1;
  session.voids ??= [];
  session.commandReceipts ??= {};
}

export type StoreError = {
  error: string;
  status: number;
  currentRevision?: number;
  currentShowRevision?: number;
};

function commandReplay<T>(
  session: LiveSession,
  receiptKey: string,
  kind: CommandReceipt['kind'],
  requestHash: string,
): T | StoreError | null {
  const receipt = session.commandReceipts?.[receiptKey];
  if (!receipt) return null;
  if (receipt.kind !== kind || receipt.requestHash !== requestHash) {
    return { error: 'That command ID was already used for different data.', status: 409 };
  }
  return cloneJson(receipt.response as T);
}

function recordCommand(
  session: LiveSession,
  receiptKey: string,
  kind: CommandReceipt['kind'],
  requestHash: string,
  response: unknown,
): void {
  const receipts = (session.commandReceipts ??= {});
  receipts[receiptKey] = { kind, requestHash, response: cloneJson(response), at: Date.now() };
  const keys = Object.keys(receipts);
  if (keys.length <= COMMAND_RECEIPTS_CAP) return;
  keys
    .sort((a, b) => receipts[a].at - receipts[b].at)
    .slice(0, keys.length - COMMAND_RECEIPTS_CAP)
    .forEach((key) => delete receipts[key]);
}

async function load(code: string): Promise<LiveSession | null> {
  const hit = sessions.get(code);
  if (hit) {
    ensureSessionMetadata(hit);
    return hit;
  }
  try {
    const raw = await fs.readFile(fileOf(code), 'utf8');
    const parsed = JSON.parse(raw) as LiveSession;
    if (parsed?.code !== code) return null;
    ensureSessionMetadata(parsed);
    sessions.set(code, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function persist(session: LiveSession): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${fileOf(session.code)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(session));
  await fs.rename(tmp, fileOf(session.code));
}

async function activeSession(code: string, allowEnded = false): Promise<LiveSession | StoreError> {
  const session = await load(code);
  if (!session) return { error: 'That session code is not running.', status: 404 };
  if ((!allowEnded && session.endedAt) || Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(code);
    return { error: 'That session has ended.', status: 410 };
  }
  return session;
}

/** Read without taking the mutation queue or rewriting the session file. */
async function readSession<T>(
  code: string,
  fn: (session: LiveSession) => T,
): Promise<T | StoreError> {
  const session = await activeSession(code);
  if (isError(session)) return session;
  return fn(session);
}

/** Serialise all mutations of one session, so two phones cannot interleave. */
function withSession<T>(
  code: string,
  fn: (session: LiveSession) => Promise<T> | T,
  allowEnded = false,
): Promise<T | StoreError> {
  const prev = queues.get(code) ?? Promise.resolve();
  const next = prev.then(async () => {
    const session = await activeSession(code, allowEnded);
    if (isError(session)) return session;
    const out = await fn(session);
    if (isError(out)) return out;
    await persist(session);
    return out;
  });
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(code, tail);
  void tail.then(() => {
    if (queues.get(code) === tail) queues.delete(code);
  });
  return next as Promise<T | StoreError>;
}

export function isStoreErrorValue(x: unknown): x is StoreError {
  return typeof x === 'object' && x !== null && 'error' in x;
}

export function isError<T>(x: T): x is Extract<T, StoreError> {
  return isStoreErrorValue(x);
}

/* ── Operator surface ─────────────────────────────────────────────────── */

export async function createSession(
  show: LiveShow,
  pin?: string,
): Promise<{
  code: string;
  operatorKey: string;
  revision: number;
  showRevision: number;
  raceAttempt: number;
}> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let code = randomCode();
  let attempts = 0;
  while ((await load(code)) && attempts < 32) {
    code = randomCode();
    attempts += 1;
  }
  if (await load(code)) throw new Error('Could not allocate a unique Phone Play room code.');
  const session: LiveSession = {
    code,
    operatorKey: randomKey(),
    ...(pin ? { pinHash: pinHashOf(pin, code) } : {}),
    createdAt: Date.now(),
    revision: 1,
    showRevision: 1,
    show,
    race: initialRace(show, {}),
    players: {},
    picks: {},
    settled: {},
    voids: [],
    reactions: [],
    commandReceipts: {},
  };
  sessions.set(code, session);
  await persist(session);
  return {
    code,
    operatorKey: session.operatorKey,
    revision: session.revision,
    showRevision: session.showRevision ?? 1,
    raceAttempt: 1,
  };
}

const operatorOk = (session: LiveSession, key: unknown): boolean =>
  typeof key === 'string' &&
  key.length === session.operatorKey.length &&
  crypto.timingSafeEqual(Buffer.from(key), Buffer.from(session.operatorKey));

const STATUS_RANK: Record<LiveRaceStatus, number> = {
  PENDING: 0,
  OPEN: 1,
  LOCKED: 2,
  RUNNING: 3,
  DRAWN: 4,
  SETTLED: 5,
  VOID: 5,
};

function requestedStatus(current: LiveRace, show: LiveShow): LiveRaceStatus {
  if (show.result?.raceNo === show.raceNo) return 'DRAWN';
  if (show.marketOpen) return 'OPEN';
  if (show.phase === 'race') return 'RUNNING';
  if (show.phase === 'market' || (current?.raceNo === show.raceNo && current.status === 'OPEN')) {
    return 'LOCKED';
  }
  return 'PENDING';
}

export function updateShow(
  code: string,
  operatorKey: unknown,
  show: LiveShow,
  commandId?: unknown,
  expectedShowRevision?: number,
) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    ensureSessionMetadata(session);
    if (commandId !== undefined && !validCommandId(commandId)) {
      return { error: 'Malformed command ID.', status: 400 };
    }

    const hash = requestHashOf({ show, expectedShowRevision });
    const receiptKey = commandId ? `operator:show:${commandId}` : '';
    if (receiptKey) {
      const replay = commandReplay<{
        ok: true;
        revision: number;
        showRevision: number;
        raceStatus: LiveRaceStatus;
        raceAttempt: number;
      }>(
        session,
        receiptKey,
        'show',
        hash,
      );
      if (replay) return replay;
    }

    const currentShowRevision = session.showRevision ?? session.revision;
    if (
      expectedShowRevision !== undefined &&
      (!Number.isSafeInteger(expectedShowRevision) || expectedShowRevision !== currentShowRevision)
    ) {
      return {
        error: 'The operator show state is stale. Refresh before sending another transition.',
        status: 409,
        currentRevision: session.revision,
        currentShowRevision,
      };
    }

    const current = session.race ?? initialRace(session.show, session.settled);
    if (!Number.isSafeInteger(show.raceNo) || show.raceNo < current.raceNo || show.raceNo > current.raceNo + 1) {
      return { error: 'That race transition is stale or skips a race.', status: 409 };
    }

    let status = requestedStatus(current, show);
    if (show.raceNo > current.raceNo) {
      if (current.status !== 'SETTLED' && current.status !== 'VOID') {
        return { error: 'Settle or void the current race before advancing.', status: 409 };
      }
    } else if (current.status === 'SETTLED' || current.status === 'VOID') {
      status = current.status;
    } else if (current.status === 'OPEN' && status !== 'OPEN') {
      return { error: 'Use the acknowledged lock command before closing the market.', status: 409 };
    } else if (current.status === 'LOCKED' && STATUS_RANK[status] > STATUS_RANK.LOCKED) {
      return { error: 'Use the acknowledged run command before starting the race.', status: 409 };
    } else if (STATUS_RANK[status] < STATUS_RANK[current.status]) {
      return { error: `The race cannot move from ${current.status} back to ${status}.`, status: 409 };
    }

    session.show = show;
    session.race = {
      raceNo: show.raceNo,
      status,
      attempt: show.raceNo === current.raceNo ? current.attempt ?? 1 : 1,
      ...(show.raceNo === current.raceNo && current.planHash
        ? { planHash: current.planHash }
        : {}),
    };
    session.revision += 1;
    session.showRevision = currentShowRevision + 1;
    const response = {
      ok: true as const,
      revision: session.revision,
      showRevision: session.showRevision,
      raceStatus: status,
      raceAttempt: session.race.attempt ?? 1,
    };
    if (receiptKey) recordCommand(session, receiptKey, 'show', hash, response);
    return response;
  });
}

/**
 * Explicit market lock. The stage must receive this acknowledgement before
 * it starts the immutable race plan whose SHA-256 is recorded here.
 */
export function lockRace(
  code: string,
  operatorKey: unknown,
  raceNo: number,
  show: LiveShow,
  planHash: string,
  commandId: unknown,
  expectedShowRevision?: number,
) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    ensureSessionMetadata(session);
    if (!validCommandId(commandId)) return { error: 'Malformed command ID.', status: 400 };
    if (!Number.isSafeInteger(raceNo) || raceNo < 1 || raceNo !== show.raceNo) {
      return { error: 'Bad race number.', status: 400 };
    }
    if (!/^[a-f0-9]{64}$/.test(planHash)) return { error: 'Malformed race plan hash.', status: 400 };
    if (show.marketOpen || show.result?.raceNo === raceNo) {
      return { error: 'The locked snapshot must close an undrawn race.', status: 400 };
    }

    const hash = requestHashOf({ raceNo, show, planHash, expectedShowRevision });
    const receiptKey = `operator:lock:${commandId}`;
    const replay = commandReplay<{
      ok: true;
      raceNo: number;
      revision: number;
      showRevision: number;
      raceStatus: 'LOCKED';
      raceAttempt: number;
      planHash: string;
    }>(session, receiptKey, 'lock', hash);
    if (replay) return replay;

    const currentShowRevision = session.showRevision ?? session.revision;
    if (
      expectedShowRevision !== undefined &&
      (!Number.isSafeInteger(expectedShowRevision) || expectedShowRevision !== currentShowRevision)
    ) {
      return {
        error: 'The operator show state is stale. Refresh before locking.',
        status: 409,
        currentRevision: session.revision,
        currentShowRevision,
      };
    }

    const current = session.race ?? initialRace(session.show, session.settled);
    if (current.raceNo !== raceNo) return { error: 'That race is not current.', status: 409 };
    if (current.status === 'LOCKED' && current.planHash === planHash) {
      const response = {
        ok: true as const,
        raceNo,
        revision: session.revision,
        showRevision: currentShowRevision,
        raceStatus: 'LOCKED' as const,
        raceAttempt: current.attempt ?? 1,
        planHash,
      };
      recordCommand(session, receiptKey, 'lock', hash, response);
      return response;
    }
    if (current.status !== 'OPEN') {
      return { error: `Race ${raceNo} cannot lock from ${current.status}.`, status: 409 };
    }

    session.show = show;
    session.race = { raceNo, status: 'LOCKED', attempt: current.attempt ?? 1, planHash };
    session.revision += 1;
    session.showRevision = currentShowRevision + 1;
    const response = {
      ok: true as const,
      raceNo,
      revision: session.revision,
      showRevision: session.showRevision,
      raceStatus: 'LOCKED' as const,
      raceAttempt: session.race.attempt ?? 1,
      planHash,
    };
    recordCommand(session, receiptKey, 'lock', hash, response);
    return response;
  });
}

/** Move an acknowledged, plan-bound lock to RUNNING before local countdown. */
export function runRace(
  code: string,
  operatorKey: unknown,
  raceNo: number,
  planHash: string,
  commandId: unknown,
  expectedShowRevision?: number,
) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    ensureSessionMetadata(session);
    if (!validCommandId(commandId)) return { error: 'Malformed command ID.', status: 400 };
    if (!Number.isSafeInteger(raceNo) || raceNo < 1) return { error: 'Bad race number.', status: 400 };
    if (!/^[a-f0-9]{64}$/.test(planHash)) return { error: 'Malformed race plan hash.', status: 400 };

    const hash = requestHashOf({ raceNo, planHash, expectedShowRevision });
    const receiptKey = `operator:run:${commandId}`;
    const replay = commandReplay<{
      ok: true;
      raceNo: number;
      revision: number;
      showRevision: number;
      raceStatus: 'RUNNING';
      raceAttempt: number;
      planHash: string;
    }>(session, receiptKey, 'run', hash);
    if (replay) return replay;

    const currentShowRevision = session.showRevision ?? session.revision;
    if (
      expectedShowRevision !== undefined &&
      (!Number.isSafeInteger(expectedShowRevision) || expectedShowRevision !== currentShowRevision)
    ) {
      return {
        error: 'The operator show state is stale. Refresh before running.',
        status: 409,
        currentRevision: session.revision,
        currentShowRevision,
      };
    }

    const current = session.race ?? initialRace(session.show, session.settled);
    if (current.raceNo !== raceNo || current.status !== 'LOCKED' || current.planHash !== planHash) {
      return { error: 'The race is not locked to that plan.', status: 409 };
    }

    session.show = { ...session.show, phase: 'race', marketOpen: false };
    session.race = { ...current, status: 'RUNNING' };
    session.revision += 1;
    session.showRevision = currentShowRevision + 1;
    const response = {
      ok: true as const,
      raceNo,
      revision: session.revision,
      showRevision: session.showRevision,
      raceStatus: 'RUNNING' as const,
      raceAttempt: current.attempt ?? 1,
      planHash,
    };
    recordCommand(session, receiptKey, 'run', hash, response);
    return response;
  });
}

/** Refund an unfinished attempt and leave it terminal until explicitly rearmed. */
export function voidRace(
  code: string,
  operatorKey: unknown,
  raceNo: number,
  planHash: string,
  reason: string,
  commandId: unknown,
  expectedShowRevision?: number,
) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    ensureSessionMetadata(session);
    if (!validCommandId(commandId)) return { error: 'Malformed command ID.', status: 400 };
    if (!Number.isSafeInteger(raceNo) || raceNo < 1) return { error: 'Bad race number.', status: 400 };
    if (!/^[a-f0-9]{64}$/.test(planHash)) return { error: 'Malformed race plan hash.', status: 400 };
    const cleanReason = cleanText(reason, 120);
    if (!cleanReason) return { error: 'A void reason is required.', status: 400 };

    const hash = requestHashOf({ raceNo, planHash, reason: cleanReason, expectedShowRevision });
    const receiptKey = `operator:void:${commandId}`;
    const replay = commandReplay<{
      ok: true;
      revision: number;
      showRevision: number;
      raceStatus: 'VOID';
      raceAttempt: number;
      refundedPlayers: number;
      refundedChips: number;
    }>(session, receiptKey, 'void', hash);
    if (replay) return replay;

    const currentShowRevision = session.showRevision ?? session.revision;
    if (
      expectedShowRevision !== undefined &&
      (!Number.isSafeInteger(expectedShowRevision) || expectedShowRevision !== currentShowRevision)
    ) {
      return {
        error: 'The operator show state is stale. Refresh before voiding.',
        status: 409,
        currentRevision: session.revision,
        currentShowRevision,
      };
    }

    const current = session.race ?? initialRace(session.show, session.settled);
    if (
      current.raceNo !== raceNo ||
      !['LOCKED', 'RUNNING', 'DRAWN'].includes(current.status) ||
      current.planHash !== planHash
    ) {
      return { error: 'That race attempt cannot be voided.', status: 409 };
    }

    let refundedPlayers = 0;
    let refundedChips = 0;
    for (const [playerId, pick] of Object.entries(session.picks[raceNo] ?? {})) {
      if (pick.settled) continue;
      const player = session.players[playerId];
      if (!player) continue;
      player.chips += pick.chips;
      pick.settled = true;
      pick.returned = pick.chips;
      refundedPlayers += 1;
      refundedChips += pick.chips;
    }

    const attempt = current.attempt ?? 1;
    session.voids?.push({ raceNo, attempt, planHash, at: Date.now(), reason: cleanReason });
    session.show = { ...session.show, marketOpen: false, result: null };
    session.race = { ...current, status: 'VOID' };
    session.revision += 1;
    session.showRevision = currentShowRevision + 1;
    const response = {
      ok: true as const,
      revision: session.revision,
      showRevision: session.showRevision,
      raceStatus: 'VOID' as const,
      raceAttempt: attempt,
      refundedPlayers,
      refundedChips,
    };
    recordCommand(session, receiptKey, 'void', hash, response);
    return response;
  });
}

/** Reopen the same race after a persisted VOID, using a new attempt number. */
export function rearmRace(
  code: string,
  operatorKey: unknown,
  raceNo: number,
  show: LiveShow,
  commandId: unknown,
  expectedShowRevision?: number,
) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    ensureSessionMetadata(session);
    if (!validCommandId(commandId)) return { error: 'Malformed command ID.', status: 400 };
    if (
      !Number.isSafeInteger(raceNo) ||
      raceNo < 1 ||
      show.raceNo !== raceNo ||
      !show.marketOpen ||
      show.result?.raceNo === raceNo
    ) {
      return { error: 'The rearmed snapshot must reopen the same undrawn race.', status: 400 };
    }

    const hash = requestHashOf({ raceNo, show, expectedShowRevision });
    const receiptKey = `operator:rearm:${commandId}`;
    const replay = commandReplay<{
      ok: true;
      revision: number;
      showRevision: number;
      raceStatus: 'OPEN';
      raceAttempt: number;
    }>(session, receiptKey, 'rearm', hash);
    if (replay) return replay;

    const currentShowRevision = session.showRevision ?? session.revision;
    if (
      expectedShowRevision !== undefined &&
      (!Number.isSafeInteger(expectedShowRevision) || expectedShowRevision !== currentShowRevision)
    ) {
      return {
        error: 'The operator show state is stale. Refresh before rearming.',
        status: 409,
        currentRevision: session.revision,
        currentShowRevision,
      };
    }

    const current = session.race ?? initialRace(session.show, session.settled);
    if (current.raceNo !== raceNo || current.status !== 'VOID') {
      return { error: 'Only a void race can be rearmed.', status: 409 };
    }

    delete session.picks[raceNo];
    const attempt = (current.attempt ?? 1) + 1;
    session.show = show;
    session.race = { raceNo, status: 'OPEN', attempt };
    session.revision += 1;
    session.showRevision = currentShowRevision + 1;
    const response = {
      ok: true as const,
      revision: session.revision,
      showRevision: session.showRevision,
      raceStatus: 'OPEN' as const,
      raceAttempt: attempt,
    };
    recordCommand(session, receiptKey, 'rearm', hash, response);
    return response;
  });
}

/** Settle one race's phone picks exactly once, at each pick's locked odds. */
export function settleRace(
  code: string,
  operatorKey: unknown,
  raceNo: number,
  winnerLane: number,
  commandId?: unknown,
) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    ensureSessionMetadata(session);
    if (!Number.isSafeInteger(raceNo) || raceNo < 1) return { error: 'Bad race number.', status: 400 };
    if (!Number.isSafeInteger(winnerLane) || winnerLane < 0) {
      return { error: 'Bad winner lane.', status: 400 };
    }
    if (commandId !== undefined && !validCommandId(commandId)) {
      return { error: 'Malformed command ID.', status: 400 };
    }

    const hash = requestHashOf({ raceNo, winnerLane });
    const receiptKey = commandId ? `operator:settle:${commandId}` : '';
    if (receiptKey) {
      const replay = commandReplay<
        | {
            ok: true;
            already: true;
            settled: { winnerLane: number; at: number };
          }
        | {
            ok: true;
            already: false;
            winners: number;
            paid: number;
            revision: number;
            raceStatus: 'SETTLED';
            raceAttempt: number;
          }
      >(session, receiptKey, 'settle', hash);
      if (replay) return replay;
    }

    const previous = session.settled[raceNo];
    if (previous) {
      if (previous.winnerLane !== winnerLane) {
        return { error: 'That race is already settled with a different winner.', status: 409 };
      }
      const response = { ok: true as const, already: true as const, settled: previous };
      if (receiptKey) recordCommand(session, receiptKey, 'settle', hash, response);
      return response;
    }

    if (winnerLane >= session.show.names.length) {
      return { error: 'Bad winner lane.', status: 400 };
    }

    const race = session.race ?? initialRace(session.show, session.settled);
    if (raceNo !== race.raceNo || raceNo !== session.show.raceNo) {
      return { error: 'That race is not the current race.', status: 409 };
    }
    if (race.status !== 'RUNNING' && race.status !== 'DRAWN') {
      return { error: 'Only a running or drawn race can be settled.', status: 409 };
    }
    if (
      session.show.result?.raceNo === raceNo &&
      session.show.result.winnerLane !== winnerLane
    ) {
      return { error: 'The winner does not match the declared result.', status: 409 };
    }
    const book = session.picks[raceNo] ?? {};
    let winners = 0;
    let paid = 0;
    for (const [playerId, pick] of Object.entries(book)) {
      if (pick.settled) continue;
      pick.settled = true;
      const player = session.players[playerId];
      if (!player) continue;
      if (pick.lane === winnerLane) {
        pick.returned = Math.round(pick.chips * pick.odds);
        player.chips += pick.returned;
        winners += 1;
        paid += pick.returned;
      } else {
        pick.returned = 0;
      }
    }
    session.settled[raceNo] = { winnerLane, at: Date.now() };
    session.race = {
      raceNo,
      status: 'SETTLED',
      attempt: race.attempt ?? 1,
      ...(race.planHash ? { planHash: race.planHash } : {}),
    };
    session.revision += 1;
    const response = {
      ok: true as const,
      already: false as const,
      winners,
      paid,
      revision: session.revision,
      raceStatus: 'SETTLED' as const,
      raceAttempt: race.attempt ?? 1,
    };
    if (receiptKey) recordCommand(session, receiptKey, 'settle', hash, response);
    return response;
  });
}

/** Close the room: phones polling it are told the event has ended (410). */
export function endSession(code: string, operatorKey: unknown, commandId?: unknown) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    if (commandId !== undefined && !validCommandId(commandId)) {
      return { error: 'Malformed command ID.', status: 400 };
    }
    const hash = requestHashOf({ code });
    const receiptKey = commandId ? `operator:end:${commandId}` : '';
    if (receiptKey) {
      const replay = commandReplay<{
        ok: true;
        already?: true;
        endedAt: number;
        revision: number;
      }>(session, receiptKey, 'end', hash);
      if (replay) return replay;
    }
    if (session.endedAt) {
      const response = { ok: true as const, already: true, endedAt: session.endedAt, revision: session.revision };
      if (receiptKey) recordCommand(session, receiptKey, 'end', hash, response);
      return response;
    }
    session.endedAt = Date.now();
    session.revision += 1;
    const response = { ok: true as const, endedAt: session.endedAt, revision: session.revision };
    if (receiptKey) recordCommand(session, receiptKey, 'end', hash, response);
    return response;
  }, true);
}

export function operatorSummary(code: string, operatorKey: unknown, reactionsSince: number) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return readSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    const raceNo = session.show.raceNo;
    const book = session.picks[raceNo] ?? {};
    const perLane: Record<number, { chips: number; players: number }> = {};
    for (const pick of Object.values(book)) {
      const lane = (perLane[pick.lane] ??= { chips: 0, players: 0 });
      lane.chips += pick.chips;
      lane.players += 1;
    }
    const reactions: Record<string, number> = {};
    for (const r of session.reactions) {
      if (r.at > reactionsSince) reactions[r.kind] = (reactions[r.kind] ?? 0) + 1;
    }
    const leaderboard = Object.values(session.players)
      .map((p) => ({ name: p.name, chips: p.chips }))
      .sort((a, b) => b.chips - a.chips)
      .slice(0, 10);
    return {
      ok: true as const,
      revision: session.revision,
      showRevision: session.showRevision ?? session.revision,
      raceStatus: session.race?.status ?? initialRace(session.show, session.settled).status,
      raceAttempt: session.race?.attempt ?? 1,
      raceNo: session.race?.raceNo ?? session.show.raceNo,
      planHash: session.race?.planHash ?? null,
      settledWinnerLane: session.settled[raceNo]?.winnerLane ?? null,
      players: Object.keys(session.players).length,
      perLane,
      reactions,
      leaderboard,
      at: Date.now(),
    };
  });
}

/* ── Player surface ───────────────────────────────────────────────────── */

export function joinSession(code: string, name: string, pin?: string) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (session.pinHash && pinHashOf(String(pin ?? ''), code) !== session.pinHash) {
      return { error: 'Wrong PIN for this event.', status: 403 };
    }
    const clean = cleanName(name);
    if (!clean) return { error: 'Add a display name so your chips land somewhere.', status: 400 };
    if (Object.keys(session.players).length >= MAX_PLAYERS) {
      return { error: 'The room is full.', status: 409 };
    }
    const id = `pl${crypto.randomBytes(8).toString('hex')}`;
    const player: LivePlayer = {
      id,
      token: randomKey(),
      name: clean,
      chips: LIVE_CHIP_START,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      lastReactAt: 0,
    };
    session.players[id] = player;
    session.revision += 1;
    return { ok: true as const, playerId: id, token: player.token, chips: player.chips, name: clean };
  });
}

function playerOf(session: LiveSession, playerId: unknown, token: unknown): LivePlayer | null {
  if (typeof playerId !== 'string' || typeof token !== 'string') return null;
  const player = session.players[playerId];
  if (!player) return null;
  if (player.token.length !== token.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(player.token), Buffer.from(token))) return null;
  return player;
}

/**
 * A pick: idempotent by nonce, replaceable while the market is open, chips
 * held against the player's bank. Fun chips only, no monetary value ever.
 */
export function placePick(
  code: string,
  playerId: unknown,
  token: unknown,
  raceNo: number,
  lane: number,
  chips: number,
  nonce: string,
) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    const player = playerOf(session, playerId, token);
    if (!player) return { error: 'Your session on this phone expired. Rejoin with the code.', status: 401 };
    ensureSessionMetadata(session);
    if (!Number.isInteger(raceNo) || raceNo !== session.show.raceNo) {
      return { error: 'That race has moved on. Refresh and pick again.', status: 409 };
    }
    if (session.settled[raceNo] || session.race?.status !== 'OPEN' || !session.show.marketOpen) {
      return { error: 'The market is locked for this race.', status: 409 };
    }
    if (!Number.isInteger(lane) || lane < 0 || lane >= session.show.names.length) {
      return { error: 'Pick a snail that is in the field.', status: 400 };
    }
    if (!Number.isInteger(chips) || chips <= 0) return { error: 'Chips must be a positive whole number.', status: 400 };
    if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 64) {
      return { error: 'Malformed request.', status: 400 };
    }

    const requestHash = requestHashOf({ raceNo, lane, chips });
    const receiptKey = `player:${player.id}:pick:${nonce}`;
    const replay = commandReplay<{
      ok: true;
      bank: number;
      pick: LivePick;
      revision: number;
      duplicate: false;
    }>(session, receiptKey, 'pick', requestHash);
    if (replay) return isError(replay) ? replay : { ...replay, duplicate: true as const };

    const book = (session.picks[raceNo] ??= {});
    const existing = book[player.id];
    const bankWithRefund = player.chips + (existing && !existing.settled ? existing.chips : 0);
    if (chips > bankWithRefund) {
      return { error: `That is more than your ${bankWithRefund} chips.`, status: 409 };
    }
    player.chips = bankWithRefund - chips;
    const pick: LivePick = {
      lane,
      chips,
      odds: session.show.odds[lane] ?? session.show.names.length,
      at: Date.now(),
      nonce,
    };
    book[player.id] = pick;
    player.lastSeen = Date.now();
    session.revision += 1;
    const response = {
      ok: true as const,
      bank: player.chips,
      pick,
      revision: session.revision,
      duplicate: false as const,
    };
    recordCommand(session, receiptKey, 'pick', requestHash, response);
    return response;
  });
}

export function react(code: string, playerId: unknown, token: unknown, kind: string) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    const player = playerOf(session, playerId, token);
    if (!player) return { error: 'Your session on this phone expired. Rejoin with the code.', status: 401 };
    if (!REACTION_KINDS.includes(kind as (typeof REACTION_KINDS)[number])) {
      return { error: 'Unknown reaction.', status: 400 };
    }
    const now = Date.now();
    player.lastSeen = now;
    if (now - player.lastReactAt < REACT_MIN_MS) {
      /* Flood control: accepted silently, not recorded. The phone shows its
         own animation either way, so the room never notices the throttle. */
      return { ok: true as const, throttled: true };
    }
    player.lastReactAt = now;
    session.reactions.push({ kind, at: now });
    if (session.reactions.length > REACTIONS_CAP) {
      session.reactions.splice(0, session.reactions.length - REACTIONS_CAP);
    }
    return { ok: true as const };
  });
}

/** The phone's poll. Cheap when nothing changed. */
export function playerState(code: string, playerId?: unknown, token?: unknown, since?: number) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return readSession(code, (session) => {
    if (since !== undefined && Number(since) === session.revision) {
      return { ok: true as const, unchanged: true as const, revision: session.revision };
    }
    let you: { name: string; chips: number; pick: LivePick | null } | null = null;
    if (playerId && token) {
      const player = playerOf(session, playerId, token);
      if (player) {
        you = {
          name: player.name,
          chips: player.chips,
          pick: session.picks[session.show.raceNo]?.[player.id] ?? null,
        };
      }
    }
    const leaderboard = Object.values(session.players)
      .map((p) => ({ name: p.name, chips: p.chips }))
      .sort((a, b) => b.chips - a.chips)
      .slice(0, 10);
    return {
      ok: true as const,
      revision: session.revision,
      showRevision: session.showRevision ?? session.revision,
      raceStatus: session.race?.status ?? initialRace(session.show, session.settled).status,
      raceAttempt: session.race?.attempt ?? 1,
      show: session.show,
      players: Object.keys(session.players).length,
      leaderboard,
      you,
    };
  });
}

/* ── Join flood control, per source address ───────────────────────────── */

const joinBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * True when this source may attempt another join. Venue Wi-Fi commonly puts
 * the whole room behind one NAT address, so the outer limit accommodates a
 * 300-player room plus retry headroom; room capacity and player tokens are
 * the tighter inner controls.
 */
export function joinAllowed(addr: string): boolean {
  const now = Date.now();
  if (joinBuckets.size > 2000) {
    for (const [key, value] of joinBuckets) {
      if (now > value.resetAt) joinBuckets.delete(key);
    }
  }
  const bucket = joinBuckets.get(addr);
  if (!bucket || now > bucket.resetAt) {
    joinBuckets.set(addr, { count: 1, resetAt: now + JOIN_SOURCE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= JOIN_ATTEMPTS_PER_SHARED_SOURCE;
}
