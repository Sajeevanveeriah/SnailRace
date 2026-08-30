import type { WorkerEnv } from './platform';
import {
  MAX_BODY_BYTES,
  asObject,
  fail,
  isApiResult,
  jsonResponse,
  ok,
  parseLiveShow,
  randomCode,
  readJsonBody,
  sha256,
  validCode,
} from './protocol';

export { RaceRoom } from './race-room';
export { RateGate } from './rate-gate';

const LIVE_PREFIX = '/api/live/';
const LIVE_HEALTH_PATH = '/api/live/health';
const POST_PATHS = new Set([
  '/api/live/session',
  '/api/live/join',
  '/api/live/pick',
  '/api/live/react',
  '/api/live/state',
  '/api/live/lock',
  '/api/live/run',
  '/api/live/void',
  '/api/live/rearm',
  '/api/live/settle',
  '/api/live/end',
]);
const GET_PATHS = new Set(['/api/live/state', '/api/live/summary']);
/* One venue Wi-Fi commonly means one public IP. Admit a full 300-player room
   plus retry headroom, while still bounding cross-room join floods. */
const JOIN_SOURCE_LIMIT = 360;
const JOIN_SOURCE_WINDOW_MS = 15 * 60 * 1000;

function configuredOrigins(env: WorkerEnv): Set<string> {
  const origins = new Set<string>();
  for (const entry of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    const candidate = entry.trim().replace(/\/$/, '');
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        parsed.origin === candidate
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // Invalid entries never broaden the allowlist.
    }
  }
  return origins;
}

function corsOrigin(request: Request, env: WorkerEnv): string | null {
  const supplied = request.headers.get('origin');
  if (!supplied || supplied === 'null') return null;
  try {
    const normalised = new URL(supplied).origin;
    return normalised === supplied.replace(/\/$/, '') && configuredOrigins(env).has(normalised)
      ? normalised
      : null;
  } catch {
    return null;
  }
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function preflight(request: Request, env: WorkerEnv): Response {
  const origin = corsOrigin(request, env);
  const method = request.headers.get('access-control-request-method')?.toUpperCase();
  if (!origin || (method !== 'GET' && method !== 'POST')) {
    return withCors(jsonResponse(fail('Origin is not allowed.', 403)), null);
  }
  const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaders = new Set(['authorization', 'cache-control', 'content-type', 'pragma']);
  if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
    return withCors(jsonResponse(fail('Requested headers are not allowed.', 403)), origin);
  }
  return withCors(
    new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Cache-Control, Content-Type, Pragma',
        'Access-Control-Max-Age': '600',
      },
    }),
    origin,
  );
}

function sourceAddress(request: Request): string {
  const cloudflare = request.headers.get('cf-connecting-ip');
  if (cloudflare && /^[0-9A-Fa-f:.]{3,64}$/.test(cloudflare)) return cloudflare;
  // `local` deliberately coalesces all non-Cloudflare development traffic.
  return 'local';
}

async function admission(
  request: Request,
  env: WorkerEnv,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<Response | null> {
  const addressHash = await sha256(`snailrace-rate-v1:${sourceAddress(request)}`);
  const id = env.RATE_GATE.idFromName(addressHash);
  const response = await env.RATE_GATE.get(id).fetch('https://rate-gate.internal/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, limit, windowMs }),
  });
  return response.ok ? null : response;
}

function internalHeaders(request: Request): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const authorisation = request.headers.get('authorization');
  if (authorisation) headers.set('Authorization', authorisation);
  return headers;
}

async function createSession(
  request: Request,
  env: WorkerEnv,
  body: Record<string, unknown>,
): Promise<Response> {
  const show = parseLiveShow(body.show);
  const pin = body.pin === undefined ? undefined : body.pin;
  if (!show || (pin !== undefined && (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)))) {
    return jsonResponse(fail('Malformed show state.', 400));
  }
  const limited = await admission(request, env, 'create-room', 10, 60 * 60 * 1000);
  if (limited) return limited;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const code = randomCode();
    const id = env.RACE_ROOM.idFromName(code);
    const response = await env.RACE_ROOM.get(id).fetch('https://race-room.internal/__create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, show, ...(pin ? { pin } : {}) }),
    });
    if (response.status !== 409) return response;
  }
  return jsonResponse(fail('Could not allocate a unique Phone Play room code.', 503));
}

