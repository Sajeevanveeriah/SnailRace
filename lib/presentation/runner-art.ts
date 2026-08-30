const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

export const RUNNER_ART_BASE = `${BASE_PATH}/art/snails`;

/**
 * The first eight lane identities, ordered to match the default line-up.
 * Keeping this manifest separate from the renderer makes every consumer use
 * the same deterministic lane-to-art mapping.
 */
export const RUNNER_ART_MANIFEST = [
  {
    id: 'speedy',
    defaultName: 'Speedy',
    src: `${RUNNER_ART_BASE}/speedy.png`,
    width: 498,
    height: 344,
  },
  {
    id: 'turbo',
    defaultName: 'Turbo',
    src: `${RUNNER_ART_BASE}/turbo.png`,
    width: 512,
    height: 340,
  },
  {
    id: 'lightning',
    defaultName: 'Lightning',
    src: `${RUNNER_ART_BASE}/lightning.png`,
    width: 481,
    height: 358,
  },
  {
    id: 'flash',
    defaultName: 'Flash',
    src: `${RUNNER_ART_BASE}/flash.png`,
    width: 501,
    height: 367,
  },
  {
    id: 'rocket',
    defaultName: 'Rocket',
    src: `${RUNNER_ART_BASE}/rocket.png`,
    width: 512,
    height: 340,
  },
  {
    id: 'bolt',
    defaultName: 'Bolt',
    src: `${RUNNER_ART_BASE}/bolt.png`,
    width: 491,
    height: 307,
  },
  {
    id: 'maroon-comet',
    defaultName: 'Comet',
    src: `${RUNNER_ART_BASE}/maroon-comet.png`,
    width: 1536,
    height: 1024,
  },
  {
    id: 'dino-dash',
    defaultName: 'Dasher',
    src: `${RUNNER_ART_BASE}/dino-dash.png`,
    width: 1536,
    height: 1024,
  },
] as const;

export type RunnerArtAsset = (typeof RUNNER_ART_MANIFEST)[number];

/** Resolve any integer lane onto the stable eight-runner art cycle. */
export function runnerArtForLane(lane: number): RunnerArtAsset {
  const integerLane = Number.isFinite(lane) ? Math.trunc(lane) : 0;
  const index =
    ((integerLane % RUNNER_ART_MANIFEST.length) + RUNNER_ART_MANIFEST.length) %
    RUNNER_ART_MANIFEST.length;
  return RUNNER_ART_MANIFEST[index];
}
