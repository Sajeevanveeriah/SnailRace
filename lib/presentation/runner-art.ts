const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

export const RUNNER_ART_BASE = `${BASE_PATH}/art/snails`;
export const SURPRISE_ART_BASE = `${BASE_PATH}/art/surprises`;

/**
 * The eight approved snails. WebP at most 768 px on the long side, with
 * transparency, re-encoded by scripts/optimise-art.py. Keeping this manifest
 * separate from the renderer makes every consumer use the same art.
 */
export const RUNNER_ART_MANIFEST = [
  {
    id: 'speedy',
    defaultName: 'Speedy',
    src: `${RUNNER_ART_BASE}/speedy.webp`,
    width: 498,
    height: 344,
  },
  {
    id: 'turbo',
    defaultName: 'Turbo',
    src: `${RUNNER_ART_BASE}/turbo.webp`,
    width: 512,
    height: 340,
  },
  {
    id: 'lightning',
    defaultName: 'Lightning',
    src: `${RUNNER_ART_BASE}/lightning.webp`,
    width: 481,
    height: 358,
  },
  {
    id: 'flash',
    defaultName: 'Flash',
    src: `${RUNNER_ART_BASE}/flash.webp`,
    width: 501,
    height: 367,
  },
  {
    id: 'rocket',
    defaultName: 'Rocket',
    src: `${RUNNER_ART_BASE}/rocket.webp`,
    width: 512,
    height: 340,
  },
  {
    id: 'bolt',
    defaultName: 'Bolt',
    src: `${RUNNER_ART_BASE}/bolt.webp`,
    width: 491,
    height: 307,
  },
  {
    id: 'maroon-comet',
    defaultName: 'Comet',
    src: `${RUNNER_ART_BASE}/maroon-comet.webp`,
    width: 768,
    height: 512,
  },
  {
    id: 'dino-dash',
    defaultName: 'Dasher',
    src: `${RUNNER_ART_BASE}/dino-dash.webp`,
    width: 768,
    height: 512,
  },
] as const;

export type RunnerArtAsset = (typeof RUNNER_ART_MANIFEST)[number];

/** The surprise props the race engine can throw in, as drawn on the course. */
export const SURPRISE_ART_IDS = [
  'boundary-bee',
  'club-dog',
  'cricket-ball',
  'groundskeeper-boot',
  'lettuce-crate',
  'magpie',
  'pitch-roller',
  'plague-cloud',
  'sprinkler',
] as const;

export const surpriseArtSrc = (id: string): string => `${SURPRISE_ART_BASE}/${id}.webp`;

const COUNT = RUNNER_ART_MANIFEST.length;
/** How far the art cycle moves on at each block of eight snail numbers. */
const BLOCK_STEP = 5;
/** Degrees of hue between two snails in one race that share a silhouette. */
export const HUE_STEP = 72;

/**
 * Which of the eight snails a snail number is drawn as, all night.
 *
 * Numbers 1 to 8 take the eight snails in order, 9 to 16 start five along,
 * 17 to 24 two along, and so on through every offset: a snail keeps its art
 * on the racecard, the track, the result and the thank you, and the same
 * place in the next race (snail 5, then 13, then 21; or 5, 15, 25, 35 with
 * ten a race) is a different snail rather than the same one over and over.
 * Five is the step with the fewest repeat winners over four races for
 * fields of six, eight, ten and twelve.
 */
export function runnerArtIndexForSnail(snailNo: number): number {
  const n = Number.isFinite(snailNo) ? Math.max(1, Math.trunc(snailNo)) : 1;
  const i = n - 1;
  return (i + BLOCK_STEP * Math.floor(i / COUNT)) % COUNT;
}

export function runnerArtForSnail(snailNo: number): RunnerArtAsset {
  return RUNNER_ART_MANIFEST[runnerArtIndexForSnail(snailNo)];
}

export interface RunnerLook {
  snailNo: number;
  art: RunnerArtAsset;
  /** hue-rotate in degrees: 0 for the approved colourway. */
  hue: number;
}

/**
 * The look of every lane in one race, from the snail numbers in lane order.
 *
 * The silhouette is the snail number's own. When two snails in the same
 * race happen to share a silhouette (a field of ten or twelve, or a run-off
 * of earlier winners) the later lane takes the next colourway, so no two
 * runners on one card or one track look the same.
 */
export function runnerLooks(numbers: readonly number[]): RunnerLook[] {
  const seen = new Map<number, number>();
  return numbers.map((snailNo) => {
    const index = runnerArtIndexForSnail(snailNo);
    const repeat = seen.get(index) ?? 0;
    seen.set(index, repeat + 1);
    return { snailNo, art: RUNNER_ART_MANIFEST[index], hue: (repeat * HUE_STEP) % 360 };
  });
}

/** One lane's look, for a caller that has the race's numbers in lane order. */
export function runnerLook(numbers: readonly number[], lane: number): RunnerLook {
  const looks = runnerLooks(numbers);
  return looks[lane] ?? { snailNo: lane + 1, art: runnerArtForSnail(lane + 1), hue: 0 };
}

/** The snail numbers of a field of `lanes`: its own list when it has one (a run-off), else a run from the offset. */
export function laneNumbers(lanes: number, numberOffset = 0, numbers?: readonly number[] | null): number[] {
  return Array.from({ length: Math.max(0, lanes) }, (_, lane) => {
    const listed = numbers?.[lane];
    return typeof listed === 'number' && Number.isFinite(listed) ? listed : numberOffset + lane + 1;
  });
}

/** One lane's look for a caller with the field's size and number offset, as the race broadcast has. */
export function runnerLookAt(lane: number, lanes: number, numberOffset = 0, numbers?: readonly number[] | null): RunnerLook {
  return runnerLook(laneNumbers(Math.max(lanes, lane + 1), numberOffset, numbers), lane);
}

/** The art files a card's snails will need, each once, in first-use order. */
export function runnerArtSources(numbers: readonly number[]): string[] {
  return [...new Set(numbers.map((n) => runnerArtForSnail(n).src))];
}

/**
 * Lane-only fallback for callers that do not know the race's snail numbers.
 * Prefer runnerLook: this cannot tell snail 5 from snail 13.
 */
export function runnerArtForLane(lane: number): RunnerArtAsset {
  const integerLane = Number.isFinite(lane) ? Math.trunc(lane) : 0;
  const index = ((integerLane % COUNT) + COUNT) % COUNT;
  return RUNNER_ART_MANIFEST[index];
}

/** Lane-only fallback colourway: lanes past the eighth reuse the silhouettes with a distinct hue. */
export function runnerHueRotation(lane: number): number {
  const integerLane = Number.isFinite(lane) ? Math.max(0, Math.trunc(lane)) : 0;
  return Math.floor(integerLane / COUNT) * HUE_STEP;
}
