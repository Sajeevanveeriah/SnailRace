import type { NextConfig } from 'next';

/**
 * Two deployment shapes from one codebase:
 *
 *   - Server (Vercel, Node, anything that runs `next start`): full app, the
 *     Stripe API routes included. The default.
 *   - GitHub Pages (`GITHUB_PAGES=true`): a static export of the game alone.
 *     Pages cannot run server code, so the deploy workflow removes `app/api`
 *     before building and the stage falls back to cash-only mode, saying so
 *     on screen. Card donations need the server shape.
 *
 * A project site is served under /SnailRace, hence the basePath.
 */
const isPages = process.env.GITHUB_PAGES === 'true';

/*
 * The audio engine fetches its optional drop-in files at runtime rather than
 * importing them, so it cannot rely on the bundler to rewrite the URL. It
 * reads the prefix from here instead.
 */
const basePath = isPages ? '/SnailRace' : '';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * `STATIC_EXPORT` tells the client there is no API behind it. Without it the
   * donation poll and the payment-link fetch keep calling /api/... from a
   * static host, where those paths belong to a different site entirely and
   * answer 404 every few seconds for the whole night.
   */
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_STATIC_EXPORT: isPages ? '1' : '',
  },
  ...(isPages
    ? {
        output: 'export' as const,
        basePath,
        trailingSlash: true,
      }
    : {
        async headers() {
          return [
            {
              source: '/:path*',
              headers: [
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
