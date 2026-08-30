export const FIELD_SIZE = 8;
export const LIVE_CHIP_START = 100;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_PLAYERS = 300;
export const MAX_RECEIPTS = 10_000;
export const MAX_PLAYER_RECEIPTS = 6_000;
export const MAX_OPERATOR_RECEIPTS = 4_000;
export const MAX_PICK_COMMANDS_PER_PLAYER = 100;
export const MAX_REACTIONS = 400;
export const REACT_MIN_MS = 1500;

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REACTION_KINDS = new Set(['cheer', 'laugh', 'shock', 'snail', 'clap']);
export const SHOW_PHASES = new Set([
  'lobby',
  'racecard',
  'market',
  'race',
  'results',
  'championship',
  'intermission',
  'finale',
]);

export interface LiveShow {
  eventName: string;
  clubName: string;
  raceNo: number;
  phase: string;
  marketOpen: boolean;
  names: string[];
  odds: Record<number, number>;
  result: {
    raceNo: number;
    winnerLane: number;
    order: { lane: number; name: string; place: number }[];
  } | null;
  rehearsal: boolean;
}

export type RaceStatus =
  | 'PENDING'
  | 'OPEN'
  | 'LOCKED'
  | 'RUNNING'
  | 'DRAWN'
  | 'SETTLED'
  | 'VOID';

export interface RaceState {
  raceNo: number;
  status: RaceStatus;
  attempt: number;
  planHash?: string;
}

export interface SessionMeta {
  schema: 1;
  code: string;
  operatorKey: string;
  pinHash?: string;
  createdAt: number;
  revision: number;
  showRevision: number;
  show: LiveShow;
  race: RaceState;
  playerCount: number;
  receiptCount: number;
  playerReceiptCount: number;
  operatorReceiptCount: number;
  reactions: { kind: string; at: number }[];
  endedAt?: number;
}

/** Sanitised expiry marker: retains 410 semantics without room credentials. */
export interface RoomTombstone {
  schema: 1;
  tombstone: true;
  code: string;
  expiredAt: number;
}

export interface LivePlayer {
  id: string;
  token: string;
  name: string;
  chips: number;
  joinedAt: number;
  lastSeen: number;
  lastReactAt: number;
  pickCommandCount: number;
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

export interface Settlement {
  winnerLane: number;
  at: number;
}

export interface CommandReceipt {
  kind: string;
  requestHash: string;
  status: number;
  response: Record<string, unknown>;
  at: number;
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export const ok = (body: Record<string, unknown>, status = 200): ApiResult => ({
  status,
  body: { ok: true, ...body },
});

export const fail = (error: string, status: number, extra?: Record<string, unknown>): ApiResult => ({
  status,
  body: { ok: false, error, ...(extra ?? {}) },
});

export const jsonResponse = (result: ApiResult): Response => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...(result.headers ?? {}),
  });
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
};

export function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export const validCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z2-9]{6}$/.test(value);

export const validCommandId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(value);

