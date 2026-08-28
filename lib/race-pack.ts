import { mulberry32 } from './race-engine';
import { sha256Hex } from './audit';
import type { RacePackManifest } from './types';

/**
 * Recorded Race Packs.
 *
 * A pack is a card of recorded, simulated races - the Fundeo-shaped night,
 * rebuilt originally. The manifest commits to every race's runners, duration,
 * media fingerprint and finishing order BEFORE the night; the pack hash is
 * published into the audit at lock; and each race is chosen from the locked
 * eligible pool by a draw whose seed is also recorded. A changed media file,
 * a swapped result or an edited manifest all break a stated SHA-256.
 *
 * Honest limitation, stated where the operator can read it: the manifest
 * (results included) lives on the operator's own device, so this is tamper
 * EVIDENCE for the room, not secrecy from someone who owns the laptop and
 * inspects its storage on purpose.
 */

export const PACK_SCHEMA = 1;
export const PACK_MIN_RACES = 1;
export const PACK_MAX_RACES = 12;
export const RECOMMENDED_CARDS = [4, 6, 8, 10, 12];

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;

/** The canonical string the pack commitment hashes. Stated for replay. */
export function canonicalPack(pack: RacePackManifest): string {
  const races = pack.races
    .slice()
    .sort((a, b) => (a.raceId < b.raceId ? -1 : 1))
    .map((r) =>
      [
        r.raceId,
        r.title,
        /* Unit separator: runner lists can never collide by concatenation. */
        r.runners.join('\u001f'),
        r.sponsor ?? '',
        r.durationMs,
        r.mediaFileName,
        r.mediaSha256,
        r.mediaBytes,
        r.mediaType,
        r.resultOrder.join(','),
        r.source,
        r.licence,
      ].join('|'),
    );
  return ['ndcc-pack-v1', pack.packId, pack.title, pack.createdAt, ...races].join('\u001e');
}

export const packCommitment = (pack: RacePackManifest): Promise<string> =>
  sha256Hex(canonicalPack(pack));

/** Everything wrong with a pack, in operator language. Empty means valid. */
export function validatePack(pack: RacePackManifest): string[] {
  const errors: string[] = [];
  if (pack.schema !== PACK_SCHEMA) {
    errors.push(`Unknown pack schema ${String(pack.schema)}; this build reads schema ${PACK_SCHEMA}.`);
  }
  if (!pack.packId) errors.push('The pack has no packId.');
  if (!pack.title?.trim()) errors.push('The pack has no title.');
  if (!Array.isArray(pack.races) || pack.races.length < PACK_MIN_RACES) {
    errors.push('The pack contains no races.');
    return errors;
  }
  if (pack.races.length > PACK_MAX_RACES) {
    errors.push(`${pack.races.length} races is more than the ${PACK_MAX_RACES}-race maximum.`);
  }

  const ids = new Set<string>();
  const hashes = new Map<string, string>();
  pack.races.forEach((r, i) => {
    const at = `Race ${i + 1} (${r.raceId || 'no id'})`;
    if (!r.raceId) errors.push(`${at}: missing raceId.`);
    else if (ids.has(r.raceId)) errors.push(`${at}: duplicate raceId.`);
    ids.add(r.raceId);
    if (!r.title?.trim()) errors.push(`${at}: missing title.`);
    if (!Array.isArray(r.runners) || r.runners.length < 2 || r.runners.length > 20) {
      errors.push(`${at}: needs 2 to 20 runners.`);
    } else if (r.runners.some((n) => !n?.trim())) {
      errors.push(`${at}: has an unnamed runner.`);
    }
    if (!Number.isFinite(r.durationMs) || r.durationMs < 5_000 || r.durationMs > 20 * 60_000) {
      errors.push(`${at}: duration must be between 5 seconds and 20 minutes.`);
    }
    if (!r.mediaFileName) errors.push(`${at}: missing media file name.`);
    if (!/^[0-9a-f]{64}$/.test(r.mediaSha256 ?? '')) {
      errors.push(`${at}: missing or malformed media SHA-256.`);
    } else if (hashes.has(r.mediaSha256)) {
      errors.push(`${at}: uses the same media file as ${hashes.get(r.mediaSha256)}.`);
    } else {
      hashes.set(r.mediaSha256, r.raceId);
    }
    if (!VIDEO_TYPES.includes(r.mediaType) && !VIDEO_EXT.test(r.mediaFileName ?? '')) {
      errors.push(`${at}: ${r.mediaType || 'unknown type'} is not a supported video format.`);
    }
    const n = Array.isArray(r.runners) ? r.runners.length : 0;
    const order = Array.isArray(r.resultOrder) ? r.resultOrder : [];
    const perm =
      order.length === n &&
      new Set(order).size === n &&
      order.every((x) => Number.isInteger(x) && x >= 0 && x < n);
    if (!perm) errors.push(`${at}: resultOrder is not a complete finishing order for ${n} runners.`);
    if (!r.licence?.trim()) {
      errors.push(`${at}: missing licence statement. Only footage with rights for this use may play.`);
    }
    if (!r.source?.trim()) errors.push(`${at}: missing source statement.`);
  });
  return errors;
}

/**
 * Draw the next recorded race from the locked eligible pool.
 *
 * Deterministic from the recorded seed: sort the eligible ids, index with one
 * mulberry32 draw. The seed and the chosen race's media fingerprint go into
 * the audit, so the selection is replayable by anyone with the trail.
 */
export function drawPackRace(seed: number, eligibleIds: string[]): string | null {
  const pool = eligibleIds.slice().sort();
  if (pool.length === 0) return null;
  const rnd = mulberry32(seed >>> 0);
  return pool[Math.floor(rnd() * pool.length)];
}
