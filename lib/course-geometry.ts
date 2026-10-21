import type { CourseId } from './courses';

export interface CoursePoint {
  x: number;
  y: number;
}
export interface CourseLane {
  points: CoursePoint[];
  path: string;
  /** Length of one lap of this lane, in course units. */
  length: number;
}
export interface CourseBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/*
 * Every course lives in a 1200 x 720 world and opens on a broad bottom
 * straight running left to right, so the side-on runner art reads the right
 * way round at the start and the START / FINISH board sits below the track,
 * clear of the runners.
 *
 * The oval is a smooth spline. The chicane and the switchback are drawn as
 * polygons with rounded corners (a straight, then an arc of a set radius),
 * which is what gives them real kinks and real hairpins rather than a
 * spline's gentle peanut. Every corner radius is larger than half the track,
 * so no lane ever folds back on itself.
 */

/** Spline control points for the oval, clockwise on screen. */
const OVAL: number[][] = [
  [230, 360],
  [300, 180],
  [600, 150],
  [900, 180],
  [970, 360],
  [900, 540],
  [600, 572],
  [300, 540],
];

/**
 * Rounded polygons: [x, y, corner radius]. Listed in running order from the
 * bottom-right corner of the opening straight.
 */
const POLYGONS: Partial<Record<CourseId, number[][]>> = {
  /*
   * The pavilion chicane: a big rounded circuit whose back straight, in
   * front of the pavilion, has a tight left-right-left bus stop dropped
   * into it. Heading west along the top, the field turns left (down into
   * the infield), right (back up) and left (straight again).
   */
  'pavilion-chicane': [
    [1010, 572, 150],
    [1010, 196, 150],
    [780, 196, 68],
    [690, 318, 80],
    [600, 196, 68],
    [190, 196, 150],
    [190, 572, 150],
  ],
  /*
   * The practice nets switchback: up the right-hand leg, then five
   * hairpins zigzag back across the ground, down the left-hand leg and
   * home along the bottom straight.
   */
  'practice-nets': [
    [1050, 598, 100],
    [1050, 122, 90],
    [870, 122, 90],
    [870, 410, 90],
    [690, 410, 90],
    [690, 122, 90],
    [510, 122, 90],
    [510, 410, 90],
    [330, 410, 90],
    [330, 122, 90],
    [150, 122, 90],
    [150, 598, 100],
  ],
};

/** Where each polygon course's start line sits on its bottom straight. */
const POLYGON_START_X: Partial<Record<CourseId, number>> = {
  'pavilion-chicane': 600,
  'practice-nets': 600,
};

const TRACK_WIDTH: Record<CourseId, number> = {
  'boundary-oval': 156,
  'pavilion-chicane': 132,
  'floodlight-eight': 144,
  'practice-nets': 120,
};

const SAMPLES = 720;

