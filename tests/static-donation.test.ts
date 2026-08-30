import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface Capabilities {
  isStatic: boolean;
  hasApi: boolean;
  hasLiveApi: boolean;
  liveApiOrigin: string;
  liveStatePath: string;
  donationPath: string;
}

interface PagesConfig {
  output?: string;
  basePath?: string;
  trailingSlash?: boolean;
  staticFlag?: string;
  publicBasePath?: string;
  liveApiOrigin?: string;
}

function runProbe(program: string, env: Record<string, string>): string {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', program],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  assert.equal(child.status, 0, child.stderr || 'static deployment probe failed');
  return child.stdout;
}

/**
 * `lib/deployment.ts` reads the build flag at module initialisation. A child
 * process gives each deployment shape a clean module graph, matching two
 * independent builds rather than mutating a cached import in this runner.
 */
function capabilitiesFor(staticExport: boolean, liveApiOrigin = ''): Capabilities {
  const moduleUrl = pathToFileURL(path.resolve('lib/deployment.ts')).href;
  const program = [
    `const imported = await import(${JSON.stringify(moduleUrl)});`,
    'const deployment = imported.default ?? imported;',
    "process.stdout.write(JSON.stringify({ isStatic: deployment.IS_STATIC_EXPORT, hasApi: deployment.HAS_API, hasLiveApi: deployment.HAS_LIVE_API, liveApiOrigin: deployment.LIVE_API_ORIGIN, liveStatePath: deployment.liveApiUrl('/api/live/state'), donationPath: deployment.withBasePath('/donate') }));",
  ].join('\n');
  return JSON.parse(
    runProbe(program, {
      NEXT_PUBLIC_STATIC_EXPORT: staticExport ? '1' : '',
      NEXT_PUBLIC_BASE_PATH: staticExport ? '/SnailRace' : '',
      NEXT_PUBLIC_LIVE_API_ORIGIN: liveApiOrigin,
    }),
  ) as Capabilities;
}

function pagesConfig(): PagesConfig {
  const moduleUrl = pathToFileURL(path.resolve('next.config.ts')).href;
  const program = [
    `const imported = await import(${JSON.stringify(moduleUrl)});`,
    'const config = imported.default?.default ?? imported.default ?? imported;',
    'process.stdout.write(JSON.stringify({',
    '  output: config.output,',
    '  basePath: config.basePath,',
    '  trailingSlash: config.trailingSlash,',
    '  staticFlag: config.env?.NEXT_PUBLIC_STATIC_EXPORT,',
    '  publicBasePath: config.env?.NEXT_PUBLIC_BASE_PATH,',
    '  liveApiOrigin: config.env?.NEXT_PUBLIC_LIVE_API_ORIGIN,',
    '}));',
  ].join('\n');
  return JSON.parse(
    runProbe(program, {
      GITHUB_PAGES: 'true',
      NEXT_PUBLIC_LIVE_API_ORIGIN: 'https://live.example.workers.dev/',
    }),
  ) as PagesConfig;
}

test('GitHub Pages publishes the static capability flag and project base path', () => {
  assert.deepEqual(pagesConfig(), {
    output: 'export',
    basePath: '/SnailRace',
    trailingSlash: true,
    staticFlag: '1',
    publicBasePath: '/SnailRace',
    liveApiOrigin: 'https://live.example.workers.dev/',
  });
});

test('static export disables the internal API capability', () => {
  assert.deepEqual(capabilitiesFor(true), {
    isStatic: true,
    hasApi: false,
    hasLiveApi: false,
    liveApiOrigin: '',
    liveStatePath: '/api/live/state',
    donationPath: '/SnailRace/donate',
  });
});

test('static export can route Phone Play to the Cloudflare service only', () => {
  assert.deepEqual(capabilitiesFor(true, 'https://live.example.workers.dev/'), {
    isStatic: true,
    hasApi: false,
    hasLiveApi: true,
    liveApiOrigin: 'https://live.example.workers.dev',
    liveStatePath: 'https://live.example.workers.dev/api/live/state',
    donationPath: '/SnailRace/donate',
  });
});

test('server build keeps the internal API capability', () => {
  assert.deepEqual(capabilitiesFor(false), {
    isStatic: false,
    hasApi: true,
    hasLiveApi: true,
    liveApiOrigin: '',
    liveStatePath: '/api/live/state',
    donationPath: '/donate',
  });
});
