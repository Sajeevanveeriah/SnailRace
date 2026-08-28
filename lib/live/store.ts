import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * The live event store: Phone Play's single source of truth.
 *
 * Player phones are never authoritative for anything. The stage device
 * creates a session and pushes the show state; phones join with a code,
 * poll a revisioned snapshot, and submit picks and reactions that are
 * validated HERE - market open, chips available, race current, nonce unseen.
 * Settlement runs here exactly once per race.
 *
 * Durability is a JSON file per session under a local data directory, so the
 * stage laptop can reboot between races without losing the room. This is
 * deliberately not a cloud database: the smallest reliable store for a hall,
 * behind an interface a later deployment could re-implement. In-process
 * consistency comes from serialising each session's mutations through one
 * promise queue.
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

export interface LiveSession {
  code: string;
  operatorKey: string;
  pinHash?: string;
  createdAt: number;
  revision: number;
  show: LiveShow;
  players: Record<string, LivePlayer>;
  /** raceNo -> playerId -> pick. One pick per player per race, replaceable while open. */
  picks: Record<number, Record<string, LivePick>>;
  /** raceNo -> settlement record. The exactly-once guard. */
  settled: Record<number, { winnerLane: number; at: number }>;
  /** Recent reactions, oldest first, capped. */
  reactions: { kind: string; at: number }[];
  /** Set when the operator closes the room; every later call answers 410. */
  endedAt?: number;
}

export const LIVE_CHIP_START = 100;
const MAX_PLAYERS = 300;
const MAX_NAME = 24;
const REACTION_KINDS = ['cheer', 'laugh', 'shock', 'snail', 'clap'] as const;
const REACT_MIN_MS = 1500;
const REACTIONS_CAP = 400;
const SESSION_TTL_MS = 24 * 3600_000;

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

/** Strip control characters and clamp; the client also escapes on render. */
export const cleanName = (value: unknown): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_NAME);

const validCode = (code: unknown): code is string =>
  typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code);

async function load(code: string): Promise<LiveSession | null> {
  const hit = sessions.get(code);
  if (hit) return hit;
  try {
    const raw = await fs.readFile(fileOf(code), 'utf8');
    const parsed = JSON.parse(raw) as LiveSession;
    if (parsed?.code !== code) return null;
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

/** Serialise all mutations of one session, so two phones cannot interleave. */
function withSession<T>(
  code: string,
  fn: (session: LiveSession) => Promise<T> | T,
): Promise<T | { error: string; status: number }> {
  const prev = queues.get(code) ?? Promise.resolve();
  const next = prev.then(async () => {
    const session = await load(code);
    if (!session) return { error: 'That session code is not running.', status: 404 };
    if (session.endedAt || Date.now() - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(code);
      return { error: 'That session has ended.', status: 410 };
    }
    const out = await fn(session);
    await persist(session);
    return out;
  });
  queues.set(code, next.catch(() => undefined));
  return next as Promise<T | { error: string; status: number }>;
}

export const isError = (x: unknown): x is { error: string; status: number } =>
  typeof x === 'object' && x !== null && 'error' in x;

/* ── Operator surface ─────────────────────────────────────────────────── */

export async function createSession(
  show: LiveShow,
  pin?: string,
): Promise<{ code: string; operatorKey: string }> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let code = randomCode();
  /* A collision across a handful of live sessions is unlikely; still, look. */
  for (let i = 0; i < 5 && (await load(code)); i++) code = randomCode();
  const session: LiveSession = {
    code,
    operatorKey: randomKey(),
    ...(pin ? { pinHash: pinHashOf(pin, code) } : {}),
    createdAt: Date.now(),
    revision: 1,
    show,
    players: {},
    picks: {},
    settled: {},
    reactions: [],
  };
  sessions.set(code, session);
  await persist(session);
  return { code, operatorKey: session.operatorKey };
}

const operatorOk = (session: LiveSession, key: unknown): boolean =>
  typeof key === 'string' &&
  key.length === session.operatorKey.length &&
  crypto.timingSafeEqual(Buffer.from(key), Buffer.from(session.operatorKey));

export function updateShow(code: string, operatorKey: unknown, show: LiveShow) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    session.show = show;
    session.revision += 1;
    return { ok: true as const, revision: session.revision };
  });
}

/** Settle one race's phone picks exactly once, at each pick's locked odds. */
export function settleRace(code: string, operatorKey: unknown, raceNo: number, winnerLane: number) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    if (!Number.isInteger(raceNo) || raceNo < 1) return { error: 'Bad race number.', status: 400 };
    if (session.settled[raceNo]) {
      return { ok: true as const, already: true, settled: session.settled[raceNo] };
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
    session.revision += 1;
    return { ok: true as const, winners, paid };
  });
}

/** Close the room: phones polling it are told the event has ended (410). */
export function endSession(code: string, operatorKey: unknown) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
    if (!operatorOk(session, operatorKey)) return { error: 'Not the operator.', status: 403 };
    session.endedAt = Date.now();
    session.revision += 1;
    return { ok: true as const, endedAt: session.endedAt };
  });
}

export function operatorSummary(code: string, operatorKey: unknown, reactionsSince: number) {
  if (!validCode(code)) return Promise.resolve({ error: 'Bad session code.', status: 400 });
  return withSession(code, (session) => {
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
  player.lastSeen = Date.now();
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
    if (!Number.isInteger(raceNo) || raceNo !== session.show.raceNo) {
      return { error: 'That race has moved on. Refresh and pick again.', status: 409 };
    }
    if (!session.show.marketOpen) return { error: 'The market is closed for this race.', status: 409 };
    if (!Number.isInteger(lane) || lane < 0 || lane >= session.show.names.length) {
      return { error: 'Pick a snail that is in the field.', status: 400 };
    }
    if (!Number.isInteger(chips) || chips <= 0) return { error: 'Chips must be a positive whole number.', status: 400 };
    if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 64) {
      return { error: 'Malformed request.', status: 400 };
    }

    const book = (session.picks[raceNo] ??= {});
    const existing = book[player.id];
    if (existing?.nonce === nonce) {
      /* The duplicate submit: same answer, no double spend. */
      return { ok: true as const, duplicate: true, bank: player.chips, pick: existing };
    }
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
    session.revision += 1;
    return { ok: true as const, bank: player.chips, pick };
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
  return withSession(code, (session) => {
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
      show: session.show,
      players: Object.keys(session.players).length,
      leaderboard,
      you,
    };
  });
}

/* ── Join flood control, per source address ───────────────────────────── */

const joinBuckets = new Map<string, { count: number; resetAt: number }>();

/** True when this address may attempt another join. 20 per 5 minutes. */
export function joinAllowed(addr: string): boolean {
  const now = Date.now();
  const bucket = joinBuckets.get(addr);
  if (!bucket || now > bucket.resetAt) {
    joinBuckets.set(addr, { count: 1, resetAt: now + 5 * 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 20;
}
