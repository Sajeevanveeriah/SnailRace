/**
 * Minimal Cloudflare runtime shapes used by this worker.
 *
 * Keeping these local makes the worker source dependency-free. Wrangler
 * supplies the real implementations at runtime; these interfaces deliberately
 * cover only the methods used here.
 */

export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  get<T>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  transaction<T>(callback: (transaction: DurableObjectStorage) => Promise<T>): Promise<T>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface WorkerEnv {
  RACE_ROOM: DurableObjectNamespace;
  RATE_GATE: DurableObjectNamespace;
  /** Comma-separated, exact browser origins. No wildcard is accepted. */
  ALLOWED_ORIGINS?: string;
}