async function routeLive(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = corsOrigin(request, env);
  const allowlist = configuredOrigins(env);
  if (allowlist.size === 0) {
    return withCors(jsonResponse(fail('The browser origin allowlist is not configured.', 503)), null);
  }
  const suppliedOrigin = request.headers.get('origin');
  if (request.method === 'POST' && !origin) {
    return withCors(jsonResponse(fail('A valid allowed browser origin is required.', 403)), null);
  }
  if (request.method === 'GET' && suppliedOrigin && !origin) {
    return withCors(jsonResponse(fail('Origin is not allowed.', 403)), null);
  }

  if (request.method === 'POST') {
    if (!POST_PATHS.has(url.pathname)) return withCors(jsonResponse(fail('Not found.', 404)), origin);
    const suppliedLength = request.headers.get('content-length');
    if (suppliedLength !== null && Number(suppliedLength) > MAX_BODY_BYTES) {
      return withCors(jsonResponse(fail('Request too large.', 413)), origin);
    }
    const body = await readJsonBody(request);
    if (isApiResult(body)) return withCors(jsonResponse(body), origin);
    if (url.pathname === '/api/live/session') {
      return withCors(await createSession(request, env, body), origin);
    }
    const code = typeof body.code === 'string' ? body.code.toUpperCase() : '';
    if (!validCode(code)) return withCors(jsonResponse(fail('Bad session code.', 400)), origin);
    if (url.pathname === '/api/live/join') {
      const limited = await admission(
        request,
        env,
        'join-room',
        JOIN_SOURCE_LIMIT,
        JOIN_SOURCE_WINDOW_MS,
      );
      if (limited) return withCors(limited, origin);
    }
    const id = env.RACE_ROOM.idFromName(code);
    const forwarded = await env.RACE_ROOM.get(id).fetch(`https://race-room.internal${url.pathname}`, {
      method: 'POST',
      headers: internalHeaders(request),
      body: JSON.stringify({ ...body, code }),
    });
    return withCors(forwarded, origin);
  }

  if (request.method === 'GET') {
    if (!GET_PATHS.has(url.pathname)) return withCors(jsonResponse(fail('Not found.', 404)), origin);
    const code = (url.searchParams.get('code') ?? '').toUpperCase();
    if (!validCode(code)) return withCors(jsonResponse(fail('Bad session code.', 400)), origin);
    url.searchParams.set('code', code);
    const id = env.RACE_ROOM.idFromName(code);
    const forwarded = await env.RACE_ROOM.get(id).fetch(
      new Request(`https://race-room.internal${url.pathname}?${url.searchParams}`, {
        method: 'GET',
        headers: internalHeaders(request),
      }),
    );
    return withCors(forwarded, origin);
  }

  return withCors(jsonResponse(fail('Method not allowed.', 405)), origin);
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname.startsWith(LIVE_PREFIX)) {
      return preflight(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      const origin = corsOrigin(request, env);
      return withCors(
        jsonResponse(
          ok({
            service: 'snailrace-live',
            schema: 1,
            durability: 'cloudflare-durable-objects',
            originAllowlistConfigured: configuredOrigins(env).size > 0,
          }),
        ),
        origin,
      );
    }
    if (request.method === 'GET' && url.pathname === LIVE_HEALTH_PATH) {
      return withCors(
        jsonResponse(ok({ service: 'snailrace-live', schema: 1 })),
        corsOrigin(request, env),
      );
    }
    if (!url.pathname.startsWith(LIVE_PREFIX)) {
      return withCors(jsonResponse(fail('Not found.', 404)), null);
    }
    try {
      return await routeLive(request, env);
    } catch {
      return withCors(
        jsonResponse(fail('The live event service could not complete the request.', 500)),
        corsOrigin(request, env),
      );
    }
  },
};

export default worker;