export const validPlanHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function parseLiveShow(value: unknown): LiveShow | null {
  const raw = asObject(value);
  if (!raw) return null;
  const eventName = typeof raw.eventName === 'string' ? raw.eventName.trim() : '';
  const clubName = typeof raw.clubName === 'string' ? raw.clubName.trim() : '';
  const raceNo = raw.raceNo;
  const phase = raw.phase;
  if (
    !eventName ||
    eventName.length > 100 ||
    /[\u0000-\u001F\u007F]/.test(eventName) ||
    !clubName ||
    clubName.length > 100 ||
    /[\u0000-\u001F\u007F]/.test(clubName)
  ) {
    return null;
  }
  if (!Number.isSafeInteger(raceNo) || Number(raceNo) < 1 || Number(raceNo) > 10_000) return null;
  if (typeof phase !== 'string' || !SHOW_PHASES.has(phase)) return null;
  if (typeof raw.marketOpen !== 'boolean' || typeof raw.rehearsal !== 'boolean') return null;
  if (!Array.isArray(raw.names) || raw.names.length !== FIELD_SIZE) return null;

  const names: string[] = [];
  for (const supplied of raw.names) {
    if (typeof supplied !== 'string' || /[\u0000-\u001F\u007F]/.test(supplied)) return null;
    const name = supplied.trim();
    if (!name || name.length > 40) return null;
    names.push(name);
  }

  if (!raw.odds || typeof raw.odds !== 'object' || Array.isArray(raw.odds)) return null;
  const odds: Record<number, number> = {};
  for (let lane = 0; lane < FIELD_SIZE; lane += 1) {
    const odd = Number((raw.odds as Record<string, unknown>)[String(lane)]);
    if (!Number.isFinite(odd) || odd <= 0 || odd > 10_000) return null;
    odds[lane] = odd;
  }

  let result: LiveShow['result'] = null;
  if (raw.result !== null) {
    const supplied = asObject(raw.result);
    if (
      !supplied ||
      !Number.isSafeInteger(supplied.raceNo) ||
      Number(supplied.raceNo) < 1 ||
      Number(supplied.raceNo) > Number(raceNo) ||
      !Number.isSafeInteger(supplied.winnerLane) ||
      Number(supplied.winnerLane) < 0 ||
      Number(supplied.winnerLane) >= FIELD_SIZE ||
      !Array.isArray(supplied.order) ||
      supplied.order.length !== FIELD_SIZE
    ) {
      return null;
    }
    const order: NonNullable<LiveShow['result']>['order'] = [];
    const lanes = new Set<number>();
    const places = new Set<number>();
    for (const row of supplied.order) {
      const item = asObject(row);
      if (
        !item ||
        !Number.isSafeInteger(item.lane) ||
        Number(item.lane) < 0 ||
        Number(item.lane) >= FIELD_SIZE ||
        !Number.isSafeInteger(item.place) ||
        Number(item.place) < 1 ||
        Number(item.place) > FIELD_SIZE ||
        typeof item.name !== 'string'
      ) {
        return null;
      }
      const lane = Number(item.lane);
      const place = Number(item.place);
      if (lanes.has(lane) || places.has(place) || item.name.trim() !== names[lane]) return null;
      lanes.add(lane);
      places.add(place);
      order.push({ lane, place, name: names[lane] });
    }
    if (order.find((item) => item.place === 1)?.lane !== Number(supplied.winnerLane)) return null;
    result = {
      raceNo: Number(supplied.raceNo),
      winnerLane: Number(supplied.winnerLane),
      order,
    };
  }
  if (result?.raceNo === Number(raceNo) && raw.marketOpen) return null;

  return {
    eventName,
    clubName,
    raceNo: Number(raceNo),
    phase,
    marketOpen: raw.marketOpen,
    names,
    odds,
    result,
    rehearsal: raw.rehearsal,
  };
}

export function initialRace(show: LiveShow): RaceState {
  if (show.result?.raceNo === show.raceNo) {
    return { raceNo: show.raceNo, status: 'DRAWN', attempt: 1 };
  }
  if (show.marketOpen) return { raceNo: show.raceNo, status: 'OPEN', attempt: 1 };
  return { raceNo: show.raceNo, status: 'PENDING', attempt: 1 };
}

export function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const requestHashOf = (value: unknown): Promise<string> => sha256(stableJson(value));

export function randomToken(bytesLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function constantTimeEqual(left: unknown, right: string): boolean {
  if (typeof left !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < right.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | ApiResult> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') return fail('Content-Type must be application/json.', 415);
  const suppliedLength = request.headers.get('content-length');
  if (suppliedLength !== null) {
    const length = Number(suppliedLength);
    if (!Number.isSafeInteger(length) || length < 0) return fail('Invalid request length.', 400);
    if (length > MAX_BODY_BYTES) return fail('Request too large.', 413);
  }
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return fail('Request too large.', 413);
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    return asObject(parsed) ?? fail('Malformed request.', 400);
  } catch {
    return fail('Malformed request.', 400);
  }
}

export const isApiResult = (value: unknown): value is ApiResult =>
  typeof value === 'object' && value !== null && 'status' in value && 'body' in value;

export function operatorKeyOf(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

export const playerKey = (playerId: string): string => `player:${playerId}`;
export const pickPrefix = (raceNo: number, attempt: number): string =>
  `pick:${raceNo}:${attempt}:`;
export const pickKey = (raceNo: number, attempt: number, playerId: string): string =>
  `${pickPrefix(raceNo, attempt)}${playerId}`;
export const settledKey = (raceNo: number, attempt: number): string =>
  `settled:${raceNo}:${attempt}`;
export const voidKey = (raceNo: number, attempt: number): string => `void:${raceNo}:${attempt}`;
export const receiptKey = (scope: string, commandId: string): string =>
  `receipt:${scope}:${commandId}`;

export const sameField = (left: LiveShow, right: LiveShow): boolean =>
  stableJson(left.names) === stableJson(right.names) && stableJson(left.odds) === stableJson(right.odds);
