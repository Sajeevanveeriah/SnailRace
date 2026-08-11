import next from 'eslint-config-next';

/*
 * eslint-config-next 16 ships a flat config, so it is spread in directly.
 * `legacy/` is the previous zero-dependency build kept for offline nights and
 * is deliberately outside the lint surface.
 */
const config = [
  { ignores: ['legacy/**', '.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
];

export default config;
