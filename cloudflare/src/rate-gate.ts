import type { DurableObjectState, WorkerEnv } from './platform';
import { asObject, fail, jsonResponse, ok } from './protocol';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Durable, per-source admission control for room creation and joins. */
export class RateGate {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: WorkerEnv) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/check') {
      return jsonResponse(fail('Not found.', 404));
    }
    let body: Record<string, unknown> | null = null;
    try {
      body = asObject(JSON.parse(await request.text()) as unknown);
    } catch {
      body = null;
    }
    const bucketName = body?.bucket;
    const limit = body?.limit;
    const windowMs = body?.windowMs;
    if (
      typeof bucketName !== 'string' ||
      !/^[a-z-]{1,32}$/.test(bucketName) ||
      !Number.isSafeInteger(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 10_000 ||
      !Number.isSafeInteger(windowMs) ||
      Number(windowMs) < 1000 ||
      Number(windowMs) > 24 * 60 * 60 * 1000
    ) {
      return jsonResponse(fail('Malformed rate-limit request.', 400));
    }

    const now = Date.now();
    let alarmAt = now + Number(windowMs);
    const result = await this.state.storage.transaction(async (transaction) => {
      const key = `bucket:${bucketName}`;
      const previous = await transaction.get<Bucket>(key);
      const bucket =
        !previous || now >= previous.resetAt
          ? { count: 0, resetAt: now + Number(windowMs) }
          : previous;
      bucket.count += 1;
      await transaction.put(key, bucket);
      const previousExpiry = (await transaction.get<number>('expiry')) ?? 0;
      alarmAt = Math.max(previousExpiry, bucket.resetAt);
      await transaction.put('expiry', alarmAt);
      if (bucket.count > Number(limit)) {
        return {
          ...fail('Too many requests from this connection. Try again later.', 429),
          headers: { 'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))) },
        };
      }
      return ok({ remaining: Math.max(0, Number(limit) - bucket.count), resetAt: bucket.resetAt });
    });
    await this.state.storage.setAlarm(alarmAt);
    return jsonResponse(result);
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
