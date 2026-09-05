import type { CourseId } from './courses';

export interface CoursePoint {
  x: number;
  y: number;
}
export interface CourseLane {
  points: CoursePoint[];
  path: string;
}
const CONTROLS: Record<CourseId, number[][]> = {
  'boundary-oval': [
    [230, 360],
    [300, 185],
    [600, 155],
    [900, 185],
    [970, 360],
    [900, 535],
    [600, 565],
    [300, 535],
  ],
  'pavilion-chicane': [
    [230, 420],
    [270, 200],
    [510, 170],
    [630, 295],
    [790, 190],
    [970, 280],
    [930, 530],
    [680, 540],
    [520, 445],
    [330, 550],
  ],
  'floodlight-eight': [
    [600, 360],
    [370, 185],
    [220, 260],
    [300, 520],
    [600, 360],
    [830, 185],
    [980, 260],
    [900, 520],
  ],
  'practice-nets': [
    [220, 530],
    [220, 190],
    [410, 180],
    [470, 340],
    [670, 340],
    [740, 180],
    [970, 220],
    [960, 530],
    [730, 550],
    [620, 460],
    [450, 460],
    [360, 550],
  ],
};
const SAMPLES = 640;

function centrePoints(id: CourseId): CoursePoint[] {
  if (id === 'floodlight-eight') {
    return Array.from({ length: SAMPLES }, (_, i) => {
      const t = Math.PI * 0.75 + (i / SAMPLES) * Math.PI * 2;
      return { x: 600 + 380 * Math.sin(t), y: 360 + 170 * Math.sin(2 * t) };
    });
  }
  // Open each broadcast on a broad straight so profile artwork reads naturally.
  const authored = CONTROLS[id];
  const start = {
    'boundary-oval': 6,
    'pavilion-chicane': 7,
    'floodlight-eight': 3,
    'practice-nets': 8,
  }[id];
  const direction = id === 'boundary-oval' ? -1 : 1;
  const controls = authored.map(
    (_, i) =>
      authored[(start + direction * i + authored.length) % authored.length],
  );
  return Array.from({ length: SAMPLES }, (_, i) => {
    const t = (i / SAMPLES) * controls.length;
    const index = Math.floor(t),
      u = t - index;
    const p = [-1, 0, 1, 2].map(
      (j) => controls[(index + j + controls.length) % controls.length],
    );
    const value = (axis: number) =>
      ((1 - u) ** 3 * p[0][axis] +
        (3 * u ** 3 - 6 * u * u + 4) * p[1][axis] +
        (-3 * u ** 3 + 3 * u * u + 3 * u + 1) * p[2][axis] +
        u ** 3 * p[3][axis]) /
      6;
    return { x: value(0), y: value(1) };
  });
}

function laneFromPoints(points: CoursePoint[]): CourseLane {
  // Resample by distance: bends must not artificially speed up the broadcast.
  const closed = [...points, points[0]];
  const lengths = [0];
  for (let i = 1; i < closed.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(
          closed[i].x - closed[i - 1].x,
          closed[i].y - closed[i - 1].y,
        ),
    );
  let segment = 1;
  const sampled = Array.from({ length: SAMPLES }, (_, i) => {
    const distance = (i / SAMPLES) * lengths[lengths.length - 1];
    while (segment < lengths.length - 1 && lengths[segment] < distance)
      segment++;
    const f =
      (distance - lengths[segment - 1]) /
      (lengths[segment] - lengths[segment - 1] || 1);
    return {
      x:
        closed[segment - 1].x + f * (closed[segment].x - closed[segment - 1].x),
      y:
        closed[segment - 1].y + f * (closed[segment].y - closed[segment - 1].y),
    };
  });
  return {
    points: sampled,
    path:
      sampled
        .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`)
        .join(' ') + ' Z',
  };
}

/** Lane paint and runner feet share these exact polylines, including the lap seam. */
export function courseGeometry(id: CourseId, count: number) {
  const centre = centrePoints(id);
  const trackWidth = id === 'practice-nets' ? 120 : 144;
  const laneWidth = trackWidth / Math.max(1, count);
  const offset = (amount: number) =>
    laneFromPoints(
      centre.map((p, i) => {
        const before = centre[(i + SAMPLES - 1) % SAMPLES],
          after = centre[(i + 1) % SAMPLES];
        const dx = after.x - before.x,
          dy = after.y - before.y,
          length = Math.hypot(dx, dy) || 1;
        return {
          x: p.x - (dy / length) * amount,
          y: p.y + (dx / length) * amount,
        };
      }),
    );
  return {
    trackWidth,
    centre: laneFromPoints(centre),
    laneWidth,
    lanes: Array.from({ length: count }, (_, i) =>
      offset((i - (count - 1) / 2) * laneWidth),
    ),
    boundaries: Array.from({ length: count + 1 }, (_, i) =>
      offset((i - count / 2) * laneWidth),
    ),
  };
}

export function pointOnLane(
  lane: CourseLane,
  progress: number,
): CoursePoint & { angle: number } {
  const index = (((progress % 1) + 1) % 1) * lane.points.length;
  const a = lane.points[Math.floor(index)],
    b = lane.points[(Math.floor(index) + 1) % lane.points.length];
  const f = index - Math.floor(index);
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}
