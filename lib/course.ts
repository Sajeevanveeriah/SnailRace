/**
 * The circuit.
 *
 * The race engine describes a snail's position as one number, `p`, running
 * from 0 at the gate to 1 at the line, and guarantees the order those numbers
 * reach 1 in. Nothing in here can affect that: a course is only a way of
 * turning `p` into a place on the screen. Straight lanes map it to an x
 * offset; a circuit maps it to a distance around a closed loop. The proof in
 * `race-engine.ts` is untouched either way, which is why a lap counter could
 * be added without reopening the fairness argument.
 *
 * A course is a closed loop and `u = 0` is the start/finish line, so the path
 * of every course below begins on a straight where the field can line up.
 *
 * Geometry is sampled once into a flat table rather than queried per frame.
 * `SVGPathElement.getPointAtLength` is a layout read, and calling it twenty
 * times a frame at sixty frames a second on a projector laptop is exactly the
 * kind of thing that turns a smooth race into a slideshow.
 */

/** The coordinate space every course is authored in. */
export const COURSE_W = 1000;
export const COURSE_H = 620;

export interface CourseSector {
  /** Where the sector starts, as a fraction of one lap. */
  at: number;
  name: string;
}

export interface CourseScenery {
  kind: 'pond' | 'lettuce' | 'mud' | 'grandstand' | 'tree';
  x: number;
  y: number;
  /** Rough radius in course units, for the decorative shapes. */
  r: number;
}

export interface CourseDef {
  id: string;
  label: string;
  /** A closed path in the COURSE_W x COURSE_H space. The racing centreline. */
  d: string;
  /** Named stretches, used by the commentary and the position readout. */
  sectors: CourseSector[];
  scenery: CourseScenery[];
}

/*
 * Three courses, all closed loops with the start on a straight so the field
 * can line up. Corners are deliberately generous: at twenty lanes the outer
 * snail on a tight hairpin ends up outside the frame.
 */
export const COURSES: CourseDef[] = [
  {
    id: 'oval',
    label: 'Club oval',
    d: 'M 250 110 H 750 A 190 190 0 0 1 750 490 H 250 A 190 190 0 0 1 250 110 Z',
    sectors: [
      { at: 0.0, name: 'the home straight' },
      { at: 0.28, name: 'the top bend' },
      { at: 0.5, name: 'the back straight' },
      { at: 0.78, name: 'the final bend' },
    ],
    scenery: [
      { kind: 'grandstand', x: 500, y: 596, r: 150 },
      { kind: 'pond', x: 500, y: 300, r: 74 },
      { kind: 'lettuce', x: 300, y: 300, r: 40 },
      { kind: 'tree', x: 700, y: 300, r: 34 },
      { kind: 'mud', x: 620, y: 300, r: 30 },
    ],
  },
  {
    id: 'figure',
    label: 'Figure of eight',
    d:
      'M 500 310 C 640 170 880 170 880 310 C 880 450 640 450 500 310 ' +
      'C 360 170 120 170 120 310 C 120 450 360 450 500 310 Z',
    sectors: [
      { at: 0.0, name: 'the crossover' },
      { at: 0.25, name: 'the east loop' },
      { at: 0.5, name: 'the crossover' },
      { at: 0.75, name: 'the west loop' },
    ],
    scenery: [
      { kind: 'grandstand', x: 500, y: 588, r: 130 },
      { kind: 'lettuce', x: 880, y: 500, r: 44 },
      { kind: 'pond', x: 120, y: 500, r: 52 },
      { kind: 'tree', x: 500, y: 120, r: 30 },
    ],
  },
  {
    id: 'lane',
    label: 'Country lane',
    d:
      'M 140 500 C 140 330 260 300 380 330 C 500 360 520 220 420 160 ' +
      'C 320 100 620 70 760 140 C 900 210 900 350 800 420 ' +
      'C 700 490 620 420 520 470 C 420 520 220 560 140 500 Z',
    sectors: [
      { at: 0.0, name: 'the lane' },
      { at: 0.22, name: 'the cabbage bend' },
      { at: 0.45, name: 'the long climb' },
      { at: 0.7, name: 'the descent' },
      { at: 0.87, name: 'the run home' },
    ],
    scenery: [
      { kind: 'lettuce', x: 300, y: 430, r: 46 },
      { kind: 'pond', x: 660, y: 300, r: 58 },
      { kind: 'mud', x: 470, y: 250, r: 34 },
      { kind: 'tree', x: 200, y: 200, r: 30 },
      { kind: 'tree', x: 860, y: 500, r: 26 },
      { kind: 'grandstand', x: 250, y: 590, r: 110 },
    ],
  },
];

