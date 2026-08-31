import type { AuditEntry, LockedRacePlan, RaceResult } from './types';

/**
 * The audit trail and its hashes.
 *
 * Two hashes make a race checkable after the fact:
 *   - the COMMITMENT binds the seed to the exact configuration it was drawn
 *     for (field, names, length, laps, surprises), so a result cannot be
 *     quietly re-attributed to a different race set-up;
 *   - the RESULT HASH fingerprints the finishing order, so a printed report,
 *     a backup and the screen can be compared without reading every row.
 *
 * Both are plain SHA-256 over a stated canonical string, so anyone with a
 * terminal can reproduce them - auditability that depends on this app being
 * present is not auditability.
 *
 * `crypto.subtle` only exists in secure contexts, and a projector laptop on a
 * venue LAN over plain http is exactly where this app runs, so a small pure
 * fallback implementation is kept below. Same algorithm, same output.
 */

export type { AuditEntry } from './types';

/** Everything the commitment binds. Order and content are the canon. */
export interface RaceConfig {
  raceNo: number;
  raceType: string;
  fieldSize: number;
  names: string[];
  durationMs: number;
  laps: number;
  surprises: boolean;
  trackShape: string;
  /**
   * Surprise Director preset. Part of the commitment from v4 on; races
   * recorded before presets existed verify against the v1 canonical string,
   * which this field's absence selects.
   */
  intensity?: string;
  /** Broadcast course, bound from the multi-course release onward. */
  courseId?: string;
}

/** The canonical string the commitment hashes. Stated so it can be replayed. */
export const commitmentInput = (seedHex: string, config: RaceConfig): string => {
  const base = [
    config.courseId !== undefined
      ? 'ndcc-race-commit-v3'
      : config.intensity === undefined
        ? 'ndcc-race-commit-v1'
        : 'ndcc-race-commit-v2',
    seedHex.toUpperCase(),
    config.raceNo,
    config.raceType,
    config.fieldSize,
    /* Unit separator, so ['AB','C'] can never collide with ['A','BC']. */
    config.names.join('\u001f'),
    config.durationMs,
    config.laps,
    config.surprises ? 1 : 0,
    config.trackShape,
  ];
  if (config.intensity !== undefined) base.push(config.intensity);
  if (config.courseId !== undefined) base.push(config.courseId);
  return base.join('|');
};

export const commitmentOf = (seedHex: string, config: RaceConfig): Promise<string> =>
  sha256Hex(commitmentInput(seedHex, config));

/**
 * True only for result rows written before first-finisher classification.
 * Keeping this selection narrow preserves every v1 canonical string while
 * ensuring a partially migrated or status-bearing result is hashed as v2.
 */
const isLegacyResult = (r: RaceResult): boolean =>
  r.finishMs !== null &&
  r.status === undefined &&
  r.progressAtStop === undefined &&
  r.retiredAtMs === undefined &&
  r.retirementCode === undefined &&
  r.retirementLabel === undefined;

/** An unambiguous ordered row for status-aware result and plan hashes. */
const canonicalResultV2Row = (r: RaceResult): readonly unknown[] => [
  r.place,
  r.lane,
  r.name,
  r.finishMs,
  r.status ?? null,
  r.progressAtStop ?? null,
  r.retiredAtMs ?? null,
  r.retirementCode ?? null,
  r.retirementLabel ?? null,
];

/**
 * The canonical string the result hash covers.
 *
 * Legacy all-finisher rows retain the byte-for-byte v1 representation.
 * Results carrying first-finisher classification use v2, which also binds
 * progress-at-stop and retirement metadata. JSON tuples make names and
 * labels containing punctuation unambiguous.
 */
export const resultInput = (seedHex: string, results: RaceResult[]): string => {
  if (results.every(isLegacyResult)) {
    return [
      'ndcc-race-result-v1',
      seedHex.toUpperCase(),
      ...results
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((r) => `${r.place}:${r.lane}:${r.name}:${r.finishMs}`),
    ].join('|');
  }

  const rows = results
    .slice()
    .sort((a, b) => a.place - b.place || a.lane - b.lane)
    .map(canonicalResultV2Row);
  return ['ndcc-race-result-v2', seedHex.toUpperCase(), JSON.stringify(rows)].join('|');
};

export const resultHashOf = (seedHex: string, results: RaceResult[]): Promise<string> =>
  sha256Hex(resultInput(seedHex, results));

/* ── The immutable consequential race plan ───────────────────────────── */

/**
 * Canonicalise a complete locked plan without relying on object key order.
 * Arrays remain ordered because their order is part of the runtime plan;
 * numeric record keys are sorted explicitly so construction order is not.
 */