/** Dense points along a rounded polygon, starting on the bottom straight. */
function roundedPolygon(vertices: number[][], startX: number): CoursePoint[] {
  const n = vertices.length;
  const pieces: CoursePoint[] = [];
  const step = 2;
  const corners = vertices.map((v, i) => {
    const prev = vertices[(i + n - 1) % n],
      next = vertices[(i + 1) % n];
    const inX = v[0] - prev[0],
      inY = v[1] - prev[1];
    const outX = next[0] - v[0],
      outY = next[1] - v[1];
    const inL = Math.hypot(inX, inY),
      outL = Math.hypot(outX, outY);
    const d1 = { x: inX / inL, y: inY / inL };
    const d2 = { x: outX / outL, y: outY / outL };
    const turn = Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y);
    const r = v[2];
    const t = r * Math.tan(Math.abs(turn) / 2);
    const from = { x: v[0] - d1.x * t, y: v[1] - d1.y * t };
    const to = { x: v[0] + d2.x * t, y: v[1] + d2.y * t };
    /* The centre is on the inside of the turn. */
    const side = Math.sign(turn);
    const centre = { x: from.x - d1.y * r * side, y: from.y + d1.x * r * side };
    return { from, to, centre, r, turn };
  });
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    const a0 = Math.atan2(c.from.y - c.centre.y, c.from.x - c.centre.x);
    const arcSteps = Math.max(2, Math.ceil((Math.abs(c.turn) * c.r) / step));
    for (let k = 0; k < arcSteps; k++) {
      const a = a0 + (c.turn * k) / arcSteps;
      pieces.push({ x: c.centre.x + c.r * Math.cos(a), y: c.centre.y + c.r * Math.sin(a) });
    }
    const next = corners[(i + 1) % n];
    const len = Math.hypot(next.from.x - c.to.x, next.from.y - c.to.y);
    const lineSteps = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < lineSteps; k++) {
      const f = k / lineSteps;
      pieces.push({ x: c.to.x + (next.from.x - c.to.x) * f, y: c.to.y + (next.from.y - c.to.y) * f });
    }
  }
  /* Rotate so the lap starts on the opening straight at startX. */
  const bottom = Math.max(...pieces.map((p) => p.y));
  let best = 0,
    bestD = Infinity;
  pieces.forEach((p, i) => {
    const d = Math.abs(p.x - startX) + Math.abs(p.y - bottom) * 4;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return [...pieces.slice(best), ...pieces.slice(0, best)];
}

function splineOval(): CoursePoint[] {
  /* Clockwise on screen from the bottom: left to right along the straight. */
  const start = 6;
  const controls = OVAL.map((_, i) => OVAL[(start - i + OVAL.length) % OVAL.length]);
  return Array.from({ length: SAMPLES }, (_, i) => {
    const t = (i / SAMPLES) * controls.length;
    const index = Math.floor(t),
      u = t - index;
    const p = [-1, 0, 1, 2].map((j) => controls[(index + j + controls.length) % controls.length]);
    const value = (axis: number) =>
      ((1 - u) ** 3 * p[0][axis] +
        (3 * u ** 3 - 6 * u * u + 4) * p[1][axis] +
        (-3 * u ** 3 + 3 * u * u + 3 * u + 1) * p[2][axis] +
        u ** 3 * p[3][axis]) /
      6;
    return { x: value(0), y: value(1) };
  });
}

function centrePoints(id: CourseId): CoursePoint[] {
  if (id === 'floodlight-eight') {
    /* Opens at the foot of the right-hand loop, heading right. */
    return Array.from({ length: SAMPLES }, (_, i) => {
      const t = Math.PI / 4 + (i / SAMPLES) * Math.PI * 2;
      return { x: 600 + 380 * Math.sin(t), y: 360 + 170 * Math.sin(2 * t) };
    });
  }
  const polygon = POLYGONS[id];
  if (polygon) return laneFromPoints(roundedPolygon(polygon, POLYGON_START_X[id] ?? 600)).points;
  return splineOval();
}

function laneFromPoints(points: CoursePoint[]): CourseLane {
  // Resample by distance: bends must not artificially speed up the broadcast.
  const closed = [...points, points[0]];
  const lengths = [0];
  for (let i = 1; i < closed.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(closed[i].x - closed[i - 1].x, closed[i].y - closed[i - 1].y));
  const total = lengths[lengths.length - 1];
  let segment = 1;
  const sampled = Array.from({ length: SAMPLES }, (_, i) => {
    const distance = (i / SAMPLES) * total;
    while (segment < lengths.length - 1 && lengths[segment] < distance) segment++;
    const f = (distance - lengths[segment - 1]) / (lengths[segment] - lengths[segment - 1] || 1);
    return {
      x: closed[segment - 1].x + f * (closed[segment].x - closed[segment - 1].x),
      y: closed[segment - 1].y + f * (closed[segment].y - closed[segment - 1].y),
    };
  });
  return {
    points: sampled,
    length: total,
    path: sampled.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + ' Z',
  };
}

function boundsOf(lanes: CourseLane[]): CourseBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const lane of lanes)
    for (const p of lane.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Lane paint and runner feet share these exact polylines, including the lap seam. */
export function courseGeometry(id: CourseId, count: number) {
  const centre = centrePoints(id);
  const trackWidth = TRACK_WIDTH[id] ?? 144;
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
  const boundaries = Array.from({ length: count + 1 }, (_, i) => offset((i - count / 2) * laneWidth));
  return {
    trackWidth,
    centre: laneFromPoints(centre),
    laneWidth,
    lanes: Array.from({ length: count }, (_, i) => offset((i - (count - 1) / 2) * laneWidth)),
    boundaries,
    /** The painted track, edge to edge: what a whole-course shot must hold. */
    bounds: boundsOf([boundaries[0], boundaries[boundaries.length - 1]]),
  };
}

export type CourseGeometry = ReturnType<typeof courseGeometry>;

export function pointOnLane(lane: CourseLane, progress: number): CoursePoint & { angle: number } {
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

/**
 * Evenly spaced points along a course's centre line with their heading,
 * for direction chevrons and kerbs. `skip` drops marks within that many
 * course units of any listed point (the start line, a crossover).
 */
export function marksAlong(lane: CourseLane, count: number, skip: { point: CoursePoint; radius: number }[] = []) {
  const marks: (CoursePoint & { angle: number })[] = [];
  for (let i = 0; i < count; i++) {
    const p = pointOnLane(lane, (i + 0.5) / count);
    if (skip.some((s) => Math.hypot(p.x - s.point.x, p.y - s.point.y) < s.radius)) continue;
    marks.push(p);
  }
  return marks;
}

/** Signed turn per unit length at each point of a lane. */
export function curvatures(lane: CourseLane): number[] {
  const pts = lane.points;
  const n = pts.length;
  return pts.map((b, i) => {
    const a = pts[(i + n - 3) % n],
      c = pts[(i + 3) % n];
    let turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    /* The two headings are three steps apart along the lane: half the chord. */
    return turn / (Math.hypot(c.x - a.x, c.y - a.y) / 2 || 1);
  });
}

/**
 * Kerbs: the stretches of a track edge where `keep` holds, as runs of
 * consecutive points ready to stroke. A run that crosses the lap seam is
 * joined up.
 */
export function kerbRuns(lane: CourseLane, keep: (p: CoursePoint, curvature: number) => boolean): CoursePoint[][] {
  const k = curvatures(lane);
  const flags = lane.points.map((p, i) => keep(p, k[i]));
  const n = flags.length;
  if (flags.every(Boolean)) return [lane.points.slice()];
  const first = flags.findIndex((f) => !f);
  const runs: CoursePoint[][] = [];
  let run: CoursePoint[] = [];
  for (let j = 1; j <= n; j++) {
    const i = (first + j) % n;
    if (flags[i]) run.push(lane.points[i]);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 2);
}
