/**
 * Which shape of the app is running.
 *
 * The same codebase ships two ways: a server deployment with the Stripe route
 * handlers, and a static export for GitHub Pages that has none. The static
 * export must not call /api/... at all. Those paths do not exist there, and on
 * a project Pages site they are not even the same site, so every poll lands as
 * a 404 against the owner's root Pages domain.
 */
export const IS_STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';

/** Card donations need the API. A static export is cash and chips only. */
export const HAS_API = !IS_STATIC_EXPORT;

/** Optional Durable Object service used by static GitHub Pages builds. */
export const LIVE_API_ORIGIN = (process.env.NEXT_PUBLIC_LIVE_API_ORIGIN ?? '').replace(/\/+$/, '');

/** Phone Play can use either the co-located Next API or the remote worker. */
export const HAS_LIVE_API = HAS_API || LIVE_API_ORIGIN.length > 0;

/** Route a Phone Play request to the configured durable service when present. */
export function liveApiUrl(path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return LIVE_API_ORIGIN ? `${LIVE_API_ORIGIN}${normalised}` : normalised;
}

/** Prefix an application route or public asset for project-hosted static builds. */
export function withBasePath(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalised}`;
}
