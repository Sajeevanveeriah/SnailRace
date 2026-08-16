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
