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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isPages
    ? {
        output: 'export' as const,
        basePath: '/SnailRace',
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
