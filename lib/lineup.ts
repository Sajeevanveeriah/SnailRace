import type { LineupToken } from './types';

/**
 * The donor's phone needs to know which snails are in the current race, and
 * the stage is the only device that knows. Rather than stand up a database
 * for eight names, the stage encodes the line-up into the QR code it is
 * already showing, and the phone decodes it back.
 *
 * Consequences, stated plainly:
 *   - a QR photographed earlier in the night carries an older `r` (race
 *     number), so the server can tell a stale scan from a current one;
 *   - the token is not a secret and is not signed. The worst a tampered
 *     token can do is attach a donation to a snail name that was not in the
 *     race. The money still arrives; the moderator can reassign the entry.
 *     Nothing in the token can influence the draw.
 */

const enc = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const dec = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export function encodeLineup(token: LineupToken): string {
  return enc(JSON.stringify(token));
}

export function decodeLineup(raw: string | null | undefined): LineupToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(dec(raw)) as LineupToken;
    if (parsed?.v !== 1 || !Array.isArray(parsed.n) || parsed.n.length < 2) return null;
    return {
      v: 1,
      e: String(parsed.e || '').slice(0, 40),
      r: Number(parsed.r) || 1,
      c: String(parsed.c || '').slice(0, 80),
      n: parsed.n.slice(0, 8).map((x) => String(x).slice(0, 40)),
    };
  } catch {
    return null;
  }
}

/** Node-safe decode for API routes, where atob/btoa on Buffers is clearer. */
export function decodeLineupServer(raw: string | null | undefined): LineupToken | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as LineupToken;
    if (parsed?.v !== 1 || !Array.isArray(parsed.n)) return null;
    return parsed;
  } catch {
    return null;
  }
}
