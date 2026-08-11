/**
 * Clock and id minting, kept out of components.
 *
 * `Date.now()` and `Math.random()` are impure, and React's newer lint rules
 * are right to object to them appearing inside a component body even when the
 * call only ever happens from an event handler. Routing both through one
 * module keeps the components declarative and gives ledger ids a single
 * definition to reason about.
 */

export const nowMs = (): number => Date.now();

/** Short, sortable-enough, collision-safe for one club night. */
export function newId(prefix: string): string {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return `${prefix}${Date.now().toString(36)}${buf[0].toString(36).padStart(6, '0').slice(0, 6)}`;
}

/** ISO date compacted to YYYYMMDD, for export filenames. */
export const dateStamp = (): string =>
  new Date().toISOString().slice(0, 10).replace(/-/g, '');

/** Local timestamp for a printed report, formatted for an Australian reader. */
export const formattedNow = (): string => new Date().toLocaleString('en-AU');