export const canonicalRacePlan = (plan: LockedRacePlan): string => {
  const runners = plan.runners.map((r) => [
    r.lane,
    r.name,
    r.baseFinishMs,
    r.A,
    r.w1,
    r.w2,
    r.ph1,
    r.ph2,
  ]);

  const events = plan.events.map((event) => [
    event.id,
    event.kind,
    event.label,
    event.tone,
    event.sound,
    event.targetLanes,
    event.consequence,
    event.warningAtMs,
    event.revealAtMs,
    event.effectAtMs,
    event.commentaryAtMs,
    event.effectEndMs,
    Object.entries(event.clockDeltaMsByLane)
      .map(([lane, delta]) => [Number(lane), delta])
      .sort((a, b) => a[0] - b[0]),
    event.warningText,
    event.revealText,
    event.commentaryText,
    event.retirementCode ?? null,
    event.retirementLabel ?? null,
  ]);

  const cues = plan.cues.map((cue) => [
    cue.id,
    cue.eventId,
    cue.phase,
    cue.atMs,
    cue.text,
    cue.lane ?? null,
    cue.tone ?? null,
    cue.sound ?? null,
    cue.big ?? null,
  ]);

  const results = plan.results.map(canonicalResultV2Row);
  const canonical = [
    plan.schema,
    plan.engine,
    plan.seed,
    plan.seedHex.toUpperCase(),
    plan.names,
    plan.durationMs,
    plan.laps,
    plan.surprises,
    plan.intensity,
    plan.trackShape,
    ...(plan.courseId === undefined ? [] : [plan.courseId]),
    plan.weather,
    plan.photoFinish,
    runners,
    events,
    cues,
    results,
    plan.winnerLane,
    plan.stopAtMs,
  ];

  return `ndcc-race-plan-v${plan.courseId === undefined ? 1 : 2}|${JSON.stringify(canonical)}`;
};

export const planHashOf = (plan: LockedRacePlan): Promise<string> =>
  sha256Hex(canonicalRacePlan(plan));

/* ── The audit hash chain ──────────────────────────────────────────────── */

/**
 * The canonical string one audit entry contributes to the chain. Stated so
 * an exported trail can be verified with nothing but a SHA-256 tool:
 *
 *   entryHash = SHA-256(prevHash + canonicalAuditEntry(entry))
 *
 * A removed, reordered or edited entry breaks every hash after it. On a
 * capped or migrated trail the chain is verified from its oldest chained
 * entry forward, with that entry's prevHash taken as the anchor.
 */
export const canonicalAuditEntry = (e: Pick<AuditEntry, 'id' | 'at' | 'kind' | 'raceNo' | 'detail'>): string =>
  ['ndcc-audit-v1', e.id, e.at, e.kind, e.raceNo, e.detail].join('|');

export interface ChainReport {
  ok: boolean;
  /** Entries carrying chain hashes. */
  chained: number;
  /** Entries predating the chain (v3 nights), anchoring it. */
  unchained: number;
  /** id of the first entry whose hash does not verify, when !ok. */
  breakAt?: string;
}

/** Verify a trail as stored: newest first. */
export async function verifyAuditChain(auditNewestFirst: AuditEntry[]): Promise<ChainReport> {
  const chrono = auditNewestFirst.slice().reverse().filter((e) => e.entryHash);
  const unchained = auditNewestFirst.length - chrono.length;
  let prev: string | null = null;
  for (const e of chrono) {
    /* The oldest chained entry anchors the chain: its prevHash is trusted. */
    const prevHash = prev === null ? (e.prevHash ?? '') : prev;
    if (prev !== null && e.prevHash !== prev) {
      return { ok: false, chained: chrono.length, unchained, breakAt: e.id };
    }
    const expect = await sha256Hex(prevHash + canonicalAuditEntry(e));
    if (expect !== e.entryHash) {
      return { ok: false, chained: chrono.length, unchained, breakAt: e.id };
    }
    prev = e.entryHash!;
  }
  return { ok: true, chained: chrono.length, unchained };
}

/* ── SHA-256 ───────────────────────────────────────────────────────────── */

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return toHex(new Uint8Array(digest));
    } catch {
      /* Insecure context. Fall through to the pure implementation. */
    }
  }
  return toHex(sha256Bytes(bytes));
}

export async function sha256HexOfBuffer(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return toHex(new Uint8Array(digest));
    } catch {
      /* fall through */
    }
  }
  return toHex(sha256Bytes(new Uint8Array(buf)));
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/* FIPS 180-4 SHA-256, kept for insecure contexts where subtle is absent. */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Bytes(input: Uint8Array): Uint8Array {
  const len = input.length;
  const bitLen = len * 8;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((x, i) => ov.setUint32(i * 4, x >>> 0));
  return out;
}

/** A short prefix for on-screen display. Full hashes live in exports. */
export const shortHash = (hex: string | undefined): string =>
  hex ? hex.slice(0, 12).toUpperCase() : '';