export type CourseId = (typeof COURSES)[number]['id'];

export const courseById = (id: string): CourseDef =>
  COURSES.find((c) => c.id === id) ?? COURSES[0];

/* ── Sampling ──────────────────────────────────────────────────────────── */

export interface CourseSample {
  x: number;
  y: number;
  /** Unit normal, pointing "outward". Lane offsets ride along this. */
  nx: number;
  ny: number;
  /** Heading in degrees, for pointing a snail the way it is going. */
  angle: number;
}

export interface SampledCourse {
  def: CourseDef;
  samples: CourseSample[];
  length: number;
}

const SAMPLES = 1400;

/**
 * Walk the path once and record position, heading and normal at each step.
 *
 * Needs a DOM, so this runs in the browser on mount. The normal is taken from
 * the tangent between neighbouring samples rather than from the path
 * derivative, which keeps it stable across the joins between curve segments
 * where an analytic derivative flips sign.
 */
export function sampleCourse(def: CourseDef): SampledCourse {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', def.d);
  svg.appendChild(path);

  const length = path.getTotalLength() || 1;
  const samples: CourseSample[] = new Array(SAMPLES);

  for (let i = 0; i < SAMPLES; i++) {
    const at = (i / SAMPLES) * length;
    const p = path.getPointAtLength(at);
    const ahead = path.getPointAtLength((at + length / SAMPLES) % length);
    let dx = ahead.x - p.x;
    let dy = ahead.y - p.y;
    const m = Math.hypot(dx, dy) || 1;
    dx /= m;
    dy /= m;
    samples[i] = {
      x: p.x,
      y: p.y,
      /* Left-hand normal. Consistent sign matters more than which side it
         is: lanes only need to stay in the same order the whole way round. */
      nx: -dy,
      ny: dx,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  return { def, samples, length };
}

/**
 * Position on the course at `u`, a fraction of ONE lap.
 *
 * Interpolates between samples so a slow snail still moves smoothly rather
 * than stepping between the 1400 recorded points.
 */
export function pointAt(course: SampledCourse, u: number): CourseSample {
  const n = course.samples.length;
  const f = ((u % 1) + 1) % 1; // wrap, including negatives
  const raw = f * n;
  const i = Math.floor(raw);
  const t = raw - i;
  const a = course.samples[i % n];
  const b = course.samples[(i + 1) % n];

  /* Headings are interpolated on the shortest arc, so the join at +180/-180
     does not spin a snail through a full circle in one frame. */
  let da = b.angle - a.angle;
  if (da > 180) da -= 360;
  if (da < -180) da += 360;

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    nx: a.nx + (b.nx - a.nx) * t,
    ny: a.ny + (b.ny - a.ny) * t,
    angle: a.angle + da * t,
  };
}

/**
 * Perpendicular offset for a lane, in course units.
 *
 * Lanes sit either side of the centreline, so every snail at the same `p` is
 * at the same point *along* the course whatever lane it is in. That is what
 * keeps a circuit looking as fair as it is: nobody is ever shown in front
 * because of where they were drawn.
 */
export function laneOffset(lane: number, fieldSize: number, spacing = 15): number {
  return (lane - (fieldSize - 1) / 2) * spacing;
}

/** Lane spacing that keeps a big field on the track. */
export const spacingFor = (fieldSize: number): number =>
  fieldSize <= 6 ? 30 : fieldSize <= 12 ? 20 : 13;

/** Which named stretch `u` (a fraction of one lap) falls in. */
export function sectorAt(def: CourseDef, u: number): string {
  const f = ((u % 1) + 1) % 1;
  let name = def.sectors[def.sectors.length - 1]?.name ?? '';
  for (const s of def.sectors) {
    if (f >= s.at) name = s.name;
  }
  return name;
}

/**
 * Split total progress into a lap number and a position within the lap.
 *
 * `p` is progress over the whole race, so a three-lap race puts p=0.5 halfway
 * through lap two. The clamp on the last lap stops a snail that has finished
 * from wrapping back to the start line for one frame.
 */
export function lapPosition(p: number, laps: number): { lap: number; u: number } {
  const total = Math.max(1, laps) * Math.min(1, Math.max(0, p));
  const lap = Math.min(Math.max(1, laps), Math.floor(total) + 1);
  return { lap, u: p >= 1 ? 1 : total - Math.floor(total) };
}
